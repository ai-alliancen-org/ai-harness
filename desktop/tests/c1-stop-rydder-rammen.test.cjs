// K3, brugerfladens halvdel af fejlen efter rammebindingen (beta 3): vender brugeren tilbage til en arbejdsmappe, mens projektets
// server kører, sætter usePreviewContext rammens adresse, før server.js får serverens tilstand. server.js huskede så ikke adressen
// som serverens, og ved Stop eller en fejl blev rammen stående på den døde adresse. ↻ og kontrollen efter en opgave indlæste den igen,
// og den tomme flade med «Start forhåndsvisning» kom aldrig. Prøven kører ui/server.js uændret i en vm-kontekst.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { elements, desktop } = require('./c1-dom.cjs');

const URL_SERVER = 'http://127.0.0.1:5173/';
function ui(current) {
  const dom = elements(['#preview-problem', '#server-repair', '#server-diagnostics', '#server-consent', '#server-netlist', '#preview-dialog .dialog-notice']), shown = [];
  // Som showPreview i ui/app.js: adressen bliver arbejdsmappens, og rammen viser den eller ryddes.
  const showPreview = (url, external = false) => { shown.push([url, external]); current.previewURL = url; };
  const context = vm.createContext({ $: dom.$, node: dom.node, current, running: false, console, showPreview, message() {}, action: async fn => fn(), call: async () => null,
    window: { harness: { onEvent() {} }, draftMessage() {}, ApprovalView: { serverRepairDraft: () => '' }, setPreviewStatus() {}, loadPreview() {} } });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/server.js'), 'utf8'), context, { filename: 'ui/server.js' });
  return { update: context.window.previewServer.update, shown };
}
const vite = { kind: 'vite', supported: true, installed: true, label: 'Vite', diagnostics: [] };

test('Stop rydder rammen, også når brugeren er vendt tilbage til arbejdsmappen, mens serveren kørte', () => {
  const current = { root: '/p', workspaceRoot: '/kopi', previewURL: null }, view = ui(current);
  view.update({ root: '/p', workspaceRoot: '/kopi', state: 'idle', url: null, project: { kind: 'static', supported: false, diagnostics: [] } });
  // Tilbage i projektet: usePreviewContext viser først adressen (selectSpace' previewURL) og giver derefter serverens tilstand.
  current.workspaceRoot = '/p'; current.previewURL = URL_SERVER;
  view.update({ root: '/p', workspaceRoot: '/p', state: 'running', url: URL_SERVER, project: vite });
  view.update({ root: '/p', workspaceRoot: '/p', state: 'stopping', url: null, project: vite });
  assert.equal(current.previewURL, null, 'rammen står ikke på den døde adresse, så ↻ og kontrollen efter en opgave ikke indlæser den igen');
  view.update({ root: '/p', workspaceRoot: '/p', state: 'stopped', url: null, project: vite });
  assert.equal(current.previewURL, null);
  // Serveren startes igen: siden vises.
  view.update({ root: '/p', workspaceRoot: '/p', state: 'running', url: URL_SERVER, project: vite });
  assert.equal(current.previewURL, URL_SERVER);
});

test('en server, der fejler, efterlader heller ikke rammen på sin adresse', () => {
  const current = { root: '/p', workspaceRoot: '/p', previewURL: URL_SERVER }, view = ui(current);
  view.update({ root: '/p', workspaceRoot: '/p', state: 'running', url: URL_SERVER, project: vite });
  view.update({ root: '/p', workspaceRoot: '/p', state: 'error', url: null, message: 'Serveren stoppede uventet.', project: vite });
  assert.equal(current.previewURL, null);
});

test('modværn: en tilsluttet server og den statiske side ryddes ikke af serverens tilstand', () => {
  const tilsluttet = { root: '/p', workspaceRoot: '/p', previewURL: 'http://localhost:3000/' }, a = ui(tilsluttet);
  a.update({ root: '/p', workspaceRoot: '/p', state: 'stopped', url: null, project: { kind: 'static', supported: false, diagnostics: [] } });
  assert.equal(tilsluttet.previewURL, 'http://localhost:3000/');
  const statisk = { root: '/p', workspaceRoot: '/p', previewURL: 'aura-preview://projekt-p/' }, b = ui(statisk);
  b.update({ root: '/p', workspaceRoot: '/p', state: 'idle', url: null, project: { kind: 'static', supported: false, diagnostics: [] } });
  assert.equal(statisk.previewURL, 'aura-preview://projekt-p/');
  assert.deepEqual([...a.shown, ...b.shown], []);
});
