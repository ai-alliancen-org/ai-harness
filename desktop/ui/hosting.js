(() => {
  const $ = selector => document.querySelector(selector);
  let review = null, creation = null, login = null, timer = null, focus = null, selected = false, authEpoch = 0;
  const view = window.ShareView;
  function rows(id, values) { $(id).replaceChildren(...values.flatMap(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value || 'Ikke oplyst'; return [dt, dd]; })); }
  async function api(method, value) { const result = await window.harness[method](value); if (!result.ok) throw new Error(result.error); return result.value; }
  async function act(fn) {
    $('#hosting-body').disabled = true; $('#hosting-feedback').textContent = '';
    try { await fn(); }
    catch (error) { invalidate(); $('#hosting-target-section').hidden = false; $('#hosting-feedback').textContent = error.message; }
    finally { $('#hosting-body').disabled = false; if (focus) { focus.scrollIntoView({ block: 'start' }); focus.focus({ preventScroll: true }); focus = null; } }
  }
  function invalidate() { review = null; $('#hosting-review-result').hidden = true; $('#hosting-ack').checked = false; $('#hosting-push').disabled = true; $('#hosting-target-section').hidden = false; $('#hosting-publication').hidden = false; $('#hosting-project-title').hidden = false; $('#hosting-review').hidden = !selected; $('#hosting-open').hidden = !selected; }
  async function refresh() {
    const state = await api('hostingState');
    $('#hosting-status').textContent = state.connected ? `Konto gemt: ${state.login}${state.expired ? ' · adgang udløbet' : ' · kontrollér adgang før publicering'}` : 'Ingen GitHub-konto forbundet.';
    $('#hosting-auth').hidden = state.connected && !state.expired;
    // Uden et registreret GitHub-login i denne version vises knappen ikke; en deaktiveret knap er en blindgyde.
    $('#hosting-login').disabled = !state.browserLogin; $('#hosting-login').hidden = !state.browserLogin;
    $('#hosting-login-help').textContent = state.browserLogin ? 'Du godkender adgangen hos GitHub. Appen modtager ikke din GitHub-adgangskode.' : 'Login med GitHub i browseren er ikke slået til i denne version. Under Avanceret kan du forbinde med et GitHub-token.';
    $('#hosting-disconnect').disabled = !state.connected; $('#hosting-account').hidden = !state.connected;
    $('#hosting-catalog').disabled = !state.connected;
    $('#hosting-project').hidden = !state.project || !state.connected;
    $('#hosting-publication').textContent = state.publication?.selected ? `${state.publication.selected.fullName} · ${state.publication.changes} ugemte filer. Serverstatus er endnu ikke kontrolleret.` : state.publication?.message || '';
    $('#hosting-scope').textContent = view.scope(state.context);
    $('#hosting-target-section').open = !state.publication?.selected;
    selected = Boolean(state.publication?.selected);
    $('#hosting-open').disabled = !state.publication?.selected; $('#hosting-open').hidden = !state.publication?.selected;
    $('#hosting-review').disabled = !state.publication?.selected; $('#hosting-review').hidden = !state.publication?.selected;
  }
  function cancelLogin() { clearTimeout(timer); timer = null; login = null; $('#hosting-device').hidden = true; return api('hostingCancel'); }
  async function poll(id) {
    if (login !== id) return;
    try {
      const result = await api('hostingPoll', id); if (login !== id) return;
      if (result.waiting) timer = setTimeout(() => poll(id), Math.max(1000, result.retryAfter));
      else { login = null; $('#hosting-device').hidden = true; invalidate(); await refresh(); $('#hosting-feedback').textContent = 'GitHub-adgangen er gemt krypteret. Hent konti og repositories for at fortsætte.'; }
    } catch (error) { if (login === id) { await cancelLogin().catch(() => {}); $('#hosting-feedback').textContent = error.message; } }
  }
  const open = () => { ++authEpoch; creation = null; $('#hosting-create-confirm').hidden = true; $('#hosting-technical').open = false; $('#hosting-account').open = false; $('#hosting-dialog').showModal(); invalidate(); act(refresh); };
  $('#setup-hosting').onclick = open; $('#publish-button').onclick = open;
  $('#hosting-dialog').addEventListener('close', () => { ++authEpoch; cancelLogin().catch(() => {}); });
  $('#hosting-login').onclick = () => act(async () => { const value = await api('hostingLogin'); login = value.id; $('#hosting-code').textContent = value.code; $('#hosting-device').hidden = false; timer = setTimeout(() => poll(value.id), value.retryAfter); });
  $('#hosting-browser').onclick = () => act(() => api('hostingBrowser'));
  $('#hosting-cancel').onclick = () => act(cancelLogin);
  $('#hosting-token-form').onsubmit = event => { event.preventDefault(); const ticket = authEpoch, current = () => ticket === authEpoch && $('#hosting-dialog').open; act(async () => { await cancelLogin(); if (!current()) return; const result = await api('credentialEntry', { purpose: 'github' }); if (!current() || result.canceled) return; await api('hostingToken', { keyReceipt: result.keyReceipt }); if (!current()) return; invalidate(); await refresh(); if (current()) $('#hosting-feedback').textContent = 'Konto kontrolleret og adgang gemt krypteret.'; }); };
  $('#hosting-disconnect').onclick = () => act(async () => { await cancelLogin(); await api('hostingDisconnect'); invalidate(); $('#hosting-repositories').replaceChildren(); $('#hosting-owner').replaceChildren(); await refresh(); });
  $('#hosting-catalog').onclick = () => act(async () => {
    const result = await api('hostingCatalog');
    $('#hosting-owner').replaceChildren(new Option('Vælg konto eller organisation', ''), ...result.owners.map(owner => new Option(`${owner.login} · ${owner.type === 'User' ? 'egen konto' : 'organisation'}`, owner.login)));
    $('#hosting-repositories').replaceChildren(new Option('Vælg repository', ''), ...result.repositories.map(repo => new Option(`${repo.fullName} · ${repo.private ? 'privat' : 'offentligt'}`, repo.fullName)));
    $('#hosting-feedback').textContent = `${result.repositories.length} repositories med skriveadgang. Organisationsregler kan stadig begrænse oprettelse og push.`;
  });
  $('#hosting-repositories').onchange = () => { $('#hosting-target').value = $('#hosting-repositories').value; invalidate(); };
  $('#hosting-attach-form').onsubmit = event => { event.preventDefault(); act(async () => { const target = await api('hostingAttach', $('#hosting-target').value.trim()); invalidate(); await refresh(); $('#hosting-feedback').textContent = `${target.fullName} er tilsluttet. Ingen filer er uploadet.`; }); };
  $('#hosting-create-form').onsubmit = event => { event.preventDefault(); creation = { owner: $('#hosting-owner').value, repo: $('#hosting-name').value.trim(), visibility: $('#hosting-visibility').value }; $('#hosting-create-description').textContent = `Opret ${creation.visibility === 'private' ? 'privat' : 'OFFENTLIGT'} repository ${creation.owner}/${creation.repo} på GitHub? Det oprettes tomt; ingen projektfiler sendes endnu.`; $('#hosting-create-confirm').hidden = false; };
  for (const id of ['hosting-owner', 'hosting-name', 'hosting-visibility']) $('#' + id).addEventListener('input', () => { creation = null; $('#hosting-create-confirm').hidden = true; });
  $('#hosting-create-cancel').onclick = () => { creation = null; $('#hosting-create-confirm').hidden = true; };
  $('#hosting-create-do').onclick = () => act(async () => {
    const input = creation; creation = null; $('#hosting-create-confirm').hidden = true; if (!input) return;
    const target = await api('hostingCreate', input); $('#hosting-create-section').open = false; $('#hosting-target').value = target.fullName;
    $('#hosting-feedback').textContent = `${target.url} er oprettet (${target.private ? 'privat' : 'offentligt'}). Tilslut det med knappen ovenfor. Der er ikke pushet filer.`;
  });
  function showReview(result, sent = false) {
    $('#hosting-review-result').hidden = false; $('#hosting-publication').hidden = true; $('#hosting-project-title').hidden = true; $('#hosting-target-section').hidden = true; $('#hosting-technical').open = false;
    $('#hosting-review-title').textContent = result.synchronized || sent ? 'Versionen findes på serveren' : 'Gennemgå sikkerhedskopien';
    $('#hosting-destination').textContent = `${view.version(result)} → ${result.target.fullName}. ${result.synchronized || sent ? 'Versionen er bekræftet på serveren.' : `${result.commits.length} ${result.commits.length === 1 ? 'version sendes' : 'versioner sendes'}.`}`;
    rows('#hosting-summary', [['Adgang ifølge GitHub', result.target.private ? 'Privat repository. Testpersonens læseadgang er ikke afprøvet.' : 'Offentligt repository. Alle kan se kode og historik.'], ['Kontrol', `${view.time(result.checkedAt)} · ${result.synchronized || sent ? 'Serverens version er bekræftet' : 'Historik og destination er gennemgået; ingen filer er sendt'}`], ['Det deles', 'Kode og versionshistorik. Appen er ikke udgivet; dette er ikke et testlink.']]);
    rows('#hosting-details', [['Versionens ID', result.head], ['Branch', result.branch], ['Udgående historik', result.synchronized || sent ? 'Ingen versioner afventer denne overførsel' : `${result.commits.length} ${result.commits.length === 1 ? 'version' : 'versioner'} · ${result.remoteHead ? 'eksisterende branch opdateres' : 'ny branch på serveren'}`]]);
    $('#hosting-files').replaceChildren(...(result.files || []).map(file => { const li = document.createElement('li'); li.textContent = file; return li; }));
    review = result.token || null; $('#hosting-review').hidden = Boolean(review); $('#hosting-open').hidden = Boolean(review); $('#hosting-consent').hidden = !review; $('#hosting-ack').checked = false; $('#hosting-push').disabled = true;
    focus = $('#hosting-review-title');
  }
  $('#hosting-review').onclick = () => act(async () => {
    invalidate(); const result = await api('hostingReview'); showReview(result); $('#hosting-scope').textContent = view.scope(result.context);
    $('#hosting-feedback').textContent = result.synchronized ? 'Lokalt og på serveren · synkroniseret.' : 'Bekræft nedenfor for at sende den gennemgåede version.';
  });
  $('#hosting-edit').onclick = () => { invalidate(); $('#hosting-target-section').open = true; $('#hosting-target').focus(); };
  $('#hosting-ack').onchange = () => { $('#hosting-push').disabled = !review || !$('#hosting-ack').checked; };
  $('#hosting-push').onclick = () => act(async () => { const token = review; invalidate(); if (!token) return; const result = await api('hostingPush', token); await refresh(); showReview(result, true); $('#hosting-feedback').textContent = result.message; });
  $('#hosting-open').onclick = () => act(() => api('hostingOpen'));
})();
