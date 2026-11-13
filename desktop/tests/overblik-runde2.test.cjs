// Overblik, runde 2 (spor D). N:E-2: «<a» i kode er intet link-tag, så et kald i minificeret kode står som kald. N:E-3: Vertex AI
// genkendes også på de regionale værter. N:E-5: vagterne fyrer for forudsætningen før «/*» og for #-linjer uden for Python, Ruby
// og PHP. N:E-8: Go's os.ExpandEnv og struct-tags giver navnene, og viper og envconfig gør listen usikker. RN:E-1: i HTML-agtige
// filer er «//» og «/* */» kun kommentarer i script, style, PHP og Astros frontmatter. Q:E-4: AI-tjenester står først i diagrammet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyze } = require('../core/system-overview.cjs');
const view = require('../ui/system-overview-view.js');

async function projekt(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-overblik-r2-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}
const vaerter = m => m.services.flatMap(s => s.hosts || [s.host]);
const kaldt = (m, vaert) => vaerter(m).includes(vaert);

// --- N:E-2 ---

test('N:E-2: «<a» i minificeret kode er intet link-tag; kaldet bagefter står som kald, også med et «>» senere i filen', async t => {
  const m = await analyze(await projekt(t, {
    'vendor.min.js': 'for(var i=0;i<a.length;i++)fetch("https://api.openai.com/v1/chat/completions",{method:"POST"});if(b>0)c();',
    'liste.js': 'const x = n<a ? hent("https://api.eksempel-liste.dk/v1") : 0; const y = q > 2;'
  }));
  assert.deepEqual(m.externalAI.map(s => s.name), ['OpenAI'], JSON.stringify(m.links));
  assert.ok(kaldt(m, 'api.eksempel-liste.dk'), JSON.stringify(vaerter(m)));
  assert.deepEqual(m.links, [], 'ingen af dem er links');
});

test('N:E-2: rigtige <a>-tags er stadig links, også over flere linjer, med > i en attribut og i JSX', async t => {
  const m = await analyze(await projekt(t, {
    'index.html': '<a\n  class="kort"\n  title="Gå til > borger.dk"\n  href="https://www.borger.dk/">Borger.dk</a>\n<a href=\'https://www.gentofte.dk\' target=_blank>Gentofte</a>',
    'Side.jsx': 'export const Side = () => <a className="link" href="https://www.kk.dk">KK</a>;',
    // JSX- og Astro-udtryk som værdi, også med en skabelonstreng, og {...props}: fundet i rigtige projekter.
    'Kort.tsx': 'export const Kort = ({ sti, ...props }) => <a {...props} href={`https://www.aarhus.dk/${sti}`} onClick={() => spor("klik")} target={sti.startsWith("https://") ? "_blank" : undefined}>Aarhus</a>;',
    'Vare.astro': '---\nconst { vare } = Astro.props;\n---\n<a href={`https://www.odense.dk/varer/${vare.slug}`} class="group block" data-hover-swap>Odense</a>'
  }));
  assert.deepEqual(m.links.map(l => l.host).sort(), ['www.aarhus.dk', 'www.borger.dk', 'www.gentofte.dk', 'www.kk.dk', 'www.odense.dk']);
  assert.deepEqual(m.services, []);
});

// --- N:E-3 ---

test('N:E-3: Vertex AI på de regionale værter er en AI-leverandør, ikke «Google · Tjeneste»', async t => {
  const m = await analyze(await projekt(t, {
    'vertex.js': [
      'const svar = await fetch(`https://europe-west1-aiplatform.googleapis.com/v1/projects/${p}/locations/europe-west1/publishers/google/models/gemini-1.5-pro:generateContent`, { method: "POST" });',
      'await fetch("https://us-central1-aiplatform.googleapis.com/v1/projects/x/locations/us-central1/endpoints/y:predict", { method: "POST" });'
    ].join('\n')
  }));
  assert.deepEqual(m.externalAI.map(s => s.name), ['Google Vertex AI']);
  assert.deepEqual(m.services.find(s => s.name === 'Google Vertex AI').hosts.sort(), ['europe-west1-aiplatform.googleapis.com', 'us-central1-aiplatform.googleapis.com']);
  assert.equal(m.services.some(s => s.name === 'Google'), false, 'ingen generel Google-række for Vertex-værterne');
  assert.match(view.summary(m).join(' '), /Data kan blive sendt til AI-leverandør: Google Vertex AI \(USA\)\./);
});

// --- N:E-5 ---

test('N:E-5: «/*» i et regulært udtryk efter en skråstreg starter ingen kommentar, der sluger kaldet bagefter', async t => {
  const m = await analyze(await projekt(t, {
    'ruter.js': ["const ruter = /^\\/api\\/*/;", "fetch('https://api.eksempel-rute.dk/v1');", '/* slut */'].join('\n'),
    'glob.ts': ['const alle = minimatch(sti, mappe+"/*");', 'const filer = /\\.js$|\\/*\\.ts$/;', 'await fetch("https://api.eksempel-glob.dk/v1");', '/** Hjælp. */'].join('\n')
  }));
  for (const vaert of ['api.eksempel-rute.dk', 'api.eksempel-glob.dk']) assert.ok(kaldt(m, vaert), `${vaert} mangler: ${JSON.stringify(vaerter(m))}`);
});

test('N:E-5: en linje, der starter med #, er kun en kommentar i Python, Ruby og PHP: et privat felt i JavaScript og et id i CSS er kode', async t => {
  const m = await analyze(await projekt(t, {
    'klient.js': ['class Klient {', '  #endpoint = "https://api.eksempel-klient.dk/v1";', '  hent() { return fetch(this.#endpoint); }', '}'].join('\n'),
    'stil.css': '#logo { background: url("https://billeder.eksempel-cdn.dk/logo.png"); }\n#kort{background:url(https://kort.eksempel-cdn.dk/kort.png)}',
    'app.py': 'import requests\n# Se https://docs.eksempel-python.dk\nrequests.get("https://api.eksempel-python.dk/v1")'
  }));
  for (const vaert of ['api.eksempel-klient.dk', 'billeder.eksempel-cdn.dk', 'kort.eksempel-cdn.dk', 'api.eksempel-python.dk']) assert.ok(kaldt(m, vaert), `${vaert} mangler: ${JSON.stringify(vaerter(m))}`);
  assert.equal(kaldt(m, 'docs.eksempel-python.dk'), false, 'en #-kommentar i Python er stadig intet kald');
});

// --- N:E-8 ---

test('N:E-8: Go os.ExpandEnv("${X}") og struct-tags som env:"X" giver navnene på hemmeligheder', async t => {
  const m = await analyze(await projekt(t, {
    'main.go': 'package main\nimport "os"\nfunc main() {\n  dsn := os.ExpandEnv("postgres://app:${DB_PASSWORD}@db:5432/app?sslmode=$PG_SSLMODE")\n  _ = dsn\n}\n',
    'config.go': 'package config\ntype Config struct {\n  Token string `env:"API_TOKEN,required"`\n  Port  int    `env:"PORT" envDefault:"8080"`\n}\nfunc Load() (c Config) { _ = env.Parse(&c); return }\n'
  }));
  assert.deepEqual(m.secrets.map(s => s.name).sort(), ['API_TOKEN', 'DB_PASSWORD', 'PG_SSLMODE']);
  assert.equal(m.secretsUncertain, false);
  assert.match(view.summary(m).join(' '), /Appen forventer 3 hemmeligheder i sit miljø/);
});

test('N:E-8: viper, envconfig og ExpandEnv uden fast tekst gør listen usikker i stedet for «Ingen navne på hemmeligheder fundet»', async t => {
  for (const [fil, kode] of [
    ['viper.go', 'package main\nfunc main() {\n  viper.AutomaticEnv()\n  pw := viper.GetString("db_password")\n  _ = pw\n}\n'],
    ['bind.go', 'package main\nfunc main() {\n  v := viper.New()\n  v.SetEnvPrefix("app")\n  _ = v.BindEnv("port")\n}\n'],
    ['envconfig.go', 'package main\ntype Spec struct {\n  Password string `envconfig:"DB_PASSWORD"`\n}\nfunc main() { var s Spec; _ = envconfig.Process("myapp", &s) }\n'],
    ['prefix.go', 'package main\ntype Db struct {\n  Password string `env:"PASSWORD"`\n}\ntype Config struct {\n  Db Db `envPrefix:"DB_"`\n}\n'],
    ['expand.go', 'package main\nimport "os"\nfunc main() { s := os.ExpandEnv(skabelon); _ = s }\n']
  ]) {
    const m = await analyze(await projekt(t, { [fil]: kode }));
    assert.equal(m.secretsUncertain, true, fil);
    assert.doesNotMatch(view.noSecrets(m), /^Ingen navne/, fil);
  }
  // En almindelig struct-tag til JSON er intet miljøopslag.
  const json = await analyze(await projekt(t, { 'model.go': 'package model\ntype Borger struct {\n  Navn string `json:"navn"`\n}\n' }));
  assert.equal(json.secretsUncertain, false); assert.deepEqual(json.secrets, []);
});

// --- RN:E-1 ---

test('RN:E-1: i HTML er « // » og «/*» i almindelig tekst ingen kommentar; i script og style er de stadig kommentarer', async t => {
  const m = await analyze(await projekt(t, {
    'index.html': [
      '<p>Åbent 8-16 // fredag 8-14 <img src="https://images.unsplash.com/photo-1"></p>',
      '<p>Priser /* foreløbige</p>',
      '<img src="https://billeder.eksempel-kommune.dk/kort.png">',
      '<!-- Gammel: <img src="https://gammel-billede.eksempel.dk/x.png"> -->',
      '<script>',
      '// Hent åbningstider fra https://docs.eksempel-tider.dk',
      'fetch("https://api.eksempel-tider.dk/v1"); /* https://gammel-script.eksempel.dk */',
      '</script>',
      '<style>/* Tema: https://gammel-tema.eksempel.dk */ body { margin: 0 }</style>'
    ].join('\n')
  }));
  for (const vaert of ['images.unsplash.com', 'billeder.eksempel-kommune.dk', 'api.eksempel-tider.dk']) assert.ok(kaldt(m, vaert), `${vaert} mangler: ${JSON.stringify(vaerter(m))}`);
  for (const vaert of ['gammel-billede.eksempel.dk', 'docs.eksempel-tider.dk', 'gammel-script.eksempel.dk', 'gammel-tema.eksempel.dk']) assert.equal(kaldt(m, vaert), false, `${vaert} er en kommentar`);
});

test('RN:E-1: Astros frontmatter, PHP-kode og Vue-script følger kodens regler, og teksten omkring dem følger HTML', async t => {
  const m = await analyze(await projekt(t, {
    // {/* */} i skabelonen er en kommentar, som i Astro og JSX; fundet i rigtige Astro-filer.
    'src/pages/side.astro': '---\n// Data hentes ved bygning: https://docs.eksempel-astro.dk\nconst svar = await fetch("https://api.eksempel-astro.dk/v1"); /* https://gammel-astro.eksempel.dk */\n---\n{/*\n  Tegningen kommer fra https://skitse.eksempel-astro.dk\n*/}\n<p>Se 2 // 3 <img src="https://images.unsplash.com/photo-2"></p>',
    'side.php': '<?php\n// Konfiguration: https://gammel-php.eksempel.dk\n# Gammel: https://gammel-php2.eksempel.dk\n$svar = file_get_contents("https://api.eksempel-php.dk/v1");\n?>\n<p>Kl. 8 // 16 <img src="https://billeder.eksempel-php-side.dk/x.png"></p>',
    'Kort.vue': '<template><p>A // B <img src="https://billeder.eksempel-vue.dk/y.png"></p></template>\n<script setup>\n// https://gammel-vue.eksempel.dk\nconst svar = await fetch("https://api.eksempel-vue.dk/v1");\n</script>'
  }));
  for (const vaert of ['api.eksempel-astro.dk', 'images.unsplash.com', 'api.eksempel-php.dk', 'billeder.eksempel-php-side.dk', 'billeder.eksempel-vue.dk', 'api.eksempel-vue.dk']) assert.ok(kaldt(m, vaert), `${vaert} mangler: ${JSON.stringify(vaerter(m))}`);
  for (const vaert of ['docs.eksempel-astro.dk', 'gammel-astro.eksempel.dk', 'skitse.eksempel-astro.dk', 'gammel-php.eksempel.dk', 'gammel-php2.eksempel.dk', 'gammel-vue.eksempel.dk']) assert.equal(kaldt(m, vaert), false, `${vaert} er en kommentar`);
});

// --- Q:E-4 ---

test('Q:E-4: AI-tjenester står først i diagrammet, så de ikke falder ud, når appen kalder mere end seks tjenester', async t => {
  const m = await analyze(await projekt(t, {
    'app.js': [
      'https://min-app.workers.dev/x', 'https://projekt.firebaseio.com/x', 'https://api.github.com/x', 'https://www.googletagmanager.com/gtag/js',
      'https://fonts.googleapis.com/css2', 'https://www.gravatar.com/avatar/x', 'https://tile.openstreetmap.org/1/1/1.png', 'https://api.openai.com/v1/responses'
    ].map(adresse => `fetch("${adresse}");`).join('\n')
  }));
  assert.equal(m.services.length, 8);
  assert.deepEqual(m.externalAI.map(s => s.name), ['OpenAI']);
  const svg = view.diagram(m);
  assert.match(svg, />OpenAI</, 'AI-leverandøren står i diagrammet');
  assert.equal((svg.match(/class="so-box so-(?:ext|ai)"/g) || []).length, 6, 'diagrammet viser stadig højst seks tjenester');
  assert.match(view.summary(m).join(' '), /kalde 8 eksterne tjenester/, 'resuméet nævner dem alle');
});
