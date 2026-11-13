// R#20: forhåndsvisningen viser ikke sidens egne dialogbokse (alert, confirm, prompt), for en side kunne ellers fryse hele Aura.
// Det er besluttet og bevares. Men Chromium siger det kun i konsollen, og confirm() svarer da altid nej, så en Slet-knap ser død ud.
// Aura skal sige det i almindeligt dansk. Prøverne bruger Chromiums egne beskeder fra den medfølgende Electron 44.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { desktopRequire, tempDir, cut, load } = require('./c1-main-kilde.cjs');
const { serverUI } = require('./c1-dom.cjs');
const previewSession = desktopRequire('./core/preview-session.cjs');
const { contentSecurityPolicy } = desktopRequire('./core/preview-policy.cjs');

const chromium = call => `Ignored call to '${call}()'. The document is sandboxed, and the 'allow-modals' keyword is not set.`;

test('alert, confirm og prompt i forhåndsvisningen giver en forklaring i almindeligt dansk', () => {
  const confirm = previewSession.diagnosticForConsole({ level: 'error', message: chromium('confirm') });
  assert.equal(confirm?.kind, 'dialog');
  assert.match(confirm.message, /confirm\(\)[\s\S]*viser ikke sidens egne dialogbokse[\s\S]*svaret blev automatisk nej/);
  assert.match(confirm.repair, /dialog i selve siden/, 'Ret med AI foreslår en dialog i siden');
  assert.match(previewSession.diagnosticForConsole({ message: chromium('alert') }).message, /alert\(\)[\s\S]*beskeden blev ikke vist/);
  assert.match(previewSession.diagnosticForConsole({ message: chromium('prompt') }).message, /prompt\(\)[\s\S]*intet svar/);
  assert.equal(previewSession.diagnosticForConsole({ message: chromium('print') }).repair, '', 'udskrivning er ikke en fejl i koden');
  // Andre konsolbeskeder er uændrede: en almindelig fejl giver ingen diagnose, en CSP-blokering giver netadgangens.
  assert.equal(previewSession.diagnosticForConsole({ message: 'Uncaught TypeError: x is not a function' }), null);
  assert.equal(previewSession.diagnosticForConsole({ message: "Loading the image 'https://billeder.example.com/a.png' violates the following Content Security Policy directive: \"img-src 'self' data: blob:\". The action has been blocked." }).kind, 'images');
});

test('main.cjs sender forklaringen til den forhåndsvisning, hvor siden kaldte dialogboksen', async t => {
  const root = await tempDir(t, 'aura-c1-dialog-');
  const events = [], ctx = { root, owner: { project: { root } }, key: 'projekt-a', externalPreview: 'http://127.0.0.1:48008/' };
  const spaces = new Map([[root, ctx]]);
  let listener;
  const deps = {
    window: { webContents: { on: (name, handler) => { if (name === 'console-message') listener = handler; } } },
    previewSession, spaces, spaceFor: (value = root) => spaces.get(value), sendEvent: event => events.push(event),
    previewLog: { documents: [], errors: [] }, previewOrigin: () => ctx.externalPreview, remember: (list, entry) => list.push(entry),
    require: desktopRequire, uiURL: 'harness://app/index.html'
  };
  load([cut('function previewAllowed(url)', 'function previewDiagnostic('), cut('function previewDiagnostic(ctx, diagnostic) {', 'function configurePreviewSession('), cut("window.webContents.on('console-message'", '// Genindlæses forhåndsvisningen i ændringstilstand')], deps);
  listener({ level: 'error', message: chromium('confirm'), frame: { url: 'http://127.0.0.1:48008/liste' }, sourceId: 'http://127.0.0.1:48008/app.js', lineNumber: 12 });
  const event = events.find(item => item.type === 'preview.diagnostic');
  assert.ok(event, 'forklaringen sendes til brugerfladen');
  assert.equal(event.workspaceRoot, root); assert.equal(event.diagnostic.kind, 'dialog');
  assert.equal(deps.previewLog.errors.length, 1, 'konsolbeskeden gemmes stadig til kontrollen efter en opgave');
});

test('brugerfladen viser forklaringen med Ret med AI, og ↻ fjerner den', () => {
  const view = serverUI();
  view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'running', url: view.current.previewURL, project: { kind: 'vite', supported: true, installed: true, label: 'Vite', diagnostics: [] } });
  view.emit({ type: 'preview.diagnostic', root: '/projekt', workspaceRoot: '/projekt', diagnostic: previewSession.diagnosticForConsole({ message: chromium('confirm') }) });
  assert.equal(view.find('Gennemgå forhåndsvisning').hidden, false);
  assert.match(view.created.map(el => el.textContent).join('\n'), /svaret blev automatisk nej/);
  const repair = view.created.filter(el => el.textContent === 'Ret med AI' && el.id !== 'server-repair').at(-1);
  assert.equal(repair.hidden, false, 'AI’en kan bytte til en dialog i selve siden');
  view.$('#refresh').click();
  assert.equal(view.find('Gennemgå forhåndsvisning').hidden, true);
});

test('beslutningen står fast: rammen og den statiske side tillader stadig ikke sidens egne dialogbokse', () => {
  const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8'), index = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  assert.doesNotMatch(app + index, /allow-modals/);
  assert.doesNotMatch(contentSecurityPolicy({ origin: 'aura-preview://projekt-a/', static: true }), /allow-modals/);
});
