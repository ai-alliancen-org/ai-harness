// Fund N:C2-5 (beta 3): aura_preview svarede i et statisk projekt uden vist side, at Aura viser public/index.html, «så snart filen
// findes». Det passede ikke, når filen var Auras uændrede startside (den vises ikke, før AI'en har lavet første version), eller når
// brugeren havde tilsluttet sin egen lokale server, som forhåndsvisningen allerede viser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aiPreview } = require('../core/ai-preview.cjs');
const nu = { wait: async () => {} };

function rum({ kind = 'static', externalPreview = null, consent = null } = {}) {
  const log = [];
  const server = { state: 'idle', url: null, message: '', output: '', snapshot() { return { state: this.state, url: this.url, message: this.message, output: this.output }; },
    async status() { log.push(['status']); return { project: { kind, supported: kind !== 'static', installed: true, fingerprint: 'f', reason: '' } }; },
    async prepare(action) { log.push(['prepare', action]); return { token: action }; }, async execute(token) { log.push(['execute', token]); this.state = 'running'; this.url = 'http://127.0.0.1:5173/'; } };
  return { log, value: { devServer: server, preview: null, externalPreview, forceStatic: false, owner: { project: { root: '/p' }, store: { project: async () => (consent ? { previewConsent: consent } : {}) } } } };
}

test('Auras uændrede startside: svaret lover ikke, at siden vises, så snart filen findes', async () => {
  const r = rum();
  // main.cjs' startStatic svarer false, når public/index.html stadig er Auras startside (openProject: staticPreview false).
  const svar = await aiPreview(r.value, 'start', { ...nu, startStatic: async () => false });
  assert.deepEqual([svar.state, svar.url], ['idle', null]);
  assert.doesNotMatch(svar.message, /så snart filen findes/);
  assert.match(svar.message, /public\/index\.html/);
  assert.match(svar.message, /ikke længere er Auras uændrede startside/);
  assert.match(svar.message, /brugeren skal ikke trykke Start/);
});

test('en tilsluttet lokal server i et projekt uden package.json: AI’en får dens adresse, og intet startes', async () => {
  const r = rum({ externalPreview: 'http://localhost:8000/' });
  let kald = 0;
  for (const action of ['start', 'status']) {
    const svar = await aiPreview(r.value, action, { ...nu, startStatic: async () => { kald++; return false; } });
    assert.equal(svar.state, 'running', action);
    assert.equal(svar.url, 'http://localhost:8000/', action);
    assert.match(svar.message, /tilsluttet sin egen lokale server/);
    assert.doesNotMatch(svar.message, /public\/index\.html/);
  }
  assert.equal(kald, 0, 'den statiske side vises ikke i stedet for brugerens server');
  assert.deepEqual(r.log.filter(([what]) => what !== 'status'), [], 'intet installeres eller startes');
});

test('også i et Vite-projekt: brugerens tilsluttede server erstattes ikke af AI’en, og der bedes ikke om Start', async () => {
  const r = rum({ kind: 'vite', externalPreview: 'http://localhost:3000/', consent: { fingerprint: 'f', scripts: false } });
  const svar = await aiPreview(r.value, 'start', nu);
  assert.deepEqual([svar.state, svar.url], ['running', 'http://localhost:3000/']);
  assert.deepEqual(r.log.filter(([what]) => what !== 'status'), []);
  const uden = rum({ kind: 'vite', externalPreview: 'http://localhost:3000/' });
  assert.notEqual((await aiPreview(uden.value, 'start', nu)).state, 'needs_consent');
});

test('modværn: uden tilsluttet server startes Vite som før, og den statiske side vises som før', async () => {
  const vite = rum({ kind: 'vite', consent: { fingerprint: 'f', scripts: false } });
  const svar = await aiPreview(vite.value, 'start', nu);
  assert.deepEqual([svar.state, svar.url], ['running', 'http://127.0.0.1:5173/']);
  assert.ok(vite.log.some(([what, action]) => what === 'prepare' && action === 'start'));
  const statisk = rum();
  const vist = await aiPreview(statisk.value, 'start', { ...nu, startStatic: async () => { statisk.value.preview = { url: 'aura-preview://p/' }; return true; } });
  assert.deepEqual([vist.state, vist.url], ['running', 'aura-preview://p/']);
});
