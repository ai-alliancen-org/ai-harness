// Godkendelser i samtalen: hvad AI'en vil gøre, hvorfor, og hvad det betyder, hvis du tillader det.
// Tekniske detaljer er foldet sammen. Afvis stopper opgaven; Afvis med en besked lader AI'en fortsætte med din besked.
(() => {
  const view = window.ApprovalView;
  const kinds = { edit: 'Filændring', bash: 'Kommando', webfetch: 'Hjemmeside', external_directory: 'Adgang uden for projektet', grep: 'Søgning i filer', doom_loop: 'Gentagelse' };
  // Gentagelsesvagten: hvilket kald AI'en gentager, i almindeligt dansk.
  const repeatedTools = { read: 'Læse en fil', grep: 'Søge i filer', glob: 'Finde filer', list: 'Se en mappe', bash: 'Køre en kommando', edit: 'Ændre en fil', write: 'Skrive en fil', apply_patch: 'Ændre filer', webfetch: 'Åbne en hjemmeside' };
  function repeated(p, root) {
    const tool = typeof p.metadata?.tool === 'string' ? p.metadata.tool : (p.patterns || [])[0] || '';
    const input = p.metadata?.input || {};
    let detail = tool === 'bash' ? input.command : tool === 'webfetch' ? input.url : ['grep', 'glob'].includes(tool) ? input.pattern : input.filePath || input.path;
    detail = typeof detail === 'string' ? detail : '';
    if (detail && root && (detail.startsWith(root + '/') || detail.startsWith(root + '\\'))) detail = detail.slice(root.length + 1).replaceAll('\\', '/');
    const name = repeatedTools[tool] || tool;
    return detail ? `${name}: ${detail.slice(0, 200)}` : name;
  }
  // Målet vises som en sti i projektet, når det er muligt. OpenCode regner mønstre ud fra Git-roden eller fra computerens rod.
  function target(p) {
    const file = typeof p.metadata?.filepath === 'string' ? p.metadata.filepath : '';
    const root = p.workspaceRoot || current?.workspaceRoot || current?.root || '';
    if (p.policy?.match?.targets) {
      // Politikken giver filerne relativt til projektet. metadata.filepath kan være relativ til Git-roden (apply_patch), så den skæres der aldrig i.
      if (p.policy.projectFile) return { projectFile: true, text: Array.isArray(p.policy.files) && p.policy.files.length ? p.policy.files.join(', ') : p.policy.target };
      return { projectFile: false, text: p.policy.target };
    }
    if (p.permission === 'edit' && file && root && (file.startsWith(root + '/') || file.startsWith(root + '\\'))) return { projectFile: true, text: file.slice(root.length + 1).replaceAll('\\', '/') };
    if (p.permission === 'doom_loop') return { text: repeated(p, root) };
    // En søgning, hvis sti Aura ikke kunne afgrænse: stien står først, så kortet ikke kun viser søgeordet (N:A-7).
    if (p.permission === 'grep') {
      const where = [p.metadata?.path, p.toolInput?.path].find(value => typeof value === 'string' && value), word = p.metadata?.pattern || (p.patterns || []).join('\n');
      return { text: where ? `${where} · søgeord: ${word}` : word };
    }
    if (p.permission === 'bash') return { text: p.toolInput?.command || p.metadata?.command || (p.patterns || []).join('\n') };
    if (p.permission === 'webfetch') return { text: p.metadata?.url || p.toolInput?.url || (p.patterns || []).join('\n') };
    return { text: (p.patterns || []).join('\n') || file };
  }
  function explanation(p, where) {
    const texts = {
      edit: where.projectFile ? ['Må AI’en ændre filer i projektet?', 'Filen ændres på din computer. Du kan fortryde det med en version.'] : ['Må AI’en ændre en fil uden for projektet?', 'Filen ligger ikke i projektmappen. Tillad kun, hvis du ved, hvorfor den skal ændres.'],
      bash: ['Må AI’en køre en kommando?', 'Kommandoen kører med dine rettigheder. Tillad kun, hvis du forstår, hvad den gør.'],
      webfetch: ['Må AI’en åbne en hjemmeside?', 'Hjemmesiden får besked om besøget, og indholdet sendes videre til din AI.'],
      external_directory: window.ApprovalView.directoryTitle(p),
      // Søgningens mål afgør titlen: projektet, en mappe uden for projektet eller et resultat, AI-motoren selv har gemt. Kunne Aura ikke
      // afgrænse stien (ingen match), lover titlen ikke projektets filer (N:A-7).
      grep: p.policy?.toolOutput ? ['Må AI’en søge i et gemt resultat?', 'AI-motoren har gemt et langt resultat fra en tidligere handling i Auras egen mappe. Det, AI’en finder, sendes videre til din AI.']
        : !p.policy?.match ? ['Må AI’en søge i filer?', 'Aura kan ikke se sikkert, om søgningen bliver i projektet eller undgår beskyttede filer. Det, AI’en finder, sendes videre til din AI.']
        : p.policy.projectSearch !== true ? ['Må AI’en søge i filer uden for projektet?', 'Søgningen sker uden for projektet. Det, AI’en finder, sendes videre til din AI.']
        : ['Må AI’en søge i projektets filer?', 'Det, AI’en finder, sendes videre til din AI.'],
      // Gentagelsesvagten (vises efter tre automatiske svar i samme opgave, core/chat-session.cjs).
      doom_loop: ['AI’en gentager det samme. Skal den fortsætte?', 'AI’en har gjort præcis det samme flere gange i træk og prøver igen. Stop opgaven, hvis den ser ud til at sidde fast.']
    };
    const [title, effect] = texts[p.permission] || ['Gennemgå denne handling', 'Læs de tekniske detaljer, før du tillader den.'];
    return { title, effect };
  }
  // Hele ændringen kan læses, før der svares: 400 rækker ad gangen med Vis N linjer mere. Efter forslag i #35.
  function diffRows(diff, file = '') {
    const container = node('div'), box = node('div', undefined, 'diff approval-diff');
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', file ? `Foreslået ændring i ${file}` : 'Foreslået ændring'); box.tabIndex = 0;
    const status = node('p', '', 'hint diff-page-status'), more = node('button', '', 'text-button');
    status.setAttribute('role', 'status'); more.type = 'button';
    let shown = 0;
    function appendRows() {
      const scroll = box.scrollTop, page = view.diffPage(diff.rows, shown);
      for (const row of diff.rows.slice(shown, page.end)) {
        if (row.type === 'gap') { box.append(node('div', '⋯', 'diff-gap')); continue; }
        const kind = row.type === '+' ? 'add' : row.type === '-' ? 'del' : 'same';
        const line = node('div', undefined, `diff-row ${kind}`), sign = node('span', row.type === ' ' ? '' : row.type === '+' ? '+' : '−', 'sign'); sign.setAttribute('aria-hidden', 'true');
        const text = node('span', undefined, 'code'); if (kind !== 'same') text.append(node('span', kind === 'add' ? 'Tilføjet: ' : 'Fjernet: ', 'visually-hidden')); text.append(row.text || ' ');
        line.append(node('span', row.old ?? '', 'ln'), node('span', row.new ?? '', 'ln'), sign, text); box.append(line);
      }
      shown = page.end; box.scrollTop = scroll;
      status.textContent = page.status; more.textContent = page.more; more.hidden = !page.more;
      // Når alt er vist, flyttes fokus fra den forsvundne knap til ændringen.
      if (more.hidden && document.activeElement === more) box.focus({ preventScroll: true });
    }
    more.onclick = appendRows; appendRows(); container.append(box);
    if (!more.hidden) container.append(status, more);
    return container;
  }
  const pending = new WeakMap(), receipts = new WeakMap();
  const groups = v => { if (!pending.has(v)) pending.set(v, new Map()); return pending.get(v); };
  function record(v, key, data) {
    let state = receipts.get(v);
    if (!state || state.run !== v.runStartedAt) { state = { run: v.runStartedAt, records: new Map() }; receipts.set(v, state); }
    let entry = state.records.get(key);
    if (!entry || !entry.element.parentNode) { entry = { count: 0, element: node('p', '', 'chat-message answer-record') }; state.records.set(key, entry); v.log.append(entry.element); }
    entry.count += data.count || 1; entry.element.textContent = view.receiptText({ ...data, count: entry.count });
  }
  function removeRequest(v, id) {
    for (const [key, group] of groups(v)) if (group.requests.delete(id)) {
      doneWaiting(id, v);
      if (!group.requests.size) { group.box.remove(); groups(v).delete(key); }
      else {
        // En besvaret fil må ikke blive stående som målet for de resterende valg.
        const remaining = [...group.requests.values()]; group.box.remove(); groups(v).delete(key);
        for (const request of remaining) show(request, v);
      }
    }
  }
  // v er samtalens visning. Kortet står i den samtale, hvis AI spurgte, også når en anden samtale er åben.
  function show(p, v = viewFor()) {
    const key = view.groupKey(p), existing = groups(v).get(key);
    if (existing && existing.box.parentNode) {
      if (existing.requests.has(p.id)) return;
      existing.requests.set(p.id, p); existing.count.hidden = false;
      existing.count.textContent = `${existing.requests.size} forespørgsler om samme adgang`;
      const fold = node('details', undefined, 'approval-fold');
      const location = target(p).text;
      fold.append(node('summary', location || 'Se den næste handling'));
      if (p.permission === 'edit' && typeof p.metadata?.diff === 'string') fold.append(diffRows(view.parseUnifiedDiff(p.metadata.diff), target(p).text));
      else fold.append(node('pre', location));
      existing.items.append(fold);
      waitFor(p.id, existing.title, existing.box, v); return;
    }
    const where = target(p), explanationText = explanation(p, where);
    // Gentagelsesvagten: en afvisning stopper opgaven i AI-motoren som en fejl, også med en besked (målt), så kortet har to valg: fortsæt
    // eller stop opgaven. Stop gør det samme som Stop-knappen, og resultatkortet siger «Du stoppede opgaven».
    const loop = p.permission === 'doom_loop';
    // Kortsamlingen (brugerens beslutning 10. november 2026): efter fem kort spørger Aura én gang, om resten af opgaven må fortsætte i
    // projektmappen. Kortet stiller kun det spørgsmål med to valg; ja besvarer også handlingen, der venter. «Nej, spørg hver gang» gør det til
    // et almindeligt kort for handlingen, og hovedprocessen spørger ikke igen i opgaven.
    const collect = !loop && p.policy?.collect ? view.collectScope(p.policy.collect) : null;
    const actionTitle = p.isolated && where.projectFile ? 'Må AI’en ændre filer i samtalens kopi?' : explanationText.title;
    const title = collect ? 'Må resten af opgaven fortsætte i projektmappen?' : actionTitle;
    const effect = p.isolated && where.projectFile ? 'Kun kopien ændres. Du gennemgår ændringerne, før de flettes ind i projektet.' : explanationText.effect;
    const box = node('section', undefined, 'approval'); box.dataset.id = p.id; if (collect) box.dataset.collect = 'true';
    box.append(node('p', `Godkendelse · ${kinds[p.permission] || 'Handling'}`, 'approval-kind'), node('strong', title, 'approval-title'));
    const count = node('p', '', 'hint'), items = node('div'); count.hidden = true;
    const group = { box, count, items, title, requests: new Map([[p.id, p]]), busy: false }; groups(v).set(key, group);
    box.append(count);
    const facts = node('dl', undefined, 'approval-facts');
    const fact = (label, ...content) => { const dd = node('dd'); dd.append(...content); facts.append(node('dt', label), dd); return dd; };
    if (collect) { fact('Hvis du siger ja', `AI’en må ${collect.covered} uden at spørge resten af opgaven. Det, der venter nu, godkendes også.`); fact('Spørger stadig', collect.asks); }
    // Hvad: den konkrete fil, kommando eller adresse og omfanget af ændringen. På kortet om resten af opgaven er det handlingen, der venter.
    const diff = p.permission === 'edit' && typeof p.metadata?.diff === 'string' ? view.parseUnifiedDiff(p.metadata.diff) : null;
    if (where.text) {
      const what = node(p.permission === 'bash' ? 'code' : 'span', where.text, 'action-target');
      const dd = fact(collect ? 'Venter nu' : 'Hvad', what);
      if (diff) dd.append(node('span', diff.created ? ` · ny fil med ${diff.added} ${diff.added === 1 ? 'linje' : 'linjer'}` : !diff.added && !diff.removed ? ' · ingen ændring i indholdet' : ` · ${diff.added} ${diff.added === 1 ? 'linje' : 'linjer'} tilføjet, ${diff.removed} fjernet`, 'approval-scope-text'));
      if (p.permission === 'bash' && p.toolInput?.workdir && current?.root && p.toolInput.workdir !== current.root) dd.append(node('span', ` · i mappen ${p.toolInput.workdir.startsWith(current.root + '/') ? p.toolInput.workdir.slice(current.root.length + 1) : p.toolInput.workdir}`, 'approval-scope-text'));
      if (p.permission === 'webfetch') { try { what.textContent = new URL(where.text).hostname; dd.append(node('span', ` · ${where.text}`, 'approval-scope-text')); } catch {} }
      window.workspace?.linkify(what);
    }
    // Hvorfor: AI'ens egen begrundelse, markeret som AI'ens.
    const reason = p.toolInput?.description || p.metadata?.description;
    if (reason && !collect) fact('Hvorfor', node('span', `AI’ens begrundelse: ${reason}`));
    // Hvis du tillader: konsekvensen og for kommandoer et gæt på, hvad den gør.
    const effectDd = collect ? null : fact(loop ? 'Hvis du fortsætter' : 'Hvis du tillader', effect);
    if (p.permission === 'bash' && !collect) {
      const guesses = view.commandHints(where.text);
      if (guesses.length) { const list = node('ul', undefined, 'approval-hints'); for (const guess of guesses) list.append(node('li', guess)); const note = node('span', 'Et gæt ud fra kommandoens tekst, ikke en kontrol.', 'hint'); note.append(info('gættet', 'Kommandoer kan ændre eller slette filer, installere programmer og kontakte andre tjenester med dine rettigheder. Aura læser kun kommandoens tekst og kan ikke se, hvad den faktisk gør.')); effectDd.append(list, note); }
    }
    if (p.permission === 'bash' && p.policy?.unisolated) box.append(node('p', 'Der er ingen isolation: kommandoen kører med dine rettigheder og kan røre alt, du kan.', 'hint approval-scope'));
    box.append(facts, items);
    if (diff && (diff.added || diff.removed)) { const fold = node('details', undefined, 'approval-fold'); fold.append(node('summary', 'Se ændringen'), diffRows(diff, p.permission === 'edit' ? where.text : '')); box.append(fold); }
    const technical = node('details', undefined, 'approval-fold'); technical.append(node('summary', 'Tekniske detaljer'), node('pre', JSON.stringify({ tilladelse: p.permission, mønstre: p.patterns, detaljer: { ...p.metadata, ...(p.metadata?.diff ? { diff: '(se ændringen ovenfor)' } : {}) } }, null, 2))); box.append(technical);
    const projectFile = p.policy?.projectFile === true;
    // En kommando kan ikke huskes (brugerens beslutning 10. november 2026), så «Tillad altid i projektet» står aldrig på et kommandokort.
    const persistable = p.policy?.persistable === true && p.permission !== 'bash';
    const choices = collect ? [['Ja, resten af opgaven', true, 'collect']] : loop ? [['Fortsæt', true]] : [['Tillad én gang', true], ...(persistable ? [['Tillad altid i projektet', true, 'project']] : []), ['Afvis', false]];
    const row = node('div', undefined, 'approval-actions');
    // Handlingen i almindeligt dansk til linjen i samtalen, fx "ændre filer i projektet: public/index.html".
    const label = `${actionTitle.replace(/\?$/, '').replace(/^Må AI’en /, '')}${where.text ? `: ${where.text.split('\n')[0].slice(0, 120)}` : ''}`;
    const reply = (allow, scope, message, folder, unisolated) => action(async () => {
      if (group.busy || !group.requests.size) return;
      group.busy = true;
      const ids = [...group.requests.keys()];
      for (const button of box.querySelectorAll('button')) button.disabled = true;
      try { await call('reply', { id: ids[0], ids, allow, scope, chat: v.id, ...(message ? { message } : {}), ...(folder ? { folder } : {}), ...(unisolated ? { unisolated: true } : {}) }, { root: v.root || current?.root, chat: v.id }); }
      catch (error) { let feedback = box.querySelector('.approval-feedback'); if (!feedback) { feedback = node('p', '', 'approval-feedback'); feedback.setAttribute('role', 'status'); box.append(feedback); } feedback.textContent = error.message; return; }
      finally { group.busy = false; for (const button of box.querySelectorAll('button')) button.disabled = false; }
      for (const id of ids) removeRequest(v, id);
      if (!allow && !message) { v.rejectedThisRun = true; v.lastRejection = { title: actionTitle, target: where.text }; }
      record(v, `${allow}:${scope || 'once'}:${key}:${message || ''}`, { count: ids.length, label: loop ? `gentagelsen (${where.text})` : folder || (collect ? label : p.policy?.label || label), allow, scope, message, ...(collect ? { collect: p.policy.collect } : {}) });
      setStatusDetail(!allow ? (message ? 'AI’en har fået din besked og fortsætter …' : 'Handlingen er afvist. AI’en stopper.') : 'Godkendelsen er sendt. AI’en fortsætter …', v);
    });
    for (const [text, allow, scope] of choices) { const button = node('button', text); button.type = 'button'; button.onclick = () => reply(allow, scope); row.append(button); }
    if (loop) {
      const stop = node('button', 'Stop opgaven'); stop.type = 'button';
      stop.onclick = () => action(async () => {
        for (const button of box.querySelectorAll('button')) button.disabled = true;
        try { await call('stop', { chat: v.id }, { root: v.root || current?.root, chat: v.id }); }
        finally { for (const button of box.querySelectorAll('button')) button.disabled = false; }
      });
      row.append(stop);
    }
    if (collect) {
      const no = node('button', 'Nej, spørg hver gang'); no.type = 'button';
      no.onclick = () => { const requests = [...group.requests.values()]; box.remove(); groups(v).delete(key); for (const request of requests) show({ ...request, policy: { ...request.policy, collect: null } }, v); };
      row.append(no); box.append(row);
      v.approvals.append(box); if (v === viewFor()) box.scrollIntoView({ block: 'nearest' });
      waitFor(p.id, title, box, v); return;
    }
    box.append(row);
    if (persistable) box.append(node('p', projectFile ? 'En gemt tilladelse gælder projektets filer. Du kan slå den fra under Projektets tilladelser.' : `En gemt tilladelse gælder ${p.permission === 'webfetch' ? 'den viste hjemmeside' : 'den viste adgang'}. Du kan fjerne den under Projektets tilladelser.`, 'hint approval-scope'));
    const extra = node('div'); extra.hidden = true;
    const more = node('button', 'Flere valg', 'text-button'); more.type = 'button';
    more.onclick = () => { row.hidden = true; more.hidden = true; extra.hidden = false; };
    const back = node('button', 'Tilbage', 'text-button'); back.type = 'button'; back.onclick = () => { extra.hidden = true; row.hidden = false; more.hidden = false; };
    if (projectFile) { const task = node('button', 'Tillad for denne opgave'); task.type = 'button'; task.onclick = () => reply(true, 'task'); extra.append(task); }
    // «Godkend alt» findes kun, når kommandosandkassen er aktiv, og gælder kun denne samtale (beslutning for beta 2).
    // Teksterne siger præcis, hvad det dækker (approveAllApplies i core/chat-session.cjs): filændringer i projektet og kommandoer, mens
    // sandkassen kører i motoren (på Windows uden isolation: de fleste kommandoer). Hjemmesider, søgning og mapper uden for projektet spørger altid.
    // Kun på kort, «Godkend alt» kan dække (Q:A-4): ikke hjemmesider, mapper uden for projektet, søgning eller beskyttede filer.
    if (p.policy?.approveAllAvailable && !loop && view.approveAllCovers(p.policy)) {
      const all = node('button', 'Godkend alt i denne samtale'); all.type = 'button';
      if (p.policy.approveAllUnisolated) {
        // Uden sandkasse (Windows) vises advarslen hver gang, og valget er et selvstændigt spørgsmål med to knapper.
        all.onclick = () => {
          extra.hidden = true;
          const form = node('div', undefined, 'approval-folder'); form.setAttribute('role', 'group'); form.setAttribute('aria-label', 'Kør uden isolation');
          const allow = node('button', 'Tillad uden isolation', 'primary'); allow.type = 'button'; allow.onclick = () => reply(true, 'chat', undefined, undefined, true);
          const keep = node('button', 'Behold spørgsmål'); keep.type = 'button'; keep.onclick = () => { form.remove(); extra.hidden = false; };
          const details = node('details', undefined, 'approval-fold'); details.append(node('summary', 'Se detaljer'), node('p', 'Windows har ingen isolation af kommandoer i Aura. Aura kontrollerer kun kommandoens tekst for beskyttede navne som .env, nøgler og .git, og for jokertegn, korte filnavne og git-kommandoer, der kan ændre .git. Det er ikke en sikring: navne, der bygges undervejs, fanges ikke. Filer i projektet beskyttes som før. Du kan slå valget fra i statuslinjen under skrivefeltet.', 'hint'));
          form.append(node('strong', 'Vil du køre uden isolation?'), node('p', 'Kommandoerne kører uden isolation med dine rettigheder og kan røre alt, du kan, også uden for projektet. Kun kommandoer, der kan røre beskyttede filer eller Git, spørger igen i denne samtale.', 'hint'), details, allow, keep);
          box.append(form); allow.focus();
        };
        extra.append(all, node('p', 'AI’en må ændre filer i projektet og køre de fleste kommandoer uden isolation uden at spørge igen i denne samtale. Hjemmesider, søgning og mapper uden for projektet spørger stadig. Du bliver bedt om at bekræfte, at der ingen isolation er.', 'hint'));
      } else {
        all.onclick = () => reply(true, 'chat');
        // Kører motoren uden sandkasse, kan den ikke skifte midt i opgaven: kommandoer dækkes først fra næste opgave, hvor sandkassen startes.
        const later = p.policy.commandSandbox !== true ? ' Opgaven er startet uden isolation, så kommandoer spørger stadig resten af opgaven. Fra næste opgave kører de isoleret uden at spørge.' : '';
        extra.append(all, node('p', `AI’en må ændre filer i projektet og køre kommandoer isoleret uden at spørge igen i denne samtale. Hjemmesider, søgning og mapper uden for projektet spørger stadig.${later} Brug det kun, hvis du stoler på opgaven.`, 'hint'));
      }
    }
    if (p.policy?.folder && p.policy.persistable && !projectFile) {
      const folderButton = node('button', 'Tillad en mappe fremover'); folderButton.type = 'button';
      folderButton.onclick = () => {
        extra.hidden = true;
        const form = node('form', undefined, 'approval-folder');
        const heading = node('strong', 'Hvilken mappe må AI’en bruge?'), input = node('input'); input.value = p.policy.folder; input.setAttribute('aria-label', 'Mappe'); input.required = true;
        const notice = node('p', `${p.permission === 'edit' ? 'Filændringer' : 'Denne type filadgang'} tillades i mappen og dens undermapper. Tilladelsen gemmes kun i dette projekt.`, 'hint');
        const parent = node('button', 'Vælg overordnet mappe'); parent.type = 'button'; parent.onclick = () => { const value = input.value.replace(/[\\/]+$/, ''); const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')); if (cut > 0) input.value = value.slice(0, cut); };
        const allow = node('button', 'Tillad mappen', 'primary'); allow.type = 'submit';
        const cancel = node('button', 'Tilbage'); cancel.type = 'button'; cancel.onclick = () => { form.remove(); extra.hidden = false; };
        form.append(heading, input, notice, parent, allow, cancel);
        form.onsubmit = event => { event.preventDefault(); reply(true, 'project', undefined, input.value.trim()); };
        box.append(form); input.focus();
      };
      extra.append(folderButton);
    }
    // Afvis med en besked: AI'en får beskeden og fortsætter i stedet for at stoppe. Ikke ved gentagelsesvagten, hvor enhver afvisning stopper opgaven.
    const other = node('button', 'Afvis med en besked', 'text-button approval-message-link'); other.type = 'button';
    other.onclick = () => {
      extra.hidden = true;
      const form = node('form', undefined, 'approval-message'); const id = `afvis-${p.id}`;
      const text = node('label', 'Hvad skal AI’en gøre i stedet?'); text.htmlFor = id;
      const input = node('textarea'); input.id = id; input.rows = 2; input.maxLength = 2000; input.required = true; input.placeholder = 'Fx Brug ikke en ny pakke. Skriv det i almindelig JavaScript.';
      const send = node('button', 'Afvis og send beskeden', 'primary'); send.type = 'submit';
      form.append(text, input, send); form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) reply(false, undefined, input.value.trim()); };
      const cancel = node('button', 'Tilbage'); cancel.type = 'button'; cancel.onclick = () => { form.remove(); extra.hidden = false; }; form.append(cancel);
      box.append(form); input.focus();
    };
    if (!loop) extra.append(other);
    extra.append(back);
    // Flere valg vises kun, når der er andet end Tilbage bag linket.
    if (extra.querySelectorAll('button').length > 1) box.append(more, extra);
    v.approvals.append(box); if (v === viewFor()) box.scrollIntoView({ block: 'nearest' });
    waitFor(p.id, title, box, v);
  }
  // «Godkend alt» uden isolation skal kunne ses i statuslinjen, så længe det er tændt, og slås fra med den samme knap som ellers.
  const statusNote = () => {
    const status = document.getElementById('approve-all-status'); if (!status) return;
    let note = status.querySelector('.approve-all-unisolated');
    const on = !status.hidden && viewFor()?.approveAllUnisolated === true;
    if (on && !note) { note = node('strong', 'Der er ingen isolation: kommandoerne kører med dine rettigheder og kan røre alt, du kan.', 'approve-all-unisolated'); status.insertBefore(note, status.querySelector('button')); status.insertBefore(document.createTextNode(' '), status.querySelector('button')); }
    if (note) note.hidden = !on;
  };
  const approveAllStatus = document.getElementById('approve-all-status');
  if (approveAllStatus) new MutationObserver(statusNote).observe(approveAllStatus, { attributes: true, attributeFilter: ['hidden'] });
  window.harness.onEvent(event => {
    if (event.type === 'approve-all') { const v = viewFor(event.chat); if (v) v.approveAllUnisolated = event.enabled === true && event.unisolated === true; statusNote(); }
    if (event.type === 'permission.replied') removeRequest(viewFor(event.chat), event.properties?.requestID);
    if (event.type === 'permission.auto') {
      const v = viewFor(event.chat), policy = event.policy;
      record(v, `auto:${policy?.key || event.file || 'projekt'}`, { automatic: true, label: policy?.projectFile ? 'projektets filer' : policy?.label || event.file || 'projektets filer' });
    }
    if (event.type === 'run.status' && !['starting', 'working'].includes(event.status)) pending.delete(viewFor(event.chat));
  });
  window.approvals = { show, refresh: statusNote };
})();
