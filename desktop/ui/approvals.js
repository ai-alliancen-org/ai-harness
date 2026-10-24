// Godkendelser i samtalen: hvad AI'en vil gøre, hvorfor, og hvad det betyder, hvis du tillader det.
// Tekniske detaljer er foldet sammen. Afvis stopper opgaven; Afvis med en besked lader AI'en fortsætte med din besked.
(() => {
  const view = window.ApprovalView;
  const kinds = { edit: 'Filændring', bash: 'Kommando', webfetch: 'Hjemmeside', external_directory: 'Adgang uden for projektet', grep: 'Søgning i filer' };
  // Målet vises som en sti i projektet, når det er muligt. OpenCode regner mønstre ud fra Git-roden eller fra computerens rod.
  function target(p) {
    const file = typeof p.metadata?.filepath === 'string' ? p.metadata.filepath : '';
    const root = p.workspaceRoot || current?.workspaceRoot || current?.root || '';
    if (p.policy?.match?.targets) {
      if (p.policy.projectFile && file && root) return { projectFile: true, text: file.slice(root.length + 1).replaceAll('\\', '/') };
      return { projectFile: false, text: p.policy.target };
    }
    if (p.permission === 'edit' && file && root && (file.startsWith(root + '/') || file.startsWith(root + '\\'))) return { projectFile: true, text: file.slice(root.length + 1).replaceAll('\\', '/') };
    if (p.permission === 'bash') return { text: p.toolInput?.command || p.metadata?.command || (p.patterns || []).join('\n') };
    if (p.permission === 'webfetch') return { text: p.metadata?.url || p.toolInput?.url || (p.patterns || []).join('\n') };
    return { text: (p.patterns || []).join('\n') || file };
  }
  function explanation(p, where) {
    const texts = {
      edit: where.projectFile ? ['Må AI’en ændre filer i projektet?', 'Filen ændres på din computer. Du kan fortryde det med en version.'] : ['Må AI’en ændre en fil uden for projektet?', 'Filen ligger ikke i projektmappen. Tillad kun, hvis du ved, hvorfor den skal ændres.'],
      bash: ['Må AI’en køre en kommando?', 'Kommandoen kører med dine rettigheder. Tillad kun, hvis du forstår, hvad den gør.'],
      webfetch: ['Må AI’en åbne en hjemmeside?', 'Hjemmesiden får besked om besøget, og indholdet sendes videre til din AI.'],
      external_directory: ['Må AI’en se en mappe uden for projektet?', 'Mappen kan indeholde materiale, du ikke vil dele med din AI.'],
      grep: ['Må AI’en søge i projektets filer?', 'Det, AI’en finder, sendes videre til din AI.']
    };
    const [title, effect] = texts[p.permission] || ['Gennemgå denne handling', 'Læs de tekniske detaljer, før du tillader den.'];
    return { title, effect };
  }
  function diffRows(diff) {
    const container = node('div'), box = node('div', undefined, 'diff approval-diff');
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Foreslået filændring'); box.tabIndex = 0;
    const status = node('p', '', 'hint'), more = node('button', 'Vis flere linjer', 'text-button');
    status.setAttribute('role', 'status'); more.type = 'button';
    let shown = 0;
    function appendRows() {
      const scroll = box.scrollTop;
      for (const row of diff.rows.slice(shown, shown + 400)) {
        if (row.type === 'gap') { box.append(node('div', '⋯', 'diff-gap')); continue; }
        const kind = row.type === '+' ? 'add' : row.type === '-' ? 'del' : 'same';
        const line = node('div', undefined, `diff-row ${kind}`), sign = node('span', row.type === ' ' ? '' : row.type === '+' ? '+' : '−', 'sign'); sign.setAttribute('aria-hidden', 'true');
        const text = node('span', undefined, 'code'); if (kind !== 'same') text.append(node('span', kind === 'add' ? 'Tilføjet: ' : 'Fjernet: ', 'visually-hidden')); text.append(row.text || ' ');
        line.append(node('span', row.old ?? '', 'ln'), node('span', row.new ?? '', 'ln'), sign, text); box.append(line);
      }
      shown = Math.min(shown + 400, diff.rows.length); box.scrollTop = scroll;
      status.textContent = `${shown} af ${diff.rows.length} diff-linjer vises.`;
      more.hidden = shown === diff.rows.length;
      if (more.hidden && document.activeElement === more) box.focus({ preventScroll: true });
    }
    more.onclick = appendRows; appendRows(); container.append(box);
    if (diff.rows.length > 400) container.append(status, more);
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
      if (p.permission === 'edit' && typeof p.metadata?.diff === 'string') fold.append(diffRows(view.parseUnifiedDiff(p.metadata.diff)));
      else fold.append(node('pre', location));
      existing.items.append(fold);
      waitFor(p.id, existing.title, existing.box, v); return;
    }
    const where = target(p), explanationText = explanation(p, where);
    const title = p.isolated && where.projectFile ? 'Må AI’en ændre filer i samtalens kopi?' : explanationText.title;
    const effect = p.isolated && where.projectFile ? 'Kun kopien ændres. Du gennemgår ændringerne, før de flettes ind i projektet.' : explanationText.effect;
    const box = node('section', undefined, 'approval'); box.dataset.id = p.id;
    box.append(node('p', `Godkendelse · ${kinds[p.permission] || 'Handling'}`, 'approval-kind'), node('strong', title, 'approval-title'));
    const count = node('p', '', 'hint'), items = node('div'); count.hidden = true;
    const group = { box, count, items, title, requests: new Map([[p.id, p]]), busy: false }; groups(v).set(key, group);
    box.append(count);
    const facts = node('dl', undefined, 'approval-facts');
    const fact = (label, ...content) => { const dd = node('dd'); dd.append(...content); facts.append(node('dt', label), dd); return dd; };
    // Hvad: den konkrete fil, kommando eller adresse og omfanget af ændringen.
    const diff = p.permission === 'edit' && typeof p.metadata?.diff === 'string' ? view.parseUnifiedDiff(p.metadata.diff) : null;
    if (where.text) {
      const what = node(p.permission === 'bash' ? 'code' : 'span', where.text, 'action-target');
      const dd = fact('Hvad', what);
      if (diff) dd.append(node('span', diff.created ? ` · ny fil med ${diff.added} ${diff.added === 1 ? 'linje' : 'linjer'}` : !diff.added && !diff.removed ? ' · ingen ændring i indholdet' : ` · ${diff.added} ${diff.added === 1 ? 'linje' : 'linjer'} tilføjet, ${diff.removed} fjernet`, 'approval-scope-text'));
      if (p.permission === 'bash' && p.toolInput?.workdir && current?.root && p.toolInput.workdir !== current.root) dd.append(node('span', ` · i mappen ${p.toolInput.workdir.startsWith(current.root + '/') ? p.toolInput.workdir.slice(current.root.length + 1) : p.toolInput.workdir}`, 'approval-scope-text'));
      if (p.permission === 'webfetch') { try { what.textContent = new URL(where.text).hostname; dd.append(node('span', ` · ${where.text}`, 'approval-scope-text')); } catch {} }
      window.workspace?.linkify(what);
    }
    // Hvorfor: AI'ens egen begrundelse, markeret som AI'ens.
    const reason = p.toolInput?.description || p.metadata?.description;
    if (reason) fact('Hvorfor', node('span', `AI’ens begrundelse: ${reason}`));
    // Hvis du tillader: konsekvensen og for kommandoer et gæt på, hvad den gør.
    const effectDd = fact('Hvis du tillader', effect);
    if (p.permission === 'bash') {
      const guesses = view.commandHints(where.text);
      if (guesses.length) { const list = node('ul', undefined, 'approval-hints'); for (const guess of guesses) list.append(node('li', guess)); const note = node('span', 'Et gæt ud fra kommandoens tekst, ikke en kontrol.', 'hint'); note.append(info('gættet', 'Kommandoer kan ændre eller slette filer, installere programmer og kontakte andre tjenester med dine rettigheder. Aura læser kun kommandoens tekst og kan ikke se, hvad den faktisk gør.')); effectDd.append(list, note); }
    }
    box.append(facts, items);
    if (diff && (diff.added || diff.removed)) { const fold = node('details', undefined, 'approval-fold'); fold.append(node('summary', 'Se ændringen'), diffRows(diff)); box.append(fold); }
    const technical = node('details', undefined, 'approval-fold'); technical.append(node('summary', 'Tekniske detaljer'), node('pre', JSON.stringify({ tilladelse: p.permission, mønstre: p.patterns, detaljer: { ...p.metadata, ...(p.metadata?.diff ? { diff: '(se ændringen ovenfor)' } : {}) } }, null, 2))); box.append(technical);
    const projectFile = p.policy?.projectFile === true;
    const choices = [['Tillad én gang', true], ...(p.policy?.persistable ? [['Tillad altid i projektet', true, 'project']] : []), ['Afvis', false]];
    const row = node('div', undefined, 'approval-actions');
    // Handlingen i almindeligt dansk til linjen i samtalen, fx "ændre filer i projektet: public/index.html".
    const label = `${title.replace(/\?$/, '').replace(/^Må AI’en /, '')}${where.text ? `: ${where.text.split('\n')[0].slice(0, 120)}` : ''}`;
    const reply = (allow, scope, message, folder) => action(async () => {
      if (group.busy || !group.requests.size) return;
      group.busy = true;
      const ids = [...group.requests.keys()];
      for (const button of box.querySelectorAll('button')) button.disabled = true;
      try { await call('reply', { id: ids[0], ids, allow, scope, chat: v.id, ...(message ? { message } : {}), ...(folder ? { folder } : {}) }, { root: v.root || current?.root, chat: v.id }); }
      catch (error) { let feedback = box.querySelector('.approval-feedback'); if (!feedback) { feedback = node('p', '', 'approval-feedback'); feedback.setAttribute('role', 'status'); box.append(feedback); } feedback.textContent = error.message; return; }
      finally { group.busy = false; for (const button of box.querySelectorAll('button')) button.disabled = false; }
      for (const id of ids) removeRequest(v, id);
      if (!allow && !message) { v.rejectedThisRun = true; v.lastRejection = { title, target: where.text }; }
      record(v, `${allow}:${scope || 'once'}:${key}:${message || ''}`, { count: ids.length, label: folder || p.policy?.label || label, allow, scope, message });
      setStatusDetail(!allow ? (message ? 'AI’en har fået din besked og fortsætter …' : 'Handlingen er afvist. AI’en stopper.') : 'Godkendelsen er sendt. AI’en fortsætter …', v);
    });
    for (const [text, allow, scope] of choices) { const button = node('button', text); button.type = 'button'; button.onclick = () => reply(allow, scope); row.append(button); }
    box.append(row);
    if (p.policy?.persistable) box.append(node('p', projectFile ? 'En gemt tilladelse gælder projektets filer. Du kan slå den fra under Projektets tilladelser.' : `En gemt tilladelse gælder ${p.permission === 'bash' ? 'den viste kommando i den samme mappe' : p.permission === 'webfetch' ? 'den viste hjemmeside' : 'den viste adgang'}. Du kan fjerne den under Projektets tilladelser.`, 'hint approval-scope'));
    const extra = node('div'); extra.hidden = true;
    const more = node('button', 'Flere valg', 'text-button'); more.type = 'button';
    more.onclick = () => { row.hidden = true; more.hidden = true; extra.hidden = false; };
    const back = node('button', 'Tilbage', 'text-button'); back.type = 'button'; back.onclick = () => { extra.hidden = true; row.hidden = false; more.hidden = false; };
    if (projectFile) { const task = node('button', 'Tillad for denne opgave'); task.type = 'button'; task.onclick = () => reply(true, 'task'); extra.append(task); }
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
    // Afvis med en besked: AI'en får beskeden og fortsætter i stedet for at stoppe.
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
    extra.append(other, back); box.append(more, extra);
    v.approvals.append(box); if (v === viewFor()) box.scrollIntoView({ block: 'nearest' });
    waitFor(p.id, title, box, v);
  }
  window.harness.onEvent(event => {
    if (event.type === 'permission.replied') removeRequest(viewFor(event.chat), event.properties?.requestID);
    if (event.type === 'permission.auto') {
      const v = viewFor(event.chat), policy = event.policy;
      record(v, `auto:${policy?.key || event.file || 'projekt'}`, { automatic: true, label: policy?.projectFile ? 'projektets filer' : policy?.label || event.file || 'projektets filer' });
    }
    if (event.type === 'run.status' && !['starting', 'working'].includes(event.status)) pending.delete(viewFor(event.chat));
  });
  window.approvals = { show };
})();
