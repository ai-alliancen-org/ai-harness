const { AzureSetup } = require('./azure-setup.cjs');
const { PromteSetup, promteHost, promteSourceProblem, PROMTE_WEBSITE, PROMTE_SETUP } = require('./provider-promte.cjs');
const { appName } = require('./promte-preview.cjs');
const { VercelSetup, importURL, checkedConfig } = require('./vercel-setup.cjs');
const { pagesWorkflow, pagesConfiguration, workflowPath, siteURL } = require('./pages-publishing.cjs');
const { configuration } = require('./deployments.cjs');
const { DeploymentConfiguration } = require('./deployment-configuration.cjs');
const { command, publicURL } = require('./deployment-providers.cjs');

class DeploymentSetup {
  constructor(store, github, deployments, dependencies = {}) {
    this.store = store; this.github = github; this.deployments = deployments;
    this.azure = dependencies.azure || new AzureSetup(); this.promte = dependencies.promte || new PromteSetup(store);
    this.azureContainers = dependencies.azureContainers || new AzureSetup(command, { containers: true });
    this.vercel = dependencies.vercel || new VercelSetup(store); this.files = dependencies.files || new DeploymentConfiguration();
    this.run = dependencies.command || command; this.vercelReviews = new Map();
  }
  async act(root, input) {
    const { action, config = {} } = input || {};
    switch (action) {
      case 'azure-state': return this.azure.state();
      case 'azure-login': return this.azure.login();
      case 'azure-apps': return this.azure.apps(config.subscription);
      case 'azure-containers-state': return this.azureContainers.state();
      case 'azure-containers-login': return this.azureContainers.login();
      case 'azure-containers-apps': return this.azureContainers.apps(config.subscription);
      case 'promte-state': return this.promte.state({ host: config.host });
      case 'promte-login': return this.promte.login({ host: config.host, owner: root });
      case 'promte-logout': return this.promte.logout({ host: config.host });
      case 'promte-workspaces': return this.promte.workspaces({ host: config.host });
      case 'promte-create': return this.promte.createWorkspace({ host: config.host, name: input.name });
      // Promte tager kun Promte-apps. Udgiv spørger, før brugeren logger ind.
      case 'promte-check': { const problem = await promteSourceProblem(root); return { problem: problem && { ...problem, summary: problem.kind === 'website' ? PROMTE_WEBSITE : PROMTE_SETUP } }; }
      // Forhåndsvisning og Udgiv bruger den samme Promte-app for projektet.
      case 'promte-link': return { link: (await this.store.project(root)).promteApp || null, suggestedName: appName(root) };
      case 'promte-link-set': {
        if (typeof input.workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(input.workspaceId)) throw Error('Ugyldig Promte-app.');
        const promteApp = { host: promteHost(config.host), workspaceId: input.workspaceId, name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 200) : input.workspaceId };
        await this.store.saveProject(root, { promteApp }); return promteApp;
      }
      case 'github-state': {
        const state = await this.github.state();
        let localLogin = false;
        if (!state.connected || state.expired) try { await this.run(process.env.HARNESS_GH_PATH || 'gh', ['auth', 'status', '--hostname', 'github.com']); localLogin = true; } catch {}
        return { ...state, localLogin };
      }
      case 'github-local': {
        const token = (await this.run(process.env.HARNESS_GH_PATH || 'gh', ['auth', 'token', '--hostname', 'github.com'])).trim();
        return this.github.connectToken(token);
      }
      case 'github-repositories': return this.github.repositories();
      case 'pages-state': {
        const c = pagesConfiguration(config);
        return this.deployments.providers[c.provider].setup(c);
      }
      case 'config-review': {
        const c = configuration(config);
        this.vercelReviews.clear();
        return this.files.review(root, c, ['github-pages', 'cloudflare'].includes(c.provider) ? [pagesWorkflow(c)] : []);
      }
      case 'config-save':
        if (this.vercelReviews.has(input.token)) throw Error('Brug Følg udgivelser for at gemme Vercel-forbindelsen.');
        return this.files.apply(root, input.token);
      case 'vercel-state': return { ...await this.vercel.state(), ...await this.vercelProjectConfiguration(root) };
      case 'vercel-login': return { ...await this.vercel.login(), ...await this.vercelProjectConfiguration(root) };
      case 'vercel-projects': return this.vercel.projects(config.scope);
      case 'vercel-review': {
        const selected = await this.vercel.selection(config);
        const review = await this.files.review(root, { ...selected, mode: 'git' });
        this.vercelReviews.clear();
        this.vercelReviews.set(review.token, { root, selected });
        return { ...review, config: selected, message: 'Gem forbindelsen i projektet. Nye pushes udgives gennem projektets Git-forbindelse hos Vercel.' };
      }
      case 'vercel-track': {
        const review = this.vercelReviews.get(input.token); this.vercelReviews.delete(input.token);
        if (!review || review.root !== root) throw Error('Gennemgå Vercel-forbindelsen igen.');
        const current = await this.vercel.selection(review.selected);
        if (JSON.stringify(current) !== JSON.stringify(review.selected)) throw Error('Vercel-forbindelsen har ændret sig. Gennemgå den igen.');
        const saved = await this.files.apply(root, input.token);
        await this.store.saveProject(root, { vercelGit: current, deploymentTrackingSource: 'vercel-git' });
        return { ...saved, config: current };
      }
      case 'vercel-reset': return this.vercel.reset(root);
      default: throw Error('Opsætningshandlingen findes ikke.');
    }
  }
  async open(root, input) {
    const { provider, kind, config = {} } = input || {};
    if (kind === 'tracking') return this.trackingURL(root, provider);
    if (provider === 'promte' && kind === 'host') return promteHost(config.host);
    if (['github-pages', 'cloudflare'].includes(provider) && ['settings', 'workflow', 'repository', 'provider'].includes(kind)) {
      const c = pagesConfiguration({ ...config, provider });
      return (await this.deployments.providers[provider].setup(c)).links[kind];
    }
    if (provider === 'vercel' && kind === 'import') return importURL();
    if (provider === 'vercel' && kind === 'project') return (await this.vercel.selection(config)).portal;
    if (provider === 'vercel' && kind === 'settings') {
      const saved = await this.vercel.saved(root);
      if (!saved?.portal) throw Error('Vælg Vercel-projektet først.');
      return saved.portal;
    }
    const links = {
      azure: { account: 'https://azure.microsoft.com/free/', install: 'https://learn.microsoft.com/en-us/cli/azure/install-azure-cli', swa: 'https://azure.github.io/static-web-apps-cli/docs/use/install/', portal: 'https://portal.azure.com/#browse/Microsoft.Web%2FStaticSites' },
      'azure-containers': { account: 'https://azure.microsoft.com/free/', install: 'https://learn.microsoft.com/en-us/azure/container-apps/get-started-existing-container-image', portal: 'https://portal.azure.com/#browse/Microsoft.App%2FcontainerApps' },
      promte: { account: 'https://promte.com/kontakt', install: 'https://www.npmjs.com/package/@promte/app-upload' },
      komplai: { portal: 'https://app.komplai.dk' },
      vercel: { account: 'https://vercel.com/signup', portal: 'https://vercel.com/dashboard', install: 'https://vercel.com/docs/cli', guide: 'https://vercel.com/docs/git/vercel-for-github' },
      'github-pages': { account: 'https://github.com/signup', login: 'https://cli.github.com/manual/gh_auth_login', token: 'https://github.com/settings/personal-access-tokens/new', portal: 'https://github.com' },
      cloudflare: { account: 'https://dash.cloudflare.com/sign-up', portal: 'https://dash.cloudflare.com/', token: 'https://dash.cloudflare.com/profile/api-tokens' }
    };
    const url = links[provider]?.[kind];
    if (!url) throw Error('Dette opsætningslink findes ikke.');
    return url;
  }
  async tracking(root, refresh = false) {
    const project = await this.store.project(root);
    const selection = value => JSON.stringify([value.deploymentTrackingSource || null, value.vercelGit || null, value.deploymentLast?.id || null, value.deploymentLast?.startedAt || null]);
    const selected = selection(project);
    const followGit = project.vercelGit && (project.deploymentTrackingSource === 'vercel-git' || !project.deploymentTrackingSource && !project.deploymentLast);
    if (followGit) {
      const saved = await this.vercel.saved(root);
      if (!refresh) return { provider: 'vercel', automatic: true, config: saved, latest: null, observed: false };
      const current = await this.vercel.latestStatus(root);
      if (selection(await this.store.project(root)) !== selected) return this.tracking(root, false);
      return { provider: 'vercel', automatic: true, ...current, observed: true };
    }
    const { last } = await this.deployments.state(root);
    if (refresh && last?.id) {
      const current = await this.deployments.check(root);
      if (selection(await this.store.project(root)) !== selected) return this.tracking(root, false);
      return { automatic: false, last: current, observed: true };
    }
    return { automatic: false, last, observed: false };
  }
  async vercelProjectConfiguration(root) {
    try {
      const content = await this.files.read(root, '.aura/publishing/vercel.json');
      if (content === null) return { projectConfig: null, configurationError: null };
      const value = JSON.parse(content);
      if (value.version !== 1 || value.mode !== 'git') throw Error();
      return { projectConfig: checkedConfig(value), configurationError: null };
    } catch { return { projectConfig: null, configurationError: 'Projektets gemte Vercel-forbindelse kunne ikke læses. Vælg forbindelsen igen.' }; }
  }
  async trackingURL(root, expectedProvider) {
    // Rendererens URL og tidligere observationer bruges aldrig som åbningsgrundlag.
    const tracking = await this.tracking(root, true);
    if (!tracking.observed) throw Error('Den valgte udgivelse kunne ikke kontrolleres. Kontrollér status igen.');
    if (tracking.automatic) {
      if (expectedProvider && expectedProvider !== 'vercel') throw Error('Den valgte udgivelse er ændret. Kontrollér status igen.');
      if (tracking.latest?.state !== 'READY' || !tracking.latest.url) throw Error('Der er endnu ingen færdig Git-udgivelse at åbne.');
      return publicURL(tracking.latest.url, '.vercel.app');
    }
    const receipt = tracking.last, provider = receipt?.config?.provider;
    if (!receipt || expectedProvider && expectedProvider !== provider) throw Error('Den valgte udgivelse er ændret. Kontrollér status igen.');
    if (receipt.checks?.provider?.status !== 'checked') throw Error('Udgivelsen kunne ikke kontrolleres. Prøv igen.');
    if (provider === 'promte') {
      const host = promteHost(receipt.config.host);
      if (receipt.target?.host !== new URL(host).hostname) throw Error('Promte-destinationen har ændret sig.');
      return host;
    }
    if (receipt.state === 'READY' && receipt.url) {
      if (['vercel', 'azure', 'azure-containers', 'komplai'].includes(provider)) return publicURL(receipt.url, { vercel: '.vercel.app', azure: '.azurestaticapps.net', 'azure-containers': '.azurecontainerapps.io', komplai: '.komplai.run' }[provider]);
      if (provider === 'cloudflare') {
        // Statusadapteren matcher Git-version og præcis workflowkørsel.
        // Cloudflares tildelte subdomæne kan afvige fra projektnavnet.
        pagesConfiguration(receipt.config);
        return publicURL(receipt.url, '.pages.dev');
      }
      if (provider === 'github-pages') {
        const c = pagesConfiguration(receipt.config), url = siteURL(receipt.url);
        // Et eget domæne accepteres kun, når GitHub selv bekræfter det for dette repository.
        const setup = await this.deployments.providers[provider].setup(c);
        if (setup.pages?.url && siteURL(setup.pages.url) === url && setup.repository?.fullName?.toLowerCase() === c.repository.toLowerCase()) return url;
      }
      throw Error('Udgivelsesadressen matcher ikke den valgte destination.');
    }
    if (['github-pages', 'cloudflare'].includes(provider) && receipt.workflowURL) {
      const c = pagesConfiguration(receipt.config), url = new URL(receipt.workflowURL);
      const paths = [`/${c.repository}/actions/workflows/${workflowPath(c).split('/').pop()}`];
      if (Number.isSafeInteger(receipt.runId) && receipt.runId > 0) paths.push(`/${c.repository}/actions/runs/${receipt.runId}`);
      if (url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash && paths.includes(url.pathname)) return url.href;
    }
    throw Error('Der er endnu ingen kontrolleret adresse at åbne.');
  }
}
module.exports = { DeploymentSetup };
