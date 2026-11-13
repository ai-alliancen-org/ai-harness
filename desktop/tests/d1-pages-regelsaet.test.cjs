// R#31: Pages-workflowet bruger samme hemmelighedsregler som Auras egen gennemgang og nævner filen, når det afviser.
// R#32: en opsætning fra en ældre Aura forklares, i stedet for den almindelige besked om at gemme opsætningen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { secretContent } = require('../core/git.cjs');
const { pagesWorkflow, verifyMaterial, GitHubPagesDeployment } = require('../core/pages-publishing.cjs');

const sha = 'a'.repeat(40), digest = data => createHash('sha256').update(data).digest('hex');
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const anonKey = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' })}.${'SyntetiskSignatur0'.repeat(3)}`;
const googleKey = 'AIza' + ('SyD' + 'x9Qk'.repeat(8)).slice(0, 35);
const samples = {
  // Godkendes af Auras gennemgang og skal derfor også gå igennem workflowet.
  'let sourceToken = 0;': '<script>let sourceToken = 0;</script>',
  'const token = data.accessToken;': '<script>const token = data.accessToken;</script>',
  'const password = form.password.value;': '<script>const password = form.password.value;</script>',
  'minificeret token': '<script>r.token=n.access_token;</script>',
  'adresse-skillens token': '<script>fetch(`https://api.dataforsyningen.dk/adresser/autocomplete?q=${q}&token=adressevaelger123`)</script>',
  'TOKEN=abc123xyz': '<script>TOKEN=abc123xyz</script>',
  'SpinKit': '<style>.sk-chase-dot { animation: sk-chase-dot 2s infinite; }</style>',
  'Supabase anon-nøgle': `<script>createClient('https://x.supabase.co', '${anonKey}')</script>`,
  'Firebase-konfiguration': `<script>const firebaseConfig = { apiKey: "${googleKey}", authDomain: "blomst.firebaseapp.com" };</script>`,
  // Afvises af begge.
  'Gemini-nøgle': `<script>const ai = new GoogleGenAI({ apiKey: "${googleKey}" });</script>`,
  'GitHub-token': '<script>const token = "ghp_' + 'a1B2'.repeat(9) + '";</script>',
  'navngiven nøgle': '<script>const api_key = "kun-syntetisk-testhemmelighed";</script>',
  'JWT i Authorization': '<script>fetch(u, { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk" } })</script>',
  // Anden runde: Authorization med et bogstaveligt token, pladsholderreglen, Supabases hemmelige nøgle og en Gemini-nøgle uden navn.
  'hex-token i Authorization': '<script>fetch(u, { headers: { Authorization: "Bearer 3f2a9c7d1e8b4f6a0c5d2e9b7a1f4c8d" } })</script>',
  'kodeord med min-': '<script>const DB_PASSWORD = "min-kode-2024!xyz";</script>',
  'Supabase hemmelig nøgle': '<script>createClient(url, "sb_' + 'secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz")</script>',
  'Gemini-nøgle uden navn': `<script>const genAI = new GoogleGenerativeAI("${googleKey}");</script>`,
  // Godkendes af begge.
  'Authorization med skabelon': '<script>fetch(u, { headers: { Authorization: `Bearer ${token}` } })</script>',
  'pladsholder med bindestreger': '<script>const api_key = "your-api-key-here";</script>',
  // Skeptikerens fund i reparationen af spor S: ord og pladsholdere i Authorization og en Google Maps-nøgle ved en Gemini-import.
  'Authorization med ord': '<p>Svaret er 401, når headeren mangler: Authorization: Bearer authentication-required</p>',
  'Authorization-pladsholder med tal': '<pre>curl -H "Authorization: Bearer your-token-123" https://api.example.invalid/v1</pre>',
  // Beslutning d: en sætning i et kodeordsfelt er en tekst til læseren; en adgangsfrase uden små ord og et kodeord med tal er det ikke.
  'sætning i kodeordsfelt': '<script>const fejl = { password: "Adgangskoden er forkert" };</script>',
  'engelsk sætning i kodeordsfelt': "<script>const errors = { password: 'The password is required' };</script>",
  'adgangsfrase uden små ord': '<script>const password = "correct horse battery staple";</script>',
  'kodeord med tal i en sætning': '<script>const secret = "the password is hunter2 for sure";</script>',
  'Google Maps ved Gemini-import': `<script type="module">import { GoogleGenAI } from "@google/genai";\nconst ai = new GoogleGenAI({ apiKey: window.GEMINI_API_KEY });\nconst kort = "https://maps.googleapis.com/maps/api/staticmap?center=Kalundborg&key=${googleKey}";</script>`
};

async function material(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-d1-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'w'), runner = path.join(root, 'r');
  await fs.mkdir(runner, { recursive: true });
  const entries = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [file, text] of entries) { const target = path.join(workspace, 'public', file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); }
  const hash = digest(JSON.stringify(entries.map(([file, text]) => [file, digest(Buffer.from(text))])));
  return { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runner, GITHUB_SHA: sha, REVIEWED_SHA: sha, REVIEWED_HASH: hash, AURA_DIRECTORY: 'public' };
}
const outcome = promise => promise.then(() => null, error => error.message);

test('workflowets filkontrol godkender og afviser det samme som Auras gennemgang', async t => {
  for (const [name, text] of Object.entries(samples)) {
    const error = await outcome(verifyMaterial(await material(t, { 'index.html': text })));
    assert.equal(Boolean(error), secretContent(text), `${name}: Aura ${secretContent(text) ? 'afviser' : 'godkender'}, workflowet svarede ${error || 'godkendt'}`);
  }
});

test('workflowets afvisning nævner filen', async t => {
  const error = await outcome(verifyMaterial(await material(t, { 'index.html': '<h1>Hej</h1>', 'js/app.js': samples['GitHub-token'] })));
  assert.match(error, /hemmelighed/);
  assert.match(error, /js\/app\.js/);
});

// Selve scriptet fra den genererede YAML køres alene, som GitHub kører det: YAML læses, og trinnets run-tekst er en
// heredoc, hvis indhold Node får uændret.
function workflowScript(content) {
  const step = require('js-yaml').load(content).jobs.publish.steps.find(item => item.name === 'Kontrollér den gennemgåede version');
  const lines = step.run.split('\n');
  assert.equal(lines[0], "node <<'AURA_NODE'");
  return lines.slice(1, lines.indexOf('AURA_NODE')).join('\n');
}
test('det indlejrede script i workflowet kører alene med samme regler', async t => {
  for (const config of [{ provider: 'github-pages', repository: 'organisation/blomst', branch: 'main', directory: 'public' }, { provider: 'cloudflare', repository: 'organisation/blomst', branch: 'main', directory: 'public', accountId: 'c'.repeat(32), project: 'blomst' }]) {
    const script = workflowScript(pagesWorkflow(config).content);
    assert.doesNotMatch(script, /\$\{\{/, 'GitHub-udtryk må ikke stå i scriptet');
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-d1-script-')), 'verify.cjs');
    t.after(() => fs.rm(path.dirname(file), { recursive: true, force: true }));
    await fs.writeFile(file, script);
    const runScript = async files => spawnSync(process.execPath, [file], { env: { ...process.env, ...await material(t, files) }, encoding: 'utf8' });
    const harmless = await runScript({ 'index.html': samples['let sourceToken = 0;'] });
    assert.equal(harmless.status, 0, `${config.provider}: ${harmless.stderr}`);
    const secret = await runScript({ 'index.html': '<h1>Hej</h1>', 'js/app.js': samples['GitHub-token'] });
    assert.equal(secret.status, 1);
    assert.match(secret.stderr, /hemmelighed i public\/js\/app\.js/);
    // Googles nøgler afgøres ud fra sammenhængen; det skal også kunne køre alene i workflowet.
    const firebase = await runScript({ 'index.html': samples['Firebase-konfiguration'] });
    assert.equal(firebase.status, 0, `${config.provider}: ${firebase.stderr}`);
    const gemini = await runScript({ 'index.html': '<h1>Hej</h1>', 'js/ai.js': samples['Gemini-nøgle'] });
    assert.equal(gemini.status, 1, `${config.provider}: Gemini-nøglen blev godkendt`);
    assert.match(gemini.stderr, /hemmelighed i public\/js\/ai\.js/);
    // N:D1-3: workflowet spærrer et bogstaveligt token i et Authorization-hoved ligesom Aura, og en skabelon går igennem.
    const header = await runScript({ 'index.html': '<h1>Hej</h1>', 'js/api.js': samples['hex-token i Authorization'] });
    assert.equal(header.status, 1, `${config.provider}: tokenet i Authorization blev godkendt`);
    assert.match(header.stderr, /hemmelighed i public\/js\/api\.js/);
    assert.equal((await runScript({ 'index.html': samples['Authorization med skabelon'] })).status, 0, `${config.provider}: skabelonen blev afvist`);
    for (const name of ['Authorization med ord', 'Authorization-pladsholder med tal', 'Google Maps ved Gemini-import', 'sætning i kodeordsfelt', 'engelsk sætning i kodeordsfelt']) {
      const result = await runScript({ 'index.html': samples[name] });
      assert.equal(result.status, 0, `${config.provider}: ${name} blev afvist: ${result.stderr}`);
    }
    for (const name of ['adgangsfrase uden små ord', 'kodeord med tal i en sætning']) {
      const result = await runScript({ 'index.html': '<h1>Hej</h1>', 'js/kode.js': samples[name] });
      assert.equal(result.status, 1, `${config.provider}: ${name} blev godkendt`);
      assert.match(result.stderr, /hemmelighed i public\/js\/kode\.js/);
    }
  }
});

const base = { provider: 'github-pages', repository: 'organisation/blomst', branch: 'main', directory: 'public' };
function github(content) {
  return {
    state: async () => ({ connected: true, expired: false, login: 'bruger' }),
    async api(route) {
      if (route === `/repos/${base.repository}`) return { id: 42, full_name: base.repository, private: false, permissions: { push: true } };
      if (route.includes('/branches/')) return { commit: { sha } };
      if (route.includes('/contents/')) return { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') };
      if (route.endsWith('/pages')) return { html_url: 'https://organisation.github.io/blomst/', public: true, build_type: 'workflow' };
      if (route.includes('/actions/workflows/')) return { id: 13, state: 'active' };
      throw Error(`Uventet testkald: ${route}`);
    }
  };
}

// Vagt: ændres workflowets indhold (også verifyMaterial og secrets.blockingSecret), skal WORKFLOW_VERSION hæves og
// fingeraftrykkene her opdateres. Ellers får brugere med en ældre opsætning den almindelige besked uden forklaring.
test('workflowets indhold hører til sin version', () => {
  const { WORKFLOW_VERSION } = require('../core/pages-publishing.cjs');
  // 3: Googles nøgler er kun offentlige i Google Maps og Firebase (blockingSecret).
  // 4: pladsholdere med tal og store bogstaver uden pladsholderord, adresser med skabelonbruger, Authorization med bogstaveligt token,
  // Supabases sb_secret_ og Gemini-nøgler uden navn (blockingSecret, anden runde af beta 3).
  // 5: den nærmeste sammenhæng afgør en Google-nøgle, og ord og your-pladsholdere i Authorization spærrer ikke (blockingSecret, reparationen
  // efter anden runde af beta 3).
  // 6: en sætning i et kodeords- eller nøglefelt spærrer ikke (blockingSecret, beslutning d, 10. november 2026).
  const pinned = { 2: ['e0306bad4b04d59d37a8b5cf0c01523c863c43f96710d27c096b5fe546c94e4b', 'c5eff1a7dd14266584fbafa0eb0dc0f2477ae6b29bde65917d36a935ab8db97d'], 3: ['ff4ea5938ee48e4543a6bd8efafa8681375beac4ab7185c2a6fbd2fbd0e3ab84', '36696fbd7fe0c1adcdd18a4a37a2756b466b8c2cc99c9906666d93a03890a49f'], 4: ['02dd477cdba571360d2be7e73ce72956deeb98aa0eee522ee5d9eb98a2ca676b', 'c8442d3a0263f241d83fe3a02d0a48fcde4c64e0f3a081895f27e71baeca435b'], 5: ['069904183cc3b8bba0f86f1257d48507dcf5f7eace3bff3b9e484ef2e1132191', '08d536ac400d18f0177a97ff24f0a13cd763e053dbeb2ce8c96bbce4983bcedd'], 6: ['683093fb1152c5d756512add8c4f59e1269332c6a58c890fb61be36bc547b313', 'a295e71842a0f3ebbfae8e2e49802a034b3894bc0afec66fb65d503524d4142d'] };
  const cf = { ...base, provider: 'cloudflare', accountId: 'c'.repeat(32), project: 'blomst' };
  assert.deepEqual([digest(pagesWorkflow(base).content), digest(pagesWorkflow(cf).content)], pinned[WORKFLOW_VERSION], `workflowet er ændret: hæv WORKFLOW_VERSION (nu ${WORKFLOW_VERSION}), og opdatér fingeraftrykkene`);
  assert.match(pagesWorkflow(base).content, new RegExp(`^# Aura Pages-workflow ${WORKFLOW_VERSION}\\.`));
});

test('en udgivelsesopsætning fra en ældre Aura får en forklaring', async () => {
  const current = pagesWorkflow(base).content;
  // Som i 0.7.0-beta.2: Auras workflow uden versionsmærke og med en ældre filkontrol.
  const older = current.replace(/^# Aura Pages-workflow \d+\..*\n/m, '').replace('Udgivelsen overstiger filgrænsen.', 'Udgivelsen er for stor.');
  assert.notEqual(older, current);
  const outdated = await new GitHubPagesDeployment(github(older)).setup(base);
  assert.equal(outdated.ready, false);
  assert.match(outdated.message, /Aura er opdateret/);
  assert.equal(outdated.workflow.outdated, true);
  // Et workflow, Aura ikke har skrevet, og en opsætning fra denne version giver den almindelige besked.
  const foreign = await new GitHubPagesDeployment(github('name: Andet\non: push\n')).setup(base);
  assert.doesNotMatch(foreign.message, /Aura er opdateret/);
  assert.match(foreign.message, /Gem opsætningen i projektet/);
  const ready = await new GitHubPagesDeployment(github(current)).setup(base);
  assert.equal(ready.ready, true);
  assert.equal(ready.workflow.outdated, false);
});
