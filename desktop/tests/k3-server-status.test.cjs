// K3 del b (beta 3): ui/server.js skriver serverens tilstand og genindlæsningen efter «Tillad denne adresse» gennem ui/app.js
// (window.setPreviewStatus og window.loadPreview). Så overskriver «Forhåndsvisningen kører» ikke en side, der ikke blev vist,
// en server, der starter, stopper eller fejler, går forrest, og en genindlæsning rydder et gammelt problem.
// Prøven kører den uændrede ui/server.js i DOM-attrappen fra tests/c1-dom.cjs; app.js' side prøves i tests/forhaandsvisning-status.test.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serverUI } = require('./c1-dom.cjs');

const projekt = { kind: 'vite', supported: true, installed: true, label: 'Vite', diagnostics: [] };

test('serverens tilstand går gennem app.js: kun «kører» lader et problem med siden stå', () => {
  const view = serverUI();
  const tilstand = state => { view.preview.length = 0; view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state, url: state === 'running' ? view.current.previewURL : null, project: projekt }); return view.preview.filter(([type]) => type === 'status'); };
  assert.deepEqual(tilstand('starting'), [['status', 'Starter forhåndsvisningen …', true]], 'en server, der starter, går forrest');
  assert.deepEqual(tilstand('running'), [['status', 'Forhåndsvisningen kører', false]], '«kører» lader et problem med siden stå');
  assert.deepEqual(tilstand('stopping'), [['status', 'Stopper …', true]]);
  assert.deepEqual(tilstand('error'), [['status', 'Forhåndsvisningen kræver din hjælp', true]]);
});

test('Tillad denne adresse genindlæser siden gennem app.js, så et gammelt problem ryddes', async () => {
  const origin = 'https://billeder.eksempel.dk';
  const view = serverUI({ answers: { previewAllow: () => ({ runtime: { network: { scripts: [], styles: [], images: [origin], connect: [] } } }), previewRuntime: () => null } });
  view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'running', url: view.current.previewURL, project: projekt });
  view.emit({ type: 'preview.diagnostic', root: '/projekt', workspaceRoot: '/projekt', diagnostic: { kind: 'images', origin, message: 'Et billede blev blokeret.', repair: 'Brug lokale filer.' } });
  view.preview.length = 0;
  await view.find('Tillad denne adresse').click();
  assert.deepEqual(view.preview.filter(([type]) => type === 'load'), [['load', view.current.previewURL]]);
});
