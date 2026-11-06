(() => {
  const $ = selector => document.querySelector(selector);
  const providers = [
    ['azure', 'Azure Static Web Apps', 'Kræver Microsoft-konto og Azure-abonnement'],
    ['cloudflare', 'Cloudflare Pages', 'Kræver Cloudflare-konto og GitHub-konto'],
    ['github-pages', 'GitHub Pages', 'Kræver GitHub-konto'],
    ['komplai', 'komplai Run', 'Kræver komplai-konto'],
    ['promte', 'Promte Apps', 'Kræver konto og betalt aftale'],
    ['vercel', 'Vercel', 'Kræver Vercel-konto']
  ];
  const titles = { setupConnection: 'Forbind din konto', setupChoice: 'Vælg destination', promteHost: 'Hvor logger du ind med Promte?', promteNotReady: 'Appen er ikke klar til Promte endnu.', promteWorkspace: 'Hvilket arbejdsområde skal modtage appen?', pagesRepository: 'Hvor ligger dit projekt på GitHub?', pagesBranch: 'Hvilken branch vil du udgive?', cloudflareAccount: 'Hvilken Cloudflare-konto bruger du?', cloudflareProject: 'Hvilket Pages-projekt vil du opdatere?', setupConfiguration: 'Gør projektet klar til udgivelse', setupConfigReview: 'Gennemgå opsætningsfilerne', vercelMethod: 'Hvordan vil du bruge Vercel?', vercelGit: 'Forbind dit Git-projekt', tracking: 'Udgivelser fra Git' };
  const names = Object.fromEntries(providers.map(([id, name]) => [id, name]));
  const stateLabels = { READY: 'Udgivet', ERROR: 'Udgivelse fejlede', CANCELED: 'Annulleret', BLOCKED: 'Kræver handling', REJECTED: 'Afvist', QUEUED: 'I kø', BUILDING: 'Bygger', INITIALIZING: 'Forbereder', PREPARED: 'Upload afventer', REVIEWING: 'Under gennemgang', SUBMITTING: 'Udgivelse afventer', UNKNOWN: 'Kontrollér status', AWAITING_UPDATE: 'Afventer udgivelsen', UPLOADED: 'Upload modtaget', REPLACED: 'Nyere version udgivet', UNPUBLISHED: 'Ikke udgivet', REMOVED: 'Fjernet' };
  const logo = id => `provider-${id}.${id === 'cloudflare' ? 'png' : 'svg'}`;
  window.DeploymentSetupUI = { titles, mount({ api, go, back, busy, rows, heading, invalidate, chooseProvider, prepareReview, input, receipt, openDialog }) {
    const dialog = $('#deployment-dialog');
    const choiceSteps = { 'azure-subscription': 'azureSubscription', 'azure-app': 'azureApp', 'vercel-team': 'vercelTeam', 'vercel-project': 'vercelProject' };
    const choices = new Map();
    let savedVercel = null, promteLogin = null;
    let promteSaved = '', promteHost = '';
    const normalizedHost = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.origin : ''; } catch { return ''; } };
    let choice = null, connection = null, configReview = null, gitProject = null, tracking = null, polling = null, loginID = null, epoch = 0, refreshing = false, trackingRoot = null, trackingError = false;
    const provider = () => $('#deploy-provider').value;
    const pages = () => ['github-pages', 'cloudflare'].includes(provider());
    const act = (action, config = input(), extra = {}) => api('deploymentSetup', { action, config, ...extra });
    const open = (kind, id = provider()) => api('deploymentSetupOpen', { provider: id, kind, config: input() });
    const bind = (id, fn) => $(id).onclick = () => busy(fn);
    const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
    function providerList() {
      $('#deployment-provider-list').replaceChildren(...providers.map(([id, name, requirement]) => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.provider = id; button.className = 'deployment-provider-row';
        const img = document.createElement('img'); img.src = logo(id); img.alt = ''; img.width = 32; img.height = 32;
        const label = document.createElement('span'); label.append(text('strong', name), text('small', requirement));
        button.append(img, label, text('span', '›')); button.lastChild.setAttribute('aria-hidden', 'true');
        button.onclick = () => busy(() => chooseProvider(id)); return button;
      }));
    }
    function config() {
      if (provider() === 'promte') return { host: $('#deploy-promte-host').value.trim(), workspaceId: promteWorkspaceId(), mode: 'source' };
      if (pages()) return { repository: $('#deploy-repository').value.trim(), branch: $('#deploy-branch').value.trim(), accountId: $('#deploy-cloudflare-account').value.trim(), project: $('#deploy-cloudflare-project').value.trim(), mode: 'static' };
      return {};
    }
    function restore(c = {}) {
      for (const [key, id] of Object.entries({ host: 'promte-host', repository: 'repository', branch: 'branch', accountId: 'cloudflare-account' })) if (c[key]) $('#deploy-' + id).value = c[key];
      if (c.provider === 'promte' && c.workspaceId) { promteHost = normalizedHost(c.host); promteSaved = c.workspaceId; $('#deploy-promte-workspace-id').value = c.workspaceId; }
      if (c.provider === 'cloudflare' && c.project) $('#deploy-cloudflare-project').value = c.project;
    }
    // Promte: vælg en app fra listen, opret en ny eller indtast ID'et på servere uden listen.
    function promteWorkspaceId() { const value = $('#deploy-promte-workspace').value; return value === '__id__' ? $('#deploy-promte-workspace-id').value.trim() : value === '__new__' ? '' : value; }
    function promteFields() { const value = $('#deploy-promte-workspace').value; $('#deploy-promte-new').hidden = value !== '__new__'; $('#deploy-promte-manual').hidden = value !== '__id__'; }
    $('#deploy-promte-workspace').onchange = promteFields;
    let promteNames = new Map();
    async function promteWorkspaces(state) {
      $('#deploy-promte-account').textContent = state.email ? `Logget ind som ${state.email}.` : state.loginSource === 'cli' ? 'Logget ind med Promtes kommandolinjeværktøj.' : '';
      const host = normalizedHost($('#deploy-promte-host').value);
      if (host !== promteHost) { promteSaved = ''; $('#deploy-promte-workspace').replaceChildren(); $('#deploy-promte-workspace-id').value = ''; }
      promteHost = host;
      let items = [], note = '', linked = null, suggested = '';
      try { ({ link: linked, suggestedName: suggested } = await act('promte-link')); } catch (error) { if (error.stale) throw error; }
      if (!host || normalizedHost(linked?.host) !== host) linked = null;
      try { items = await act('promte-workspaces'); note = items.length ? 'Den nye version erstatter appens udgivne version, når den er godkendt.' : 'Du har endnu ingen apps. Aura opretter en ny app til projektet.'; }
      catch (error) { if (error.stale) throw error; note = `${error.message} Du kan indtaste arbejdsområdets ID i stedet.`; }
      // Projektets app fra forhåndsvisningen eller en tidligere udgivelse vælges, også når den ikke står på listen.
      if (linked?.workspaceId && !items.some(item => item.id === linked.workspaceId)) items.unshift({ id: linked.workspaceId, name: linked.name, activeAppVersion: null });
      promteNames = new Map(items.map(item => [item.id, item.name]));
      const keep = promteWorkspaceId() || promteSaved || linked?.workspaceId;
      $('#deploy-promte-workspace').replaceChildren(...items.map(item => new Option(item.activeAppVersion ? `${item.name} · version ${item.activeAppVersion}` : item.name, item.id)), new Option('Ny app …', '__new__'), new Option('Indtast ID …', '__id__'));
      $('#deploy-promte-workspace').value = items.some(item => item.id === keep) ? keep : linked ? '__new__' : note.includes('ID') ? '__id__' : '__new__';
      if (!$('#deploy-promte-name').value) $('#deploy-promte-name').value = suggested || '';
      $('#deploy-promte-workspace-note').textContent = note; promteFields();
      go('promteWorkspace');
    }
    function showChoice(kind, items, title, note, next, reload) {
      const step = choiceSteps[kind], previous = choices.get(step);
      const selected = previous?.items.some(item => item.id === previous.selected) ? previous.selected : '';
      choice = { kind, items, title, note, next, reload, selected };
      if (!selected && kind === 'vercel-team' && savedVercel) choice.selected = items.find(item => item.slug === savedVercel.scope || item.id === savedVercel.scope)?.id || '';
      if (!selected && kind === 'vercel-project' && savedVercel) choice.selected = savedVercel.project;
      choices.set(step, choice);
      go(step);
    }
    function renderChoice(value) {
      choice = value;
      $('#deployment-choice-label').textContent = { 'azure-subscription': 'Azure-abonnement', 'azure-app': 'Azure-app', 'vercel-team': 'Vercel-team', 'vercel-project': 'Vercel-projekt' }[choice.kind];
      $('#deployment-choice').replaceChildren(new Option('Vælg …', ''), ...choice.items.map(item => new Option(item.name, item.id)));
      if (choice.items.some(item => item.id === choice.selected)) $('#deployment-choice').value = choice.selected;
      $('#deployment-choice-note').textContent = choice.note;
      $('#deployment-choice-continue').disabled = !choice.items.length;
      heading(choice.title);
    }
    $('#deployment-choice').onchange = () => { if (choice) choice.selected = $('#deployment-choice').value; };
    bind('#deployment-choice-continue', async () => {
      const item = choice?.items.find(item => item.id === $('#deployment-choice').value);
      if (!item) throw Error('Vælg en mulighed fra listen.');
      await choice.next(item);
    });
    bind('#deployment-choice-refresh', () => choice?.reload());
    bind('#deployment-choice-portal', () => open('portal'));
    async function azureApps(subscription) {
      $('#deploy-subscription').value = subscription;
      const items = await act('azure-apps', { subscription });
      showChoice('azure-app', items, 'Hvilken Azure-app vil du bruge?', items.length ? 'Udgiver til appens testmiljø.' : 'Ingen apps fundet. Opret en Static Web App i Azure, og kontrollér igen.', item => { $('#deploy-project').value = item.name; $('#deploy-group').value = item.group; go('files'); }, () => azureApps(subscription));
    }
    async function vercelProjects(scope) {
      $('#deploy-scope').value = scope;
      const items = await act('vercel-projects', { scope });
      showChoice('vercel-project', items, 'Hvilket Vercel-projekt vil du bruge?', items.length ? '' : 'Forbind dit repository i Vercel, og kontrollér igen.', item => {
        gitProject = item; $('#deploy-project').value = item.name;
        $('#deployment-vercel-description').textContent = item.gitConnected ? 'Vercel er forbundet til dit GitHub-projekt.' : 'Dette projekt er endnu ikke forbundet til GitHub.';
        rows('#deployment-vercel-details', [['Projekt', item.name], ['GitHub', item.repository], ['Produktionsbranch', item.productionBranch], ['Projektmappe', item.rootDirectory || 'Hele repositoryet']]);
        $('#deployment-vercel-track').disabled = !item.gitConnected;
        $('#deployment-vercel-import').textContent = item.gitConnected ? 'Åbn Vercel' : 'Forbind repository hos Vercel'; go('vercelGit');
      }, () => vercelProjects(scope));
    }
    async function repositoryStep() {
      const repositories = await act('github-repositories');
      $('#deployment-repositories').replaceChildren(...repositories.map(repo => new Option(repo.fullName, repo.fullName)));
      go('pagesRepository');
    }
    async function cancelPromteLogin() {
      const pending = promteLogin; if (!pending || pending.cancelled) return;
      pending.cancelled = true; $('#deployment-cancel-login').disabled = true;
      $('#deployment-progress-label').textContent = 'Afbryder login …';
      try { await api('deploymentCancelSetup', { provider: 'promte', host: pending.host }); }
      catch (error) { if (!error.stale && promteLogin === pending && dialog.open) { pending.cancelled = false; $('#deployment-cancel-login').disabled = false; $('#deployment-feedback').textContent = error.message; } }
    }
    $('#deployment-cancel-login').onclick = cancelPromteLogin;
    async function loadConnection(login = false) {
      const id = provider(), token = epoch;
      const auth = pages() ? 'github' : id;
      const pending = auth === 'promte' && login ? { host: $('#deploy-promte-host').value.trim(), cancelled: false } : null;
      if (pending) { promteLogin = pending; $('#deployment-cancel-login').hidden = false; $('#deployment-cancel-login').disabled = false; $('#deployment-progress-label').textContent = 'Venter på login …'; }
      let state;
      try { state = await act(`${auth}-${login ? 'login' : 'state'}`); }
      catch (error) {
        if (!error.stale && pending?.cancelled && token === epoch && dialog.open) { back(); $('#deployment-feedback').textContent = 'Login blev afbrudt. Kontrollér adressen, og prøv igen.'; return; }
        throw error;
      } finally {
        if (pending && promteLogin === pending) { promteLogin = null; $('#deployment-cancel-login').hidden = true; $('#deployment-cancel-login').disabled = false; }
      }
      if (pending?.cancelled) { if (token === epoch && dialog.open) back(); return; }
      if (token !== epoch || !dialog.open) return;
      connection = state; if (auth === 'vercel') savedVercel = state.projectConfig || null;
      let connectionError = '';
      if (auth === 'github' && state.connected && !state.expired) {
        try { return await repositoryStep(); }
        catch (error) { if (error.stale) throw error; connectionError = `${error.message} Log ind igen, eller ret adgangen hos GitHub.`; }
      }
      if (token !== epoch || !dialog.open) return;
      if (auth === 'promte' && state.connected) { await promteWorkspaces(state); return; }
      if (auth === 'azure' && state.status === 'ready') {
        showChoice('azure-subscription', state.subscriptions, 'Hvilket Azure-abonnement vil du bruge?', '', item => azureApps(item.id), () => loadConnection()); return;
      }
      if (auth === 'vercel' && state.status === 'ready') {
        showChoice('vercel-team', state.teams, 'Hvilket Vercel-team vil du bruge?', state.configurationError || (savedVercel ? 'Dit gemte valg er udfyldt. Bekræft destinationen for dette projekt.' : ''), item => vercelProjects(item.slug), () => loadConnection()); return;
      }
      const [, name, requirement] = providers.find(item => item[0] === id);
      $('#deployment-service-logo').src = logo(id); $('#deployment-service-name').textContent = name; $('#deployment-service-requirement').textContent = requirement;
      const toolsMissing = state.status === 'tools-required' || auth === 'promte' && !state.installed;
      $('#deployment-connect').hidden = toolsMissing || auth === 'github' && !state.browserLogin && !state.localLogin;
      $('#deployment-connect').textContent = auth === 'github' && state.localLogin ? 'Brug dit GitHub-login på computeren' : 'Log ind i browseren';
      $('#deployment-connection-note').textContent = connectionError || (toolsMissing ? 'Installér udbyderens værktøj, og vælg Kontrollér igen.' : auth === 'github' && !state.browserLogin && !state.localLogin ? 'Log ind med GitHub CLI på computeren, eller brug en adgangsnøgle under hjælpen.' : state.status === 'no-subscriptions' ? 'Ingen Azure-abonnementer med adgang. Prøv en anden konto, eller bed jeres administrator om adgang.' : state.status === 'no-teams' ? 'Ingen Vercel-teams med adgang. Kontrollér din konto hos Vercel.' : 'Fortsæt med din konto hos udbyderen.');
      $('#deployment-install-note').textContent = auth === 'azure' ? 'Azure CLI bruges til login. SWA CLI bruges til udgivelse.' : auth === 'github' ? 'GitHub CLI kan logge ind i browseren. Aura bruger først kontoen, når du vælger det.' : auth === 'promte' ? 'Aura åbner Promte i browseren. Log ind, og godkend Aura. Du skal være administrator i appens arbejdsområde for at udgive.' : 'Vercels værktøj åbner login i browseren.';
      $('#deployment-install').hidden = auth === 'promte';
      $('#deployment-install').textContent = auth === 'azure' && state.tools?.azureCli ? 'Installér SWA CLI' : auth === 'github' ? 'Se login med GitHub CLI' : 'Installér udbyderens værktøj';
      $('#deployment-github-token').hidden = auth !== 'github';
      $('#deployment-connection-help').open = toolsMissing;
      go('setupConnection');
    }
    bind('#deployment-connect', async () => {
      if (pages()) {
        if (connection?.localLogin) { await act('github-local'); return loadConnection(); }
        const r = await api('hostingLogin'); loginID = r.id;
        $('#deployment-connection-note').textContent = `Indtast koden ${r.code} hos GitHub.`;
        await api('hostingBrowser');
        polling = setTimeout(() => pollLogin(r.id), Math.max(1000, r.retryAfter)); return;
      }
      $('#deployment-connection-note').textContent = provider() === 'promte' ? 'Godkend Aura i browseren.' : 'Fortsæt i browseren.';
      await loadConnection(true);
    });
    async function pollLogin(id) {
      if (loginID !== id || !dialog.open) return;
      try {
        const r = await api('hostingPoll', id); if (loginID !== id || !dialog.open) return;
        if (r.waiting) polling = setTimeout(() => pollLogin(id), Math.max(1000, r.retryAfter));
        else { loginID = null; await busy(() => loadConnection()); }
      } catch (error) { if (error.stale) return; loginID = null; $('#deployment-feedback').textContent = error.message; }
    }
    bind('#deployment-recheck', () => loadConnection());
    bind('#deployment-install', () => open(pages() ? 'login' : provider() === 'azure' && connection?.tools?.azureCli ? 'swa' : 'install', pages() ? 'github-pages' : provider()));
    bind('#deployment-account-link', () => open('account'));
    bind('#deployment-token-guide', () => open('token', 'github-pages'));
    // Nøglen indtastes i nøglevinduet. Udgiv får kun at vide, om adgangen blev gemt.
    bind('#deployment-token-save', async () => { if (await api('keyGithub', { target: 'publish' })) await loadConnection(); });
    bind('#deployment-promte-host-next', () => { if ($('#deploy-promte-host').reportValidity()) return loadConnection(); });
    bind('#deployment-promte-open', () => open('host'));
    bind('#deployment-promte-workspace-next', async () => {
      if ($('#deploy-promte-workspace').value === '__new__') {
        const created = await act('promte-create', input(), { name: $('#deploy-promte-name').value });
        $('#deploy-promte-workspace').add(new Option(created.name, created.id), 0); $('#deploy-promte-workspace').value = created.id; promteNames.set(created.id, created.name); $('#deploy-promte-name').value = ''; promteFields();
      }
      if (!promteWorkspaceId()) throw Error('Vælg en app, eller indtast arbejdsområdets ID.');
      promteSaved = promteWorkspaceId();
      const name = promteNames.get(promteSaved) || $('#deploy-promte-workspace').selectedOptions[0]?.textContent || promteSaved;
      await act('promte-link-set', input(), { workspaceId: promteSaved, name: name === 'Indtast ID …' ? promteSaved : name });
      go('files');
    });
    bind('#deployment-promte-logout', async () => { await act('promte-logout'); await loadConnection(); });
    // Brugerens byggehandling bruger Promte-skillen og den normale afsendelse med eventuelt modelsamtykke.
    bind('#deployment-promte-prepare', async () => {
      const owner = typeof selectedOwner === 'function' ? selectedOwner() : null;
      await api('featuresSave', { scope: 'projekt', values: { 'integration-promte': true } }); await window.refreshFeatures?.();
      if (!dialog.open || owner?.root !== selectedOwner()?.root || owner?.chat !== selectedOwner()?.chat) return;
      // Beskeden skrives, når dialogen er lukket, så fokus ender i skrivefeltet og ikke på Udgiv.
      dialog.addEventListener('close', () => window.draftMessage?.('Brug projektets Promte-skill til at gøre appen klar til udgivelse hos Promte. Behold indhold, design og funktioner. Gennemfør ændringerne, og kontrollér resultatet.', 'Promte er valgt. AI’en gør appen klar til udgivelse.', { mode: 'free', submit: true, owner }), { once: true });
      dialog.close();
    });
    bind('#deployment-promte-other', () => back());
    bind('#deployment-repository-next', () => { if (!/^[\w.-]+\/[\w.-]+$/.test($('#deploy-repository').value.trim())) throw Error('Skriv repositoryet som organisation/projekt.'); go('pagesBranch'); });
    bind('#deployment-branch-next', () => { if (!$('#deploy-branch').value.trim()) throw Error('Indtast navnet på branchen.'); go(provider() === 'cloudflare' ? 'cloudflareAccount' : 'directory'); });
    bind('#deployment-cloudflare-open', () => open('portal'));
    bind('#deployment-cloudflare-account-next', () => { if (!/^[a-f0-9]{32}$/i.test($('#deploy-cloudflare-account').value.trim())) throw Error('Kontoens ID skal være 32 tegn.'); go('cloudflareProject'); });
    bind('#deployment-cloudflare-project-next', () => { if (!$('#deploy-cloudflare-project').value.trim()) throw Error('Indtast Pages-projektets navn.'); go('directory'); });
    function configurationStep() {
      const cf = provider() === 'cloudflare';
      $('#deployment-config-status').textContent = 'Gem opsætningen i projektet, og send den til GitHub sammen med hjemmesidens færdige filer.';
      $('#deployment-config-guide').replaceChildren(...(cf ? [
        'Brug et eksisterende Pages-projekt med Direct Upload og samme produktionsbranch som valgt her. Automatisk Git-build skal være slået fra i Cloudflare.',
        'Opret et Cloudflare-token med Pages Edit for kun den valgte konto. Gem det i GitHub-projektets Actions-hemmeligheder som CLOUDFLARE_API_TOKEN.',
        'Gem og send de gennemgåede opsætningsfiler og hjemmesidens filer til GitHub. Kontrollér derefter opsætningen i Aura.'
      ] : [
        'Vælg GitHub Actions som kilde under projektets Settings → Pages.',
        'Gem og send de gennemgåede opsætningsfiler og hjemmesidens filer til GitHub. Kontrollér derefter opsætningen i Aura.',
        'GitHub Pages kan bruge /repository/ i adressen. Billeder, links og navigation skal fungere på den sti.'
      ]).map(line => text('li', line)));
      go('setupConfiguration');
    }
    function showConfigurationReview(value) {
      configReview = value;
      $('#deployment-config-files').replaceChildren(...configReview.files.map(file => {
        const details = document.createElement('details'); details.append(text('summary', `${file.path} · ${file.changed ? file.before === null ? 'Ny fil' : 'Ændres' : 'Uændret'}`));
        if (file.before !== null) { details.append(text('h4', 'Nuværende fil'), text('pre', file.before)); }
        details.append(text('h4', 'Efter ændringen'), text('pre', file.content)); return details;
      })); go('setupConfigReview');
    }
    bind('#deployment-config-review', async () => showConfigurationReview(await act('config-review')));
    bind('#deployment-save-settings', async () => showConfigurationReview(await act('config-review')));
    bind('#deployment-config-save', async () => { if (!configReview) throw Error('Gennemgå opsætningen igen.'); const fromGit = configReview.config?.provider === 'vercel'; const r = await act(fromGit ? 'vercel-track' : 'config-save', {}, { token: configReview.token }); configReview = null; if (fromGit) { await refresh(true); showTracking(); } else if (pages()) configurationStep(); else go('files'); $('#deployment-feedback').textContent = r.message; });
    bind('#deployment-config-check', async () => {
      const r = await act('pages-state'); $('#deployment-config-status').textContent = r.message || (r.ready ? 'Opsætningen er klar.' : 'Opsætningen mangler noget.');
      if (r.ready) await prepareReview();
    });
    bind('#deployment-config-provider', () => open(provider() === 'cloudflare' ? 'provider' : 'settings'));
    bind('#deployment-config-repository', () => open('repository'));
    bind('#deployment-vercel-git', () => loadConnection());
    bind('#deployment-vercel-once', () => go('team'));
    bind('#deployment-vercel-link', () => open('portal'));
    bind('#deployment-vercel-import', () => gitProject?.gitConnected
      ? api('deploymentSetupOpen', { provider: 'vercel', kind: 'project', config: { scope: $('#deploy-scope').value, project: gitProject.id, repository: gitProject.repository } })
      : open('import'));
    bind('#deployment-vercel-track', async () => {
      if (!gitProject?.gitConnected) throw Error('Forbind projektet til GitHub hos Vercel først.');
      showConfigurationReview(await act('vercel-review', { scope: $('#deploy-scope').value, project: gitProject.id, repository: gitProject.repository }));
    });
    async function choose(id) {
      ++epoch; choice = null; choices.clear(); connection = null; gitProject = null;
      if (id === 'komplai') return false;
      if (id === 'promte') {
        $('#deploy-directory').value = '.';
        // Promte tager kun Promte-apps. Er projektet ikke en, siger Udgiv det, før brugeren logger ind.
        const { problem } = await act('promte-check');
        if (problem) { $('#deploy-promte-problem').textContent = problem.summary; $('#deploy-promte-problem-detail').textContent = problem.detail; go('promteNotReady'); return true; }
        // Brug samme Promte som projektets forhåndsvisning.
        try { const { link } = await act('promte-link'); if (link?.host) $('#deploy-promte-host').value = link.host; } catch (error) { if (error.stale) throw error; }
        go('promteHost');
      }
      else if (id === 'vercel') go('vercelMethod');
      else await loadConnection();
      return true;
    }
    function statusText(value) {
      if (value?.automatic) return `Vercel · ${value.latest ? stateLabels[value.latest.state] || 'Kontrollér status' : 'Følger Git'}`;
      const r = value?.last; if (r?.checks?.provider?.status === 'unknown') return `${names[r.config.provider] || 'Udgivelse'} · Status kunne ikke hentes`; return r ? `${names[r.config.provider] || 'Udgivelse'} · ${r.state === 'READY' && window.ShareView.addressUnchecked(r) ? window.ShareView.UNCHECKED : stateLabels[r.state] || 'Kontrollér status'}` : '';
    }
    function renderHeader(error = trackingError) {
      const button = $('#deployment-status'), has = Boolean(tracking?.automatic || tracking?.last);
      button.hidden = !has || !window.sharingOn?.() || !trackingRoot;
      button.disabled = $('#deploy-button').disabled;
      button.textContent = error ? 'Udgivelse · Status kunne ikke hentes' : statusText(tracking);
      button.dataset.state = error || tracking?.last?.checks?.provider?.status === 'unknown' ? 'UNKNOWN' : tracking?.latest?.state || tracking?.last?.state || '';
      button.title = tracking?.automatic ? 'Se status for udgivelser fra Git' : 'Se seneste udgivelse';
    }
    async function refresh(remote = false) {
      if (refreshing) { await refreshing; if (remote) return refresh(true); return; }
      const root = trackingRoot;
      refreshing = (async () => {
        try {
          const value = await api('deploymentTracking', { refresh: remote }, { root, chat: null });
          if (root !== trackingRoot) return;
          const sameGit = tracking?.automatic && value?.automatic && JSON.stringify(tracking.config) === JSON.stringify(value.config);
          if (!remote && sameGit) value.latest = tracking.latest;
          tracking = value; trackingRoot = value?.root || null;
          if (remote || !sameGit) trackingError = false;
          renderHeader();
          if (dialog.open && !$('#deployment-form [data-deploy-step="tracking"]').hidden) renderTracking();
        } catch (error) { if (root === trackingRoot) { trackingError = true; renderHeader(); if (dialog.open && !$('#deployment-form [data-deploy-step="tracking"]').hidden) renderTracking(); if (remote && dialog.open) throw error; } }
      })();
      try { await refreshing; }
      finally { refreshing = false; if (root !== trackingRoot && !tracking) refresh(false).catch(() => {}); }
    }
    function renderTracking() {
      const v = tracking?.latest, c = tracking?.config;
      $('#deployment-tracking-note').textContent = trackingError ? 'Status kunne ikke hentes. Kontrollér login og prøv igen.' : v ? `${stateLabels[v.state] || 'Ukendt status'} · ${v.environment === 'production' ? 'Produktion' : v.environment === 'preview' ? 'Testudgave' : 'Ukendt miljø'}` : 'Ingen Git-udgivelse registreret endnu. Kontrollér status efter næste push.';
      rows('#deployment-tracking-details', [['Projekt', c?.name], ['GitHub', c?.repository], ['Produktionsbranch', c?.productionBranch], ...(v ? [['Branch', v.branch], ['Version', v.sha.slice(0, 8)], ['Registreret', window.ShareView.time(v.at)]] : [])]);
      $('#deployment-tracking-open').hidden = trackingError || !v?.url || v.state !== 'READY';
    }
    function showTracking() { renderTracking(); go('tracking', { remember: false }); }
    bind('#deployment-tracking-refresh', () => refresh(true));
    bind('#deployment-tracking-open', () => open('tracking', 'vercel'));
    bind('#deployment-tracking-provider', () => open('settings', 'vercel'));
    bind('#deployment-tracking-stop', async () => { await act('vercel-reset'); await refresh(); go('destination', { remember: false }); });
    $('#deployment-status').onclick = () => openDialog(true);
    function opened(wantStatus) { if (wantStatus && tracking?.automatic) showTracking(); }
    function projectChanged(root) { trackingRoot = root || null; tracking = null; trackingError = false; renderHeader(); if (root) refresh(false); }
    window.addEventListener('aura:project', event => projectChanged(event.detail?.root));
    new MutationObserver(() => renderHeader()).observe($('#deploy-button'), { attributes: true, attributeFilter: ['hidden', 'disabled'] });
    window.addEventListener('aura:features', () => renderHeader());
    setInterval(() => { if (trackingRoot && !document.hidden && !$('#workspace').hidden && window.sharingOn?.() && (tracking?.automatic || (tracking?.last?.id && tracking.last.config?.provider !== 'komplai'))) refresh(true).catch(() => {}); }, 30000);
    dialog.addEventListener('close', () => { void cancelPromteLogin(); ++epoch; clearTimeout(polling); if (loginID) api('hostingCancel').catch(() => {}); loginID = null; configReview = null; });
    providerList();
    return { choose, config, restore, opened, refresh, configurationStep, pages, panel: step => choices.has(step) ? 'setupChoice' : step, render(step) { if (step !== 'setupConnection' && loginID) { clearTimeout(polling); loginID = null; api('hostingCancel').catch(() => {}); } if (step === 'options') $('#deployment-save-settings').hidden = provider() === 'komplai'; if (step === 'providers') providerList(); if (choices.has(step)) renderChoice(choices.get(step)); }, title: step => choices.get(step)?.title || titles[step], reset() { ++epoch; choices.clear(); choice = null; promteSaved = ''; promteHost = ''; promteNames.clear(); $('#deploy-promte-workspace').replaceChildren(); $('#deploy-promte-workspace-id').value = ''; providerList(); } };
  } };
})();
