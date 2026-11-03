// aura_preview: samtykke, installation og start (beslutning for beta 2). Falsk DevServer; den rigtige start prøves i verify-scriptet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aiPreview } = require('../core/ai-preview.cjs');

function space({ consent, fingerprint = 'f1', installed = true } = {}) {
  const log = [];
  const server = { state: 'idle', url: null, message: '', output: '',
    snapshot() { return { state: this.state, url: this.url, message: this.message, output: this.output }; },
    async status() { return { project: { fingerprint, installed: this.installed ?? installed } }; },
    async prepare(action, scripts) { log.push(['prepare', action, scripts]); return { token: action }; },
    async execute(token) { log.push(['execute', token]); this.state = token === 'install' ? 'idle' : 'running'; if (token === 'start') this.url = 'http://localhost:5173/'; if (token === 'install') this.installed = true; } };
  return { log, server, value: { devServer: server, forceStatic: true, owner: { project: { root: '/p' }, store: { project: async () => ({ previewConsent: consent }) } } } };
}
const nu = { wait: async () => {} };

test('uden samtykke starter intet, og AI\'en får besked om at bede brugeren', async () => {
  const s = space({ consent: undefined });
  const result = await aiPreview(s.value, 'start', nu);
  assert.equal(result.state, 'needs_consent'); assert.deepEqual(s.log, []);
});

test('et samtykke til et ældre fingeraftryk gælder ikke længere', async () => {
  const s = space({ consent: { fingerprint: 'gammelt' }, fingerprint: 'nyt' });
  assert.equal((await aiPreview(s.value, 'start', nu)).state, 'needs_consent'); assert.deepEqual(s.log, []);
});

test('med gyldigt samtykke og installerede pakker startes forhåndsvisningen, og adressen returneres', async () => {
  const s = space({ consent: { fingerprint: 'f1', scripts: false } });
  const result = await aiPreview(s.value, 'start', nu);
  assert.equal(result.state, 'running'); assert.equal(result.url, 'http://localhost:5173/');
  assert.deepEqual(s.log, [['prepare', 'start', false], ['execute', 'start']]); assert.equal(s.value.forceStatic, false);
});

test('manglende pakker installeres først, med det scriptvalg brugeren godkendte', async () => {
  const s = space({ consent: { fingerprint: 'f1', scripts: true }, installed: false });
  s.server.installed = false;
  const result = await aiPreview(s.value, 'start', nu);
  assert.equal(result.state, 'running');
  assert.deepEqual(s.log.map(l => l.slice(0, 2).join(':')), ['prepare:install', 'execute:install', 'prepare:start', 'execute:start']); assert.equal(s.log[0][2], true);
});

test('status starter aldrig noget, og en fejl returnerer kun de sidste tegn af loggen', async () => {
  const s = space({ consent: { fingerprint: 'f1' } });
  assert.equal((await aiPreview(s.value, 'status', nu)).state, 'idle'); assert.deepEqual(s.log, []);
  s.server.state = 'error'; s.server.output = 'x'.repeat(5000) + 'SLUTNING';
  const failed = await aiPreview(s.value, 'status', nu);
  assert.equal(failed.state, 'error'); assert.ok(failed.log.length <= 800 && failed.log.endsWith('SLUTNING'));
});
