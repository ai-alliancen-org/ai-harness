// Optager OpenCodes rigtige tilladelsesforespørgsler til kontraktprøven i tests/opencode-contract.test.cjs.
// Køres kun manuelt og lokalt, aldrig i CI. Den låste OpenCode startes med en falsk model på 127.0.0.1:
// ingen modelkald, ingen nøgler og intet net ud over maskinen selv.
//
//   node scripts/record-opencode-contract.cjs [sæt eller sæt/navn ...] [--ud <mappe>] [--arbejde <mappe>] [--behold]
//   node scripts/record-opencode-contract.cjs --fra <mappe med rå optagelser> [sæt ...] [--ud <mappe>]
//
// Sættene står i SETS nedenfor. Uden --ud skrives til tests/fixtures/opencode-<VERSION>/, og kun de valgte sæt og
// navne erstattes. Til sidst kører kontrakttestens del 1 på resultatet. Se README.md i fixturemappen.
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn, execFileSync, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { VERSION, findExecutable, isolatedEnv, engineConfig, permissions, writePluginRuntime } = require('../core/engine.cjs');
const DESKTOP = path.join(__dirname, '..');
const REPO = path.join(DESKTOP, '..');
const FIXTURES = path.join(DESKTOP, 'tests', 'fixtures', `opencode-${VERSION}`);
const SYSTEM_TMP = os.tmpdir();
const MODEL = 'kontraktmodel';
const MACHINE = '<sti fra optagemaskinen>';

// ---------- Fælles: falsk model, motorstart og hændelser ----------
const text = message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
const value = (input, context) => typeof input === 'function' ? input(context) : input;
// Hvert svar fra modellen er ét trin: [id, værktøj, argumenter] eller [id, { parallel: [[værktøj, argumenter], ...] }].
// Trinnet findes ud fra antallet af assistentsvar med værktøjskald efter brugerens sidste besked.
async function fakeModel(steps, context = {}) {
  const requests = [], stepOf = new Map(), log = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/side') || req.url.startsWith('/andet')) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Lokal side til webfetch-prøven.\n'); }
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: context.model || MODEL, name: 'Kontraktmodel' }] })); }
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const main = Array.isArray(body.tools) && body.tools.length > 0, messages = body.messages || [];
      const after = messages.slice(messages.findLastIndex(m => m.role === 'user') + 1);
      for (const m of after.filter(m => m.role === 'tool')) { const found = /Full output saved to: (\S+)|full content saved to (\S+)|saved to:? (\/\S+)/.exec(text(m)); if (found) context.toolOutputPath = (found[1] || found[2] || found[3]).replace(/[.,)]+$/, ''); }
      const index = after.filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
      const step = main ? steps[index] : null;
      let delta;
      if (step) {
        const calls = typeof step[1] === 'object' ? step[1].parallel : [[step[1], step[2]]];
        delta = { role: 'assistant', tool_calls: calls.map(([tool, args], n) => { const id = `kald-${index}-${n}`; stepOf.set(id, step[0]); return { index: n, id, type: 'function', function: { name: tool, arguments: JSON.stringify(value(args, context)) } }; }) };
      } else delta = { role: 'assistant', content: main ? 'Færdig med prøven.' : 'Kontraktprøve' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = { id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] };
      res.write('data: ' + JSON.stringify(frame) + '\n\n');
      res.end('data: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n');
    } catch (error) { log.push('model: ' + error.stack); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { port, requests, stepOf, log, provider: { npm: '@ai-sdk/openai-compatible', name: 'Lokal', options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'syntetisk' }, models: { [context.model || MODEL]: { name: context.model || MODEL, tool_call: true, limit: { context: 64000, output: 4096 } } } }, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
// Starter OpenCode uden Workbench, med Auras isolerede miljø og en ændret konfiguration. writePluginRuntime kommer
// før start: uden det lokale plugin-link henter OpenCode @opencode-ai/plugin fra npm (kritik K3).
async function startEngine({ root, directory, config, env = {} }) {
  const executable = await findExecutable();
  await fs.mkdir(path.join(directory, 'home'), { recursive: true });
  await writePluginRuntime(directory);
  const password = randomBytes(32).toString('hex'), auth = 'Basic ' + Buffer.from('harness:' + password).toString('base64');
  const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: root, env: { ...isolatedEnv(directory, config, password), ...env }, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  const url = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('OpenCode startede ikke inden for 120 s. ' + stderr)), 120000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); const found = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (found) { clearTimeout(timer); resolve(found[0]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`OpenCode stoppede under start (${code}). ${stderr}`)); });
  });
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(url + route, { method, headers: { authorization: auth, 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(root) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${raw.slice(0, 200)}`);
    return raw ? JSON.parse(raw) : null;
  };
  const close = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { /* Allerede væk. */ }
    const timer = setTimeout(() => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { /* Allerede væk. */ } }, 3000);
    await exited; clearTimeout(timer);
  };
  return { url, auth, api, close, root };
}
// Følger én sessions hændelser. Handleren kaldes i rækkefølge; en fejl i den stopper ikke strømmen.
function follow(engine, sessionID, handler) {
  const abort = new AbortController();
  (async () => {
    const response = await fetch(engine.url + '/event', { headers: { authorization: engine.auth, 'x-opencode-directory': encodeURIComponent(engine.root) }, signal: abort.signal });
    let buffer = ''; const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true }); const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n'); buffer = blocks.pop();
      for (const block of blocks) {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'); if (!data) continue;
        let event; try { event = JSON.parse(data); } catch { continue; }
        const p = event.properties || {}, owner = p.sessionID || p.part?.sessionID || p.info?.sessionID;
        if (owner && owner !== sessionID) continue;
        try { await handler(event); } catch { /* Optagelsen fortsætter; fejlen ses i resultatet. */ }
      }
    }
  })().catch(() => {});
  return () => abort.abort();
}
const deadline = (ms, label) => { let resolve; const promise = new Promise(r => { resolve = r; setTimeout(() => r(label), ms).unref(); }); return { promise, resolve }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Prøve', GIT_AUTHOR_EMAIL: 'proeve@example.invalid', GIT_COMMITTER_NAME: 'Prøve', GIT_COMMITTER_EMAIL: 'proeve@example.invalid' }, stdio: 'ignore' });
async function fresh(base) { await fs.rm(base, { recursive: true, force: true }); await fs.mkdir(base, { recursive: true }); return fs.realpath(base); }
function auraCommit() {
  try {
    const commit = execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'desktop/core'], { encoding: 'utf8' }).trim();
    return dirty ? commit + '+ændringer' : commit;
  } catch { return 'ukendt'; }
}
async function writeJSON(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 1) + '\n'); }

// ---------- Sæt 1: forløb gennem Workbench -> ChatSession -> OpenCodeEngine ----------
// Svaret er altid "Tillad én gang", så forløbet fortsætter. Auras egen afgørelse gemmes som recordedAura.
const long = 'npm install --no-audit --no-fund --prefer-offline && npm run build --if-present && node -e "console.log(require(\'./package.json\').name)" && echo "Bygget uden fejl i mappen $(pwd) med node $(node --version) og npm $(npm --version)" > build.log && cat build.log';
const FILES = [
  ['read-inde-absolut', 'read', c => ({ filePath: c.W('notes.txt') })],
  ['read-inde-relativ', 'read', () => ({ filePath: 'notes.txt' })],
  ['read-app', 'read', c => ({ filePath: c.W('src/app.js') })],
  ['read-env', 'read', c => ({ filePath: c.W('.env') })],
  ['read-mappe-inde', 'read', c => ({ filePath: c.W('public') })],
  ['read-ude-absolut', 'read', c => ({ filePath: c.O('fil.txt') })],
  ['read-ude-relativ', 'read', () => ({ filePath: '../ekstern/fil2.txt' })],
  ['read-ude-mappe', 'read', c => ({ filePath: c.O() })],
  ['write-inde-absolut', 'write', c => ({ filePath: c.W('public/ny.html'), content: '<p>ny</p>\n' })],
  ['write-inde-relativ', 'write', () => ({ filePath: 'public/ny2.html', content: '<p>ny2</p>\n' })],
  ['write-inde-ny-mappe', 'write', c => ({ filePath: c.W('src/dyb/ny/fil.js'), content: 'export const x = 1;\n' })],
  ['write-env', 'write', c => ({ filePath: c.W('.env.local'), content: 'X=1\n' })],
  ['write-git-mappe', 'write', c => ({ filePath: c.W('.git/aura-proeve.txt'), content: 'x\n' })],
  ['write-ude-absolut', 'write', c => ({ filePath: c.O('ny.txt'), content: 'ny ekstern\n' })],
  ['write-ude-relativ', 'write', () => ({ filePath: '../ekstern/ny2.txt', content: 'ny ekstern 2\n' })],
  ['write-ude-ny-mappe', 'write', c => ({ filePath: c.O('ny-mappe/fil.txt'), content: 'ny mappe\n' })],
  ['write-scratch', 'write', c => ({ filePath: c.S('noter.md'), content: 'midlertidig note\n' })],
  ['edit-inde-absolut', 'edit', c => ({ filePath: c.W('notes.txt'), oldString: 'Hej verden', newString: 'Hej kommune' })],
  ['edit-inde-relativ', 'edit', () => ({ filePath: 'src/app.js', oldString: 'useState', newString: 'useMemo' })],
  ['edit-ude-absolut', 'edit', c => ({ filePath: c.O('fil.txt'), oldString: 'Ekstern', newString: 'Ekstern rettet' })]
];
const doomLoop = ['doom-loop', { parallel: [0, 1, 2].map(() => ['read', c => ({ filePath: c.W('notes.txt') })]) }];
const SEARCH = [
  ['grep-uden-sti', 'grep', () => ({ pattern: 'NEEDLE' })],
  ['grep-sti-inde-absolut', 'grep', c => ({ pattern: 'NEEDLE', path: c.W('src') })],
  ['grep-sti-inde-relativ', 'grep', () => ({ pattern: 'NEEDLE', path: 'src' })],
  ['grep-include', 'grep', () => ({ pattern: 'useState', include: '*.js' })],
  ['grep-hemmelighed', 'grep', () => ({ pattern: 'HEMMELIG' })],
  ['grep-sti-ude', 'grep', c => ({ pattern: 'Ekstern', path: c.O() })],
  ['grep-sti-ude-relativ', 'grep', () => ({ pattern: 'Ekstern', path: '../ekstern' })],
  ['glob-uden-sti', 'glob', () => ({ pattern: '**/*.html' })],
  ['glob-sti-inde', 'glob', c => ({ pattern: '*.js', path: c.W('src') })],
  ['glob-sti-ude', 'glob', c => ({ pattern: '*', path: c.O() })],
  ['list', 'list', c => ({ path: c.W() })],
  ['bash-kort', 'bash', () => ({ command: 'ls public', description: 'Viser filerne i public' })],
  ['bash-lang', 'bash', () => ({ command: long, description: 'Installerer, bygger og skriver en log' })],
  ['bash-workdir-inde', 'bash', c => ({ command: 'ls', workdir: c.W('src'), description: 'Viser src' })],
  ['bash-workdir-ude', 'bash', c => ({ command: 'ls', workdir: c.O(), description: 'Viser ekstern' })],
  ['bash-cat-ude', 'bash', c => ({ command: `cat ${c.O('fil.txt')}`, description: 'Læser en ekstern fil' })],
  ['bash-cat-ude-relativ', 'bash', () => ({ command: 'cat ../ekstern/fil.txt', description: 'Læser en ekstern fil relativt' })],
  ['bash-cd-ud', 'bash', () => ({ command: 'cd .. && ls', description: 'Går et niveau op' })],
  ['bash-npm-build', 'bash', () => ({ command: 'npm run build --if-present', description: 'Bygger projektet' })],
  ['bash-pipe', 'bash', () => ({ command: 'git status --short | head -5', description: 'Viser ændringer' })],
  ['bash-redirect-tmp', 'bash', c => ({ command: `echo hej > ${path.join(c.systmp, 'aura-kontrakt-' + process.pid + '.txt')}`, description: 'Skriver i systemets temp' })],
  ['bash-langt-output', 'bash', () => ({ command: 'seq 1 40000', description: 'Tæller' })],
  ['read-tool-output', 'read', c => ({ filePath: c.toolOutputPath || c.runtime('data/opencode/tool-output/mangler'), offset: 39990, limit: 5 })],
  ['grep-tool-output', 'grep', c => ({ pattern: '^39999$', path: c.toolOutputPath ? path.dirname(c.toolOutputPath) : c.runtime('data/opencode/tool-output') })],
  ['webfetch', 'webfetch', c => ({ url: `http://127.0.0.1:${c.port}/side`, format: 'text' })],
  ['webfetch-localhost-sti', 'webfetch', c => ({ url: `http://localhost:${c.port}/andet?q=1`, format: 'markdown' })],
  ['skill-aktiv', 'skill', c => ({ name: c.skills[0] || 'harness-design-og-tilgaengelighed' })],
  ['skill-indbygget', 'skill', () => ({ name: 'customize-opencode' })],
  ['todowrite', 'todowrite', () => ({ todos: [{ content: 'Trin 1', status: 'in_progress', priority: 'high' }, { content: 'Trin 2', status: 'pending', priority: 'low' }] })],
  ['question', 'question', () => ({ questions: [{ header: 'Farve', question: 'Hvilken farve skal knappen have?', options: [{ label: 'Blå (anbefalet)', description: 'Rolig' }, { label: 'Grøn', description: 'Frisk' }], multiple: false }] })],
  doomLoop
];
const PLAN = [
  ['read-inde-absolut', 'read', c => ({ filePath: c.W('notes.txt') })],
  ['read-ude-absolut', 'read', c => ({ filePath: c.O('fil.txt') })],
  ['write-inde-absolut', 'write', c => ({ filePath: c.W('public/ny.html'), content: '<p>ny</p>\n' })],
  ['write-ude-absolut', 'write', c => ({ filePath: c.O('ny.txt'), content: 'x\n' })],
  ['grep-uden-sti', 'grep', () => ({ pattern: 'NEEDLE' })],
  ['grep-sti-ude', 'grep', c => ({ pattern: 'Ekstern', path: c.O() })],
  ['glob-sti-ude', 'glob', c => ({ pattern: '*', path: c.O() })],
  ['bash-kort', 'bash', () => ({ command: 'ls public', description: 'Viser filerne' })],
  ['webfetch', 'webfetch', c => ({ url: `http://127.0.0.1:${c.port}/side`, format: 'text' })],
  ['todowrite', 'todowrite', () => ({ todos: [{ content: 'Trin 1', status: 'pending', priority: 'high' }] })],
  ['skill-aktiv', 'skill', c => ({ name: c.skills[0] || 'harness-design-og-tilgaengelighed' })],
  ['question', 'question', () => ({ questions: [{ header: 'Farve', question: 'Hvilken farve?', options: [{ label: 'Blå', description: 'Rolig' }, { label: 'Grøn', description: 'Frisk' }], multiple: false }] })],
  doomLoop
];
const COPY = [
  ['read-kopi-absolut', 'read', c => ({ filePath: c.W('notes.txt') })],
  ['read-kopi-relativ', 'read', () => ({ filePath: 'notes.txt' })],
  ['write-kopi-absolut', 'write', c => ({ filePath: c.W('public/ny.html'), content: '<p>kopi</p>\n' })],
  ['write-kopi-relativ', 'write', () => ({ filePath: 'public/ny2.html', content: '<p>kopi2</p>\n' })],
  ['edit-kopi-absolut', 'edit', c => ({ filePath: c.W('notes.txt'), oldString: 'Hej verden', newString: 'Hej kopi' })],
  ['read-original-projekt', 'read', c => ({ filePath: c.P('notes.txt') })],
  ['write-original-projekt', 'write', c => ({ filePath: c.P('public/fra-kopi.html'), content: '<p>forkert sted</p>\n' })],
  ['grep-uden-sti', 'grep', () => ({ pattern: 'NEEDLE' })],
  ['glob-uden-sti', 'glob', () => ({ pattern: '**/*.html' })],
  ['bash-kort', 'bash', () => ({ command: 'ls public', description: 'Viser filerne' })],
  ['bash-workdir-original', 'bash', c => ({ command: 'ls', workdir: c.P(), description: 'Viser projektet' })],
  ['write-scratch', 'write', c => ({ filePath: c.S('noter.md'), content: 'note\n' })]
];
const PARENT = [
  ['write-inde-absolut', 'write', c => ({ filePath: c.W('public/ny.html'), content: '<p>ny</p>\n' })],
  ['write-soeskende-i-repo', 'write', c => ({ filePath: c.R('andet-projekt/fil.txt'), content: 'uden for projektet, inde i repoet\n' })],
  ['read-soeskende-i-repo', 'read', c => ({ filePath: c.R('andet-projekt/eksisterende.txt') })],
  ['grep-soeskende-i-repo', 'grep', c => ({ pattern: 'x', path: c.R('andet-projekt') })],
  ['bash-cat-soeskende', 'bash', c => ({ command: `cat ${c.R('andet-projekt/eksisterende.txt')}`, description: 'Læser' })],
  ['write-uden-for-repo', 'write', c => ({ filePath: c.O('ny.txt'), content: 'helt udenfor\n' })]
];
const PATCH = [
  ['patch-tilfoej-inde', 'apply_patch', () => ({ patchText: '*** Begin Patch\n*** Add File: public/patch.html\n+<p>patch</p>\n*** End Patch' })],
  ['patch-tilfoej-ude-relativ', 'apply_patch', () => ({ patchText: '*** Begin Patch\n*** Add File: ../ekstern/patch.txt\n+ekstern\n*** End Patch' })],
  ['patch-tilfoej-ude-absolut', 'apply_patch', c => ({ patchText: `*** Begin Patch\n*** Add File: ${c.O('patch2.txt')}\n+ekstern\n*** End Patch` })],
  ['patch-opdater-inde', 'apply_patch', () => ({ patchText: '*** Begin Patch\n*** Update File: notes.txt\n@@\n-Hej verden NEEDLE\n+Hej patch NEEDLE\n*** End Patch' })],
  ['patch-to-filer', 'apply_patch', c => ({ patchText: `*** Begin Patch\n*** Add File: public/a.html\n+a\n*** Add File: ${c.O('b.txt')}\n+b\n*** End Patch` })]
];
// apply_patch tilbydes kun til GPT-modeller; derfor modelnavnet i de to patch-forløb.
const FORLOEB = {
  'byg-git-filer': { mode: 'build', git: true, steps: FILES },
  'byg-uden-git-filer': { mode: 'build', git: false, steps: FILES },
  'byg-git-soeg': { mode: 'build', git: true, steps: SEARCH },
  'byg-uden-git-soeg': { mode: 'build', git: false, steps: SEARCH },
  'free-git-filer': { mode: 'free', git: true, steps: FILES.slice(0, 18) },
  'plan-git': { mode: 'plan', git: true, steps: PLAN },
  'samtale-git': { mode: 'chat', git: true, steps: PLAN.slice(0, 9) },
  'kopi-git': { mode: 'build', git: true, copy: true, steps: COPY },
  'git-foraelder': { mode: 'build', git: 'parent', steps: PARENT },
  'apply-patch-git': { mode: 'build', git: true, model: 'gpt-5-kontrakt', steps: PATCH },
  'apply-patch-uden-git': { mode: 'build', git: false, model: 'gpt-5-kontrakt', steps: PATCH }
};
async function recordForloeb(name, base) {
  const { Workbench } = require('../core/workbench.cjs');
  const { OpenCodeEngine } = require('../core/engine.cjs');
  const spec = FORLOEB[name];
  const real = await fresh(base);
  const documents = path.join(real, 'Dokumenter'), repoRoot = spec.git === 'parent' ? path.join(documents, 'repo') : null;
  const root = repoRoot ? path.join(repoRoot, 'projekt') : path.join(documents, 'projekt'), outside = path.join(documents, 'ekstern');
  for (const dir of [path.join(root, 'public'), path.join(root, 'src'), outside]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(root, 'notes.txt'), 'Hej verden NEEDLE\n');
  await fs.writeFile(path.join(root, 'public', 'index.html'), '<h1>Hej</h1>\n');
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'const [a] = useState(0); // NEEDLE\n');
  await fs.writeFile(path.join(root, '.env'), 'HEMMELIG_NEEDLE=syntetisk-hemmelighed\n');
  await fs.writeFile(path.join(outside, 'fil.txt'), 'Ekstern fil\n');
  await fs.writeFile(path.join(outside, 'fil2.txt'), 'Ekstern fil 2\n');
  if (repoRoot) { await fs.mkdir(path.join(repoRoot, 'andet-projekt'), { recursive: true }); await fs.writeFile(path.join(repoRoot, 'andet-projekt', 'eksisterende.txt'), 'x i søskende\n'); git(repoRoot, 'init', '-q', '-b', 'main'); }
  else if (spec.git) git(root, 'init', '-q', '-b', 'main');
  const storeRoot = path.join(real, 'appdata', 'harness');
  const events = [], policyCalls = [], parts = new Map(), log = [];
  let seq = 0, chat = null, bench = null;
  const ctx = {
    get W() { return (...p) => path.join(chat.root, ...p); },
    O: (...p) => path.join(outside, ...p), P: (...p) => path.join(root, ...p), R: (...p) => path.join(repoRoot, ...p),
    get S() { return (...p) => path.join(chat.scratchRoot, ...p); },
    runtime: (...p) => path.join(storeRoot, 'runtime', bench.store.projectKey(chat.root), ...p),
    systmp: os.tmpdir(), port: 0, skills: [], model: spec.model || MODEL
  };
  const model = await fakeModel(spec.steps, ctx); ctx.port = model.port;
  let finished, done; const arm = () => { const d = deadline(600000, 'timeout'); done = d.promise; finished = d.resolve; }; arm();
  bench = new Workbench({ directory: storeRoot, profiles: path.join(REPO, 'profiles'), safeStorage: { isEncryptionAvailable: () => false }, emit: event => {
    // Kortet ville blive vist. Optageren svarer "Tillad én gang", så forløbet fortsætter.
    if (event.type === 'permission.asked') bench.reply({ chat: chat.id, id: event.properties.id, allow: true }).catch(error => log.push('reply: ' + error.message));
    if (event.type === 'question.asked') bench.question({ chat: chat.id, id: event.properties.id, answers: (event.properties.questions || []).map(q => [q.options?.[0]?.label || 'Ja']) }).catch(error => log.push('question: ' + error.message));
    if (event.type === 'run.status' && ['idle', 'error', 'stopped', 'interrupted'].includes(event.status)) finished(event.status);
  }, engineFactory: options => new OpenCodeEngine({ ...options, onEvent: event => {
    const p = event.properties || {};
    if (event.type !== 'message.part.delta') events.push({ seq: ++seq, at: Date.now(), type: event.type, ...(event.type === 'message.part.updated' && p.part?.type === 'tool' ? { callID: p.part.callID, tool: p.part.tool, status: p.part.state?.status, input: p.part.state?.input } : {}), ...(event.type.startsWith('permission.') || event.type.startsWith('question.') ? { properties: p } : {}), ...(event.type === 'session.error' ? { error: p.error } : {}) });
    if (event.type === 'message.part.updated' && p.part?.type === 'tool') parts.set(p.part.callID, structuredClone(p.part));
    if (event.type === 'permission.asked') events.at(-1).toolPartAtAsk = parts.get(p.tool?.callID) ? structuredClone(parts.get(p.tool?.callID)) : null;
    options.onEvent(event);
  } }) });
  const allowed = bench.approvalsPolicy.allowed.bind(bench.approvalsPolicy);
  bench.approvalsPolicy.allowed = async (context, p) => {
    const result = await allowed(context, p).catch(error => ({ allowed: false, thrown: error.message }));
    if (!policyCalls.some(call => call.p.id === p.id)) policyCalls.push({ seq: ++seq, p: structuredClone(p), context: { projectRoot: context.projectRoot, workspaceRoot: context.workspaceRoot, mode: context.mode, scratchRoot: context.scratchRoot, commandSandbox: context.commandSandbox, commandSandboxSupported: context.commandSandboxSupported, autoCommandsSnapshot: context.autoCommandsSnapshot }, result: structuredClone({ allowed: result.allowed, source: result.source, thrown: result.thrown, descriptor: result.descriptor }) });
    return result;
  };
  const started = Date.now();
  try {
    await bench.activate({ root, name: 'Kontraktprøve' }); chat = bench.chat;
    const connection = (await bench.saveConnection({ kind: 'compatible', name: 'Kontrolleret', baseURL: `http://127.0.0.1:${model.port}/v1` })).connections[0];
    ctx.skills = (await bench.skills.context(root)).skills.map(skill => skill.name);
    // Motoren har 30 s til at starte (engine.cjs). Under høj belastning prøves op til tre gange.
    for (let attempt = 1; ; attempt++) {
      try {
        // Den rigtige vej til en samtalekopi: en anden samtale holder projektmappen, så allocate() laver en kopi.
        if (spec.copy) bench.claims.set(root, { id: 'anden-samtale', running: true });
        if (spec.mode === 'build') chat.plan = chat.plan || { id: 'plan-kontrakt', text: 'Byg prøven.', context: '', source: 'ai', at: Date.now() };
        const disclosure = await bench.prepare({ chat: chat.id, connectionID: connection.id, modelID: ctx.model, mode: spec.mode, planID: chat.plan?.id });
        await bench.send({ chat: chat.id, text: 'Kør kontraktprøven.', fingerprint: disclosure.fingerprint });
        log.push(`motorstart lykkedes i forsøg ${attempt}`);
        break;
      } catch (error) { log.push(`forsøg ${attempt}: ${error.message}`); if (attempt >= 3) throw error; await pause(2000); events.length = 0; policyCalls.length = 0; model.requests.length = 0; arm(); }
    }
    const outcome = await done;
    const main = model.requests.filter(body => body.tools?.length), last = main.at(-1);
    const toolResults = last ? last.messages.filter(m => m.role === 'tool').map(m => ({ id: m.tool_call_id, step: model.stepOf.get(m.tool_call_id), content: text(m).slice(0, 1500) })) : [];
    const paths = { BASE: real, DOCUMENTS: documents, ROOT: root, WORKSPACE: chat.root, OUTSIDE: outside, REPO: repoRoot, STORE: storeRoot, SCRATCH: chat.scratchRoot, RUNTIME: path.join(storeRoot, 'runtime', bench.store.projectKey(chat.root)), PROJECTKEY: bench.store.projectKey(root), WORKSPACEKEY: bench.store.projectKey(chat.root), SYSTMP: os.tmpdir(), TOOLOUTPUT: ctx.toolOutputPath || null };
    await writeJSON(path.join(real, 'rapport.json'), { opencode: VERSION, aura: auraCommit(), kilde: 'scripts/record-opencode-contract.cjs forloeb', scenario: name, spec: { mode: spec.mode, git: spec.git, copy: Boolean(spec.copy), model: ctx.model }, outcome, ms: Date.now() - started, paths, toolsOffered: main[0]?.tools.map(tool => tool.function?.name) || [], skills: ctx.skills, steps: spec.steps.map(step => step[0]), toolResults, log: [...log, ...model.log] });
    await writeJSON(path.join(real, 'events.json'), events);
    await writeJSON(path.join(real, 'policy.json'), policyCalls);
    if (!['idle', 'error'].includes(outcome)) throw new Error(`Forløbet ${name} sluttede med "${outcome}". Se ${real}.`);
    return outcome;
  } finally {
    await bench.close().catch(error => console.error('Workbench kunne ikke lukkes:', error.message));
    await model.close();
  }
}

// ---------- Sæt 2: direkte forsøg med ændrede regler, skills og mapper ----------
// Auras isolerede miljø og engineConfig, men en ændret konfiguration. Svaret er altid "once"; spørgsmål får første svar.
const DIREKTE = {
  // Agent-specifikke regler oven på Auras byggeregler i et Git-projekt.
  'regler-git': { git: true, config: L => { const p = permissions(L.root, [], 'build'); return { permission: p, agent: { build: { permission: {
    edit: { '*': 'ask', 'public/*': 'allow', [L.root + '/src/**']: 'allow', [L.rootNoSlash + '/lib/**']: 'allow', '*.env*': 'deny' },
    bash: { '*': 'ask', 'npm run build*': 'allow', 'ls*': 'allow', 'git status*': 'allow' },
    external_directory: { '*': 'ask', [L.outside + '/*']: 'allow' },
    grep: 'allow', glob: 'allow'
  } }, plan: { permission: p } } }; }, steps: L => [
    ['write-public-relativ-regel', 'write', { filePath: L.W('public/a.html'), content: 'a\n' }],
    ['write-src-absolut-regel', 'write', { filePath: L.W('src/b.js'), content: 'b\n' }],
    ['write-lib-uden-skraastreg-regel', 'write', { filePath: L.W('lib/c.js'), content: 'c\n' }],
    ['write-env', 'write', { filePath: L.W('.env.ny'), content: 'x\n' }],
    ['bash-npm-run-build', 'bash', { command: 'npm run build --if-present', description: 'Bygger' }],
    ['bash-npm-run-build-og-rm', 'bash', { command: 'npm run build --if-present && rm -rf ikke-til-stede', description: 'Bygger og sletter' }],
    ['bash-npm-run-buildx', 'bash', { command: 'npm run buildx --if-present', description: 'Ligner build' }],
    ['bash-ls', 'bash', { command: 'ls -la', description: 'Viser' }],
    ['bash-git-status-pipe', 'bash', { command: 'git status --short | head -3', description: 'Status' }],
    ['read-ude-tilladt-mappe', 'read', { filePath: L.O('fil.txt') }],
    ['read-ude-undermappe', 'read', { filePath: L.O('under/dyb.txt') }],
    ['write-ude-tilladt-mappe', 'write', { filePath: L.O('ny.txt'), content: 'x\n' }],
    ['grep-ude-tilladt-mappe', 'grep', { pattern: 'Ekstern', path: L.O() }],
    ['read-andet-sted', 'read', { filePath: L.X('anden.txt') }]
  ] },
  // Samme regler uden Git: filændringernes mønstre er relative til "/", altså uden foranstillet skråstreg.
  'regler-uden-git': { git: false, config: L => { const p = permissions(L.root, [], 'build'); return { permission: p, agent: { build: { permission: {
    edit: { '*': 'ask', 'public/*': 'allow', [L.root + '/src/**']: 'allow', [L.rootNoSlash + '/lib/**']: 'allow', ['*/' + path.basename(L.root) + '/mappe/*']: 'allow' }
  } }, plan: { permission: p } } }; }, steps: L => [
    ['write-public-relativ-regel', 'write', { filePath: L.W('public/a.html'), content: 'a\n' }],
    ['write-src-absolut-regel', 'write', { filePath: L.W('src/b.js'), content: 'b\n' }],
    ['write-lib-uden-skraastreg-regel', 'write', { filePath: L.W('lib/c.js'), content: 'c\n' }],
    ['write-mappe-stjerne-regel', 'write', { filePath: L.W('mappe/d.js'), content: 'd\n' }]
  ] },
  // Skills i projektets .aura/skills via skills.paths og en delt skillmappe uden for projektet.
  // OpenCodes egne standardregler for external_directory bevares her (ingen '*': 'ask' fra Aura).
  'skills-sti': { git: true, skills: true, config: L => { const p = permissions(L.root, [], 'build'); delete p.external_directory; p.skill = { '*': 'deny', 'aura-proeve': 'allow', 'aura-delt': 'allow' }; return { permission: p, agent: { plan: { permission: p } }, skills: { paths: ['.aura/skills', L.shared] } }; }, steps: L => [
    ['skill-i-projektet', 'skill', { name: 'aura-proeve' }],
    ['skill-delt-uden-for', 'skill', { name: 'aura-delt' }],
    ['read-delt-skill-reference', 'read', { filePath: path.join(L.shared, 'aura-delt', 'references', 'ref.md') }],
    ['read-andet-uden-for', 'read', { filePath: L.O('fil.txt') }],
    ['skill-indbygget', 'skill', { name: 'customize-opencode' }]
  ] },
  // TMPDIR og OPENCODE_DB i projektets .aura, XDG i appdata. Hvor ender filerne?
  'mapper': { git: true, env: L => ({ TMPDIR: path.join(L.root, '.aura', 'tmp'), TEMP: path.join(L.root, '.aura', 'tmp'), TMP: path.join(L.root, '.aura', 'tmp'), OPENCODE_DB: path.join(L.root, '.aura', 'opencode', 'opencode.db') }), config: L => { const p = permissions(L.root, [], 'build'); return { permission: p, agent: { plan: { permission: p } } }; }, steps: L => [
    ['bash-tmp', 'bash', { command: 'echo "TMPDIR=$TMPDIR"; node -e "console.log(require(\'os\').tmpdir())"; echo "HOME=$HOME"', description: 'Viser miljø' }],
    ['bash-langt-output', 'bash', { command: 'seq 1 40000', description: 'Tæller' }],
    ['read-tool-output', 'read', c => ({ filePath: c.toolOutputPath, offset: 39990, limit: 3 })],
    ['grep-tool-output', 'grep', c => ({ pattern: '^39999$', path: path.dirname(c.toolOutputPath) })],
    ['write-aura-tmp', 'write', { filePath: L.W('.aura/tmp/noter.md'), content: 'note\n' }]
  ] },
  // Et link i projektet, der peger ud. edit og grep står til 'allow' her, så kun external_directory kan spørge.
  'symlink': { git: true, link: true, config: L => { const p = permissions(L.root, [], 'build'); p.edit = { '*': 'allow' }; p.grep = 'allow'; return { permission: p, agent: { plan: { permission: p } } }; }, steps: L => [
    ['write-gennem-link', 'write', { filePath: L.W('link/via-link.txt'), content: 'skrevet gennem et link\n' }],
    ['read-gennem-link-uden-laesevagt', 'read', { filePath: L.W('link/fil.txt') }],
    ['grep-gennem-link', 'grep', { pattern: 'Ekstern', path: L.W('link') }],
    ['glob-gennem-link', 'glob', { pattern: '*', path: L.W('link') }],
    ['bash-cat-gennem-link', 'bash', { command: 'cat link/fil.txt', description: 'Læser' }]
  ] },
  // Former, som Auras konfiguration aldrig sender til godkendelse: skill, todowrite og question sat til 'ask'.
  'spoerg-alt': { git: true, skills: true, config: L => { const p = permissions(L.root, [], 'build'); p.skill = { '*': 'ask' }; p.todowrite = 'ask'; p.question = 'ask'; return { permission: p, agent: { plan: { permission: p } }, skills: { paths: ['.aura/skills'] } }; }, steps: () => [
    ['skill', 'skill', { name: 'aura-proeve' }],
    ['todowrite', 'todowrite', { todos: [{ content: 'Trin', status: 'pending', priority: 'high' }] }],
    ['question', 'question', { questions: [{ header: 'Valg', question: 'Blå eller grøn?', options: [{ label: 'Blå', description: 'x' }, { label: 'Grøn', description: 'y' }], multiple: false }] }]
  ] }
};
async function listing(dir, base, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules') { out.push(full + ' (link/mappe, ikke gennemgået)'); continue; }
    if (entry.isDirectory()) { out.push(full + '/'); await listing(full, base, out, depth + 1); } else out.push(full + ' ' + (await fs.lstat(full)).size);
  }
  return out;
}
async function recordDirekte(name, base) {
  const spec = DIREKTE[name];
  const real = await fresh(base);
  const root = path.join(real, 'Dokumenter', 'projekt'), outside = path.join(real, 'Dokumenter', 'ekstern'), shared = path.join(real, 'delte-skills'), elsewhere = path.join(real, 'andet-sted');
  for (const dir of [path.join(root, 'public'), path.join(root, 'src'), path.join(outside, 'under'), elsewhere]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(root, 'notes.txt'), 'Hej NEEDLE\n'); await fs.writeFile(path.join(outside, 'fil.txt'), 'Ekstern\n'); await fs.writeFile(path.join(outside, 'under', 'dyb.txt'), 'Dyb ekstern\n'); await fs.writeFile(path.join(elsewhere, 'anden.txt'), 'Andet sted\n');
  if (spec.skills) for (const [dir, skill] of [[path.join(root, '.aura', 'skills'), 'aura-proeve'], [shared, 'aura-delt']]) {
    await fs.mkdir(path.join(dir, skill, 'references'), { recursive: true });
    await fs.writeFile(path.join(dir, skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: Prøveskill ${skill} til kontraktprøven.\n---\n\n# ${skill}\n\nLæs references/ref.md.\n`);
    await fs.writeFile(path.join(dir, skill, 'references', 'ref.md'), `Reference for ${skill}.\n`);
  }
  if (spec.link) await fs.symlink(outside, path.join(root, 'link'));
  if (spec.git) git(root, 'init', '-q', '-b', 'main');
  const L = { root, rootNoSlash: root.slice(1), outside, shared, W: (...p) => path.join(root, ...p), O: (...p) => path.join(outside, ...p), X: (...p) => path.join(elsewhere, ...p) };
  const model = await fakeModel(spec.steps(L), L);
  const directory = path.join(real, 'appdata', 'runtime');
  const extra = spec.config(L), config = { ...engineConfig(model.provider, { id: MODEL }, extra.permission), ...extra };
  const env = spec.env ? spec.env(L) : {};
  if (env.TMPDIR) await fs.mkdir(env.TMPDIR, { recursive: true });
  if (env.OPENCODE_DB) await fs.mkdir(path.dirname(env.OPENCODE_DB), { recursive: true });
  const out = { opencode: VERSION, aura: auraCommit(), kilde: 'scripts/record-opencode-contract.cjs direkte (Auras isolatedEnv og engineConfig med ændrede regler, skills eller mapper)', experiment: name, base: real, paths: { root, outside, shared, directory, env: Object.fromEntries(Object.entries(env)) } };
  const engine = await startEngine({ root, directory, config, env });
  const asked = [], results = [];
  let stop = () => {};
  try {
    for (const route of ['/path', '/agent', '/skill', '/project/current', '/config']) out[route] = await engine.api(route).catch(error => ({ fejl: error.message }));
    const session = await engine.api('/session', 'POST', { title: 'Prøve' });
    const d = deadline(300000, 'timeout');
    stop = follow(engine, session.id, async event => {
      const p = event.properties || {};
      if (event.type === 'permission.asked') { asked.push({ step: model.stepOf.get(p.tool?.callID), permission: p.permission, patterns: p.patterns, always: p.always, metadata: Object.fromEntries(Object.entries(p.metadata || {}).filter(([key]) => key !== 'diff')) }); await engine.api(`/permission/${encodeURIComponent(p.id)}/reply`, 'POST', { reply: 'once' }); }
      if (event.type === 'question.asked') await engine.api(`/question/${encodeURIComponent(p.id)}/reply`, 'POST', { answers: (p.questions || []).map(q => [q.options?.[0]?.label || 'Ja']) });
      if (event.type === 'message.part.updated' && p.part?.type === 'tool' && ['completed', 'error'].includes(p.part.state?.status)) results.push({ step: model.stepOf.get(p.part.callID), status: p.part.state.status, output: String(p.part.state.output || p.part.state.error || '').replace(/\s+/g, ' ').slice(0, 300) });
      if (event.type === 'session.idle' || (event.type === 'session.status' && p.status?.type === 'idle')) d.resolve('idle');
      if (event.type === 'session.error') d.resolve('error ' + JSON.stringify(p.error).slice(0, 300));
    });
    await pause(300);
    await engine.api(`/session/${session.id}/prompt_async`, 'POST', { model: { providerID: 'harness', modelID: MODEL }, agent: 'build', parts: [{ type: 'text', text: 'Kør prøven.' }] });
    out.outcome = await d.promise;
    out.toolsOffered = model.requests.find(body => body.tools?.length)?.tools.map(tool => tool.function?.name);
    out.asked = asked; out.results = results;
    out.files = [...await listing(directory), ...await listing(path.join(root, '.aura'))];
  } finally {
    stop(); await engine.close(); await model.close();
    await writeJSON(path.join(real, 'resultat.json'), out);
  }
  if (out.outcome !== 'idle') throw new Error(`Forsøget ${name} sluttede med "${out.outcome}". Se ${real}.`);
  return out.outcome;
}

// ---------- Sæt 3: en typisk byggeopgave med og uden HEADs kommandosandkasse ----------
// Rigtig OpenCodeEngine. npm, npx og curl er stubbe uden net. Kald, der ville forlade maskinen eller skrive uden for,
// afvises med en besked; gentagelsesvagten afvises også med en besked, hvilket stopper opgaven (målt).
const POLITIK = {
  'uden-sandkasse': { sandbox: false, steps: (root, outside) => [
    ['ls', 'bash', { command: 'ls -la', description: 'Viser filer' }],
    ['npm-install', 'bash', { command: 'npm install', description: 'Installerer pakker' }],
    ['npm-install-pakke', 'bash', { command: 'npm install react-router-dom@7', description: 'Installerer en ny pakke' }],
    ['npm-build-tail', 'bash', { command: 'npm run build 2>&1 | tail -20', description: 'Bygger' }],
    ['git-status-diff', 'bash', { command: 'git status && git diff --stat', description: 'Ser ændringer' }],
    ['cd-ud', 'bash', { command: 'cd .. && ls', description: 'Går ud af projektet' }],
    ['workdir-ude', 'bash', { command: 'ls', description: 'Arbejdsmappe udenfor', workdir: outside }],
    ['rm-mappe', 'bash', { command: 'rm -rf gammel', description: 'Sletter en mappe' }],
    ['npm-global', 'bash', { command: 'npm i -g serve', description: 'Installerer globalt' }],
    ['curl-lokal', 'bash', { command: 'curl -s http://127.0.0.1:1/', description: 'Henter lokal side' }],
    ['npx-vite', 'bash', { command: 'npx vite --port 5199', description: 'Starter appen' }],
    ['cat-ssh', 'bash', { command: 'cat ~/.ssh/id_rsa', description: 'Læser nøgle' }],
    ['echo-ud', 'bash', { command: `echo x > ${JSON.stringify(path.join(outside, 'ud.txt'))}`, description: 'Skriver udenfor via shell' }],
    ['grep-uden-sti', 'grep', { pattern: 'useState' }],
    ['grep-relativ', 'grep', { pattern: 'useState', path: 'src' }],
    ['grep-env', 'grep', { pattern: 'HEMMELIG', path: root }],
    ['grep-ude', 'grep', { pattern: 'Udenfor', path: outside }],
    ['glob-inde', 'glob', { pattern: '**/*.jsx' }],
    ['glob-ude', 'glob', { pattern: '*', path: outside }],
    ['list-ude', 'list', { path: outside }],
    ['read-ude', 'read', { filePath: path.join(outside, 'noter.txt') }],
    ['read-env', 'read', { filePath: path.join(root, '.env') }],
    ['write-inde', 'write', { filePath: path.join(root, 'src', 'Ny.jsx'), content: 'export default 1\n' }],
    ['edit-inde', 'edit', { filePath: path.join(root, 'src', 'App.jsx'), oldString: "import { useState } from 'react'", newString: "import { useState, useEffect } from 'react'" }],
    ['write-ude', 'write', { filePath: path.join(outside, 'skrevet.txt'), content: 'x\n' }],
    ['write-env', 'write', { filePath: path.join(root, '.env.local'), content: 'X=1\n' }],
    ['write-references', 'write', { filePath: path.join(root, 'references', 'x.txt'), content: 'x\n' }],
    ['webfetch-lokal', 'webfetch', { url: 'http://127.0.0.1:1/docs', format: 'text' }],
    ['webfetch-ude', 'webfetch', { url: 'https://eksempel.invalid/docs', format: 'text' }],
    ['gentagelse', { parallel: [0, 1, 2].map(() => ['read', { filePath: path.join(root, 'src', 'App.jsx') }]) }],
    ['udgiv-og-web', { parallel: [['bash', { command: 'npm publish', description: 'Udgiver' }], ['webfetch', { url: 'https://andet.invalid/', format: 'text' }]] }],
    ['efter-parallel', 'bash', { command: 'echo efter-parallel', description: 'Kører efter de parallelle kald' }]
  ] },
  'sandkasse': { sandbox: true, steps: (root, outside) => [
    ['ls', 'bash', { command: 'ls -la', description: 'Viser filer' }],
    ['git-status-diff', 'bash', { command: 'git status && git diff --stat', description: 'Ser ændringer' }],
    ['pipe', 'bash', { command: 'echo hej | tr a-z A-Z', description: 'Pipeline' }],
    ['cd-ud', 'bash', { command: 'cd .. && ls', description: 'Går ud af projektet' }],
    ['workdir-ude', 'bash', { command: 'ls', description: 'Arbejdsmappe udenfor', workdir: outside }]
  ] }
};
async function recordPolitik(name, base) {
  const { OpenCodeEngine } = require('../core/engine.cjs');
  const spec = POLITIK[name];
  const real = await fresh(base);
  const root = path.join(real, 'Projekt'), appdata = path.join(real, 'appdata'), directory = path.join(appdata, 'runtime', 'noegle'), scratch = path.join(appdata, 'scratch', 'noegle', 'opgave'), outside = path.join(real, 'udenfor'), bin = path.join(real, 'bin');
  for (const dir of [root, directory, scratch, outside, bin, path.join(root, 'src'), path.join(root, 'public'), path.join(root, 'gammel')]) await fs.mkdir(dir, { recursive: true });
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  // Stubbe uden net. Git får hverken brugerens eller systemets konfiguration.
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  for (const tool of ['npm', 'npx', 'curl']) await fs.writeFile(path.join(bin, tool), `#!/bin/sh\necho "[stub ${tool}] $@"\nexit 0\n`, { mode: 0o755 });
  await fs.writeFile(path.join(root, 'public', 'index.html'), '<!doctype html><h1>Start</h1>\n');
  await fs.writeFile(path.join(root, 'src', 'App.jsx'), "import { useState } from 'react'\n");
  await fs.writeFile(path.join(root, '.env'), 'HEMMELIG=syntetisk-hemmelighed-123\n');
  await fs.writeFile(path.join(outside, 'noter.txt'), 'Udenfor\n');
  for (let i = 0; i < 30; i++) await fs.writeFile(path.join(root, 'gammel', `f${i}.txt`), 'x');
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'start');
  const steps = spec.steps(root, outside), model = await fakeModel(steps, {});
  const previousPath = process.env.PATH; process.env.PATH = bin + path.delimiter + previousPath;
  const sandbox = spec.sandbox ? await require('../core/command-sandbox.cjs').prepare({ workspaceRoot: root, scratchRoot: scratch, directory: path.join(appdata, 'sandboxes', 'policy') }) : null;
  const asked = [], tools = new Map(), results = [], started = Date.now();
  const d = deadline(240000, 'timeout');
  const engine = new OpenCodeEngine({ root: await fs.realpath(root), directory, provider: model.provider, model: { id: MODEL }, references: [], mode: 'build', skills: [], sandbox, onEvent: async event => {
    const p = event.properties || {};
    if (event.type === 'message.part.updated' && p.part?.type === 'tool') { tools.set(p.part.callID, structuredClone(p.part)); if (['completed', 'error'].includes(p.part.state?.status)) results.push({ callID: p.part.callID, step: model.stepOf.get(p.part.callID), tool: p.part.tool, status: p.part.state.status, error: p.part.state.error ? String(p.part.state.error).slice(0, 240) : undefined, output: typeof p.part.state.output === 'string' ? p.part.state.output.slice(0, 160) : undefined, inputCommand: p.part.state.input?.command ? String(p.part.state.input.command).slice(0, 200) : undefined }); }
    if (event.type === 'permission.asked') {
      const part = p.tool?.callID ? tools.get(p.tool.callID) : null;
      const entry = { at: Date.now() - started, id: p.id, permission: p.permission, patterns: p.patterns, always: p.always, metadata: p.metadata, tool: p.tool, partAtAsk: part ? { tool: part.tool, status: part.state?.status, input: part.state?.input } : null, sendt: null, svar: null };
      asked.push(entry);
      const external = p.permission === 'webfetch' && !/127\.0\.0\.1/.test(JSON.stringify(p.patterns));
      const publish = p.permission === 'bash' && /publish|-g serve|\.ssh/.test(JSON.stringify(p.patterns));
      const doom = p.permission === 'doom_loop';
      setTimeout(() => {
        if (external || publish || doom) engine.request(`/permission/${encodeURIComponent(p.id)}/reply`, 'POST', { reply: 'reject', message: doom ? 'Du gentager samme kald; prøv en anden vej.' : 'Aura: ikke i denne prøve.' }).then(() => { entry.sendt = 'reject+besked'; }, error => { entry.fejl = error.message; });
        else engine.reply(p.id, true).then(() => { entry.sendt = 'once'; }, error => { entry.fejl = error.message; });
      }, 150);
    }
    if (event.type === 'permission.replied') { const entry = asked.find(item => item.id === p.requestID); if (entry) entry.svar = p.reply; }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) d.resolve(event.type + (p.error ? ' ' + JSON.stringify(p.error).slice(0, 300) : ''));
  } });
  try {
    await engine.start();
    await engine.send('Byg en lille app.', 'Prøve.');
    const status = await d.promise;
    await pause(500);
    await writeJSON(path.join(real, 'rapport.json'), { opencode: VERSION, aura: auraCommit(), kilde: 'scripts/record-opencode-contract.cjs politik (OpenCodeEngine' + (sandbox ? ' med HEADs kommandosandkasse' : '') + ')', variant: name, status, base: real, desktop: DESKTOP, experimental: engine.config.experimental ?? null, steps: steps.length, modelCalls: model.requests.filter(body => body.tools?.length).length, asked, results });
    if (status === 'timeout') throw new Error(`Politikforløbet ${name} nåede ikke til ende. Se ${real}.`);
    return status;
  } finally { process.env.PATH = previousPath; await engine.close(); await model.close(); }
}

// ---------- Sæt 4: bash-forespørgsler med og uden en indpakningsskal i config.shell (kritik K2) ----------
const SKAL = { 'config-shell': { shell: true }, 'uden-skal': { shell: false } };
async function recordSkal(name, base) {
  const real = await fresh(base);
  const root = path.join(real, 'Projekt'), outside = path.join(real, 'ekstern'), directory = path.join(real, 'appdata', 'runtime', 'n'), trusted = path.join(real, 'appdata', 'betroet');
  for (const dir of [root, outside, directory, trusted]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<h1>hej</h1>\n');
  // Skallen skriver sine argumenter i en log og kører så den rigtige bash.
  const wrapperLog = path.join(trusted, 'skal.log'), wrapper = path.join(trusted, 'bin', 'bash');
  await fs.mkdir(path.dirname(wrapper), { recursive: true });
  await fs.writeFile(wrapper, `#!/bin/sh\n{ printf 'ARGV:'; for a in "$@"; do printf ' [%s]' "$a"; done; printf '\\n'; } >> '${wrapperLog}'\nexec /bin/bash "$@"\n`, { mode: 0o755 });
  const steps = [
    ['cd-op', 'bash', { command: 'cd .. && pwd', description: 'Op' }],
    ['omdiriger-ud', 'bash', { command: 'echo x > ../uden-for-via-omdirigering.txt', description: 'Omdiriger' }],
    ['workdir-ude', 'bash', { command: 'ls', description: 'Ekstern', workdir: outside }],
    ['byg-pipe', 'bash', { command: 'npm run build 2>&1 | tail -2', description: 'Byg' }],
    ['hjem', 'bash', { command: 'cat ~/.ssh/id_rsa 2>/dev/null; true', description: 'Hjem' }]
  ];
  const model = await fakeModel(steps, {});
  const config = engineConfig(model.provider, { id: MODEL }, permissions(root, [], 'build', null));
  if (SKAL[name].shell) config.shell = wrapper;
  const engine = await startEngine({ root, directory, config });
  const asked = [];
  let stop = () => {}, out;
  try {
    const effective = await engine.api('/config');
    const session = await engine.api('/session', 'POST', { title: 'Prøve' });
    const d = deadline(150000, 'timeout');
    stop = follow(engine, session.id, async event => {
      const p = event.properties || {};
      if (event.type === 'permission.asked') { asked.push({ permission: p.permission, patterns: p.patterns, always: p.always, metadata: p.metadata, callID: p.tool?.callID }); await engine.api(`/permission/${encodeURIComponent(p.id)}/reply`, 'POST', { reply: 'once' }); }
      if (event.type === 'session.idle' || (event.type === 'session.status' && p.status?.type === 'idle')) d.resolve('idle');
      if (event.type === 'session.error') d.resolve('error ' + JSON.stringify(p.error).slice(0, 300));
    });
    await pause(300);
    await engine.api(`/session/${session.id}/prompt_async`, 'POST', { model: { providerID: 'harness', modelID: MODEL }, agent: 'build', parts: [{ type: 'text', text: 'Kør kommandoerne.' }] });
    const outcome = await d.promise;
    const messages = await engine.api(`/session/${session.id}/message`);
    const tools = messages.flatMap(m => m.parts || []).filter(p => p.type === 'tool').map(p => ({ callID: p.callID, status: p.state?.status, command: p.state?.input?.command, workdir: p.state?.input?.workdir, output: String(p.state?.output || p.state?.error || '').trim().slice(0, 160) }));
    out = { opencode: VERSION, aura: auraCommit(), kilde: 'scripts/record-opencode-contract.cjs skal (OpenCode med Auras isolerede miljø' + (SKAL[name].shell ? ' og en indpakningsskal i config.shell' : ' uden config.shell') + ')', variant: name, outcome, base: real, paths: { ROOT: root, OUTSIDE: outside, RUNTIME: directory }, effectiveShell: effective.shell ?? null, asked, tools, wrapperLog: await fs.readFile(wrapperLog, 'utf8').catch(() => null), udenForFil: await fs.readFile(path.join(real, 'uden-for-via-omdirigering.txt'), 'utf8').catch(() => null) };
  } finally {
    stop(); await engine.close(); await model.close();
    if (out) await writeJSON(path.join(real, 'resultat.json'), out);
  }
  if (out.outcome !== 'idle') throw new Error(`Skalforsøget ${name} sluttede med "${out.outcome}". Se ${real}.`);
  return out.outcome;
}

// ---------- Sæt 5: gentagelsesvagten og afvisninger med experimental.continue_loop_on_deny (kritik K1) ----------
// Trin 2 har to samtidige forespørgsler: kommandoen holdes tilbage, webfetch afvises med en besked. Kommandoen
// besvares først bagefter, og kun hvis OpenCode ikke selv har afvist den. 'uden-flag' er samme forløb uden flaget,
// så optagelsen viser, hvad flaget ændrer. experimental gemmes fra OpenCodes effektive konfiguration (GET /config).
// OpenCode afviser kun de forespørgsler, der venter i det øjeblik, Aura afviser. Under høj belastning kom kommandoen
// en gang først efter afvisningen og kørte. Derfor afvises webfetch først, når kommandoen også venter.
const GENTAGELSE = { 'once': { doom: 'once', flag: true }, 'afvist-med-besked': { doom: 'reject', flag: true }, 'uden-flag': { doom: 'once', flag: false } };
async function recordGentagelse(name, base) {
  const real = await fresh(base);
  const root = path.join(real, 'Projekt'), directory = path.join(real, 'appdata', 'runtime', 'n');
  await fs.mkdir(path.join(root, 'src'), { recursive: true }); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'App.jsx'), 'x\n');
  const read = ['read', { filePath: path.join(root, 'src', 'App.jsx') }];
  const steps = [
    ['gentagelse', { parallel: [read, read, read] }],
    ['kommando-og-web', { parallel: [['bash', { command: 'echo a', description: 'A' }], ['webfetch', { url: 'https://andet.invalid/', format: 'text' }]] }],
    ['efter', 'bash', { command: 'echo efter', description: 'Efter' }]
  ];
  const model = await fakeModel(steps, {});
  // Flaget sættes eller fjernes her, så 'uden-flag' også er uden flaget, når Auras engineConfig selv får det (trin 3d).
  const config = engineConfig(model.provider, { id: MODEL }, permissions(root, [], 'build'));
  const experimental = { ...config.experimental }; delete experimental.continue_loop_on_deny;
  if (GENTAGELSE[name].flag) experimental.continue_loop_on_deny = true;
  if (Object.keys(experimental).length) config.experimental = experimental; else delete config.experimental;
  const engine = await startEngine({ root, directory, config });
  const asked = [], results = [], held = [];
  let stop = () => {}, out, heldAsked;
  const heldPending = new Promise(resolve => { heldAsked = resolve; });
  const reply = async (entry, allow, message) => { await engine.api(`/permission/${encodeURIComponent(entry.id)}/reply`, 'POST', { reply: allow ? 'once' : 'reject', ...(message ? { message } : {}) }); entry.sendt = allow ? 'once' : message ? 'reject+besked' : 'reject'; };
  try {
    const effective = await engine.api('/config');
    const session = await engine.api('/session', 'POST', { title: 'Prøve' });
    const d = deadline(120000, 'timeout');
    stop = follow(engine, session.id, async event => {
      const p = event.properties || {};
      if (event.type === 'message.part.updated' && p.part?.type === 'tool' && ['completed', 'error'].includes(p.part.state?.status)) results.push(`${p.part.tool}:${p.part.state.status}${p.part.state.error ? ' ' + String(p.part.state.error).slice(0, 120) : ''}`);
      if (event.type === 'permission.asked') {
        const entry = { id: p.id, permission: p.permission, patterns: p.patterns, sendt: null, svar: null }; asked.push(entry);
        if (p.permission === 'doom_loop') return void setTimeout(() => reply(entry, GENTAGELSE[name].doom === 'once', GENTAGELSE[name].doom === 'once' ? undefined : 'Du gentager samme kald; prøv en anden vej.').catch(error => { entry.fejl = error.message; }), 100);
        if (p.permission === 'bash' && /echo a/.test(JSON.stringify(p.patterns))) { held.push(entry); return void heldAsked(); }
        if (p.permission === 'webfetch') return void setTimeout(async () => {
          await Promise.race([heldPending, pause(30000)]);
          for (const waiting of held) waiting.ventedeVedAfvisning = !waiting.svar;
          await reply(entry, false, 'Aura: kun lokale adresser i prøven.').catch(error => { entry.fejl = error.message; });
          await pause(300);
          for (const waiting of held) if (!waiting.svar) await reply(waiting, true).catch(error => { waiting.fejl = error.message; });
        }, 300);
        setTimeout(() => reply(entry, true).catch(error => { entry.fejl = error.message; }), 100);
      }
      if (event.type === 'permission.replied') { const entry = asked.find(item => item.id === p.requestID); if (entry) entry.svar = p.reply; }
      if (event.type === 'session.idle' || (event.type === 'session.status' && p.status?.type === 'idle')) d.resolve('session.idle');
      if (event.type === 'session.error') d.resolve('session.error ' + JSON.stringify(p.error).slice(0, 300));
    });
    await pause(300);
    await engine.api(`/session/${session.id}/prompt_async`, 'POST', { model: { providerID: 'harness', modelID: MODEL }, agent: 'build', parts: [{ type: 'text', text: 'Prøv.' }] });
    const status = await d.promise;
    await pause(500);
    out = { opencode: VERSION, aura: auraCommit(), kilde: 'scripts/record-opencode-contract.cjs gentagelse (OpenCode med Auras isolerede miljø' + (GENTAGELSE[name].flag ? ' og experimental.continue_loop_on_deny)' : ' uden experimental)'), variant: name, experimental: effective.experimental ?? null, sendtExperimental: config.experimental ?? null, status, modelCalls: model.requests.filter(body => body.tools?.length).length, asked, results };
  } finally {
    stop(); await engine.close(); await model.close();
    if (out) await writeJSON(path.join(real, 'resultat.json'), out);
  }
  if (out.status === 'timeout') throw new Error(`Gentagelsesforsøget ${name} nåede ikke til ende. Se ${real}.`);
  return out.status;
}

// ---------- Fra rå optagelse til fixture: stier bliver pladsholdere ----------
// Pladsholderne erstatter længste sti først. ':rel/' er samme sti uden foranstillet skråstreg, som OpenCode bruger
// for filændringer uden Git (path.relative("/", sti)).
function tokenizer(values) {
  const pairs = [];
  for (const [key, raw] of Object.entries(values)) {
    if (typeof raw !== 'string' || !raw) continue;
    pairs.push([raw, '${' + key + '}']);
    if (raw.startsWith('/') && raw.length > 1) pairs.push([raw.slice(1), '${' + key + ':rel/}']);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  const tpl = input => {
    if (typeof input === 'string') { let s = input; for (const [from, to] of pairs) s = s.split(from).join(to); return scrub(s); }
    if (Array.isArray(input)) return input.map(tpl);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, tpl(item)]));
    return input;
  };
  return tpl;
}
// Sidste værn mod maskinspecifikke rester, fx en afkortet sti i et værktøjssvar eller npm's maskering af en sti.
const MACHINE_PATH = /(?<![\w.}$-])(?:\/private)?\/(?:var\/folders|tmp|Users|home)\/[^\s'"<>)\]]*/g;
// Brugernavnet som helt ord, og dets begyndelse (mindst 3 tegn) sidst i en tekst. Optageren afkorter værktøjssvar,
// før de bliver til fixtures, så "drwxr-xr-x@ 3 <brugernavn>" kan ende midt i navnet. Færre end 3 tegn kan ikke skelnes
// fra almindelig tekst.
const userCache = new Map();
function userPatterns(user = os.userInfo().username) {
  if (!userCache.has(user)) userCache.set(user, compileUser(user));
  return userCache.get(user);
}
function compileUser(user) {
  if (user.length < 3) return null;
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixes = [];
  for (let n = user.length - 1; n >= 3; n--) prefixes.push(escape(user.slice(0, n)));
  const start = prefixes.length ? '\\b(?:' + prefixes.join('|') + ')' : null;
  return { word: new RegExp('\\b' + escape(user) + '\\b', 'g'), tail: start && new RegExp(start + '$'), tailInJSON: start && new RegExp(start + '"') };
}
function scrub(s, user) {
  let result = s.replace(MACHINE_PATH, MACHINE);
  const names = userPatterns(user);
  if (names) { result = result.replace(names.word, '<bruger>'); if (names.tail) result = result.replace(names.tail, '<bruger>'); }
  return result;
}
// Finder spor af optagemaskinen i en færdig fixturemappe: hjemmemappe, brugernavn (også afkortet sidst i en tekst),
// temp-mapper og appens egen mappe.
async function machineTraces(dir, user) {
  const needles = new Set([os.homedir(), SYSTEM_TMP, '/private/tmp/', '/var/folders/', DESKTOP]);
  for (const item of [...needles]) { try { needles.add(fss.realpathSync(item)); } catch { /* Findes ikke her. */ } }
  const names = userPatterns(user);
  const found = [];
  for (const file of await walk(dir)) {
    const content = await fs.readFile(file, 'utf8');
    for (const needle of needles) if (needle.length > 1 && content.includes(needle)) found.push(`${path.relative(dir, file)}: ${needle}`);
    if (names && new RegExp(names.word.source).test(content)) found.push(`${path.relative(dir, file)}: brugernavnet`);
    if (names?.tailInJSON && file.endsWith('.json') && names.tailInJSON.test(content)) found.push(`${path.relative(dir, file)}: begyndelsen af brugernavnet sidst i en tekst`);
  }
  return found;
}
async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full)); else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}
// npm-hentninger under en optagelse: alt, der ligger i en _cacache-mappe. Symlinks følges ikke (plugin-linket).
async function npmFetches(dir) {
  const found = [];
  async function visit(folder, inCache) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(full, inCache || entry.name === '_cacache');
      else if (entry.isFile() && inCache) found.push(full);
    }
  }
  await visit(dir, false);
  return found;
}

function convertForloeb(raw, out, names) {
  const index = [], scenarios = {};
  for (const name of names) {
    const dir = path.join(raw, name);
    const report = JSON.parse(fss.readFileSync(path.join(dir, 'rapport.json'), 'utf8'));
    if (!['idle', 'error'].includes(report.outcome)) throw new Error(`Forløbet ${name} sluttede med "${report.outcome}" og kan ikke bruges.`);
    const events = JSON.parse(fss.readFileSync(path.join(dir, 'events.json'), 'utf8'));
    const policy = JSON.parse(fss.readFileSync(path.join(dir, 'policy.json'), 'utf8'));
    const P = report.paths;
    const values = { ...P, TASK: P.SCRATCH ? path.basename(P.SCRATCH) : null, COPYID: P.WORKSPACE !== P.ROOT ? path.basename(path.dirname(P.WORKSPACE)) : null };
    for (const key of ['BASE', 'DOCUMENTS', 'STORE', 'TOOLOUTPUT']) delete values[key];
    if (values.WORKSPACE === values.ROOT) delete values.WORKSPACE;
    const tpl = tokenizer({ ...values, STORE: P.STORE, DOCUMENTS: P.DOCUMENTS, BASE: P.BASE });
    const stepOf = callID => { const m = /^kald-(\d+)-/.exec(callID || ''); return m ? report.steps[Number(m[1])] : null; };
    // Rækkefølgen pr. trin: værktøjsdelens status og forespørgsler, som de kom fra motoren.
    // doom_loop har intet tool-felt; den hører til det trin, der kørte lige før.
    const sequences = new Map(), stepFor = new Map(); let lastStep = null;
    for (const e of events) { const s = stepOf(e.callID || e.properties?.tool?.callID); if (s) lastStep = s; if (e.type === 'permission.asked') stepFor.set(e.properties.id, s || lastStep); }
    for (const e of events) {
      const step = stepOf(e.callID || e.properties?.tool?.callID) || (e.type === 'permission.asked' ? stepFor.get(e.properties.id) : e.type === 'permission.replied' ? stepFor.get(e.properties.requestID) : null); if (!step) continue;
      const list = sequences.get(step) || []; sequences.set(step, list);
      const key = e.type === 'message.part.updated' ? `del:${e.status}` : e.type === 'permission.asked' ? `spørg:${e.properties.permission}` : e.type === 'permission.replied' ? `svar:${e.properties.reply}` : e.type;
      if (list.at(-1) !== key) list.push(key);
    }
    const failure = events.find(e => e.type === 'session.error');
    scenarios[name] = tpl({ kilde: report.kilde, aura: report.aura, mode: report.spec.mode, git: report.spec.git, copy: report.spec.copy, model: report.spec.model, outcome: report.outcome, error: failure ? failure.error?.data?.message || JSON.stringify(failure.error) : null });
    const asked = events.filter(e => e.type === 'permission.asked'), perStep = new Map();
    for (const e of asked) {
      const step = stepFor.get(e.properties.id) || 'ukendt';
      const n = (perStep.get(step) || 0) + 1; perStep.set(step, n);
      const call = policy.find(c => c.p.id === e.properties.id), d = call?.result?.descriptor || {};
      const fixture = {
        opencode: report.opencode, aura: report.aura, scenario: name, outcome: report.outcome, case: step, askIndex: n, asksInStep: asked.filter(x => stepFor.get(x.properties.id) === step).length,
        layout: { mode: report.spec.mode, git: report.spec.git, copy: report.spec.copy, model: report.spec.model, worktree: report.spec.git === 'parent' ? '${REPO}' : report.spec.copy ? '/' : report.spec.git ? '${ROOT}' : '/', directory: report.spec.copy ? '${WORKSPACE}' : '${ROOT}' },
        sequence: sequences.get(step) || [],
        request: tpl(e.properties),
        toolPartAtAsk: e.toolPartAtAsk ? tpl({ status: e.toolPartAtAsk.state?.status, tool: e.toolPartAtAsk.tool, input: e.toolPartAtAsk.state?.input }) : null,
        policyInput: call ? tpl(call.p) : null,
        recordedAura: call ? tpl({ allowed: call.result.allowed, source: call.result.source || null, label: d.label, target: d.target, match: d.match || null, persistable: d.persistable, projectFile: d.projectFile, scratch: d.scratch, folder: d.folder || null, blockedMode: d.blockedMode || false }) : null,
        toolResult: report.toolResults.filter(r => r.step === step).map(r => tpl(r.content).slice(0, 300))
      };
      const file = `${name}__${step}__${n}-${e.properties.permission}.json`;
      fss.writeFileSync(path.join(out, file), JSON.stringify(fixture, null, 1) + '\n');
      index.push({ file, scenario: name, case: step, permission: e.properties.permission, patterns: fixture.request.patterns, sequence: fixture.sequence, recordedLabel: tpl(d.label), recordedAllowed: call?.result?.allowed ?? null });
    }
    // Trin uden forespørgsel dokumenteres også: de afgøres af OpenCode alene (allow eller deny).
    for (const step of report.steps) if (!perStep.has(step)) index.push({ file: null, scenario: name, case: step, permission: null, sequence: sequences.get(step) || [], toolResult: report.toolResults.filter(r => r.step === step).map(r => tpl(r.content).replace(/\s+/g, ' ').slice(0, 200)) });
  }
  return { index, scenarios };
}
const FORLOEB_TOKENS = { ROOT: 'projektmappen (BASE/Dokumenter/projekt, i git-foraelder BASE/Dokumenter/repo/projekt)', WORKSPACE: 'samtalens arbejdsmappe (ROOT eller kopien STORE/copies/COPYID/project)', OUTSIDE: 'BASE/Dokumenter/ekstern', REPO: 'Git-roden over projektet (kun git-foraelder)', STORE: 'BASE/appdata/harness', SCRATCH: 'STORE/scratch/PROJECTKEY/TASK', RUNTIME: 'STORE/runtime/WORKSPACEKEY (motorens mappe; HOME er RUNTIME/home)', SYSTMP: 'os.tmpdir() under optagelsen', TOOLOUTPUT: 'RUNTIME/data/opencode/tool-output/<fil>', ':rel/': 'samme sti uden foranstillet skråstreg (OpenCodes path.relative("/", sti) uden Git)' };
async function writeForloeb(raw, out, names) {
  await fs.mkdir(out, { recursive: true });
  // Kun de valgte forløb erstattes; de øvrige bliver stående med deres linjer i INDEX.json.
  const previous = await fs.readFile(path.join(out, 'INDEX.json'), 'utf8').then(JSON.parse, () => null);
  for (const file of await fs.readdir(out)) if (names.some(name => file.startsWith(name + '__'))) await fs.rm(path.join(out, file));
  const { index, scenarios } = convertForloeb(raw, out, names);
  const keep = previous?.opencode === VERSION ? previous.entries.filter(entry => !names.includes(entry.scenario)) : [];
  const keepScenarios = previous?.opencode === VERSION ? Object.fromEntries(Object.entries(previous.scenarios || {}).filter(([name]) => !names.includes(name))) : {};
  const entries = [...keep, ...index].sort((a, b) => a.scenario.localeCompare(b.scenario));
  const all = { ...keepScenarios, ...scenarios };
  await writeJSON(path.join(out, 'INDEX.json'), { opencode: VERSION, tokens: FORLOEB_TOKENS, scenarios: Object.fromEntries(Object.keys(all).sort().map(name => [name, all[name]])), entries });
}
async function writeDirekte(raw, out, names) {
  for (const name of names) {
    const result = JSON.parse(await fs.readFile(path.join(raw, name, 'resultat.json'), 'utf8'));
    const tpl = tokenizer({ BASE: result.base });
    await writeJSON(path.join(out, 'direkte', name + '.json'), { opencode: result.opencode, aura: result.aura, kilde: result.kilde, eksperiment: name, outcome: result.outcome, path: tpl(result['/path']), project: tpl(result['/project/current']), asked: tpl(result.asked), results: tpl(result.results), files: tpl(result.files) });
  }
}
// HEADs sandkasse koder den oprindelige kommando som sidste argument; den kodede del bliver en pladsholder.
const payload = s => typeof s === 'string' && s.startsWith('exec /usr/bin/env -i ') ? s.replace(/'[A-Za-z0-9_-]{16,}={0,2}'$/, "'${PAYLOAD}'") : s;
const POLITIK_TOKENS = { BASE: 'optagelsens mappe', ROOT: 'BASE/Projekt (Git, 30 filer i gammel/)', OUTSIDE: 'BASE/udenfor', APPDATA: 'BASE/appdata (motoren i runtime/noegle, opgavens mappe i scratch/noegle/opgave)', DESKTOP: 'appens desktop-mappe på optagemaskinen', PAYLOAD: 'HEADs kodede oprindelige kommando og arbejdsmappe' };
async function writePolitik(raw, out, names) {
  for (const name of names) {
    const report = JSON.parse(await fs.readFile(path.join(raw, name, 'rapport.json'), 'utf8'));
    const tpl = tokenizer({ BASE: report.base, ROOT: path.join(report.base, 'Projekt'), OUTSIDE: path.join(report.base, 'udenfor'), APPDATA: path.join(report.base, 'appdata'), DESKTOP: report.desktop });
    const requests = report.asked.map(a => ({ permission: a.permission, patterns: a.patterns.map(payload), always: a.always, metadata: a.metadata?.command ? { ...a.metadata, command: payload(a.metadata.command) } : a.metadata, tool: a.tool, partAtAsk: a.partAtAsk, sendt: a.sendt, svar: a.svar }));
    await writeJSON(path.join(out, 'politik', name + '.json'), { opencode: report.opencode, aura: report.aura, kilde: report.kilde, variant: name, pladsholdere: POLITIK_TOKENS, experimental: report.experimental, status: tpl(report.status), steps: report.steps, modelCalls: report.modelCalls, requests: tpl(requests), results: tpl(report.results.map(r => ({ ...r, inputCommand: payload(r.inputCommand) }))) });
  }
}
const SKAL_TOKENS = { BASE: 'optagelsens mappe (forælder til ROOT)', ROOT: 'BASE/Projekt (uden Git)', OUTSIDE: 'BASE/ekstern', RUNTIME: 'BASE/appdata/runtime/n (motorens mappe; motorens HOME er RUNTIME/home)' };
async function writeSkal(raw, out, names) {
  for (const name of names) {
    const result = JSON.parse(await fs.readFile(path.join(raw, name, 'resultat.json'), 'utf8'));
    const tpl = tokenizer({ BASE: result.base, ...result.paths });
    await writeJSON(path.join(out, 'skal', name + '.json'), { opencode: result.opencode, aura: result.aura, kilde: result.kilde, variant: name, pladsholdere: SKAL_TOKENS, outcome: result.outcome, effectiveShell: tpl(result.effectiveShell), requests: tpl(result.asked), tools: tpl(result.tools), wrapperLog: tpl(result.wrapperLog), udenForFil: result.udenForFil });
  }
}
async function writeGentagelse(raw, out, names) {
  for (const name of names) {
    const result = JSON.parse(await fs.readFile(path.join(raw, name, 'resultat.json'), 'utf8'));
    const tpl = tokenizer({});
    await writeJSON(path.join(out, 'gentagelse', name + '.json'), { opencode: result.opencode, aura: result.aura, kilde: result.kilde, variant: name, experimental: result.experimental, sendtExperimental: result.sendtExperimental ?? null, status: tpl(result.status), modelCalls: result.modelCalls, requests: result.asked.map(a => ({ permission: a.permission, patterns: tpl(a.patterns), ...('ventedeVedAfvisning' in a ? { ventedeVedAfvisning: a.ventedeVedAfvisning } : {}), sendt: a.sendt, svar: a.svar })), results: tpl(result.results) });
  }
}

const SETS = {
  forloeb: { names: Object.keys(FORLOEB), record: recordForloeb, write: writeForloeb, raw: 'rapport.json' },
  direkte: { names: Object.keys(DIREKTE), record: recordDirekte, write: writeDirekte, raw: 'resultat.json' },
  politik: { names: Object.keys(POLITIK), record: recordPolitik, write: writePolitik, raw: 'rapport.json' },
  skal: { names: Object.keys(SKAL), record: recordSkal, write: writeSkal, raw: 'resultat.json' },
  gentagelse: { names: Object.keys(GENTAGELSE), record: recordGentagelse, write: writeGentagelse, raw: 'resultat.json' }
};
function parse(argv) {
  const options = { selection: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--ud', '--arbejde', '--fra'].includes(arg)) { if (!argv[i + 1]) throw new Error(`${arg} kræver en mappe.`); options[arg.slice(2)] = argv[++i]; }
    else if (arg === '--behold') options.behold = true;
    else if (arg.startsWith('--')) throw new Error('Ukendt valg: ' + arg);
    else options.selection.push(arg);
  }
  const chosen = new Map();
  for (const item of options.selection.length ? options.selection : Object.keys(SETS)) {
    const [set, name] = item.split('/');
    if (!SETS[set]) throw new Error(`Ukendt sæt: ${set}. Kendte: ${Object.keys(SETS).join(', ')}`);
    if (name && !SETS[set].names.includes(name)) throw new Error(`Ukendt navn i ${set}: ${name}. Kendte: ${SETS[set].names.join(', ')}`);
    const names = chosen.get(set) || []; chosen.set(set, names);
    for (const n of name ? [name] : SETS[set].names) if (!names.includes(n)) names.push(n);
  }
  options.sets = chosen;
  return options;
}
const onPath = program => (process.env.PATH || '').split(path.delimiter).some(dir => { try { fss.accessSync(path.join(dir, program), fss.constants.X_OK); return true; } catch { return false; } });

async function main(argv) {
  const options = parse(argv);
  if (process.env.CI) throw new Error('Optageren startes kun manuelt og lokalt, aldrig i CI.');
  const out = path.resolve(options.ud || FIXTURES);
  let raw = options.fra ? path.resolve(options.fra) : null, work = null;
  if (!raw) {
    // Uden rg i PATH henter OpenCode selv ripgrep fra GitHub ved første søgning (kritik K4).
    if (!onPath('rg')) throw new Error('ripgrep (rg) skal ligge i PATH. Ellers henter OpenCode det selv fra GitHub under optagelsen.');
    await findExecutable();
    const base = options.arbejde ? path.resolve(options.arbejde) : await fs.mkdtemp(path.join(SYSTEM_TMP, 'aura-kontrakt-'));
    await fs.mkdir(base, { recursive: true });
    raw = work = await fs.realpath(base);
    // Bun pakker et bibliotek på knap 5 MB ud i TMPDIR ved første værktøjskald (kritik K5). Det bliver i arbejdsmappen.
    const tmp = path.join(work, 'tmp'); await fs.mkdir(tmp, { recursive: true }); process.env.TMPDIR = tmp;
    console.log('Arbejdsmappe: ' + work);
  }
  try {
    for (const [set, names] of options.sets) {
      if (work) for (const name of names) {
        const started = Date.now();
        const outcome = await SETS[set].record(name, path.join(work, set, name));
        // Kald til npm-registret under optagelsen er net ud over maskinen (kritik K3). Så bruges optagelsen ikke.
        const fetched = await npmFetches(path.join(work, set, name));
        if (fetched.length) throw new Error(`OpenCode hentede fra npm under ${set}/${name}:\n${fetched.join('\n')}`);
        console.log(`${set}/${name}: ${outcome} på ${Math.round((Date.now() - started) / 1000)} s`);
      }
      const missing = names.filter(name => !fss.existsSync(path.join(raw, set, name, SETS[set].raw)));
      if (missing.length) throw new Error(`Der mangler rå optagelser i ${path.join(raw, set)}: ${missing.join(', ')}`);
      await SETS[set].write(path.join(raw, set), out, names);
    }
  } finally {
    if (work && !options.arbejde && !options.behold) await fs.rm(work, { recursive: true, force: true });
  }
  const traces = await machineTraces(out);
  if (traces.length) throw new Error('Fixtures indeholder spor af optagemaskinen:\n' + traces.join('\n'));
  console.log('Fixtures skrevet til ' + out);
  // Kontrakttestens del 1 på det, der lige er skrevet.
  const test = spawnSync(process.execPath, ['--test', path.join(DESKTOP, 'tests', 'opencode-contract.test.cjs')], { env: { ...process.env, AURA_OPENCODE_FIXTURES: out }, stdio: 'inherit' });
  if (test.status !== 0) throw new Error('Kontrakttesten fejler på de nye optagelser. Gennemgå forskellen, før de bruges.');
}

module.exports = { npmFetches, machineTraces, scrub, tokenizer, SETS };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
