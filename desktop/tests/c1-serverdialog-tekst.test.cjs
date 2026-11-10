// T:test-frameworks: dialogen «Start den lokale server?» lovede lige over Godkend, at serveren stoppes ved projektskift. Det har den
// ikke gjort siden 5ffe905 (23. oktober): et projektskift bevarer serveren, og lukning af Aura stopper den (desktop/README.md).
// Teksten skal beskrive den faktiske adfærd. Prøven kører den rigtige ui/server.js og holder teksten op mod main.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cut } = require('./c1-main-kilde.cjs');
const { serverUI } = require('./c1-dom.cjs');

async function consequence(kind) {
  const review = { token: 't', command: kind === 'services' ? 'Webside: node server.js' : `${kind} dev`, root: '/projekt', scripts: false, project: { kind, dependencies: [kind], installs: [] } };
  const view = serverUI({ answers: { previewPrepare: () => review, projectSettings: () => ({ runtime: { network: null } }) } });
  view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'idle', project: { kind, label: kind, supported: true, installed: true } });
  await view.$('#server-primary').onclick();
  assert.equal(view.$('#server-review-title').textContent, 'Start den lokale server?');
  return view.$('#server-consequence').textContent;
}

test('teksten over Godkend siger, at serveren kører videre ved projektskift og stopper med Stop eller ved lukning', async () => {
  for (const kind of ['vite', 'astro', 'services']) {
    const text = await consequence(kind);
    assert.doesNotMatch(text, /stoppes, når du skifter projekt/, `${kind}: teksten lover noget, appen ikke gør`);
    assert.match(text, /kører videre, når du skifter projekt/, kind);
    assert.match(text, /Stop eller lukker Aura/, kind);
    // Kun en godkendt start huskes (R#19), og det står over Godkend, så brugeren ved, at AI’en kan starte den igen.
    assert.match(text, /Godkendelsen huskes, så AI’en kan starte/, kind);
  }
});

test('installationens tekst lover intet om start, fordi en installation ikke huskes som startsamtykke', async () => {
  const review = { token: 't', command: 'npm ci', root: '/projekt', scripts: false, project: { kind: 'vite', install: 'ci', dependencies: ['vite'], installs: [] } };
  const view = serverUI({ answers: { previewPrepare: () => review } });
  view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'idle', project: { kind: 'vite', label: 'Vite', supported: true, installed: false } });
  await view.$('#server-primary').onclick();
  assert.equal(view.$('#server-review-title').textContent, 'Installér projektets pakker?');
  assert.doesNotMatch(view.$('#server-consequence').textContent, /huskes|AI/);
});

test('teksten passer til main.cjs: et projektskift stopper ingen server, og lukning af Aura stopper alle', () => {
  const activate = cut('async function activate(next) {', 'function handle(channel, action) {');
  assert.doesNotMatch(activate, /closeSpaces|devServer\??\.stop/, 'projektskift stopper ikke serveren');
  assert.match(cut('function shutdown() {', 'const uiURL ='), /closeSpaces\(\)/, 'lukning stopper alle servere');
  assert.match(cut('async function closeSpaces()', 'let quitReady'), /devServer\?\.stop\(\)/);
});
