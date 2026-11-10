// Auras netværkskald: værtsnavn, tider og status, som hovedprocessen har registreret. Ingen modelindhold eller nøgler.
// Første lag er én status, én linje om lagring, Gem rapport og Luk (DESIGN.md, Rolige skærme). Filtre, format, tabel, dækning
// og Ryd rapporten ligger bag Se detaljer. De rene funktioner øverst kan afprøves i Node uden DOM.
(() => {
  const labels = { model: 'AI-model', catalog: 'Modelkatalog', integration: 'Integration', preview: 'Forhåndsvisning', git: 'Git', update: 'Opdateringer', subprocess: 'Underprocesser' };
  const statuses = { completed: 'Gennemført', failed: 'Fejl', cancelled: 'Afbrudt', attempted: 'Venter på svar', headers: 'Svar startet', receiving: 'Modtager svar', interrupted: 'Uafsluttet ved genstart' };
  const periods = { session: 'Denne appkørsel', '5m': 'Seneste 5 minutter', all: 'Alle gemte registreringer' };
  const purposes = { 'model-response': 'AI-arbejde', 'model-catalog': 'Hent modeller', 'route-catalog': 'Hent modelruter', integration: 'Ekstern handling', 'browser-http': 'Webhandling' };
  function markup() {
    return `<div class="dialog-heading"><h2 id="network-report-title">Auras netværkskald</h2><button type="button" data-network-close>Luk</button></div>
    <p id="network-report-summary">Henter registreringer …</p>
    <p class="hint">Gælder alle projekter og gemmes kun på denne computer i højst 30 dage, uden nøgler eller beskeder.</p>
    <details id="network-report-details"><summary>Se detaljer</summary>
      <div class="network-filters"><label>Periode<select id="network-period"><option value="session">Denne appkørsel</option><option value="5m">Seneste 5 minutter</option><option value="all">Alle gemte registreringer</option></select></label><label>Type<select id="network-category"><option value="">Alle typer</option></select></label><label>Status<select id="network-status"><option value="">Alle statusser</option><option value="completed">Gennemført</option><option value="failed">Fejl</option><option value="cancelled">Afbrudt</option><option value="attempted">Venter på svar</option><option value="headers">Svar startet</option><option value="receiving">Modtager svar</option><option value="interrupted">Uafsluttet ved genstart</option></select></label><label>Format<select id="network-format"><option value="csv">CSV til regneark</option><option value="json">JSON</option></select></label></div>
      <p class="hint">Gem rapport bruger periode, type, status og format herover. CSV-filen er sat op til dansk Excel og siger selv, hvilket udsnit den dækker.</p>
      <p id="network-report-retention" class="hint"></p>
      <div class="network-table-scroll" role="region" aria-label="Registrerede kald, rul vandret for flere oplysninger" tabindex="0"><table><thead><tr><th>Tid</th><th>Destination og formål</th><th>Metode</th><th>Status</th><th>Svar efter</th><th>Første indhold</th><th>Samlet tid</th><th>Sendt / modtaget</th></tr></thead><tbody id="network-report-rows"></tbody></table></div>
      <p id="network-report-empty" hidden>Ingen registrerede kald passer til filtrene.</p>
      <p class="hint">Svar efter er tiden, til modtageren begyndte at svare. Første indhold er tiden til de første data, ikke til første ord i svaret. Ingen af tiderne viser, hvor længe udbyderen lod kaldet vente i kø. Sendt og modtaget er indholdet i kaldet, ikke al krypteret netværkstrafik.</p>
      <details id="network-coverage"><summary>Hvad er dækket?</summary><ul id="network-coverage-list"></ul><p>Andre programmer og trafik, Aura ikke registrerer, er ikke med. At noget ikke er registreret, betyder ikke, at der ingen trafik var.</p></details>
      <div id="network-report-actions" class="network-detail-actions"><button type="button" id="network-report-refresh">Opdatér</button><button type="button" id="network-report-clear" class="text-button danger">Ryd rapporten</button></div>
      <div id="network-report-clear-question" class="network-detail-actions" role="group" aria-labelledby="network-report-clear-text" hidden><p id="network-report-clear-text">Ryd rapporten? Alle Auras registreringer på denne computer slettes for alle projekter. Det kan ikke fortrydes.</p><button type="button" id="network-report-clear-cancel">Annuller</button><button type="button" id="network-report-clear-confirm" class="danger">Ryd rapporten</button></div>
    </details>
    <p id="network-report-feedback" role="status"></p>
    <div class="dialog-actions"><span></span><button type="button" id="network-report-save" class="primary">Gem rapport</button></div>`;
  }
  // Kun typer, Aura faktisk registrerer, eller som står i registreringerne. Et filter på en type uden dækning ville vise
  // «ingen registrerede kald», som kan læses som «ingen trafik».
  function categoryOptions(snapshot) {
    const present = new Set((snapshot?.records || []).map(row => row.category));
    const covered = new Set((snapshot?.coverage || []).filter(item => item.status !== 'unknown').map(item => item.category));
    return Object.entries(labels).filter(([key]) => covered.has(key) || present.has(key));
  }
  function selectRows(snapshot, f, now = Date.now()) {
    const since = f.period === '5m' ? now - 300000 : f.period === 'session' ? Date.parse(snapshot.startedAt) : 0;
    return snapshot.records.filter(row => (!f.category || row.category === f.category) && (!f.status || row.status === f.status) && (!since || Date.parse(row.startedAt) >= since));
  }
  // Sætningen i første lag: udsnittet og antallet af kald og destinationer. Den følger filtrene, ligesom Gem rapport gør.
  function summaryText(rows, f = {}) {
    const scope = [periods[f.period] || periods.all, labels[f.category], statuses[f.status]].filter(Boolean).join(' · ');
    if (!rows.length) return `${scope}: ingen registrerede kald.`;
    const destinations = new Set(rows.map(row => row.host).filter(Boolean)).size;
    const calls = `${rows.length} ${rows.length === 1 ? 'registreret kald' : 'registrerede kald'}`;
    return `${scope}: ${calls}${destinations ? ` til ${destinations} ${destinations === 1 ? 'destination' : 'destinationer'}` : ''}.`;
  }
  // Dagens kald viser klokkeslæt, ældre kald også datoen.
  function timeText(value, now = Date.now()) {
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return 'Ukendt tid';
    return date.toDateString() === new Date(now).toDateString() ? date.toLocaleTimeString('da-DK') : date.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'medium' });
  }
  const api = { markup, categoryOptions, selectRows, summaryText, timeText, labels, statuses, periods };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  const open = document.getElementById('network-report-open');
  if (!open) return;
  const dialog = document.createElement('dialog'); dialog.id = 'network-report-dialog'; dialog.setAttribute('aria-labelledby', 'network-report-title');
  dialog.innerHTML = markup();
  document.body.append(dialog);
  const el = id => document.getElementById(id);
  let snapshot = null, request = 0;
  const filters = () => ({ period: el('network-period').value, category: el('network-category').value, status: el('network-status').value });
  const formatTime = value => typeof value === 'number' && Number.isFinite(value) ? `${(value / 1000).toLocaleString('da-DK', { maximumFractionDigits: 2 })} s` : 'Ikke målt';
  const formatBytes = value => typeof value === 'number' && Number.isFinite(value) ? `${(value / 1000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} kB` : 'Ikke målt';
  const text = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };
  // Gem og Ryd venter på en læst rapport. Opdatér forbliver aktiv, så fokus ikke forsvinder fra knappen under indlæsning.
  const busy = value => { for (const id of ['network-report-save', 'network-report-clear', 'network-report-clear-confirm']) el(id).disabled = value; };
  // Ryd rapporten spørger først i dialogen, ligesom Slet samtale (N:E-4): spørgsmålet afløser knapperne, til det er besvaret.
  const question = value => { el('network-report-actions').hidden = value; el('network-report-clear-question').hidden = !value; };
  function render() {
    if (!snapshot) return;
    const f = filters(), now = Date.now(), rows = selectRows(snapshot, f, now), body = el('network-report-rows'); body.replaceChildren();
    for (const row of [...rows].reverse()) {
      const tr = document.createElement('tr');
      tr.append(text('td', timeText(row.startedAt, now)));
      const destination = text('td', row.host || 'Ukendt destination'); destination.append(text('small', purposes[row.purpose] || labels[row.category] || 'Registreret kald'));
      if (row.locality === 'loopback') destination.append(text('small', 'Adresse på denne computer'));
      tr.append(destination, text('td', row.method || 'Ikke oplyst'), text('td', `${statuses[row.status] || 'I gang'}${row.httpStatus ? ' · ' + row.httpStatus : ''}`), text('td', formatTime(row.headersMs)), text('td', formatTime(row.firstBodyMs)),
        text('td', row.totalMs === null && ['attempted', 'headers', 'receiving'].includes(row.status) ? `${formatTime(Math.max(0, Date.parse(snapshot.generatedAt) - Date.parse(row.startedAt)))} · i gang` : formatTime(row.totalMs)));
      const bytes = text('td', formatBytes(row.sentBytes)); bytes.append(text('small', formatBytes(row.receivedBytes))); tr.append(bytes); body.append(tr);
    }
    el('network-report-summary').textContent = summaryText(rows, f);
    el('network-report-empty').hidden = rows.length > 0;
    const capacity = Number.isSafeInteger(snapshot.capacity) ? `, fordi rapporten højst rummer ${snapshot.capacity.toLocaleString('da-DK')} kald` : '';
    el('network-report-retention').textContent = `${snapshot.dropped ? `${snapshot.dropped} ældre registreringer er ikke længere med${capacity}. ` : ''}${snapshot.persistence?.status === 'unavailable' ? 'Aura kunne ikke gemme registreringerne på computeren, så kun dem fra denne appkørsel vises. ' : ''}Tabellen viser et øjebliksbillede. Vælg Opdatér for nye kald.`;
  }
  function show(value) {
    snapshot = value;
    const category = el('network-category'), previous = category.value, options = categoryOptions(snapshot);
    category.replaceChildren(new Option('Alle typer', ''));
    for (const [key, label] of options) category.append(new Option(label, key));
    category.value = options.some(([key]) => key === previous) ? previous : '';
    const coverage = el('network-coverage-list'); coverage.replaceChildren();
    for (const item of snapshot.coverage || []) coverage.append(text('li', `${labels[item.category] || item.category}: ${item.note}`));
    for (const limit of snapshot.limits || []) coverage.append(text('li', limit));
    render();
  }
  async function load() {
    const ticket = ++request; el('network-report-feedback').textContent = ''; busy(true);
    if (!snapshot) el('network-report-summary').textContent = 'Henter registreringer …';
    try {
      const response = await window.harness.networkReport(undefined, null); if (ticket !== request || !dialog.open) return;
      if (!response.ok) throw new Error(response.error);
      show(response.value); busy(false);
    } catch { if (ticket === request && dialog.open) el('network-report-summary').textContent = 'Rapporten kunne ikke læses. Luk og åbn den igen.'; }
  }
  open.addEventListener('click', () => { dialog.showModal(); void load(); });
  for (const button of dialog.querySelectorAll('[data-network-close]')) button.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { ++request; question(false); open.focus(); });
  for (const id of ['network-period', 'network-category', 'network-status']) el(id).addEventListener('change', render);
  el('network-report-refresh').onclick = load;
  el('network-report-save').onclick = async () => {
    if (!snapshot) return;
    const ticket = request, button = el('network-report-save'); button.disabled = true; el('network-report-feedback').textContent = 'Gemmer …';
    try {
      const response = await window.harness.networkReportSave({ format: el('network-format').value, filters: filters() }, null); if (ticket !== request || !dialog.open) return;
      if (!response.ok) throw new Error(response.error);
      el('network-report-feedback').textContent = response.value ? 'Rapporten er gemt på denne computer. Den er ikke sendt.' : 'Rapporten blev ikke gemt.';
    } catch { if (ticket === request && dialog.open) el('network-report-feedback').textContent = 'Rapporten kunne ikke gemmes. Prøv igen.'; }
    finally { if (ticket === request && dialog.open) button.disabled = false; }
  };
  // Fokus står på Annuller, som ved Slet samtale. Annuller sletter intet.
  el('network-report-clear').onclick = () => { question(true); el('network-report-clear-cancel').focus(); };
  el('network-report-clear-cancel').onclick = () => { question(false); el('network-report-clear').focus(); };
  // Først svaret i spørgsmålet sletter journalen i hovedprocessen og viser den tomme rapport, som hovedprocessen sender tilbage.
  el('network-report-clear-confirm').onclick = async () => {
    question(false); el('network-report-clear').focus();
    const ticket = ++request; busy(true);
    try {
      const response = await window.harness.networkReportClear(undefined, null); if (ticket !== request || !dialog.open) return;
      if (!response.ok) throw new Error(response.error);
      show(response.value); el('network-report-feedback').textContent = 'Rapporten er ryddet. Kun nye kald registreres fra nu af.';
    } catch { if (ticket === request && dialog.open) el('network-report-feedback').textContent = 'Rapporten kunne ikke ryddes. Prøv igen.'; }
    finally { if (ticket === request && dialog.open) busy(false); }
  };
})();
