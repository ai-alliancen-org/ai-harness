// «Gør klar til Promte» og andre forløb lægger en besked i skrivefeltet med window.draftMessage (verify-promte-ready).
// To fejl: under en kørsel skete der intet og ingen tekst forklarede hvorfor, og med en kladde i feltet sagde beskeden
// «AI’en gør appen klar til udgivelse», selv om intet blev sendt. Prøven kører den ordrette funktion fra ui/app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KILDE = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const start = KILDE.indexOf('window.draftMessage = (text, note, options = {}) => {');
const FUNKTION = KILDE.slice(start, KILDE.indexOf('\n};', start) + 3);
const PROMTE = ['Brug projektets Promte-skill til at gøre appen klar til udgivelse hos Promte.', 'Promte er valgt. AI’en gør appen klar til udgivelse.'];

function fixture({ running = false, submitting = false, prompt = '' } = {}) {
  const elements = new Map(), beskeder = [], sendt = [];
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, { value: '', focus() {} }); return elements.get(selector); };
  $('#prompt').value = prompt; $('#work-mode').value = 'chat';
  $('#chat-form').requestSubmit = () => sendt.push($('#prompt').value);
  const context = { $, window: {}, current: { root: '/projekt' }, view: { id: 'samtale', submitting }, running,
    message: text => beskeder.push(text), updateWorkMode() {}, saveChatDraft() {}, updateStartIdea() {} };
  vm.createContext(context); vm.runInContext(FUNKTION, context);
  const owner = { root: '/projekt', chat: 'samtale' };
  return { $, beskeder, sendt, draft: (options = {}) => context.window.draftMessage(...PROMTE, { mode: 'free', submit: true, owner, ...options }) };
}

test('under en kørsel forklarer appen, hvorfor intet sker, og intet sendes', () => {
  for (const tilstand of [{ running: true }, { submitting: true }]) {
    const f = fixture(tilstand);
    assert.equal(f.draft(), false);
    assert.equal(f.beskeder.length, 1, 'klikket må ikke forsvinde uden en forklaring');
    assert.match(f.beskeder[0], /AI’en arbejder i denne samtale\. Vent, til den er færdig/);
    assert.deepEqual(f.sendt, []); assert.equal(f.$('#prompt').value, '');
  }
});

test('med en kladde i feltet siger beskeden ikke, at AI’en arbejder, og kladden bevares', () => {
  const f = fixture({ prompt: 'Min egen kladde' });
  const svar = f.draft();
  assert.equal(f.beskeder.length, 1);
  assert.doesNotMatch(f.beskeder[0], /gør appen klar|AI’en arbejder/, 'intet er sendt, så beskeden må ikke love, at AI’en arbejder');
  assert.match(f.beskeder[0], /kladde er bevaret, så intet er sat ind eller sendt til AI’en/);
  assert.equal(f.$('#prompt').value, 'Min egen kladde'); assert.deepEqual(f.sendt, []);
  assert.equal(svar, false, 'kalderen får at vide, at intet blev sat ind');
});

test('uden kladde og uden kørsel sættes beskeden ind i Byg og sendes den normale vej', () => {
  const f = fixture();
  assert.equal(f.draft(), true);
  assert.equal(f.$('#work-mode').value, 'free');
  assert.deepEqual(f.sendt, [PROMTE[0]]);
});

test('en besked til en anden samtale lægges ikke i den åbne', () => {
  const f = fixture({ running: true });
  assert.equal(f.draft({ owner: { root: '/projekt', chat: 'en-anden' } }), false);
  assert.deepEqual(f.beskeder, [], 'en anden samtales besked forklares ikke i den åbne samtale');
  assert.deepEqual(f.sendt, []);
});
