// Beta 3-valg 4, bygget i beta 5: kommandoer uden sandkasse kunne læse motorens midlertidige nøgle i dens proces (ps eww på macOS,
// /proc/<pid>/environ på Linux). Her kører den rigtige OpenCode (den låste version) gennem Auras gateway med en lokal falsk model.
// Efter start må hverken motorens eller vagtprocessens startmiljø vise adgangskoden eller gatewaynøglen, motoren skal afvise kald
// uden adgangskode, og modelkaldet skal stadig nå gatewayen med den rigtige nøgle (ellers afviser gatewayen det). Prøven kræver den
// forberedte runtime (npm run runtime:prepare); uden den springes den over. Intet forlader maskinen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { OpenCodeEngine } = require('../core/engine.cjs');
const { startGateway } = require('../core/gateway.cjs');
const connections = require('../core/connections.cjs');

const binary = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'opencode', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
const real = { skip: process.platform === 'win32' || !require('node:fs').existsSync(binary) ? 'den forberedte OpenCode-runtime findes ikke' : false, timeout: 120_000 };

// Det, et andet program med brugerens rettigheder kan læse af en proces' startmiljø.
async function startEnvironment(pid) {
  if (process.platform === 'linux') return (await fs.readFile(`/proc/${pid}/environ`, 'latin1')).replace(/\0/g, '\n');
  return execFileSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf8' });
}
function svar(tekst) {
  const base = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'falsk', choices: [{ index: 0, delta: { role: 'assistant', content: tekst }, finish_reason: null }] };
  return 'data: ' + JSON.stringify(base) + '\n\n' + 'data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n';
}

test('efter start kan andre programmer ikke læse motorens adgangskode eller gatewaynøgle, og modellen svarer stadig', real, async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-motornoegler-'))); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'projekt'); await fs.mkdir(root);
  let modelkald = 0;
  const server = http.createServer(async (req, res) => { for await (const _ of req) { /* Kroppen bruges ikke. */ } modelkald++; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(svar('Hej.')); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const forbindelse = { id: 'f', name: 'Lokal', kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, valgt = { id: 'falsk', name: 'falsk' };
  const gateway = await startGateway(forbindelse, valgt, '', null, () => {}); t.after(() => gateway.close());
  let afslut; const færdig = new Promise(resolve => { afslut = resolve; }); const hændelser = [];
  const engine = new OpenCodeEngine({ root, directory: path.join(dir, 'motor'), provider: connections.engineProvider(forbindelse, valgt, gateway.url, gateway.token), model: valgt, mode: 'free', sandbox: null, onEvent: event => {
    hændelser.push(event.type);
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) afslut(event.type);
  } });
  t.after(() => engine.close());
  await engine.start();
  const password = Buffer.from(engine.auth.replace(/^Basic /, ''), 'base64').toString().split(':')[1];
  assert.ok(password && gateway.token);
  for (const [navn, pid] of [['motorens', engine.enginePID], ['vagtprocessens', engine.child.pid]]) {
    assert.ok(Number.isInteger(pid), navn + ' PID');
    const miljø = await startEnvironment(pid);
    assert.match(miljø, /PATH=/, navn + ' startmiljø kunne læses');
    assert.equal(miljø.includes(password), false, 'adgangskoden står ikke i ' + navn + ' startmiljø');
    assert.equal(miljø.includes(gateway.token), false, 'gatewaynøglen står ikke i ' + navn + ' startmiljø');
  }
  assert.equal((await fetch(engine.url + '/config', { headers: { 'x-opencode-directory': encodeURIComponent(root) } })).status, 401, 'motoren kræver sin adgangskode');
  await engine.send('Sig hej.', 'Prøve.');
  let vagt; const slutning = await Promise.race([færdig, new Promise(resolve => { vagt = setTimeout(() => resolve('hang'), 90_000); })]); clearTimeout(vagt);
  assert.equal(slutning, 'session.idle', JSON.stringify(hændelser.slice(-20)));
  assert.ok(modelkald >= 1, 'modelkaldet nåede gennem gatewayen');
});
