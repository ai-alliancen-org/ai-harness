// Projektets valg kan ændres, mens samtalerne fortsætter. Kørende processer
// genstartes ikke af en indstilling; den næste opgave/opstart bruger det gemte valg.
(() => {
  const dialog = $('#project-settings-dialog');
  let settings = null, root = null, owner = null, request = 0, saving = false;
  const networkKinds = ['connect', 'scripts', 'images', 'styles'];
  const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
  function section(name) {
    $('#project-approval-settings').hidden = name !== 'approvals'; $('#project-runtime-settings').hidden = name !== 'runtime';
    for (const button of dialog.querySelectorAll('[data-project-section]')) button.setAttribute('aria-pressed', String(button.dataset.projectSection === name));
  }
  function serviceRow(service = {}) {
    const fold = node('details', undefined, 'project-service'); fold.dataset.service = service.id || `tjeneste-${crypto.randomUUID().slice(0, 8)}`;
    fold.append(node('summary', service.label || 'Ny tjeneste'));
    const field = (label, key, value, multiline = false) => {
      const input = node(multiline ? 'textarea' : 'input'); input.dataset.field = key; input.value = value ?? ''; input.setAttribute('aria-label', label);
      if (multiline) input.rows = 3;
      const wrapper = node('label', label); wrapper.append(input); fold.append(wrapper); return input;
    };
    field('Navn', 'label', service.label).oninput = event => { fold.querySelector('summary').textContent = event.target.value || 'Ny tjeneste'; };
    field('Program', 'program', service.command?.[0] || 'node');
    field('Argumenter, ét pr. linje', 'arguments', (service.command || []).slice(1).join('\n'), true);
    field('Mappe i projektet', 'cwd', service.cwd || '.');
    const port = field('Port, tomt felt vælger en ledig port', 'port', service.port); port.type = 'number'; port.min = '1024'; port.max = '65535';
    const remove = node('button', 'Fjern tjenesten', 'text-button danger'); remove.type = 'button'; remove.onclick = () => { fold.remove(); $('#project-service-add').disabled = false; };
    fold.append(remove); $('#project-services').append(fold); return fold;
  }
  function commandAvailability() {
    const sandbox = settings?.commandSandbox;
    // Et gemt tilvalg fra en anden computer skal stadig kunne slås fra her.
    // På en computer uden kommandoisolation (Windows) kan valget tændes uden isolation, men først efter en advarsel (unisolatedWarning).
    const unisolatedChoice = sandbox?.available !== true && sandbox?.unisolatedPossible === true, unisolatedOn = unisolatedChoice && settings?.approvals?.autoCommandsUnisolated === true;
    $('#project-auto-commands').disabled = saving || sandbox?.available !== true && !unisolatedChoice && !$('#project-auto-commands').checked;
    $('#project-command-sandbox').textContent = sandbox?.available === true ? 'Kommandoer kører isoleret med adgang til projektet. Gælder fra næste opgave.'
      : unisolatedOn ? 'Der er ingen isolation: kommandoerne kører med dine rettigheder og kan røre alt, du kan, også uden for projektet. Gælder fra næste opgave.'
      : unisolatedChoice ? 'Aura kan ikke isolere kommandoer på Windows. Du kan vælge at køre dem uden isolation, efter en advarsel.'
      : sandbox?.reason || 'Automatisk bygning er ikke tilgængelig på denne computer.';
    $('#project-command-warnings').replaceChildren(...(sandbox?.warnings || []).map(text => node('li', text)));
    $('#project-command-details').hidden = !sandbox?.warnings?.length;
  }
  // Advarslen vises hver gang valget tændes: to knapper, ét spørgsmål, teknikken bag Se detaljer.
  function unisolatedWarning() {
    $('#project-unisolated-warning')?.remove();
    const box = node('div', undefined, 'project-unisolated-warning'); box.id = 'project-unisolated-warning'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Kør uden isolation');
    const details = node('details'); details.append(node('summary', 'Se detaljer'), node('p', 'Windows har ingen isolation af kommandoer i Aura. Aura kontrollerer kun kommandoens tekst for beskyttede navne som .env, nøgler og .git, og det er ikke en sikring. Filer i projektet beskyttes som før. Du kan slå valget fra her igen.', 'hint'));
    const allow = node('button', 'Tillad uden isolation', 'primary'); allow.type = 'button'; allow.onclick = () => { box.remove(); save({ autoCommands: true, autoCommandsUnisolated: true }, 'Projektets valg er gemt. Kommandoer kører uden isolation fra næste opgave.'); };
    const keep = node('button', 'Behold spørgsmål'); keep.type = 'button'; keep.onclick = () => { box.remove(); $('#project-auto-commands').checked = false; };
    box.append(node('strong', 'Vil du køre kommandoer uden isolation?'), node('p', 'Kommandoerne kører uden isolation med dine rettigheder og kan røre alt, du kan, også uden for projektet.'), details, allow, keep);
    $('#project-command-sandbox').after(box); allow.focus();
  }
  function render() {
    $('#project-unisolated-warning')?.remove();
    const approvals = settings.approvals || {};
    $('#project-auto-files').checked = approvals.autoProjectFiles === true;
    $('#project-auto-commands').checked = approvals.autoCommands === true; commandAvailability();
    // Et nyt projekt uden sikkerhedsnet spørger, til nettet er der (beslutning (c), 10. november 2026). Forklaringen siger, hvad
    // der mangler (pendingReason fra core/new-project-defaults.cjs), og hvor det slås til; Gits egen grund står bag Se detaljer.
    $('#project-defaults-pending')?.remove();
    if (settings.pendingDefaults === true) {
      const what = settings.commandSandbox?.available === true ? 'begge valg' : 'filændringer', reason = settings.pendingReason || {};
      const then = `Så slår Aura ${what} til, medmindre du selv vælger her.`;
      const text = reason.kind === 'funktion' ? `AI’en spørger først, fordi Versioner og fortryd er slået fra for projektet. Slå funktionen til under Indstillinger › Funktioner, og slå derefter «Gem en version efter hver AI-opgave» til under Gem version. ${then}`
        : reason.kind === 'git' ? `AI’en spørger først, fordi Aura ikke kan gemme projektets versioner endnu, selv om automatiske versioner er slået til. Når en version kan gemmes i projektmenuen (•••) under Gem version, slår Aura ${what} til, medmindre du selv vælger her.`
        : `AI’en spørger først, fordi projektet ikke gemmer en version efter hver AI-opgave. Slå «Gem en version efter hver AI-opgave» til i projektmenuen (•••) under Gem version. ${then}`;
      const note = node('div', undefined, 'project-defaults-pending'); note.id = 'project-defaults-pending'; note.append(node('p', text, 'hint'));
      if (reason.kind === 'git' && reason.detail) { const details = node('details'); details.append(node('summary', 'Se detaljer'), node('p', reason.detail, 'hint')); note.append(details); }
      $('#project-approval-settings h3').after(note);
    }
    $('#project-permission-rules').replaceChildren();
    for (const rule of approvals.rules || []) {
      const row = node('li'), remove = node('button', rule.inactive ? 'Slet' : 'Fjern', 'text-button'); remove.type = 'button';
      let label = node('span', rule.label);
      // Kommandoer huskes ikke længere (beslutning 10. november 2026). En gammel kommandoregel bruges aldrig og kan kun slettes.
      if (rule.inactive) {
        const note = node('p', 'Ikke i brug. Kommandoer huskes ikke længere.', 'hint');
        note.append(info('kommandoregler', 'Aura husker ikke længere enkelte kommandoer. Kommandoer styres af sandkassen, af «Byg og kontrollér automatisk» og af «Godkend alt i denne samtale». Reglen her bruges ikke og kan slettes.'));
        const text = label; label = node('div'); label.append(text, note);
        remove.setAttribute('aria-label', `Slet den gamle kommandoregel: ${rule.label}`); remove.onclick = () => save({ revoke: rule.id }, 'Den gamle kommandoregel er slettet.');
      } else { remove.setAttribute('aria-label', `Fjern tilladelse: ${rule.label}`); remove.onclick = () => save({ revoke: rule.id }, 'Tilladelsen er fjernet. Den næste handling kræver godkendelse.'); }
      row.append(label, remove); $('#project-permission-rules').append(row);
    }
    if (!approvals.rules?.length) $('#project-permission-rules').append(node('li', 'Ingen gemte tilladelser.', 'hint'));
    $('#project-runtime-mode').value = settings.runtime?.mode || 'auto';
    // En gemt opstart, Aura ikke kunne bruge det hele af, siges her i almindeligt dansk; det sprungne står bag Se detaljer (Q:C1-4).
    const notice = settings.runtimeNotice;
    $('#project-runtime-notice').hidden = !notice; $('#project-runtime-notice-text').textContent = notice?.text || '';
    $('#project-runtime-notice-list').replaceChildren(...(notice?.details || []).map(text => node('li', text))); $('#project-runtime-notice-more').hidden = !notice?.details?.length;
    $('#project-services').replaceChildren(); for (const service of settings.runtime?.services || []) serviceRow(service);
    $('#project-service-add').disabled = $('#project-services').children.length >= 4;
    for (const kind of networkKinds) $(`#project-network-${kind}`).value = (settings.runtime?.network?.[kind] || []).join('\n');
  }
  async function save(values, message) {
    if (saving || root !== current?.root) return;
    saving = true; $('#project-settings-feedback').textContent = 'Gemmer …';
    const generation = request;
    for (const control of dialog.querySelectorAll('input, select, textarea, button:not([data-close])')) control.disabled = true;
    try {
      const next = await call('saveProjectSettings', values, owner);
      if (generation !== request || root !== current?.root) return;
      settings = next; render(); $('#project-settings-feedback').textContent = message;
    } catch (error) { if (generation === request) { if (!values.runtime) render(); $('#project-settings-feedback').textContent = error.message; } }
    finally {
      if (generation === request) saving = false;
      if (generation === request) { for (const control of dialog.querySelectorAll('input, select, textarea, button:not([data-close])')) control.disabled = false; $('#project-service-add').disabled = $('#project-services').children.length >= 4; commandAvailability(); }
    }
  }
  async function open() {
    if (!current) return;
    const generation = ++request; saving = false; root = current.root; owner = selectedOwner(); settings = null;
    $('#project-settings-name').textContent = current.name; $('#project-settings-feedback').textContent = 'Henter indstillinger …';
    section('approvals'); dialog.showModal();
    for (const control of dialog.querySelectorAll('input, select, textarea, button:not([data-close])')) control.disabled = true;
    try { const next = await call('projectSettings', undefined, owner); if (generation !== request || root !== current?.root) return; settings = next; render(); $('#project-settings-feedback').textContent = ''; }
    catch (error) { if (generation === request) $('#project-settings-feedback').textContent = error.message; }
    finally { if (generation === request && settings) { for (const control of dialog.querySelectorAll('input, select, textarea, button:not([data-close])')) control.disabled = false; $('#project-service-add').disabled = $('#project-services').children.length >= 4; commandAvailability(); } }
  }
  $('#project-settings-button').onclick = () => action(open);
  for (const button of dialog.querySelectorAll('[data-project-section]')) button.onclick = () => section(button.dataset.projectSection);
  $('#project-auto-files').onchange = event => save({ autoProjectFiles: event.target.checked }, 'Projektets valg er gemt. Det gælder kommende filhandlinger.');
  $('#project-auto-commands').onchange = event => {
    if (event.target.checked && settings?.commandSandbox?.available !== true && settings?.commandSandbox?.unisolatedPossible === true) return unisolatedWarning();
    save({ autoCommands: event.target.checked }, 'Projektets valg er gemt. Det gælder fra næste opgave.');
  };
  $('#project-runtime-mode').onchange = event => save({ runtime: { ...settings.runtime, mode: event.target.value } }, 'Opstarten er gemt. Den bruges næste gang forhåndsvisningen starter.');
  $('#project-service-add').onclick = () => { if ($('#project-services').children.length >= 4) return; serviceRow().open = true; $('#project-service-add').disabled = $('#project-services').children.length >= 4; commandAvailability(); };
  $('#project-runtime-form').onsubmit = event => {
    event.preventDefault();
    const services = [...$('#project-services').children].map(row => {
      const field = name => row.querySelector(`[data-field="${name}"]`).value;
      return { id: row.dataset.service, label: field('label').trim(), command: [field('program').trim(), ...lines(field('arguments'))], cwd: field('cwd').trim() || '.', ...(field('port') ? { port: Number(field('port')) } : {}) };
    });
    save({ runtime: { mode: $('#project-runtime-mode').value, services, network: Object.fromEntries(networkKinds.map(kind => [kind, lines($(`#project-network-${kind}`).value)])) } }, 'Opstart og adresser er gemt. De bruges næste gang forhåndsvisningen starter.');
  };
  dialog.addEventListener('close', () => { ++request; settings = null; });
  window.projectSettings = { open: () => action(open) };
})();
