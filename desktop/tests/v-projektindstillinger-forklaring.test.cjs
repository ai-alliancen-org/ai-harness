// Beslutning (c), 10. november 2026: et nyt projekt uden «Versioner og fortryd» spørger som før, indtil versionerne slås til. Så længe
// det venter (main.cjs projectSettings: pendingDefaults), forklarer Projektets indstillinger under «Hvad må AI’en godkende automatisk?»,
// hvorfor de to valg er fravalgt, og hvad Aura gør, når versionerne slås til. Forklaringen forsvinder, når brugeren selv vælger.
// ui/project-settings.js køres uændret i en vm-kontekst med en lille DOM-attrap, hvor et fjernet element ikke findes igen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/project-settings.js'), 'utf8');

class El {
  constructor(tag = 'div', text = '', className = '') { this.tag = tag; this.textContent = text ?? ''; this.className = className || ''; this.id = ''; this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.dataset = {}; this.attributes = {}; this.open = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  after(...items) { this.following = [...(this.following || []), ...items]; for (const item of items) item.parent = this; }
  remove() { this.removed = true; if (this.parent) this.parent.following = this.parent.following.filter(item => item !== this); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener() {}
  querySelectorAll() { return []; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}
function run(answers) {
  const fixed = new Map(), created = [], calls = [];
  const $ = selector => {
    if (/^#[\w-]+$/.test(selector)) {
      const made = created.find(el => el.id === selector.slice(1) && !el.removed);
      if (made) return made;
      if (selector === '#project-defaults-pending' || selector === '#project-unisolated-warning') return null;
    }
    if (!fixed.has(selector)) fixed.set(selector, new El());
    return fixed.get(selector);
  };
  const node = (tag, text, className) => { const el = new El(tag, text, className); created.push(el); return el; };
  const context = vm.createContext({ $, node, info: () => new El('button'), current: { root: '/projekt', name: 'Cykelruter' }, selectedOwner: () => ({ root: '/projekt' }), action: fn => fn(), crypto: { randomUUID: () => '00000000' },
    call: async (method, value) => { calls.push({ method, value }); return answers[method](value); }, window: {} });
  vm.runInContext(source, context, { filename: 'ui/project-settings.js' });
  return { context, $, calls };
}
// pendingReason kommer fra core/new-project-defaults.cjs waiting: hvad sikkerhedsnettet mangler.
const settings = (pending, sandbox = true, reason = { kind: 'automatisk' }) => ({ runtime: { mode: 'auto', services: [], network: {} }, approvals: { autoProjectFiles: false, autoCommands: false, rules: [] }, commandSandbox: { available: sandbox, warnings: [] }, pendingDefaults: pending, pendingReason: pending ? reason : null });
const note = view => view.$('#project-approval-settings h3').following?.find(el => el.id === 'project-defaults-pending' && !el.removed) || null;
// Forklaringens synlige tekst; en teknisk grund står bag Se detaljer.
const noteText = view => note(view).children.find(el => el.tag === 'p')?.textContent;
const noteDetails = view => note(view).children.find(el => el.tag === 'details') || null;

test('et nyt projekt, der venter på versionerne, forklarer de fravalgte valg under overskriften', async () => {
  const view = run({ projectSettings: () => settings(true) });
  await view.context.window.projectSettings.open();
  assert.ok(note(view), 'forklaringen vises, mens projektet venter');
  assert.equal(noteText(view), 'AI’en spørger først, fordi projektet ikke gemmer en version efter hver AI-opgave. Slå «Gem en version efter hver AI-opgave» til i projektmenuen (•••) under Gem version. Så slår Aura begge valg til, medmindre du selv vælger her.');
  assert.equal(note(view).children.find(el => el.tag === 'p').className, 'hint');
  assert.equal(noteDetails(view), null, 'ingen tekniske detaljer, når grunden er sagt');
  assert.ok(!noteText(view).includes(String.fromCharCode(0x2014)), 'ingen tankestreg');
});

test('brugerens eget valg fjerner forklaringen, fordi svaret ikke længere venter', async () => {
  const view = run({ projectSettings: () => settings(true), saveProjectSettings: () => settings(false) });
  await view.context.window.projectSettings.open();
  assert.ok(note(view));
  view.$('#project-auto-files').checked = true; await view.$('#project-auto-files').onchange({ target: { checked: true } });
  assert.equal(JSON.stringify(view.calls.at(-1)), JSON.stringify({ method: 'saveProjectSettings', value: { autoProjectFiles: true } }));
  assert.equal(note(view), null, 'forklaringen forsvinder efter brugerens eget valg');
});

test('uden kommandosandkasse lover forklaringen kun filændringer, og et projekt, der ikke venter, viser ingen forklaring', async () => {
  const uden = run({ projectSettings: () => settings(true, false) });
  await uden.context.window.projectSettings.open();
  assert.match(noteText(uden), /slår Aura filændringer til, medmindre/);
  const ikke = run({ projectSettings: () => settings(false) });
  await ikke.context.window.projectSettings.open();
  assert.equal(note(ikke), null);
});

// Skeptikerens fund: grunden passede ikke, når sikkerhedsnettet manglede af en anden grund, og forklaringen sagde ikke, hvor
// man slår det til. Uden funktionen er versionsknappen skjult, så forklaringen peger på Funktioner.
test('forklaringen siger den faktiske grund og hvor den rettes: funktionen, automatiske versioner eller Git', async () => {
  const funktion = run({ projectSettings: () => settings(true, true, { kind: 'funktion' }) });
  await funktion.context.window.projectSettings.open();
  assert.equal(noteText(funktion), 'AI’en spørger først, fordi Versioner og fortryd er slået fra for projektet. Slå funktionen til under Indstillinger › Funktioner, og slå derefter «Gem en version efter hver AI-opgave» til under Gem version. Så slår Aura begge valg til, medmindre du selv vælger her.');
  assert.equal(noteDetails(funktion), null);
  const git = run({ projectSettings: () => settings(true, false, { kind: 'git', detail: 'Projektet bruger Git-filtre, fx Git LFS. Gem selv versionen med Gem version.' }) });
  await git.context.window.projectSettings.open();
  assert.equal(noteText(git), 'AI’en spørger først, fordi Aura ikke kan gemme projektets versioner endnu, selv om automatiske versioner er slået til. Når en version kan gemmes i projektmenuen (•••) under Gem version, slår Aura filændringer til, medmindre du selv vælger her.');
  const details = noteDetails(git);
  assert.ok(details, 'Gits egen grund står bag Se detaljer');
  assert.deepEqual(details.children.map(el => el.textContent), ['Se detaljer', 'Projektet bruger Git-filtre, fx Git LFS. Gem selv versionen med Gem version.']);
  for (const view of [funktion, git]) assert.ok(!noteText(view).includes(String.fromCharCode(0x2014)), 'ingen tankestreg');
});
