const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OpenCodeEngine, SUMMARIZE_TIMEOUT_MS } = require('../core/engine.cjs');

function engine(events = []) {
  const value = new OpenCodeEngine({ root: '/syntetisk', directory: '/syntetisk-data', model: { id: 'model-a' }, recovery: { delays: [1, 2, 3] }, onEvent: event => events.push(event) });
  value.active = true; value.session = { id: 'session-a' }; return value;
}
test('sammenfatning bruger modeltimeout og afventer idle efter HTTP-svaret', async () => {
  const events = [], value = engine(events); let signal, finished = false;
  value.request = async (url, method, body, supplied) => { assert.equal(url, '/session/session-a/summarize'); assert.equal(method, 'POST'); assert.equal(body.modelID, 'model-a'); signal = supplied; return 'sammenfattet'; };
  const pending = value.summarize().then(result => { finished = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false); assert.equal(signal.aborted, false); assert.ok(SUMMARIZE_TIMEOUT_MS > 15000);
  value.handleEvent({ type: 'session.idle', properties: { sessionID: 'anden-session' } });
  assert.equal(events.length, 0); assert.equal(finished, false);
  value.handleEvent({ type: 'session.idle', properties: { sessionID: 'session-a' } });
  assert.equal(await pending, 'sammenfattet'); assert.equal(events[0].compacting, true); assert.equal(value.compaction, null);
  value.handleEvent({ type: 'session.idle', properties: { sessionID: 'session-a' } });
  assert.equal(events[1].compacting, undefined);
});
test('sammenfatning afventer HTTP-svaret, selv om idle kommer først', async () => {
  const value = engine(); let release, finished = false;
  value.request = () => new Promise(resolve => { release = resolve; });
  const pending = value.summarize().then(() => { finished = true; });
  value.handleEvent({ type: 'session.idle' }); await Promise.resolve();
  assert.equal(finished, false); release(true); await pending; assert.equal(value.compaction, null);
});
test('fejl, lukning og manglende idle afslutter sammenfatningen uden hængende modelkald', async () => {
  for (const kind of ['error', 'close', 'timeout']) {
    const value = engine(); let signal;
    value.request = async (_url, _method, _body, supplied) => { signal = supplied; return true; };
    const pending = value.summarize({ timeout: kind === 'timeout' ? 10 : 1000 });
    const rejected = assert.rejects(pending, kind === 'error' ? /Syntetisk/ : kind === 'close' ? /stoppet/ : /lang tid/);
    if (kind === 'error') value.handleEvent({ type: 'session.error', properties: { error: { data: { message: 'Syntetisk fejl' } } } });
    if (kind === 'close') await value.close();
    await rejected; assert.equal(signal.aborted, true); assert.equal(value.compaction, null);
  }
});
test('serverens idle-status afslutter også en opgave uden separat idle-event', () => {
  const events = [], value = engine(events);
  value.handleEvent({ type: 'session.status', properties: { sessionID: 'session-a', status: { type: 'idle' } } });
  assert.equal(events.at(-1).type, 'session.idle');
});
test('en afsluttet SSE-strøm efter et færdigt svar giver en terminalfejl, ikke evig spinner', async t => {
  const events = [], value = engine(events); let aborted = false;
  const text = 'data: ' + JSON.stringify({ type: 'message.part.updated', properties: { sessionID: 'session-a', part: { type: 'text', text: 'Færdig – projektet er nu en Promte-app' } } }) + '\n\n';
  t.mock.method(globalThis, 'fetch', async () => new Response(text));
  value.abort = async () => { aborted = true; };
  await value.listen();
  assert.equal(events[0].properties.part.text, 'Færdig – projektet er nu en Promte-app');
  assert.equal(events.at(-1).type, 'engine.error'); assert.equal(aborted, true);
});
test('manglende idle bekræftes mod motorens status, og et gammelt svar afslutter aldrig næste opgave', async () => {
  const events = [], value = engine(events);
  value.handleEvent({ type: 'message.updated', properties: { info: { id: 'svar', role: 'assistant', time: { completed: 42 }, finish: 'stop' } } });
  const check = value.completionCheck;
  value.request = async () => ({ 'session-a': { type: 'busy' } });
  assert.equal(await value.verifyCompletion(check), false);
  value.request = async () => ({});
  assert.equal(await value.verifyCompletion(check), true);
  assert.equal(events.at(-1).type, 'session.idle'); assert.equal(events.at(-1).recovered, true);
  assert.equal(await value.verifyCompletion(check), false);
  value.handleEvent({ type: 'message.updated', properties: { info: { id: 'værktøj', role: 'assistant', time: { completed: 43 }, finish: 'tool-calls' } } });
  assert.equal(value.completionCheck, null); await value.close();
});
