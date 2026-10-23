const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ChatDisplay = require('../ui/chat-display.js');

// Exercise the shipped status/controller functions, as composer-actions.test.cjs does for submit.
// Layout, animation and system accessibility preferences are covered by the Electron verification.
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const status = source.slice(source.indexOf('function setStatusDetail('), source.indexOf("$('#agent-activity-jump').onclick"));
const running = source.slice(source.indexOf('function setRunning('), source.indexOf('function showSkill('));

function makeView(id) {
  return { id, running: false, waitingFor: [], runStartedAt: 0, lastSignalAt: 0, receivedChars: 0,
    runLabel: 'Klar', statusDetail: '', modelProgress: null, plan: { id: `plan-${id}` } };
}

function fixture() {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, { value: '', checked: false, hidden: false, disabled: false,
        textContent: '', dataset: {}, attributes: {},
        classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
        setAttribute(name, value) { this.attributes[name] = value; } });
    }
    return elements.get(selector);
  };
  const active = makeView('active'), views = new Map([[active.id, active]]);
  const calls = { liveWork: 0, sidebar: 0, model: 0 };
  const context = { $, view: active, views, running: false, projectLoading: false, runTimer: null,
    recovery: '', current: { root: '/project' }, activePlan: active.plan,
    acceptedFingerprint: 'accepted-model-and-material', pendingSend: null,
    Date: class extends Date { static now() { return 20000; } },
    clearInterval() {}, setInterval: () => 1, elapsedText: ms => `${Math.floor(ms / 1000)} s`,
    anyRunning: () => [...views.values()].some(view => view.running),
    updateModelSummary() { calls.model++; }, setupControls() {}, showConnectionWarning() {},
    document: { querySelectorAll: () => [] },
    window: { ChatDisplay: { phase: ChatDisplay.phase, progress: view => ChatDisplay.progress(view, 20000) }, liveWork: { render() { calls.liveWork++; } },
      chats: { render() { calls.sidebar++; }, projects: () => [] }, previewEdit: { available() {} } } };
  $('#work-mode').value = 'plan';
  $('#prompt').value = 'Bevar min kladde og den godkendte plan.';
  vm.createContext(context);
  vm.runInContext(status + '\n' + running, context);
  return { $, context, calls, views,
    select(view) { context.view = view; context.running = view.running; context.applyRunning(); },
    state: () => $('#chat-form').dataset.metalState,
    busy: () => $('#chat-form').attributes['aria-busy'] };
}

test('en ledig samtale viser ingen arbejdsmarkering og bevarer status og kladde', () => {
  const f = fixture();
  f.$('#run-status').textContent = 'Klar';
  f.context.renderStatus();
  assert.equal(f.state(), 'idle'); assert.equal(f.busy(), 'false');
  assert.equal(f.$('#agent-activity').hidden, true);
  assert.equal(f.$('#run-status').textContent, 'Klar');
  assert.equal(f.$('#prompt').value, 'Bevar min kladde og den godkendte plan.');
});

test('en faktisk kørende opgave markerer skrivefeltet og bevarer den læsbare fremdrift', () => {
  const f = fixture();
  f.context.setRunning(true, 'Arbejder');
  f.context.view.modelProgress = { phase: 'text' };
  f.context.view.receivedChars = 230;
  f.context.renderStatus();
  assert.equal(f.state(), 'working'); assert.equal(f.busy(), 'true');
  assert.equal(f.$('#agent-activity').hidden, false);
  assert.equal(f.$('#agent-activity-text').textContent, 'AI’en skriver et svar …');
  assert.equal(f.$('#agent-progress').textContent, '230 tegn modtaget');
  assert.equal(f.$('#run-status').textContent, 'Arbejder 0 s');
  assert.equal(f.$('#stop').hidden, false); assert.equal(f.$('#send').disabled, true);
});

test('ventende godkendelser og spørgsmål dæmper arbejdet indtil alle er besvaret', () => {
  const f = fixture();
  f.context.setRunning(true, 'Arbejder');
  f.context.waitFor('permission', 'Godkend filændringen', { isConnected: true });
  f.context.waitFor('question', 'Vælg en mulighed', { isConnected: true });
  assert.equal(f.state(), 'waiting'); assert.equal(f.busy(), 'true');
  assert.equal(f.$('#agent-activity-text').textContent, 'Venter på dig: Godkend filændringen Og 1 mere.');
  assert.equal(f.$('#agent-activity').classList.contains('is-waiting'), true);
  assert.equal(f.$('#agent-activity-jump').hidden, false); assert.equal(f.$('#agent-progress').hidden, true);
  f.context.doneWaiting('permission');
  assert.equal(f.state(), 'waiting');
  assert.equal(f.$('#agent-activity-text').textContent, 'Venter på dig: Vælg en mulighed');
  f.context.doneWaiting('question');
  assert.equal(f.state(), 'working'); assert.equal(f.busy(), 'true');
  assert.equal(f.$('#agent-activity').classList.contains('is-waiting'), false);
  assert.equal(f.$('#agent-activity-jump').hidden, true); assert.equal(f.$('#agent-progress').hidden, false);
});

test('afslutning, stop og fejl fjerner markeringen uden at fjerne kladden eller planen', () => {
  for (const outcome of ['Færdig', 'Stoppet', 'Fejl']) {
    const f = fixture(), plan = f.context.activePlan;
    f.context.setRunning(true, 'Arbejder');
    f.context.waitFor('permission', 'Godkend filændringen', {});
    f.context.setRunning(false, outcome);
    assert.equal(f.state(), 'idle', outcome); assert.equal(f.busy(), 'false', outcome);
    assert.equal(f.context.view.waitingFor.length, 0, outcome);
    assert.equal(f.$('#run-status').textContent, outcome);
    assert.equal(f.$('#stop').hidden, true); assert.equal(f.$('#send').disabled, false);
    assert.equal(f.$('#prompt').value, 'Bevar min kladde og den godkendte plan.');
    assert.equal(f.context.activePlan, plan);
  }
});

test('en gammel ventende godkendelse giver ikke en ledig samtale arbejdsmarkering', () => {
  const f = fixture();
  f.context.view.waitingFor = [{ id: 'old', title: 'Tidligere godkendelse' }];
  f.context.renderStatus();
  assert.equal(f.state(), 'idle'); assert.equal(f.busy(), 'false');
  assert.equal(f.$('#agent-activity').hidden, true);
  assert.equal(f.$('#agent-activity').classList.contains('is-waiting'), false);
});

test('en baggrundsopgave overtager ikke skrivefeltet i en anden samtale', () => {
  const f = fixture(), first = f.context.view, second = makeView('second');
  f.views.set(second.id, second);
  f.context.setRunning(true, 'Arbejder', first);
  f.select(second);
  assert.equal(first.running, true); assert.equal(f.state(), 'idle'); assert.equal(f.busy(), 'false');
  f.context.waitFor('permission', 'Godkend i den første samtale', {}, first);
  assert.equal(f.state(), 'idle'); assert.equal(f.$('#stop').hidden, true);
  f.select(first);
  assert.equal(f.state(), 'waiting'); assert.equal(f.busy(), 'true');
  assert.equal(f.$('#run-status').textContent, 'Venter på dig');
  f.context.doneWaiting('permission', first);
  assert.equal(f.state(), 'working');
  f.select(second);
  f.context.setRunning(false, 'Færdig', first);
  assert.equal(f.state(), 'idle'); assert.equal(f.context.view, second);
  f.select(first);
  assert.equal(f.state(), 'idle'); assert.equal(f.$('#run-status').textContent, 'Færdig');
});

test('statusvisningen ændrer ingen samtale, plan, samtykke, værktøjsgodkendelse eller brugerinput', () => {
  const f = fixture();
  const permission = Object.freeze({ id: 'permission', title: 'Godkend filændringen', element: Object.freeze({ isConnected: true }) });
  const pending = Object.freeze({ text: 'Min besked', fingerprint: 'materiale' });
  const plan = Object.freeze(f.context.activePlan);
  Object.assign(f.context.view, { running: true, waitingFor: Object.freeze([permission]), runStartedAt: 10000, lastSignalAt: 10000 });
  const active = Object.freeze(f.context.view);
  f.context.pendingSend = pending;
  f.$('#work-mode').value = 'build'; f.$('#include-history').checked = true;
  f.$('#plan-card').hidden = false;
  f.context.renderStatus(); f.context.renderStatus();
  assert.equal(f.state(), 'waiting'); assert.equal(f.calls.liveWork, 2);
  assert.equal(f.context.view, active); assert.equal(f.context.activePlan, plan);
  assert.equal(f.context.view.waitingFor[0], permission); assert.equal(f.context.pendingSend, pending);
  assert.equal(f.context.acceptedFingerprint, 'accepted-model-and-material');
  assert.equal(f.$('#prompt').value, 'Bevar min kladde og den godkendte plan.');
  assert.equal(f.$('#work-mode').value, 'build'); assert.equal(f.$('#include-history').checked, true);
  assert.equal(f.$('#plan-card').hidden, false);
  assert.equal(f.calls.model, 0); assert.equal(f.calls.sidebar, 0);
});
