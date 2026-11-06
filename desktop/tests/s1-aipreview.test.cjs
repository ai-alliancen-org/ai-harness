// Fund 14: aura_preview i statiske projekter og for en samtale i baggrunden.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aiPreview, resolveSpace } = require('../core/ai-preview.cjs');

function statiskRum({ kind = 'static', url = 'http://127.0.0.1:4100/', state = 'idle' } = {}) {
  const log = [];
  const server = { state, url: null, message: '', output: '', snapshot() { return { state: this.state, url: this.url, message: this.message, output: this.output }; },
    async status() { return { project: { kind, supported: false, installed: true, fingerprint: 'f' } }; },
    async prepare(a) { log.push(['prepare', a]); throw Error('må ikke kaldes'); }, async execute() { log.push(['execute']); } };
  return { log, value: { devServer: server, preview: url ? { url } : null, forceStatic: true, owner: { project: { root: '/p' }, store: { project: async () => ({}) } } } };
}
const nu = { wait: async () => {} };

test('et statisk projekt uden package.json svarer running med den statiske adresse, både ved start og status', async () => {
  for (const action of ['start', 'status']) {
    const rum = statiskRum();
    const svar = await aiPreview(rum.value, action, nu);
    assert.equal(svar.state, 'running', action); assert.equal(svar.url, 'http://127.0.0.1:4100/', action);
    assert.deepEqual(rum.log, [], 'intet forsøges startet');
  }
});

test('et statisk projekt uden en statisk adresse får ikke opdigtet en', async () => {
  const svar = await aiPreview(statiskRum({ url: null }).value, 'status', nu);
  assert.notEqual(svar.state, 'running'); assert.equal(svar.url, null);
});

test('et projekt med en server (ikke statisk) berøres ikke af den statiske genvej', async () => {
  const svar = await aiPreview(statiskRum({ kind: 'vite' }).value, 'status', nu);
  assert.equal(svar.state, 'idle');
});

test('en samtale i baggrunden finder projektet: rummet oprettes via ejeren, når det ikke findes', async () => {
  const rum = statiskRum(), rum2 = new Map(), kald = [];
  const hjælp = {
    spaceFor: root => rum2.get(root),
    ownerFor: root => root === '/kopi' ? { id: 'bench' } : undefined,
    selectSpace: async (root, owner) => { kald.push([root, owner.id]); rum2.set(root, rum.value); }
  };
  assert.equal(await resolveSpace('/kopi', hjælp), rum.value);
  assert.deepEqual(kald, [['/kopi', 'bench']]);
  assert.equal(await resolveSpace('/ukendt', hjælp), undefined, 'ukendt projekt giver stadig fejlen om at projektet ikke er åbent');
  assert.equal((await aiPreview(undefined, 'start', nu)).state, 'error');
});

test('et rum, der allerede findes, genbruges uden at oprette et nyt', async () => {
  const rum = statiskRum(); let oprettet = 0;
  const fundet = await resolveSpace('/p', { spaceFor: () => rum.value, ownerFor: () => ({}), selectSpace: async () => { oprettet++; } });
  assert.equal(fundet, rum.value); assert.equal(oprettet, 0);
});
