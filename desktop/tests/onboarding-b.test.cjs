const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { provider, render, decorateProviderCard } = require('../ui/onboarding-b.js');

// En lille DOM-adapter gør præsentationsmodulet afprøveligt uden Electron eller nye pakker.
// innerHTML er med vilje forbudt: forbindelse- og modelnavne skal forblive tekst.
function documentFixture() {
  const document = { createElement: tag => new Element(tag), createElementNS: (namespace, tag) => Object.assign(new Element(tag), { namespaceURI: namespace }) };
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = new Map(); this.className = ''; this.value = ''; this._text = ''; }
    get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_) { throw Error('HTML-parsing må ikke bruges til visning af bruger- eller modeltekst'); }
    get classList() { return { add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); } }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    replaceChildren(...children) { this._text = ''; this.children = children; }
    querySelector(selector) { return descendants(this).find(item => selector.startsWith('.') ? item.className.split(/\s+/).includes(selector.slice(1)) : item.tagName.toLowerCase() === selector) || null; }
  }
  return { document, root: document.createElement('aside') };
}
function descendants(root) { return root.children.flatMap(child => typeof child === 'string' ? [] : [child, ...descendants(child)]); }
const icons = root => descendants(root).filter(item => item.tagName === 'IMG');
const verified = root => [root, ...descendants(root)].filter(item => item.dataset.verified === 'true');

test('udbydernes brandmetadata er lokale, uforanderlige og afgrænset til originalens ti udbydere', () => {
  const kinds = ['anthropic', 'openai', 'mistral', 'ollama', 'azure', 'alexandra', 'corti', 'zen', 'compatible', 'openrouter'];
  for (const kind of kinds) {
    const value = provider(kind);
    assert.ok(Object.isFrozen(value)); assert.deepEqual(Object.keys(value).sort(), ['accent', 'logo', 'name']);
    assert.match(value.accent, /^#[0-9a-f]{6}$/i); assert.match(value.logo, /^[a-z0-9-]+\.svg$/i);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'ui', value.logo)), `${kind} skal have et lokalt logo`);
    assert.ok(value.name.length > 0);
  }
  assert.equal(provider('anthropic').name, 'Claude'); assert.equal(provider('alexandra').name, 'Alexandra');
  assert.equal(provider('mistral').accent, '#fa500f');
  for (const unknown of ['komplai', '__proto__', 'constructor', 'https://example.invalid/logo.svg', '', null, 1, {}]) assert.equal(provider(unknown), provider('compatible'));
});

test('kortdekoration bevarer controllers, brugerens valg og originalens eksisterende kortindhold', () => {
  const { document } = documentFixture(), card = document.createElement('button'), image = document.createElement('img'), title = document.createElement('strong');
  title.textContent = 'Eksisterende navn'; card.dataset.kind = 'mistral'; card.value = 'eksisterende'; card.setAttribute('aria-pressed', 'true');
  let calls = 0; const original = () => calls++; card.onclick = original; card.onfocus = original; card.append(image, title);
  decorateProviderCard(card, 'mistral'); decorateProviderCard(card, 'mistral');
  assert.equal(card.onclick, original); assert.equal(card.onfocus, original); assert.equal(calls, 0);
  assert.equal(card.value, 'eksisterende'); assert.equal(card.dataset.kind, 'mistral'); assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.equal(card.children[1], title); assert.equal(title.textContent, 'Eksisterende navn'); assert.equal(image.src, provider('mistral').logo);
  assert.equal(descendants(card).filter(item => item.className === 'onboarding-b-choice-mark').length, 1, 'gentagen dekoration tilføjer ikke ekstra markeringer');
});

test('en gemt eller afventende forbindelse får ikke mærket for et faktisk katalogsvar', () => {
  const { root } = documentFixture();
  for (const state of [{}, { saved: true }, { pending: true }, { error: 'Syntetisk fejl' }, { checked: 'true' }, { checked: 1 }, { checked: true, pending: true }, { checked: true, error: 'En nyere fejl' }, { checked: true, preview: true }]) {
    render(root, { kind: 'corti', phase: 'connection', ...state }); assert.equal(verified(root).length, 0);
  }
  render(root, { kind: 'corti', phase: 'connection', checked: true }); assert.ok(verified(root).length > 0);
  assert.match(root.textContent, /Modelkataloget svarer/); assert.match(root.textContent, /første AI-besked/);
  render(root, { kind: 'corti', phase: 'connection', saved: true, error: 'Ny katalogfejl' });
  assert.equal(verified(root).length, 0); assert.match(root.textContent, /gennemgang/);
});

test('modelkort får et lokalt brandlogo uden at ændre model-ID, valg eller klikcontroller', () => {
  const { document } = documentFixture(), card = document.createElement('button'), title = document.createElement('strong');
  card.className = 'model-choice'; card.dataset.model = 'den-valgte-model'; card.setAttribute('aria-pressed', 'true'); title.textContent = 'Modellen'; card.append(title);
  let calls = 0; const original = () => calls++; card.onclick = original;
  decorateProviderCard(card, 'anthropic'); decorateProviderCard(card, 'anthropic');
  assert.equal(icons(card).length, 1); assert.equal(icons(card)[0].src, provider('anthropic').logo);
  assert.equal(card.dataset.model, 'den-valgte-model'); assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.equal(card.onclick, original); assert.equal(calls, 0); assert.ok(card.children.includes(title));
  assert.equal(descendants(card).filter(item => item.className === 'onboarding-b-choice-mark').length, 1);
});

test('modelnavne og forbindelsesnavne vises som tekst uden mulighed for HTML eller eksterne logoer', () => {
  const { root } = documentFixture();
  const modelName = '<img src="https://example.invalid/tracker" onerror="alert(1)">';
  const connectionName = '<script>sendEverything()</script>';
  render(root, { kind: 'mistral', phase: 'model', modelChosen: true, modelName, connectionName });
  assert.ok(root.textContent.includes(modelName)); assert.ok(root.textContent.includes(connectionName));
  assert.equal(descendants(root).filter(item => item.tagName === 'SCRIPT').length, 0);
  assert.ok(icons(root).every(image => /^[a-z0-9-]+\.svg$/i.test(image.src)));
  assert.equal(root.getAttribute('aria-label'), 'Din opsætning'); assert.equal(root.dataset.kind, 'mistral'); assert.equal(root.dataset.phase, 'model');
  const art = descendants(root).find(item => item.className === 'onboarding-b-art'); assert.equal(art.getAttribute('aria-hidden'), 'true');
});

test('ukendte udbydere og faser kan ikke tilføje nye destinationer eller efterlade et gammelt valg', () => {
  const { root } = documentFixture();
  render(root, { kind: 'mistral', phase: 'model', modelChosen: true, modelName: 'En valgt model' });
  render(root, { kind: 'https://example.invalid', phase: 'execute', logo: 'https://example.invalid', checked: false });
  assert.equal(root.dataset.kind, ''); assert.equal(root.dataset.phase, 'choice'); assert.equal(verified(root).length, 0);
  assert.ok(!root.textContent.includes('En valgt model')); assert.ok(!root.textContent.includes('https://example.invalid'));
  assert.ok(icons(root).every(image => /^[a-z0-9-]+\.svg$/i.test(image.src)));
});

test('omtegning er ren præsentation uden netværk, lagring, timer eller implicitte handlinger', () => {
  const { root } = documentFixture();
  const previous = Object.fromEntries(['fetch', 'setTimeout', 'setInterval', 'localStorage'].map(name => [name, Object.getOwnPropertyDescriptor(global, name)]));
  const forbidden = () => { throw Error('Præsentationen må ikke udføre arbejde på brugerens vegne'); };
  try {
    global.fetch = forbidden; global.setTimeout = forbidden; global.setInterval = forbidden;
    Object.defineProperty(global, 'localStorage', { configurable: true, writable: true, value: { getItem: forbidden, setItem: forbidden, removeItem: forbidden } });
    for (const phase of ['provider', 'connection', 'model', 'idea', 'choice', 'features']) {
      render(root, { kind: 'openai', phase, connectionName: 'Syntetisk forbindelse', modelName: 'Syntetisk model', modelChosen: phase === 'model' });
      assert.equal(root.dataset.phase, phase); assert.equal(root.dataset.kind, 'openai');
    }
    const size = descendants(root).length; render(root, { kind: 'openai', phase: 'features', connectionName: 'Syntetisk forbindelse', modelName: 'Syntetisk model' });
    assert.equal(descendants(root).length, size, 'omtegning erstatter indholdet frem for at akkumulere det');
  } finally {
    for (const [name, descriptor] of Object.entries(previous)) { if (descriptor === undefined) delete global[name]; else Object.defineProperty(global, name, descriptor); }
  }
});
