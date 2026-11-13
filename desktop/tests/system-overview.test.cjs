// Systemoversigten udleder teknologier, eksterne tjenester, hosting og navne på hemmeligheder af projektets filer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyze } = require('../core/system-overview.cjs');
const view = require('../ui/system-overview-view.js');

async function projekt(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-overblik-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}

test('teknologier, eksterne tjenester, hosting og hemmelighedsnavne udledes af projektet', async t => {
  const root = await projekt(t, {
    'package.json': JSON.stringify({ dependencies: { react: '18', 'react-dom': '18', stripe: '14' }, devDependencies: { vite: '5', tailwindcss: '3', typescript: '5' } }),
    'index.html': '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><script src="https://cdn.tailwindcss.com"></script>',
    'src/api.ts': 'const r = await fetch("https://api.openai.com/v1/chat/completions", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }); // se https://example.com og http://localhost:3000',
    'vercel.json': '{}'
  });
  const m = await analyze(root);
  const tech = m.technologies.map(x => x.name);
  for (const navn of ['React', 'Vite', 'Tailwind CSS', 'TypeScript', 'Stripe', 'Node.js']) assert.ok(tech.includes(navn), navn + ': ' + tech.join(','));
  const tjenester = Object.fromEntries(m.services.map(s => [s.name, s]));
  assert.equal(tjenester['OpenAI'].kind, 'AI'); assert.equal(tjenester['OpenAI'].hq, 'USA');
  assert.equal(tjenester['Google Fonts'].kind, 'Skrifttyper'); assert.ok(tjenester['Tailwind (CDN)']);
  assert.equal(m.services.some(s => /example\.com|localhost/.test(s.host)), false, 'eksempler og lokale adresser er ingen tjenester');
  assert.deepEqual(m.secrets.map(s => s.name), ['OPENAI_API_KEY']);
  assert.ok(m.hosting.some(h => h.provider === 'Vercel'));
  assert.equal(m.externalAI.length, 1);
});

test('hemmeligheder vises kun med navn, og node_modules, .git og .aura gennemsøges ikke', async t => {
  const root = await projekt(t, {
    'src/a.js': 'const k = process.env.API_KEY; const hemmelig = "sk-' + 'a'.repeat(40) + '"; fetch("https://api.stripe.com/v1");',
    'node_modules/x/index.js': 'fetch("https://skjult-i-node-modules.dk")', '.aura/tmp/o/n.js': 'fetch("https://skjult-i-aura.dk")', '.git/x.js': 'fetch("https://skjult-i-git.dk")'
  });
  const m = await analyze(root);
  assert.doesNotMatch(JSON.stringify(m), /sk-a{10}/, 'ingen værdi i resultatet');
  assert.deepEqual(m.services.map(s => s.host).sort(), ['api.stripe.com']);
});

test('et tomt projekt giver en ærlig, kort oversigt uden opdigtede tjenester', async t => {
  const m = await analyze(await projekt(t, { 'public/index.html': '<h1>Hej</h1>' }));
  assert.deepEqual(m.services, []);
  const tekst = view.summary(m).join(' ');
  assert.match(tekst, /ikke noget fra eksterne tjenester/); assert.match(tekst, /kan ikke se, hvor appen hostes/);
});

test('teksten og diagrammet nævner de samme tjenester, og diagrammet er sikkert', async t => {
  const m = await analyze(await projekt(t, { 'package.json': '{"dependencies":{"openai":"4"}}', 'src/a.js': 'fetch("https://api.openai.com/v1")', 'vercel.json': '{}' }));
  const tekst = view.summary(m).join(' '), svg = view.diagram(m);
  assert.match(tekst, /OpenAI/); assert.match(tekst, /USA/); assert.match(tekst, /Vercel/);
  assert.match(svg, /<svg/); assert.match(svg, /OpenAI/); assert.doesNotMatch(svg, /<script|onerror|javascript:/i);
  assert.match(view.diagram({ technologies: [], services: [{ name: '<img src=x onerror=alert(1)>', kind: 'AI', hq: null }], hosting: [] }), /&lt;img/);
});

test('diagrammet er højt nok til den nederste boks, også med mange tjenester og flere hostingsteder', () => {
  const tjeneste = n => ({ name: 'T' + n, kind: 'Tjeneste', hq: null });
  for (const antal of [1, 3, 6]) {
    const svg = view.diagram({ technologies: [], services: Array.from({ length: antal }, (_, n) => tjeneste(n)), hosting: [{ provider: 'Vercel' }, { provider: 'Azure' }, { provider: 'Cloudflare' }] });
    const højde = Number(/viewBox="0 0 700 (\d+)"/.exec(svg)[1]);
    const bunde = [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="\d+" height="(\d+)"/g)].map(m => Number(m[1]) + Number(m[2]));
    assert.ok(højde >= Math.max(...bunde), `${antal} tjenester: højde ${højde}, nederste kant ${Math.max(...bunde)}`);
  }
});
