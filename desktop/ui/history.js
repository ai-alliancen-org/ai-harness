// Visuel historik under Ændringer › Versioner: versioner med navn og billeder af forhåndsvisningen før og efter, én
// version ad gangen med dens filer, og én gennemgang før enhver gendannelse eller fortrydelse. Gennemgangen viser
// forhåndsvisningen nu og det, den går tilbage til, hvad der sker med hver fil, og hvad der ellers berøres.
(() => {
  let status = null, showAll = false, version = null, review = null, label = '', gitReview = null, reviewRequest = 0;
  const visible = 8;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Billederne hentes, når de skal vises, og huskes, mens appen er åben.
  const cache = new Map();
  async function image(id) {
    if (!id) return null;
    if (!cache.has(id)) { cache.set(id, call('historyImage', id).catch(() => null)); if (cache.size > 60) cache.delete(cache.keys().next().value); }
    return cache.get(id);
  }
  const pageName = view => !view?.page || /^(index\.html?)?(\?.*)?$/i.test(view.page) ? 'forsiden' : `siden ${view.page.replace(/\.html?$/i, '')}`;
  const viewText = view => view ? `${pageName(view)} ved ${view.width} × ${view.height}` : '';
  // Før og efter side om side. Mangler før-billedet, vises kun efter-billedet, og teksten siger det.
  async function fillCompare(box, pair, labels = { before: 'Før', after: 'Efter' }) {
    const [beforeFigure, afterFigure] = box.querySelectorAll('figure');
    if (!pair || (!pair.before && !pair.after)) { box.hidden = true; return false; }
    const set = async (figure, entry, text) => {
      figure.hidden = !entry; if (!entry) return;
      const img = figure.querySelector('img'), url = await image(entry.id);
      img.src = url || ''; img.alt = `${text}: ${viewText(pair.view)}, ${versionTime(entry.at)}`; figure.querySelector('figcaption').textContent = `${text} · ${versionTime(entry.at)}`;
    };
    await Promise.all([set(beforeFigure, pair.before, labels.before), set(afterFigure, pair.after, labels.after)]);
    box.hidden = false; box.classList.toggle('single', !pair.before || !pair.after);
    return true;
  }

  // Den lille status gælder projektets gemte versioner, også når samtalen arbejder i en kopi.
  let statusRequest = 0, statusTimer;
  async function refreshStatus() {
    const request = ++statusRequest, root = current?.root;
    $('#version-status').hidden = !root || !featureOn('versioner');
    if (!root) return;
    try {
      const data = await call('gitStatus'); if (request !== statusRequest || root !== current?.root) return;
      $('#version-status').textContent = !data.initialized ? 'Versioner er slået fra' : data.block ? 'Se versionsstatus' : data.changes ? count(data.changes, 'ugemt ændring', 'ugemte ændringer') : 'Alt er gemt';
      $('#version-status').title = 'Se projektets versioner';
      const busyChanged = status && Boolean(status.busy) !== Boolean(data.busy);
      if (status) status = data;
      busyControls(data);
      // En åben version følger historikken, fx når en opgave gemmer en ny version, eller filerne ændres.
      if (status && version && !$('#version-detail').hidden) versionActions();
      if (busyChanged && !$('#versions-view').hidden) await load();
    } catch { if (request === statusRequest) $('#version-status').textContent = 'Kontrollér versioner'; }
  }
  $('#version-status').onclick = () => $('#git-button').click();
  window.harness.onEvent(event => {
    if (!['files.written', 'run.status', 'git.checkpoint', 'changes.updated'].includes(event.type)) return;
    clearTimeout(statusTimer); statusTimer = setTimeout(refreshStatus, 250);
  });
  function busyControls(data) {
    const busy = Boolean(data?.busy);
    for (const selector of ['#git-init', '#git-auto', '#git-save-all', '#version-rename', '#version-name', '#version-rename-form button[type="submit"]', '#git-identity button']) $(selector).disabled = busy;
    $('#git-save').disabled = busy || !$('#git-files input:checked') || Boolean(data?.block);
    $('#version-restore').disabled = $('#version-revert').disabled = busy || Boolean(data?.block);
    $('#restore-undo').disabled = busy || Boolean(data?.block) && data.initialized;
  }
  // ---------- Versioner ----------
  async function loadGitReview() {
    gitReview = null; $('#git-save').disabled = true; $('#git-files').replaceChildren();
    gitReview = await call('gitReview');
    for (const file of gitReview.files) {
      const row = node('section'); const box = node('label', undefined, 'check-label'); const input = node('input');
      input.type = 'checkbox'; input.value = file.file; input.disabled = Boolean(file.blocked);
      const change = file.status === '??' ? 'Ny' : /D/.test(file.status) ? 'Slettet' : 'Ændret';
      box.append(input, document.createTextNode(`${change} · ${file.file}`)); row.append(box);
      if (file.blocked) row.append(node('p', file.blocked, 'hint'));
      else if (file.binary) row.append(node('p', 'Binær billed- eller skrifttypefil. Indholdet vises ikke her; kontrollér filen før tilvalg.', 'hint'));
      else if (file.beforeHidden) { const details = node('details'); details.append(node('summary', 'Se indhold efter'), node('p', file.beforeHidden, 'hint'), node('h4', 'Efter'), node('pre', file.text ?? '(slettet fil)')); row.append(details); }
      else { const details = node('details'); details.append(node('summary', 'Se indhold før og efter'), node('h4', 'Før'), node('pre', file.before ?? '(ny fil)'), node('h4', 'Efter'), node('pre', file.text ?? '(slettet fil)')); row.append(details); }
      input.onchange = () => { $('#git-save').disabled = !$('#git-files input:checked'); }; $('#git-files').append(row);
    }
    if (!gitReview.files.length) $('#git-files').append(node('p', 'Ingen ændringer at gemme.'));
  }
  async function load() {
    const root = current?.root; status = null;
    $('#git-save-all').disabled = true;
    $('#git-refresh').disabled = true; $('#git-identity').hidden = true; $('#git-quick').hidden = true; $('#git-summary').textContent = 'Henter versioner …';
    $('#git-auto').disabled = true; $('#restore-undo').hidden = true;
    try {
      gitReview = null; $('#git-form').hidden = true; $('#git-init').hidden = true; $('#git-settings').hidden = true;
      const result = await call('gitStatus'); if (current?.root !== root) return;
      status = result;
      const identityMissing = result.initialized && !result.wrongRoot && !(result.identity?.name && result.identity?.email);
      $('#git-summary').textContent = !result.initialized ? 'Versioner er ikke slået til for denne mappe.' : identityMissing ? 'Skriv, hvem der står bag versionerne, før den første gemmes.' : result.block || (result.changes ? `${count(result.changes, 'ændring er', 'ændringer er')} ikke gemt endnu.` : 'Alt er gemt.');
      $('#git-details').textContent = result.initialized ? `Branch: ${result.branch || 'ingen'} · ${result.identity?.name || 'uden navn'} <${result.identity?.email || 'uden e-mail'}>` : 'Mappen har ingen Git-historik.';
      $('#git-init').hidden = result.initialized; $('#git-identity').hidden = !identityMissing;
      $('#git-name').value = result.identity?.name || ''; $('#git-email').value = result.identity?.email || '';
      $('#git-name').readOnly = Boolean(result.identity?.name); $('#git-email').readOnly = Boolean(result.identity?.email);
      $('#git-settings').hidden = !result.initialized || result.wrongRoot; $('#git-auto').checked = result.autoCheckpoint;
      const canSave = result.initialized && !result.block && !result.busy;
      if (result.busy) $('#git-summary').textContent += result.autoCheckpoint ? ' Aura gemmer en version efter opgaven.' : ' Du kan gemme, når opgaven er afsluttet.';
      $('#git-init').disabled = result.busy;
      $('#git-identity').hidden ||= result.busy;
      $('#git-quick').hidden = !canSave || !result.changes;
      if (canSave) { $('#git-form').hidden = false; if ($('#git-advanced').open) await loadGitReview(); }
      renderList();
      // Når gendannelser gemmes som versioner, klares fortrydelse med versionerne. Kopien vises kun efter en afbrudt gendannelse eller uden automatiske versioner.
      const interrupted = ['failed', 'prepared', 'applying'].includes(result.restoration?.state);
      // Kopien før sidste gendannelse kræver ikke Git; kun et Git-problem i et projekt med versioner stopper den.
      $('#restore-undo').hidden = !result.restoration || (result.autoCheckpoint && !interrupted); $('#restore-undo').disabled = result.busy || Boolean(result.block) && result.initialized;
      if (interrupted) $('#git-feedback').textContent = 'Sidste gendannelse blev afbrudt. Vælg Fortryd sidste gendannelse for at genskabe filerne fra før gendannelsen.';
    } catch (error) { $('#git-summary').textContent = 'Versionerne kunne ikke hentes. Prøv igen.'; throw error; }
    finally { $('#git-auto').disabled = !status || status.busy; $('#git-refresh').disabled = false; $('#git-save-all').disabled = !status || status.busy; }
  }
  function renderList() {
    const items = status?.history || [], shown = showAll ? items : items.slice(0, visible);
    $('#git-history').replaceChildren(...shown.map((item, index) => {
      const row = node('li'), button = node('button', undefined, 'version-row'); button.type = 'button'; button.dataset.commit = item.commit;
      const thumb = node('span', undefined, 'version-thumb');
      if (item.image) { const img = node('img'); img.alt = ''; image(item.image).then(url => { if (url) img.src = url; }); thumb.append(img); } else thumb.classList.add('empty');
      const current = index === 0 && !status.changes, text = node('span', undefined, 'version-text');
      text.append(node('strong', item.name), node('span', `${item.kindLabel} · ${versionTime(item.at)}${current ? ' · nuværende' : ''}`, 'hint'));
      button.append(thumb, text); button.title = item.message;
      button.setAttribute('aria-label', `${item.name}. ${item.kindLabel}, ${versionTime(item.at)}${current ? ', nuværende version' : ''}. Se versionen`);
      button.onclick = () => action(() => open(item.commit));
      row.append(button); return row;
    }));
    if (!items.length) $('#git-history').append(node('li', 'Ingen gemte versioner endnu.', 'hint'));
    $('#git-more').hidden = showAll || items.length <= visible;
  }
  // Én version: navn, billeder før og efter, filerne og de to veje tilbage.
  async function open(commit) {
    const root = current?.root, data = await call('historyVersion', commit);
    if (current?.root !== root) return;
    version = data;
    $('#version-title').textContent = data.name; $('#version-rename-form').hidden = true; $('#version-rename').hidden = false;
    const files = data.files.length;
    $('#version-meta').textContent = `${data.kindLabel} · ${versionTime(data.at)} · ${count(files, 'fil', 'filer')}${data.renamed ? ` · oprindeligt »${shortLabel(data.message, 60)}«` : ''}`;
    const has = await fillCompare($('#version-compare'), data.images);
    const note = $('#version-images'); note.replaceChildren();
    if (has) { note.append(`Billeder af ${viewText(data.images.view)}.${data.images.before ? '' : ' Der er intet billede fra før.'}`); note.append(info('billederne', 'Aura tager selv billederne af forhåndsvisningen i baggrunden, når en version gemmes, og når du går tilbage. De gemmes kun i Aura på denne computer, ikke i projektet, og sendes ikke til AI’en.')); }
    else note.textContent = 'Der er ingen billeder af denne version. Aura tager dem, når en version gemmes, mens forhåndsvisningen kører.';
    versionActions();
    window.workspace.showVersion(data);
    $('#version-title').focus();
  }
  // »Gå tilbage hertil« vises ikke for den version, filerne allerede svarer til: den nyeste uden ugemte ændringer.
  function versionActions() {
    if (!version) return;
    const latest = status?.history?.[0]?.commit === version.commit && !status.changes;
    $('#version-restore').hidden = latest; $('#version-revert').hidden = !version.parent;
    busyControls(status);
    $('#version-restore').classList.toggle('primary', !latest);
  }
  // Efter en gendannelse, en fortrydelse eller en indfletning vises listen og en åben version, som projektet er nu.
  async function refreshShownVersions() {
    const detail = Boolean(version) && !$('#version-detail').hidden;
    if ($('#versions-view').hidden && !detail) return;
    try { await load(); } catch { return; }
    if (detail) versionActions();
  }
  $('#version-back').onclick = () => { version = null; window.workspace.showVersions(); $('#versions-heading').focus(); action(load); };
  $('#version-restore').onclick = () => { if (version) action(() => reviewRestoration({ commit: version.commit }, { label: `Gendannet til: ${version.name}` })); };
  $('#version-revert').onclick = () => { if (version) action(() => reviewRestoration({ revert: version.commit }, { title: 'Fortryd kun denne version', confirm: 'Fortryd versionen', label: `Fortrudt: ${version.name}` })); };
  $('#version-rename').onclick = () => { $('#version-rename').hidden = true; $('#version-rename-form').hidden = false; $('#version-name').value = version?.name || ''; $('#version-name').focus(); $('#version-name').select(); };
  $('#version-rename-cancel').onclick = () => { $('#version-rename-form').hidden = true; $('#version-rename').hidden = false; $('#version-rename').focus(); };
  $('#version-rename-form').onsubmit = event => { event.preventDefault(); action(async () => {
    if (!version) return;
    const { name } = await call('historyRename', { commit: version.commit, name: $('#version-name').value });
    await open(version.commit);
    $('#git-feedback').textContent = name ? `Versionen hedder nu »${name}«. Navnet gemmes kun i Aura på denne computer.` : 'Versionen har fået sit oprindelige navn igen.';
  }); };
  $('#git-more').onclick = () => { showAll = true; renderList(); $('#git-history li:nth-child(9) button')?.focus(); };
  // Versioner i projektmenuen åbner historikken under Ændringer.
  $('#git-button').onclick = () => { window.workspace.showVersions(); window.workspace.show('changes'); $('#versions-heading').focus(); action(load); };
  $('#git-init').onclick = () => action(async () => { $('#git-init').disabled = true; try { await call('gitInit'); await load(); } finally { $('#git-init').disabled = false; } });
  $('#git-refresh').onclick = () => action(load);
  $('#git-advanced').addEventListener('toggle', () => { if ($('#git-advanced').open && !$('#git-form').hidden) action(loadGitReview); });
  $('#git-auto').onchange = () => action(async () => { const selected = $('#git-auto').checked; try { await call('gitAutomatic', selected); $('#git-feedback').textContent = selected ? 'Automatiske versioner er slået til: der gemmes en version efter hver AI-opgave.' : 'Automatiske versioner er slået fra.'; } catch (error) { $('#git-auto').checked = !selected; throw error; } });
  $('#git-quick').onsubmit = event => { event.preventDefault(); action(async () => {
    $('#git-save-all').disabled = true;
    try {
      const result = await call('gitSave', { note: $('#git-note').value, view: window.previewViewSize?.() || null }); $('#git-note').value = '';
      // De filer, der ikke kom med, nævnes altid, også når intet blev gemt. Årsagen står ved hver fil under Avanceret.
      const kept = result.kept.length ? ` Disse filer blev ikke gemt, fordi de kan indeholde hemmeligheder eller er for store: ${result.kept.join(', ')}. Årsagen står ved filen under Avanceret.` : '';
      $('#git-feedback').textContent = result.saved ? `Versionen er gemt lokalt på denne computer.${kept}` : kept ? `Ingen version blev gemt.${kept}` : 'Der var ingen ændringer at gemme.';
    } finally { $('#git-save-all').disabled = false; await load(); }
  }); };
  $('#git-form').onsubmit = event => { event.preventDefault(); action(async () => {
    if (!gitReview) return;
    const input = { token: gitReview.token, message: $('#git-message').value, files: [...document.querySelectorAll('#git-files input:checked')].map(el => el.value) };
    gitReview = null; $('#git-save').disabled = true; $('#git-auto').disabled = true;
    try { await call('gitCommit', input); $('#git-feedback').textContent = 'Versionen er gemt lokalt på denne computer.'; $('#git-message').value = ''; }
    finally { await load(); }
  }); };
  $('#git-identity').onsubmit = event => { event.preventDefault(); action(async () => { await call('gitIdentity', { name: $('#git-name').value, email: $('#git-email').value }); await load(); }); };

  // ---------- Gennemgang før gendannelse og fortryd ----------
  const outcomeText = file => file.outcome === 'conflict' ? 'I har begge rettet de samme linjer' : file.outcome === 'kept' ? 'Sættes tilbage; dine senere rettelser bevares' : { Ændres: 'Sættes tilbage', Slettes: 'Slettes', Genskabes: 'Genskabes' }[file.action] || file.action;
  async function reviewRestoration(input, options = {}) {
    const request = ++reviewRequest, owner = options.owner || selectedOwner();
    review = null; label = options.label || '';
    $('#restore-confirm').disabled = true; $('#restore-feedback').textContent = '';
    $('#restore-dialog').querySelector('.dialog-notice')?.remove();
    $('#restore-dialog').querySelector('.restore-retry')?.remove();
    for (const id of ['#restore-outcomes', '#restore-files', '#restore-data', '#restore-conflict-lines']) $(id).replaceChildren();
    $('#restore-conflicts').hidden = true; $('#restore-compare').hidden = true; $('#restore-unsaved').hidden = true; $('#restore-images-note').hidden = true;
    for (const fold of $('#restore-dialog').querySelectorAll('details')) fold.open = false;
    $('#restore-summary').textContent = 'Henter filerne og et billede af forhåndsvisningen …';
    $('#restore-title').textContent = options.title || 'Gå tilbage til en tidligere version'; $('#restore-confirm').textContent = options.confirm || 'Gå tilbage til denne version';
    const choice = document.querySelector('input[name="restore-choice"][value="ours"]'); if (choice) choice.checked = true;
    $('#restore-dialog').setAttribute('aria-busy', 'true');
    if (!$('#restore-dialog').open) $('#restore-dialog').showModal();
    try {
      const result = await call(input.merge ? 'chatMergeReview' : 'restoreReview', { ...input, view: window.previewViewSize?.() || null }, owner);
      if (request !== reviewRequest || !$('#restore-dialog').open) return;
      review = { ...result, owner, sourceView: viewFor(owner?.chat), taskUndo: options.taskUndo === true, taskID: options.taskID };
    } catch (error) {
      if (request !== reviewRequest || !$('#restore-dialog').open) return;
      $('#restore-summary').textContent = 'Gennemgangen kunne ikke hentes. Ingen filer er ændret.';
      $('#restore-feedback').textContent = error.message;
      const retry = node('button', 'Prøv igen', 'restore-retry'); retry.type = 'button';
      retry.onclick = () => action(() => reviewRestoration(input, options));
      $('#restore-feedback').before(retry);
      return;
    } finally {
      if (request === reviewRequest) $('#restore-dialog').setAttribute('aria-busy', 'false');
    }
    review.mergeChat = input.merge ? input.chat : null;
    document.querySelector('input[name="restore-choice"][value="theirs"]').parentElement.lastChild.textContent = input.merge ? ' Brug linjerne fra kopien' : ' Brug linjerne fra før';
    if (review.undo) { $('#restore-title').textContent = options.title || (review.undoMerge ? 'Fortryd sidste indfletning' : 'Fortryd sidste gendannelse'); $('#restore-confirm').textContent = options.confirm || (review.undoMerge ? 'Fortryd indfletningen' : 'Fortryd gendannelsen'); label = review.undoMerge ? 'Fortrudt indfletning' : 'Fortrudt gendannelse'; }
    const files = review.files, kept = files.filter(f => f.outcome === 'kept').length, conflicts = files.filter(f => f.outcome === 'conflict');
    const changing = files.length - conflicts.length;
    $('#restore-summary').textContent = !files.length ? 'Filerne svarer allerede til det, du vil tilbage til.'
      : `${changing ? `${count(changing, 'fil sættes', 'filer sættes')} tilbage.` : ''}${kept ? ` Dine senere rettelser i ${count(kept, 'fil', 'filer')} bevares.` : ''}${conflicts.length ? ` I ${count(conflicts.length, 'fil', 'filer')} har I begge rettet de samme linjer; du vælger nedenfor.` : ''}`.trim();
    // En binær fil eller en fil i et ældre tekstformat, som opgaven ændrede, sættes ikke tilbage. Gennemgangen siger det (spor P).
    if (review.kept?.length) { const names = review.kept.slice(0, 3).join(', ') + (review.kept.length > 3 ? ` og ${review.kept.length - 3} flere` : ''), one = review.kept.length === 1; $('#restore-summary').textContent = `${$('#restore-summary').textContent} ${names} sættes ikke tilbage, fordi ${one ? 'filen er binær' : 'filerne er binære'} eller gemt i et ældre tekstformat (ikke UTF-8). Brug Versioner, hvis ${one ? 'den' : 'de'} skal tilbage.`.trim(); }
    if (review.kind === 'merge') $('#restore-summary').textContent = files.length ? `${count(files.length, 'fil', 'filer')} fra kopien gennemgås. ${kept ? 'Projektets øvrige rettelser bevares. ' : ''}${conflicts.length ? `${count(conflicts.length, 'fil har', 'filer har')} konflikter; dine linjer er anbefalet.` : 'Ændringerne kan flettes ind.'}` : 'Kopien har ingen ændringer at flette ind. Du kan afslutte kopien og fortsætte i projektet.';
    // Billederne: forhåndsvisningen nu og det, den går tilbage til, hvis Aura har et billede af det.
    const imgs = review.images || {};
    if (imgs.now || imgs.target) {
      const [nowFigure, targetFigure] = $('#restore-compare').querySelectorAll('figure');
      nowFigure.hidden = !imgs.now; targetFigure.hidden = !imgs.target;
      $('#restore-now').src = imgs.now || ''; $('#restore-now').alt = 'Forhåndsvisningen nu';
      $('#restore-target').src = imgs.target || ''; $('#restore-target').alt = `Forhåndsvisningen: ${imgs.targetLabel || 'versionen'}`;
      $('#restore-target-label').textContent = imgs.targetLabel || 'Versionen';
      $('#restore-compare').classList.toggle('single', !imgs.now || !imgs.target); $('#restore-compare').hidden = false;
    }
    // Et billede uden sit modstykke siges højt, så det ene billede ikke ligner en sammenligning.
    const imageNote = imgs.now && !imgs.target ? (review.kind === 'merge' ? 'Aura har intet billede af samtalens kopi.' : `Aura har intet billede af, hvordan det så ud ${review.kind === 'restore' ? 'i versionen' : 'før'}.`)
      : imgs.target && !imgs.now ? `Aura har intet billede af ${review.kind === 'merge' ? 'projektets' : 'den aktuelle'} forhåndsvisning nu.` : '';
    $('#restore-images-note').textContent = imageNote;
    $('#restore-images-note').hidden = !imageNote;
    for (const file of files) { const item = node('li'); item.append(node('code', file.file), ` · ${review.kind === 'merge' ? (file.outcome === 'conflict' ? 'Du vælger linjerne' : file.outcome === 'kept' ? 'Flettes ind; projektets øvrige linjer bevares' : file.action) : outcomeText(file)}`); $('#restore-outcomes').append(item); }
    if (conflicts.length) {
      $('#restore-conflicts').hidden = false;
      for (const file of conflicts) {
        const box = node('section', undefined, 'conflict-file'); box.append(node('h4', file.file));
        if (file.conflict.whole) box.append(node('p', 'Hele filen er ændret af jer begge, eller den er slettet eller binær.', 'hint'), node('h5', 'Din version'), node('pre', file.conflict.ours ?? '(filen findes ikke)'), node('h5', review.kind === 'merge' ? 'Samtalens kopi' : 'Før'), node('pre', file.conflict.theirs ?? '(filen fandtes ikke)'));
        else for (const part of file.conflict.parts) box.append(node('h5', `Omkring linje ${part.line} · dine linjer`), node('pre', part.ours || '(ingen linjer)'), node('h5', review.kind === 'merge' ? 'Samtalens kopi' : 'Før'), node('pre', part.theirs || '(ingen linjer)'));
        $('#restore-conflict-lines').append(box);
      }
    }
    if (review.unsaved?.length) {
      const names = review.unsaved.slice(0, 3).join(', ') + (review.unsaved.length > 3 ? ` og ${review.unsaved.length - 3} flere` : '');
      $('#restore-unsaved').textContent = review.saveFirst ? `Dine ugemte ændringer i ${names} gemmes først som versionen »Dine ændringer før ${review.kind === 'merge' ? 'indfletningen' : review.kind === 'restore' ? 'gendannelsen' : 'fortrydelsen'}«, så du kan hente dem igen.` : `Dine ugemte ændringer i ${names} gemmes i en kopi, så du kan fortryde under Versioner.`;
      $('#restore-unsaved').hidden = false;
    }
    // Hvad der ellers berøres, i almindeligt dansk. Filernes indhold står nederst.
    const data = [
      'Aura gemmer først en kopi af filerne, som de er nu.',
      review.untracked ? `${count(review.untracked, 'fil', 'filer')} uden for versionerne bevares.` : '',
      'Nøgler, .env-filer, private referencer og installerede pakker røres ikke.',
      review.kind === 'merge' ? 'Samtalen, briefen og projektets historik bevares. Kopien slettes efter indfletning; nye opgaver arbejder i projektet.' : 'Samtalen og briefen bevares. Planen skal laves igen, fordi den beskriver en anden version.',
      review.kind === 'merge' ? 'Kopiens forhåndsvisning afsluttes. En kørende forhåndsvisning af projektet bevares.' : review.framework ? 'Forhåndsvisningens server stoppes. Start den igen bagefter.' : 'Forhåndsvisningen genindlæses.',
      review.saveAfter ? 'Resultatet gemmes som en ny version. Historikken bevares, og du kan gå frem igen.' : review.kind === 'merge' ? 'Resultatet gemmes ikke som en version. Du kan fortryde indfletningen på resultatkortet.' : review.git ? 'Resultatet gemmes ikke som en version. Du kan fortryde det med Fortryd sidste gendannelse.' : 'Projektet har ikke versioner. Du kan fortryde med Fortryd sidste gendannelse under Ændringer › Versioner.'
    ].filter(Boolean);
    $('#restore-data').replaceChildren(...data.map(text => node('li', text)));
    for (const file of files.filter(f => f.outcome !== 'conflict')) {
      const row = node('details'); row.append(node('summary', `${file.action}: ${file.file}`));
      if (file.binary) row.append(node('p', `Binær fil. Kontrollér billedet eller skrifttypen efter ${review.kind === 'merge' ? 'indfletning' : 'gendannelse'}.`));
      else row.append(node('h4', 'Nu'), node('pre', file.before ?? '(findes ikke)'), node('h4', 'Efter'), node('pre', file.after ?? '(slettes)'));
      $('#restore-files').append(row);
    }
    $('#restore-confirm').disabled = !files.length && review.kind !== 'merge';
    if (!files.length && review.kind === 'merge') $('#restore-confirm').textContent = 'Afslut kopien';
  }
  $('#restore-dialog').addEventListener('close', () => { ++reviewRequest; review = null; $('#restore-dialog').setAttribute('aria-busy', 'false'); });
  $('#restore-undo').onclick = () => action(() => reviewRestoration({ undo: true }));
  $('#restore-confirm').onclick = () => action(async () => {
    if (!review) return;
    const ours = document.querySelector('input[name="restore-choice"]:checked')?.value !== 'theirs';
    const choices = Object.fromEntries(review.files.filter(f => f.outcome === 'conflict').map(f => [f.file, ours ? 'ours' : 'theirs']));
    const token = review.token, git = review.git, mergeChat = review.mergeChat, owner = review.owner, sourceView = review.sourceView, taskUndo = review.taskUndo, taskID = review.taskID, request = reviewRequest; review = null; $('#restore-confirm').disabled = true;
    const result = await call(mergeChat ? 'chatMerge' : 'restoreVersion', { token, label, choices, ...(mergeChat ? { chat: mergeChat } : {}) }, owner);
    const active = () => current?.root === owner?.root && view === sourceView;
    // Resultatet tilhører den oprindelige samtale, selv hvis brugeren har lukket
    // dialogen og åbnet et andet projekt, mens filerne blev sat tilbage.
    if (active() && request === reviewRequest && $('#restore-dialog').open) {
      if (result.project) await displayProject(result.project);
      else if (result.state) { await showChat(result.state); await refreshRecent(); }
    }
    if (request === reviewRequest) $('#restore-dialog').close();
    if (mergeChat) {
      const box = sourceView.review; box.replaceChildren(node('h3', result.restored.files ? 'Kopiens ændringer er flettet ind' : 'Kopien er afsluttet'));
      box.append(node('p', result.restored.files ? `${count(result.restored.files, 'fil er', 'filer er')} ændret i projektet.${result.saved ? ' Gemt som en ny version.' : ''} Prøv resultatet i forhåndsvisningen.` : 'Projektfilerne er uændrede. Nye opgaver arbejder i projektet.'));
      if (result.restored.files) {
        // Kvitteringen beder om at prøve resultatet og har derfor selv knappen som hovedvalg, som efter Fortryd og gendannelse (Q:C2-5).
        // Knappen virker kun, så længe samme samtale er åben.
        const buttons = node('div', undefined, 'row'), preview = node('button', 'Afprøv resultatet', 'primary'), changes = node('button', 'Se ændringerne'), undo = node('button', 'Fortryd indfletningen');
        preview.type = changes.type = undo.type = 'button'; preview.onclick = () => { if (active()) window.showResultPreview?.(); };
        changes.onclick = () => action(() => window.workspace.showChange(result.task));
        undo.onclick = () => action(() => reviewRestoration({ undo: true, expected: result.restored.id }, { owner, title: 'Fortryd indfletningen?', confirm: 'Fortryd indfletningen' }));
        buttons.append(preview, changes, undo); box.append(buttons);
      }
      if (result.error) box.append(node('p', result.error)); box.hidden = false;
      if (active()) { message(result.error || 'Kopien er afsluttet. Du arbejder nu i projektet.'); await refreshShownVersions(); }
      return;
    }
    const changed = result.restored?.files || 0, files = `${count(changed, 'fil er', 'filer er')} sat tilbage`;
    if (changed && taskUndo && taskID) { sourceView.undoneTasks ||= new Set(); sourceView.undoneTasks.add(taskID); }
    const first = result.savedFirst ? ' Dine ugemte ændringer blev gemt som en version først.' : '';
    const text = result.error || (!changed ? 'Ingen filer blev ændret, fordi du beholdt dine linjer.' : result.saved ? `${files} og gemt som en ny version. Du kan gå frem igen under Ændringer › Versioner.${first}` : git ? `${files}. Gennemse forhåndsvisningen. Ændringerne er ikke gemt som en ny version.${first}` : `${files}. Gennemse forhåndsvisningen. Du kan fortryde det under Ændringer › Versioner.`);
    if (active()) $('#git-feedback').textContent = text;
    const box = sourceView.review; box.replaceChildren(node('h3', result.error ? 'Gendannelsen kræver din opmærksomhed' : changed ? taskUndo ? 'Opgaven er fortrudt' : 'Filerne er sat tilbage' : 'Dine linjer er bevaret'), node('p', text)); box.hidden = false;
    // Kvitteringen beder om at gennemse forhåndsvisningen og har derfor selv knappen; resultatkortets «Afprøv resultatet»
    // forsvinder med det gamle kort (Q:C2-5). Knappen virker kun, så længe samme samtale er åben.
    if (changed && !result.error) { const buttons = node('div', undefined, 'review-actions'), preview = node('button', 'Gennemse forhåndsvisningen', 'primary'); preview.type = 'button'; preview.onclick = () => { if (active()) window.showResultPreview?.(); }; buttons.append(preview); box.append(buttons); }
    box.tabIndex = -1; if (active()) box.focus();
    if (active()) await refreshShownVersions();
  });

  // Nye billeder fra baggrunden: listen eller den åbne version opdateres, hvis de vises.
  window.harness.onEvent(event => {
    // Sikkerhedsnettet er der nu, og Aura har givet et nyt projekt dets standarder (beslutning (c), main.cjs settleDefaults).
    if (event.type === 'approvals.defaults' && event.root === current?.root) {
      const turned = event.commands ? '«Filændringer i projektet» og «Byg og kontrollér automatisk»' : '«Filændringer i projektet»';
      message(`Versionerne er klar, så Aura har slået ${turned} til. AI’en spørger ikke længere om dem. Du kan ændre det i Projektets indstillinger.`);
      return;
    }
    if (event.type !== 'history.images' || event.root !== current?.root) return;
    if (version && event.commit === version.commit) action(() => open(version.commit));
    else if (!$('#versions-view').hidden) action(load);
  });
  window.reviewRestoration = reviewRestoration;
  window.versions = { load, open, fillCompare, refreshStatus, reset() { status = null; version = null; showAll = false; cache.clear(); } };
})();
