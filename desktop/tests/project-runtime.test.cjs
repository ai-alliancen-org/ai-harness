const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeRuntimeConfig, detectServices } = require('../core/project-runtime.cjs');
const { DevServer, inspect } = require('../core/dev-server.cjs');
const { policyFor, allowedRequest, contentSecurityPolicy, blockedRequest } = require('../core/preview-policy.cjs');
const { runtimeGuidance } = require('../core/project-guidance.cjs');
const { installSession, staticPreview, diagnosticForConsole } = require('../core/preview-session.cjs');

async function fixture(t, files = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-runtime-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
  return root;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let n = 0; n < 150; n++) { if (await fn()) return; await wait(50); } throw Error('Tilstanden blev ikke nået.'); }

test('opstart og netadgang normaliseres uden shell, tværprojektstier eller brede tilladelser', () => {
  assert.deepEqual(normalizeRuntimeConfig(), { mode: 'auto' });
  const service = { id: 'web', label: 'App', command: ['node', 'server.cjs'], cwd: '.' };
  assert.deepEqual(normalizeRuntimeConfig({ services: [service] }).services, [service]);
  for (const command of [['sh', '-c', 'echo x'], ['cmd.exe', '/c', 'x'], ['npx', 'ukendt'], ['node', 'bad\narg']]) assert.throws(() => normalizeRuntimeConfig({ services: [{ ...service, command }] }));
  for (const cwd of ['../andet', '/tmp/andet', 'a/../../b']) assert.throws(() => normalizeRuntimeConfig({ services: [{ ...service, cwd }] }));
  for (const address of ['https://*.example.com', 'https://user:pass@example.com', 'https://example.com/private', 'http://example.com', 'file:///tmp/x']) assert.throws(() => normalizeRuntimeConfig({ network: { scripts: [address] } }));
  assert.deepEqual(normalizeRuntimeConfig({ network: { scripts: ['https://cdn.example.com/'] } }).network.scripts, ['https://cdn.example.com']);
  assert.match(runtimeGuidance({ mode: 'static' }), /Enkel hjemmeside/);
  assert.match(runtimeGuidance(), /React er ikke obligatorisk/);
});

test('Automatisk bevarer almindelig HTML og genkender npm, Python og eksplicitte tjenester uden at køre dem', async t => {
  const html = await fixture(t, { 'public/index.html': '<h1>Enkel side</h1>' });
  assert.equal((await inspect(html)).kind, 'static');
  const npm = await fixture(t, { 'package.json': JSON.stringify({ scripts: { dev: 'node app.cjs && echo slut' } }) });
  const found = await inspect(npm);
  assert.equal(found.kind, 'services'); assert.deepEqual(found.services[0].command, ['npm', 'run', 'dev']); assert.equal(found.services[0].declaredScript, 'node app.cjs && echo slut');
  assert.equal((await inspect(npm, { mode: 'static' })).kind, 'static');
  const python = await fixture(t, { 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n', 'requirements.txt': 'fastapi\nuvicorn\n' });
  const py = await inspect(python); assert.equal(py.installed, false); assert.equal(py.services[0].command[0], 'python3');
  assert.deepEqual(await fs.readdir(python), ['main.py', 'requirements.txt']);
  assert.deepEqual((await detectServices(python)).services[0].command.slice(-4), ['--host', '{host}', '--port', '{port}']);
});

test('en projektspecifik netregel åbner ikke andre projekter eller andre ressourcetyper', () => {
  const policy = policyFor({ origin: 'aura-preview://projekt-a/', serviceOrigins: ['http://127.0.0.1:41001'], network: { scripts: ['https://cdn.example.com'], connect: ['https://api.example.com', 'http://127.0.0.1:41002'] }, static: true });
  assert.equal(allowedRequest({ url: 'https://cdn.example.com/react.js', resourceType: 'script' }, policy), true);
  assert.equal(allowedRequest({ url: 'https://cdn.example.com/data', resourceType: 'xhr' }, policy), false);
  assert.equal(allowedRequest({ url: 'http://127.0.0.1:41001/data', resourceType: 'xhr' }, policy), true);
  assert.equal(allowedRequest({ url: 'http://127.0.0.1:41002/data', resourceType: 'xhr' }, policy), false);
  for (const address of ['https://127.0.0.2:41002', 'https://[::ffff:127.0.0.1]:41002', 'https://localhost.:41002']) {
    const isolated = policyFor({ origin: 'aura-preview://projekt-a/', network: { connect: [address] } });
    assert.equal(allowedRequest({ url: address + '/data', resourceType: 'xhr' }, isolated), false, 'loopback-varianter skal også tilhøre projektet');
  }
  assert.equal(allowedRequest({ url: 'aura-preview://projekt-b/index.html', resourceType: 'script' }, policy), false);
  assert.equal(allowedRequest({ url: 'aura-preview://projekt-a/_komplai/run/v1.js', resourceType: 'script' }, policy), true);
  assert.match(contentSecurityPolicy(policy), /sandbox allow-scripts allow-same-origin/);
  assert.match(contentSecurityPolicy(policy), /https:\/\/cdn\.example\.com/);
  const problem = blockedRequest({ url: 'https://cdn.example.com/react.js?private=hidden', resourceType: 'script' });
  assert.doesNotMatch(JSON.stringify(problem), /private|hidden/); assert.equal(problem.kind, 'scripts');
});

test('den rigtige sessions politik bruger initiatoren også ved omdirigering og afviser andre projekter', () => {
  const a = { key: 'projekt-a', root: '/a', runtimeConfig: { network: { scripts: ['https://cdn.example.com'] } } }, b = { key: 'projekt-b', root: '/b' };
  a.preview = staticPreview(a); b.preview = staticPreview(b);
  let before;
  const session = { protocol: { handle() {} }, webRequest: { onBeforeRequest(fn) { before = fn; }, onHeadersReceived() {} } }, denied = [];
  installSession(session, { contexts: () => [a, b], onDiagnostic: (ctx, value) => denied.push([ctx.key, value]) });
  const check = details => { let value; before(details, answer => { value = !answer.cancel; }); return value; };
  assert.equal(check({ url: a.preview.url, resourceType: 'subFrame', frame: { url: 'about:blank', parent: { url: 'harness://app/index.html' } }, initiatorOrigin: 'harness://app' }), true);
  assert.equal(check({ url: 'https://cdn.example.com/react.js', resourceType: 'script', initiatorOrigin: 'aura-preview://projekt-a', frame: { url: b.preview.url } }), true);
  assert.equal(check({ url: b.preview.url, resourceType: 'xhr', initiatorOrigin: 'aura-preview://projekt-a', frame: { url: b.preview.url } }), false);
  assert.equal(check({ url: 'harness://app/app.js', resourceType: 'script', initiatorOrigin: 'aura-preview://projekt-a' }), false);
  assert.equal(denied.length, 2);
  const csp = diagnosticForConsole({ message: 'Refused to load the script https://unpkg.com/react.js?secret=private because it violates the following Content Security Policy directive: "script-src self"' });
  assert.equal(csp.origin, 'https://unpkg.com'); assert.equal(csp.kind, 'scripts'); assert.doesNotMatch(JSON.stringify(csp), /secret|private/);
});

// Appen navigerer selv forhåndsvisningens ramme, fx når en lokal udviklingsserver tilkobles. Rammens URL er da
// stadig det FORRIGE dokument, så kun målet kan afgøre konteksten. Men en kendt frame-origin skal stadig vinde:
// ellers kan en omdirigering fra ét projekts server lægge et andet projekts lokale tjeneste i rammen, uden at
// siden behøver forfalske noget. Og kun forælderens URL må afgøre det; en referrer kan siden selv sætte.
test('appens egen navigation af forhåndsvisningen afgøres af målet, men en omdirigering skifter ikke projekt', () => {
  const app = 'harness://app/index.html';
  const session = () => { let before; const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(fn) { before = fn; }, onHeadersReceived() {} } }; return { ses, check: () => details => { let value; before(details, answer => { value = !answer.cancel; }); return value; } }; };
  const a = { key: 'projekt-a', root: '/a' }, b = { key: 'projekt-b', root: '/b' };
  a.preview = staticPreview(a); b.preview = staticPreview(b);
  // Som efter preview:attach: den statiske forhåndsvisning er ryddet, og en lokal server er tilsluttet.
  const ekstern = { key: 'projekt-c', root: '/c', preview: null, externalPreview: 'http://127.0.0.1:53982/preview' };
  const en = session();
  installSession(en.ses, { contexts: () => [a, b, ekstern], onDiagnostic: () => {} });
  const check = en.check();

  // Virker: rammen viser endnu den afregistrerede aura-preview-side, og appen navigerer den til den tilsluttede server.
  assert.equal(check({ url: ekstern.externalPreview, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: { url: 'aura-preview://projekt-c/', parent: { url: app } } }), true, 'tilkoblingen skal kunne vises');
  // Må IKKE virke: 302 fra projekt A til projekt B, mens rammen viser en registreret A-side.
  assert.equal(check({ url: b.preview.url, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: { url: a.preview.url, parent: { url: app } } }), false, 'en omdirigering må ikke skifte arbejdsområde');
  // Må IKKE virke: en påstået app-referrer uden forælder.
  assert.equal(check({ url: b.preview.url, resourceType: 'subFrame', initiatorOrigin: 'null', referrer: app, frame: { url: 'http://127.0.0.1:9999/' } }), false, 'kun forælderens URL må afgøre det');

  // Vejen tilbage: #static-preview rydder externalPreview og genskaber den statiske side, før rammen navigerer.
  const tilbage = { key: 'projekt-c', root: '/c', externalPreview: null };
  tilbage.preview = staticPreview(tilbage);
  const to = session();
  installSession(to.ses, { contexts: () => [a, b, tilbage], onDiagnostic: () => {} });
  assert.equal(to.check()({ url: tilbage.preview.url, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: { url: 'http://127.0.0.1:53982/preview', parent: { url: app } } }), true, 'tilbage til den statiske forhåndsvisning');
});

test('eksisterende CDN-HTML giver en konkret reparationskladde og respekterer den præcise netliste', async t => {
  const root = await fixture(t, { 'public/index.html': `<script src="https://unpkg.com/react@18/umd/react.js"></script><script src='https://unpkg.com/react-dom.js'></script><link rel="stylesheet" href="https://cdn.example.com/style.css">` });
  const found = await inspect(root); assert.equal(found.diagnostics.length, 2); assert.equal(found.diagnostics[0].origin, 'https://unpkg.com'); assert.match(found.diagnostics[0].repair, /Bevar/);
  const allowed = await inspect(root, { network: { scripts: ['https://unpkg.com'] } }); assert.equal(allowed.diagnostics.length, 1); assert.equal(allowed.diagnostics[0].kind, 'styles');
});

test('rigtige Node-tjenester starter først efter gennemgang, deler lokale adresser og stoppes sammen', async t => {
  const root = await fixture(t, {
    'web.cjs': `require('node:http').createServer(async(req,res)=>{res.end(req.url==='/api'?await (await fetch(process.env.AURA_SERVICE_DATA_URL)).text():'Frontenden virker')}).listen(Number(process.env.PORT),process.env.HOST);`,
    'data.cjs': `require('node:http').createServer((req,res)=>res.end('Rigtige lokale data')).listen(Number(process.env.PORT),process.env.HOST);`
  });
  const services = [{ id: 'web', label: 'Webside', command: ['node', 'web.cjs'] }, { id: 'data', label: 'Data', command: ['node', 'data.cjs'] }];
  const manager = new DevServer({ runtimeConfig: { services } }); t.after(() => manager.stop()); await manager.activate(root);
  assert.equal(manager.state, 'idle'); assert.equal(manager.children.length, 0);
  const review = await manager.prepare('start'); assert.match(review.command, /web.cjs/); assert.equal(manager.children.length, 0);
  await manager.execute(review.token); await until(() => manager.state === 'running' || manager.state === 'error');
  assert.equal(manager.state, 'running', manager.output + manager.message);
  const urls = manager.snapshot().services.map(s => s.url); assert.equal(urls.length, 2);
  assert.equal(await (await fetch(manager.url + 'api')).text(), 'Rigtige lokale data');
  assert.throws(() => manager.configure({ mode: 'static' }), /Stop/);
  await manager.stop(); assert.equal(manager.state, 'stopped');
  for (const url of urls) await assert.rejects(fetch(url));
});

test('ændret opstart afvises efter gennemgang og et manglende værktøj installeres aldrig', async t => {
  const root = await fixture(t, { 'web.cjs': 'throw Error("må ikke køre")' });
  let config = { services: [{ id: 'web', label: 'Webside', command: ['node', 'web.cjs'] }] };
  const manager = new DevServer({ getRuntimeConfig: async () => config }); t.after(() => manager.stop()); await manager.activate(root);
  const review = await manager.prepare('start'); config = { services: [{ id: 'web', label: 'Anden', command: ['node', 'andet.cjs'] }] };
  await assert.rejects(manager.execute(review.token), /opsætning er ændret/);
  config = { services: [{ id: 'web', label: 'Mangler', command: ['aura-program-findes-ikke'] }] };
  await assert.rejects(manager.prepare('start'), /blev ikke fundet/); assert.equal(manager.children.length, 0);
});

test('rigtig Python-standardserver bruger sin gennemgåede port uden pakkeinstallation', async t => {
  const root = await fixture(t, { 'index.html': '<h1>Python virker</h1>' });
  const config = { services: [{ id: 'web', label: 'Python', command: ['python3', '-m', 'http.server', '{port}', '--bind', '{host}'] }] };
  const manager = new DevServer({ runtimeConfig: config }); t.after(() => manager.stop()); await manager.activate(root);
  await manager.execute((await manager.prepare('start')).token); await until(() => manager.state === 'running' || manager.state === 'error');
  assert.equal(manager.state, 'running', manager.output + manager.message);
  assert.match(await (await fetch(manager.url)).text(), /Python virker/);
});
