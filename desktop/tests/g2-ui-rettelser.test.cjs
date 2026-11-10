// Spor G2 (beta 3): rettelserne i ui/app.js prøvet på de ordrette udsnit af filen, som i tests/b1-ui-rettelser.test.cjs.
// 1. N:B1-4, N:B1-5: linjen om tidligere samtale i «Før du sender» er kernens historyText alene. Den står kun, når tidligere
//    samtale følger med, og modsiger aldrig sig selv: en ny AI-session får ikke sætningen om værktøjsresultater foran.
// 2. Q:A-7 (2): «Tidligere samtale, der sendes» under alle oplysninger står kun, når en kopi faktisk sendes, og «Byg første
//    udkast» sætter ikke tilvalget af en ekstra kopi.
// 3. Q:D2-3: fjernes den udgåede komplai-AI-forbindelse uden at være tilbagekaldt, siger feltet det i stedet for blot «fjernet».
// Linjerne i 1 og 2 får kernens egne svar fra en rigtig forberedelse (ChatSession.prepare) med en falsk motor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = source.indexOf(fra), b = source.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return source.slice(a, b); };
const linje = fra => { const a = source.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return source.slice(a, source.indexOf('\n', a)); };
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

class El {
  constructor(tag = 'div', text = '') { this.tagName = tag; this.children = []; this._text = text; this.hidden = false; this.checked = false; this.value = ''; this.dataset = {}; this.className = ''; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set textContent(value) { this.children = []; this._text = String(value); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
}
function dom() {
  const elementer = new Map();
  const $ = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  return { $, node: (tag, text, className) => { const el = new El(tag, text === undefined ? '' : String(text)); if (className) el.className = className; return el; } };
}

// Kernens svar til «Før du sender» i tre situationer: ny samtale, fortsat AI-session og ny AI-session efter modelskift.
async function kernen(t) {
  const directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-g2-ui-')));
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'session-1' }, start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async () => {}, abort: async () => {}, close: async () => { engine.active = false; } };
    return engine;
  } });
  t.after(async () => { await registry.close(); await fsp.rm(directory, { recursive: true, force: true }); });
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(directory, 'projekt-')));
  const bench = await registry.select({ root, name: 'UI' });
  const connection = await bench.connection((await bench.saveConnection({ kind: 'compatible', name: 'Lokal', baseURL: 'http://127.0.0.1:1/v1' })).connections[0].id);
  let model = { id: 'model-a' };
  bench.selection = async () => ({ connection, model, route: null });
  const input = text => ({ connectionID: connection.id, modelID: model.id, mode: 'free', text, includeHistory: true });
  const ny = await bench.prepare(input('Lav en side med violet-cykel'));
  await bench.send({ text: 'Lav en side med violet-cykel', fingerprint: ny.fingerprint, contextBinding: ny.contextBinding });
  const chat = bench.chat; chat.runRoles.set('m', 'assistant'); chat.runText.set('p', { id: 'p', messageID: 'm', text: 'Siden er lavet.' });
  chat.event({ type: 'session.idle' }); await chat.finishing;
  const fortsat = await bench.prepare(input('Gør cyklen grøn'));
  model = { id: 'model-b' };
  const skift = await bench.prepare(input('Gør cyklen grøn'));
  return { ny, fortsat, skift };
}

test('Før du sender: linjen om tidligere samtale er kernens og står kun, når tidligere samtale følger med (N:B1-4, N:B1-5)', async t => {
  const { ny, fortsat, skift } = await kernen(t);
  const vis = data => {
    const { $ } = dom();
    new Function('$', 'data', linje("$('#data-history-text').textContent = ") + '\n' + linje("$('#data-history-text').hidden = "))($, data);
    return { text: $('#data-history-text').textContent, hidden: $('#data-history-text').hidden };
  };
  assert.deepEqual(vis(ny), { text: '', hidden: true }, 'første besked i en ny samtale nævner ikke tidligere samtale');
  assert.deepEqual(vis(fortsat), { text: 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater. Start Ny samtale for et nyt forløb.', hidden: false });
  const ny_session = vis(skift);
  assert.equal(ny_session.text, 'AI-sessionen er ny, så de seneste beskeder fra samtalen medsendes som tekst. Tidligere værktøjsresultater følger ikke med. Start Ny samtale for et nyt forløb. Se indholdet under alle oplysninger.');
  assert.doesNotMatch(ny_session.text, /kan AI’en bruge tidligere beskeder og værktøjsresultater/, 'ingen sætning foran, der modsiger den nye session');
  assert.doesNotMatch(ny_session.text + vis(fortsat).text, /efter dit tilvalg|ekstra kopi/);
});

test('Se alle oplysninger: «Tidligere samtale, der sendes» står kun, når en kopi sendes (Q:A-7)', async t => {
  const { fortsat, skift } = await kernen(t);
  const raekker = data => {
    const { $, node } = dom();
    const context = { $, node, data, appendModelSupport() {}, appendAppContext() {} };
    vm.createContext(context);
    vm.runInContext(linje('const detailLabels = ') + '\n' + udsnit("  $('#data-details').replaceChildren();", '  appendModelSupport(data.modelSupport);'), context);
    return $('#data-details').children.filter(child => child.tagName === 'dt').map(child => child.textContent);
  };
  assert.equal(raekker(fortsat).includes('Tidligere samtale, der sendes'), false, 'samme AI-session fortsætter, og der sendes ingen kopi');
  assert.equal(raekker(skift).includes('Tidligere samtale, der sendes'), true, 'en ny AI-session får de seneste beskeder, og de kan ses');
});

test('«Byg første udkast» sætter ikke tilvalget af en ekstra kopi af tidligere samtale (Q:A-7)', () => {
  const { $ } = dom();
  const kald = [];
  const context = { $, activePlan: { id: 'plan' }, running: false, acceptedFingerprint: 'gammel', updateWorkMode() { kald.push('updateWorkMode'); }, message(text) { kald.push(text); } };
  $('#chat-form').requestSubmit = () => kald.push('send');
  vm.createContext(context);
  vm.runInContext(udsnit("$('#build-plan').onclick = () => {", '// Resultatkortet kvitterer for ændringerne.'), context);
  $('#build-plan').onclick();
  assert.equal($('#include-history').checked, false);
  assert.equal($('#work-mode').value, 'build');
  assert.match($('#prompt').value, /^Byg første udkast efter den plan/);
  assert.deepEqual(kald, ['updateWorkMode', 'send']);
});

test('fjernes den udgåede komplai-forbindelse uden tilbagekaldelse, siger feltet det (Q:D2-3)', async () => {
  for (const [svar, forventet] of [[{ connections: [], removalNotice: 'Forbindelsen er fjernet fra denne computer. Adgangen er ikke tilbagekaldt hos komplai, fordi komplai ikke kunne nås, og den kan stadig være gyldig der, til den udløber.' }, /ikke tilbagekaldt hos komplai/], [{ connections: [] }, /^Forbindelsen er fjernet\.$/]]) {
    const { $ } = dom();
    const context = { $, state: null, current: null, verifiedConnection: 'x', acceptedFingerprint: 'y', setupGeneration: 0, connectionChecks: { clear() {} }, renderConnections() {}, connectionView() {}, connectionFailed() {}, call: async () => svar };
    vm.createContext(context);
    vm.runInContext(udsnit('async function removeSavedConnection(id) {', "$('#connection-remove').onclick"), context);
    await context.removeSavedConnection('tidligere-ai');
    assert.match($('#connections-feedback').textContent, forventet);
  }
});
