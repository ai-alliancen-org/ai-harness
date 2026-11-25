// Beta 3-valg 4, bygget i beta 5: kommandoer uden sandkasse kunne læse motorens midlertidige nøgle i dens proces (ps eww på macOS,
// /proc/<pid>/environ på Linux), og forhåndsvisningens nøgle stod i en pluginfil i motorens mappe. Her kører den rigtige OpenCode (den
// låste version) gennem Auras gateway med en lokal falsk model og en lokal bro til forhåndsvisningen. Efter start må hverken motorens
// eller vagtprocessens startmiljø vise adgangskoden, gatewaynøglen eller forhåndsvisningens nøgle, og ingen fil i motorens mappe må
// indeholde dem. Motoren skal afvise kald uden adgangskode, modelkaldet skal stadig nå gatewayen med den rigtige nøgle (ellers afviser
// gatewayen det), og AI'ens kald af aura_preview skal nå broen med broens nøgle (ellers afviser broen det). Prøven kræver den forberedte
// runtime (npm run runtime:prepare); uden den springes den over. Intet forlader maskinen.
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
const previewBridge = require('../core/preview-bridge.cjs');

const binary = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'opencode', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
const real = { skip: process.platform === 'win32' || !require('node:fs').existsSync(binary) ? 'den forberedte OpenCode-runtime findes ikke' : false, timeout: 120_000 };

// Det, et andet program med brugerens rettigheder kan læse af en proces' startmiljø.
async function startEnvironment(pid) {
  if (process.platform === 'linux') return (await fs.readFile(`/proc/${pid}/environ`, 'latin1')).replace(/\0/g, '\n');
  return execFileSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf8' });
}
// Alle filer i en mappe, som et program med brugerens rettigheder kunne læse dem.
async function filesIn(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.push(path.join(entry.parentPath, entry.name));
  }
  return found;
}
function strøm(delta, slut) {
  const base = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'falsk', choices: [{ index: 0, delta, finish_reason: null }] };
  return 'data: ' + JSON.stringify(base) + '\n\n' + 'data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: slut }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n';
}
const svar = tekst => strøm({ role: 'assistant', content: tekst }, 'stop');
const værktøjskald = (navn, args) => strøm({ role: 'assistant', tool_calls: [{ index: 0, id: 'kald-1', type: 'function', function: { name: navn, arguments: JSON.stringify(args) } }] }, 'tool_calls');

test('efter start kan andre programmer ikke læse motorens tre nøgler, og modellen og forhåndsvisningens værktøj virker stadig', real, async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-motornoegler-'))); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'projekt'), motor = path.join(dir, 'motor'); await fs.mkdir(root);
  // Den falske model kalder først aura_preview og svarer så med tekst. Andre kald (fx titlen) får tekst.
  const modelkald = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}'); modelkald.push(body);
    const hoved = body.tools?.some(tool => tool.function?.name === 'aura_preview'), kaldt = (body.messages || []).some(m => m.role === 'assistant' && m.tool_calls?.length);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(hoved && !kaldt ? værktøjskald('aura_preview', { action: 'status' }) : svar('Hej.'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const broKald = [];
  const bro = await previewBridge.listen({ start: async () => { broKald.push('start'); return { state: 'running', url: 'http://localhost:5173/' }; }, status: async ({ root: sendt }) => { broKald.push(['status', sendt]); return { state: 'idle', url: null, message: 'BROENS-SVAR' }; } });
  t.after(() => bro.close());
  const forbindelse = { id: 'f', name: 'Lokal', kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, valgt = { id: 'falsk', name: 'falsk' };
  const gateway = await startGateway(forbindelse, valgt, '', null, () => {}); t.after(() => gateway.close());
  let afslut; const færdig = new Promise(resolve => { afslut = resolve; }); const hændelser = [];
  const engine = new OpenCodeEngine({ root, directory: motor, provider: connections.engineProvider(forbindelse, valgt, gateway.url, gateway.token), model: valgt, mode: 'free', sandbox: null, preview: { url: bro.url, token: bro.token, root }, onEvent: event => {
    hændelser.push(event.type);
    if (event.type === 'permission.asked') engine.reply(event.properties.id, true).catch(() => {});
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) afslut(event.type);
  } });
  t.after(() => engine.close());
  await engine.start();
  const password = Buffer.from(engine.auth.replace(/^Basic /, ''), 'base64').toString().split(':')[1];
  assert.ok(password && gateway.token && bro.token);
  const nøgler = [['adgangskoden', password], ['gatewaynøglen', gateway.token], ['forhåndsvisningens nøgle', bro.token]];
  for (const [navn, pid] of [['motorens', engine.enginePID], ['vagtprocessens', engine.child.pid]]) {
    assert.ok(Number.isInteger(pid), navn + ' PID');
    const miljø = await startEnvironment(pid);
    assert.match(miljø, /PATH=/, navn + ' startmiljø kunne læses');
    for (const [nøgle, værdi] of nøgler) assert.equal(miljø.includes(værdi), false, nøgle + ' står ikke i ' + navn + ' startmiljø');
  }
  const filer = await filesIn(motor);
  assert.ok(filer.some(file => file.endsWith(path.join('opencode', 'preview-tool.mjs'))), 'forhåndsvisningens plugin er skrevet');
  for (const file of filer) {
    const indhold = await fs.readFile(file, 'latin1');
    for (const [nøgle, værdi] of nøgler) assert.equal(indhold.includes(værdi), false, nøgle + ' står i ' + path.relative(motor, file));
  }
  assert.equal((await fetch(engine.url + '/config', { headers: { 'x-opencode-directory': encodeURIComponent(root) } })).status, 401, 'motoren kræver sin adgangskode');
  await engine.send('Se om forhåndsvisningen kører.', 'Prøve.');
  let vagt; const slutning = await Promise.race([færdig, new Promise(resolve => { vagt = setTimeout(() => resolve('hang'), 90_000); })]); clearTimeout(vagt);
  assert.equal(slutning, 'session.idle', JSON.stringify(hændelser.slice(-20)));
  assert.ok(modelkald.length >= 2, 'modelkaldene nåede gennem gatewayen');
  assert.deepEqual(broKald, [['status', root]], 'aura_preview nåede broen med broens nøgle');
  const resultat = modelkald.flatMap(body => (body.messages || []).filter(m => m.role === 'tool')).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  assert.match(resultat, /BROENS-SVAR/, 'modellen fik broens svar: ' + resultat.slice(0, 200));
});
