// Afklaring og plan: AI'ens spørgsmål ét ad gangen med klikbare svar, projektbriefen og planen under fanen Plan.
// Briefen er brugerens egne ord; AI'en skriver aldrig i den. Planen kan rettes direkte eller af AI'en og genåbnes senere.
(() => {
  const view = window.PlanView;
  const sourceText = { idé: 'Din idé', ønske: 'Dit ønske', svar: 'Dit svar', dig: 'Skrevet af dig' };
  const reasonText = { afbrudt: 'opgaven blev afbrudt', stoppet: 'du stoppede opgaven', fejl: 'opgaven fejlede', gendannet: 'filerne er sat tilbage til en tidligere version', ny: 'du bad om en ny plan', fravalgt: 'du valgte at fortsætte samtalen uden at bygge', direkte: 'du bad AI’en arbejde direkte uden plan' };
  let brief = { items: [], updatedAt: null }, lastPlan = null, editing = null, editingPlan = false;

  // ---------- Projektbrief ----------
  function renderBrief() {
    $('#brief-list').replaceChildren(...brief.items.flatMap(item => {
      const dt = node('dt'); dt.append(node('span', item.label, 'brief-label'), node('span', item.edited ? 'Rettet af dig' : sourceText[item.source] || '', 'brief-source'));
      if (item.question) dt.title = `Spørgsmålet var: ${item.question}`;
      const dd = node('dd'); dd.append(node('span', item.value, 'brief-value'));
      const edit = node('button', 'Ret', 'text-button'); edit.type = 'button'; edit.setAttribute('aria-label', `Ret ${item.label}`); edit.onclick = () => openBriefForm(item);
      dd.append(edit); return [dt, dd];
    }));
    $('#brief-empty').hidden = brief.items.length > 0;
  }
  function openBriefForm(item = null) {
    editing = item ? item.id : 'ny';
    $('#brief-label').value = item?.label || ''; $('#brief-value').value = item?.value || '';
    $('#brief-remove').hidden = !item; $('#brief-form').hidden = false; $('#brief-add').hidden = true; $('#brief-feedback').textContent = '';
    (item ? $('#brief-value') : $('#brief-label')).focus();
  }
  function closeBriefForm() { editing = null; $('#brief-form').hidden = true; $('#brief-add').hidden = false; }
  async function saveBrief(items, feedback) {
    const root = current?.root;
    const saved = await call('briefSave', { items, updatedAt: brief.updatedAt });
    if (current?.root !== root) return;
    brief = saved; closeBriefForm(); renderBrief(); renderPlan();
    $('#brief-feedback').textContent = feedback;
  }
  $('#brief-add').onclick = () => openBriefForm();
  $('#brief-cancel').onclick = () => { closeBriefForm(); $('#brief-add').focus(); };
  $('#brief-form').onsubmit = event => {
    event.preventDefault();
    const label = $('#brief-label').value.trim(), value = $('#brief-value').value.trim();
    const items = editing === 'ny' ? [...brief.items, { label, value, source: 'dig' }] : brief.items.map(item => item.id === editing ? { ...item, label, value, edited: item.label !== label || item.value !== value || item.edited === true } : item);
    action(() => saveBrief(items, 'Briefen er gemt. Den gælder fra din næste besked.'));
  };
  $('#brief-remove').onclick = () => action(() => saveBrief(brief.items.filter(item => item.id !== editing), 'Linjen er fjernet fra briefen.'));

  // ---------- Planen ----------
  function planSections(text) {
    const parsed = view.parsePlan(text), parts = [];
    const markdown = body => { const div = node('div'); markdownInto(div, body); return div; };
    if (parsed.intro) parts.push(markdown(parsed.intro));
    for (const section of parsed.sections) {
      // Teknik og data er foldet sammen: brugeren skal ikke kende frameworknavne for at godkende planen.
      if (section.key === 'teknik') { const fold = node('details', undefined, 'plan-part plan-teknik'); fold.append(node('summary', section.title), markdown(section.body)); parts.push(fold); continue; }
      const box = node('section', undefined, `plan-part${section.key ? ` plan-${section.key}` : ''}`);
      box.append(node('h3', section.title), markdown(section.body)); parts.push(box);
    }
    return parts;
  }
  const planMeta = plan => [plan.source === 'dig' ? `Rettet af dig ${versionTime(plan.at)}` : plan.at ? `Fra AI’en ${versionTime(plan.at)}` : 'Fra AI’en', plan.builtAt && `bygget ${versionTime(plan.builtAt)}`].filter(Boolean).join(' · ');
  function renderPlan() {
    const plan = activePlan, shown = plan || lastPlan;
    const planningNow = running && $('#work-mode').value === 'plan';
    $('#plan-empty').hidden = Boolean(shown);
    $('#plan-empty').textContent = planningNow ? 'AI’en arbejder på en plan. Den kommer her, når den er klar.' : 'Ingen plan endnu. Vælg Planlæg ved skrivefeltet, når du vil lave en plan.';
    $('#plan-text').replaceChildren(...(shown ? planSections(shown.text) : []));
    $('#plan-text').hidden = !shown || editingPlan; $('#plan-text').classList.toggle('is-retired', !plan && Boolean(lastPlan));
    $('#plan-meta').textContent = shown ? planMeta(shown) : '';
    let notice = '';
    if (!plan && lastPlan) notice = `Den seneste plan kan ikke bygges, fordi ${reasonText[lastPlan.reason] || 'den ikke længere er gyldig'}. ${planningNow ? 'AI’en arbejder på en ny plan.' : 'Bed AI’en om en ny plan ud fra den.'}`;
    else if (plan && brief.updatedAt && Date.parse(brief.updatedAt) > plan.at) notice = 'Briefen er ændret, efter planen blev lavet. Bed AI’en rette planen, hvis ændringen har betydning.';
    $('#plan-notice').textContent = notice; $('#plan-notice').hidden = !notice;
    $('#plan-actions').hidden = !plan || editingPlan; $('#plan-editor').hidden = !editingPlan;
    $('#plan-retired-actions').hidden = Boolean(plan) || !lastPlan || planningNow;
    $('#plan-build').textContent = plan?.builtAt ? 'Byg igen efter planen' : 'Byg planen';
    $('#plan-restore').hidden = !(plan?.source === 'dig' && plan.previous);
    for (const id of ['#plan-build', '#plan-edit', '#plan-revise', '#plan-restore', '#plan-replan']) $(id).disabled = running;
    $('#plan-status').textContent = planningNow ? 'AI’en arbejder på planen' : plan ? (plan.builtAt ? 'Planen er bygget' : 'Planen er klar til at blive bygget') : lastPlan ? 'Ingen gyldig plan' : 'Ingen plan endnu';
    $('#plan-summary').textContent = plan ? view.planSummary(plan.text) : '';
    $('#plan-outline').replaceChildren(...(plan ? view.planOutline(plan.text).flatMap(item => [node('dt', item.title), node('dd', item.text)]) : []));
    // Fanen vises, når planlægning er slået til, eller når der findes en plan.
    $('#tab-plan').hidden = !featureOn('planlaegning') && !shown;
  }
  $('#plan-build').onclick = () => $('#build-plan').click();
  $('#plan-revise').onclick = () => $('#revise-plan').click();
  $('#plan-open').onclick = () => { window.workspace.show('plan'); $('#plan-title').focus(); };
  $('#plan-edit').onclick = () => { if (!activePlan || running) return; editingPlan = true; $('#plan-edit-text').value = activePlan.text; renderPlan(); $('#plan-edit-text').focus(); };
  $('#plan-edit-cancel').onclick = () => { editingPlan = false; renderPlan(); $('#plan-edit').focus(); };
  $('#plan-editor').onsubmit = event => {
    event.preventDefault();
    action(async () => {
      const plan = await call('planEdit', { planID: activePlan?.id, text: $('#plan-edit-text').value });
      activePlan = plan; editingPlan = false; renderPlan();
      $('#plan-meta').textContent = `${planMeta(plan)} · din version bruges, når der bygges`; $('#plan-title').focus();
    });
  };
  $('#plan-restore').onclick = () => action(async () => { activePlan = await call('planRestore', { planID: activePlan?.id }); renderPlan(); $('#plan-title').focus(); });
  // En plan, der ikke kan bygges, bruges som udgangspunkt for en ny planlægning. Teksten står synligt i beskeden.
  $('#plan-replan').onclick = () => {
    if (!lastPlan || running) return;
    if ($('#prompt').value.trim()) { message('Send eller ryd din beskedkladde først.'); $('#prompt').focus(); return; }
    $('#work-mode').value = 'plan'; updateWorkMode();
    $('#prompt').value = `Lav en opdateret plan ud fra denne tidligere plan:\n\n${lastPlan.text}`;
    saveChatDraft(); updateStartIdea(); $('#prompt').focus();
  };

  // ---------- Spørgsmål ét ad gangen ----------
  // v er samtalens visning. Spørgsmålet står i den samtale, hvis AI stillede det, også når en anden er åben.
  function questionCard(p, v) {
    const card = node('section', undefined, 'approval question-card'); card.dataset.id = p.id;
    const state = { index: 0, answers: [], drafts: [], more: false, submitting: false };
    const total = p.questions.length;
    const finish = record => { card.remove(); doneWaiting(p.id, v); if (record) { const line = node('p', record, 'chat-message answer-record'); v.log.append(line); } };
    async function submit() {
      if (state.submitting || !card.isConnected) return;
      state.submitting = true;
      for (const control of card.querySelectorAll('button, textarea')) control.disabled = true;
      const answers = p.questions.map((_, index) => state.answers[index] || []);
      try { await call('question', { id: p.id, answers, chat: v.id }); }
      catch (error) { state.submitting = false; if (card.isConnected) render(); throw error; }
      setStatusDetail('Dit svar er sendt. AI’en fortsætter …', v);
      finish(`Du svarede: ${p.questions.map((question, index) => `${question.header || question.question}: ${answers[index].map(label => label.replace(/\s*[([]\s*(anbefalet|anbefales|recommended)\s*[)\]]\s*$/i, '')).join(', ') || 'intet svar'}`).join(' · ')}`);
    }
    function answer(values) {
      if (state.submitting || !card.isConnected) return;
      state.answers[state.index] = values;
      if (state.index < total - 1) { state.index++; state.more = false; render(); card.querySelector('.question-title').focus(); }
      else action(submit);
    }
    function render() {
      const question = p.questions[state.index], options = view.answerOptions(question.options);
      const chosen = new Set(state.answers[state.index] || []);
      card.replaceChildren(node('p', `${total > 1 ? `Spørgsmål ${state.index + 1} af ${total}` : 'Spørgsmål til dig'}${question.header ? ` · ${question.header}` : ''}`, 'question-step'));
      const title = node('h3', question.question, 'question-title'); title.tabIndex = -1; card.append(title);
      const list = node('div', undefined, 'answer-choices'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', question.question);
      // Højst fire svar ad gangen. Flere ligger bag ét link.
      for (const option of options.length > 4 && !state.more ? options.slice(0, 4) : options) {
        const button = node('button', undefined, 'answer-choice'); button.type = 'button'; button.dataset.label = option.label;
        const head = node('span', undefined, 'answer-head'); head.append(node('strong', option.text));
        if (option.recommended) head.append(node('span', 'AI’en anbefaler', 'recommended'));
        button.append(head); if (option.description) button.append(node('span', option.description, 'answer-description'));
        if (question.multiple) {
          button.setAttribute('aria-pressed', String(chosen.has(option.label)));
          button.onclick = () => { if (chosen.has(option.label)) chosen.delete(option.label); else chosen.add(option.label); state.answers[state.index] = [...chosen]; render(); card.querySelector(`.answer-choice[data-label="${CSS.escape(option.label)}"]`)?.focus(); };
        } else button.onclick = () => answer([option.label]);
        list.append(button);
      }
      card.append(list);
      if (options.length > 4 && !state.more) { const more = node('button', `Vis ${options.length - 4} svar mere`, 'text-button'); more.type = 'button'; more.onclick = () => { state.more = true; render(); }; card.append(more); }
      if (question.multiple) { const next = node('button', chosen.size ? `Fortsæt med ${chosen.size} ${chosen.size === 1 ? 'svar' : 'svar'}` : 'Vælg mindst ét svar', 'primary'); next.type = 'button'; next.disabled = !chosen.size; next.onclick = () => answer([...chosen]); card.append(next); }
      if (question.custom !== false) {
        const form = node('form', undefined, 'answer-own'); const label = node('label', 'Eller skriv dit eget svar'); const input = node('textarea'); input.rows = 2; input.maxLength = 2000; input.required = true; input.id = `svar-${p.id}-${state.index}`; label.htmlFor = input.id; input.value = state.drafts[state.index] || ''; input.placeholder = 'Svar med dine egne ord …'; input.oninput = () => { state.drafts[state.index] = input.value; };
        const send = node('button', 'Svar', 'primary'); send.type = 'submit'; form.append(label, input, send);
        form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) answer([input.value.trim()]); };
        card.append(form);
      }
      const links = node('p', undefined, 'question-links');
      const link = (text, onClick) => { const button = node('button', text, 'text-button'); button.type = 'button'; button.onclick = onClick; links.append(button); };
      if (state.index > 0) link('Tilbage', () => { state.index--; state.more = false; render(); card.querySelector('.question-title').focus(); });
      link(total > 1 ? 'Spring spørgsmålene over' : 'Spring over', () => action(async () => { await call('question', { id: p.id, skip: true, chat: v.id }); setStatusDetail('Du sprang over. AI’en vælger selv og skriver antagelserne i planen.', v); finish('Du sprang AI’ens spørgsmål over. AI’en vælger selv.'); }));
      card.append(links);
    }
    render();
    return card;
  }
  function showQuestion(p, v = viewFor()) {
    if (!Array.isArray(p.questions) || !p.questions.length) return;
    const card = questionCard(p, v); v.approvals.append(card);
    waitFor(p.id, p.questions.length > 1 ? `${p.questions.length} spørgsmål fra AI’en` : 'et spørgsmål fra AI’en', card, v);
  }

  window.harness.onEvent(event => {
    if (event.type === 'brief.updated' && event.root === current?.root) { brief = event.brief; if (!editing) renderBrief(); renderPlan(); }
    // Planen under fanen Plan er den åbne samtales. Hændelser fra en samtale i baggrunden gemmes i dens visning.
    const target = viewFor(event.chat), active = target === viewFor();
    if (event.type === 'plan.retired' && event.root === current?.root && active) { lastPlan = event.lastPlan; renderPlan(); }
    if (event.type === 'plan.updated' && event.root === current?.root) { if (target.plan?.id === event.plan.id) target.plan = event.plan; if (active && activePlan?.id === event.plan.id) { activePlan = event.plan; renderPlan(); } }
    if (['question.replied', 'question.rejected'].includes(event.type)) { const id = event.properties?.requestID || event.properties?.id || ''; target.approvals.querySelector(`.question-card[data-id="${CSS.escape(id)}"]`)?.remove(); doneWaiting(id, target); }
    if (event.type === 'run.status') renderPlan();
  });
  window.planning = {
    onProject(state) { brief = state.brief || { items: [], updatedAt: null }; lastPlan = state.lastPlan || null; editing = null; editingPlan = false; closeBriefForm(); $('#brief-feedback').textContent = ''; renderBrief(); renderPlan(); },
    onPlan() { editingPlan = false; renderPlan(); },
    render: renderPlan, showQuestion,
    async addWishes(wishes) { brief = await call('briefWishes', wishes); renderBrief(); renderPlan(); }
  };
})();
