// Systemoversigt for et projekt: hvilke teknologier det bruger, hvilke eksterne tjenester og leverandører det taler med, hvilke
// skyer data kan gå til, hvor det hostes, og hvilke hemmeligheder det forventer (kun navne, aldrig værdier). Oversigten udledes af
// projektets egne filer. Den er et overblik, ikke en revision: den finder kun det, der står i koden og i konfigurationen.
const fs = require('node:fs/promises');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.aura', 'dist', 'build', '.next', '.nuxt', '.output', '.venv', 'venv', '__pycache__', 'references', '.cache', 'coverage', '.turbo', '.vite']);
const CODE = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.vue', '.svelte', '.astro', '.py', '.php', '.rb', '.go']);
const MAX_FILES = 400, MAX_BYTES = 200_000, MAX_DEPTH = 6;

// Leverandørens hovedsæde nævnes kun, hvor det er alment kendt. Hvor dataene ligger, kan koden ikke fortælle.
const VENDORS = [
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
  [/(^|\.)firebaseio\.com$|(^|\.)firebase\.google\.com$|(^|\.)firestore\.googleapis\.com$/, { name: 'Firebase', kind: 'Data', owner: 'Google', hq: 'USA' }],
  [/(^|\.)vercel\.(app|com)$/, { name: 'Vercel', kind: 'Hosting', owner: 'Vercel', hq: 'USA' }],
  [/(^|\.)komplai\.(run|dk)$/, { name: 'komplai Run', kind: 'Hosting', owner: 'komplai', hq: 'Danmark' }],
  [/(^|\.)azurestaticapps\.net$|(^|\.)azure\.com$|(^|\.)windows\.net$/, { name: 'Microsoft Azure', kind: 'Hosting', owner: 'Microsoft', hq: 'USA' }],
  [/(^|\.)pages\.dev$|(^|\.)workers\.dev$/, { name: 'Cloudflare', kind: 'Hosting', owner: 'Cloudflare', hq: 'USA' }],
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
// os.getenv("X") og const { X } = process.env. Alt andet opslag (fx process.env[navn] eller små bogstaver) gør listen usikker.
const ENV_NAME = '([A-Z][A-Z0-9_]{2,})';
const ENV_FORMS = new RegExp([`process\\.env\\.${ENV_NAME}`, `import\\.meta\\.env\\.${ENV_NAME}`, `(?:process\\.env|import\\.meta\\.env)\\[\\s*['"\`]${ENV_NAME}['"\`]\\s*\\]`,
  `(?:os\\.)?environ(?:\\.get)?\\(\\s*['"]${ENV_NAME}['"]`, `(?:os\\.)?environ\\[\\s*['"]${ENV_NAME}['"]\\s*\\]`, `(?:os\\.)?getenv\\(\\s*['"]${ENV_NAME}['"]`].join('|'), 'g');
const ENV_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g;
const UNRECOGNIZED_ENV = /\bprocess\.env\b|\bimport\.meta\.env\b|\benviron\b|\bgetenv\b|Deno\.env|\$_ENV|\$_SERVER|\bENV\[|System\.getenv/;
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
  const technologies = new Map(), services = new Map(), secrets = new Map(), hosting = new Map(), notes = [];
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
    // En adresse som https://bruger:kode@vaert må kun give værten; brugernavnet og koden læses aldrig som en tjeneste.
    for (const match of text.matchAll(/https?:\/\/(?:[^\s\/@?#"'`<>]*@)?([a-z0-9][a-z0-9.-]*[a-z0-9])(?::\d+)?/gi)) {
      const host = match[1].toLowerCase();
      if (IGNORED_HOSTS.test(host) || !host.includes('.')) continue;
      const vendor = vendorOf(host);
      const key = vendor ? vendor.name : host;
      if (!services.has(key)) services.set(key, { name: vendor?.name || host, host, kind: vendor?.kind || 'Ukendt tjeneste', owner: vendor?.owner || null, hq: vendor?.hq || null, known: Boolean(vendor), files: new Set() });
      services.get(key).files.add(rel);
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
    rest = rest.replace(ENV_FORMS, (whole, ...groups) => { addSecret(groups.slice(0, 6).find(Boolean), rel); return ' '; });
    if (UNRECOGNIZED_ENV.test(rest)) uncertain = true;
  }
  // Hosting udledes kun af hostingfiler og .aura/publishing: et link i koden viser, hvad appen kalder, ikke hvor den ligger.

  const list = map => [...map.values()].map(item => ({ ...item, ...(item.files ? { files: [...item.files].slice(0, 5) } : {}) }));
  const result = { technologies: list(technologies), services: list(services).sort((a, b) => Number(b.known) - Number(a.known) || a.name.localeCompare(b.name)), hosting: list(hosting), secrets: list(secrets), notes, scanned: files.length, secretsUncertain: uncertain };
  result.externalAI = result.services.filter(item => item.kind === 'AI');
  return result;
}

module.exports = { analyze, vendorOf };
