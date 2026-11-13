// Aktivitet: en log over det, der faktisk sker i et projekt, mens Aura er åben. Hver række kommer fra en hændelse i
// agentmotoren, en godkendelse, forhåndsvisningens server eller en version. Intet simuleres, og en afsluttet kommando
// kaldes "afsluttet", ikke "bestået". Loggen gemmes ikke på disken.
const path = require('node:path');
const { cleanOutput } = require('./dev-server.cjs');

// Samme betegnelser som i samtalens statuslinje. Status står for sig: Venter, I gang, Afsluttet eller Mislykkedes.
const toolLabels = { read: 'Læs fil', edit: 'Rediger fil', write: 'Skriv fil', patch: 'Ret filer', apply_patch: 'Ret filer', multiedit: 'Rediger fil', bash: 'Kør kommando', webfetch: 'Læs hjemmeside', websearch: 'Søg på nettet', glob: 'Find filer', grep: 'Søg i filer', list: 'Se mappe', skill: 'Hent skill', todowrite: 'Opdatér opgaveliste', todoread: 'Læs opgaveliste', question: 'Spørgsmål' };
const approvalTitles = { edit: 'Godkendelse: ændre en fil', bash: 'Godkendelse: køre en kommando', webfetch: 'Godkendelse: åbne en hjemmeside', external_directory: 'Godkendelse: adgang uden for projektet', grep: 'Godkendelse: søge i filerne' };
const FILE_TOOLS = new Set(['edit', 'write', 'multiedit']);
const PATCH_TOOLS = new Set(['patch', 'apply_patch']);

// Sandkassen pakker agentens kommando ind i "exec /usr/bin/env -i ... 'nyttelast'". Aktivitet og godkendelser viser den
// oprindelige kommando, som ligger i nyttelasten, men kun for en indpakning, sandkassen selv har lavet (præcis samme
// forstavelse). En kommando, agenten selv har skrevet i samme form, vises uændret og kan ikke forklæde sig.
function originalCommand(command) { return require('./command-sandbox.cjs').unwrap(command); }

// En sti vises i forhold til projektet, når den ligger i projektet. Skills ligger i motorens egen mappe og vises med navn.
function projectPath(root, file) {
  if (typeof file !== 'string' || !file) return '';
  const skill = /(?:^|[\\/])config[\\/]skills[\\/](harness-[a-z0-9-]+)[\\/](.+)$/.exec(file);
  if (skill) return `Skill ${skill[1]} › ${skill[2].replaceAll('\\', '/')}`;
  if (root && path.isAbsolute(file)) {
    const relative = path.relative(root, file);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  }
  return file;
}
// En fil i projektet, som et værktøj har skrevet. Kun stier inde i projektmappen tæller.
function projectFile(root, file) {
  if (typeof file !== 'string' || !file || !root) return null;
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}
// Filer, som et patchværktøj angiver i sin tekst ("*** Update File: sti").
function patchFiles(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map(match => (match[1] || match[2]).trim());
}
function toolFiles(part, root) {
  const input = part.state?.input || {}, metadata = part.state?.metadata || {};
  if (FILE_TOOLS.has(part.tool)) return [projectFile(root, input.filePath || input.path || metadata.filepath)].filter(Boolean);
  if (PATCH_TOOLS.has(part.tool)) return [...new Set(patchFiles(input.patchText || input.patch).map(file => projectFile(root, file)).filter(Boolean))];
  return [];
}
function toolEntry(part, root) {
  const state = part.state || {}, input = state.input || {}, metadata = state.metadata || {};
  const file = input.filePath || input.path || metadata.filepath;
  let target = part.tool === 'bash' ? originalCommand(input.command) || state.title || '' : file ? projectPath(root, file) : input.url || input.query || input.pattern || state.title || '';
  if (PATCH_TOOLS.has(part.tool)) target = toolFiles(part, root).join(', ') || state.title || '';
  const entry = { id: `tool-${part.id}`, kind: 'tool', tool: part.tool, title: toolLabels[part.tool] || `Værktøj: ${part.tool}`, target: projectPath(root, String(target)).slice(0, 2000), status: state.status || 'pending' };
  if (Number.isFinite(state.time?.start)) entry.started = state.time.start;
  if (Number.isFinite(state.time?.end)) entry.ended = state.time.end;
  if (part.tool === 'bash') {
    const output = typeof state.output === 'string' ? state.output : typeof metadata.output === 'string' ? metadata.output : '';
    if (output) entry.output = cleanOutput(output).slice(-4000);
    if (Number.isInteger(metadata.exit)) entry.exit = metadata.exit;
  }
  if (state.status === 'error' && state.error) entry.error = cleanOutput(String(state.error)).slice(0, 800);
  return entry;
}
function approvalTarget(p, root) {
  if (p.permission === 'bash') return originalCommand(String(p.metadata?.command || (p.patterns || []).join('\n')));
  if (typeof p.metadata?.filepath === 'string') return projectPath(root, p.metadata.filepath);
  return (p.patterns || []).join('\n');
}

class Activity {
  constructor(emit = () => {}, limit = 400) { this.emit = emit; this.limit = limit; this.entries = []; this.index = new Map(); this.counter = 0; }
  put(entry) {
    let stored = this.index.get(entry.id);
    if (stored) Object.assign(stored, entry);
    else {
      stored = { at: Date.now(), ...entry, id: entry.id || `entry-${Date.now()}-${++this.counter}` };
      this.entries.push(stored); this.index.set(stored.id, stored);
      while (this.entries.length > this.limit) this.index.delete(this.entries.shift().id);
    }
    this.emit({ ...stored });
    return stored;
  }
  get(id) { return this.index.get(id); }
  list() { return this.entries.map(entry => ({ ...entry })); }
}

module.exports = { Activity, originalCommand, toolEntry, toolFiles, approvalTarget, approvalTitles, toolLabels, projectPath, projectFile, patchFiles };
