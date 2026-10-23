const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChatSession } = require('../core/chat-session.cjs');

const question = { question: 'Hvem skal bruge siden?', header: 'Brugere', options: [] };
const answer = { id: 'q1', answers: [['Kun personalet']] };
function fixture(t, request = async () => true) {
  const entries = new Map(), events = [], calls = [], saved = [];
  const bench = {
    project: { root: '/syntetisk-projekt' }, brief: { items: [] }, chatsChanged() {}, release() {},
    emit(event) { events.push(event); },
    changesFor() { return { activity: { put(entry) { const value = { ...entries.get(entry.id), ...entry }; entries.set(entry.id, value); return value; }, get: id => entries.get(id), list: () => [...entries.values()] } }; },
    async storeBrief(value) { saved.push(value); this.brief = value; }
  };
  const chat = new ChatSession(bench, { id: 'chat-1' }, bench.project.root);
  Object.assign(chat, { running: true, generation: 1, runMode: 'plan', saveHistory: async () => {} });
  chat.engine = { session: { id: 'session-1' }, request: async (...args) => { calls.push(args); return request(...args); }, abort: async () => {}, close: async () => {} };
  const ask = (id = 'q1') => chat.event({ type: 'question.asked', properties: { id, sessionID: chat.engine.session.id, questions: [question] } });
  t.after(() => clearTimeout(chat.historyTimer));
  return { chat, bench, ask, entries, events, calls, saved };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('udløbne, ukendte og afsluttende spørgsmål sendes ikke til motoren', async t => {
  for (const state of [{ runStopped: true }, { running: false }, { finishing: Promise.resolve() }, { questions: new Map() }]) {
    const f = fixture(t); f.ask(); Object.assign(f.chat, state);
    await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
    assert.equal(f.calls.length, 0); assert.equal(f.saved.length, 0);
  }
});

test('et dobbeltklik kan kun sende ét svar, også før motoren kvitterer', async t => {
  const pending = deferred(), f = fixture(t, () => pending.promise); f.ask();
  const first = f.chat.question(answer);
  const second = f.chat.question(answer);
  pending.resolve(true);
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /ikke længere aktuelt/);
  assert.equal(f.calls.length, 1); assert.equal(f.saved.length, 1);
  assert.equal(f.chat.planConversation.length, 1);
  await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
  assert.equal(f.calls.length, 1);
});

test('en gentaget spørgehændelse ophæver ikke et svar, der allerede er ved at blive sendt', async t => {
  const pending = deferred(), f = fixture(t, () => pending.promise); f.ask();
  const first = f.chat.question(answer); f.ask();
  const second = f.chat.question(answer); pending.resolve(true);
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(f.calls.length, 1); assert.equal(f.saved.length, 1);
});

test('en gentaget hændelse kan ikke genåbne et allerede besvaret eller afvist spørgsmåls-id', async t => {
  for (const settle of [f => f.chat.question(answer), async f => f.chat.event({ type: 'question.rejected', properties: { requestID: 'q1' } })]) {
    const f = fixture(t); f.ask(); await settle(f);
    const before = f.calls.length; f.ask();
    await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
    assert.equal(f.calls.length, before); assert.equal(f.chat.questions.size, 0);
  }
});

test('Stop under afsendelsen gemmer ikke det gamle svar i brief eller plan', async t => {
  const pending = deferred(), f = fixture(t, () => pending.promise); f.ask();
  f.chat.starting = true; // Den rigtige Stop-metode kan afprøves uden filarbejde.
  const reply = f.chat.question(answer);
  await f.chat.stop(); pending.resolve(true);
  await assert.rejects(reply, /ikke længere aktuelt/);
  assert.equal(f.saved.length, 0); assert.deepEqual(f.chat.planConversation, []);
  assert.equal(f.chat.questions.size, 0); assert.equal(f.entries.get('question-q1').status, 'expired');
});

test('et registreret spørgsmål tilhører præcis den motor, session og kørsel, der stillede det', async t => {
  for (const change of [chat => chat.generation++, chat => { chat.engine = { ...chat.engine }; }, chat => { chat.engine.session = { id: 'session-2' }; }]) {
    const f = fixture(t); f.ask(); change(f.chat);
    await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
    assert.equal(f.calls.length, 0); assert.equal(f.saved.length, 0);
  }
});

test('en sen kvittering kan ikke skrive i den næste kørsel eller en anden modelsession', async t => {
  for (const change of [chat => chat.generation++, chat => { chat.engine = { ...chat.engine }; }, chat => { chat.engine.session = { id: 'session-2' }; }]) {
    const pending = deferred(), f = fixture(t, () => pending.promise); f.ask();
    const reply = f.chat.question(answer); change(f.chat); pending.resolve(true);
    await assert.rejects(reply, /ikke længere aktuelt/);
    assert.equal(f.saved.length, 0); assert.deepEqual(f.chat.planConversation, []);
  }
});

test('en transportfejl tillader nyt forsøg med det samme stadig aktuelle spørgsmål', async t => {
  let attempts = 0;
  const f = fixture(t, async () => { if (++attempts === 1) throw new Error('Syntetisk transportfejl'); return true; }); f.ask();
  await assert.rejects(f.chat.question(answer), /Syntetisk transportfejl/);
  assert.equal(f.saved.length, 0); assert.deepEqual(f.chat.planConversation, []);
  assert.equal(await f.chat.question(answer), true);
  assert.equal(f.calls.length, 2); assert.equal(f.saved.length, 1); assert.equal(f.chat.planConversation.length, 1);
});

test('et fejlet svar genåbner ikke spørgsmålet efter Stop eller motorens afvisning', async t => {
  for (const expire of [async f => { f.chat.starting = true; await f.chat.stop(); }, async f => f.chat.event({ type: 'question.rejected', properties: { requestID: 'q1' } })]) {
    const pending = deferred(), f = fixture(t, () => pending.promise); f.ask();
    const reply = f.chat.question(answer); await expire(f); pending.reject(new Error('Syntetisk transportfejl'));
    await assert.rejects(reply, /Syntetisk transportfejl/);
    await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
    assert.equal(f.calls.length, 1); assert.equal(f.saved.length, 0);
  }
});

test('motorens kvittering under afsendelsen bevarer det ene accepterede svar', async t => {
  let f; f = fixture(t, async () => { f.chat.event({ type: 'question.replied', properties: { requestID: 'q1' } }); return true; }); f.ask();
  await f.chat.question(answer);
  assert.equal(f.chat.questions.size, 0); assert.equal(f.saved.length, 1); assert.equal(f.chat.planConversation.length, 1);
  await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/); assert.equal(f.calls.length, 1);
});

test('afviste spørgsmål udløber uden at fjerne andre spørgsmål eller værktøjsgodkendelser', async t => {
  const f = fixture(t); f.ask(); f.ask('q2');
  f.chat.approvals.set('approval-1', { marker: 'bevar' });
  f.chat.event({ type: 'question.rejected', properties: { requestID: 'q1' } });
  assert.equal(f.chat.questions.has('q1'), false); assert.equal(f.chat.questions.has('q2'), true); assert.equal(f.chat.waiting, true);
  assert.deepEqual(f.chat.approvals.get('approval-1'), { marker: 'bevar' });
  await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/); assert.equal(f.calls.length, 0);
});

test('sene eller fremmede spørgsmål kan ikke genåbne en stoppet eller inaktiv kørsel', t => {
  for (const state of [{ running: false }, { runStopped: true }, { finishing: Promise.resolve() }]) {
    const f = fixture(t); Object.assign(f.chat, state); f.ask();
    assert.equal(f.chat.questions.size, 0); assert.equal(f.events.some(event => event.type === 'question.asked'), false);
  }
  const f = fixture(t);
  f.chat.event({ type: 'question.asked', properties: { id: 'q1', sessionID: 'fremmed-session', questions: [question] } });
  assert.equal(f.chat.questions.size, 0);
});

test('en ny forberedt kørsel rydder gamle spørgsmål, før asynkront opstartsarbejde', async t => {
  const f = fixture(t), pending = deferred(); f.ask(); f.chat.running = false;
  f.bench.connectionRemovals = new Set(); f.bench.pendingImage = pending.promise;
  f.chat.prepared = { root: f.chat.root, connection: { id: 'lokal', kind: 'ollama', baseURL: 'http://127.0.0.1:1' }, context: {}, disclosure: { fingerprint: 'syntetisk' } };
  const run = f.chat.sendPrepared({ text: 'Ny opgave', fingerprint: 'syntetisk' });
  assert.equal(f.chat.questions.size, 0);
  f.chat.generation++; pending.resolve();
  await assert.rejects(run, /stoppet før afsendelse/);
  assert.equal(f.calls.length, 0);
});

test('afslutning og lukning udløber spørgsmål, også før oprydningen er færdig', async t => {
  const f = fixture(t); f.ask(); f.chat.event({ type: 'session.idle' });
  assert.equal(f.chat.questions.size, 0);
  await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
  await f.chat.finishing;
  const g = fixture(t); g.ask(); await g.chat.close(false);
  assert.equal(g.chat.questions.size, 0); assert.equal(g.calls.length, 0);
});

test('Spring over svarer som før uden at ændre brief, planvalg eller værktøjstilladelser', async t => {
  const f = fixture(t); f.ask();
  const plan = f.chat.plan = { id: 'plan-1', text: 'Den godkendte plan' };
  f.chat.approvals.set('approval-1', { marker: 'bevar' });
  await f.chat.question({ id: 'q1', skip: true });
  assert.match(f.calls[0][2].answers[0][0], /^Brugeren springer over:/);
  assert.equal(f.saved.length, 0); assert.equal(f.chat.plan, plan); assert.equal(f.chat.allowProjectEdits, false);
  assert.deepEqual(f.chat.approvals.get('approval-1'), { marker: 'bevar' });
  assert.equal(f.chat.waiting, true, 'den eksisterende værktøjsgodkendelse venter stadig');
});

test('ugyldige svar bruger ikke spørgsmålet, og en mislykket briefgemning genafsender ikke svaret', async t => {
  const f = fixture(t); f.ask();
  await assert.rejects(f.chat.question({ id: 'q1', answers: [[42]] }), /Ugyldigt svar/);
  assert.equal(f.calls.length, 0);
  f.bench.storeBrief = async () => { throw new Error('Syntetisk skrivefejl'); };
  await f.chat.question(answer);
  assert.equal(f.events.findLast(event => event.type === 'history.error').message, 'Svaret er sendt, men briefen kunne ikke gemmes.');
  await assert.rejects(f.chat.question(answer), /ikke længere aktuelt/);
  assert.equal(f.calls.length, 1);
});
