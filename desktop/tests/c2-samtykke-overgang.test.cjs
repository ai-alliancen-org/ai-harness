// Spørgsmål Q:C2-4 (beta 3): samtykkets fingeraftryk dækker ikke længere netlisten (fund 24). Nye projekter har haft en netliste
// siden beta 2, så et samtykke fra beta 2 passede ikke efter opgraderingen, og en tester skulle trykke Start igen alene af den grund.
// Overgangen: Aura beregner også det gamle fingeraftryk med projektets aktuelle netliste. Er pakker, opstart og netliste de samme som
// dengang, gælder samtykket stadig og skrives om til det nye fingeraftryk. Alt andet kræver som før et nyt Start.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('../core/dev-server.cjs');
const { aiPreview } = require('../core/ai-preview.cjs');

const NET = { scripts: ['https://cdn.tailwindcss.com'], styles: ['https://fonts.googleapis.com'], images: ['https:'], connect: [] };
const PKG = JSON.stringify({ name: 'kalender', private: true, scripts: { dev: 'vite' }, devDependencies: { vite: '8.3.1' } }, null, 2) + '\n';
// Fingeraftrykket for netop dette projekt med NET, beregnet med den uændrede kode fra v0.7.0-beta.2 og 1cfa7a6 (inspect i
// core/dev-server.cjs). Det er det fingeraftryk, en testers samtykke fra beta 2 er gemt med.
const BETA2 = 'fd66b7806454756efc8b16530ef8fbf7c38d5d14a6a94905496edc07ef14a9a3';

async function project(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-overgang-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), PKG);
  await fs.writeFile(path.join(root, 'vite.config.js'), 'export default {};\n');
  return root;
}
// Rummet, som ai-preview.cjs ser det: DevServer svarer med den rigtige inspect, lageret gemmer som Store.saveProject.
function rum(root, config, previewConsent) {
  const log = [], saved = { previewConsent };
  const devServer = { state: 'idle', url: null, message: '', output: '', snapshot() { return { state: this.state, url: this.url, message: this.message, output: this.output }; },
    async status() { return { project: { ...await inspect(root, config), installed: true } }; },
    async prepare(action) { log.push(action); return { token: action }; }, async execute() { this.state = 'running'; this.url = 'http://127.0.0.1:5173/'; } };
  const store = { project: async () => ({ ...saved }), saveProject: async (_root, values) => Object.assign(saved, values) };
  return { log, saved, value: { devServer, preview: null, externalPreview: null, forceStatic: false, owner: { project: { root }, store } } };
}
const nu = { wait: async () => {} };

test('det gamle fingeraftryk beregnes præcis som i beta 2, med projektets aktuelle netliste', async t => {
  const root = await project(t);
  const med = await inspect(root, { mode: 'auto', network: NET });
  assert.equal(med.kind, 'vite');
  assert.equal(med.legacyFingerprint, BETA2);
  assert.notEqual(med.fingerprint, BETA2, 'det nye fingeraftryk dækker ikke netlisten');
  // Uden netliste var fingeraftrykket det samme før og nu, så der er ingen overgang at lave.
  assert.equal((await inspect(root, { mode: 'auto' })).legacyFingerprint, undefined);
});

test('et samtykke fra beta 2 gælder efter opgraderingen og skrives om til det nye fingeraftryk', async t => {
  const root = await project(t), config = { mode: 'auto', network: NET };
  const r = rum(root, config, { fingerprint: BETA2, scripts: true, at: 1 });
  const svar = await aiPreview(r.value, 'start', nu);
  assert.deepEqual([svar.state, svar.url], ['running', 'http://127.0.0.1:5173/']);
  assert.deepEqual(r.log, ['start'], 'ingen ny Start i appen var nødvendig');
  const nyt = (await inspect(root, config)).fingerprint;
  assert.deepEqual({ ...r.saved.previewConsent, at: undefined }, { fingerprint: nyt, scripts: true, at: undefined }, 'samtykket gemmes med det nye fingeraftryk og samme valg af installationsscripts');
  // Bagefter ændrer et Tillad ikke længere samtykket.
  const efter = rum(root, { mode: 'auto', network: { ...NET, images: ['https:', 'https://billeder.example.dk'] } }, r.saved.previewConsent);
  assert.equal((await aiPreview(efter.value, 'start', nu)).state, 'running');
});

test('overgangen giver intet samtykke, når pakkerne eller netlisten er ændret siden', async t => {
  const root = await project(t);
  const andenListe = rum(root, { mode: 'auto', network: { ...NET, images: ['https:', 'https://billeder.example.dk'] } }, { fingerprint: BETA2, scripts: false });
  assert.equal((await aiPreview(andenListe.value, 'start', nu)).state, 'needs_consent', 'netlisten er ikke den samme som ved samtykket');
  assert.deepEqual(andenListe.log, []);
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  const nyLockfil = rum(root, { mode: 'auto', network: NET }, { fingerprint: BETA2, scripts: false });
  assert.equal((await aiPreview(nyLockfil.value, 'start', nu)).state, 'needs_consent', 'en ny lockfil kræver nyt samtykke');
  assert.equal(nyLockfil.saved.previewConsent.fingerprint, BETA2, 'intet er skrevet om');
});
