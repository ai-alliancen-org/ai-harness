// Projektets tilladelser (ui/project-settings.js) med den rigtige ApprovalsPolicy og det rigtige lager. Brugerens beslutning 10. november 2026
// («Fjern funktionen»): kommandoer huskes ikke længere. Gamle kommandoregler fra beta 2 og beta 3 vises som «Ikke i brug» med en knap, der
// sletter dem. Andre gemte tilladelser (mapper, hjemmesider, filer) vises og fjernes som før. Prøven kører den ordrette fil i en lille falsk DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');

class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.dataset = {}; this.attributes = {}; this.className = ''; this.parentNode = null; }
  // Som i en rigtig DOM bliver tekst en tekstknude blandt børnene, så et senere append ikke skjuler den.
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.children = []; if (value !== '' && value != null) this.children.push(String(value)); }
  append(...items) { for (const item of items) { if (item && typeof item === 'object') item.parentNode = this; this.children.push(item); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  querySelectorAll() { return []; }
  showModal() { this.open = true; }
  addEventListener() {}
  focus() {}
  after() {}
}
const all = (el, tag) => [...(el.tagName === tag ? [el] : []), ...el.children.filter(child => typeof child === 'object').flatMap(child => all(child, tag))];
// Den synlige tekst uden ⓘ-knapper (deres forklaring står i data-info og vises først ved et klik).
const visible = el => typeof el === 'string' ? el : el.className === 'info' ? '' : el.children.map(visible).join('');
const rows = elements => elements.get('#project-permission-rules').children.map(row => ({ text: visible(row), info: all(row, 'BUTTON').filter(button => button.className === 'info').map(button => button.dataset.info), buttons: all(row, 'BUTTON').filter(button => button.className !== 'info').map(button => ({ text: button.textContent, label: button.getAttribute('aria-label'), button })) }));

async function fixture(t, rules) {
  const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-tilladelser-ui-'))); t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'); await fsp.mkdir(path.join(root, 'web'), { recursive: true });
  const store = new Store(path.join(base, 'data'), {}), policy = new ApprovalsPolicy(store);
  await store.update(state => { state.projects[store.projectKey(root)] = { approvals: { version: 1, autoProjectFiles: false, autoCommands: false, rules: rules(root) } }; });
  // Som main.cjs: project:settings giver politikkens settings, og project:settings-save fjerner med revoke og svarer med de nye indstillinger.
  const answer = async () => ({ approvals: await policy.settings(root), runtime: { mode: 'auto', services: [], network: {} }, commandSandbox: { available: true } });
  const calls = [], elements = new Map(), $ = selector => { if (!elements.has(selector)) elements.set(selector, new El()); return elements.get(selector); };
  const node = (tag, text, className) => { const el = new El(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const info = (label, text) => { const button = node('button', 'i', 'info'); button.setAttribute('aria-label', `Mere om ${label}`); button.dataset.info = text; return button; };
  const call = async (method, values) => { calls.push([method, values]); if (method === 'saveProjectSettings' && values?.revoke) await policy.revoke(root, values.revoke); return answer(); };
  const context = { $, node, info, call, action: fn => fn(), current: { root, name: 'Prøve' }, selectedOwner: () => ({ root }), crypto: require('node:crypto'), window: {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui', 'project-settings.js'), 'utf8'), context, { filename: 'ui/project-settings.js' });
  await context.window.projectSettings.open();
  return { root, store, calls, elements };
}
const id = match => createHash('sha256').update(JSON.stringify(match)).digest('hex');
const bash = (command, cwd, input) => { const match = input === undefined ? { kind: 'bash', command, cwd } : { kind: 'bash', command, cwd, input }; return { id: id(match), kind: 'bash', label: `Kommando: ${command}`, target: command, match }; };
const webRule = () => { const match = { kind: 'webfetch', origin: 'https://example.test' }; return { id: id(match), kind: 'webfetch', label: 'Hjemmeside: https://example.test', target: 'https://example.test', match }; };

test('gamle kommandoregler står som «Ikke i brug» med kommando og mappe og en knap, der sletter dem; andre tilladelser kan fjernes som før', async t => {
  const f = await fixture(t, root => [bash('npm test', root, { command: 'npm test', description: 'Kører testene' }), bash('npm test', root), bash('npm run build', path.join(root, 'web')), webRule()]);
  const list = rows(f.elements);
  assert.deepEqual(list.map(row => [row.text, row.buttons.map(button => button.text)]), [
    ['Kommando: npm test · i projektmappenIkke i brug. Kommandoer huskes ikke længere.Slet', ['Slet']],
    ['Kommando: npm run build · i mappen webIkke i brug. Kommandoer huskes ikke længere.Slet', ['Slet']],
    ['Hjemmeside: https://example.testFjern', ['Fjern']]
  ]);
  assert.equal(list[0].buttons[0].label, 'Slet den gamle kommandoregel: Kommando: npm test · i projektmappen');
  assert.match(list[0].info[0], /sandkassen/); assert.match(list[0].info[0], /Byg og kontrollér automatisk/); assert.match(list[0].info[0], /Godkend alt i denne samtale/);
  assert.deepEqual(list[2].info, [], 'en hjemmeside har ingen forklaring om kommandoer');
  await list[0].buttons[0].button.onclick();
  assert.deepEqual(f.calls.at(-1)[0], 'saveProjectSettings');
  assert.equal(f.elements.get('#project-settings-feedback').textContent, 'Den gamle kommandoregel er slettet.');
  assert.deepEqual(rows(f.elements).map(row => row.text.split('Ikke i brug')[0].replace(/Fjern$/, '')), ['Kommando: npm run build · i mappen web', 'Hjemmeside: https://example.test']);
  // Både reglen fra beta 2 og den fra beta 3 for npm test er væk fra lageret.
  assert.deepEqual((await f.store.project(f.root)).approvals.rules.map(rule => rule.match.command || rule.match.origin), ['npm run build', 'https://example.test']);
  await rows(f.elements)[1].buttons[0].button.onclick();
  assert.equal(f.elements.get('#project-settings-feedback').textContent, 'Tilladelsen er fjernet. Den næste handling kræver godkendelse.');
  assert.deepEqual((await f.store.project(f.root)).approvals.rules.map(rule => rule.kind), ['bash']);
});
