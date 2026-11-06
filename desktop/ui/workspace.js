// Arbejdsfladen ved siden af samtalen: Forhåndsvisning, Ændringer, Kode og Aktivitet.
// Fanerne ligger oven på hinanden og skjules kun visuelt, så previewets formularer, rulning og andre fanes tilstand
// bevares ved faneskift. Kun brugeren skifter fane; AI'ens hændelser markerer en fane, men skifter aldrig væk.
(() => {
  const tabs = ['preview', 'plan', 'changes', 'overview', 'code', 'activity'];
  let active = 'preview';
  const tab = name => $(`#tab-${name}`), panel = name => $(`#panel-${name}`);
  const visuallyHidden = text => node('span', text, 'visually-hidden');
  const plural = (n, one, many) => `${n.toLocaleString('da-DK')} ${n === 1 ? one : many}`;
  const clock = at => new Date(at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const duration = ms => !Number.isFinite(ms) || ms < 0 ? '' : ms < 1000 ? 'under 1 s' : elapsedText(ms);

  function show(name, { focus = false } = {}) {
    if (!tabs.includes(name)) return;
    active = name;
    for (const item of tabs) {
      const selected = item === name;
      tab(item).setAttribute('aria-selected', String(selected)); tab(item).tabIndex = selected ? 0 : -1;
      panel(item).classList.toggle('is-active', selected); panel(item).inert = !selected;
    }
    if (focus) tab(name).focus();
    if (name === 'plan') { $('#plan-badge').hidden = true; window.planning?.render(); }
    if (name === 'changes') { badge('changes', 0); if (changes.mode === 'session' && (changes.stale || !changes.data)) action(() => loadChanges()); }
    if (name === 'overview') window.systemOverview?.show();
    if (name === 'code') { if (!code.files || code.stale) action(loadCodeList); action(checkCodeFile); }
    if (name === 'activity') { activity.unseen = false; updateActivityBadge(); if (activity.toBottom) { activity.toBottom = false; requestAnimationFrame(() => { $('#activity-scroll').scrollTop = $('#activity-scroll').scrollHeight; }); } }
  }
  for (const item of tabs) tab(item).addEventListener('click', () => show(item));
  // Piletasterne springer over en skjult fane, fx Plan, når planlægning er slået fra.
  $('.work-tabs').addEventListener('keydown', event => {
    const visible = tabs.filter(item => !tab(item).hidden), index = visible.indexOf(active);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: visible.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); show(visible[(next + visible.length) % visible.length], { focus: true });
  });
  function badge(name, count, label) {
    const el = $(`#${name}-badge`);
    el.hidden = !count; el.replaceChildren();
    if (count) el.append(node('span', String(count), undefined), visuallyHidden(` ${label}`));
  }

  // ---------- Ændringer ----------
  // To visninger: Denne samtale (opgaver og dine rettelser, mens appen er åben) og Versioner (den gemte historik).
  // En åben version bruger samme filoversigt og linje-diff som en opgave, med kilden version:<commit>.
  const changes = { data: null, source: '', file: '', stale: true, latest: '', mode: 'session', sessionSource: '', versionView: null };
  const versionSource = () => changes.source.startsWith('version:');
  const byText = { ai: 'AI’en', blandet: 'AI’en og andre', kommando: 'En kommando eller dig', dig: 'Dig', anden: 'Ikke AI’en' };
  // Forklaringen afhænger af visningen: en opgave udtaler sig kun om opgavens egen tid, hele samtalen også om tiden efter.
  const byHelp = {
    task: { ai: 'AI’ens filværktøj skrev filen under opgaven.', blandet: 'AI’en skrev filen under opgaven, men den blev også ændret af andre, før opgaven sluttede.', kommando: 'Ændret under opgaven, men ikke af AI’ens filværktøjer. Det kan være en kommando, AI’en kørte, eller dig.', anden: 'Ændret under opgaven, men ikke af AI’en. Det kan være dig eller et andet program.', dig: 'Du ændrede filen i Aura, fx med Ret i siden eller Fortryd.' },
    session: { ai: 'AI’ens filværktøj skrev filen, og ingen har ændret den siden.', blandet: 'AI’en skrev filen, men den er også ændret af andre, fx dig eller et andet program.', kommando: 'Ændret under en opgave, men ikke af AI’ens filværktøjer. Det kan være en kommando, AI’en kørte, eller dig.', anden: 'Ikke ændret af AI’en. Det kan være dig eller et andet program.', dig: 'Du ændrede filen i Aura, fx med Ret i siden eller Fortryd, og ingen har ændret den siden.' }
  };
  byHelp.version = { ai: 'Gemt efter en AI-opgave. Filen kan være skrevet af AI’ens filværktøj eller af en kommando, den kørte.', dig: 'Gemt, gendannet eller fortrudt af dig.' };
  const help = by => byHelp[versionSource() ? 'version' : changes.source === 'session' ? 'session' : 'task'][by];
  const changeText = { ny: 'Ny', ændret: 'Ændret', slettet: 'Slettet' };
  function changeView() { return versionSource() ? changes.versionView : changes.source === 'session' ? changes.data?.session : changes.data?.tasks.find(task => task.id === changes.source); }
  // Visningerne: knapperne øverst, hvad der vises, og at valget af opgave kun hører til Denne samtale.
  function applyMode() {
    const versions = changes.mode === 'versions', detail = versions && versionSource();
    $('#changes-view-session').setAttribute('aria-pressed', String(!versions)); $('#changes-view-versions').setAttribute('aria-pressed', String(versions));
    $('#changes-source').hidden = versions;
    $('#versions-view').hidden = !versions || detail; $('#version-detail').hidden = !detail;
    if (versions) { $('#changes-notice').hidden = true; $('#changes-empty').hidden = true; if (!detail) { $('#changes-overview').hidden = true; $('#changes-diff').hidden = true; } }
  }
  function showVersions({ focus = false } = {}) {
    if (changes.mode === 'session') changes.sessionSource = changes.source;
    changes.mode = 'versions'; changes.source = ''; changes.file = ''; changes.versionView = null; applyMode();
    if (focus) $('#versions-heading').focus();
  }
  // Én version fra historikken: filerne vises med samme oversigt og diff som en opgave.
  function showVersion(version) {
    const by = ['ai', 'stopped'].includes(version.kind) ? 'ai' : 'dig';
    const files = version.files.map(file => ({ ...file, by }));
    changes.mode = 'versions'; changes.source = `version:${version.commit}`; changes.file = '';
    changes.versionView = { kind: 'version', version, files, totals: { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), mixed: 0, others: 0 }, hidden: files.filter(f => f.hidden).length };
    applyMode(); return action(renderChanges);
  }
  async function showSession() {
    changes.mode = 'session'; changes.source = changes.sessionSource; changes.versionView = null; changes.file = ''; applyMode();
    await loadChanges();
  }
  $('#changes-view-session').onclick = () => { if (changes.mode !== 'session') action(showSession); };
  $('#changes-view-versions').onclick = () => { if (changes.mode !== 'versions') { showVersions(); action(() => window.versions.load()); } };
  async function loadChanges({ source } = {}) {
    const root = current?.workspaceRoot || current?.root; if (!root || changes.mode !== 'session') return;
    const data = await call('changesOverview'); if ((current?.workspaceRoot || current?.root) !== root) return;
    changes.data = data; changes.stale = false; $('#changes-notice').hidden = true;
    const options = [...data.tasks.map(task => option(task.id, `${task.status === 'working' ? 'I gang · ' : task.status === 'idle' ? '' : 'Afbrudt · '}${versionTime(task.startedAt)} · ${shortLabel(task.label, 48)}${task.undone ? " · fortrudt" : ""}`)), ...(data.session ? [option('session', `Hele samtalen · siden ${versionTime(data.session.startedAt)}`)] : [])];
    $('#changes-source').replaceChildren(...(options.length ? options : [option('', 'Ingen opgaver endnu')])); $('#changes-source').disabled = !options.length;
    const wanted = source || changes.source;
    changes.source = options.some(item => item.value === wanted) ? wanted : data.tasks[0]?.id || (data.session ? 'session' : '');
    $('#changes-source').value = changes.source;
    await renderChanges();
  }
  async function renderChanges() {
    const view = changeView();
    $('#changes-empty').hidden = Boolean(view) || changes.mode === 'versions'; $('#changes-overview').hidden = !view; $('#changes-diff').hidden = true;
    if (view?.kind === 'version') return renderVersionFiles(view);
    if (!view) { $('#changes-empty p').textContent = changes.data?.running ? 'AI’en arbejder. Ændringerne vises her, når filerne bliver skrevet.' : 'Når AI’en ændrer filer, ser du her, hvilke filer og linjer der er ændret.'; return; }
    const session = changes.source === 'session', { totals } = view;
    // Dine egne rettelser og fortrydelser i Aura står som dine, ikke som en opgave.
    const own = !session && ['direct', 'undo', 'merge'].includes(view.kind);
    // Før- og efterbillede af forhåndsvisningen, når Aura har taget dem for opgaven.
    compare.hidden = true;
    if (!session && view.images && window.versions) window.versions.fillCompare(compare, view.images);
    $('#changes-heading').textContent = !totals.files ? (session ? 'Ingen filer er ændret i denne samtale' : 'Opgaven ændrede ingen filer') : session ? `${plural(totals.files, 'fil', 'filer')} ændret i denne samtale` : own ? `${plural(totals.files, 'fil', 'filer')} ændret af dig` : `${plural(totals.files, 'fil', 'filer')} ændret under opgaven`;
    const lines = totals.files ? ` I alt ${plural(totals.added, 'linje', 'linjer')} tilføjet og ${totals.removed.toLocaleString('da-DK')} fjernet.` : '';
    $('#changes-basis').textContent = session
      ? `${view.basis === 'merge' ? 'Sammenlignet med projektfilerne før indfletningen' : 'Sammenlignet med filerne, da den første ændring i samtalen begyndte'} ${versionTime(view.startedAt)}. Alle ændringer er med, også dine egne.${lines}`
      : own ? `${view.kind === 'merge' ? 'Du flettede ind' : view.kind === 'undo' ? 'Du fortrød' : 'Du rettede i forhåndsvisningen'} ${versionTime(view.startedAt)}: ${shortLabel(view.label.replace(/^(Flettet ind|Fortrudt|Tekstrettelse): /, ''), 90)}.${lines}`
      : `Sammenlignet med filerne i ${view.workspace === 'kopi' ? 'samtalens kopi' : 'projektet'}, da opgaven »${shortLabel(view.label, 60)}« startede ${versionTime(view.startedAt)}.${view.status === 'idle' ? '' : view.status === 'working' ? ' Opgaven er stadig i gang.' : view.status === 'stopped' ? ' Opgaven blev stoppet undervejs.' : ' Opgaven blev ikke færdig.'}${view.undone ? ' Den er fortrudt siden.' : ''}${lines}`;
    const notes = [];
    if (totals.mixed) notes.push(`${plural(totals.mixed, 'fil er', 'filer er')} ændret af både AI’en og andre.`);
    if (totals.others) notes.push(session ? `${plural(totals.others, 'fil er', 'filer er')} ikke ændret af AI’en.` : `${plural(totals.others, 'fil blev', 'filer blev')} ændret under opgaven, men ikke af AI’ens filværktøjer.`);
    if (!session && view.changedSince) notes.push(`${plural(view.changedSince, 'fil er', 'filer er')} ændret igen, efter at opgaven sluttede, fx fortrudt. Vælg Hele samtalen for at se, hvordan de er nu.`);
    $('#changes-others').textContent = notes.join(' '); $('#changes-others').hidden = !notes.length;
    const skipped = view.skipped || 0;
    $('#changes-skipped').textContent = view.unavailable ? 'Ændringerne kunne ikke læses for denne opgave. Gennemgå filerne under Kode.' : skipped ? `${plural(skipped, 'fil er', 'filer er')} udeladt, fordi de er binære, store eller beskyttede.` : '';
    $('#changes-skipped').hidden = !view.unavailable && !skipped;
    renderFileRows(view);
    const keep = view.files.some(file => file.file === changes.file) ? changes.file : view.files[0]?.file;
    if (keep) await showDiff(keep); else changes.file = '';
  }
  // Filerne i en gemt version i forhold til versionen før.
  async function renderVersionFiles(view) {
    compare.hidden = true;
    const { totals, version } = view;
    $('#changes-heading').textContent = totals.files ? `${plural(totals.files, 'fil', 'filer')} ændret i versionen` : 'Versionen ændrede ingen filer';
    $('#changes-basis').textContent = version.parent ? `Sammenlignet med versionen før.${totals.files ? ` I alt ${plural(totals.added, 'linje', 'linjer')} tilføjet og ${totals.removed.toLocaleString('da-DK')} fjernet.` : ''}` : 'Den første version: alle filer er nye.';
    $('#changes-others').hidden = true;
    $('#changes-skipped').textContent = view.hidden ? `Indholdet af ${plural(view.hidden, 'fil', 'filer')} vises ikke, fordi de er binære, store, beskyttede eller kan indeholde en nøgle.` : '';
    $('#changes-skipped').hidden = !view.hidden;
    renderFileRows(view);
    const keep = view.files.find(file => file.file === changes.file && !file.hidden)?.file || view.files.find(file => !file.hidden)?.file;
    if (keep) await showDiff(keep); else changes.file = '';
  }
  function renderFileRows(view) {
    $('#changes-files').replaceChildren(...view.files.map(file => {
      const item = node('li'), button = node('button', undefined, 'file-row'); button.type = 'button'; button.dataset.file = file.file;
      button.setAttribute('aria-pressed', String(file.file === changes.file));
      const stats = node('span', undefined, 'file-stats');
      stats.append(node('span', `+${file.added}`, 'add'), ' ', node('span', `−${file.removed}`, 'del'), visuallyHidden(` ${plural(file.added, 'linje', 'linjer')} tilføjet, ${file.removed} fjernet`));
      const by = node('span', byText[file.by], `by-tag by-${file.by}`); by.title = help(file.by);
      button.append(node('span', changeText[file.change], `change-tag change-${file.change}`), node('span', file.file, 'file-path'), stats, by);
      button.onclick = () => action(() => showDiff(file.file, { focus: true }));
      item.append(button); return item;
    }));
  }
  // Billederne til en opgave står under resuméet; de skabes én gang og fyldes af history.js.
  const compare = node('div', undefined, 'compare'); compare.hidden = true;
  for (const text of ['Før', 'Efter']) { const figure = node('figure'), img = node('img'); img.alt = ''; figure.append(img, node('figcaption', text)); compare.append(figure); }
  $('#changes-basis').after(compare);
  async function showDiff(file, { focus = false } = {}) {
    const root = current?.workspaceRoot || current?.root, source = changes.source;
    const detail = await call('changesFile', { source, file });
    if ((current?.workspaceRoot || current?.root) !== root || changes.source !== source) return;
    changes.file = file;
    for (const button of document.querySelectorAll('#changes-files .file-row')) button.setAttribute('aria-pressed', String(button.dataset.file === file));
    $('#changes-diff').hidden = false; $('#changes-diff-title').textContent = file;
    $('#changes-open-code').hidden = detail.change === 'slettet';
    const notes = [help(detail.by)];
    if (detail.secret) notes.push('Filen kan indeholde en nøgle eller adgangskode, så linjerne vises ikke her.');
    if (detail.binary) notes.push('Filen er binær, så den har ingen linje-diff. Åbn den under Kode.');
    if (detail.invisible) notes.push('Forskellen ligger i usynlige tegn, fx linjeskift eller mellemrum i slutningen af filen.');
    if (detail.approximate) notes.push('Filen er ændret så meget, at den vises som fjernet og skrevet på ny.');
    if (detail.truncated) notes.push('Ændringen er lang. Kun begyndelsen vises; se hele filen under Kode.');
    $('#changes-diff-note').textContent = notes.join(' ');
    const rows = [];
    const gap = count => { const row = node('div', `⋯ ${plural(count, 'uændret linje', 'uændrede linjer')}`, 'diff-gap'); return row; };
    for (const hunk of detail.hunks) {
      if (hunk.skippedBefore > 0) rows.push(gap(hunk.skippedBefore));
      for (const line of hunk.lines) {
        const kind = line.type === '+' ? 'add' : line.type === '-' ? 'del' : 'same';
        const row = node('div', undefined, `diff-row ${kind}`);
        const sign = node('span', line.type === ' ' ? '' : line.type === '+' ? '+' : '−', 'sign'); sign.setAttribute('aria-hidden', 'true');
        const text = node('span', undefined, 'code');
        if (kind !== 'same') text.append(visuallyHidden(kind === 'add' ? 'Tilføjet: ' : 'Fjernet: '));
        text.append(line.text || ' ');
        row.append(node('span', line.old ?? '', 'ln'), node('span', line.new ?? '', 'ln'), sign, text);
        rows.push(row);
      }
    }
    if (detail.hunks.length && detail.skippedAfter > 0) rows.push(gap(detail.skippedAfter));
    $('#changes-diff-lines').replaceChildren(...rows); $('#changes-diff-lines').hidden = !rows.length;
    if (focus) $('#changes-diff-title').focus();
  }
  $('#changes-source').onchange = () => { changes.source = $('#changes-source').value; changes.file = ''; action(renderChanges); };
  $('#changes-refresh').onclick = () => action(() => changes.mode === 'versions' ? (versionSource() ? window.versions.open(changes.source.slice(8)) : window.versions.load()) : loadChanges());
  $('#changes-notice-show').onclick = () => action(() => loadChanges({ source: changes.latest }));
  $('#changes-open-code').onclick = () => openFile(changes.file);
  // Brugeren åbner ændringerne fra resultatkortet eller en fil i samtalen.
  async function showChange(source, file) {
    if (changes.mode !== 'session') { changes.mode = 'session'; changes.versionView = null; changes.source = changes.sessionSource; applyMode(); }
    show('changes');
    await loadChanges({ source });
    if (file && changeView()?.files.some(item => item.file === file)) await showDiff(file, { focus: true });
    else $('#changes-heading').focus();
  }

  // ---------- Kode ----------
  const code = { files: null, index: new Set(), names: new Map(), stale: true, path: '', text: null, from: null, to: null, anchor: null };
  function rebuildIndex() {
    code.index = new Set(code.files.map(file => file.path)); code.names = new Map();
    for (const file of code.files) { const name = file.path.split('/').pop(); code.names.set(name, code.names.has(name) ? null : file.path); }
  }
  async function loadCodeList() {
    const root = current?.workspaceRoot || current?.root; if (!root) return;
    const data = await call('codeList'); if ((current?.workspaceRoot || current?.root) !== root) return;
    code.files = data.files; code.stale = false; code.truncated = data.truncated; rebuildIndex(); renderCodeList(); linkifyAll();
  }
  function fileButton(file) {
    const button = node('button', undefined, 'code-file'); button.type = 'button'; button.dataset.path = file.path;
    const slash = file.path.lastIndexOf('/');
    if (slash > 0) button.append(node('span', file.path.slice(0, slash + 1), 'code-file-dir'));
    button.append(node('span', file.path.slice(slash + 1), 'code-file-name'));
    if (file.changed) { const tag = node('span', changeText[file.changed] || 'Ændret', `change-tag change-${file.changed}`); button.append(tag); }
    if (file.path === code.path) button.setAttribute('aria-current', 'true');
    button.onclick = () => openFile(file.path);
    return button;
  }
  function renderCodeList() {
    const query = $('#code-search').value.trim().toLocaleLowerCase('da');
    const files = (code.files || []).filter(file => !query || file.path.toLocaleLowerCase('da').includes(query));
    const changed = files.filter(file => file.changed), shown = files.slice(0, 400);
    const groups = [];
    if (changed.length && !query) groups.push(node('h3', 'Ændret i denne samtale', 'code-group'), ...changed.map(fileButton), node('h3', 'Alle filer', 'code-group'));
    groups.push(...shown.map(fileButton));
    if (!files.length) groups.push(node('p', code.files?.length ? 'Ingen filer passer til søgningen.' : 'Projektet har ingen filer, der kan vises her.', 'hint'));
    $('#code-files').replaceChildren(...groups);
    const notes = [];
    if (files.length > shown.length) notes.push(`Viser ${shown.length} af ${files.length} filer. Søg for at finde resten.`);
    if (code.truncated) notes.push('Projektet har flere filer, end Aura viser her.');
    notes.push('Nøgler, private referencer, Git-historik og installerede pakker vises ikke.');
    $('#code-files-note').textContent = notes.join(' '); $('#code-files-note').hidden = false;
  }
  $('#code-search').addEventListener('input', renderCodeList);
  function browser(open) {
    $('#code-layout').dataset.browser = open ? 'open' : 'closed'; $('#code-pick').setAttribute('aria-expanded', String(open));
  }
  $('#code-pick').onclick = () => { const open = $('#code-layout').dataset.browser !== 'open'; browser(open); if (open) { if (!code.files || code.stale) action(loadCodeList); $('#code-search').focus(); } };
  const lineText = () => code.from ? (code.from === code.to ? `linje ${code.from}` : `linje ${code.from}–${code.to}`) : '';
  function updateReferenceButton() {
    $('#code-reference').disabled = !code.path || code.text === null;
    $('#code-reference').textContent = code.from ? `Henvis til ${lineText()}` : 'Henvis i beskeden';
    $('#code-reference').title = 'Tilføjer filens sti til din næste besked. AI’en læser selv filen. Du ser henvisningen i Før du sender.';
  }
  function markLines() {
    for (const row of document.querySelectorAll('#code-lines .code-line.is-marked')) row.classList.remove('is-marked');
    if (!code.from) return;
    for (let line = code.from; line <= code.to; line++) document.querySelector(`#code-lines [data-line="${line}"]`)?.classList.add('is-marked');
  }
  function renderCode(file, { from = null, to = null } = {}) {
    code.path = file.path; code.text = file.kind === 'text' ? file.text : null;
    const lines = code.text === null ? [] : code.text.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 1 && lines.at(-1) === '') lines.pop();
    code.from = from && from <= lines.length ? from : null; code.to = code.from ? Math.min(to || from, lines.length) : null;
    $('#code-current').textContent = file.path; $('#code-title').textContent = file.path;
    const changed = code.files?.find(item => item.path === file.path)?.changed;
    $('#code-info').textContent = `${file.kind === 'image' ? `Billede · ${Math.ceil(file.size / 1024)} kB` : `${plural(lines.length, 'linje', 'linjer')}${changed ? ` · ${changeText[changed] || 'Ændret'} i denne samtale` : ''}`} · Skrivebeskyttet`;
    $('#code-info').title = 'Du kan se filen her, men ikke ændre den. Bed AI’en om ændringer i samtalen.';
    $('#code-image').hidden = file.kind !== 'image'; $('#code-lines').hidden = file.kind === 'image';
    if (file.kind === 'image') { $('#code-image').src = file.dataURL; $('#code-image').alt = `Billedet ${file.path}`; $('#code-lines').replaceChildren(); }
    else {
      const limit = 10000, rows = [];
      for (let index = 0; index < Math.min(lines.length, limit); index++) {
        const row = node('div', undefined, 'code-line'); row.dataset.line = String(index + 1);
        row.append(node('span', String(index + 1), 'code-ln'), node('span', lines[index] || ' ', 'code-text'));
        rows.push(row);
      }
      if (lines.length > limit) rows.push(node('p', `Viser de første ${limit.toLocaleString('da-DK')} linjer af ${lines.length.toLocaleString('da-DK')}.`, 'hint'));
      // Koden vises som tekst: textContent i hver række, aldrig som HTML.
      $('#code-lines').replaceChildren(...rows); $('#code-lines').setAttribute('aria-label', `Indholdet af ${file.path}, skrivebeskyttet`);
    }
    $('#code-file').hidden = false; $('#code-empty').hidden = true; $('#code-error').hidden = true; $('#code-notice').hidden = true;
    for (const button of document.querySelectorAll('#code-files .code-file')) button.toggleAttribute('aria-current', button.dataset.path === file.path);
    markLines(); updateReferenceButton();
    requestAnimationFrame(() => {
      const target = code.from && document.querySelector(`#code-lines [data-line="${code.from}"]`);
      if (target) target.scrollIntoView({ block: 'center' }); else $('#code-lines').scrollTop = 0;
    });
  }
  // Et klik på et linjenummer vælger linjen; Skift-klik udvider valget. Hele filen kan altid henvises til med tastaturet.
  $('#code-lines').addEventListener('click', event => {
    const row = event.target.closest('.code-ln')?.parentElement; if (!row) return;
    const line = Number(row.dataset.line);
    if (event.shiftKey && code.anchor) { code.from = Math.min(code.anchor, line); code.to = Math.max(code.anchor, line); }
    else if (code.from === line && code.to === line) { code.from = code.to = code.anchor = null; }
    else { code.from = code.to = code.anchor = line; }
    markLines(); updateReferenceButton();
  });
  async function openFile(file, { line = null, to = null, focus = true } = {}) {
    show('code');
    const root = current?.workspaceRoot || current?.root;
    if (!code.files || code.stale) await action(loadCodeList);
    try {
      const data = await call('codeRead', file);
      if ((current?.workspaceRoot || current?.root) !== root) return;
      renderCode(data, { from: line, to });
      // I et smalt panel lukker fillisten, så koden får pladsen. Bredt står den ved siden af.
      if ($('#work-surface').clientWidth < 640) browser(false);
      if (focus) $('#code-title').focus();
    } catch (error) {
      if ((current?.workspaceRoot || current?.root) !== root) return;
      code.path = ''; code.text = null; updateReferenceButton();
      $('#code-file').hidden = true; $('#code-empty').hidden = true; $('#code-error').hidden = false;
      $('#code-error').textContent = `${file}: ${error.message}`; $('#code-current').textContent = 'Vælg en fil';
      if (focus) $('#code-error').focus();
    }
  }
  // Når brugeren vender tilbage til en fil, der er ændret siden, vises en besked i stedet for at skifte indholdet under dem.
  async function checkCodeFile() {
    if (!code.path || code.text === null) return;
    const root = current?.workspaceRoot || current?.root, file = code.path;
    try { const data = await call('codeRead', file); if ((current?.workspaceRoot || current?.root) === root && code.path === file && data.text !== code.text) $('#code-notice').hidden = false; }
    catch { if ((current?.workspaceRoot || current?.root) === root && code.path === file) $('#code-notice').hidden = false; }
  }
  $('#code-reload').onclick = () => openFile(code.path, { line: code.from, to: code.to });

  // ---------- Filhenvisninger til AI'en ----------
  // Målet fra forhåndsvisningen står først: ét element ad gangen, valgt med Ret i siden.
  let references = [], target = null;
  const referenceLabel = ref => ref.from ? `${ref.path} · ${ref.from === ref.to ? `linje ${ref.from}` : `linje ${ref.from}–${ref.to}`}` : ref.path;
  function renderReferences() {
    $('#composer-refs').hidden = !references.length && !target;
    const chips = references.map((ref, index) => {
      const chip = node('span', undefined, 'ref-chip'), remove = node('button', '×'); remove.type = 'button';
      remove.setAttribute('aria-label', `Fjern henvisningen til ${referenceLabel(ref)}`); remove.title = 'Fjern henvisningen';
      remove.onclick = () => { references.splice(index, 1); renderReferences(); $('#prompt').focus(); };
      chip.append(node('span', referenceLabel(ref)), remove); return chip;
    });
    if (target) {
      const chip = node('span', undefined, 'ref-chip target-chip'), remove = node('button', '×'); remove.type = 'button';
      remove.setAttribute('aria-label', `Fjern målet ${target.label}`); remove.title = 'Fjern målet';
      remove.onclick = () => { target = null; renderReferences(); $('#prompt').focus(); };
      chip.append(node('span', `Mål: ${target.label}`), remove); chips.unshift(chip);
    }
    $('#composer-refs').replaceChildren(...chips);
    updateWorkMode();
  }
  $('#code-reference').onclick = () => {
    if (!code.path || code.text === null) return;
    const ref = { path: code.path, ...(code.from ? { from: code.from, to: code.to } : {}) };
    if (references.some(item => item.path === ref.path && item.from === ref.from && item.to === ref.to)) { message('Henvisningen er allerede med i din besked.'); $('#prompt').focus(); return; }
    if (references.length >= 10) { message('Du kan henvise til højst 10 filer i én besked.', true); return; }
    references.push(ref); renderReferences(); $('#prompt').focus();
  };

  // ---------- Filhenvisninger i samtalen ----------
  // En sti i AI'ens svar bliver et link, når filen findes i projektet og kan vises. Andet forbliver almindelig tekst.
  const pathPattern = /(?:\/|[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,10}(?::\d+(?:[-–]\d+)?)?/g;
  function resolve(text) {
    const match = /^(.+?)(?::(\d+)(?:[-–](\d+))?)?$/.exec(text.trim()); if (!match || !code.files) return null;
    let file = match[1].replace(/^\.\//, '');
    const root = current?.workspaceRoot || current?.root;
    if (root && file.startsWith(root + '/')) file = file.slice(root.length + 1);
    if (!code.index.has(file)) file = !file.includes('/') ? code.names.get(file) : null;
    if (!file) return null;
    return { path: file, line: match[2] ? Number(match[2]) : null, to: match[3] ? Number(match[3]) : null };
  }
  function referenceButton(target, content) {
    const button = node('button', undefined, 'file-ref'); button.type = 'button';
    button.dataset.path = target.path; if (target.line) button.dataset.line = String(target.line);
    button.title = `Åbn ${target.path}${target.line ? ` ved linje ${target.line}` : ''} under Kode`;
    button.append(content);
    return button;
  }
  function linkify(container) {
    if (!container || !code.files) return;
    for (const el of container.querySelectorAll('code')) {
      if (el.closest('.file-ref, pre')) continue;
      const target = resolve(el.textContent); if (!target) continue;
      const button = referenceButton(target, el.cloneNode(true)); el.replaceWith(button);
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, { acceptNode: textNode => textNode.parentElement.closest('.file-ref, code, pre, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    for (const textNode of texts) {
      const value = textNode.nodeValue; let last = 0, changed = false; const parts = [];
      for (const match of value.matchAll(pathPattern)) {
        const raw = match[0].replace(/[.,:;]+$/, ''), target = resolve(raw);
        if (!target) continue;
        parts.push(value.slice(last, match.index), referenceButton(target, document.createTextNode(raw))); last = match.index + raw.length; changed = true;
      }
      if (changed) { parts.push(value.slice(last)); textNode.replaceWith(...parts.filter(part => part !== '')); }
    }
  }
  function linkifyAll() { for (const el of document.querySelectorAll('#messages .assistant, #approvals .action-target, #run-review .review-files, #activity-list .activity-target')) linkify(el); }
  document.addEventListener('click', event => {
    const button = event.target.closest('.file-ref'); if (!button) return;
    event.preventDefault();
    if (button.dataset.change) showChange(button.dataset.change, button.dataset.path);
    else openFile(button.dataset.path, { line: button.dataset.line ? Number(button.dataset.line) : null });
  });

  // ---------- Aktivitet ----------
  const activity = { entries: new Map(), unseen: false, toBottom: true, timer: null, running: false, waiting: 0 };
  const stateText = { pending: 'Venter', running: 'I gang', completed: 'Afsluttet', error: 'Mislykkedes', waiting: 'Venter på dig', allowed: 'Du tillod den', 'allowed-task': 'Du tillod filændringer i projektet for resten af opgaven', auto: 'Tilladt, fordi du tillod filændringer for opgaven', rejected: 'Du afviste den', corrected: 'Du afviste den med en besked, og AI’en fortsatte', answered: 'Besvaret', expired: 'Ikke besvaret, fordi opgaven stoppede', stopped: 'Stoppet' };
  function entryState(entry) {
    // Rækker, hvor titlen allerede siger, hvad der skete, får kun en status, når noget er i gang eller fejlede.
    if (['session', 'checkpoint', 'restore', 'preview', 'stop', 'result', 'error', 'plan', 'check', 'edit'].includes(entry.kind) && !['running', 'error'].includes(entry.status)) return '';
    if (['result', 'error'].includes(entry.kind)) return '';
    const parts = [stateText[entry.status] || entry.status || ''];
    if (['approval', 'question'].includes(entry.kind)) {
      if (entry.status === 'waiting') parts.push(`i ${duration(Date.now() - entry.started) || 'under 1 s'}`);
      else if (entry.ended && entry.started && entry.status !== 'auto') parts.push(`efter ${duration(entry.ended - entry.started)}`);
    } else if (entry.kind === 'tool' && entry.started && entry.ended) parts.push(duration(entry.ended - entry.started));
    else if (entry.kind === 'run' && entry.started && entry.ended) parts.push(`efter ${duration(entry.ended - entry.started)}`);
    if (Number.isInteger(entry.exit)) parts.push(`afslutningskode ${entry.exit}`);
    return parts.filter(Boolean).join(' · ');
  }
  function renderEntry(entry) {
    const item = node('li', undefined, `activity-entry kind-${entry.kind} status-${entry.status || 'none'}`); item.dataset.id = entry.id;
    const body = node('div', undefined, 'activity-body');
    const head = node('p', undefined, 'activity-head'); head.append(node('strong', entry.title, 'activity-title'));
    if (entry.target && entry.kind === 'run') head.append(' ', node('span', `»${entry.target}«`, 'activity-quote'));
    else if (entry.target) {
      const target = node('span', undefined, 'activity-target');
      const resolved = ['tool', 'approval', 'edit'].includes(entry.kind) ? resolve(entry.target) : null;
      target.append(resolved ? referenceButton(resolved, document.createTextNode(entry.target)) : entry.target);
      head.append(' ', target);
    }
    body.append(head);
    const state = entryState(entry); if (state) body.append(node('p', state, 'activity-state'));
    if (entry.detail) body.append(node('p', entry.detail, 'activity-detail'));
    if (entry.error) body.append(node('p', entry.error, 'activity-error'));
    if (entry.output) { const fold = node('details', undefined, 'activity-output'); fold.append(node('summary', 'Vis output'), node('pre', entry.output)); body.append(fold); }
    item.append(node('time', clock(entry.at), 'activity-time'), body);
    item.querySelector('time').dateTime = new Date(entry.at).toISOString();
    return item;
  }
  function putEntry(entry) {
    activity.entries.set(entry.id, entry);
    const list = $('#activity-list'), scroll = $('#activity-scroll');
    const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
    const existing = list.querySelector(`[data-id="${CSS.escape(entry.id)}"]`);
    // En række, der er foldet ud, beholder sin fold, når den opdateres.
    const open = existing?.querySelector('details')?.open;
    const item = renderEntry(entry); if (open) item.querySelector('details').open = true;
    if (existing) existing.replaceWith(item); else list.append(item);
    list.hidden = false; $('#activity-empty').hidden = true;
    if (active === 'activity' && atBottom && !existing) scroll.scrollTop = scroll.scrollHeight;
    if (active !== 'activity' && !existing) { activity.unseen = true; activity.toBottom = true; }
    updateActivityStatus(); updateActivityBadge();
  }
  function updateActivityStatus() {
    const waiting = [...activity.entries.values()].filter(entry => entry.status === 'waiting');
    activity.waiting = waiting.length;
    $('#activity-status').textContent = waiting.length ? `Venter på dig: ${waiting[0].title.replace(/^Godkendelse: /, '')}` : activity.running ? 'AI’en arbejder' : 'Ingen opgave i gang';
    clearInterval(activity.timer);
    // Ventetiden på en godkendelse tælles op hvert sekund, så længe den venter.
    activity.timer = waiting.length ? setInterval(() => { for (const entry of waiting) { const row = $('#activity-list').querySelector(`[data-id="${CSS.escape(entry.id)}"] .activity-state`); if (row) row.textContent = entryState(entry); } }, 1000) : null;
  }
  function updateActivityBadge() {
    const el = $('#activity-badge');
    el.hidden = !(activity.waiting > 0 || activity.running || (activity.unseen && active !== 'activity'));
    el.classList.toggle('waiting', activity.waiting > 0); el.classList.toggle('running', activity.running && !activity.waiting);
    el.replaceChildren(visuallyHidden(activity.waiting ? 'venter på dig' : activity.running ? 'AI’en arbejder' : 'ny aktivitet'));
  }
  async function loadActivity() {
    const root = current?.workspaceRoot || current?.root;
    const entries = await call('activityList'); if ((current?.workspaceRoot || current?.root) !== root) return;
    activity.entries.clear(); $('#activity-list').replaceChildren(); $('#activity-list').hidden = true; $('#activity-empty').hidden = false;
    for (const entry of entries) putEntry(entry);
    activity.unseen = false; activity.toBottom = true; updateActivityBadge();
  }

  // ---------- Sidepanel ----------
  // Sidepanelet kan foldes sammen til en smal liste med ikoner. I et smalt vindue eller med stor tekst er det foldet sammen
  // og lægger sig oven på indholdet, når det foldes ud.
  const sidebarKey = 'aura.sidebar.v1', narrow = window.matchMedia('(max-width: 760px)');
  let collapsed = false; try { collapsed = localStorage.getItem(sidebarKey) === 'collapsed'; } catch {}
  let overlay = false;
  function applySidebar() {
    const folded = narrow.matches ? !overlay : collapsed;
    document.body.classList.toggle('sidebar-collapsed', folded); document.body.classList.toggle('sidebar-overlay', narrow.matches && overlay);
    $('#sidebar-toggle').setAttribute('aria-expanded', String(!folded));
    const label = folded ? 'Vis sidepanelet' : 'Skjul sidepanelet';
    $('#sidebar-toggle').setAttribute('aria-label', label); $('#sidebar-toggle').title = label;
  }
  $('#sidebar-toggle').onclick = () => {
    if (narrow.matches) overlay = !overlay;
    else { collapsed = !collapsed; try { localStorage.setItem(sidebarKey, collapsed ? 'collapsed' : 'open'); } catch {} }
    applySidebar();
  };
  narrow.addEventListener('change', () => { overlay = false; applySidebar(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && overlay) { overlay = false; applySidebar(); $('#sidebar-toggle').focus(); } });
  document.addEventListener('pointerdown', event => { if (overlay && !event.target.closest('#sidebar')) { overlay = false; applySidebar(); } });
  $('#sidebar').addEventListener('click', event => { if (overlay && event.target.closest('nav button, #project-list .chat-row, #project-list .project-name, #tools-button, #intro-button')) { overlay = false; applySidebar(); } });
  applySidebar();

  // ---------- Hændelser ----------
  // Fanerne viser den åbne samtale. Hændelser fra en samtale i baggrunden venter, til den åbnes.
  const mine = event => !event.chat || event.chat === viewFor().id;
  window.harness.onEvent(event => {
    if (event.type === 'files.written' && event.root === current?.root && mine(event)) {
      code.stale = true; changes.stale = true;
      badge('changes', event.files.length, 'ændrede filer');
      action(async () => { await loadCodeList(); if (active === 'code') await checkCodeFile(); });
      if (active === 'changes' && changes.mode === 'session') { if (!changes.data?.tasks?.length && !changes.file) action(() => loadChanges()); else $('#changes-notice').hidden = false; }
    }
    if (event.type === 'activity' && event.root === current?.root && mine(event)) putEntry(event.entry);
    if (event.type === 'run.status' && mine(event)) {
      activity.running = ['starting', 'working'].includes(event.status); updateActivityStatus(); updateActivityBadge();
      if (!activity.running) staleOverview();
    }
    if (event.type === 'changes.updated' && event.root === current?.root && !mine(event)) { code.stale = true; return; }
    if (event.type === 'changes.updated' && event.root === current?.root) {
      changes.latest = event.task; code.stale = true;
      if (active === 'changes' && changes.data && changes.mode === 'session') { changes.stale = true; $('#changes-notice').hidden = false; }
      else if (changes.mode === 'versions') { changes.stale = true; changes.sessionSource = event.task; }
      else { changes.stale = true; changes.source = event.task; changes.file = ''; }
      if (active === 'code') action(checkCodeFile);
    }
    if (event.type === 'run.review' && mine(event)) staleOverview();
    if (event.type === 'run.review' && !mine(event)) { action(async () => { await loadCodeList(); linkifyAll(); }); return; }
    if (event.type === 'run.review' && event.files?.length && active !== 'changes') badge('changes', event.files.length, event.files.length === 1 ? 'ændret fil' : 'ændrede filer');
    if (event.type === 'run.review') action(async () => { await loadCodeList(); linkifyAll(); });
    if (event.type === 'plan.ready' && mine(event) && active !== 'plan') { $('#plan-badge').hidden = false; $('#plan-badge').replaceChildren(visuallyHidden('ny plan')); }
  });
  // Overblikket udledes af projektets filer: det er gammelt ved projektskift, samtaleskift og efter en afsluttet opgave.
  function staleOverview() { if (active === 'overview') { window.systemOverview?.stale(); window.systemOverview?.show(); } else window.systemOverview?.invalidate(); }
  // Et nyt projekt starter i Forhåndsvisning med tomme faner.
  async function onProject() {
    show('preview'); window.systemOverview?.invalidate(); $('#plan-badge').hidden = true;
    Object.assign(changes, { data: null, source: '', file: '', stale: true, latest: '', mode: 'session', sessionSource: '', versionView: null }); badge('changes', 0); applyMode(); window.versions?.reset();
    $('#changes-source').replaceChildren(option('', 'Ingen opgaver endnu')); $('#changes-source').disabled = true;
    $('#changes-overview').hidden = true; $('#changes-diff').hidden = true; $('#changes-empty').hidden = false; $('#changes-notice').hidden = true;
    Object.assign(code, { files: null, index: new Set(), names: new Map(), stale: true, path: '', text: null, from: null, to: null, anchor: null });
    $('#code-file').hidden = true; $('#code-error').hidden = true; $('#code-empty').hidden = false; $('#code-notice').hidden = true; $('#code-current').textContent = 'Vælg en fil'; $('#code-search').value = ''; $('#code-files').replaceChildren(); browser(true); updateReferenceButton();
    references = []; target = null; renderReferences();
    activity.running = running;
    // Fillisten først, så stier i den gemte aktivitet kan blive til links.
    await action(loadCodeList); await action(loadActivity);
  }
  // En anden samtale åbnes: Ændringer under Denne samtale og Aktivitet følger den. Kode og Versioner gælder projektet.
  async function onChat() {
    staleOverview();
    $('#plan-badge').hidden = true; badge('changes', 0);
    Object.assign(changes, { data: null, file: '', stale: true, latest: '', sessionSource: '' });
    if (changes.mode === 'session') { changes.source = ''; $('#changes-source').replaceChildren(option('', 'Ingen opgaver endnu')); $('#changes-source').disabled = true; $('#changes-overview').hidden = true; $('#changes-diff').hidden = true; $('#changes-empty').hidden = false; $('#changes-notice').hidden = true; if (active === 'changes') await action(() => loadChanges()); }
    references = []; target = null; renderReferences();
    code.files = null; code.stale = true; await action(loadCodeList);
    if (code.path) { const selected = active; await openFile(code.path); show(selected); }
    activity.running = running; await action(loadActivity); updateActivityStatus();
  }
  window.workspace = { show, onProject, onChat, showVersions, showVersion, openFile, showChange, linkify, linkifyAll, references: () => references.map(ref => ({ ...ref })), clearReferences: () => { references = []; target = null; renderReferences(); }, setTarget: value => { target = value ? { id: value.id, label: value.label } : null; renderReferences(); }, target: () => target && { ...target }, get active() { return active; } };
})();
