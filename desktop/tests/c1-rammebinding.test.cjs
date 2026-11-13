// K3 (a) og (c): forhåndsvisningens ramme bindes til sit arbejdsområde ved appens første navigation af den (frameTreeNodeId, som
// siden ikke kan ændre). En omdirigering kan derfor ikke lande på et andet arbejdsområdes server, og en blokeret navigation forklares
// i stedet for at være tavs. Et link til et andet websted, som appens egen frame-src stopper, forklares også.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { desktopRequire, tempDir, cut, load } = require('./c1-main-kilde.cjs');
const { serverUI } = require('./c1-dom.cjs');
const previewSession = desktopRequire('./core/preview-session.cjs');
const { installSession, staticPreview } = previewSession;

const app = 'harness://app/index.html';
function session(contexts) {
  let before, headers; const diagnosed = [];
  const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(listener) { before = listener; }, onHeadersReceived(listener) { headers = listener; } } };
  installSession(ses, { contexts: () => contexts, onDiagnostic: (ctx, value) => diagnosed.push({ root: ctx.root, ...value }) });
  const allowed = details => { let value; before(details, answer => { value = !answer.cancel; }); return value; };
  return { allowed, diagnosed, headers: details => new Promise(resolve => headers({ ...details, responseHeaders: {} }, resolve)) };
}
// Rammen, som Electron giver i webRequest: dens URL er det forrige dokument, forælderen er appen, og id'et er browserens.
const frame = (frameTreeNodeId, url = 'about:blank') => ({ frameTreeNodeId, url, parent: { url: app } });
const navigate = (target, f) => ({ url: target, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: f });

test('en omdirigering ved første navigation kan ikke lande på et andet arbejdsområdes server', () => {
  const a = { key: 'projekt-a', root: '/a', externalPreview: 'http://127.0.0.1:41001/' };
  const b = { key: 'projekt-b', root: '/b' }; b.preview = staticPreview(b);
  const { allowed, diagnosed } = session([a, b]);
  const f = frame(11);
  assert.equal(allowed(navigate(a.externalPreview, f)), true, 'appen viser projekt A i sin ramme');
  // Serveren i A svarer 302 til B's adresse. Electron melder samme ramme (stadig about:blank) og appen som initiator.
  assert.equal(allowed(navigate(b.preview.url, f)), false, 'omdirigeringen må ikke vise projekt B i A’s ramme');
  assert.equal(diagnosed.length, 1, 'blokeringen forklares');
  assert.equal(diagnosed[0].root, '/a'); assert.equal(diagnosed[0].kind, 'navigation');
  assert.match(diagnosed[0].message, /kan ikke vise aura-preview:\/\/projekt-b[\s\S]*Tryk ↻/);
  assert.equal(diagnosed[0].repair, '', 'et link eller en omdirigering giver ingen rettelse til AI’en');
});

test('en omdirigering til en ukendt adresse forklares i stedet for at være tavs', () => {
  const a = { key: 'projekt-a', root: '/a', externalPreview: 'http://localhost:41001/' };
  const { allowed, diagnosed } = session([a]);
  const f = frame(21);
  assert.equal(allowed(navigate(a.externalPreview, f)), true);
  assert.equal(allowed(navigate('https://localhost:41443/', f)), false);
  assert.equal(diagnosed.length, 1, 'før var den tavs');
  assert.equal(diagnosed[0].origin, 'https://localhost:41443');
});

test('appens egne navigationer i en bundet ramme virker stadig, og hver ramme har sit eget arbejdsområde', async () => {
  const a = { key: 'projekt-a', root: '/a' }; a.preview = staticPreview(a);
  const b = { key: 'projekt-b', root: '/b', externalPreview: 'http://127.0.0.1:42002/' };
  const contexts = [a, b];
  const { allowed, diagnosed, headers } = session(contexts);
  const fa = frame(31), fb = frame(32);
  assert.equal(allowed(navigate(a.preview.url, fa)), true);
  assert.equal(allowed(navigate(b.externalPreview, fb)), true, 'en anden ramme bindes til sit eget arbejdsområde');
  // Projekt A starter sin udviklingsserver: rammen viser endnu den statiske side, og appen navigerer den til serveren.
  a.preview = null; a.externalPreview = 'http://127.0.0.1:43003/';
  assert.equal(allowed(navigate(a.externalPreview, frame(31, 'aura-preview://projekt-a/'))), true);
  // ↻ og siden selv inden for sin egen adresse.
  assert.equal(allowed({ url: a.externalPreview + 'om', resourceType: 'subFrame', initiatorOrigin: 'http://127.0.0.1:43003', frame: frame(31, a.externalPreview) }), true);
  // Underressourcer afgøres som før af sidens egen origin.
  assert.equal(allowed({ url: 'http://127.0.0.1:43003/app.js', resourceType: 'script', initiatorOrigin: 'http://127.0.0.1:43003', frame: frame(31, a.externalPreview) }), true);
  assert.equal(diagnosed.length, 0);
  // Indholdspolitikken for A's dokument hører til A.
  const answer = await headers(navigate(a.externalPreview, frame(31, a.externalPreview)));
  assert.match(String(answer.responseHeaders['Content-Security-Policy']), /frame-src 'none'/);
});

test('en ramme, hvis arbejdsområde er lukket, afvises uden at falde tilbage på måladressen', () => {
  const a = { key: 'projekt-a', root: '/a', externalPreview: 'http://127.0.0.1:44004/' };
  const b = { key: 'projekt-b', root: '/b', externalPreview: 'http://127.0.0.1:45005/' };
  const contexts = [a, b];
  const { allowed } = session(contexts);
  const f = frame(41);
  assert.equal(allowed(navigate(a.externalPreview, f)), true);
  contexts.splice(0, 1);
  assert.equal(allowed(navigate(b.externalPreview, f)), false);
});

test('en ramme uden id eller med et id, der ikke kan læses, følger de hidtidige regler uden at fejle', () => {
  const a = { key: 'projekt-a', root: '/a', externalPreview: 'http://127.0.0.1:46006/' };
  const { allowed } = session([a]);
  const broken = { get frameTreeNodeId() { throw Error('Render frame was disposed'); }, url: 'about:blank', parent: { url: app } };
  assert.equal(allowed(navigate(a.externalPreview, broken)), true);
  assert.equal(allowed(navigate(a.externalPreview, { url: 'about:blank', parent: { url: app } })), true);
});

test('et link til et andet websted, som appens frame-src stopper, giver en forklaring i almindeligt dansk', () => {
  const ny = previewSession.diagnosticForFrameBlock({ message: "Framing 'https://www.borger.dk/' violates the following Content Security Policy directive: \"frame-src aura-preview: http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*\". The request has been blocked." });
  assert.equal(ny.kind, 'navigation'); assert.equal(ny.origin, 'https://www.borger.dk');
  assert.match(ny.message, /Forhåndsvisningen kan ikke vise https:\/\/www\.borger\.dk\. Den viser kun dit projekt på dets egen adresse\. Tryk ↻/);
  const gammel = previewSession.diagnosticForFrameBlock({ message: "Refused to frame 'http://[::1]:5173/' because it violates the following Content Security Policy directive: \"frame-src aura-preview:\"." });
  assert.equal(gammel.origin, 'http://[::1]:5173');
  for (const message of ["Framing 'https://x.dk/' as a fenced frame violates the following Content Security Policy directive: \"fenced-frame-src 'none'\".", "Loading the image 'https://x.dk/a.png' violates the following Content Security Policy directive: \"img-src 'self'\".", ''])
    assert.equal(previewSession.diagnosticForFrameBlock({ message }), null, message);
});

test('main.cjs viser frame-src-blokeringen for den forhåndsvisning, brugeren ser', async t => {
  const root = await tempDir(t, 'aura-c1-frame-src-');
  const events = [], ctx = { root, owner: { project: { root } }, key: 'projekt-a', externalPreview: 'http://127.0.0.1:47007/' };
  const spaces = new Map([[root, ctx]]);
  let listener;
  const deps = {
    window: { webContents: { on: (name, handler) => { if (name === 'console-message') listener = handler; } } },
    previewSession, spaces, spaceFor: (value = root) => spaces.get(value), sendEvent: event => events.push(event),
    previewLog: { documents: [], errors: [] }, previewOrigin: () => ctx.externalPreview, remember: (list, entry) => list.push(entry),
    require: desktopRequire, uiURL: app
  };
  load([cut('function previewAllowed(url)', 'function previewDiagnostic('), cut('function previewDiagnostic(ctx, diagnostic) {', 'function configurePreviewSession('), cut("window.webContents.on('console-message'", '// Genindlæses forhåndsvisningen i ændringstilstand')], deps);
  listener({ level: 'error', message: "Framing 'https://www.borger.dk/' violates the following Content Security Policy directive: \"frame-src aura-preview:\". The request has been blocked.", frame: { url: app }, sourceId: '', lineNumber: 0 });
  const event = events.find(item => item.type === 'preview.diagnostic');
  assert.ok(event, 'forklaringen sendes til brugerfladen');
  assert.equal(event.workspaceRoot, root); assert.equal(event.diagnostic.kind, 'navigation');
  // Appens egne fejl i konsollen tælles ikke som forhåndsvisningens.
  assert.equal(deps.previewLog.errors.length, 0);
});

test('brugerfladen viser forklaringen uden Ret med AI og fjerner den efter ↻', () => {
  const view = serverUI();
  view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'idle', project: { kind: 'static', supported: false, installed: true, reason: '', diagnostics: [] } });
  view.emit({ type: 'preview.diagnostic', root: '/projekt', workspaceRoot: '/projekt', diagnostic: { kind: 'navigation', origin: 'https://www.borger.dk', message: 'Forhåndsvisningen kan ikke vise https://www.borger.dk. Den viser kun dit projekt på dets egen adresse. Tryk ↻ for at hente din side igen.', repair: '' } });
  assert.equal(view.find('Gennemgå forhåndsvisning').hidden, false, 'Aura viser, at der er en forklaring');
  const repair = view.created.filter(el => el.textContent === 'Ret med AI' && el.id !== 'server-repair').at(-1);
  assert.ok(repair, 'forklaringen står i dialogen');
  assert.equal(repair.hidden, true, 'ingen rettelse at sende til AI’en');
  view.$('#refresh').click();
  assert.equal(view.find('Gennemgå forhåndsvisning').hidden, true, 'efter ↻ er forklaringen væk');
});
