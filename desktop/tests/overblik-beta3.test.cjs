// Overblik, beta 3. R#35: tjenester, som koden kalder hos Azure, Vercel, Cloudflare og komplai, står i første lag, og Azure OpenAI,
// Gemini og Alexandra er AI-leverandører. R#37: et almindeligt link og en kommentar er ingen kald. R#40: Go og Ruby giver navnene
// på hemmeligheder, og opslag, oversigten ikke genkender, gør listen usikker.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { analyze } = require('../core/system-overview.cjs');
const view = require('../ui/system-overview-view.js');

async function projekt(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-overblik-b3-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}

// Fanen køres i en afgrænset ramme som i s1-overblik, så teksten under Se detaljer kan læses uden Electron.
function fanetekst(model) {
  class El { constructor(tag, text) { this.tag = tag; this.textContent = text || ''; this.children = []; this.inert = false; } append(...a) { this.children.push(...a); } replaceChildren(...a) { this.children = a; } }
  const elementer = {}, kald = [];
  const sandbox = { window: { SystemOverviewView: view }, node: (tag, text) => new El(tag, text), $: id => (elementer[id] ||= new El(id)), call: () => new Promise(resolve => kald.push(resolve)) };
  vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname, '../ui/system-overview.js'), 'utf8'), sandbox);
  sandbox.window.systemOverview.show(); kald[0]({ value: model });
  return new Promise(resolve => setImmediate(() => resolve(JSON.stringify(elementer['#overview-body'].children, (k, v) => k === 'tag' ? undefined : v))));
}

test('R#35: Azure OpenAI og Azure Blob står i resuméet og diagrammet, og hver Azure-vært kan ses', async t => {
  const m = await analyze(await projekt(t, {
    'package.json': JSON.stringify({ dependencies: { express: '4' } }),
    'server.js': [
      'const svar = await fetch("https://kommune-ai.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-06-01", { method: "POST" });',
      'await fetch("https://kommunedata.blob.core.windows.net/upload/" + navn, { method: "PUT", body: fil });',
      'await fetch("https://kommunekoe.servicebus.windows.net/borgere");'
    ].join('\n')
  }));
  const tekst = view.summary(m).join(' '), svg = view.diagram(m);
  assert.doesNotMatch(tekst, /henter ikke noget fra eksterne tjenester/, tekst);
  assert.match(tekst, /Azure OpenAI/); assert.match(tekst, /Microsoft Azure/);
  assert.match(tekst, /Data kan blive sendt til AI-leverandør: Azure OpenAI \(USA\)\./);
  assert.match(svg, /Azure OpenAI/); assert.match(svg, /Microsoft Azure/);
  assert.deepEqual(m.externalAI.map(s => s.name), ['Azure OpenAI']);
  const azure = m.services.find(s => s.name === 'Microsoft Azure');
  assert.ok(azure, 'Azure Blob står som en tjeneste');
  assert.notEqual(azure.kind, 'Hosting', 'et kald fra koden er ingen hosting');
  assert.deepEqual(azure.hosts, ['kommunedata.blob.core.windows.net', 'kommunekoe.servicebus.windows.net'], 'hver vært står med, ikke kun den første');
  const detaljer = await fanetekst(m);
  for (const vaert of ['kommune-ai.openai.azure.com', 'kommunedata.blob.core.windows.net', 'kommunekoe.servicebus.windows.net']) assert.match(detaljer, new RegExp(vaert.replaceAll('.', '\\.')), vaert);
});

test('R#35: Gemini og Alexandra er AI-leverandører, og Firestore er sin egen række', async t => {
  const m = await analyze(await projekt(t, {
    'app.js': [
      'fetch("https://inference.alexandra.dk/v1/chat/completions", { method: "POST" });',
      'fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + k);',
      'fetch("https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents/borgere");'
    ].join('\n')
  }));
  const navne = Object.fromEntries(m.services.map(s => [s.name, s]));
  assert.deepEqual(m.externalAI.map(s => s.name).sort(), ['Alexandra AI Platform', 'Google Gemini']);
  assert.equal(navne['Alexandra AI Platform'].hq, 'Danmark'); assert.equal(navne['Alexandra AI Platform'].owner, 'Alexandra Instituttet');
  assert.ok(navne.Firebase, 'Firestore bliver ikke slået sammen med Google'); assert.equal(navne.Firebase.host, 'firestore.googleapis.com');
  assert.match(view.summary(m).join(' '), /AI-leverandører: .*Alexandra AI Platform \(Danmark\)/);
});

test('R#35: Vercel, Cloudflare og komplai kaldt fra koden står i første lag, men er stadig ingen hosting', async t => {
  const m = await analyze(await projekt(t, {
    'index.html': '<h1>Hej</h1>',
    'app.js': 'fetch("https://min-api.workers.dev/borgere", { method: "POST", body: tekst });\nfetch("https://andet-api.vercel.app/api/indsend", { method: "POST" });\nfetch("https://tjeneste.komplai.run/api/x");'
  }));
  const tekst = view.summary(m).join(' '), svg = view.diagram(m);
  for (const navn of ['Cloudflare', 'Vercel', 'komplai Run']) { assert.match(tekst, new RegExp(navn), navn); assert.match(svg, new RegExp(navn), navn); }
  assert.deepEqual(m.hosting, []); assert.match(tekst, /kan ikke se, hvor appen hostes/);
});

test('R#37: et almindeligt link og en kommentar er ingen kald; links står for sig under Se detaljer', async t => {
  const m = await analyze(await projekt(t, {
    'index.html': [
      '<script src="https://cdn.tailwindcss.com"></script>',
      '<!-- Se https://tailwindcss.com/docs -->',
      '<a href="https://www.borger.dk">Borger.dk</a> <a class="link" href="https://www.gentofte.dk/" target="_blank">Gentofte Kommune</a>'
    ].join('\n'),
    'app.js': [
      '// Dokumentation: https://docs.eksempel-api.dk/v2',
      '/* Gammel adresse: https://gammel.eksempel-api.dk */',
      'fetch("https://api.eksempel-api.dk/v2/borgere"); // https://status.eksempel-api.dk'
    ].join('\n')
  }));
  assert.deepEqual(m.services.map(s => s.host).sort(), ['api.eksempel-api.dk', 'cdn.tailwindcss.com']);
  assert.deepEqual(m.links.map(l => l.host).sort(), ['www.borger.dk', 'www.gentofte.dk']);
  const tekst = view.summary(m).join(' '), svg = view.diagram(m);
  assert.match(tekst, /kalde 2 eksterne tjenester/, tekst);
  for (const ord of [/borger/, /gentofte/, /tailwindcss\.com/, /docs\.eksempel/, /gammel\.eksempel/, /status\.eksempel/]) { assert.doesNotMatch(tekst, ord, tekst); assert.doesNotMatch(svg, ord); }
  const detaljer = await fanetekst(m);
  assert.match(detaljer, /Links i koden/); assert.match(detaljer, /www\.borger\.dk/); assert.match(detaljer, /www\.gentofte\.dk/);
});

test('R#37: en vært, appen både linker til og kalder, står som kald, og mønstre i tekst sluger ingen kald', async t => {
  const m = await analyze(await projekt(t, {
    'index.html': '<a href="https://api.eksempel-data.dk/docs">Dokumentation</a><script>fetch("https://api.eksempel-data.dk/v1/x")</script>',
    'cors.js': 'const tilladt = ["https://*.kommune.dk"]; const filer = "src/**/*.js";\nfetch("https://api.kommune-data.dk/x"); /* slut */'
  }));
  assert.deepEqual(m.services.map(s => s.host).sort(), ['api.eksempel-data.dk', 'api.kommune-data.dk']);
  assert.deepEqual(m.links, []);
});

// Skeptikerens fund efter R#37: kommentarfjernelsen må aldrig sluge et rigtigt kald. "/*", "//" og "<!--" inde i en streng, en
// //-kommentar med "/*" og Pythons //-operator startede en "kommentar", der slugte koden frem til næste lukker i filen.
const kaldtVaert = (m, vaert) => m.services.some(s => (s.hosts || [s.host]).includes(vaert));

test('R#37: en skabelonstreng med ${…}/* sluger ingen kald (Express og React Router)', async t => {
  const express = await analyze(await projekt(t, {
    'package.json': JSON.stringify({ dependencies: { express: '4' } }),
    'server.js': [
      "const express = require('express');",
      'const app = express();',
      "app.use(`${process.env.BASE || ''}/*`, (req, res, next) => next());",
      "app.post('/api/svar', async (req, res) => {",
      "  const svar = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify(req.body) });",
      '  res.json(await svar.json());',
      '});',
      '/** Starter serveren. */',
      'app.listen(3000);'
    ].join('\n')
  }));
  const tekst = view.summary(express).join(' ');
  assert.deepEqual(express.externalAI.map(s => s.name), ['OpenAI'], tekst);
  assert.match(tekst, /Data kan blive sendt til AI-leverandør: OpenAI \(USA\)\./);
  assert.doesNotMatch(tekst, /henter ikke noget fra eksterne tjenester/);

  const router = await analyze(await projekt(t, {
    'package.json': JSON.stringify({ dependencies: { react: '18', 'react-router-dom': '6' } }),
    'src/App.jsx': [
      "import { Routes, Route } from 'react-router-dom';",
      'const base = import.meta.env.BASE_URL;',
      'export default function App() {',
      '  return (<Routes><Route path={`${base}/*`} element={<Side />} /></Routes>);',
      '}',
      'async function spørg(tekst) {',
      "  return fetch('https://kommune-ai.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-06-01', { method: 'POST', body: tekst });",
      '}',
      'function Side() {',
      '  return (<main>{/* Indholdet kommer her: https://gammel.eksempel-side.dk */}<h1>Hej</h1></main>);',
      '}'
    ].join('\n')
  }));
  assert.deepEqual(router.externalAI.map(s => s.name), ['Azure OpenAI'], view.summary(router).join(' '));
  assert.ok(!kaldtVaert(router, 'gammel.eksempel-side.dk'), 'JSX-kommentaren er stadig intet kald');
});

test('R#37: "/*" i en //-kommentar, "<!--" i en streng og " // " i en streng sluger ingen kald', async t => {
  const m = await analyze(await projekt(t, {
    'routes.js': [
      '// Fang alle stier som /* og send dem til index.html',
      "app.get('*', (req, res) => res.sendFile('index.html'));",
      "const svar = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST' });",
      '/** Hjælpefunktion. */',
      'function hjælp() {}'
    ].join('\n'),
    'skabelon.js': [
      "const start = '<!--';",
      "const svar = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' });",
      "const slut = '-->';"
    ].join('\n'),
    'titel.js': "const titel = 'Borgerservice // Gentofte'; const svar = await fetch('https://api.openai.com/v1/responses', { method: 'POST' });",
    'index.html': '<h1>Hej</h1>\n<script>\nconst markør = "<!--";\nfetch("https://api.dataforsyningen.dk/adresser?q=" + q);\nconst slut = "-->";\n</script>'
  }));
  for (const vaert of ['api.mistral.ai', 'api.anthropic.com', 'api.openai.com', 'api.dataforsyningen.dk']) assert.ok(kaldtVaert(m, vaert), `${vaert} mangler: ${JSON.stringify(m.services.map(s => s.host))}`);
  assert.deepEqual(m.externalAI.map(s => s.name).sort(), ['Anthropic Claude', 'Mistral', 'OpenAI']);
});

test('R#37: Python har hverken /* */ eller //-kommentarer: f"{mappe}/*" og //-division sluger ingen kald', async t => {
  const m = await analyze(await projekt(t, {
    'app.py': [
      'import glob, requests',
      'filer = glob.glob(f"{mappe}/*.pdf")',
      'svar = requests.post("https://api.mistral.ai/v1/chat/completions", headers={"Accept": "*/*"})',
      'def sider(antal):',
      '    return {"sider": antal // 100, "kilde": requests.get("https://api.dataforsyningen.dk/adresser").json()}',
      '# Se https://docs.eksempel-python.dk'
    ].join('\n')
  }));
  for (const vaert of ['api.mistral.ai', 'api.dataforsyningen.dk']) assert.ok(kaldtVaert(m, vaert), `${vaert} mangler: ${JSON.stringify(m.services.map(s => s.host))}`);
  assert.ok(!kaldtVaert(m, 'docs.eksempel-python.dk'), 'en #-kommentar er stadig intet kald');
});

test('R#37: rigtige kommentarer fjernes stadig, også med citationstegn i og efter } i CSS', async t => {
  const m = await analyze(await projekt(t, {
    'a.js': "/* Don't call https://gammel1.eksempel.dk */\n// \"https://gammel2.eksempel.dk\" er lukket\nfetch('https://api.eksempel-nu.dk/x'); /* it's https://gammel3.eksempel.dk */",
    'stil.css': 'body{margin:0}/*! Tema: https://gammel4.eksempel.dk */\nh1 { color: red; } /* "https://gammel5.eksempel.dk" */\n@import url("https://fonts.googleapis.com/css2?family=Inter");',
    'index.html': '<!-- <script src="https://gammel6.eksempel.dk/x.js"></script> -->\n<p>Don\'t</p><script src="https://cdn.tailwindcss.com"></script>'
  }));
  assert.deepEqual(m.services.map(s => s.host).sort(), ['api.eksempel-nu.dk', 'cdn.tailwindcss.com', 'fonts.googleapis.com']);
});

test('R#40: Go os.Getenv og os.LookupEnv og Ruby ENV.fetch og ENV[...] giver navnene, aldrig værdierne', async t => {
  const m = await analyze(await projekt(t, {
    'main.go': 'package main\nimport "os"\nfunc main() {\n  db := os.Getenv("DB_PASSWORD")\n  nøgle, ok := os.LookupEnv("GO_API_KEY")\n}\n',
    'app.rb': 'stripe = ENV.fetch("STRIPE_SECRET")\ntoken = ENV["RB_TOKEN"]\npost = ENV.fetch(\'MAIL_KEY\', nil)\n'
  }));
  assert.deepEqual(m.secrets.map(s => s.name).sort(), ['DB_PASSWORD', 'GO_API_KEY', 'MAIL_KEY', 'RB_TOKEN', 'STRIPE_SECRET']);
  assert.equal(m.secretsUncertain, false);
  assert.doesNotMatch(view.summary(m).join(' '), /kan ikke sige|ufuldstændig/);
});

test('R#40: opslag i Go og Ruby, som oversigten ikke genkender, gør listen usikker; ENV som navn i JavaScript gør ikke', async t => {
  for (const [fil, kode] of [['main.go', 'v := os.Getenv(navn)'], ['main.go', 'for _, e := range os.Environ() {}'], ['app.rb', 'v = ENV.fetch(navn)'], ['app.rb', 'alle = ENV.to_h']]) {
    const m = await analyze(await projekt(t, { [fil]: kode }));
    assert.equal(m.secretsUncertain, true, kode); assert.deepEqual(m.secrets, [], kode);
    assert.match(view.summary(m).join(' '), /kan ikke sige, om appen bruger hemmeligheder/, kode);
    assert.doesNotMatch(view.noSecrets(m), /^Ingen navne/, kode);
  }
  const js = await analyze(await projekt(t, { 'a.js': 'const ENV = "prod"; const k = process.env.API_KEY;' }));
  assert.equal(js.secretsUncertain, false, 'et navn som ENV i JavaScript er intet miljøopslag');
  assert.deepEqual(js.secrets.map(s => s.name), ['API_KEY']);
});
