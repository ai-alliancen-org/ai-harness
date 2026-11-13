(() => {
  let status = null, review = null, managedURL = null, liveDiagnostics = [], netlist = null;
  const dismissed = new Set(), kindName = { scripts: 'et kodebibliotek', styles: 'en typografi eller skrift', images: 'et billede' };
  const consentable = item => ['scripts', 'styles', 'images'].includes(item.kind) && /^https:\/\//.test(item.origin || '') && !dismissed.has(item.kind + ':' + item.origin);
  const active = () => ['installing', 'starting', 'running', 'stopping'].includes(status?.state);
  const labels = { idle: '', installing: 'Installerer pakker …', installed: 'Pakkerne er klar', starting: 'Starter forhåndsvisningen …', running: 'Forhåndsvisningen kører', stopping: 'Stopper …', stopped: 'Forhåndsvisningen er stoppet', error: 'Forhåndsvisningen kræver din hjælp' };
  function update(value) {
    if (!value || value.root !== current?.root || (value.workspaceRoot && value.workspaceRoot !== current?.workspaceRoot)) return;
    if (status?.root !== value.root || status?.workspaceRoot !== value.workspaceRoot) { managedURL = null; review = null; liveDiagnostics = []; $('#server-review').hidden = true; $('#server-scripts').checked = false; }
    status = value;
    // Kører serveren, er rammens adresse serverens, også når usePreviewContext allerede viste den, fx efter et skift af arbejdsmappe
    // og tilbage. Så ryddes rammen ved Stop eller en fejl, og ↻ indlæser ikke en død adresse (K3).
    if (value.state === 'running' && value.url) { managedURL = value.url; if (current.previewURL !== value.url) showPreview(value.url, true); }
    else if (!value.url && managedURL) { if (current.previewURL === managedURL) showPreview(null); managedURL = null; }
    const project = value.project;
    const diagnostics = [...new Map([...(project?.diagnostics || []), ...liveDiagnostics].map(item => [item.kind + ':' + item.origin, item])).values()];
    let notice = $('#preview-problem');
    if (!notice) { notice = node('button', 'Gennemgå forhåndsvisning', 'text-button'); notice.id = 'preview-problem'; notice.type = 'button'; notice.onclick = () => action(open); $('#preview-status').after(notice); }
    notice.hidden = !diagnostics.length;
    const framework = project && project.kind !== 'static';
    $('#server-description').textContent = project?.supported ? `${project.label} · ${project.installed ? project.kind === 'services' ? 'Opstarten er klar til gennemgang.' : 'Pakkerne findes i projektet.' : 'Projektets pakker skal installeres, før du kan se appen.'}` : project?.reason || 'Åbn et projekt først.';
    $('#server-status').textContent = value.message || labels[value.state] || '';
    $('#server-primary').hidden = !project?.supported || active();
    $('#server-primary').textContent = project?.installed ? 'Gennemgå opstart' : 'Gennemgå installation';
    $('#server-primary').disabled = running;
    $('#server-stop').hidden = !active(); $('#server-stop').disabled = value.state === 'stopping';
    $('#server-actions').hidden = Boolean(review);
    $('#server-install-options').hidden = !project?.supported;
    $('#server-reinstall').disabled = active() || running || Boolean(review);
    $('#server-scripts').disabled = active() || Boolean(review);
    $('#server-log').textContent = value.output || 'Ingen proceslog endnu.';
    let repairButton = $('#server-repair');
    if (!repairButton) { repairButton = node('button', 'Ret med AI', 'text-button'); repairButton.id = 'server-repair'; repairButton.type = 'button'; $('#server-log').closest('details, div, section')?.before(repairButton); }
    repairButton.hidden = value.state !== 'error';
    repairButton.onclick = () => { $('#preview-dialog').close(); window.draftMessage(window.ApprovalView.serverRepairDraft(status), 'Forslaget står i skrivefeltet. Gennemgå det, før du sender.', { mode: 'free' }); };
    $('#server-open').hidden = !framework && !diagnostics.length;
    $('#server-open').textContent = diagnostics.length ? 'Gennemgå forhåndsvisning' : active() ? 'Vis opstart' : 'error' === value.state ? 'Gennemgå fejlen' : 'Start forhåndsvisning';
    let problems = $('#server-diagnostics');
    if (!problems) { problems = node('div'); problems.id = 'server-diagnostics'; $('#server-description').after(problems); }
    problems.hidden = !diagnostics.length; problems.replaceChildren();
    if (diagnostics.length) {
      // Et link til et andet websted er ikke en fejl i koden: uden et forslag til rettelse er der ingen Ret med AI. Den første
      // forklaring med en rettelse står derfor forrest, og AI'en får kun det, den kan rette. Resten står under Se detaljer.
      const lead = diagnostics.find(item => item.repair) || diagnostics[0], rest = diagnostics.filter(item => item !== lead);
      problems.append(node('p', lead.message));
      const repair = node('button', 'Ret med AI'); repair.type = 'button'; repair.hidden = !lead.repair;
      repair.onclick = () => { $('#preview-dialog').close(); window.draftMessage(diagnostics.filter(item => item.repair).map(item => item.message).join('\n') + '\n\n' + lead.repair, 'Forslaget står i skrivefeltet. Gennemgå det, før du sender.', { mode: 'free' }); };
      problems.append(repair);
      if (rest.length) { const details = node('details'), summary = node('summary', 'Se detaljer'); details.append(summary, ...rest.map(item => node('p', item.message))); problems.append(details); }
    }
    // Samtykke pr. adresse: ét spørgsmål ad gangen. Kun dit klik her kan føje en adresse til projektets netliste.
    let consent = $('#server-consent');
    if (!consent) { consent = node('div'); consent.id = 'server-consent'; problems.after(consent); }
    const ask = diagnostics.find(consentable);
    consent.hidden = !ask; consent.replaceChildren();
    if (ask) {
      consent.append(node('p', `Siden vil hente ${kindName[ask.kind]} fra ${ask.origin}. Aura har blokeret det, fordi adressen ikke står på projektets netliste. Tillad kun en adresse, du kender og stoler på.`));
      const allow = node('button', 'Tillad denne adresse', 'primary'), keep = node('button', 'Behold blokeret'); allow.type = keep.type = 'button';
      allow.onclick = () => action(async () => {
        const settings = await call('previewAllow', { kind: ask.kind, origin: ask.origin });
        netlist = settings.runtime.network; liveDiagnostics = liveDiagnostics.filter(item => !(item.kind === ask.kind && item.origin === ask.origin));
        await refresh();
        // Adressen gælder straks, også mens projektets server kører, så siden genindlæses med det samme.
        const url = current?.previewURL;
        if (url) window.loadPreview(url);
        message(url ? 'Adressen er tilladt, og forhåndsvisningen er genindlæst.' : 'Adressen er tilladt. Den bruges, når forhåndsvisningen vises.');
      });
      keep.onclick = () => { dismissed.add(ask.kind + ':' + ask.origin); update(status); };
      consent.append(allow, keep);
    }
    let list = $('#server-netlist');
    if (!list) { list = node('details'); list.id = 'server-netlist'; consent.after(list); }
    list.hidden = !netlist; list.replaceChildren();
    if (netlist) {
      const label = { scripts: 'Kodebiblioteker', styles: 'Typografi og skrifter', images: 'Billeder', connect: 'Forbindelser' };
      list.append(node('summary', 'Se detaljer: projektets netliste'));
      for (const kind of Object.keys(label)) list.append(node('p', `${label[kind]}: ${(netlist[kind] || []).join(', ') || 'ingen'}`));
      list.append(node('p', 'Alt andet blokeres, indtil du selv tillader adressen her. AI-en kan ikke give samtykket.', 'hint'));
    }
    if (!current.previewURL && framework) {
      $('#preview-empty h2').textContent = labels[value.state] || 'Se din app';
      $('#preview-empty p').textContent = value.state === 'error' ? value.message : project.supported ? 'Start projektets lokale server for at se resultatet. Du gennemgår handlingen, før noget køres.' : project.reason;
    } else if (!framework) {
      // Før første version: kun et lille kodetegn og én linje. Startsiden vises ikke, så den ikke ligner en færdig app.
      $('#preview-empty h2').textContent = '';
      $('#preview-empty p').textContent = 'Din app kører her, så snart første version er klar.';
    }
    // Statuslinjen går gennem app.js, så en side, der ikke blev vist, ikke overskrives af «kører» (K3). En server, der
    // installerer, starter, stopper eller fejler, går forrest.
    if (active() || value.state === 'error') window.setPreviewStatus(labels[value.state], value.state !== 'running');
  }
  async function refresh() { const root = current?.root; if (!root) return; const value = await call('previewRuntime'); if (current?.root === root) update(value); }
  async function open() {
    review = null; $('#server-review').hidden = true; $('#server-scripts').checked = false;
    $('#preview-dialog .dialog-notice')?.remove();
    try { netlist = (await call('projectSettings')).runtime.network || null; } catch { netlist = null; }
    await refresh(); $('#preview-dialog').showModal();
  }
  async function prepare(operation) {
    review = await call('previewPrepare', { action: operation, scripts: $('#server-scripts').checked });
    $('#server-actions').hidden = true; $('#server-review').hidden = false;
    $('#server-review-title').textContent = operation === 'install' ? 'Installér projektets pakker?' : 'Start den lokale server?';
    const multiple = review.project.kind === 'services';
    const python = review.project.installs?.some(item => item.kind === 'python');
    $('#server-consequence').textContent = operation === 'install' ? python ? 'Pakker hentes til projektets eget Python-miljø. Pakkernes byggekommandoer kan køre på din computer. Eventuelle npm-pakker installeres i projektet med det viste valg af installationsscripts.' : `Pakker hentes fra de registre og adresser, projektets npm-opsætning og lockfil angiver. node_modules ${review.project.install === 'ci' ? 'erstattes med lockfilens versioner' : 'oprettes eller opdateres, og package-lock.json kan ændres'}. ${review.scripts ? 'Installationsscripts køres.' : 'Installationsscripts springes over.'}` : multiple ? 'De viste programmer køres i projektets mapper. De får lokale adresser og porte og skal bruge dem. Tjenesterne kører videre, når du skifter projekt, og stopper sammen, når du trykker Stop eller lukker Aura. Godkendelsen huskes, så AI’en kan starte dem igen, indtil projektets pakker eller opstart ændres.' : 'Projektkode og frameworkets konfiguration køres på din computer. Serveren bindes til 127.0.0.1 og kører videre, når du skifter projekt. Den stopper, når du trykker Stop eller lukker Aura. Godkendelsen huskes, så AI’en kan starte serveren igen, indtil projektets pakker eller opstart ændres.';
    $('#server-authority').textContent = 'Det er ikke en isoleret sandbox. Koden har din brugers adgang til filer og netværk. Appens modelnøgler sendes ikke med som miljøvariabler; projektets egen kode kan læse lokale indstillinger og filer.';
    $('#server-command').textContent = review.command;
    $('#server-folder').textContent = review.root;
    $('#server-packages').textContent = (multiple ? 'Programmer: ' : 'Direkte pakker: ') + (review.project.dependencies || []).join(', ') + (operation === 'start' ? multiple ? '. Et valgt npm-script kan også køre projektets før- og efterscripts.' : '. Frameworket startes direkte; npm predev og postdev køres ikke.' : '. Pakkeopsætningen kan bruge dine eksisterende registre.');
    $('#server-confirm').textContent = operation === 'install' ? 'Installér pakker' : 'Start forhåndsvisning';
    $('#server-confirm').disabled = false; update(status);
  }
  $('#server-open').onclick = () => action(open);
  $('#server-primary').onclick = () => action(() => prepare(status.project.installed ? 'start' : 'install'));
  $('#server-reinstall').onclick = () => action(() => prepare('install'));
  $('#server-cancel').onclick = () => { review = null; $('#server-review').hidden = true; update(status); };
  $('#server-confirm').onclick = () => action(async () => {
    const token = review?.token; review = null; $('#server-confirm').disabled = true;
    try { update(await call('previewExecute', token)); } finally { $('#server-review').hidden = true; await refresh(); }
  });
  $('#server-stop').onclick = () => action(async () => { await call('previewStop'); await refresh(); });
  // Et link til et andet websted og en dialogboks i siden er hændelser, ikke tilstande: efter ↻ vises siden igen, og beskeden
  // fjernes. Sker det igen, kommer beskeden igen.
  $('#refresh').addEventListener('click', () => { liveDiagnostics = liveDiagnostics.filter(item => !['navigation', 'dialog'].includes(item.kind)); if (status) update(status); });
  // Slutstatus skal genlæse, om installationen nu findes; processen genstartes aldrig her.
  window.harness.onEvent(event => {
    if (event.type === 'preview.diagnostic' && event.root === current?.root && (!event.workspaceRoot || event.workspaceRoot === current?.workspaceRoot)) {
      const entry = event.diagnostic;
      if (entry && !liveDiagnostics.some(item => item.kind === entry.kind && item.origin === entry.origin)) liveDiagnostics.push(entry);
      if (status) update(status);
    }
    if (event.type === 'preview.runtime' && ['installed', 'stopped', 'error'].includes(event.state)) void action(refresh);
    if (event.type === 'run.status' && status) update(status);
  });
  window.previewServer = { update, refresh: () => action(refresh), open: () => action(open) };
})();
