const { randomUUID } = require('node:crypto');
const { repository } = require('./github.cjs');
const { blockingSecret } = require('./secrets.cjs');
// Workflowets version. Hæv den, når workflowets indhold ændres, også i verifyMaterial, verifyCloudflare og
// secrets.blockingSecret, så en opsætning fra en ældre Aura får en forklaring frem for den almindelige besked.
const WORKFLOW_VERSION = 6;

const PROVIDERS = new Set(['github-pages', 'cloudflare']);
const SHA = /^[a-f0-9]{40,64}$/;
const REQUEST = /^[a-f0-9-]{36}$/;
// Officielle udgivelser kontrolleret 20. oktober 2026. Kun manuelle workflows.
const ACTIONS = {
  checkout: 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  configure: 'actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b',
  upload: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  deploy: 'actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e',
  wrangler: 'cloudflare/wrangler-action@953926a2e2182532811c01a25e53647d93bf07c0'
};
function pagesConfiguration(input) {
  if (!input || !PROVIDERS.has(input.provider) || (input.mode && input.mode !== 'static')) throw Error('Pages kræver en færdigbygget hjemmeside.');
  const repo = repository(input.repository);
  const branch = input.branch || 'main';
  if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.lock')) throw Error('Angiv en gyldig GitHub-branch.');
  const directory = input.directory || 'public';
  if (typeof directory !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]{0,199}$/.test(directory) || directory.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || directory.endsWith('/')) throw Error('Vælg en mappe med færdige filer, fx public eller dist.');
  const config = { provider: input.provider, mode: 'static', repository: repo, branch, directory, frontend: '.', api: '' };
  if (input.provider === 'cloudflare') {
    if (typeof input.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(input.accountId)) throw Error('Angiv Cloudflare-kontoens ID på 32 tegn.');
    if (typeof input.project !== 'string' || !/^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(input.project)) throw Error('Angiv navnet på dit eksisterende Cloudflare Pages-projekt.');
    config.accountId = input.accountId; config.project = input.project;
  }
  return config;
}
function siteURL(value) {
  let url; try { url = new URL(value); } catch { throw Error('Udgivelsesadressen er ugyldig.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.hostname === 'localhost' || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw Error('Udgivelsesadressen skal være en offentlig HTTPS-adresse.');
  return url.href;
}
function publicAddress(value) {
  const type = require('node:net').isIP(value);
  if (type === 4) {
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (type === 6) {
    const lower = value.toLowerCase(), parts = lower.split(':'), first = Number.parseInt(parts[0], 16), second = Number.parseInt(parts[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x2002;
  }
  return false;
}
async function fetchSite(value, { lookup = require('node:dns/promises').lookup, request = require('node:https').request } = {}) {
  const url = new URL(siteURL(value));
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw Error('Adressen peger på et internt eller reserveret netværk. Åbn den selv for at kontrollere siden.');
  const chosen = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', signal: AbortSignal.timeout(15000), maxHeaderSize: 32768,
      headers: { 'User-Agent': 'Aura' },
      // Forbindelsen bruger den kontrollerede adresse; et nyt DNS-svar kan ikke flytte den internt.
      lookup: (_host, options, callback) => options?.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family)
    }, response => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const empty = response.statusCode < 200 || response.statusCode >= 300 || [204, 205].includes(response.statusCode);
      if (empty) { resolve(new Response(null, { status: response.statusCode, headers })); response.destroy(); return; }
      // Højst kontrolgrænsen plus ét tegn, så UI kan skelne et for stort svar.
      const chunks = [], limit = 2 * 1024 * 1024 + 1; let bytes = 0, finished = false;
      const finish = () => { if (finished) return; finished = true; resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers })); };
      response.on('data', chunk => {
        const part = chunk.subarray(0, limit - bytes); chunks.push(part); bytes += part.length;
        if (bytes >= limit) { finish(); response.destroy(); }
      });
      response.on('end', finish); response.on('error', error => { if (!finished) reject(error); });
    });
    req.on('error', reject); req.end();
  });
}
function workflowPath(c) { return `.github/workflows/aura-${c.provider === 'cloudflare' ? 'cloudflare-pages' : 'github-pages'}.yml`; }
function validatePagesArtifact(artifact) {
  const names = artifact.files.map(file => file.file);
  if (!names.includes('index.html')) throw Error('Pages kræver index.html i mappen med den færdige hjemmeside.');
  if (names.some(file => /(?:^|\/)(?:package(?:-lock)?\.json|wrangler\.(?:toml|jsonc?)|_worker\.js|functions|api|\.github|\.env(?:\..*)?)(?:\/|$)/i.test(file))) throw Error('Pages-mappen indeholder serverkode eller projektkonfiguration. Vælg kun den færdigbyggede frontend.');
}
function settings(c) {
  const base = `https://github.com/${c.repository}`;
  return {
    repository: base, workflow: `${base}/actions/workflows/${workflowPath(c).split('/').pop()}`,
    settings: `${base}/settings/${c.provider === 'github-pages' ? 'pages' : 'secrets/actions'}`,
    provider: c.provider === 'cloudflare' ? `https://dash.cloudflare.com/${c.accountId}/pages/view/${c.project}` : `${base}/settings/pages`
  };
}

// Denne funktion indlejres uændret i workflowet og afprøves med rigtige filer i tests.
async function verifyMaterial(env = process.env) {
  const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
  if (!/^[a-f0-9]{40,64}$/.test(env.REVIEWED_SHA || '') || env.GITHUB_SHA !== env.REVIEWED_SHA) throw Error('Branchen er ændret siden gennemgangen.');
  if (!/^[a-f0-9]{64}$/.test(env.REVIEWED_HASH || '')) throw Error('Udgivelsen mangler det gennemgåede fingeraftryk.');
  const workspace = await fs.realpath(env.GITHUB_WORKSPACE), root = path.resolve(workspace, env.AURA_DIRECTORY);
  if (!root.startsWith(workspace + path.sep) || await fs.realpath(root) !== root) throw Error('Frontendmappen skal ligge direkte i projektet uden links.');
  const out = path.join(env.RUNNER_TEMP, 'aura-pages');
  const entries = []; let bytes = 0;
  async function visit(dir, prefix = '') {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = prefix + item.name, full = path.join(dir, item.name);
      if (item.isSymbolicLink() || /[\x00-\x1f\\:]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))) throw Error('Udgivelsen indeholder et link eller en ugyldig sti.');
      if (/(^|\/)(?:\.git|\.github|\.env(?:\..*)?|node_modules|\.npmrc|\.netrc|\.ssh|\.aws|private)(?:\/|$)/i.test(file) || /(?:^|\/)(?:package(?:-lock)?\.json|wrangler\.(?:toml|jsonc?)|_worker\.js|functions|api)(?:\/|$)/i.test(file)) throw Error('Udgivelsen indeholder private filer eller serverkode.');
      if (item.isDirectory()) { await visit(full, file + '/'); continue; }
      if (!item.isFile()) throw Error('Udgivelsen indeholder en ukendt filtype.');
      const stat = await fs.stat(full); bytes += stat.size;
      if (entries.length >= 2000 || stat.size > 2 * 1024 * 1024 || bytes > 20 * 1024 * 1024) throw Error('Udgivelsen overstiger filgrænsen.');
      const data = await fs.readFile(full), text = data.toString();
      // Samme regler som Auras gennemgang: blockingSecret fra secrets.cjs indlejres i workflowet sammen med denne funktion.
      if (blockingSecret(text)) throw Error(`Mulig hemmelighed i ${env.AURA_DIRECTORY}/${file}. Fjern den, gem en ny version, og udgiv igen.`);
      if (/^version https:\/\/git-lfs.github.com\/spec\/v1/.test(text)) throw Error(`Git LFS-pointer i ${env.AURA_DIRECTORY}/${file}. Gem selve filen i projektet, og udgiv igen.`);
      entries.push({ file, data, hash: createHash('sha256').update(data).digest('hex') });
    }
  }
  const rootStat = await fs.lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Frontendmappen er ugyldig.');
  await visit(root);
  entries.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  if (!entries.some(f => f.file === 'index.html')) throw Error('Frontendmappen mangler index.html.');
  const hash = createHash('sha256').update(JSON.stringify(entries.map(f => [f.file, f.hash]))).digest('hex');
  if (hash !== env.REVIEWED_HASH) throw Error('Filerne er ikke den gennemgåede version.');
  await fs.mkdir(out, { recursive: false });
  for (const file of entries) { const target = path.join(out, file.file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.data, { flag: 'wx' }); }
  return { hash, files: entries.length, bytes, directory: out };
}

async function verifyCloudflare(env = process.env, fetcher = fetch) {
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PROJECT}`, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  if (!response.ok) throw Error('Cloudflare kunne ikke bekræfte projektet. Kontrollér konto, token og projektnavn.');
  const json = await response.json(), project = json.result;
  if (!json.success || project?.name !== env.CLOUDFLARE_PROJECT || project.production_branch !== env.AURA_BRANCH) throw Error('Cloudflare-projektets produktionsbranch matcher ikke valget.');
  if (project.uses_functions === true) throw Error('Cloudflare-projektet har serverfunktioner. Vælg et statisk projekt, så de ikke erstattes med en ren frontend.');
  if (project.source && (project.source.config?.production_deployments_enabled !== false || project.source.config?.preview_deployment_setting !== 'none')) throw Error('Slå automatiske Cloudflare-udgivelser fra før manuel udgivelse fra Aura.');
  return true;
}
function scriptBlock(fns, invocation) { return `${[].concat(fns).map(fn => fn.toString()).join('\n')}\n${invocation}`.split('\n').map(line => `          ${line}`).join('\n'); }
const VERSION_MARK = /^# Aura Pages-workflow (\d+)\./m;
function pagesWorkflow(input) {
  const c = pagesConfiguration(input), cloudflare = c.provider === 'cloudflare';
  const header = `# Aura Pages-workflow ${WORKFLOW_VERSION}. Aura sammenligner filen tegn for tegn før hver udgivelse; ret den ikke i hånden.
name: Udgiv med ${cloudflare ? 'Cloudflare Pages' : 'GitHub Pages'}
run-name: Aura Pages \${{ inputs.request_id }}
on:
  workflow_dispatch:
    inputs:
      reviewed_sha:
        description: Gennemgået version
        required: true
        type: string
      reviewed_hash:
        description: Gennemgåede filers fingeraftryk
        required: true
        type: string
      request_id:
        description: Udgivelsens ID fra Aura
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: aura-${c.provider}
  cancel-in-progress: false
jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
${cloudflare ? '' : '      pages: write\n      id-token: write\n'}    environment:
      name: ${cloudflare ? 'aura-cloudflare' : 'github-pages'}
      url: \${{ steps.deployment.outputs.${cloudflare ? 'deployment-url' : 'page_url'} }}
    steps:
      - uses: ${ACTIONS.checkout}
        with:
          ref: \${{ inputs.reviewed_sha }}
          persist-credentials: false
      - name: Kontrollér den gennemgåede version
        env:
          REVIEWED_SHA: \${{ inputs.reviewed_sha }}
          REVIEWED_HASH: \${{ inputs.reviewed_hash }}
          AURA_DIRECTORY: ${JSON.stringify(c.directory)}
        run: |
          node <<'AURA_NODE'
${scriptBlock([blockingSecret, verifyMaterial], "verifyMaterial().catch(error => { console.error(error.message); process.exit(1); });")}
          AURA_NODE
`;
  const deploy = cloudflare ? `      - name: Kontrollér Cloudflare-destinationen
        env:
          CLOUDFLARE_ACCOUNT_ID: ${JSON.stringify(c.accountId)}
          CLOUDFLARE_PROJECT: ${JSON.stringify(c.project)}
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          AURA_BRANCH: ${JSON.stringify(c.branch)}
        run: |
          node <<'AURA_NODE'
${scriptBlock(verifyCloudflare, "verifyCloudflare().catch(error => { console.error(error.message); process.exit(1); });")}
          AURA_NODE
      - name: Udgiv de gennemgåede filer
        id: deployment
        uses: ${ACTIONS.wrangler}
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${JSON.stringify(c.accountId)}
          wranglerVersion: '4.136.3'
          workingDirectory: \${{ runner.temp }}
          command: pages deploy aura-pages --project-name=${c.project} --branch=${c.branch} --commit-hash=\${{ inputs.reviewed_sha }}
` : `      - uses: ${ACTIONS.configure}
        with:
          enablement: false
      - name: Pak alle gennemgåede filer
        run: tar --format=posix -cf "$RUNNER_TEMP/artifact.tar" -C "$RUNNER_TEMP/aura-pages" .
      - uses: ${ACTIONS.upload}
        with:
          name: github-pages
          path: \${{ runner.temp }}/artifact.tar
          retention-days: 1
          if-no-files-found: error
      - name: Udgiv de gennemgåede filer
        id: deployment
        uses: ${ACTIONS.deploy}
`;
  return { path: workflowPath(c), content: header + deploy };
}

class PagesDeployment {
  constructor(github, id) { if (!PROVIDERS.has(id)) throw Error('Ukendt Pages-udbyder.'); this.github = github; this.id = id; }
  async setup(input) {
    const c = pagesConfiguration(input), links = settings(c), connection = await this.github.state();
    if (!connection.connected || connection.expired) return { ready: false, connection, links, message: 'Forbind din GitHub-konto for at kontrollere opsætningen.' };
    const repo = await this.github.api(`/repos/${c.repository}`);
    if (!Number.isSafeInteger(repo.id) || repo.full_name?.toLowerCase() !== c.repository.toLowerCase() || repo.archived || repo.disabled || !repo.permissions?.push) throw Error('Repositoryet findes ikke eller kan ikke bruges med denne GitHub-konto.');
    const branch = await this.github.api(`/repos/${c.repository}/branches/${encodeURIComponent(c.branch)}`, { missing: true });
    if (!SHA.test(branch?.commit?.sha || '')) return { ready: false, connection, links, message: 'Opret og push den valgte branch i dit Git-værktøj.' };
    const workflow = pagesWorkflow(c), file = await this.github.api(`/repos/${c.repository}/contents/${workflow.path}?ref=${branch.commit.sha}`, { missing: true });
    const remote = file?.type === 'file' && file.encoding === 'base64' ? Buffer.from(file.content || '', 'base64').toString() : null;
    const sameWorkflow = remote === workflow.content;
    // Et workflow, som en ældre Aura har skrevet (uden versionsmærke eller med et lavere nummer), skal fornyes efter opdateringen.
    const outdated = !sameWorkflow && remote !== null && /^run-name: Aura Pages \$\{\{ inputs\.request_id \}\}$/m.test(remote) && Number(VERSION_MARK.exec(remote)?.[1] || 1) < WORKFLOW_VERSION;
    const active = sameWorkflow ? await this.github.api(`/repos/${c.repository}/actions/workflows/${workflow.path.split('/').pop()}`, { missing: true }) : null;
    let pages = null, secret = null;
    if (this.id === 'github-pages') {
      pages = await this.github.api(`/repos/${c.repository}/pages`, { missing: true });
      if (pages?.html_url) siteURL(pages.html_url);
    } else {
      // Kun navnet læses. GitHub returnerer aldrig hemmelighedens værdi.
      secret = await this.github.api(`/repos/${c.repository}/actions/secrets/CLOUDFLARE_API_TOKEN`, { missing: true });
    }
    const destinationReady = this.id === 'github-pages' ? pages?.build_type === 'workflow' : secret?.name === 'CLOUDFLARE_API_TOKEN';
    const ready = sameWorkflow && active?.state === 'active' && destinationReady;
    const message = !sameWorkflow ? `${outdated ? 'Aura er opdateret, så udgivelsesopsætningen på GitHub skal fornyes. ' : ''}Gem opsætningen i projektet, og push den gennemgåede version med dit Git-værktøj.` : active?.state !== 'active' ? 'Aktivér det manuelle workflow på GitHub. Det skal også findes på repositoryets standardbranch.' : !destinationReady ? this.id === 'github-pages' ? 'Vælg GitHub Actions som kilde under Settings → Pages.' : 'Gem CLOUDFLARE_API_TOKEN under repositoryets Actions secrets.' : this.id === 'cloudflare' ? 'Workflow og tokennavn er klar. Cloudflare-konto og projekt kontrolleres før upload i udgivelsen.' : 'GitHub Pages og det manuelle workflow er klar.';
    return { ready, connection, links, message, repository: { id: repo.id, fullName: repo.full_name, private: repo.private === true }, head: branch.commit.sha, workflow: { path: workflow.path, matches: sameWorkflow, outdated, active: active?.state === 'active', id: active?.id || null }, pages: pages ? { url: pages.html_url || null, public: typeof pages.public === 'boolean' ? pages.public : null, buildType: pages.build_type } : null, secretPresent: secret?.name === 'CLOUDFLARE_API_TOKEN' };
  }
  async inspect(input, artifact) {
    const c = pagesConfiguration(input), setup = await this.setup(c);
    if (!setup.ready) throw Error(setup.message);
    if (artifact?.files) validatePagesArtifact(artifact);
    if (artifact && (artifact.head !== setup.head || !SHA.test(artifact.head))) throw Error('Versionen på GitHub er ikke den gennemgåede lokale version. Push den med dit Git-værktøj, og kontrollér igen.');
    const url = this.id === 'github-pages' ? siteURL(setup.pages.url) : null;
    return { id: String(setup.repository.id), name: this.id === 'github-pages' ? c.repository : c.project, repository: c.repository, head: setup.head, workflow: setup.workflow.path, workflowId: setup.workflow.id, portal: setup.links.provider, workflowURL: setup.links.workflow, url, settings: { branch: c.branch, directory: c.directory }, environmentKeys: this.id === 'cloudflare' ? ['CLOUDFLARE_API_TOKEN'] : [], access: this.id === 'github-pages' ? setup.pages.public === false ? 'GitHub oplyser adgangsbegrænsning. Afprøv siden med den tilsigtede bruger.' : 'Siden er offentlig. Et privat repository gør ikke siden privat.' : 'Cloudflare-adgang kontrolleres ikke af Aura. Behandl siden som offentlig, indtil adgangsreglerne er prøvet.', region: 'Frontend leveres gennem udbyderens netværk. EU-behandling er ikke verificeret.', validation: setup.message };
  }
  async deploy(input, artifact, target, { onUploaded = async () => {} } = {}) {
    const c = pagesConfiguration(input);
    if (!SHA.test(artifact?.head || '') || !/^[a-f0-9]{64}$/.test(artifact?.hash || '') || target.head !== artifact.head) throw Error('Gennemgå udgivelsen igen.');
    const id = randomUUID(), receipt = { id, state: 'SUBMITTING', url: null, workflowURL: settings(c).workflow };
    await onUploaded(receipt);
    const response = await this.github.api(`/repos/${c.repository}/actions/workflows/${workflowPath(c).split('/').pop()}/dispatches`, { method: 'POST', body: { ref: c.branch, inputs: { reviewed_sha: artifact.head, reviewed_hash: artifact.hash, request_id: id } } });
    return { ...receipt, state: 'QUEUED', runId: Number.isSafeInteger(response?.workflow_run_id) ? response.workflow_run_id : null };
  }
  async status(input, receipt) {
    const c = pagesConfiguration(input);
    if (!REQUEST.test(receipt.id || '') || !SHA.test(receipt.head || '')) throw Error('Udgivelsen mangler en gyldig reference.');
    const path = workflowPath(c), name = `Aura Pages ${receipt.id}`, base = `/repos/${c.repository}`;
    let result;
    if (Number.isSafeInteger(receipt.runId)) result = await this.github.api(`${base}/actions/runs/${receipt.runId}`);
    else {
      const found = [];
      for (let page = 1; page <= 5; page++) {
        const data = await this.github.api(`${base}/actions/workflows/${path.split('/').pop()}/runs?event=workflow_dispatch&head_sha=${receipt.head}&per_page=100&page=${page}`);
        if (!Array.isArray(data.workflow_runs)) throw Error('GitHub returnerede en ugyldig kørselsliste.');
        found.push(...data.workflow_runs.filter(run => run.display_title === name));
        if (data.workflow_runs.length < 100) break;
      }
      if (!found.length) return { state: 'AWAITING_UPDATE', url: null, workflowURL: settings(c).workflow };
      if (found.length !== 1) throw Error('Flere kørsler matcher udgivelsen. Gennemgå dem på GitHub.');
      result = found[0];
    }
    if (!Number.isSafeInteger(result.id) || result.display_title !== name || result.head_sha !== receipt.head || result.event !== 'workflow_dispatch' || result.path?.split('@')[0] !== path) throw Error('GitHub-kørslen matcher ikke den godkendte udgivelse.');
    const runURL = `https://github.com/${c.repository}/actions/runs/${result.id}`;
    if (result.status !== 'completed') return { state: result.status === 'in_progress' ? 'BUILDING' : 'QUEUED', url: null, runId: result.id, workflowURL: runURL };
    if (result.conclusion !== 'success') return { state: result.conclusion === 'cancelled' ? 'CANCELED' : 'ERROR', url: null, runId: result.id, workflowURL: runURL };
    const jobs = await this.github.api(`${base}/actions/runs/${result.id}/jobs?per_page=100`);
    if (!jobs.jobs?.some(job => job.name === 'publish' && job.conclusion === 'success' && job.steps?.some(step => step.name === 'Udgiv de gennemgåede filer' && step.conclusion === 'success'))) throw Error('Uploadtrinnet er ikke bekræftet i denne kørsel.');
    let url = null;
    if (this.id === 'github-pages') {
      const pages = await this.github.api(`${base}/pages`);
      if (pages.build_type !== 'workflow') throw Error('GitHub Pages-opsætningen er ændret.');
      url = siteURL(pages.html_url);
    } else {
      const environments = await this.github.api(`${base}/deployments?sha=${receipt.head}&environment=aura-cloudflare&per_page=100`);
      if (!Array.isArray(environments)) throw Error('GitHub returnerede en ugyldig udgivelsesliste.');
      for (const deployment of environments) {
        if (deployment.sha !== receipt.head || deployment.environment !== 'aura-cloudflare' || !Number.isSafeInteger(deployment.id)) continue;
        const statuses = await this.github.api(`${base}/deployments/${deployment.id}/statuses?per_page=100`);
        if (!Array.isArray(statuses)) throw Error('GitHub returnerede en ugyldig udgivelsesstatus.');
        const current = statuses[0];
        if (current?.state === 'success' && (current.log_url === runURL || current.log_url?.startsWith(runURL + '/'))) {
          const candidate = new URL(siteURL(current.environment_url));
          if (!candidate.hostname.endsWith('.pages.dev')) throw Error('Cloudflare returnerede en ukendt udgivelsesadresse.');
          url = candidate.href; break;
        }
      }
      if (!url) return { state: 'AWAITING_UPDATE', url: null, runId: result.id, workflowURL: runURL };
    }
    return { state: 'READY', url, runId: result.id, workflowURL: runURL };
  }
}
class GitHubPagesDeployment extends PagesDeployment { constructor(github) { super(github, 'github-pages'); } }
class CloudflarePagesDeployment extends PagesDeployment { constructor(github) { super(github, 'cloudflare'); } }
module.exports = { pagesConfiguration, pagesWorkflow, workflowPath, validatePagesArtifact, siteURL, publicAddress, fetchSite, GitHubPagesDeployment, CloudflarePagesDeployment, verifyMaterial, verifyCloudflare, WORKFLOW_VERSION };
