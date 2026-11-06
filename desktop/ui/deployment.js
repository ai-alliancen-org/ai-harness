(() => {
  const $ = selector => document.querySelector(selector), view = window.ShareView;
  const dialog = $('#deployment-dialog'), form = $('#deployment-form');
  let dialogOwner = null, session = 0;
  const assertCurrent = token => { if (token !== session) throw Object.assign(Error('Gennemgangen er lukket.'), { stale: true }); };
  const api = async (method, input, owner) => {
    const token = session; let r;
    try { r = await window.harness[method](input, owner === undefined ? dialogOwner : owner); }
    catch (error) { if (owner === undefined) assertCurrent(token); throw error; }
    if (owner === undefined) assertCurrent(token);
    if (!r.ok) throw Error(r.error); return r.value;
  };
  let guides = [], review = null, last = null, context = null, step = 'destination', trail = [], busyNow = false;
  // komplai: færdige filer fra en mappe som hidtil, eller en lokal bygning, når projektet har et byggescript og ingen færdig mappe.
  let komplaiSource = null, folderChosen = false, sourceToken = 0;
  const publish = { overview: null, account: null, organisations: [], generation: 0, slugEdited: false, addressCheck: 0, loginPending: false };
  const titles = { sharingOff: 'Vil du udgive dit projekt?', destination: 'Hvordan vil du udgive?', providers: 'Hvor vil du udgive?', guides: 'Hvilken udbyder vil du læse om?', login: 'Log ind med komplai', organisation: 'Hvilken organisation vil du udgive for?', connect: 'Forbind organisationen?', app: 'Hvilken app vil du udgive til?', existing: 'Hvilken app vil du opdatere?', name: 'Hvad skal appen hedde?', address: 'Hvilken adresse skal appen have?', access: 'Hvem kan åbne appen?', confirmPublic: 'Skal appen være offentlig?', team: 'Hvilket Vercel-team bruger du?', subscription: 'Hvilket Azure-abonnement bruger du?', group: 'Hvilken ressourcegruppe bruger du?', project: 'Hvilket projekt vil du udgive til?', files: 'Klar til at udgive den gemte version?', options: 'Hvad vil du rette?', destinationOptions: 'Hvad vil du rette ved destinationen?', account: 'Konto og adgang', providerGuide: 'Udbyderens opsætning', kind: 'Hvad skal udgives?', directory: 'Hvor ligger filerne?', functions: 'Hvor ligger webside og Functions?', review: 'Gennemgå udgivelsen', result: 'Seneste udgivelse' };
  const onward = { name: 'access', confirmPublic: 'files', team: 'project', subscription: 'group', group: 'project', project: 'files', kind: 'directory', functions: 'files' };
  const fields = { name: ['deploy-komplai-name'], confirmPublic: ['deploy-komplai-confirm'], team: ['deploy-scope'], subscription: ['deploy-subscription'], group: ['deploy-group'], project: ['deploy-project'], directory: ['deploy-directory'], functions: ['deploy-frontend', 'deploy-api'] };
  const komplai = () => $('#deploy-provider').value === 'komplai';
  const komplaiBuild = () => komplai() && komplaiSource?.build === true && !folderChosen;
  const chosenApp = () => publish.overview?.apps.find(app => app.id === $('#deploy-komplai-app').value);
  function rows(id, values) { $(id).replaceChildren(...values.flatMap(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value || 'Ikke oplyst'; return [dt, dd]; })); }
  function appCard(prefix, r) { const value = view.identity(r); for (const key of ['name', 'address', 'account']) $(`#${prefix}-${key}`).textContent = value[key]; }
  function invalidate() { review = null; $('#deployment-send').disabled = true; }
  function heading(title) { $('#deployment-heading').textContent = title; dialog.setAttribute('aria-labelledby', 'deployment-heading'); if (dialog.open) { dialog.scrollTop = 0; $('#deployment-heading').focus(); } }
  function navigation() {
    $('#deployment-back').hidden = !trail.length || publish.loginPending;
    $('#deployment-provider-help').hidden = komplai() || !['team', 'subscription', 'group', 'project'].includes(step);
    const retainedSelection = step === 'existing' && Boolean(chosenApp()) || step === 'organisation' && Boolean($('#komplai-publish-org').value);
    $('#deployment-next').hidden = !(onward[step] || ['address', 'directory', 'files'].includes(step) || retainedSelection);
    $('#deployment-next').textContent = step === 'files' ? (komplaiBuild() ? 'Byg og gennemgå' : 'Gennemgå udgivelse') : step === 'existing' ? 'Brug denne app' : 'Fortsæt';
  }
  function renderStep() {
    if (step === 'review') $('#deployment-review-footer').prepend($('#deployment-feedback')); else $('#deployment-feedback-slot').append($('#deployment-feedback'));
    for (const panel of form.querySelectorAll('[data-deploy-step]')) panel.hidden = panel.dataset.deployStep !== setup.panel(step);
    form.hidden = ['review', 'result'].includes(step); $('#deployment-review').hidden = step !== 'review'; $('#deployment-result').hidden = step !== 'result';
    navigation();
    $('#deployment-intro').textContent = step === 'destination' ? 'Giv andre et link til dit projekt.' : step === 'files' ? (komplai() ? 'Filerne sendes til organisationens app hos komplai.' : setup.pages() ? 'Den offentlige hjemmeside opdateres gennem GitHub Actions.' : $('#deploy-provider').value === 'promte' ? 'Kildekoden sendes til dit arbejdsområde hos Promte.' : 'Filerne sendes til et testmiljø hos den valgte udbyder.') : '';
    $('#deployment-intro').hidden = !$('#deployment-intro').textContent;
    $('#deployment-copy').hidden = !context?.viewingCopy || step === 'result' || step === 'sharingOff';
    $('#deployment-komplai-account').hidden = !komplai() || ['account', 'login', 'organisation', 'connect', 'destination', 'providers', 'sharingOff', 'guides'].includes(step);
    if (step === 'files') {
      $('#deployment-scope').textContent = view.scope(context);
      const app = chosenApp(); $('#deploy-komplai-current').hidden = !komplai() || !app;
      if (app) $('#deploy-komplai-current').textContent = `${new URL(app.url).hostname} · ${app.visibility === 'public' ? 'Alle med linket' : 'Organisationen'}. En ny version erstatter den udgivne.`;
      sourceView();
      if (komplai()) void refreshSource();
    }
    if (step === 'app') {
      $('#komplai-publish-org-name').textContent = publish.overview?.organisationName || '';
      $('#komplai-publish-address').textContent = publish.overview?.address || '';
      $('#deploy-komplai-choose').hidden = !publish.overview?.apps.length;
    }
    if (step === 'destinationOptions') $('#deployment-account-options').open = !komplai();
    if (step === 'confirmPublic') publicConfirmation();
    if (step === 'account') {
      const app = chosenApp(); $('#deployment-account-name').textContent = publish.account?.organisationName || publish.overview?.organisationName || '';
      $('#deployment-account-access').textContent = app ? `${app.name}: ${app.visibility === 'private' ? 'Organisationens medlemmer' : 'Alle med linket'}.` : 'Forbundet til komplai Run.';
      $('#deploy-komplai-access').hidden = !app;
    }
    heading(titles[step] || setup.title(step) || titles.destination); setup.render(step);
  }
  function go(next, { remember = true, clear = true } = {}) {
    if (remember && step !== next) trail.push(step);
    step = next; if (clear) $('#deployment-feedback').textContent = ''; renderStep();
  }
  function progress(active, label = 'Arbejder …') {
    dialog.setAttribute('aria-busy', String(active)); $('#deployment-progress').hidden = !active;
    $('#deployment-progress-label').textContent = label; $('#deployment-fields').disabled = active;
    for (const id of ['edit', 'another', 'copy-review', 'komplai-account']) $('#deployment-' + id).disabled = active;
  }
  async function busy(fn, label = 'Arbejder …') {
    if (busyNow) return; busyNow = true; const token = session; progress(true, label);
    for (const id of ['check', 'open', 'portal', 'new']) $('#deployment-' + id).disabled = true;
    $('#deployment-feedback').textContent = '';
    try { await fn(); }
    catch (error) {
      if (error.stale || token !== session) return;
      invalidate();
      if (step === 'review') go('files', { remember: false });
      $('#deployment-feedback').textContent = error.message;
    } finally {
      if (token === session) {
        busyNow = false; progress(false);
        $('#deployment-check').disabled = !last?.id; $('#deployment-open').disabled = !last?.url;
        $('#deployment-portal').disabled = !last?.target?.portal; $('#deployment-new').disabled = false;
      }
    }
  }
  function showGuide(selector, id) {
    const option = guides.find(item => item.id === id), target = $(selector); target.replaceChildren(); if (!option) return;
    const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
    target.append(text('p', option.summary));
    const detail = document.createElement('details'); detail.append(text('summary', 'Opsætning, data og aftaler'), text('p', option.scope));
    const steps = document.createElement('ol'); steps.append(...option.steps.map(value => text('li', value))); detail.append(steps, text('p', option.data), text('p', 'Priser og eventuelle gratis kvoter følger din konto. Kontrollér vilkårene hos udbyderen.'));
    for (const kind of Object.keys(option.links)) { const button = text('button', { guide: 'Åbn udbyderens vejledning', data: 'Se aftaler og databehandling', region: 'Se regioner' }[kind]); button.type = 'button'; button.className = 'text-button'; button.onclick = () => api('deploymentGuideOpen', { id, kind }).catch(error => { if (!error.stale) $('#deployment-feedback').textContent = error.message; }); detail.append(button); }
    detail.append(text('small', 'Kilder gennemgået ' + new Date(option.checkedAt + 'T12:00:00Z').toLocaleDateString('da-DK') + '. Jeres konto og aftale er ikke kontrolleret.')); target.append(detail);
    if (!option.integrated) target.prepend(text('p', 'Udgives hos udbyderen. Aura uploader ikke herfra.'));
  }
  async function loadGuides() { guides = (await api('deploymentGuides')).sort((a, b) => a.name.localeCompare(b.name, 'da', { sensitivity: 'base' })); $('#hosting-guide-choice').replaceChildren(new Option('Vælg en udbyder', ''), ...guides.filter(item => !item.integrated).map(item => new Option(item.name, item.id))); showGuide('#hosting-guide-other', $('#hosting-guide-choice').value); }
  $('#hosting-guide-choice').onchange = () => showGuide('#hosting-guide-other', $('#hosting-guide-choice').value);
  function modes() {
    const id = $('#deploy-provider').value, azure = id === 'azure';
    for (const option of $('#deploy-mode').options) option.disabled = id === 'promte' ? option.value !== 'source' : komplai() || ['github-pages', 'cloudflare'].includes(id) ? option.value !== 'static' : azure ? option.value === 'source' : option.value === 'functions';
    if ($('#deploy-mode').selectedOptions[0]?.disabled) $('#deploy-mode').value = id === 'promte' ? 'source' : 'static';
    $('#deployment-account').hidden = !komplai(); $('#deployment-provider-settings').hidden = komplai();
    $('#deployment-change-app').hidden = !komplai(); $('#deployment-account-options > summary').hidden = !komplai();
    $('#deployment-change-destination').textContent = komplai() ? 'Destination og app' : 'Destination og opsætning';
    $('#deployment-file-options').textContent = komplai() ? 'Ret filer og indstillinger' : 'Filer og opsætning';
  }
  function sourceView() {
    const show = komplai() && Boolean(komplaiSource), build = komplaiBuild();
    $('#deploy-komplai-build').hidden = !show;
    $('#deploy-komplai-build').textContent = !show ? '' : build ? 'Appen bygges først på din computer, i en midlertidig kopi af den gemte version og med projektets byggekommando. Det kræver ingen ekstra installation; projektets pakker hentes fra npm. komplai modtager kun de færdige filer.' : `Færdige filer fra mappen ${$('#deploy-directory').value === '.' ? 'projektets rod' : $('#deploy-directory').value}.`;
    $('#deploy-komplai-folder').hidden = !build; $('#deployment-file-options').hidden = build;
    navigation();
  }
  async function refreshSource() {
    const token = ++sourceToken;
    let value = null; try { value = await api('deploymentSource'); } catch (error) { if (error.stale) return; /* Uden svar bruges den valgte mappe. */ }
    if (token !== sourceToken || step !== 'files' || !komplai()) return;
    komplaiSource = value || { directory: $('#deploy-directory').value, build: false };
    if (!folderChosen) $('#deploy-directory').value = komplaiSource.directory;
    sourceView();
  }
  function input() {
    if (komplai()) { const app = chosenApp(), visibility = app?.visibility || document.querySelector('[name="komplai-visibility"]:checked')?.value; return { provider: 'komplai', directory: $('#deploy-directory').value, visibility, ...(komplaiBuild() ? { build: true } : {}), ...(app ? { appId: app.id } : { name: $('#deploy-komplai-name').value, ...(publish.overview?.slugs ? { slug: $('#deploy-komplai-slug').value } : {}), ...(visibility === 'public' ? { confirmPublic: $('#deploy-komplai-confirm').value } : {}) }) }; }
    return { provider: $('#deploy-provider').value, project: $('#deploy-project').value, scope: $('#deploy-scope').value, subscription: $('#deploy-subscription').value, group: $('#deploy-group').value, mode: $('#deploy-mode').value, directory: $('#deploy-directory').value, frontend: $('#deploy-frontend').value, api: $('#deploy-api').value, ...setup.config() };
  }
  const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('');
  function suggest(name) { let label = name.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (label.length > 40) { const cut = label.slice(0, 41), boundary = cut.lastIndexOf('-'); label = (boundary >= 3 ? cut.slice(0, boundary) : cut.slice(0, 40)).replace(/-+$/, ''); } return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(label) && !label.includes('--') ? label : ''; }
  function addressPreview() { $('#deploy-komplai-address-preview').textContent = !publish.overview?.slugs ? '' : $('#deploy-komplai-slug').value ? `Adresse: ${$('#deploy-komplai-slug').value}.${publish.overview.address}` : 'Appen får en tilfældig adresse.'; $('#deploy-komplai-edit-address').hidden = !publish.overview?.slugs; }
  function publishNotice(text = '', tone = 'info') { const el = $('#komplai-publish-feedback'); el.textContent = text; el.dataset.tone = text ? tone : ''; }
  function resetSignin() { publish.overview = null; publish.loginPending = false; $('#komplai-publish-signin').dataset.stage = 'start'; $('#komplai-publish-login').hidden = false; $('#komplai-publish-cancel').hidden = true; }
  function fillApps() {
    const keep = $('#deploy-komplai-app').value, query = $('#deploy-komplai-search').value.toLocaleLowerCase('da');
    const apps = (publish.overview?.apps || []).filter(app => `${app.name} ${new URL(app.url).hostname}`.toLocaleLowerCase('da').includes(query));
    $('#deploy-komplai-app').replaceChildren(new Option('Vælg en app', ''), ...apps.map(app => new Option(`${app.name} · ${new URL(app.url).hostname}`, app.id)));
    if (apps.some(app => app.id === keep)) $('#deploy-komplai-app').value = keep;
    $('#deploy-komplai-empty').hidden = Boolean(apps.length); if (step === 'existing') navigation();
  }
  async function loadPublish() {
    const state = await api('komplaiPublishState');
    publish.account = state;
    if (!state.connected || state.expired) { resetSignin(); if (state.expired) publishNotice('Udgivelsesadgangen er udløbet. Log ind med komplai igen.', 'error'); return false; }
    try { publish.overview = await api('komplaiPublishOverview'); fillApps(); $('#deploy-komplai-suffix').textContent = '.' + publish.overview.address; addressPreview(); return true; }
    catch (error) { if (error.stale) throw error; resetSignin(); publishNotice(error.message, 'error'); return false; }
  }
  async function chooseProvider(provider) { invalidate(); $('#deploy-provider').value = provider; modes(); if (provider === 'komplai') { const ready = await loadPublish(); go(ready ? 'app' : 'login'); } else await setup.choose(provider); }
  for (const button of form.querySelectorAll('[data-provider]')) button.onclick = () => busy(() => chooseProvider(button.dataset.provider));
  $('#deployment-other').onclick = () => go('providers'); $('#deployment-guides').onclick = () => go('guides');
  function showOrganisation() {
    const organisation = publish.organisations.find(item => item.id === $('#komplai-publish-org').value); if (!organisation) return;
    const avatar = document.createElement('span'), name = document.createElement('span'), line = document.createElement('span');
    avatar.className = 'komplai-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = initials(organisation.name); name.className = 'komplai-account-name'; name.textContent = organisation.name; line.className = 'komplai-balance'; line.textContent = 'Udgiver til ' + organisation.publishing.address; $('#komplai-publish-tile').replaceChildren(avatar, name, line);
    go('connect');
  }
  $('#komplai-publish-org').onchange = () => { navigation(); showOrganisation(); };
  $('#komplai-publish-login').onclick = async () => {
    const generation = ++publish.generation; publish.loginPending = true; $('#komplai-publish-login').hidden = true; $('#komplai-publish-cancel').hidden = false; $('#komplai-publish-signin').dataset.stage = 'waiting'; $('#deployment-back').hidden = true; publishNotice('Fortsæt i browseren. Aura venter på dit login.', 'wait'); $('#komplai-publish-cancel').focus();
    try {
      const result = await api('komplaiLogin'); if (generation !== publish.generation || !dialog.open) return; publish.loginPending = false;
      publish.organisations = result.organisations.filter(item => item.publishing);
      if (!publish.organisations.length) { resetSignin(); renderStep(); publishNotice('Ingen af dine organisationer har komplai Run. Bed jeres administrator om adgang.', 'error'); return; }
      $('#komplai-publish-signin').dataset.stage = 'organisation'; publishNotice();
      $('#komplai-publish-org').replaceChildren(new Option('Vælg organisation', ''), ...publish.organisations.map(item => new Option(item.name, item.id)));
      if (publish.organisations.length === 1) { $('#komplai-publish-org').value = publish.organisations[0].id; showOrganisation(); } else go('organisation');
    } catch (error) { if (generation === publish.generation && dialog.open) { resetSignin(); renderStep(); publishNotice(error.message, 'error'); } }
  };
  function cancelLogin() { ++publish.generation; publish.loginPending = false; window.harness.komplaiCancel(undefined, dialogOwner); resetSignin(); }
  $('#komplai-publish-cancel').onclick = () => { cancelLogin(); renderStep(); publishNotice('Login blev afbrudt. Du kan prøve igen.'); };
  $('#komplai-publish-confirm').onclick = () => busy(async () => { const organisation = publish.organisations.find(item => item.id === $('#komplai-publish-org').value); if (!organisation) throw Error('Vælg organisation igen.'); await api('komplaiConnect', { organisationId: organisation.id, publishing: true }); trail = ['destination', 'providers']; if (!await loadPublish()) { go('login', { remember: false }); return; } window.dispatchEvent(new CustomEvent('harness:komplai-connected')); go('app', { remember: false }); });
  $('#komplai-publish-logout').onclick = () => busy(async () => {
    ++publish.generation; ++publish.addressCheck; invalidate();
    await api('komplaiCancel'); await api('komplaiPublishDisconnect');
    resetSignin(); publish.account = null; publish.organisations = []; publish.slugEdited = false;
    for (const id of ['#deploy-komplai-app', '#komplai-publish-org']) $(id).replaceChildren();
    for (const id of ['#deploy-komplai-search', '#deploy-komplai-name', '#deploy-komplai-slug', '#deploy-komplai-confirm']) $(id).value = '';
    $('#komplai-publish-tile').replaceChildren();
    trail = ['destination', 'providers']; go('login', { remember: false });
    publishNotice('Du er logget ud af komplai Run. Log ind med den konto, du vil bruge.', 'success');
    window.dispatchEvent(new CustomEvent('harness:komplai-connected'));
  }, 'Logger ud …');
  $('#deploy-komplai-create').onclick = () => { invalidate(); $('#deploy-komplai-app').value = ''; for (const radio of form.querySelectorAll('[name="komplai-visibility"]')) radio.checked = false; if (!$('#deploy-komplai-name').value) $('#deploy-komplai-name').value = context?.projectName || ''; if (!publish.slugEdited) $('#deploy-komplai-slug').value = suggest($('#deploy-komplai-name').value); addressPreview(); go('name'); };
  $('#deploy-komplai-choose').onclick = () => { $('#deploy-komplai-search').value = ''; fillApps(); go('existing'); };
  $('#deploy-komplai-search').oninput = fillApps;
  $('#deploy-komplai-app').onchange = () => { invalidate(); navigation(); if (chosenApp()) { for (const radio of form.querySelectorAll('[name="komplai-visibility"]')) radio.checked = false; go('files'); } };
  $('#deploy-komplai-access').onclick = () => busy(async () => { await api('deploymentOpen', { komplaiApp: chosenApp()?.id }); invalidate(); $('#deployment-feedback').textContent = 'Ret adgangen i komplai. Næste gennemgang henter appens aktuelle adgang.'; });
  $('#deploy-komplai-edit-address').onclick = () => { checkAddress(); go('address'); };
  $('#deploy-komplai-name').oninput = () => { if (!publish.slugEdited) $('#deploy-komplai-slug').value = suggest($('#deploy-komplai-name').value); addressPreview(); };
  $('#deploy-komplai-slug').oninput = () => { publish.slugEdited = true; $('#deploy-komplai-slug').value = $('#deploy-komplai-slug').value.toLowerCase(); addressPreview(); checkAddress(); };
  async function checkAddress() {
    const generation = ++publish.addressCheck, slug = $('#deploy-komplai-slug').value, help = $('#deploy-komplai-slug-help');
    if (!slug) { help.textContent = 'Lad feltet stå tomt, så får appen en tilfældig adresse.'; help.dataset.tone = ''; return; }
    help.textContent = 'Kontrollerer adressen …'; help.dataset.tone = ''; await new Promise(resolve => setTimeout(resolve, 250)); if (generation !== publish.addressCheck || !publish.overview) return;
    try { const r = await api('komplaiPublishAddress', { slug }); if (generation !== publish.addressCheck) return; help.textContent = r.available ? `Appen får adressen ${slug}.${publish.overview.address}` : r.message; help.dataset.tone = r.available ? 'ok' : 'error'; } catch (error) { if (generation === publish.addressCheck) { help.textContent = error.message; help.dataset.tone = 'error'; } }
  }
  // En offentlig app bekræftes med appens navn, som i Run.
  function publicConfirmation() {
    const name = $('#deploy-komplai-name').value.trim(), field = $('#deploy-komplai-confirm');
    $('#deploy-komplai-confirm-label').textContent = `Skriv »${name}« for at bekræfte`;
    field.setCustomValidity(field.value.trim() === name ? '' : `Skriv appens navn præcis: ${name}`);
  }
  for (const radio of form.querySelectorAll('[name="komplai-visibility"]')) { const proceed = () => { if (step === 'access' && radio.checked) { invalidate(); $('#deploy-komplai-confirm').value = ''; go(radio.value === 'public' ? 'confirmPublic' : 'files'); } }; radio.onclick = proceed; radio.onchange = proceed; }
  $('#deploy-komplai-confirm').oninput = () => { invalidate(); publicConfirmation(); };
  $('#deployment-file-options').onclick = () => go('options');
  function providerHelp() { showGuide('#hosting-guide-setup', $('#deploy-provider').value); go('providerGuide'); }
  $('#deployment-provider-help').onclick = providerHelp; $('#deployment-provider-settings').onclick = providerHelp;
  $('#deployment-change-files').onclick = () => { invalidate(); go(komplai() ? 'directory' : 'kind'); };
  // Den gamle vej er altid der: udgiv færdige filer fra en mappe i stedet for at bygge.
  $('#deploy-komplai-folder').onclick = () => { invalidate(); folderChosen = true; if (komplaiSource?.build) $('#deploy-directory').value = 'public'; go('directory'); };
  $('#deploy-directory').addEventListener('input', () => { folderChosen = true; });
  $('#deployment-change-destination').onclick = () => go('destinationOptions');
  $('#deployment-change-app').onclick = () => busy(async () => { invalidate(); $('#deploy-komplai-search').value = ''; if (await loadPublish()) go('app'); else go('login'); });
  $('#deployment-select-destination').onclick = () => { invalidate(); go('destination'); };
  const openAccount = () => busy(async () => { publish.account = await api('komplaiPublishState'); if (publish.account.connected) go('account'); else { resetSignin(); go('login'); } });
  $('#deployment-account').onclick = openAccount;
  $('#deployment-komplai-account').onclick = openAccount;
  function back() { invalidate(); const previous = trail.pop(); if (previous) go(previous, { remember: false }); }
  $('#deployment-back').onclick = back;
  form.addEventListener('input', event => { if (['hosting-guide-choice', 'komplai-publish-org', 'deploy-komplai-search'].includes(event.target.id)) return; invalidate(); modes(); });
  async function prepareReview() {
    invalidate();
    $('#deployment-progress-label').textContent = komplaiBuild() ? 'Bygger den gemte version …' : 'Forbereder udgivelsen …';
    if (komplai() && $('#deploy-komplai-app').value) { const selected = $('#deploy-komplai-app').value; publish.overview = await api('komplaiPublishOverview'); $('#deploy-komplai-search').value = ''; fillApps(); if (!publish.overview.apps.some(app => app.id === selected)) { go('existing'); throw Error('Appen findes ikke længere. Vælg en app igen.'); } $('#deploy-komplai-app').value = selected; }
    const r = await api('deploymentReview', input()); review = r.token; context = r.context || context;
    appCard('deployment-review-app', r);
    if (r.config.provider === 'komplai') rows('#deployment-summary', [['Gemt version', view.version(r)], ...(r.built ? [['Bygget', `På din computer fra den gemte version med ${r.built.script}. Filerne kommer fra mappen ${r.built.output}.`]] : []), ['Udgivelse', r.target.created ? 'Opretter en ny app' : 'Erstatter den udgivne version'], ['Hvem kan åbne den', r.config.visibility === 'private' ? 'Kun organisationen. Medlemmer logger ind med komplai.' : 'Alle med linket. Appen bliver offentlig. Undlad fortrolige oplysninger.'], ['Placering', r.target.region], ['Omkostninger', r.cost]]);
    else rows('#deployment-summary', [['Gemt version', view.version(r)], ['Destination', view.destination(r) + (r.config.provider === 'azure' ? ' · erstatter indholdet i testmiljøet' : '')], ...(r.config.mode === 'source' ? [['Build', 'Udbyderen bygger kildekoden og kan køre dens installations- og buildscripts med testmiljøets værdier.']] : []), ['Adgang', `${r.target.access || 'Udbyderen oplyser ikke adgangsreglerne.'} Testpersonens adgang er ikke afprøvet.`], ...(setup.pages() ? [['Udgivelse', 'Starter én GitHub Actions-kørsel og erstatter den offentlige hjemmeside.']] : []), ['Omkostninger', r.cost]]);
    rows('#deployment-details', [['Versionens ID', r.head], ['Destinationens ID', r.target.id || 'Oprettes ved udgivelse'], ['Konto / abonnement', r.config.provider === 'komplai' ? r.target.owner : r.config.scope || r.config.subscription || 'Fra dit eksisterende login'], ['Indhold', `${r.files.length} filer · ${r.bytes} bytes · ${r.hash}`], ['Placering', r.target.region], ['Miljøvariabler', r.target.environmentNote || r.target.environmentKeys?.join(', ') || 'Ingen navne rapporteret. Kontrollér opsætningen hos udbyderen.'], ['Build', r.build], ['Materiale', r.material], ['Udeladte filer', r.excludedFiles?.join(', ') || 'Ingen'], ['Projekt', view.scope(context)]]);
    $('#deployment-files').replaceChildren(...r.files.map(file => { const li = document.createElement('li'); li.textContent = file; return li; }));
    showGuide('#hosting-guide-current', r.config.provider); $('#deployment-technical').open = false; $('#deployment-send').disabled = false; $('#deployment-send').textContent = setup.pages() ? 'Udgiv med GitHub Actions' : ['komplai', 'promte'].includes(r.config.provider) ? 'Udgiv' : 'Udgiv til test'; go('review');
    $('#deployment-feedback').textContent = 'Ingen filer er uploadet endnu.';
  }
  form.onsubmit = event => {
    event.preventDefault();
    if (!(fields[step] || []).every(id => $('#' + id).reportValidity())) return;
    if (step === 'files') return busy(prepareReview);
    if (step === 'existing' && chosenApp()) { go('files'); return; }
    if (step === 'organisation' && $('#komplai-publish-org').value) { showOrganisation(); return; }
    if (step === 'address') { const previous = trail.pop(); go(previous || 'name', { remember: false }); return; }
    if (step === 'directory') { if (setup.pages()) setup.configurationStep(); else go($('#deploy-mode').value === 'functions' ? 'functions' : 'files'); return; }
    if (onward[step]) go(onward[step]);
  };
  $('#deployment-edit').onclick = () => { invalidate(); trail = ['destination', 'providers']; go('files', { remember: false }); };
  $('#deployment-settings').onclick = () => busy(async () => { await api('deploymentOpen', 'settings'); invalidate(); go('files', { remember: false }); $('#deployment-feedback').textContent = 'Indstillingerne er åbnet. Gennemgå udgivelsen igen, når du er klar.'; });
  function receipt(r) {
    last = r; if (!r) return;
    for (const key of ['provider', 'project', 'scope', 'subscription', 'group', 'mode', 'directory', 'frontend', 'api']) if (r.config[key] !== undefined) $('#deploy-' + key).value = r.config[key] || '';
    setup.restore(r.config); modes();
    const isKomplai = r.config.provider === 'komplai', isPromte = r.config.provider === 'promte';
    appCard('deployment-result-app', r);
    const summary = view.receiptSummary(r); rows('#deployment-checks', view.checks(r));
    for (const [key, box, title, note] of [['publication', '#deployment-publication', '#deployment-state', '#deployment-state-note'], ['access', '#deployment-access', '#deployment-result-access', '#deployment-access-note']]) { $(box).dataset.tone = summary[key].tone; $(title).textContent = summary[key].title; $(note).textContent = summary[key].detail; }
    $('#deployment-verification').dataset.tone = summary.verification.tone; $('#deployment-verification').hidden = summary.verification.hidden === true;
    $('#deployment-verification h4').textContent = summary.verification.title; $('#deployment-verification p').textContent = summary.verification.detail;
    $('#deployment-verification .deployment-status-symbol').textContent = summary.verification.tone === 'positive' ? '✓' : summary.verification.tone === 'warning' ? '!' : 'i';
    rows('#deployment-receipt', [['Gemt version', view.version(r)], ['Upload påbegyndt', view.time(r.startedAt)], ['Versionens ID', r.head], ['Indholdets fingeraftryk', r.hash], ['Senest registrerede udbyderstatuskode', r.state], ['Adresse', r.url], ['Adgang rapporteret ved upload', r.target.access], ['Seneste kontrol', r.checkedAt ? view.time(r.checkedAt) : 'Ingen kontrol registreret']]);
    const primary = $('#deployment-main-actions'), secondary = $('#deployment-extra-actions');
    for (const id of ['check', 'open', 'portal', 'new']) { const button = $('#deployment-' + id); button.classList.remove('primary'); secondary.append(button); }
    $('#deployment-open').textContent = ['komplai', 'promte', 'github-pages', 'cloudflare'].includes(r.config.provider) ? 'Åbn appen' : 'Åbn testlink'; $('#deployment-portal').textContent = isKomplai ? 'Åbn i komplai' : isPromte ? 'Åbn appen i Promte' : 'Åbn hos udbyderen';
    $('#deployment-check').textContent = isPromte ? 'Kontrollér status' : 'Kontrollér status og startside';
    $('#deployment-check').hidden = !r.id; $('#deployment-open').hidden = !r.url; $('#deployment-portal').hidden = !r.target.portal;
    const actions = view.mainActions(r); for (const id of actions) primary.append($('#deployment-' + id)); $('#deployment-' + actions[0]).classList.add('primary');
    $('#deployment-receipt-details').open = false; go('result', { remember: false });
  }
  async function followLastApp() {
    if (last?.config?.provider !== 'komplai') return false;
    $('#deploy-provider').value = 'komplai'; $('#deploy-komplai-search').value = ''; modes(); if (!await loadPublish()) { go('login'); return true; }
    const appId = last.appId || last.config.appId;
    if (publish.overview.apps.some(app => app.id === appId)) { $('#deploy-komplai-app').value = appId; trail = ['destination', 'providers', 'app']; go('files', { remember: false }); } else go('app');
    return true;
  }
  $('#deployment-new').onclick = () => busy(async () => { invalidate(); trail = []; if (!await followLastApp()) { if (setup.pages()) setup.configurationStep(); else go('files', { remember: false }); } });
  $('#deployment-another').onclick = () => {
    if (busyNow) return;
    invalidate(); trail = ['destination']; $('#deploy-provider').value = ''; setup.reset();
    go('providers', { remember: false });
  };
  $('#deployment-copy-review').onclick = () => {
    if (busyNow) return;
    const owner = dialogOwner; dialog.close();
    window.reviewRestoration({ merge: true, chat: owner.chat }, { owner, title: 'Flet arbejdskopiens ændringer ind?', confirm: 'Flet ind i projektet', label: 'Flettet ind fra arbejdskopi' });
  };
  $('#deployment-send').onclick = () => busy(async () => {
    const token = review, generation = session; invalidate(); if (!token) return;
    $('#deployment-feedback').textContent = 'Lukning af vinduet annullerer ikke udgivelsen.';
    try { receipt(await api('deploymentSend', token)); $('#deployment-feedback').textContent = 'Udgivelsens status er gemt.'; }
    finally { if (generation === session) { const state = await api('deploymentState'); if (state.last) receipt(state.last); await setup.refresh(); } }
  }, 'Udgiver …');
  $('#deployment-check').onclick = () => busy(async () => { receipt(await api('deploymentCheck')); await setup.refresh(); });
  $('#deployment-open').onclick = () => busy(async () => { await api('deploymentOpen', 'site'); $('#deployment-feedback').textContent = 'Appen er åbnet i din browser.'; });
  $('#deployment-portal').onclick = () => busy(async () => { await api('deploymentOpen', 'portal'); $('#deployment-feedback').textContent = 'Oversigten er åbnet. Kontrollér udgivelsen dér, før du uploader igen.'; });
  function openDialog(wantStatus = false, provider = null) {
    ++session; ++sourceToken; ++publish.generation; ++publish.addressCheck; busyNow = false;
    dialogOwner = typeof selectedOwner === 'function' ? selectedOwner() : null;
    context = null; $('#deployment-copy').hidden = true;
    dialog.showModal(); invalidate(); trail = []; go('destination', { remember: false }); $('#deployment-technical').open = false; $('#deployment-receipt-details').open = false;
    busy(async () => { const state = await api('deploymentState'); context = state.context; await loadGuides(); form.reset(); $('#deploy-provider').value = ''; publish.slugEdited = false; publish.overview = null; komplaiSource = null; folderChosen = false;
      const savedConfig = state.config || state.last?.config;
      setup.reset(); setup.restore(savedConfig);
      if (savedConfig) { for (const key of ['provider', 'project', 'scope', 'subscription', 'group', 'mode', 'directory', 'frontend', 'api']) if (savedConfig[key] !== undefined) $('#deploy-' + key).value = savedConfig[key] || ''; }
      modes(); last = null;
      // Uden udgivelse viser Udgiv ét kort, tydeligt næste trin. Opsætningen kan ellers klares, mens appen bygges.
      if (!window.sharingOn?.()) { pendingProvider = provider; go('sharingOff', { remember: false }); return; }
      go('destination', { remember: false }); receipt(state.last);
      const generation = session; await setup.refresh(wantStatus && state.last?.config?.provider !== 'komplai'); assertCurrent(generation); setup.opened(wantStatus);
      if (provider) await chooseProvider(provider);
    });
  }
  // Forhåndsvisningen af en komplai Run-app åbner Udgiv direkte ved komplai, når login mangler.
  window.openKomplaiLogin = () => openDialog(false, 'komplai');
  let pendingProvider = null;
  // Slå udgivelse til for alle projekter; har projektet sin egen undtagelse, slås den til for projektet.
  // Udgiv åbnes først igen, når indstillingen er gemt: busy() kører ét forløb ad gangen.
  $('#deployment-enable-sharing').onclick = async () => {
    const generation = session;
    await busy(async () => {
      await api('featuresSave', { scope: 'alle', values: { deling: true } }); await window.refreshFeatures?.();
      if (!window.sharingOn?.()) { await api('featuresSave', { scope: 'projekt', values: { deling: true } }); await window.refreshFeatures?.(); }
    });
    if (generation !== session || !window.sharingOn?.()) return;
    const provider = pendingProvider; pendingProvider = null; dialog.close(); openDialog(false, provider);
  };
  const setup = window.DeploymentSetupUI.mount({ api, go, back, busy, rows, heading, invalidate, chooseProvider, prepareReview, input, receipt, openDialog });
  $('#deploy-button').onclick = () => openDialog();
  dialog.addEventListener('close', () => { ++session; ++sourceToken; busyNow = false; progress(false); invalidate(); ++publish.addressCheck; if (publish.loginPending || ['organisation', 'connect'].includes(step)) cancelLogin(); $('#deploy-button').focus(); });
})();
