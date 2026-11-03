// Rigtig OpenCode og lokal modelserver. Beviser, at én motor og én session kan tjene alle arbejdsmåder: agenten vælges for hver besked,
// og tilladelserne følger agenten. Samtale og Planlæg kan ikke skrive, Byg kan, og motoren genstartes ikke imellem.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { OpenCodeEngine } = require('../core/engine.cjs');

(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-en-motor-')));
  const root = path.join(base, 'projekt'), directory = path.join(base, 'motor'); await fs.mkdir(root);
  const requests = []; let skrivning = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const main = body.tools?.length > 0 || body.messages?.some(m => m.role === 'tool');
    const lastUser = [...body.messages].reverse().find(m => m.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content);
    const afterUser = body.messages.slice(body.messages.findLastIndex(m => m.role === 'user') + 1);
    const done = afterUser.some(m => m.role === 'tool');
    const want = /SKRIV ([\w.-]+)/.exec(text)?.[1];
    const hasWrite = body.tools?.some(t => t.function?.name === 'write');
    const delta = main && want && !done && hasWrite ? { role: 'assistant', tool_calls: [{ index: 0, id: 'w-' + want, type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(root, want), content: 'indhold' }) } }] } : { role: 'assistant', content: 'Svar.' };
    res.setHeader('content-type', 'text/event-stream');
    const frame = { id: 'k', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }] };
    res.write('data: ' + JSON.stringify(frame) + '\n\n');
    res.end('data: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let finish; const next = () => new Promise(resolve => { finish = resolve; setTimeout(() => resolve('timeout'), 90000); });
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Lokal', options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'syntetisk' }, models: { m: { name: 'm', tool_call: true, limit: { context: 32768, output: 4096 } } } };
  const engine = new OpenCodeEngine({ root, directory, provider, model: { id: 'm' }, mode: 'free', references: [], skills: [], onEvent: event => {
    if (event.type === 'permission.asked') { skrivning++; engine.reply(event.properties.id, true).catch(() => {}); }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) finish?.(event.type);
  } });
  const sendAs = async (text, mode) => { const done = next(); await engine.send(text, 'Brug værktøjerne.', mode); return done; };
  try {
    await engine.start(); const session = engine.session.id, pid = engine.child.pid;
    assert.equal(await sendAs('SKRIV samtale.txt', 'chat'), 'session.idle');
    assert.equal(await fs.access(path.join(root, 'samtale.txt')).then(() => true, () => false), false, 'Samtale kan ikke skrive');
    assert.equal(await sendAs('SKRIV bygget.txt', 'build'), 'session.idle');
    assert.equal(await fs.readFile(path.join(root, 'bygget.txt'), 'utf8'), 'indhold');
    assert.equal(await sendAs('SKRIV plan.txt', 'plan'), 'session.idle');
    assert.equal(await fs.access(path.join(root, 'plan.txt')).then(() => true, () => false), false, 'Planlæg kan ikke skrive');
    assert.equal(engine.session.id, session, 'samme session'); assert.equal(engine.child.pid, pid, 'samme motorproces');
    const hasWrite = requests.map(r => r.tools?.some(t => t.function?.name === 'write'));
    console.log(JSON.stringify({ status: 'bestået', session, pid, skrivetilladelser: skrivning, kaldMedSkriveværktøj: hasWrite.filter(Boolean).length, kald: requests.length }, null, 1));
  } finally { await engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
