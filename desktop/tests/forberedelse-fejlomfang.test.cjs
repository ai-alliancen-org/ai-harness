// Fund 13: en fejl i forberedelsen før Send må kun bede om at gennemgå AI-forbindelsen, når den handler om
// forbindelsen. En forældet filhenvisning («index.html: Linjerne findes ikke i filen.») markerede før forbindelsen
// som Ikke forbundet og viste «AI-forbindelsen skal gennemgås», selv om kataloget lige havde svaret.
// Hovedprocessen sender scope: 'connection' med for fejl i forbindelsen, kataloget og modelvalget. Prøven kører
// den ordrette call og Send-handleren fra ui/app.js med en falsk window.harness.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const linje = fra => { const a = source.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return source.slice(a, source.indexOf('\n', a)); };
const handler = source.slice(source.indexOf('// Låsen tilhører samtalen'), source.indexOf("$('#stop').onclick"));

function fixture(svar) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', checked: false, hidden: false, disabled: false, listeners: {}, focus() {}, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(selector);
  };
  const forbindelsesfejl = [], beskeder = [], handlinger = [];
  const context = {
    $, navigator: { platform: 'MacIntel' }, view: {}, current: { root: '/projekt' }, running: false, projectLoading: false, pendingSend: null, acceptedFingerprint: null, activePlan: null,
    state: { connections: [{ id: 'test' }] }, selectedOwner: () => ({ root: '/projekt', chat: 'samtale' }),
    selection: () => ({ mode: $('#work-mode').value }),
    updateWorkMode() {}, saveChatDraft() {}, applyRunning() {}, reviewKey: data => data.fingerprint,
    async sendNow() {}, showData() {}, showSetup() {}, openTaskSettings() {},
    message(text, error) { beskeder.push({ text, error }); }, connectionFailed(reason) { forbindelsesfejl.push(reason); },
    window: { ConversationMode: require('../ui/conversation-mode.js'), harness: { prepare: async () => svar } }
  };
  $('#prompt').value = 'Ret overskriften'; $('#work-mode').value = 'chat'; $('#connection-select').value = 'test'; $('#model-select').value = 'model'; $('#route-row').hidden = true;
  vm.createContext(context);
  vm.runInContext(linje('async function call(method, value, owner) {'), context);
  vm.runInContext(linje('async function action(fn) {'), context);
  // action registreres, så prøven kan vente på, at afsendelsen er færdig.
  const action = context.action; context.action = fn => { const promise = action(fn); handlinger.push(promise); return promise; };
  vm.runInContext(handler, context);
  return { context, $, forbindelsesfejl, beskeder, send: async () => { $('#chat-form').onsubmit({ preventDefault() {} }); await Promise.all(handlinger); } };
}

test('call bærer hovedprocessens fejlomfang med til brugerfladen', async () => {
  const f = fixture({ ok: false, error: 'Serveren afviste adgangen.', scope: 'connection' });
  const fejl = await f.context.call('prepare', {}).then(() => null, error => error);
  assert.equal(fejl?.message, 'Serveren afviste adgangen.');
  assert.equal(fejl?.scope, 'connection');
  const uden = await fixture({ ok: false, error: 'index.html: Linjerne findes ikke i filen.' }).context.call('prepare', {}).then(() => null, error => error);
  assert.equal(uden?.scope, undefined, 'en fejl uden omfang får intet omfang');
});

test('en forældet filhenvisning vises som fejl, men forbindelsen markeres ikke og skal ikke gennemgås', async () => {
  const f = fixture({ ok: false, error: 'index.html: Linjerne findes ikke i filen.' });
  await f.send();
  assert.deepEqual(f.forbindelsesfejl, [], 'connectionFailed må ikke kaldes for en fejl i en filhenvisning');
  assert.deepEqual(f.beskeder, [{ text: 'index.html: Linjerne findes ikke i filen.', error: true }], 'fejlen står i den almindelige besked');
  assert.equal(f.context.view.submitting, false, 'Send er frigivet igen');
});

test('andre fejl i forberedelsen er heller ikke forbindelsens', async () => {
  for (const tekst of ['Denne handling er allerede i gang. Du kan fortsat bruge de andre projekter.', 'Gennemgå filvalget igen.', 'Referencefilen kan ikke deles.']) {
    const f = fixture({ ok: false, error: tekst });
    await f.send();
    assert.deepEqual(f.forbindelsesfejl, [], tekst);
  }
});

test('en fejl i forbindelsen beder stadig om at gennemgå AI-forbindelsen', async () => {
  const f = fixture({ ok: false, error: 'Serveren afviste adgangen. Kontrollér API-nøglen og tilladelserne.', scope: 'connection' });
  await f.send();
  assert.deepEqual(f.forbindelsesfejl, ['Serveren afviste adgangen. Kontrollér API-nøglen og tilladelserne.']);
  assert.equal(f.beskeder.at(-1).error, true);
});
