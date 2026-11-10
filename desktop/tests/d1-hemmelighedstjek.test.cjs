// R#6 og R#26: versioner og Udgiv spærrer kun præcise hemmeligheder, som i 0.7.0-beta.2. Offentlige klientnøgler,
// CSS-navne med sk- og skabeloner i adresser spærrer ikke, men rigtige nøgler gør stadig.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GitVersions, run, secretContent } = require('../core/git.cjs');
const { deploymentArtifact } = require('../core/deployment-artifact.cjs');

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = payload => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'SyntetiskSignatur0'.repeat(3)}`;
const anonKey = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon', iat: 1700000000, exp: 2000000000 });
const serviceKey = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role', iat: 1700000000, exp: 2000000000 });
// Googles nøgler har samme form til Maps, Firebase og Gemini. Kun sammenhængen viser, om nøglen er offentlig.
const googleKey = 'AIza' + ('SyD' + 'x9Qk'.repeat(8)).slice(0, 35);
// Firebase AI Logic: Gemini kaldes gennem Firebase med Firebase-konfigurationens offentlige nøgle.
const firebaseAI = `import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

const firebaseConfig = {
  apiKey: "${googleKey}",
  authDomain: "blomst.firebaseapp.com",
  projectId: "blomst",
  storageBucket: "blomst.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef0123456789"
};

const app = initializeApp(firebaseConfig);
const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });`;

// Almindeligt indhold i testernes projekter, som beta.2 gemte og udgav.
const harmless = {
  'SpinKit-CSS': '.sk-chase { width: 40px; }\n.sk-chase-dot { animation: sk-chase-dot 2s infinite ease-in-out both; }\n.sk-folding-cube .sk-cube { float: left; }\n.sk-circle-fade-dot:before { content: ""; }',
  'SpinKit-HTML': '<div class="sk-chase"><div class="sk-chase-dot"></div><div class="sk-chase-dot"></div></div>',
  'CSS-variabler': ':root { --sk-color-primary: #333; --sk-color-primary-darker-shade: #111; --sk-size: 40px; }',
  'URL-skabelon': 'const url = `postgres://${user}:${pass}@localhost/db`;',
  'URL-pladsholder': '// Eksempel: DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB',
  'URL i vejledning': 'Forbind med mongodb+srv://<username>:<password>@cluster0.example.mongodb.net',
  'Supabase anon-nøgle': `const supabase = createClient('https://abcdefghijklmnopqrst.supabase.co', '${anonKey}');`,
  'Supabase anon-nøgle som apikey': `fetch(url, { headers: { apikey: '${anonKey}' } });`,
  'Google Maps-scripttag': `<script src="https://maps.googleapis.com/maps/api/js?key=${googleKey}&callback=initMap" async></script>`,
  'Google Maps-loader': `const loader = new Loader({ apiKey: "${googleKey}", version: "weekly" });`,
  'Google Maps i React': `const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: "${googleKey}" });`,
  'Google Maps-nøgle i konstant': `const GOOGLE_MAPS_API_KEY = "${googleKey}";`,
  'Google Maps-adresse bygget af konstant': `const API_KEY = "${googleKey}";\nconst script = document.createElement("script");\nscript.src = \`https://maps.googleapis.com/maps/api/js?key=\${API_KEY}&callback=initMap\`;`,
  'Firebase-konfiguration': `const firebaseConfig = { apiKey: "${googleKey}", authDomain: "blomst.firebaseapp.com", projectId: "blomst" };`,
  'Firebase AI Logic': firebaseAI,
  'Firebase-pladsholder': 'const firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_PROJECT.firebaseapp.com" };',
  'Auras egen pladsholder': 'const API_KEY = "DIN_NOEGLE_HER";',
  // Pladsholdere uden tal og variabelnavne som værdi (N:D1-2 og RN:D1-3 må ikke gøre dem til fund).
  'pladsholder med bindestreger': 'const api_key = "your-api-key-here";',
  'pladsholder med HER': 'const DB_PASSWORD = "DIN_ADGANGSKODE_HER";',
  'variabelnavn som værdi': 'const config = { secret: "SUPABASE_SERVICE_ROLE_KEY" };',
  'variabelnavne i adresse': '// DATABASE_URL=postgres://DB_USER:DB_PASSWORD@HOST:5432/DB',
  // Authorization uden bogstaveligt token (N:D1-3).
  'Authorization med skabelon': 'fetch(url, { headers: { Authorization: `Bearer ${token}` } });',
  'Authorization sammensat': "xhr.setRequestHeader('Authorization', 'Bearer ' + token);",
  'Authorization-pladsholder': 'curl -H "Authorization: Bearer YOUR_TOKEN_HERE" https://api.example.invalid/v1',
  'Authorization i vejledning': 'Send headeren Authorization: Bearer <token> med hvert kald.',
  // Supabases offentlige nøgle (Q:D1-6) og Gemini nævnt uden en nøgle (RN:D1-4).
  'Supabase publishable': 'const supabase = createClient(url, "sb_publishable_AbC123dEf456GhI789jKl012");',
  'Gemini uden nøgle': 'const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });',
  // Skeptikerens fund i reparationen af spor S: ord i en vejledning er ikke et token, et token, der begynder med your-, er en pladsholder,
  // og en Google Maps-nøgle afgøres af den nærmeste sammenhæng, ikke af en Gemini-kommentar eller -import et andet sted i filen.
  'Authorization med ord': 'Svaret er 401, når headeren mangler: Authorization: Bearer authentication-required',
  'Authorization-pladsholder med tal': 'curl -H "Authorization: Bearer your-token-123" https://api.example.invalid/v1',
  'Google Maps-scripttag ved Gemini-kommentar': `<!-- GEMINI_API_KEY= står i .env -->\n<script src="https://maps.googleapis.com/maps/api/js?key=${googleKey}&callback=initMap" async></script>`,
  'Google Maps-adresse ved Gemini-import': `import { GoogleGenAI } from '@google/genai';\nconst ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });\nconst kort = \`https://maps.googleapis.com/maps/api/staticmap?center=Kalundborg&key=${googleKey}\`;`,
  'Google Maps-loader ved Gemini-kommentar': `// GEMINI_API_KEY ligger i .env\nconst loader = new Loader({ apiKey: "${googleKey}", version: "weekly" });`
};
// Rigtige hemmeligheder, som stadig spærres.
const secret = {
  'Supabase service_role': `const admin = createClient(url, '${serviceKey}');`,
  'JWT uden rolle': 'const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";',
  'OpenAI-projektnøgle': 'const key = "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";',
  'Anthropic-nøgle': 'headers["x-api-key"] = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx";',
  'adresse med kodeord': 'const u = "postgres://bruger:kodeord123@db.example.invalid/x";',
  'GitHub-token': 'const token = "ghp_' + 'a1B2'.repeat(9) + '";',
  'AWS-nøgle': 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
  'privat nøgle': '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7x\n-----END RSA PRIVATE KEY-----',
  'komplai-adgang': 'const g = "komp_publish_grant_' + 'a1'.repeat(32) + '";',
  'Slack-token': 'const slack = "xoxb-1234567890-abcdefghij";',
  'navngiven nøgle': 'const api_key = "kun-syntetisk-testhemmelighed";',
  'navngivet kodeord': 'const password = "hemmelig-værdi-123";',
  // Googles nøgler uden for Maps og Firebase, fx Gemini, er hemmelige og spærrer som i beta.2.
  'Gemini-nøgle i konstant': `const GEMINI_API_KEY = "${googleKey}";`,
  'Gemini-nøgle i SDK': `const ai = new GoogleGenAI({ apiKey: "${googleKey}" });`,
  'Gemini-nøgle i header': `fetch(url, { headers: { "x-goog-api-key": "${googleKey}" } });`,
  'Gemini-nøgle ved Firebase-konfiguration': `const firebaseConfig = { apiKey: "${googleKey}", authDomain: "blomst.firebaseapp.com" };\nconst GEMINI_API_KEY = "${googleKey}";`,
  'Google-nøgle uden Maps eller Firebase': `const API_KEY = "${googleKey}";`,
  'anden Google-tjeneste ved et kort': `<script src="https://maps.googleapis.com/maps/api/js?key=${googleKey}"></script>\n<script>const YOUTUBE_API_KEY = "${googleKey}";</script>`,
  'Google-nøgle som hemmelighed': `const client_secret = "${googleKey}";`,
  // N:D1-2 og RN:D1-3: rigtige værdier, som beta.2 spærrede, og som pladsholderreglen lod gå igennem (skeptikerens sammenligning).
  'session-hemmelighed med my_': 'app.use(session({ secret: "my_session_secret_8f3k2Lq" }));',
  'kodeord med min-': 'const DB_PASSWORD = "min-kode-2024!xyz";',
  'kodeord med your-': 'const password = "your-own-real-pass-99";',
  'kodeord i store bogstaver': 'const password = "CORRECTHORSEBATTERYSTAPLE";',
  'API-nøgle i store bogstaver': 'const api_key = "PROD_KEY_ALPHA_BRAVO_CHARLIE";',
  'adresse med skabelonbruger og rigtigt kodeord': 'const u = `postgres://${user}:S3cr3tPassw0rd@db.example.invalid/x`;',
  // N:D1-3: et bogstaveligt token i et Authorization-hoved.
  'Authorization med hex-token': 'fetch(url, { headers: { Authorization: "Bearer 3f2a9c7d1e8b4f6a0c5d2e9b7a1f4c8d" } });',
  'Authorization med Basic i skabelonstreng': 'const headers = { "Authorization": `Basic dXNlcjpwYXNzd29yZDEyMw==` };',
  // RN:D1-4: Gemini-nøgler uden navn.
  'Gemini-nøgle uden navn i SDK': `const genAI = new GoogleGenerativeAI("${googleKey}");`,
  'Gemini-nøgle i adresse': `fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${googleKey}");`,
  // Q:D1-6: Supabases hemmelige nøgle.
  'Supabase hemmelig nøgle': 'const supabase = createClient(url, "sb_' + 'secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz");',
  // Skeptikerens fund i reparationen af spor S: et tilfældigt token uden tal spærrer stadig, og den nærmeste sammenhæng afgør en Google-nøgle.
  'Authorization med blandede bogstaver': 'fetch(url, { headers: { Authorization: "Bearer AbCdEfGhIjKlMnOpQr" } });',
  'Gemini-nøgle uden navn ved et kort': `<script src="https://maps.googleapis.com/maps/api/js?callback=initMap" async></script>\n<script>const genAI = new GoogleGenerativeAI("${googleKey}");</script>`,
  'Gemini-nøgle i SDK ved et kort': `const loader = new Loader({ version: "weekly" });\nconst ai = new GoogleGenAI({ apiKey: "${googleKey}" });`
};

test('almindeligt indhold og offentlige klientnøgler spærrer ikke en fil', () => {
  for (const [name, text] of Object.entries(harmless)) assert.equal(secretContent(text), false, name);
});

test('rigtige hemmeligheder spærrer stadig', () => {
  for (const [name, text] of Object.entries(secret)) assert.equal(secretContent(text), true, name);
});

// 0.7.0-beta.2's spærring, ordret fra git.cjs. Alt, den spærrede, spærres stadig, undtagen offentlige klientnøgler,
// pladsholdere og lange CSS-navne med --sk-, som beta.2 tog for en nøgle.
const beta2 = text => /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-|or-v1-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|kp_live_[A-Za-z0-9_-]{43}|komp_publish_(?:grant_)?[a-f0-9]{64})\b/i.test(text) || /(?:api[_-]?key|secret|password|access[_-]?token)\s*["']?\s*[:=]\s*["'][^"'\r\n]{12,}["']/i.test(text);
test('det, beta.2 spærrede, spærres stadig, undtagen offentlige klientnøgler, pladsholdere og CSS-navne', () => {
  const allowed = ['Google Maps-loader', 'Google Maps-loader ved Gemini-kommentar', 'Google Maps i React', 'Google Maps-nøgle i konstant', 'Google Maps-adresse bygget af konstant', 'Firebase-konfiguration', 'Firebase AI Logic', 'Supabase anon-nøgle som apikey', 'Firebase-pladsholder', 'Auras egen pladsholder', 'CSS-variabler', 'pladsholder med bindestreger', 'pladsholder med HER', 'variabelnavn som værdi'];
  for (const [name, text] of Object.entries({ ...harmless, ...secret })) if (beta2(text) && !allowed.includes(name)) assert.equal(secretContent(text), true, name);
  for (const name of allowed) assert.equal(beta2(harmless[name]), true, `prøven dækker undtagelsen ${name}`);
});

test('store filer kontrolleres i lineær tid', () => {
  // Den sidste enhed er en offentlig Firebase-nøgle, så hvert fund får sammenhængen omkring sig undersøgt.
  for (const unit of ['password="', 'api_key = \'', 'sk-aB3', 'eyJabcde.', 'a://b:', 'postgres://u:p', 'AIza', 'ghp_', '-----BEGIN ', 'secret :', `firebase apiKey: "${googleKey}"`, 'Authorization: Bearer', 'authorization :', 'sb_secret_', `gemini ${googleKey}`, `${googleKey} gemini`, 'password = "MY_PASSWORD_A_B_C_D_E_F"']) {
    const big = (unit + ' ').repeat(Math.ceil(2 * 1024 * 1024 / (unit.length + 1)));
    const start = process.hrtime.bigint(); secretContent(big);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 1000, `${unit}: ${ms.toFixed(0)} ms`);
  }
});

async function project(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-d1-hemmelig-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); await fs.mkdir(home);
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') });
  const dir = path.join(root, 'projekt'); await fs.mkdir(path.join(dir, 'public'), { recursive: true });
  await fs.writeFile(path.join(dir, 'public/index.html'), '<h1>Start</h1>');
  const git = new GitVersions(); await git.startProject(dir);
  return { dir, git };
}

test('SpinKit, Supabase anon-nøgle og Google Maps kan gemmes med Gem version og udgives', async t => {
  const { dir, git } = await project(t);
  await fs.writeFile(path.join(dir, 'public/style.css'), harmless['SpinKit-CSS']);
  await fs.writeFile(path.join(dir, 'public/app.js'), harmless['Supabase anon-nøgle']);
  await fs.writeFile(path.join(dir, 'public/index.html'), `<h1>Kort</h1>\n${harmless['Google Maps-scripttag']}`);
  const saved = await git.saveAll(dir, 'Spinner, Supabase og kort');
  assert.deepEqual({ saved: saved.saved, kept: saved.kept }, { saved: 3, kept: [] });
  assert.equal((await run(dir, ['status', '--porcelain', '--untracked-files=all'])).toString(), '', 'arbejdsmappen er ren');
  const artifact = await deploymentArtifact(dir, 'public');
  assert.deepEqual(artifact.files.map(file => file.file), ['app.js', 'index.html', 'style.css']);
});

test('et projekt gemt med beta.2 kan stadig ændres, gemmes og udgives (tidligere indhold spærrer ikke)', async t => {
  const { dir, git } = await project(t);
  // Som i beta.2, der gemte filerne: indholdet ligger allerede i historikken.
  await fs.writeFile(path.join(dir, 'public/style.css'), harmless['SpinKit-CSS']);
  await fs.writeFile(path.join(dir, 'public/app.js'), harmless['Supabase anon-nøgle']);
  await run(dir, ['add', '--', 'public/style.css', 'public/app.js']); await run(dir, ['commit', '-m', 'Gemt i beta.2']);
  await fs.writeFile(path.join(dir, 'public/style.css'), harmless['SpinKit-CSS'] + '\n.sk-chase { width: 48px; }');
  await fs.rm(path.join(dir, 'public/app.js'));
  const review = await git.review(dir);
  assert.deepEqual(review.files.filter(file => file.blocked).map(file => `${file.file}: ${file.blocked}`), []);
  assert.equal((await git.saveAll(dir, 'Større spinner')).saved, 2);
  assert.deepEqual((await deploymentArtifact(dir, 'public')).files.map(file => file.file), ['index.html', 'style.css']);
});

test('Gem version gemmer Firebase-konfigurationen, men ikke en Gemini-nøgle, og nævner filen', async t => {
  const { dir, git } = await project(t);
  await fs.writeFile(path.join(dir, 'public/firebase.js'), harmless['Firebase-konfiguration']);
  await fs.writeFile(path.join(dir, 'public/gemini.js'), secret['Gemini-nøgle i SDK']);
  const saved = await git.saveAll(dir, 'Firebase og Gemini');
  assert.deepEqual({ saved: saved.saved, kept: saved.kept }, { saved: 1, kept: ['public/gemini.js'] });
  const file = (await git.review(dir)).files.find(item => item.file === 'public/gemini.js');
  assert.match(file.blocked, /Mulig hemmelighed i public\/gemini\.js: en nøgle eller adgangskode skrevet direkte i koden/);
});

test('en spærret fil nævner fundets type, så brugeren ved, hvad der skal flyttes', async t => {
  const { dir, git } = await project(t);
  await fs.writeFile(path.join(dir, 'public/config.js'), secret['GitHub-token']);
  const review = await git.review(dir);
  const file = review.files.find(item => item.file === 'public/config.js');
  assert.ok(file.blocked, 'filen er spærret');
  assert.match(file.blocked, /GitHub-token/);
  assert.match(file.blocked, /public\/config\.js/, 'teksten nævner filen, også når den vises som fejl ved en gendannelse');
  assert.equal(JSON.stringify(review).includes('a1B2a1B2'), false, 'værdien står ikke i gennemgangen');
});

test('de nye fund nævner deres type i almindeligt dansk', async t => {
  const { dir, git } = await project(t);
  await fs.writeFile(path.join(dir, 'public/api.js'), secret['Authorization med hex-token']);
  await fs.writeFile(path.join(dir, 'public/db.js'), secret['Supabase hemmelig nøgle']);
  await fs.writeFile(path.join(dir, 'public/ai.js'), secret['Gemini-nøgle uden navn i SDK']);
  await fs.writeFile(path.join(dir, 'public/jwt.js'), secret['JWT uden rolle']);
  const blocked = Object.fromEntries((await git.review(dir)).files.map(file => [file.file, file.blocked]));
  // Skeptikerens fund i reparationen af spor S: teksten bruger ikke fagord som Authorization-hoved eller JWT over for brugeren.
  assert.match(blocked['public/api.js'], /Mulig hemmelighed i public\/api\.js: et adgangstoken skrevet direkte i koden\. /);
  assert.doesNotMatch(Object.values(blocked).join('\n'), /Authorization|JWT|hoved/);
  assert.match(blocked['public/db.js'], /Mulig hemmelighed i public\/db\.js: en hemmelig Supabase-nøgle/);
  assert.match(blocked['public/ai.js'], /Mulig hemmelighed i public\/ai\.js: et adgangstoken/);
  assert.match(blocked['public/jwt.js'], /Mulig hemmelighed i public\/jwt\.js: et adgangstoken\. /);
});

// Q:D1-4: en fil, hvis gemte version rummer en hemmelighed, kunne ikke gemmes, heller ikke efter at hemmeligheden var fjernet
// («Tidligere indhold kræver manuel gennemgang uden for appen.»). Nu kan den nye version gemmes, men teksten fra før vises aldrig.
test('en fil, hvis gemte version rummer en hemmelighed, kan gemmes, når hemmeligheden er fjernet, og teksten fra før vises ikke', async t => {
  const { dir, git } = await project(t);
  const leaked = 'const token = "ghp_' + 'Z9y8'.repeat(9) + '";';
  // Som et projekt, hvor hemmeligheden kom med i en version uden for Aura.
  await fs.writeFile(path.join(dir, 'public/app.js'), leaked + '\nconsole.log("hej");\n');
  await run(dir, ['add', '--', 'public/app.js']); await run(dir, ['commit', '-m', 'Gemt uden for Aura']);
  await fs.writeFile(path.join(dir, 'public/app.js'), 'const token = process.env.TOKEN;\nconsole.log("hej");\n');
  const review = await git.review(dir);
  const file = review.files.find(item => item.file === 'public/app.js');
  assert.equal(file.blocked, undefined, `filen er ikke spærret: ${file.blocked}`);
  assert.equal(file.before, null, 'teksten fra før sendes ikke');
  assert.match(file.beforeHidden, /Teksten fra før vises ikke, fordi den gemte version kan indeholde en nøgle eller adgangskode/);
  assert.match(file.text, /process\.env\.TOKEN/);
  assert.equal(JSON.stringify(review).includes('Z9y8Z9y8'), false, 'hemmeligheden står ikke i gennemgangen');
  const saved = await git.saveAll(dir, 'Nøglen er flyttet ud');
  assert.deepEqual({ saved: saved.saved, kept: saved.kept }, { saved: 1, kept: [] });
  // Står hemmeligheden stadig i filen, er den nye version stadig spærret.
  await fs.writeFile(path.join(dir, 'public/app.js'), leaked + '\n// igen\n');
  assert.match((await git.review(dir)).files.find(item => item.file === 'public/app.js').blocked, /Mulig hemmelighed i public\/app\.js: et GitHub-token/);
});
