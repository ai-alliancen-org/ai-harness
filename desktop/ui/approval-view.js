// Godkendelser og fejl i almindeligt dansk. Rene funktioner uden DOM, så de kan afprøves i Node.
(root => {
  // OpenCode sender en filændring som samlet diff. Kortet viser +/- og linjerne; filhovederne udelades.
  function parseUnifiedDiff(text) {
    const rows = []; let added = 0, removed = 0, oldLine = 0, newLine = 0;
    for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      if (/^(Index:|={3,}|---|\+\+\+|diff |\\ No newline)/.test(line)) continue;
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); if (rows.length) rows.push({ type: 'gap' }); continue; }
      if (line.startsWith('+')) { rows.push({ type: '+', old: null, new: newLine++, text: line.slice(1) }); added++; }
      else if (line.startsWith('-')) { rows.push({ type: '-', old: oldLine++, new: null, text: line.slice(1) }); removed++; }
      else if (line.startsWith(' ')) rows.push({ type: ' ', old: oldLine++, new: newLine++, text: line.slice(1) });
    }
    return { added, removed, rows, created: removed === 0 && added > 0 && !rows.some(row => row.type === ' ') };
  }
  // Hvad en kommando sandsynligvis gør. Det er et gæt ud fra teksten, ikke en analyse; kortet siger det.
  const hints = [
    [/\b(npm|pnpm|yarn|bun)\s+(i|install|ci|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b/, 'Installerer pakker fra internettet'],
    [/\b(curl|wget|ssh|scp|rsync)\b|\bgit\s+(clone|fetch|pull|push)\b/, 'Kontakter andre computere på internettet'],
    [/\brm\s|\brmdir\b|\bdel\s|\bunlink\b|--force\b|\bgit\s+(reset|clean|checkout\s+--)\b/, 'Kan slette eller overskrive filer'],
    [/\bgit\s+(commit|push|rebase|merge|reset|branch|tag|remote)\b/, 'Ændrer projektets Git-historik'],
    [/\b(npm|pnpm|yarn)\s+(test|run\s+test)\b|\b(jest|vitest|mocha|pytest|playwright)\b/, 'Kører projektets tests'],
    [/\b(npm|pnpm|yarn)\s+(run\s+)?(build|dev|start)\b|\bnode\s+\S|\bpython3?\s+\S|\bdeno\s+run\b/, 'Kører projektets kode'],
    [/\bsudo\b|\bchmod\b|\bchown\b/, 'Ændrer rettigheder på computeren']
  ];
  function commandHints(command) {
    const text = String(command || '');
    const found = hints.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
    if (!found.length && /^\s*(ls|cat|pwd|echo|head|tail|wc|grep|find|which|node\s+--version|npm\s+-v)\b/.test(text)) found.push('Ser ud til kun at læse eller vise noget');
    return found;
  }
  // Fejltyper fra hovedprocessen. Hver type har en forklaring og den handling, der kan hjælpe.
  const failures = {
    key: { title: 'AI’en afviste din nøgle', text: 'Nøglen er forkert, udløbet eller slettet hos udbyderen.', action: 'connection' },
    access: { title: 'Din konto har ikke adgang til modellen', text: 'Kontrollér adgangen hos udbyderen, eller vælg en anden model.', action: 'connection' },
    quota: { title: 'Kontoen hos udbyderen er brugt op', text: 'Udbyderen afviste kaldet på grund af saldo eller kvote. Aura skifter ikke til en anden, betalt model.', action: 'account' },
    limit: { title: 'Udbyderen har nået en grænse', text: 'Der er sendt for meget på kort tid, eller månedens grænse er nået. Vent lidt, og prøv igen.', action: 'retry' },
    notfound: { title: 'Modellen findes ikke længere', text: 'Hent modellisten igen, og vælg en model.', action: 'model' },
    server: { title: 'Udbyderens server havde en fejl', text: 'Fejlen lå hos udbyderen. Prøv igen om lidt.', action: 'retry' },
    rejected: { title: 'Udbyderen afviste kaldet', text: 'Kontrollér forbindelsen og modelvalget, og prøv igen.', action: 'connection' },
    network: { title: 'Forbindelsen til AI’en blev afbrudt', text: 'Kontrollér internetforbindelsen, og prøv igen.', action: 'retry' },
    idle: { title: 'AI’en svarede ikke', text: 'Modellen svarede ikke i lang tid, så Aura stoppede kaldet.', action: 'retry' },
    engine: { title: 'AI-motoren stoppede', text: 'Aura starter motoren igen, når du sender beskeden.', action: 'retry' },
    model: { title: 'AI’en kunne ikke gennemføre opgaven', text: 'Prøv igen. Virker det stadig ikke, så vælg en anden model.', action: 'retry' },
    start: { title: 'Opgaven kunne ikke starte', text: 'Aura kunne ikke starte AI’en.', action: 'retry' }
  };
  const failureText = kind => failures[kind] || failures.model;
  // Kommandoens faktiske resultat. En afsluttet kommando er ikke det samme som en bestået test.
  function commandResult(tool) {
    if (tool.status === 'error') return { ok: false, text: tool.error ? `Mislykkedes: ${tool.error}` : 'Mislykkedes' };
    if (Number.isInteger(tool.exit)) return tool.exit === 0 ? { ok: true, text: 'Afsluttet uden fejl (kode 0)' } : { ok: false, text: `Afsluttet med fejl (kode ${tool.exit})` };
    return { ok: null, text: tool.status === 'completed' ? 'Afsluttet; afslutningskoden er ukendt' : 'Blev ikke færdig' };
  }
  // Kun hovedprocessens kanoniske nøgle må samle kort. Uden den er hvert id sit
  // eget kort; en enslydende titel eller sti er ikke bevis på samme adgang.
  const groupKey = p => p?.policy?.key && p.policy.match ? p.policy.key : `request:${p?.id || ''}`;
  function receiptText({ count = 1, label = 'handlingen', allow = true, scope, message, automatic = false }) {
    const number = `${count} ${count === 1 ? 'handling' : 'handlinger'}`;
    if (!allow) return message ? `Du afviste ${number} og skrev: ${message}` : `Du afviste ${number}. AI’en stopper.`;
    if (automatic) return `${number} godkendt automatisk: ${label}.`;
    return `${number} godkendt${scope === 'project' ? ' med tilladelse gemt i projektet' : scope === 'task' ? ' for denne opgave' : ''}: ${label}.`;
  }
  // Den foreslåede ændring vises 400 rækker ad gangen. Kun rigtige linjer tælles; ⋯-skilletegn er ikke linjer. Efter forslag i #35.
  function diffPage(rows, shown, step = 400) {
    // En side slutter efter step rigtige linjer; skilletegn undervejs følger med uden at tælle.
    let end = shown, added = 0;
    while (end < rows.length && (added < step || rows[end].type === 'gap')) { if (rows[end].type !== 'gap') added++; end++; }
    const lines = rows.filter(row => row.type !== 'gap').length, visible = rows.slice(0, end).filter(row => row.type !== 'gap').length, rest = lines - visible;
    const next = Math.min(step, rest), status = rest ? `Viser ${visible} af ${lines} linjer i ændringen.` : visible > step ? `Alle ${lines} linjer vises.` : '';
    return { end, status, more: rest ? `Vis ${next} ${next === 1 ? 'linje' : 'linjer'} mere` : '' };
  }
  // Mappeadgang uden for projektet: skrivning og læsning har hver sin titel (beslutning for beta 2).
  function directoryTitle(p) {
    const writing = ['write', 'edit', 'apply_patch'].includes(p?.toolInput?.tool || p?.tool?.name);
    return writing ? ['Må AI’en skrive i en mappe uden for projektet?', 'Mappen kan få filer, der ligger uden for dit projekt. Tillad kun, hvis du ved, hvad AI’en skriver.'] : ['Må AI’en se en mappe uden for projektet?', 'Mappen kan indeholde materiale, du ikke vil dele med din AI.'];
  }
  // En fejlet forhåndsvisning sendt til AI'en: fejlbeskeden og de sidste linjer af den maskerede proceslog (nøgler er allerede skjult).
  function serverRepairDraft(status) {
    if (status?.state !== 'error') return '';
    const tail = String(status.output || '').split('\n').slice(-25).join('\n').slice(-1500);
    return `Forhåndsvisningen kunne ikke starte. Beskeden fra Aura: ${status.message || 'ukendt fejl'}\n\nSeneste del af proceslogen (nøgler er skjult):\n${tail || '(tom)'}\n\nFind årsagen, ret den, og start forhåndsvisningen igen med værktøjet aura_preview.`;
  }
  const api = { serverRepairDraft, directoryTitle, parseUnifiedDiff, commandHints, failureText, commandResult, groupKey, receiptText, diffPage };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ApprovalView = api;
})(typeof window === 'object' ? window : globalThis);
