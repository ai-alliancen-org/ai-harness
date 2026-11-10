// Hjælper til prøverne af main.cjs uden Electron: skærer navngivne stykker ud af main.cjs' egen kildetekst og kører dem mod de
// rigtige moduler (DevServer, Store, preview-session, preview-policy, preview-config). Kun Electron-dele som vinduer, IPC og
// app erstattes af små attrapper, som den enkelte prøve giver med. Filen er ikke selv en prøve.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const desktop = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(desktop, 'main.cjs'), 'utf8');
function cut(from, to) {
  const start = source.indexOf(from);
  if (start < 0) throw Error(`main.cjs mangler: ${from}`);
  const end = source.indexOf(to, start + from.length);
  if (end < 0) throw Error(`main.cjs mangler: ${to}`);
  return source.slice(start, end);
}
// require som i main.cjs: './core/…' læses fra desktop-mappen.
const desktopRequire = name => require(name.startsWith('./') ? path.join(desktop, name) : name);
// deps bliver lokale navne i stykkerne; lets bliver `let`-variable, som stykkerne kan ændre.
function load(pieces, deps, { lets = {}, returns = [] } = {}) {
  const names = Object.keys(deps);
  const body = `${Object.keys(lets).map(name => `let ${name} = lets.${name};`).join('\n')}\n${pieces.join('\n')}\nreturn { ${returns.join(', ')} };`;
  return new Function('lets', ...names, body)(lets, ...names.map(name => deps[name]));
}
async function tempDir(t, prefix) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

// Forhåndsvisningens del af main.cjs: rum, server, diagnoser og kanalerne, med et rigtigt lager på disken.
function previewMain({ root, store, events = [], openProject = async () => ({ staticPreview: false }), extra = {} }) {
  const { DevServer, inspect: inspectRuntime } = desktopRequire('./core/dev-server.cjs');
  const { normalizeRuntimeConfig } = desktopRequire('./core/project-runtime.cjs');
  const previewSession = desktopRequire('./core/preview-session.cjs');
  const { storedRuntime, storedRuntimeNotice } = desktopRequire('./core/preview-config.cjs');
  const owner = { store, project: { root }, chats: new Map(), claims: new Map(), chatID: null, chat: null };
  const handlers = {}, spaces = new Map();
  const workbench = { store, chats: owner.chats, busyRoot: () => false, approvalsPolicy: { settings: async () => ({}) } };
  const deps = {
    app: { isPackaged: false }, path, DevServer, inspectRuntime, normalizeRuntimeConfig, storedRuntime, storedRuntimeNotice, previewSession, openProject,
    komplaiScript: () => async () => null, recordFailure: () => {}, sendEvent: event => events.push(event),
    handle: (channel, action) => { handlers[channel] = action; }, exclusive: action => action(),
    requireProject: () => root, currentWorkbench: () => owner, currentProject: () => owner.project, workspaceRoot: () => root,
    currentSpace: () => spaces.get(root) || {}, spaceFor: (value = root) => spaces.get(value),
    registry: { selected: owner }, workbench, spaces,
    // Kommandosandkassen undersøges ikke her; den har sine egne prøver.
    require: name => name === './core/command-sandbox.cjs' ? { support: async () => ({ available: false, reason: 'Ikke undersøgt i prøven.' }) } : desktopRequire(name),
    ...extra
  };
  const pieces = [
    cut('function makeServer(ctx) {', 'async function selectSpace('),
    cut('async function selectSpace(', 'async function chatState('),
    cut('async function projectSettings()', "handle('project:settings', projectSettings);"),
    cut('function previewAllowed(url)', 'function previewDiagnostic('),
    cut('function previewDiagnostic(ctx, diagnostic) {', 'function configurePreviewSession('),
    cut("handle('preview:allow'", "handle('preview:runtime'"),
    cut("handle('preview:runtime'", '// Kontrol af forhåndsvisningen efter en opgave'),
    cut("handle('preview:prepare'", 'const previewBridge = require(')
  ];
  const api = load(pieces, deps, { lets: { selectedRoot: null }, returns: ['makeServer', 'selectSpace', 'projectSettings', 'previewAllowed', 'previewDiagnostic'] });
  return { ...api, handlers, spaces, owner, workbench, events, previewSession };
}

module.exports = { source, cut, load, desktop, desktopRequire, tempDir, previewMain };
