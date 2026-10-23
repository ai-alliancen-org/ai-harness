const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const brand = require('../ui/provider-brand.js');

class Element {
  constructor(tag = 'button', ownerDocument) { this.tagName = tag; this.ownerDocument = ownerDocument; this.children = []; this.attributes = {}; this._text = ''; this.value = ''; }
  get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const document = { createElement: tag => new Element(tag, document) };

test('kendte forbindelser bruger kun eksisterende lokale original-assets', () => {
  for (const kind of ['anthropic', 'openai', 'mistral', 'ollama', 'openrouter', 'azure', 'corti', 'alexandra', 'zen', 'compatible']) {
    const asset = brand.asset(kind, 'prøvemodel');
    assert.match(asset, /^provider-[a-z]+\.svg$/);
    assert.ok(fs.existsSync(path.join(__dirname, '../ui', asset)), kind);
  }
});

test('OpenRouter viser kendt modelbrand uden at omskrive forbindelse eller model-id', () => {
  for (const [publisher, kind] of Object.entries({ anthropic: 'anthropic', openai: 'openai', mistralai: 'mistral' })) {
    const model = `${publisher}/syntetisk-model`;
    const input = Object.freeze({ kind: 'openrouter', modelID: model, label: `${model} · OpenRouter` });
    const button = document.createElement('button'); brand.decorate(button, input);
    assert.equal(button.children[0].src, brand.asset(kind));
    assert.equal(button.textContent, input.label);
    assert.deepEqual(input, { kind: 'openrouter', modelID: model, label: `${model} · OpenRouter` });
  }
  assert.equal(brand.asset('openrouter', 'unknown/test'), 'provider-openrouter.svg');
  assert.equal(brand.asset('openrouter', 'anthropic'), 'provider-openrouter.svg');
  assert.equal(brand.asset('ollama', 'openai/gpt'), 'provider-ollama.svg');
});

test('ukendt forbindelse har tekstfallback; katalogværdier kan aldrig blive eksterne billedadresser', () => {
  for (const kind of ['ukendt', '__proto__', 'constructor', 'https://example.invalid/logo.svg', '<img src=x onerror=alert(1)>', null, {}]) {
    const button = document.createElement('button');
    brand.decorate(button, { kind, modelID: 'model', label: 'Valgt model · Ukendt server' });
    assert.equal(button.children.length, 1);
    assert.equal(button.children[0].tagName, 'span');
    assert.equal(button.textContent, 'Valgt model · Ukendt server');
    assert.equal(brand.asset(kind), null);
  }
});

test('modelnavne forbliver tekst, og de dekorative ikoner gentager ikke knappens tilgængelige navn', () => {
  const label = '<img src=x onerror=alert(1)> & "Claude"';
  const button = document.createElement('button');
  brand.decorate(button, { kind: 'anthropic', modelID: 'claude', label });
  assert.equal(button.textContent, label);
  assert.deepEqual(button.children.map(child => child.tagName), ['img', 'span']);
  assert.equal(button.children[0].alt, ''); assert.equal(button.children[0].attributes['aria-hidden'], 'true');
  assert.equal(button.children[0].draggable, false); assert.equal(button.children[0].width, 18);
  assert.equal(button.children[1].innerHTML, undefined);
});

test('genoptegning erstatter tidligere mærker og viser ingen model før brugerens valg', () => {
  const button = document.createElement('button');
  brand.decorate(button, { kind: 'mistral', modelID: 'model', label: 'Mistral' });
  brand.decorate(button, { kind: 'openai', modelID: 'gpt', label: 'OpenAI' });
  assert.equal(button.children.length, 2); assert.equal(button.children[0].src, 'provider-openai.svg');
  brand.decorate(button, { kind: 'openai', modelID: '', label: 'Vælg AI' });
  assert.equal(button.children.length, 1); assert.equal(button.textContent, 'Vælg AI');
  assert.doesNotThrow(() => brand.decorate(null));
});

function fixture() {
  const elements = new Map();
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, document.createElement('button')); return elements.get(selector); };
  const connection = Object.freeze({ id: 'valgt-forbindelse', kind: 'openrouter', name: 'Min OpenRouter' });
  $('#connection-select').value = connection.id; $('#model-select').value = 'anthropic/claude-prøve';
  $('#model-select').selectedOptions = [{ textContent: 'Claude prøve' }];
  $('#route-select').value = 'konkret-rute'; $('#prompt').value = 'Bevar kladde';
  const context = { $, state: { connections: [connection], definitions: { openrouter: { provider: 'OpenRouter' } } }, view: { running: false, effort: null },
    window: { ProviderBrand: brand, ModelAdvice: { effort: () => null } }, acceptedFingerprint: 'godkendt-materiale', activePlan: Object.freeze({ id: 'godkendt-plan' }) };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('const effortNames ='), source.indexOf('// Forbruget i samtalen:')), context);
  return { context, $ };
}

test('den rigtige modeloversigt bevarer navn, modtager, model-id, rute og eksisterende knapattributter', () => {
  const f = fixture(); f.$('#model-chip').setAttribute('aria-haspopup', 'dialog');
  f.context.updateModelSummary();
  assert.equal(f.$('#model-chip').children[0].src, 'provider-anthropic.svg');
  assert.equal(f.$('#model-chip').textContent, 'Claude prøve · OpenRouter');
  assert.equal(f.$('#connection-status').textContent, 'Min OpenRouter · anthropic/claude-prøve');
  assert.equal(f.$('#model-chip').attributes['aria-haspopup'], 'dialog');
  assert.equal(f.$('#route-select').value, 'konkret-rute'); assert.equal(f.$('#model-select').value, 'anthropic/claude-prøve');
  assert.equal(f.context.acceptedFingerprint, 'godkendt-materiale'); assert.equal(f.context.activePlan.id, 'godkendt-plan');
  assert.equal(f.$('#prompt').value, 'Bevar kladde');
});

test('en kørende samtale beholder sit afsendte modelbrand, selv om næste model vælges', () => {
  const f = fixture();
  Object.assign(f.context.view, { running: true, activeModelSummary: 'Mistral prøve · Mistral', activeModelBrand: { kind: 'mistral', modelID: 'mistral-prøve' } });
  f.context.updateModelSummary();
  assert.equal(f.$('#model-chip').textContent, 'Mistral prøve · Mistral');
  assert.equal(f.$('#model-chip').children[0].src, 'provider-mistral.svg');
  assert.equal(f.$('#model-select').value, 'anthropic/claude-prøve');
  f.context.view.running = false; f.context.updateModelSummary();
  assert.equal(f.$('#model-chip').textContent, 'Claude prøve · OpenRouter');
  assert.equal(f.$('#model-chip').children[0].src, 'provider-anthropic.svg');
});

test('en kørende samtale uden visningsmetadata beholder teksten uden at gætte et logo', () => {
  const f = fixture(); Object.assign(f.context.view, { running: true, activeModelSummary: 'Tidligere model · Gemt forbindelse' });
  f.context.updateModelSummary();
  assert.equal(f.$('#model-chip').children.length, 1);
  assert.equal(f.$('#model-chip').textContent, 'Tidligere model · Gemt forbindelse');
});

test('afsendelsen knytter kun visningsmetadata til det valgte forløb uden at ændre sendefingeraftryk eller godkendelser', async () => {
  const f = fixture(), owner = Object.freeze({ root: '/syntetisk-projekt', chat: 'samtale' }), calls = [];
  f.context.view.id = owner.chat;
  f.$('#model-chip').textContent = 'Claude prøve · OpenRouter';
  f.$('#work-mode').value = 'chat';
  for (const selector of ['#task-dialog', '#data-dialog']) f.$(selector).close = () => {};
  Object.assign(f.context, {
    selectedOwner: () => owner, appendMessage() {}, saveChatDraft: async () => {},
    setRunning: enabled => { f.context.view.running = enabled; },
    call: async (...args) => { calls.push(args); }, reviewKey: () => 'samme-gennemgang'
  });
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function sendNow('), source.indexOf('function setStatusDetail(')), f.context);
  const data = Object.freeze({ fingerprint: 'godkendt-fingeraftryk', effortLevels: Object.freeze([]) });
  await f.context.sendNow(data, 'Byg det godkendte');
  assert.equal(f.context.view.activeModelBrand.kind, 'openrouter');
  assert.equal(f.context.view.activeModelBrand.modelID, 'anthropic/claude-prøve');
  assert.equal(f.context.view.activeModelSummary, 'Claude prøve · OpenRouter');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'send');
  assert.equal(calls[0][1].fingerprint, data.fingerprint); assert.equal(calls[0][1].text, 'Byg det godkendte');
  assert.equal(calls[0][1].chat, owner.chat); assert.equal(calls[0][2], owner);
  assert.equal(f.$('#route-select').value, 'konkret-rute'); assert.equal(f.context.activePlan.id, 'godkendt-plan');
});
