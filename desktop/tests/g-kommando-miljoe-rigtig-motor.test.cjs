// RN:B1-2, skeptikerens fund efter G1 og G2: verify-multi-project.cjs kørte «kommandoen uden sandkasse» i en motor, der var startet med
// sandkassen, hvor env -i tømmer miljøet i forvejen. Vagten kunne derfor ikke fyre. Her kører den rigtige OpenCode (den låste version)
// gennem Auras gateway med en lokal falsk model og UDEN sandkasse. Modellen beder om en kommando, prøven godkender den én gang, og
// kommandoen skriver, om den kan se motorens opsætning (OPENCODE_CONFIG_CONTENT, med gatewayens midlertidige adgang) og motorens
// adgangskode (OPENCODE_SERVER_PASSWORD). PATH viser, at kommandoen har motorens øvrige miljø. Prøven kræver den forberedte runtime
// (npm run runtime:prepare); uden den springes den over. Intet forlader maskinen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeEngine } = require('../core/engine.cjs');
const { startGateway } = require('../core/gateway.cjs');
const connections = require('../core/connections.cjs');

const binary = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'opencode', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
const real = { skip: process.platform === 'win32' || !require('node:fs').existsSync(binary) ? 'den forberedte OpenCode-runtime findes ikke' : false, timeout: 120_000 };
const KOMMANDO = `printf '%s|%s|%s' "\${OPENCODE_CONFIG_CONTENT:+ja}" "\${OPENCODE_SERVER_PASSWORD:+ja}" "\${PATH:+ja}" > miljoe.txt`;

function ramme(delta, finish) {
  const base = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'falsk', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  return 'data: ' + JSON.stringify(base) + '\n\n' + 'data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n';
}
// Falsk model: første kald med værktøjer beder om kommandoen i projektet; når værktøjets svar er kommet, er den færdig.
async function falskModel(root) {
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (!Array.isArray(body.tools) || !body.tools.length) return res.end(ramme({ content: 'Prøve' }, 'stop'));
    if (body.messages.at(-1)?.role === 'tool') return res.end(ramme({ content: 'Kommandoen er kørt.' }, 'stop'));
    res.end(ramme({ tool_calls: [{ index: 0, id: 'miljoe', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: KOMMANDO, workdir: root, description: 'Skriver hvad kommandoen kan se i miljøet' }) } }] }, 'tool_calls'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('en kommando, der godkendes én gang uden sandkasse, arver hverken motorens opsætning eller adgangskode', real, async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kommando-miljoe-'))); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'projekt'); await fs.mkdir(root);
  const server = await falskModel(root); t.after(() => { server.closeAllConnections(); server.close(); });
  const forbindelse = { id: 'f', name: 'Lokal', kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, valgt = { id: 'falsk', name: 'falsk' };
  const gateway = await startGateway(forbindelse, valgt, '', null, () => {}); t.after(() => gateway.close());
  const godkendt = [], hændelser = []; let afslut; const færdig = new Promise(resolve => { afslut = resolve; });
  const engine = new OpenCodeEngine({ root, directory: path.join(dir, 'motor'), provider: connections.engineProvider(forbindelse, valgt, gateway.url, gateway.token), model: valgt, mode: 'free', sandbox: null, onEvent: event => {
    hændelser.push(event.type);
    if (event.type === 'permission.asked' && event.properties?.permission === 'bash') { godkendt.push(event.properties.id); engine.reply(event.properties.id, true).catch(afslut); }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) afslut(event.type);
  } });
  t.after(() => engine.close());
  await engine.start();
  assert.equal(engine.sandbox, null, 'motoren kører uden sandkasse');
  await engine.send('Skriv miljøet.', 'Prøve.');
  let vagt; const slutning = await Promise.race([færdig, new Promise(resolve => { vagt = setTimeout(() => resolve('hang'), 90_000); })]); clearTimeout(vagt);
  assert.equal(slutning, 'session.idle', JSON.stringify(hændelser.slice(-20)));
  assert.equal(godkendt.length, 1, 'kommandoen blev godkendt én gang af prøven');
  assert.equal(await fs.readFile(path.join(root, 'miljoe.txt'), 'utf8'), '||ja', 'OPENCODE_CONFIG_CONTENT og OPENCODE_SERVER_PASSWORD er tomme; PATH er der');
});
