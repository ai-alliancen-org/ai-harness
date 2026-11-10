// K3 (beta 3): et link til et andet websted har ingen rettelse til AI'en, så Ret med AI skjules for den forklaring. Kom den før en
// blokering, der har en rettelse, fx et kodebibliotek fra en ukendt adresse, blev Ret med AI skjult for begge. Dialogen viser nu den
// første forklaring med en rettelse forrest med Ret med AI, og forslaget til AI'en indeholder kun det, AI'en kan rette.
// Prøven kører ui/server.js uændret i en vm-kontekst.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { elements, desktop } = require('./c1-dom.cjs');

function ui() {
  const dom = elements(['#preview-problem', '#server-repair', '#server-diagnostics', '#server-consent', '#server-netlist', '#preview-dialog .dialog-notice']), drafts = [], listeners = [];
  const context = vm.createContext({ $: dom.$, node: dom.node, current: { root: '/projekt', workspaceRoot: '/projekt', previewURL: 'aura-preview://projekt/' }, running: false, console,
    showPreview() {}, message() {}, action: async fn => fn(), call: async () => null,
    window: { harness: { onEvent: listener => listeners.push(listener) }, draftMessage: (text, note, options) => drafts.push({ text, note, options }), ApprovalView: { serverRepairDraft: () => '' }, setPreviewStatus() {}, loadPreview() {} } });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/server.js'), 'utf8'), context, { filename: 'ui/server.js' });
  const emit = event => listeners.forEach(listener => listener(event));
  context.window.previewServer.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'idle', project: { kind: 'static', supported: false, installed: true, reason: '', diagnostics: [] } });
  const problems = () => dom.$('#server-diagnostics');
  return { ...dom, drafts, emit, problems, repair: () => problems().children.find(el => el.textContent === 'Ret med AI') };
}
const LINK = { kind: 'navigation', origin: 'https://www.borger.dk', message: 'Forhåndsvisningen kan ikke vise https://www.borger.dk. Den viser kun dit projekt på dets egen adresse. Tryk ↻ for at hente din side igen.', repair: '' };
const SCRIPT = { kind: 'scripts', origin: 'https://cdn.example.com', message: 'Et kodebibliotek fra https://cdn.example.com blev blokeret af projektets netadgang.', repair: 'Brug projektets lokale pakker og filer, eller gennemgå netadgangen til den konkrete adresse. Bevar projektets valgte teknologi.' };
const diagnostic = value => ({ type: 'preview.diagnostic', root: '/projekt', workspaceRoot: '/projekt', diagnostic: value });

test('Ret med AI vises for en senere forklaring med en rettelse, også når et link kom først', () => {
  const view = ui();
  view.emit(diagnostic(LINK));
  assert.equal(view.repair().hidden, true, 'kun et link: ingen Ret med AI');
  view.emit(diagnostic(SCRIPT));
  const repair = view.repair();
  assert.equal(repair.hidden, false, 'kodebiblioteket kan rettes');
  assert.equal(view.problems().children[0].textContent, SCRIPT.message, 'forklaringen med rettelsen står forrest, lige over Ret med AI');
  repair.click();
  assert.equal(view.drafts.length, 1);
  assert.match(view.drafts[0].text, /Et kodebibliotek fra https:\/\/cdn\.example\.com/);
  assert.match(view.drafts[0].text, /Brug projektets lokale pakker og filer/);
  assert.doesNotMatch(view.drafts[0].text, /borger\.dk/, 'AI’en bliver ikke bedt om at rette et link');
  // Linket står stadig i dialogen, under Se detaljer.
  const details = view.problems().children.find(el => el.tagName === 'DETAILS');
  assert.ok(details, 'Se detaljer');
  assert.ok(details.children.some(el => el.textContent === LINK.message));
});

test('modværn: kun forklaringer uden rettelse giver ingen Ret med AI, og én med rettelse står som før', () => {
  const kunLink = ui();
  kunLink.emit(diagnostic(LINK));
  assert.equal(kunLink.problems().children[0].textContent, LINK.message);
  assert.equal(kunLink.repair().hidden, true);
  const kunScript = ui();
  kunScript.emit(diagnostic(SCRIPT));
  assert.equal(kunScript.problems().children[0].textContent, SCRIPT.message);
  kunScript.repair().click();
  assert.equal(kunScript.drafts[0].text, `${SCRIPT.message}\n\n${SCRIPT.repair}`);
});
