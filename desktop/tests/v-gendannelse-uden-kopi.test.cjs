// Q:C2-5 (d): git:restore i main.cjs kaldte restoration.previous uden try/catch. Kunne kopien fra før gendannelsen (journalen) ikke
// læses, fejlede hele handlingen, efter at filerne var sat tilbage og gemt som en ny version: brugerfladen fik en fejl i stedet for
// resultatet, og planen blev ikke nulstillet. activate gør det samme kald i en try/catch og nulstiller planen; git:restore skal
// gøre det samme og sige det i svaret.
// Prøven kører main.cjs' egne handlere git:restore-review og git:restore med rigtig Git, det rigtige lager og den rigtige Restoration.
// Kun skaden på journalen er fremkaldt: den overskrives, lige efter at gendannelsen har skrevet den.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const desktop = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(desktop, 'main.cjs'), 'utf8');
const { Store } = require('../core/store.cjs');
const { GitVersions, run } = require('../core/git.cjs');
const { Restoration } = require('../core/restoration.cjs');

function cut(from, to) {
  const start = source.indexOf(from); assert.ok(start >= 0, `main.cjs mangler ${from}`);
  const end = source.indexOf(to, start + from.length); assert.ok(end > start, `main.cjs mangler ${to} efter ${from}`);
  return source.slice(start, end);
}

test('Q:C2-5 (d): kan kopien fra før gendannelsen ikke læses, svarer git:restore med de gendannede filer og en nulstillet plan', async t => {
  const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-gendannelse-')));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  // Brugerens egen Git-opsætning (hooks, signering) må ikke påvirke prøven.
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = path.join(base, 'hjem'); process.env.XDG_CONFIG_HOME = path.join(base, 'hjem', '.config');
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const root = path.join(base, 'projekt'), file = path.join(root, 'index.html');
  await fsp.mkdir(root);
  const store = new Store(path.join(base, 'data'), {}), git = new GitVersions();
  await git.initialize(root); await git.setIdentity(root, { name: 'Prøvebruger', email: 'proeve@example.invalid' });
  await fsp.writeFile(file, 'Første'); const first = await git.saveAll(root, 'Første');
  await fsp.writeFile(file, 'Anden'); await git.saveAll(root, 'Anden');
  await store.saveProject(root, { autoCheckpoint: true });

  const real = new Restoration(git, store);
  // Journalen bliver ulæselig, lige efter at gendannelsen har skrevet den, fx en beskadiget fil.
  const restoration = { review: (...args) => real.review(...args), previous: (...args) => real.previous(...args), status: (...args) => real.status(...args),
    apply: async (...args) => { const result = await real.apply(...args); await fsp.writeFile(real.journal(root), '{'); return result; } };
  const plans = [], logs = [], edits = [];
  const bench = { store, git, chats: new Map(), busyRoot: () => false, findTask: () => null, ensureBaseline: async () => {}, state: async () => ({ chat: null }),
    invalidatePlan: async id => { plans.push(id); }, log: entry => { logs.push(entry); }, recordEdit: edit => { edits.push(edit); return { id: 'gendannelse' }; } };
  const handlers = {};
  const deps = {
    handle: (channel, action) => { handlers[channel] = action; }, exclusive: action => action(), crypto,
    workbench: bench, restoration, requireIdleProject: () => root, workspaceRoot: () => root, currentProject: () => ({ root }), requestChatID: () => null,
    currentSpace: () => ({ devServer: { stop: async () => {} }, externalPreview: null }), currentPage: () => '', captureView: async () => null,
    images: { pairFor: async () => null, read: async () => null, add: async () => {}, bind: async () => {} }, startStatic: async () => false, sendEvent: () => {}, chatState: async state => state
  };
  const names = Object.keys(deps);
  new Function(...names, cut('let pendingRestore = null;', "handle('git:save'"))(...names.map(name => deps[name]));

  const review = await handlers['git:restore-review']({ commit: first.head });
  assert.deepEqual(review.files.map(item => item.file), ['index.html']);
  const result = await handlers['git:restore']({ token: review.token, label: 'Gendannet til: Første' });
  assert.equal(await fsp.readFile(file, 'utf8'), 'Første', 'filerne er sat tilbage');
  assert.equal(result.restored.files, 1);
  assert.ok(result.saved?.head, 'gendannelsen er gemt som en ny version');
  assert.equal((await run(root, ['log', '-1', '--format=%s'])).toString().trim(), 'Gendannet til: Første');
  assert.match(result.error, /Filerne er sat tilbage\. Kopien før sidste gendannelse kan ikke læses\..* Den gamle plan er nulstillet\./, 'svaret siger, hvad der skete');
  assert.equal(plans.length, 1, 'planen nulstilles');
  assert.match(plans[0], /^[a-f0-9-]{36}$/);
  assert.deepEqual(edits.map(edit => edit.label), ['Gendannet til: Første'], 'ændringen står under Ændringer');
  assert.ok(logs.some(entry => entry.title === 'Filerne er sat tilbage'));
});
