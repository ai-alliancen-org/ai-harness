// Fund 17: Overblik. Gammel visning, brugernavn i adresser, flere former for hemmelighedsnavne og hosting kun fra hostingfiler.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { analyze } = require('../core/system-overview.cjs');
const view = require('../ui/system-overview-view.js');

async function projekt(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s1-overblik-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}

test('b: brugernavn og kode i en adresse bliver aldrig en tjeneste, kun værten vises', async t => {
  const m = await analyze(await projekt(t, { 'a.js': 'const u = "https://bruger.navn:hemmelig@db.example.net/x"; const v = "https://admin@api.stripe.com/v1"; const w = "https://bare.navn@host.dk:8080/"' }));
  const hosts = m.services.map(s => s.host).sort();
  assert.deepEqual(hosts, ['api.stripe.com', 'db.example.net', 'host.dk']);
  assert.doesNotMatch(JSON.stringify(m), /hemmelig|bruger\.navn|bare\.navn|admin/);
});

test('c: alle former for miljøopslag giver navnet, aldrig værdien', async t => {
  const m = await analyze(await projekt(t, {
    'a.js': 'const a = process.env["STRIPE_SECRET"]; const b = process.env[\'DB_PASSWORD\']; const { OPENAI_API_KEY, MAILER_TOKEN: t, PORT } = process.env; const c = import.meta.env.VITE_MAP_KEY;',
    'b.py': 'import os\nx = os.environ["PY_SECRET"]\ny = os.getenv("PY_TOKEN")\nz = os.environ.get("PY_DB_URL")\n'
  }));
  assert.deepEqual(m.secrets.map(s => s.name).sort(), ['DB_PASSWORD', 'MAILER_TOKEN', 'OPENAI_API_KEY', 'PY_DB_URL', 'PY_SECRET', 'PY_TOKEN', 'STRIPE_SECRET', 'VITE_MAP_KEY']);
  assert.equal(m.secretsUncertain, false);
});

test('c: opslag, der ikke genkendes, gør listen usikker og siges i teksten', async t => {
  for (const kode of ['const k = process.env[navn];', 'const { apiKey } = process.env;', 'const e = { ...process.env };', 'k = os.environ.get(var)', 'x = os.environ[name]']) {
    const m = await analyze(await projekt(t, { 'a.js': kode }));
    assert.equal(m.secretsUncertain, true, kode); assert.deepEqual(m.secrets, []);
    assert.match(view.summary(m).join(' '), /kan ikke sige, om appen bruger hemmeligheder/, kode);
    assert.doesNotMatch(view.noSecrets(m), /^Ingen navne/); assert.match(view.noSecrets(m), /ikke, at der ingen er/);
  }
  const sikker = await analyze(await projekt(t, { 'a.js': 'const k = process.env.STRIPE_SECRET;' }));
  assert.equal(sikker.secretsUncertain, false); assert.match(view.noSecrets({ secrets: [], secretsUncertain: false }), /^Ingen navne på hemmeligheder fundet/);
  assert.doesNotMatch(view.summary(sikker).join(' '), /kan ikke sige|ufuldstændig/);
});

test('d: et link i koden er ingen hosting, men hostingfiler og udgivelsesindstillinger er', async t => {
  const m = await analyze(await projekt(t, { 'a.js': 'const l = "https://min-app.vercel.app/x"; const k = "https://app.komplai.run/"' }));
  assert.deepEqual(m.hosting, []);
  assert.match(view.summary(m).join(' '), /kan ikke se, hvor appen hostes/);
  const fil = await analyze(await projekt(t, { 'vercel.json': '{}', '.aura/publishing/komplai.json': '{"provider":"komplai"}' }));
  assert.deepEqual(fil.hosting.map(h => h.provider).sort(), ['Vercel', 'komplai Run']);
});

// a: den gamle visning ved projektskift og efter en afsluttet opgave. Selve fanen køres i en afgrænset browserlignende ramme.
function fane() {
  class El { constructor(tag, text) { this.tag = tag; this.textContent = text || ''; this.children = []; this.inert = false; } append(...a) { this.children.push(...a); } replaceChildren(...a) { this.children = a; } }
  const elementer = {}, kald = [];
  const sandbox = { window: { SystemOverviewView: view }, node: (tag, text) => new El(tag, text), $: id => (elementer[id] ||= new El(id)), call: () => new Promise(resolve => kald.push(resolve)) };
  vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname, '../ui/system-overview.js'), 'utf8'), sandbox);
  const model = navn => ({ technologies: [{ name: navn, kind: 'x', source: 'y' }], services: [], hosting: [], secrets: [], notes: [], scanned: 1, externalAI: [] });
  const tekst = () => JSON.stringify(elementer['#overview-body']?.children, (k, v) => k === 'tag' ? undefined : v);
  return { api: sandbox.window.systemOverview, elementer, kald, model, tekst };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a: efter et projektskift vises den gamle visning ikke, og et sent svar for det gamle projekt kasseres', async () => {
  const f = fane();
  f.api.show(); f.kald[0]({ value: f.model('GAMMELT') }); await tick();
  assert.match(f.tekst(), /GAMMELT/);
  f.api.invalidate();
  assert.doesNotMatch(f.tekst() || '', /GAMMELT/, 'den gamle visning er væk');
  f.api.show(); assert.equal(f.kald.length, 2, 'der læses igen i stedet for at genbruge den gamle visning');
  f.kald[1]({ value: f.model('NYT') }); await tick();
  assert.match(f.tekst(), /NYT/);
  // Projektet skifter, mens der læses: svaret hører til det gamle projekt og må ikke vises.
  f.api.invalidate(); f.api.show(); f.api.invalidate();
  f.kald[2]({ value: f.model('SENT_GAMMELT') }); await tick();
  assert.doesNotMatch(f.tekst() || '', /SENT_GAMMELT/);
});

test('a: workspace.js nulstiller Overblik ved projektskift, samtaleskift og afsluttet opgave', async () => {
  const kilde = await fs.readFile(path.join(__dirname, '../ui/workspace.js'), 'utf8');
  const blok = navn => kilde.slice(kilde.indexOf(navn), kilde.indexOf(navn) + 400);
  assert.match(blok('async function onProject()'), /systemOverview\?\.invalidate\(\)/);
  assert.match(blok('async function onChat()'), /staleOverview\(\)/);
  assert.match(kilde, /function staleOverview\(\) \{ if \(active === 'overview'\) \{ window\.systemOverview\?\.stale\(\); window\.systemOverview\?\.show\(\); \} else window\.systemOverview\?\.invalidate\(\); \}/);
  assert.match(kilde, /activity\.running = \['starting', 'working'\]\.includes\(event\.status\);[^\n]*\n\s*if \(!activity\.running\) staleOverview\(\);/);
  assert.match(kilde, /event\.type === 'run\.review' && mine\(event\)\) staleOverview\(\)/);
});
