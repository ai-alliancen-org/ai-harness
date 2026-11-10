const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const handler = source.slice(source.indexOf('// Låsen tilhører samtalen'), source.indexOf("$('#stop').onclick"));
// Idéen som første besked: knappen, kortet med det ene spørgsmål og de to svar.
const ideaSource = source.slice(source.indexOf('function updateStartIdea()'), source.indexOf("$('#model-select').addEventListener('change', updateModelSummary)"));
function fixture() {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', checked: false, hidden: false, disabled: false, listeners: {}, focus() {}, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(selector);
  };
  const actions = [], prepared = [], sent = [], dataShown = [];
  let release;
  const context = { $, navigator: { platform: 'MacIntel' }, view: {}, current: { root: '/projekt' }, running: false, projectLoading: false, pendingSend: null, acceptedFingerprint: null, activePlan: null,
    state: { connections: [{ id: 'test' }] }, selectedOwner: () => ({ root: '/projekt', chat: 'samtale' }), action: fn => { const promise = fn(); actions.push(promise); return promise; },
    call: async (method, input, owner) => { prepared.push({ method, input, owner }); return new Promise(resolve => { release = resolve; }); },
    selection: () => ({ mode: $('#work-mode').value }),
    updateWorkMode() {}, saveChatDraft() {}, applyRunning() { $('#send').disabled = context.running; }, reviewKey: data => data.fingerprint,
    async sendNow(data, text) { sent.push({ data, text }); }, showData(data) { dataShown.push(data); }, showSetup() {}, openTaskSettings() {}, message() {}, connectionFailed() {},
    window: { ConversationMode: require('../ui/conversation-mode.js') } };
  $('#prompt').value = 'Forklar appen'; $('#work-mode').value = 'chat'; $('#connection-select').value = 'test'; $('#model-select').value = 'model'; $('#route-row').hidden = true;
  $('#chat-form').requestSubmit = () => $('#chat-form').onsubmit({ preventDefault() {} });
  vm.createContext(context); vm.runInContext(handler, context);
  return { context, $, actions, prepared, sent, dataShown, release: value => release(value), key: value => $('#prompt').listeners.keydown({ key: 'Enter', preventDefault() {}, ...value }) };
}
test('Enter sender, men Shift+Enter, IME, repeat og dobbelt-submit sender ikke', async () => {
  const f = fixture();
  for (const value of [{ isComposing: true }, { repeat: true }, { keyCode: 229 }, { shiftKey: true }, { key: 'Escape' }]) f.key(value);
  assert.equal(f.prepared.length, 0);
  f.$('#prompt').value = '   '; f.key({}); assert.equal(f.prepared.length, 0);
  f.$('#prompt').value = 'Forklar appen'; f.key({}); f.key({ ctrlKey: true }); f.$('#chat-form').requestSubmit();
  assert.equal(f.prepared.length, 1); assert.equal(f.context.view.submitting, true);
  f.release({ accepted: true }); await Promise.all(f.actions);
  assert.equal(f.sent.length, 1); assert.equal(f.context.view.submitting, false);
});
test('normal samtykkegennemgang bevares, og Annuller frigiver afsendelsen', async () => {
  const f = fixture(); f.key({ ctrlKey: true }); f.release({ accepted: false, fingerprint: 'nyt' }); await Promise.all(f.actions);
  assert.equal(f.sent.length, 0); assert.equal(f.dataShown.length, 1); assert.ok(f.context.pendingSend);
  f.key({ ctrlKey: true }); assert.equal(f.prepared.length, 1);
  f.$('#data-dialog').listeners.close(); f.key({ ctrlKey: true }); assert.equal(f.prepared.length, 2);
  f.release({ accepted: true }); await Promise.all(f.actions); assert.equal(f.sent.length, 1);
});
test('en klar egen byggebesked vælger Byg og bevarer samtalekonteksten, mens spørgsmål bliver i Samtale', async () => {
  for (const [text, mode, plan] of [['byg', 'free', null], ['byg planen', 'build', { id: 'plan' }], ['hvordan bygger vi?', 'chat', null]]) {
    const f = fixture(); f.$('#prompt').value = text; f.context.activePlan = plan; f.key({ metaKey: true });
    assert.equal(f.prepared[0].input.mode, mode);
    f.release({ accepted: true }); await Promise.all(f.actions);
  }
});
test('et sent prepare-svar fra en anden samtale sender aldrig i den nye', async () => {
  const f = fixture(); f.key({ metaKey: true }); const old = f.context.view; f.context.view = {};
  f.release({ accepted: true }); await Promise.all(f.actions);
  assert.equal(f.sent.length, 0); assert.equal(old.submitting, false);
});

test('projektidéen forberedes i Byg og bevarer brugerens udtrykkelige valg af Planlæg', () => {
  const f = fixture(); f.context.current.purpose = 'Byg en lille hjemmeside med en blomst'; f.context.featureOn = () => false;
  vm.runInContext(ideaSource, f.context);
  f.$('#prompt').value = ''; f.$('#start-idea').onclick();
  assert.equal(f.$('#work-mode').value, 'free'); assert.equal(f.$('#prompt').value, f.context.current.purpose); assert.equal(f.prepared.length, 0);
  // Uden planlægning er der intet at vælge imellem, og kortet står ikke.
  assert.equal(f.$('#idea-approach').hidden, true);
  f.$('#prompt').value = ''; f.context.view.modeChosen = true; f.$('#work-mode').value = 'plan'; f.$('#start-idea').onclick();
  assert.equal(f.$('#work-mode').value, 'plan'); assert.equal(f.prepared.length, 0);
});

test('idéen får ét spørgsmål, og først et svar flytter arbejdsmåden', () => {
  const prepare = () => {
    const f = fixture(); f.context.current.purpose = 'En oversigt over tre fiktive mødelokaler';
    f.context.featureOn = id => id === 'planlaegning';
    vm.runInContext(ideaSource, f.context);
    f.$('#prompt').value = ''; f.$('#start-idea').onclick();
    return f;
  };
  // Kortet står med spørgsmålet, og indtil der svares, bliver idéen i Byg.
  const planlaeg = prepare();
  assert.equal(planlaeg.$('#idea-approach').hidden, false); assert.equal(planlaeg.$('#work-mode').value, 'free');
  assert.equal(planlaeg.context.view.modeChosen, undefined); assert.equal(planlaeg.prepared.length, 0);
  planlaeg.$('#plan-idea-first').onclick();
  assert.equal(planlaeg.$('#work-mode').value, 'plan'); assert.equal(planlaeg.context.view.modeChosen, true);
  assert.equal(planlaeg.$('#idea-approach').hidden, true); assert.equal(planlaeg.prepared.length, 0);
  // Det andet svar bliver i Byg og lukker spørgsmålet på samme måde.
  const byg = prepare(); byg.$('#build-idea-now').onclick();
  assert.equal(byg.$('#work-mode').value, 'free'); assert.equal(byg.context.view.modeChosen, true);
  assert.equal(byg.$('#idea-approach').hidden, true);
  // Tømmes feltet, er spørgsmålet ovre, og et svar kan ikke gives under en opgave.
  const tomt = prepare(); tomt.$('#prompt').value = ''; tomt.context.updateIdeaApproach();
  assert.equal(tomt.$('#idea-approach').hidden, true);
  const koerer = prepare(); koerer.context.running = true; koerer.$('#plan-idea-first').onclick();
  assert.equal(koerer.$('#work-mode').value, 'free'); assert.equal(koerer.context.view.modeChosen, undefined);
});

// Samtalen følger med af sig selv: samme AI-session har den, og en ny får de seneste beskeder (kernen, Q:B1-2). Der er intet tilvalg at sætte.
test('manuelt skift til Byg huskes som brugerens valg', () => {
  const f = fixture();
  vm.runInContext(ideaSource, f.context);
  vm.runInContext(source.slice(source.indexOf('function updateWorkMode()'), source.indexOf("$('#composer-mode').onclick")), f.context);
  for (const previous of ['chat', 'plan']) {
    f.context.view.modeChosen = false; f.$('#work-mode').value = previous; f.context.updateWorkMode();
    f.$('#work-mode').value = 'free'; f.$('#work-mode').onchange();
    assert.equal(f.context.view.modeChosen, true); assert.equal(f.context.view.composerMode, 'free');
  }
});
