// Rigtig OpenCode, lokal modelserver og en lokal bro. Beviser, at modellen ser værktøjet aura_preview, kan kalde det, og at
// svaret fra Aura (url og tilstand) når tilbage til modellen. Ingen ekstern AI.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { OpenCodeEngine } = require('../core/engine.cjs');
const bridgeModule = require('../core/preview-bridge.cjs');

(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-forhaandsvisning-')));
  const root = path.join(base, 'projekt'), directory = path.join(base, 'motor'); await fs.mkdir(root);
  const calls = [];
  const bridge = await bridgeModule.listen({
    start: async ({ root: sent }) => { calls.push(['start', sent]); return { state: 'running', url: 'http://localhost:5173/', message: 'Forhåndsvisningen kører.' }; },
    status: async ({ root: sent }) => { calls.push(['status', sent]); return { state: 'running', url: 'http://localhost:5173/' }; }
  });
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const main = body.tools?.some(tool => tool.function?.name === 'read');
    const index = body.messages.filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
    const delta = main && index === 0 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fh-1', type: 'function', function: { name: 'aura_preview', arguments: JSON.stringify({ action: 'start' }) } }] } : { role: 'assistant', content: main ? 'Færdig.' : 'Prøve' };
    res.setHeader('content-type', 'text/event-stream');
    const frame = { id: 'k', object: 'chat.completion.chunk', created: 1, model: 'fm', choices: [{ index: 0, delta, finish_reason: null }] };
    res.write('data: ' + JSON.stringify(frame) + '\n\n');
    res.end('data: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: main && index === 0 ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let finish; const completed = new Promise(resolve => { finish = resolve; setTimeout(() => resolve('timeout'), 120000); });
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Lokal', options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'syntetisk' }, models: { fm: { name: 'fm', tool_call: true, limit: { context: 32768, output: 4096 } } } };
  const engine = new OpenCodeEngine({ root, directory, provider, model: { id: 'fm' }, mode: 'free', references: [], skills: [], preview: { url: bridge.url, token: bridge.token, root }, onEvent: event => {
    if (event.type === 'permission.asked') engine.reply(event.properties.id, true).catch(() => {});
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) finish(event.type);
  } });
  const asked = [];
  try {
    await engine.start(); await engine.send('Start forhåndsvisningen.', 'Brug værktøjerne.');
    assert.equal(await completed, 'session.idle');
    assert.ok(requests.some(r => r.tools?.some(tool => tool.function?.name === 'aura_preview')), 'modellen får værktøjet aura_preview: ' + JSON.stringify(requests.map(r => (r.tools || []).map(t => t.function?.name))));
    assert.deepEqual(calls, [['start', root]], 'broen blev kaldt én gang med projektets rod');
    const last = requests.filter(body => body.tools?.some(tool => tool.function?.name === 'read')).at(-1);
    const result = last.messages.filter(m => m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    assert.match(result, /http:\/\/localhost:5173\//); assert.match(result, /"state":"running"/);
    console.log(JSON.stringify({ status: 'bestået', tools: requests[0].tools.length, bro: calls, svar: result.slice(0, 160) }, null, 1));
  } finally { await engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
