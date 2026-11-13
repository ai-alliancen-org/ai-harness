const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { run, content } = require('./git.cjs');

async function hooksBlock(repo) {
  const hooks = (await run(repo.root, ['rev-parse', '--git-path', 'hooks'])).toString().trim();
  const directory = path.resolve(repo.root, hooks);
  try { if ((await fs.readdir(directory)).some(name => !name.endsWith('.sample'))) return 'Git-hooks kræver gennemgang i dit Git-værktøj for denne handling.'; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return '';
}
async function automaticBlock(repo) {
  if (repo.block) return repo.block;
  if (!repo.head) return 'Gem først projektets første version manuelt.';
  const hook = await hooksBlock(repo); if (hook) return hook;
  return filterBlock(repo);
}
// Kun filtre, som projektet selv tager i brug via .gitattributes, kan ændre indholdet, når en version gemmes. Et globalt
// filter i brugerens Git-opsætning, fx fra Git LFS, betyder intet, før projektet bruger det, og må ikke stoppe versionerne.
async function filterBlock(repo) {
  const files = (await run(repo.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).toString().split('\0').filter(Boolean);
  if (!files.length) return '';
  const answer = (await run(repo.root, ['check-attr', '-z', '--stdin', 'filter'], Buffer.from(files.join('\0') + '\0'))).toString().split('\0');
  for (let i = 2; i < answer.length; i += 3) if (answer[i] && !['unspecified', 'unset'].includes(answer[i])) return 'Projektet bruger Git-filtre, fx Git LFS. Gem selv versionen med Gem version.';
  return '';
}
// Automatisk version efter hver AI-opgave. Opgavens filer findes ud fra indhold: de filer, der er ændret i forhold til
// opgavens start. Brugerens egne ugemte ændringer fra før opgaven gemmes ikke med, medmindre opgaven også ændrede filen.
// Filer, som versionsgemningen afviser (hemmeligheder, beskyttede stier, store eller ukendte binære filer), bliver ugemte.
class Checkpoints {
  constructor(git, emit) { this.git = git; this.emit = emit; this.active = null; }
  async begin(root, enabled, label = '') {
    this.active = null;
    if (!enabled) return;
    const task = { root, label, baseline: new Map(), reason: '', canceled: false, stopped: false };
    this.active = task;
    try {
      const repo = await this.git.repository(root);
      task.root = repo.root; task.head = repo.head; task.branch = repo.branch;
      task.reason = await automaticBlock(repo);
      if (!task.reason) for (const file of repo.files) task.baseline.set(file.file, (await content(repo.root, file.file)).hash);
    } catch (error) { task.reason = error.message; }
  }
  // Et stop eller en fejl gemmes stadig som en version, så opgaven kan fortrydes. Beskeden fortæller, at den blev afbrudt.
  cancel(reason = 'Opgaven blev stoppet eller mislykkedes.') { if (this.active) { this.active.stopped = true; this.active.stopReason = reason; } }
  observe() {}
  async finish() {
    const task = this.active; this.active = null;
    if (!task) return;
    try {
      if (task.reason) throw new Error(task.reason);
      const repo = await this.git.repository(task.root);
      const block = await automaticBlock(repo);
      if (block) throw new Error(block);
      if (repo.head !== task.head || repo.branch !== task.branch) throw new Error('Git-historikken blev ændret under opgaven.');
      const changed = [];
      for (const file of repo.files) if ((await content(repo.root, file.file)).hash !== task.baseline.get(file.file)) changed.push(file.file);
      if (!changed.length) { this.emit({ type: 'git.checkpoint', status: 'unchanged', message: 'Opgaven ændrede ingen filer.' }); return; }
      const review = await this.git.review(task.root);
      const files = review.files.filter(f => changed.includes(f.file) && !f.blocked).map(f => f.file);
      const kept = review.files.filter(f => changed.includes(f.file) && f.blocked).map(f => f.file);
      if (!files.length) throw new Error('Opgavens filer kræver manuel gennemgang: ' + kept.join(', '));
      const text = task.label.replace(/\s+/g, ' ').trim();
      // Lange beskeder forkortes ved et ordskifte, så versionens navn kan læses i historikken.
      const summary = text.length <= 80 ? text || 'AI-opgave' : text.slice(0, 80).replace(/[\s,.;:]+\S*$/, '') + ' …';
      const message = `${task.stopped ? 'Afbrudt AI-opgave' : 'AI-opgave'}: ${summary}`;
      const result = await this.git.commit(task.root, { token: review.token, files, message });
      // Filer, der ikke kom med, nævnes ved navn: de fortrydes heller ikke sammen med opgaven. Årsagen pr. fil står under Gem version.
      const skipped = kept.length ? ` Disse filer blev ikke gemt og fortrydes ikke med opgaven, fordi Aura ikke gemmer dem automatisk, fx ved en mulig hemmelighed eller en stor fil: ${kept.join(', ')}.` : '';
      this.emit({ type: 'git.checkpoint', status: 'saved', head: result.head, previous: task.head, message: (task.stopped ? 'Opgaven blev afbrudt. Det, den nåede at ændre, er gemt som en version, så du kan fortryde.' : 'Gemt som en version. Du kan fortryde opgaven.') + skipped, kept, files });
    } catch (error) { this.emit({ type: 'git.checkpoint', status: 'skipped', message: `Versionen blev ikke gemt automatisk: ${error.message}` }); }
  }
}
module.exports = { Checkpoints, automaticBlock, hooksBlock, filterBlock };
