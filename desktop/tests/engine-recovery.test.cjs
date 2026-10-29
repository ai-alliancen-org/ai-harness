const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeEngine } = require('../core/engine.cjs');
const { EngineEvents } = require('../core/engine-events.cjs');
const waitFor = async check => { for (let i = 0; i < 400; i++) { if (check()) return; await delay(5); } assert.fail('Recovery did not reach expected state'); };
const message = (text, done = false) => ({ info: { id: 'assistant-1', parentID: 'msg-current', sessionID: 'session-a', role: 'assistant', time: { ...(done ? { completed: 1 } : {}) }, ...(done ? { finish: 'stop' } : {}) }, parts: [{ id: 'text-1', messageID: 'assistant-1', sessionID: 'session-a', type: 'text', text }] });
const ask = { id: 'permission-1', sessionID: 'session-a', permission: 'edit', patterns: ['public/index.html'], metadata: {} };
async function fixture(t, options = {}) {
  const events = [], calls = [], streams = [];
  const state = { messages: [message('Before')], status: { 'session-a': { type: 'busy' } }, permissions: [ask], questions: [] };
  const server = http.createServer(async (req, res) => {
    calls.push({ method: req.method, url: req.url });
    if (req.url === '/event') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': ready\n\n'); streams.push(res); return; }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/session/session-a/abort') { state.status = {}; return res.end('true'); }
    const value = { '/permission': state.permissions, '/question': state.questions, '/session/status': state.status, '/session/session-a/message': state.messages }[req.url];
    if (value === undefined) { res.writeHead(404); return res.end('{}'); }
    res.end(JSON.stringify(value));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const engine = new OpenCodeEngine({ root: '/synthetic', model: { id: 'selected' }, onEvent: e => events.push(e), recovery: { delays: [5, 10, 15], idleLimit: 1000, ...options } });
  Object.assign(engine, { active: true, session: { id: 'session-a' }, url: `http://127.0.0.1:${server.address().port}`, auth: 'Basic test', promptID: 'msg-current', promptEpoch: 1 });
  const running = engine.listen(); await engine.eventStream.ready;
  t.after(async () => { await engine.close(); await running; server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const emit = event => streams.at(-1).write('data: ' + JSON.stringify(event) + '\n\n');
  return { engine, events, calls, streams, state, emit, running };
}
test('event loss reconnects the same session and restores missed text, tool, usage, question and permission without POST', async t => {
  const f = await fixture(t);
  f.emit({ type: 'permission.asked', properties: ask }); await waitFor(() => f.engine.pending.has(ask.id));
  const bound = f.engine.pending.get(ask.id);
  f.state.messages = [message('Whole recovered answer')];
  f.state.messages[0].parts.push({ id: 'tool-1', messageID: 'assistant-1', sessionID: 'session-a', type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: 'public/index.html' } } }, { id: 'usage-1', messageID: 'assistant-1', sessionID: 'session-a', type: 'step-finish', tokens: { input: 10, output: 4 } });
  f.state.questions = [{ id: 'question-1', sessionID: 'session-a', questions: [{ question: 'Choose?' }] }];
  f.streams[0].destroy(); await waitFor(() => f.events.some(e => e.type === 'engine.recovery' && e.recovery.phase === 'recovered'));
  assert.equal(f.engine.pending.get(ask.id), bound); assert.equal(f.events.filter(e => e.type === 'permission.asked').length, 1);
  assert.ok(f.events.some(e => e.type === 'question.asked')); assert.ok(f.events.some(e => e.properties?.part?.id === 'tool-1'));
  assert.equal(f.events.filter(e => e.properties?.part?.type === 'text').at(-1).properties.part.text, 'Whole recovered answer');
  assert.ok(f.calls.every(c => c.method === 'GET')); assert.equal(f.engine.session.id, 'session-a'); assert.equal(f.engine.active, true);
  // A delta overlapping the recovery snapshot is replaced by authoritative text.
  f.state.messages = [message('Whole recovered answer plus later text')];
  f.emit({ type: 'message.part.delta', properties: { sessionID: 'session-a', partID: 'text-1', field: 'text', delta: ' answer plus later text' } });
  await waitFor(() => f.events.some(e => e.properties?.part?.text === 'Whole recovered answer plus later text'));
  assert.equal(f.events.filter(e => e.type === 'message.part.delta').length, 0);
  assert.equal(f.events.some(e => e.type === 'engine.error'), false);
});
test('lost final events restore final text before authoritative completion; old history cannot end a new prompt', async t => {
  const f = await fixture(t); f.state.permissions = [];
  f.state.messages = [message('Done', true)]; f.state.status = {}; f.streams[0].destroy();
  await waitFor(() => f.events.some(e => e.type === 'session.idle'));
  const idle = f.events.findIndex(e => e.type === 'session.idle'), text = f.events.findIndex(e => e.properties?.part?.text === 'Done'); assert.ok(text >= 0 && text < idle);
  f.engine.cancelCompletionCheck(); f.events.length = 0; ++f.engine.promptEpoch; f.engine.promptID = 'msg-new';
  await f.engine.eventStream.reconcile(); assert.equal(f.events.some(e => e.type === 'session.idle'), false);
});
test('pending approval/question prevents completion even when status temporarily omits the session', async t => {
  const f = await fixture(t); f.state.messages = [message('Done', true)]; f.state.status = {};
  f.streams[0].destroy(); await waitFor(() => f.events.some(e => e.type === 'engine.recovery' && e.recovery.phase === 'recovered'));
  assert.equal(f.events.some(e => e.type === 'session.idle'), false); assert.equal(f.engine.pending.size, 1);
});
test('compaction after recovery waits for its own HTTP completion, not an old assistant snapshot', async t => {
  const f = await fixture(t); f.state.permissions = []; f.state.messages = [message('Old answer', true)]; f.state.status = {};
  f.streams[0].destroy(); await waitFor(() => f.events.some(e => e.type === 'engine.recovery' && e.recovery.phase === 'recovered'));
  const request = f.engine.request.bind(f.engine); let release, finished = false;
  f.engine.request = (url, ...args) => url.endsWith('/summarize') ? new Promise(resolve => { release = resolve; }) : request(url, ...args);
  const pending = f.engine.summarize({ timeout: 1000 }).then(result => { finished = true; return result; });
  await f.engine.eventStream.settle(); assert.equal(finished, false);
  const before = f.events.length;
  await f.engine.eventStream.deliver({ type: 'message.part.updated', properties: { part: { id: 'summary-step', sessionID: 'session-a', messageID: 'summary-assistant', type: 'step-finish', tokens: { input: 20, output: 5 } } } });
  assert.equal(f.events[before].compacting, true); assert.equal(f.events[before].properties.part.id, 'summary-step');
  release(true); assert.equal(await pending, true); assert.equal(f.engine.compaction, null);
  assert.equal(f.events.at(-1).type, 'session.idle'); assert.equal(f.events.at(-1).compacting, true);
});
test('silent event connection is detected and Stop cancels recovery', async t => {
  const f = await fixture(t, { idleLimit: 40, delays: [100, 100] });
  await waitFor(() => f.events.some(e => e.type === 'engine.recovery'));
  await f.engine.abort(); await f.running; await delay(140);
  assert.equal(f.streams.length, 1); assert.equal(f.events.some(e => e.type === 'engine.error'), false);
});
test('close rejects initial readiness so Stop during startup cannot leave send hanging', async () => {
  const engine = { active: true }, stream = new EngineEvents(engine);
  stream.close(); await assert.rejects(stream.ready, /lukket/);
});
test('lost prompt acknowledgement checks its unique ID and never resends the POST', async () => {
  const events = [], e = new OpenCodeEngine({ model: { id: 'selected' }, recovery: { delays: [1, 2] }, onEvent: v => events.push(v) });
  e.active = true; e.session = { id: 'session-a' }; let posted, count = 0;
  e.request = async (url, method, body) => {
    if (method === 'POST') { count++; posted = body; throw Error('lost acknowledgement'); }
    if (url.endsWith('/message')) return [{ info: { id: posted.messageID, role: 'user' } }];
    return { 'session-a': { type: 'busy' } };
  };
  await e.send('Do it once', 'approved rules'); assert.equal(count, 1); assert.match(posted.messageID, /^msg_[a-f0-9]{26}$/); assert.equal(posted.system, 'approved rules'); assert.equal(events.at(-1).recovery.phase, 'recovered');
});
test('unconfirmed prompt acknowledgement fails boundedly without a second POST', async () => {
  const e = new OpenCodeEngine({ model: { id: 'selected' }, recovery: { delays: [1, 2] } }); e.active = true; e.session = { id: 'session-a' }; let posts = 0;
  e.request = async (url, method) => { if (method === 'POST') { posts++; throw Error('uncertain'); } return url.endsWith('/message') ? [] : {}; };
  await assert.rejects(e.send('Do it once', 'rules'), /ikke igen automatisk/); assert.equal(posts, 1);
});


test('answered approvals cannot be resurrected by a stale recovery snapshot', async () => {
  const events = [], e = new OpenCodeEngine({ model: { id: 'selected' }, onEvent: v => events.push(v) });
  e.session = { id: 'session-a' }; e.handleEvent({ type: 'permission.asked', properties: ask });
  e.request = async () => true; await e.reply(ask.id, true);
  e.handleEvent({ type: 'permission.asked', recovered: true, properties: ask });
  assert.equal(e.pending.size, 0); assert.equal(events.filter(v => v.type === 'permission.asked').length, 1);
  e.handleEvent({ type: 'question.replied', properties: { sessionID: 'session-a', requestID: 'q' } });
  e.handleEvent({ type: 'question.asked', properties: { sessionID: 'session-a', id: 'q' } });
  assert.equal(e.pendingQuestions.size, 0);
});


test('late completion and replayed messages cannot finish the next run before its own answer', async () => {
  const events = [], e = new OpenCodeEngine({ model: { id: 'selected' }, onEvent: v => events.push(v) });
  e.active = true; e.session = { id: 'session-a' }; e.promptID = 'first';
  e.handleEvent({ type: 'message.updated', properties: { info: { id: 'a1', parentID: 'first', role: 'assistant' } } });
  e.handleEvent({ type: 'session.idle', properties: { sessionID: 'session-a' } });
  assert.equal(events.filter(x => x.type === 'session.idle').length, 1);
  // ChatSession has begun preparing another message, before engine.send executes.
  e.handleEvent({ type: 'message.updated', recovered: true, properties: { info: { id: 'a1', parentID: 'first', role: 'assistant', time: { completed: 1 }, finish: 'stop' } } });
  e.handleEvent({ type: 'session.idle', properties: { sessionID: 'session-a' } });
  assert.equal(events.length, 2); assert.equal(e.completionCheck, null);
  e.request = async () => null; await e.send('Next request', 'same rules');
  e.handleEvent({ type: 'message.updated', properties: { info: { id: 'a1', parentID: 'first', role: 'assistant' } } });
  e.handleEvent({ type: 'session.status', properties: { sessionID: 'session-a', status: { type: 'idle' } } });
  assert.equal(events.filter(x => x.type === 'session.idle').length, 1);
  e.handleEvent({ type: 'message.updated', properties: { info: { id: 'a2', parentID: e.promptID, role: 'assistant' } } });
  e.handleEvent({ type: 'session.status', properties: { sessionID: 'session-a', status: { type: 'idle' } } });
  assert.equal(events.filter(x => x.type === 'session.idle').length, 2); await e.close();
});


test('Stop invalidates a permission snapshot that was already in flight', async t => {
  const f = await fixture(t); let release;
  const request = f.engine.request.bind(f.engine);
  f.engine.request = (url, ...args) => {
    if (url === '/permission') return new Promise(resolve => { release = resolve; });
    if (url === '/question') return Promise.resolve([]);
    if (url.endsWith('/message')) return Promise.resolve(f.state.messages);
    if (url === '/session/status') return Promise.resolve(f.state.status);
    return request(url, ...args);
  };
  const pending = f.engine.eventStream.reconcile();
  await waitFor(() => Boolean(release)); await f.engine.abort(); release([ask]); await pending;
  assert.equal(f.engine.pending.size, 0);
  assert.equal(f.events.filter(e => e.type === 'permission.asked').length, 0);
});

test('closing recovery retains upstream cleanup of an orphaned engine process group', async t => {
  const calls = []; t.mock.method(process, 'kill', (pid, signal) => { calls.push([pid, signal]); return true; });
  const e = new OpenCodeEngine({ model: { id: 'selected' } });
  e.child = { exitCode: 0 }; e.enginePID = 123456; e.active = true;
  e.eventStream = new EngineEvents(e); const ready = assert.rejects(e.eventStream.ready, /lukket/);
  await e.close(); await ready;
  assert.deepEqual(calls, [[-123456, 'SIGKILL']]); assert.equal(e.active, false);
});


test('ACK reconciliation cannot retire newer permissions or questions delivered by the live stream', async t => {
  const f = await fixture(t); f.state.permissions = []; f.state.messages = [message('Done', true)]; f.state.status = {};
  let release;
  const request = f.engine.request.bind(f.engine);
  f.engine.request = (url, ...args) => {
    if (url === '/permission') return Promise.resolve([]);
    if (url === '/question') return new Promise(resolve => { release = resolve; });
    return request(url, ...args);
  };
  f.engine.eventStream.snapshotMode = true;
  const pending = f.engine.eventStream.reconcile();
  await waitFor(() => Boolean(release));
  f.emit({ type: 'permission.asked', properties: ask });
  f.emit({ type: 'question.asked', properties: { id: 'new-question', sessionID: 'session-a', questions: [] } });
  await waitFor(() => f.engine.pending.has(ask.id) && f.engine.pendingQuestions.has('new-question'));
  release([]); await pending;
  assert.equal(f.engine.pending.has(ask.id), true); assert.equal(f.engine.pendingQuestions.has('new-question'), true);
  assert.equal(f.engine.closedPermissions.has(ask.id), false); assert.equal(f.engine.closedQuestions.has('new-question'), false);
  assert.equal(f.events.some(e => ['permission.replied', 'question.replied', 'session.idle'].includes(e.type)), false);
  assert.ok(f.calls.every(c => c.method === 'GET'));
});

test('exhausted event reconnects stop once without sending another prompt or tool action', async t => {
  const f = await fixture(t, { idleLimit: 25, delays: [1, 2] });
  await waitFor(() => f.events.some(e => e.type === 'engine.error'));
  await f.running;
  assert.equal(f.streams.length, 3); assert.equal(f.engine.active, false); assert.equal(f.engine.pending.size, 0);
  assert.equal(f.events.filter(e => e.type === 'engine.error').length, 1);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET'), [{ method: 'POST', url: '/session/session-a/abort' }]);
});
