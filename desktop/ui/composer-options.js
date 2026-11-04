// Hurtige valg ved skrivefeltet. De eksisterende felter og handlers er stadig kilden til afsendelse og samtykke.
(() => {
  const modeMenu = node('div', undefined, 'composer-options'); modeMenu.id = 'composer-mode-menu';
  const modelMenu = node('div', undefined, 'composer-options'); modelMenu.id = 'composer-model-menu';
  for (const [menu, label, trigger] of [[modeMenu, 'Vælg arbejdsmåde', '#composer-mode'], [modelMenu, 'Vælg model og indsats', '#model-chip']]) {
    menu.popover = 'auto'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', label);
    $(trigger).setAttribute('aria-controls', menu.id); $(trigger).setAttribute('aria-haspopup', 'dialog');
    menu.addEventListener('toggle', event => $(trigger).setAttribute('aria-expanded', String(event.newState === 'open')));
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); menu.hidePopover(); $(trigger).focus(); } });
    document.body.append(menu);
  }
  let modelMenuGeneration = 0;
  const close = () => { ++modelMenuGeneration; modeMenu.hidePopover(); modelMenu.hidePopover(); };
  const owns = owner => current?.root === owner.root && view === owner.view && !projectLoading;
  function openMode() {
    if (!current || running || view.submitting || projectLoading) return;
    close(); const owner = { root: current.root, view };
    modeMenu.replaceChildren(node('strong', 'Arbejdsmåde', 'composer-options-title'));
    const modes = [
      ['chat', 'Samtale', 'Afklar idéer og stil spørgsmål. Filerne ændres ikke.'],
      ['plan', 'Planlæg', 'Lav eller ret en plan, før AI’en bygger.'],
      [activePlan ? 'build' : 'free', 'Byg', activePlan ? 'Byg efter din valgte plan. Godkendelser gælder stadig.' : 'Byg efter din besked. Projektets tilladelser gælder stadig.']
    ];
    for (const [mode, title, description] of modes) {
      if (mode === 'plan' && !featureOn('planlaegning')) continue;
      const button = node('button', undefined, 'composer-option'); button.type = 'button'; button.dataset.mode = mode;
      button.setAttribute('aria-pressed', String($('#work-mode').value === mode));
      button.append(node('strong', title), node('span', description));
      button.onclick = () => {
        if (!owns(owner) || running || view.submitting) return close();
        $('#work-mode').value = mode; $('#work-mode').dispatchEvent(new Event('change'));
        close(); $('#prompt').focus();
      };
      modeMenu.append(button);
    }
    modeMenu.showPopover(); (modeMenu.querySelector('[aria-pressed="true"]') || modeMenu.querySelector('button')).focus();
  }
  function openModel() {
    if (projectLoading) return;
    if (!state?.connections?.length) return openTaskSettings();
    close(); const owner = { root: current?.root, view }, connectionID = $('#connection-select').value;
    const generation = modelMenuGeneration; let choiceRequest = 0;
    const valid = () => generation === modelMenuGeneration && owns(owner) && $('#connection-select').value === connectionID;
    const render = () => {
      if (!valid()) return close();
      const selected = $('#model-select').value, connection = state.connections.find(item => item.id === connectionID);
      modelMenu.replaceChildren(node('strong', connection?.name || 'Din AI', 'composer-options-title'));
      if (running) modelMenu.append(node('p', 'Dit valg gælder næste opgave.', 'hint'));
      const { picks } = window.ModelAdvice.suggest(modelCatalog, connection?.kind);
      for (const { model, text } of picks) {
        const button = node('button', undefined, 'composer-option'); button.type = 'button'; button.dataset.model = model.id;
        button.setAttribute('aria-pressed', String(selected === model.id)); button.append(node('strong', model.name), node('span', text));
        button.onclick = () => action(async () => {
          if (!valid()) return close();
          const request = ++choiceRequest;
          if ($('#model-select').value !== model.id) view.effort = null;
          $('#model-select').value = model.id; acceptedFingerprint = null;
          markChosenModel(); updateModelSummary();
          await loadRoutes();
          if (!valid() || request !== choiceRequest || $('#model-select').value !== model.id || !modelMenu.matches(':popover-open')) return;
          if (!$('#route-row').hidden) { close(); openTaskSettings(); $('#route-select').focus(); }
          else { render(); modelMenu.querySelector(`[data-model="${CSS.escape(model.id)}"]`)?.focus(); }
        });
        modelMenu.append(button);
      }
      if (selected && !picks.some(pick => pick.model.id === selected)) modelMenu.append(node('p', `Valgt: ${$('#model-select').selectedOptions[0].textContent}`, 'hint'));
      const model = modelCatalog.find(item => item.id === selected);
      // Main bruger samme liste ved prepare. Ukendt støtte giver kun udbyderens standard.
      const levels = [...new Set(model?.effortLevels || model?.capabilities?.effort || [])].filter(level => typeof level === 'string' && /^[a-z]{2,10}$/.test(level));
      if (levels.length) {
        const label = node('label', 'Indsats'); label.htmlFor = 'composer-effort';
        const select = node('select'); select.id = 'composer-effort'; select.append(option('', 'Udbyderens standard'));
        for (const level of levels) select.append(option(level, effortNames[level] || level));
        select.value = view.effort || '';
        select.onchange = () => {
          if (!valid() || $('#model-select').value !== selected) return close();
          view.effort = levels.includes(select.value) ? select.value : null; acceptedFingerprint = null; updateModelSummary();
        };
        modelMenu.append(label, select, node('p', 'Mere indsats kan tage længere tid og koste mere.', 'hint'));
      } else modelMenu.append(node('p', 'Indsats: udbyderens standard. Ingen valgbare niveauer oplyst.', 'hint'));
      const advanced = node('button', 'Alle modeller og forbindelser', 'text-button'); advanced.type = 'button';
      advanced.onclick = () => { if (!valid()) return close(); close(); openTaskSettings(); };
      modelMenu.append(advanced);
    };
    render(); if (!valid()) return;
    modelMenu.showPopover(); (modelMenu.querySelector('[aria-pressed="true"]') || modelMenu.querySelector('button')).focus();
  }
  window.composerOptions = { openMode, openModel, close };
})();
