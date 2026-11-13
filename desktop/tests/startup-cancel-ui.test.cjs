const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const sendSource = source.slice(source.indexOf('async function sendNow('), source.indexOf('// Under en opgave viser statusfeltet'));
const stopAt = source.indexOf("$('#stop').onclick");
const stopSource = source.slice(stopAt, source.indexOf('\n', stopAt));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('afsendelsen blev ikke afbrudt')), 250); })]); }
  finally { clearTimeout(timer); }
}

function fixture({ draft = async () => {}, send = async () => {}, stop = async () => {} } = {}) {
  const elements = new Map(), calls = [], statuses = [], drafts = [], reviews = [];
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', textContent: '', hidden: false, open: false, disabled: false, close() { this.open = false; } });
    return elements.get(selector);
  };
  const context = {
    $, view: { id: 'chat-a', submitting: false }, owner: { root: '/project-a', chat: 'chat-a' }, running: false,
    state: { connections: [{ id: 'c', kind: 'compatible' }] }, acceptedFingerprint: null, activePlan: null,
    selectedOwner: () => context.owner, renderHistoryControls() {}, appendMessage() {},
    setRunning(value, status, view = context.view) {
      view.running = value; statuses.push({ view: view.id, value, status });
      if (view === context.view) { context.running = value; $('#stop').hidden = !value; $('#send').disabled = value || view.submitting; }
    },
    saveChatDraft() { drafts.push({ text: $('#prompt').value, mode: $('#work-mode').value }); return draft(); },
    call: async (method, input, owner) => { calls.push({ method, input, owner }); return method === 'send' ? send() : stop(); },
    action: fn => fn(), reviewKey: data => data.fingerprint,
    renderRunReview: review => reviews.push(review),
    window: { workspace: { target: () => null, clearReferences() {} } }
  };
  $('#work-mode').value = 'free'; $('#connection-select').value = 'c'; $('#model-select').value = 'model'; $('#route-row').hidden = true;
  vm.createContext(context); vm.runInContext(sendSource + '\n' + stopSource, context);
  return { context, $, calls, statuses, drafts, reviews, send: () => context.sendNow({ fingerprint: 'f', contextBinding: 'b' }, 'Byg siden'), stop: () => $('#stop').onclick() };
}

test('Stop mens kladden gemmes afbryder før send-IPC og et sent kladdesvar starter ikke opgaven', async t => {
  const saved = deferred(); t.after(() => saved.resolve());
  const f = fixture({ draft: () => saved.promise });
  const pending = f.send();
  assert.equal(f.context.running, true);
  assert.equal(f.calls.length, 0, 'der er endnu ingen opgave i hovedprocessen');
  await bounded(f.stop()); await bounded(pending);
  assert.equal(f.calls.length, 0, 'hverken send eller et Stop af en anden opgave må nå hovedprocessen');
  assert.equal(f.$('#prompt').value, 'Byg siden');
  assert.equal(f.drafts.at(-1).text, 'Byg siden');
  assert.equal(f.statuses.at(-1).status, 'Stoppet');
  assert.equal(f.$('#stop').hidden, true); assert.equal(f.$('#send').disabled, false);
  assert.deepEqual(f.reviews, []);
  saved.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0, 'det forsinkede kladdesvar kan ikke sende den stoppede besked');
  // En ny afsendelse bruger et nyt forsøg og er ikke låst af det gamle.
  await f.send(); assert.deepEqual(f.calls.map(call => call.method), ['send']);
});

test('normal afsendelse bevarer den gennemgåede besked og samtalens ejer', async () => {
  const f = fixture(); await f.send();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ method: 'send', input: { text: 'Byg siden', fingerprint: 'f', contextBinding: 'b', chat: 'chat-a', compact: false }, owner: { root: '/project-a', chat: 'chat-a' } }]);
  assert.equal(Boolean(f.context.view.sendOperation), false);
});

test('Stop efter kladdesvaret men før send-fortsættelsen sender heller ikke beskeden', async t => {
  const saved = deferred(); t.after(() => saved.resolve());
  const f = fixture({ draft: () => saved.promise }), pending = f.send();
  saved.resolve();
  await bounded(Promise.resolve().then(() => f.stop())); await bounded(pending);
  assert.equal(f.calls.length, 0, 'et allerede kølagt kladdesvar kan ikke overhale Stop');
  assert.equal(f.statuses.at(-1).status, 'Stoppet'); assert.equal(f.$('#prompt').value, 'Byg siden');
});

test('Stop efter send-IPC tilhører den afsendte samtale, også hvis den valgte ejer ændres', async t => {
  const sent = deferred(); t.after(() => sent.resolve());
  const f = fixture({ send: () => sent.promise, stop: () => sent.reject(Error('Opgaven blev stoppet før afsendelse.')) });
  const pending = f.send(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[0]?.method, 'send');
  f.context.owner = { root: '/project-b', chat: 'chat-b' };
  await f.stop(); await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1])), { method: 'stop', input: { chat: 'chat-a' }, owner: { root: '/project-a', chat: 'chat-a' } });
  assert.equal(f.statuses.at(-1).status, 'Stoppet'); assert.deepEqual(f.reviews, []);
});

test('et sent stop-svar fra en tidligere afsendelse kan ikke slukke en nyere opgave', async t => {
  const first = deferred(), second = deferred(); t.after(() => { first.resolve(); second.resolve(); });
  let number = 0;
  const f = fixture({ send: () => (++number === 1 ? first.promise : second.promise) });
  const old = f.send(); await new Promise(resolve => setImmediate(resolve));
  await f.stop();
  const current = f.send(); await new Promise(resolve => setImmediate(resolve));
  first.reject(Error('Opgaven blev stoppet før afsendelse.')); await old;
  assert.equal(f.context.running, true); assert.equal(f.statuses.at(-1).status, 'Starter agent …');
  second.resolve(); await current;
});
