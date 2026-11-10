// Systemoversigt for et projekt: hvilke teknologier det bruger, hvilke eksterne tjenester og leverandører det taler med, hvilke
// skyer data kan gå til, hvor det hostes, og hvilke hemmeligheder det forventer (kun navne, aldrig værdier). Oversigten udledes af
// projektets egne filer. Den er et overblik, ikke en revision: den finder kun det, der står i koden og i konfigurationen.
const fs = require('node:fs/promises');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.aura', 'dist', 'build', '.next', '.nuxt', '.output', '.venv', 'venv', '__pycache__', 'references', '.cache', 'coverage', '.turbo', '.vite']);
const CODE = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.vue', '.svelte', '.astro', '.py', '.php', '.rb', '.go']);
const MAX_FILES = 400, MAX_BYTES = 200_000, MAX_DEPTH = 6;

// Leverandørens hovedsæde nævnes kun, hvor det er alment kendt. Hvor dataene ligger, kan koden ikke fortælle.
// Første mønster, der passer, vinder: de specifikke værter (AI hos Azure og Google, Firestore) står før de generelle.
const VENDORS = [
  [/(^|\.)openai\.azure\.com$/, { name: 'Azure OpenAI', kind: 'AI', owner: 'Microsoft', hq: 'USA' }],
  [/(^|\.)cognitiveservices\.azure\.com$|(^|\.)services\.ai\.azure\.com$|(^|\.)inference\.ai\.azure\.com$/, { name: 'Azure AI-tjenester', kind: 'AI', owner: 'Microsoft', hq: 'USA' }],
  [/(^|\.)generativelanguage\.googleapis\.com$/, { name: 'Google Gemini', kind: 'AI', owner: 'Google', hq: 'USA' }],
  // Vertex AI har en global vært og regionale værter som europe-west1-aiplatform.googleapis.com.
  [/(^|\.)(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/, { name: 'Google Vertex AI', kind: 'AI', owner: 'Google', hq: 'USA' }],
  [/(^|\.)inference\.alexandra\.dk$/, { name: 'Alexandra AI Platform', kind: 'AI', owner: 'Alexandra Instituttet', hq: 'Danmark' }],
  [/(^|\.)firebaseio\.com$|(^|\.)firebase\.google\.com$|(^|\.)firestore\.googleapis\.com$/, { name: 'Firebase', kind: 'Data', owner: 'Google', hq: 'USA' }],
  [/(^|\.)fonts\.(googleapis|gstatic)\.com$/, { name: 'Google Fonts', kind: 'Skrifttyper', owner: 'Google', hq: 'USA' }],
  [/(^|\.)googleapis\.com$|(^|\.)gstatic\.com$/, { name: 'Google', kind: 'Tjeneste', owner: 'Google', hq: 'USA' }],
  [/(^|\.)googletagmanager\.com$|(^|\.)google-analytics\.com$/, { name: 'Google Analytics', kind: 'Statistik', owner: 'Google', hq: 'USA' }],
  [/(^|\.)cdn\.tailwindcss\.com$/, { name: 'Tailwind (CDN)', kind: 'Kode fra CDN', owner: 'Tailwind Labs', hq: null }],
  [/(^|\.)cdn\.jsdelivr\.net$/, { name: 'jsDelivr (CDN)', kind: 'Kode fra CDN', owner: null, hq: null }],
  [/(^|\.)unpkg\.com$/, { name: 'unpkg (CDN)', kind: 'Kode fra CDN', owner: null, hq: null }],
  [/(^|\.)cdnjs\.cloudflare\.com$/, { name: 'cdnjs (CDN)', kind: 'Kode fra CDN', owner: 'Cloudflare', hq: 'USA' }],
  [/(^|\.)api\.openai\.com$/, { name: 'OpenAI', kind: 'AI', owner: 'OpenAI', hq: 'USA' }],
  [/(^|\.)api\.anthropic\.com$/, { name: 'Anthropic Claude', kind: 'AI', owner: 'Anthropic', hq: 'USA' }],
  [/(^|\.)api\.mistral\.ai$/, { name: 'Mistral', kind: 'AI', owner: 'Mistral AI', hq: 'Frankrig' }],
  [/(^|\.)corti\.app$/, { name: 'Corti', kind: 'AI', owner: 'Corti', hq: 'Danmark' }],
  [/(^|\.)openrouter\.ai$/, { name: 'OpenRouter', kind: 'AI', owner: 'OpenRouter', hq: 'USA' }],
  [/(^|\.)api\.stripe\.com$|(^|\.)js\.stripe\.com$/, { name: 'Stripe', kind: 'Betaling', owner: 'Stripe', hq: 'USA' }],
  [/(^|\.)supabase\.(co|com|in)$/, { name: 'Supabase', kind: 'Data', owner: 'Supabase', hq: 'USA' }],
  // En adresse i koden hos en skyudbyder er et kald til en tjeneste dér, fx et API eller et lager. Hvor appen selv hostes,
  // udledes kun af hostingfiler og .aura/publishing (se nedenfor).
  [/(^|\.)vercel\.(app|com)$/, { name: 'Vercel', kind: 'Skytjeneste', owner: 'Vercel', hq: 'USA' }],
  [/(^|\.)komplai\.(run|dk)$/, { name: 'komplai Run', kind: 'Skytjeneste', owner: 'komplai', hq: 'Danmark' }],
  [/(^|\.)azurestaticapps\.net$|(^|\.)azure\.com$|(^|\.)windows\.net$/, { name: 'Microsoft Azure', kind: 'Skytjeneste', owner: 'Microsoft', hq: 'USA' }],
  [/(^|\.)pages\.dev$|(^|\.)workers\.dev$/, { name: 'Cloudflare', kind: 'Skytjeneste', owner: 'Cloudflare', hq: 'USA' }],
  [/(^|\.)github\.io$|(^|\.)githubusercontent\.com$|(^|\.)api\.github\.com$/, { name: 'GitHub', kind: 'Kode og hosting', owner: 'Microsoft', hq: 'USA' }],
  [/(^|\.)mapbox\.com$|(^|\.)tile\.openstreetmap\.org$|(^|\.)openstreetmap\.org$/, { name: 'Kort', kind: 'Kort', owner: null, hq: null }],
  [/(^|\.)images\.unsplash\.com$|(^|\.)unsplash\.com$/, { name: 'Unsplash', kind: 'Billeder', owner: 'Unsplash', hq: null }],
  [/(^|\.)gravatar\.com$/, { name: 'Gravatar', kind: 'Billeder', owner: 'Automattic', hq: 'USA' }]
];
// Adresser, der ikke er et kald til en leverandør: navnerum, lokale adresser og eksempler.
const IGNORED_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|example\.(com|org)|www\.w3\.org|w3\.org|schema\.org|json-schema\.org|schemas\.[a-z.]+|xmlns\.[a-z.]+|reactjs\.org|react\.dev|developer\.mozilla\.org|npmjs\.com|www\.npmjs\.com|nodejs\.org|opencollective\.com)$/i;

const TECHNOLOGIES = {
  react: ['React', 'Brugerflade'], 'react-dom': null, vue: ['Vue', 'Brugerflade'], svelte: ['Svelte', 'Brugerflade'], '@angular/core': ['Angular', 'Brugerflade'],
  next: ['Next.js', 'Ramme'], nuxt: ['Nuxt', 'Ramme'], astro: ['Astro', 'Ramme'], vite: ['Vite', 'Byggeværktøj'], typescript: ['TypeScript', 'Sprog'],
  tailwindcss: ['Tailwind CSS', 'Design'], express: ['Express', 'Server'], fastify: ['Fastify', 'Server'], koa: ['Koa', 'Server'], hono: ['Hono', 'Server'],
  prisma: ['Prisma', 'Database'], '@prisma/client': null, 'drizzle-orm': ['Drizzle', 'Database'], mongoose: ['MongoDB (Mongoose)', 'Database'], mongodb: ['MongoDB', 'Database'],
  pg: ['PostgreSQL', 'Database'], mysql2: ['MySQL', 'Database'], 'better-sqlite3': ['SQLite', 'Database'], sqlite3: ['SQLite', 'Database'],
  '@supabase/supabase-js': ['Supabase', 'Database'], firebase: ['Firebase', 'Database'], stripe: ['Stripe', 'Betaling'], openai: ['OpenAI', 'AI'], '@anthropic-ai/sdk': ['Anthropic Claude', 'AI'],
  leaflet: ['Leaflet', 'Kort'], 'mapbox-gl': ['Mapbox', 'Kort'], 'chart.js': ['Chart.js', 'Diagrammer'], d3: ['D3', 'Diagrammer']
};
const PY_TECHNOLOGIES = { flask: ['Flask', 'Server'], fastapi: ['FastAPI', 'Server'], django: ['Django', 'Server'], streamlit: ['Streamlit', 'Brugerflade'], sqlalchemy: ['SQLAlchemy', 'Database'], openai: ['OpenAI', 'AI'], anthropic: ['Anthropic Claude', 'AI'], requests: ['requests', 'Netværk'] };
// Miljøopslag, som oversigten genkender: process.env.X, process.env["X"], import.meta.env.X, os.environ["X"], os.environ.get("X"),
// os.getenv("X"), const { X } = process.env, Go's os.Getenv("X") og os.LookupEnv("X") og Rubys ENV["X"] og ENV.fetch("X").
// Alt andet opslag (fx process.env[navn] eller små bogstaver) gør listen usikker. Hver form har netop én fangende gruppe.
const ENV_NAME = '([A-Z][A-Z0-9_]{2,})';
const ENV_FORM_LIST = [`process\\.env\\.${ENV_NAME}`, `import\\.meta\\.env\\.${ENV_NAME}`, `(?:process\\.env|import\\.meta\\.env)\\[\\s*['"\`]${ENV_NAME}['"\`]\\s*\\]`,
  `(?:os\\.)?environ(?:\\.get)?\\(\\s*['"]${ENV_NAME}['"]`, `(?:os\\.)?environ\\[\\s*['"]${ENV_NAME}['"]\\s*\\]`, `(?:os\\.)?getenv\\(\\s*['"]${ENV_NAME}['"]`,
  `\\bos\\.(?:Getenv|LookupEnv)\\(\\s*["\`]${ENV_NAME}["\`]`, `\\bENV\\.fetch[\\s(]\\s*['"]${ENV_NAME}['"]`, `\\bENV\\[\\s*['"]${ENV_NAME}['"]\\s*\\]`];
const ENV_FORMS = new RegExp(ENV_FORM_LIST.join('|'), 'g');
const ENV_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g;
const UNRECOGNIZED_ENV = /\bprocess\.env\b|\bimport\.meta\.env\b|\benviron\b|\bgetenv\b|Deno\.env|\$_ENV|\$_SERVER|\bENV\[|System\.getenv/;
// Sprogets egne opslag, der er tilbage efter de genkendte former. ENV tælles kun i Ruby, hvor det er miljøet og ikke et navn.
// I Go gør viper, envconfig, envPrefix og ExpandEnv uden en fast tekst også listen usikker (N:E-8).
const UNRECOGNIZED_ENV_BY_LANGUAGE = { '.go': /\b(?:Getenv|LookupEnv|Environ|ExpandEnv)\b|\benvconfig\b|\.(?:AutomaticEnv|BindEnv|SetEnvPrefix)\(|\benv(?:Prefix)?:"/, '.rb': /\bENV\b/ };
// Go: os.ExpandEnv med en fast tekst («${NAVN}» og «$NAVN») og struct-tags som env:"NAVN" (fx caarlos0/env) giver navnene.
const GO_EXPAND = /\bos\.ExpandEnv\(\s*(?:"((?:[^"\\\n]|\\.)*)"|`([^`]*)`)\s*\)/g;
const GO_TAG = /\benv:"([A-Z][A-Z0-9_]{2,})(?:,[A-Za-z,]*)?"/g;

// Kommentarer kalder ingenting, men en fjernelse, der tager fejl, kan sluge rigtige kald frem til næste lukker i filen. Derfor læses
// filen i ét stræk fra venstre mod højre: en streng står urørt, også når den indeholder "/*", "//" eller "<!--" (fx `${base}/*` eller
// '<!--'), og den første åbner vinder, så "/*" inde i en //-kommentar ikke starter en blokkommentar. Kun sprogets egne kommentarer
// fjernes: /* */ og // i kode undtagen Python og Ruby, og #-linjer i Python, Ruby og PHP-kode. I HTML, Vue, Svelte, Astro og PHP er
// /* */ og // kun kommentarer i <script>, <style>, PHP's <?php ?> og Astros frontmatter; i almindelig tekst fjernes kun <!-- -->,
// så «Åbent 8-16 // fredag» ikke skjuler et billede senere på linjen (RN:E-1).
// En blokkommentar skal stå efter mellemrum eller tegnsætning og en //-kommentar efter et mellemrum, så "https://…", "//cdn…" og
// "src/**/*.js" står urørt. Efter "}" er "/*" kun en kommentar i CSS: i JavaScript, Python og PHP kan "}" slutte en indsat værdi i en
// streng. Hellere en kommentar for meget med end et kald skjult.
const STRING = /("(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|`(?:[^`\\]|\\[\s\S])*`)/.source;
const LINE_COMMENT = /(^|\s)\/\/(?=\s|$)[^\n]*/.source;
const blockComment = before => `(^|[${before}])\\/\\*[\\s\\S]*?\\*\\/`;
const MARKUP = new Set(['.html', '.htm', '.vue', '.svelte', '.astro', '.php']);
const COMMENTS = {
  code: new RegExp([STRING, blockComment('\\s;{(),'), LINE_COMMENT].join('|'), 'gm'),
  css: new RegExp([STRING, blockComment('\\s;{}(),'), LINE_COMMENT].join('|'), 'gm')
};
// Markup læses i ét stræk som koden: et tag står urørt med sine attributværdier, en <!-- --> og en {/* */} i en skabelon (Astro,
// Svelte og Vue) fjernes, og indholdet af <script>, <style> og <?php ?> (eller til filens slutning) følger kodens regler. En <!-- -->
// om et <script> er derfor en kommentar, og "<!--" i et script eller i en attributværdi er tekst. I almindelig tekst er en apostrof
// eller et anførselstegn ingen streng, så «Don't <!-- … --> it's» stadig er en kommentar (skeptikeren, runde 3).
const MARKUP_TAG = '(<\\/?[a-z][^\\s/>"\'=]*(?:[^>"\']|"[^"]*"|\'[^\']*\')*>)';
const EMBEDDED = new RegExp(['<!--[\\s\\S]*?-->', '\\{\\s*\\/\\*[\\s\\S]*?\\*\\/\\s*\\}', '(<script\\b[^>]*>)([\\s\\S]*?)(?=<\\/script\\s*>|$)', '(<style\\b[^>]*>)([\\s\\S]*?)(?=<\\/style\\s*>|$)', '(<\\?(?:php\\b|=))([\\s\\S]*?)(?=\\?>|$)', MARKUP_TAG].join('|'), 'gi');
const LANGUAGES = { '.py': 'python', '.rb': 'ruby', '.css': 'css' };
// I JSX er teksten mellem tags ingen kode: i «<p>Priser /* foreløbige</p>» og «<p>8-16 // fredag <img …></p>» er «/*» og « // »
// tekst. jsxText ser bagud fra en mulig kommentar: står der kun tekst tilbage til et åbningstag («<p>», «<>») eller til et lukketag,
// et selvlukkende tag eller et {…}-udtryk, som selv står i JSX, er det tekst. Efter det yderste lukketag er det kode igen. Et «>» i
// «=>», «->» og «>=» slutter intet tag, og «Map<string, number>» er en TypeScript-type. Tvivl giver kode som før; vinduet er 8000 tegn.
// Blikket bagud ser strenge og fjernede kommentarer som udfyld, så «<», «>», «{» og «}» i dem ikke ligner JSX. Kun .jsx og .tsx læses
// sådan: i almindelige .js-filer gav regulære udtryk som /[&<>"']/ falske JSX-tags (prøvet på lodash, zod og undici).
const JSX_FILES = new Set(['.jsx', '.tsx']);
const JSX_VALUE = /\{(?:[^{}]|\{[^{}]*\}){0,4000}\}/.source;
const JSX_ATTRIBUTE = `(?:[A-Za-z_$][\\w$.:-]*(?:\\s*=\\s*(?:"[^"]{0,4000}"|'[^']{0,4000}'|${JSX_VALUE}))?|${JSX_VALUE})`;
const JSX_OPEN = new RegExp(`^<([A-Za-z][\\w.:-]*)(?:\\s+${JSX_ATTRIBUTE}){0,40}\\s*(\\/?)>$`);
const jsxOpenAt = new Map();
function selfClosing(text, position, name) {
  if (!jsxOpenAt.has(name)) jsxOpenAt.set(name, new RegExp(`<${name.replaceAll('.', '\\.')}(?:\\s+${JSX_ATTRIBUTE}){0,40}\\s*(\\/?)>`, 'y'));
  const pattern = jsxOpenAt.get(name); pattern.lastIndex = position;
  return pattern.exec(text)?.[1] === '/';
}
// Åbningstagget til et lukketag (eller «<>» til «</>»), fundet bagud med optælling af samme navn.
function openingOf(text, close, name, stop) {
  const pattern = name ? new RegExp(`<(\\/?)${name.replaceAll('.', '\\.')}(?=[\\s/>])`, 'g') : /<(\/?)>/g;
  const found = []; pattern.lastIndex = stop;
  for (let match; (match = pattern.exec(text)) && match.index < close;) found.push(match);
  let level = 1;
  for (const match of found.reverse()) if (match[1]) level++; else if ((!name || !selfClosing(text, match.index, name)) && --level === 0) return match.index;
  return -1;
}
function jsxText(text, index, stop = 0, depth = 0) {
  let i = index - 1;
  while (i >= stop && !'<>{}'.includes(text[i])) i--;
  if (i < stop || depth > 200) return false;
  if (text[i] === '}') {
    let level = 0, j = i;
    for (; j >= stop; j--) if (text[j] === '}') level++; else if (text[j] === '{' && --level === 0) break;
    return j >= stop && jsxText(text, j, stop, depth + 1);
  }
  if (text[i] !== '>' || '=-'.includes(text[i - 1]) || text[i + 1] === '=') return false;
  const open = text.lastIndexOf('<', i);
  if (open < stop) return false;
  const tag = text.slice(open, i + 1);
  if (tag === '<>') return true;
  const close = /^<\/([A-Za-z][\w.:-]*)?\s*>$/.exec(tag);
  if (close) { const start = openingOf(text, open, close[1] || '', stop); return start >= 0 && jsxText(text, start, stop, depth + 1); }
  const opening = JSX_OPEN.exec(tag);
  if (!opening) return false;
  // Et selvlukkende tag og et tag lige efter et navn (fx «Se<b>» i JSX-tekst eller «Array<string>» i TypeScript) er kun JSX, hvis
  // tagget selv står i JSX.
  return opening[2] === '/' || /[\w$.)\]]/.test(text[open - 1] || '') ? jsxText(text, open, stop, depth + 1) : true;
}
function jsxWithoutComments(text) {
  let out = '', last = 0;
  const pattern = new RegExp(COMMENTS.code.source, 'gm'), seen = text.split('');
  const fill = (from, to, mark) => { for (let i = from; i < to; i++) seen[i] = mark; };
  for (let match; (match = pattern.exec(text));) {
    const [whole, string, blockBefore, lineBefore] = match;
    if (string !== undefined) { fill(match.index + 1, match.index + whole.length - 1, 'x'); continue; }
    const before = blockBefore ?? lineBefore ?? '', start = match.index + before.length, stop = Math.max(0, start - 8000);
    // «/*» eller « // » i JSX-tekst: kun de to tegn springes over, og resten af teksten læses videre.
    if (jsxText(seen.slice(stop, start).join(''), start - stop)) { pattern.lastIndex = start + 2; continue; }
    fill(start, match.index + whole.length, ' ');
    out += text.slice(last, match.index) + before + ' '; last = match.index + whole.length;
  }
  return out + text.slice(last);
}
function codeWithoutComments(text, language) {
  let code = text;
  if (language === 'jsx') code = jsxWithoutComments(code);
  else if (!['python', 'ruby'].includes(language)) code = code.replace(language === 'css' ? COMMENTS.css : COMMENTS.code, (whole, string, blockBefore, lineBefore) => string ?? `${blockBefore ?? lineBefore ?? ''} `);
  if (['python', 'ruby', 'php'].includes(language)) code = code.replace(/^[ \t]*#[^\n]*/gm, '');
  return code;
}
function withoutComments(text, ext) {
  if (!MARKUP.has(ext)) return codeWithoutComments(text, LANGUAGES[ext] || (JSX_FILES.has(ext) ? 'jsx' : 'code'));
  // Astros frontmatter mellem de to første ---linjer er JavaScript eller TypeScript.
  const front = ext === '.astro' ? /^(\s*---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text) : null;
  const markup = (front ? text.slice(front[0].length) : text).replace(EMBEDDED, (whole, scriptTag, script, styleTag, style, phpTag, php, tag) =>
    tag !== undefined ? tag : scriptTag !== undefined ? scriptTag + codeWithoutComments(script, 'code') : styleTag !== undefined ? styleTag + codeWithoutComments(style, 'css') : phpTag !== undefined ? phpTag + codeWithoutComments(php, 'php') : ' ');
  return front ? front[1] + codeWithoutComments(front[2], 'code') + front[3] + markup : markup;
}
// Et <a>-tag skal ligne et tag: «<a» efterfulgt af mellemrum, «/» eller «>» og derefter kun attributter med et navn og eventuelt en
// værdi i anførselstegn, uden eller som JSX-udtryk ({…}), og JSX' {...props}. Så er «i<a.length» og «n<a ? …» i (minificeret) kode
// intet tag, og et «>» i en attributværdi slutter ikke tagget (N:E-2). Angulars [routerLink], [(ngModel)], (click), #ref og *ngIf er
// også attributnavne, men kun i netop de former, så «n<a (b > c)» i kode stadig er intet tag.
const ANGULAR_ATTRIBUTE = /\[\(?[\w.:@-]+\)?\]|\([\w.:@-]+\)|[#*][\w.:-]+/.source;
const LINK_TAG = new RegExp(`<a(?:\\s+(?:(?:[a-z_:@][^\\s"'<>\\/=\`{}]*|${ANGULAR_ATTRIBUTE})(?:\\s*=\\s*(?:"[^"]{0,4000}"|'[^']{0,4000}'|${JSX_VALUE}|[^\\s"'=<>\`{}]+))?|${JSX_VALUE})){0,40}\\s*\\/?>`, 'gi');
// En adresse som https://bruger:kode@vaert må kun give værten; brugernavnet og koden læses aldrig som en tjeneste.
function hostsIn(text) {
  const hosts = [];
  for (const match of text.matchAll(/https?:\/\/(?:[^\s\/@?#"'`<>]*@)?([a-z0-9][a-z0-9.-]*[a-z0-9])(?::\d+)?/gi)) {
    const host = match[1].toLowerCase();
    if (!IGNORED_HOSTS.test(host) && host.includes('.')) hosts.push(host);
  }
  return hosts;
}
const HOSTING_FILES = [
  ['vercel.json', 'Vercel'], ['.vercel', 'Vercel'], ['staticwebapp.config.json', 'Microsoft Azure Static Web Apps'], ['wrangler.toml', 'Cloudflare'], ['netlify.toml', 'Netlify'],
  ['Dockerfile', 'Docker (container)'], ['docker-compose.yml', 'Docker (container)'], ['render.yaml', 'Render'], ['fly.toml', 'Fly.io'], ['Procfile', 'Heroku-lignende platform']
];

function vendorOf(host) { for (const [pattern, info] of VENDORS) if (pattern.test(host)) return info; return null; }

async function walk(root) {
  const files = [];
  async function visit(directory, depth) {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await visit(full, depth + 1); }
      else if (entry.isFile() && CODE.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  await visit(root, 0);
  return files;
}
async function readJSON(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
const exists = file => fs.access(file).then(() => true, () => false);

async function analyze(root) {
  const technologies = new Map(), services = new Map(), links = new Map(), secrets = new Map(), hosting = new Map(), notes = [];
  const addTech = (name, kind, source) => { if (!technologies.has(name)) technologies.set(name, { name, kind, source }); };
  let uncertain = false;
  const addSecret = (name, rel) => {
    if (['NODE_ENV', 'PORT', 'HOST', 'MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR'].includes(name)) return;
    if (!secrets.has(name)) secrets.set(name, { name, files: new Set() });
    secrets.get(name).files.add(rel);
  };

  const pkg = await readJSON(path.join(root, 'package.json'));
  if (pkg) {
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) { const t = TECHNOLOGIES[name]; if (t) addTech(t[0], t[1], 'package.json'); }
    addTech('Node.js', 'Kørselsmiljø', 'package.json');
  }
  for (const file of ['requirements.txt', 'pyproject.toml']) {
    let text = ''; try { text = await fs.readFile(path.join(root, file), 'utf8'); } catch { continue; }
    addTech('Python', 'Sprog', file);
    for (const [name, t] of Object.entries(PY_TECHNOLOGIES)) if (new RegExp(`(^|\\n)\\s*["']?${name}\\b`, 'i').test(text)) addTech(t[0], t[1], file);
  }
  if (await exists(path.join(root, 'public', 'index.html')) || await exists(path.join(root, 'index.html'))) addTech('HTML, CSS og JavaScript', 'Brugerflade', 'filer i projektet');

  for (const [file, provider] of HOSTING_FILES) if (await exists(path.join(root, file))) hosting.set(provider, { provider, evidence: file });
  try {
    for (const name of await fs.readdir(path.join(root, '.aura', 'publishing'))) {
      const config = await readJSON(path.join(root, '.aura', 'publishing', name));
      const provider = { komplai: 'komplai Run', vercel: 'Vercel', azure: 'Microsoft Azure Static Web Apps', promte: 'Promte Apps', 'github-pages': 'GitHub Pages', cloudflare: 'Cloudflare Pages' }[config?.provider || name.replace(/\.json$/, '')];
      if (provider) hosting.set(provider, { provider, evidence: `.aura/publishing/${name}` });
    }
  } catch { /* Ingen gemt udgivelsesindstilling. */ }

  const files = await walk(root);
  if (files.length >= MAX_FILES) { notes.push(`Oversigten bygger på de første ${MAX_FILES} kodefiler.`); uncertain = true; }
  for (const file of files) {
    let text; try { const stat = await fs.stat(file); if (stat.size > MAX_BYTES) { uncertain = true; continue; } text = await fs.readFile(file, 'utf8'); } catch { continue; }
    const rel = path.relative(root, file).split(path.sep).join('/');
    // Et almindeligt link (<a href>) er intet kald: browseren går kun dertil, når brugeren klikker. Det står for sig under Se detaljer.
    const code = withoutComments(text, path.extname(file).toLowerCase()).replace(LINK_TAG, tag => {
      for (const host of hostsIn(tag)) { if (!links.has(host)) links.set(host, { name: vendorOf(host)?.name || host, host, files: new Set() }); links.get(host).files.add(rel); }
      return ' ';
    });
    for (const host of hostsIn(code)) {
      const vendor = vendorOf(host);
      const key = vendor ? vendor.name : host;
      if (!services.has(key)) services.set(key, { name: vendor?.name || host, host, hosts: new Set(), kind: vendor?.kind || 'Ukendt tjeneste', owner: vendor?.owner || null, hq: vendor?.hq || null, known: Boolean(vendor), files: new Set() });
      services.get(key).hosts.add(host); services.get(key).files.add(rel);
    }
    // Navne på miljøvariabler i de former, oversigten genkender. Det, der er tilbage af miljøopslag, melder oversigten ærligt.
    let rest = text.replace(ENV_DESTRUCTURE, (whole, inner) => {
      for (const part of inner.split(',')) {
        const name = part.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
        if (!name) continue;
        if (/^[A-Z][A-Z0-9_]{2,}$/.test(name)) addSecret(name, rel); else uncertain = true;
      }
      return ' ';
    });
    rest = rest.replace(ENV_FORMS, (whole, ...groups) => { addSecret(groups.slice(0, ENV_FORM_LIST.length).find(Boolean), rel); return ' '; });
    if (path.extname(file).toLowerCase() === '.go') {
      // Et opslag i en ExpandEnv-tekst, der ikke er et navn med store bogstaver, kan oversigten ikke læse sikkert.
      rest = rest.replace(GO_EXPAND, (whole, quoted, raw) => {
        for (const match of (quoted ?? raw).matchAll(/\$(?:\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g)) { const name = match[1] ?? match[2]; if (/^[A-Z][A-Z0-9_]{2,}$/.test(name)) addSecret(name, rel); else uncertain = true; }
        return ' ';
      }).replace(GO_TAG, (whole, name) => { addSecret(name, rel); return ' '; });
    }
    if (UNRECOGNIZED_ENV.test(rest) || UNRECOGNIZED_ENV_BY_LANGUAGE[path.extname(file).toLowerCase()]?.test(rest)) uncertain = true;
  }
  // Hosting udledes kun af hostingfiler og .aura/publishing: en adresse i koden viser, hvad appen kalder, ikke hvor den ligger.
  // En vært, appen både linker til og kalder, står kun som kald.
  for (const service of services.values()) for (const host of service.hosts) links.delete(host);

  const list = map => [...map.values()].map(item => ({ ...item, ...(item.files ? { files: [...item.files].slice(0, 5) } : {}), ...(item.hosts ? { hosts: [...item.hosts] } : {}) }));
  const result = { technologies: list(technologies), services: list(services).sort((a, b) => Number(b.known) - Number(a.known) || a.name.localeCompare(b.name)), links: list(links).sort((a, b) => a.host.localeCompare(b.host)), hosting: list(hosting), secrets: list(secrets), notes, scanned: files.length, secretsUncertain: uncertain };
  result.externalAI = result.services.filter(item => item.kind === 'AI');
  return result;
}

module.exports = { analyze, vendorOf };
