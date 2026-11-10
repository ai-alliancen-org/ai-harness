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
    // Aura har allerede prøvet igen flere gange. En grænse for kort tid går over af sig selv; kontoens grænse skal ses hos udbyderen (K5).
    // Første lag har én linje (N:B1-6, DESIGN.md: Rolige skærme). Forskellen på de to slags grænser står i detail bag Se detaljer.
    limit: { title: 'Udbyderen har nået en grænse', text: 'Vent lidt, og prøv igen, eller se kontoens grænse hos udbyderen.', detail: 'Udbyderen afviste opgaven flere gange. En grænse for kort tid går over af sig selv, så du kan vente lidt og prøve igen. Er det kontoens grænse for måneden eller planen, kan den ses og hæves hos udbyderen.', action: 'retry', secondary: 'account' },
    notfound: { title: 'Modellen findes ikke længere', text: 'Hent modellisten igen, og vælg en model.', action: 'model' },
    server: { title: 'Udbyderens server havde en fejl', text: 'Fejlen lå hos udbyderen. Prøv igen om lidt.', action: 'retry' },
    rejected: { title: 'Udbyderen afviste kaldet', text: 'Kontrollér forbindelsen og modelvalget, og prøv igen.', action: 'connection' },
    network: { title: 'Forbindelsen til AI’en blev afbrudt', text: 'Kontrollér internetforbindelsen, og prøv igen.', action: 'retry' },
    idle: { title: 'AI’en svarede ikke', text: 'Modellen svarede ikke i lang tid, så Aura stoppede kaldet.', action: 'retry' },
    total: { title: 'Svaret tog for lang tid', text: 'AI’en blev ved i lang tid, så Aura stoppede kaldet. Din besked er bevaret. Prøv igen, gerne med en mindre opgave.', action: 'retry' },
    engine: { title: 'AI-motoren stoppede', text: 'Aura starter motoren igen, når du sender beskeden.', action: 'retry' },
    // Den gemte AI-session kunne ikke genoptages, og intet blev sendt. Næste afsendelse starter en ny med de seneste beskeder (Q:B1-2).
    session: { title: 'AI-sessionen kunne ikke fortsætte', text: 'Intet er sendt. Send beskeden igen, så starter Aura en ny AI-session, og de seneste beskeder følger med som tekst.', action: 'retry' },
    model: { title: 'AI’en kunne ikke gennemføre opgaven', text: 'Prøv igen. Virker det stadig ikke, så vælg en anden model.', action: 'retry' },
    start: { title: 'Opgaven kunne ikke starte', text: 'Aura kunne ikke starte AI’en.', action: 'retry' }
  };
  const failureText = kind => failures[kind] || failures.model;
  // Statuslinjen, mens Aura venter på næste forsøg efter en forbigående fejl. retry kommer fra hovedprocessen (model.retry):
  // forsøget, tidspunktet for næste forsøg, HTTP-status og fejlens type (K5). HTTP-status hører til detaljerne og står ikke i
  // statuslinjens første lag (N:B1-3); udbyderens egen besked med status står i Aktivitet (core/chat-session.cjs).
  function retryText(retry, now = Date.now()) {
    if (!retry) return '';
    const seconds = Number.isFinite(retry.next) ? Math.ceil((retry.next - now) / 1000) : null;
    const when = seconds === null ? 'om lidt' : seconds <= 0 ? 'nu' : seconds >= 120 ? `om ${Math.round(seconds / 60)} min` : `om ${seconds} s`;
    const why = { limit: 'Udbyderen afviser lige nu.', server: 'Udbyderens server svarer med en fejl.', network: 'Forbindelsen til udbyderen blev afbrudt.' }[retry.kind] || 'Udbyderen svarede ikke som ventet.';
    return `${why} Aura prøver igen ${when}${Number.isInteger(retry.attempt) ? ` (forsøg ${retry.attempt + 1})` : ''}. Du kan vente eller stoppe.`;
  }
  // Kommandoens faktiske resultat. En afsluttet kommando er ikke det samme som en bestået test.
  function commandResult(tool) {
    if (tool.status === 'error') return { ok: false, text: tool.error ? `Mislykkedes: ${tool.error}` : 'Mislykkedes' };
    if (Number.isInteger(tool.exit)) return tool.exit === 0 ? { ok: true, text: 'Afsluttet uden fejl (kode 0)' } : { ok: false, text: `Afsluttet med fejl (kode ${tool.exit})` };
    return { ok: null, text: tool.status === 'completed' ? 'Afsluttet; afslutningskoden er ukendt' : 'Blev ikke færdig' };
  }
  // Kun hovedprocessens kanoniske nøgle må samle kort. Uden den er hvert id sit
  // eget kort; en enslydende titel eller sti er ikke bevis på samme adgang.
  const groupKey = p => p?.policy?.key && p.policy.match ? p.policy.key : `request:${p?.id || ''}`;
  // Kortsamlingen (beslutning 10. november 2026): hvad et ja til resten af opgaven i projektmappen dækker, og hvad der stadig spørger.
  // collect kommer fra hovedprocessen: commands, når sandkassen kører i motoren, og search, når søgevagten er der (coversProjectFolder).
  const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} og ${items.at(-1)}`;
  function collectScope(collect) {
    const covered = ['ændre filer i projektet', ...(collect?.search ? ['søge i projektets filer'] : []), ...(collect?.commands ? ['køre kommandoer isoleret i projektet'] : [])];
    const asks = ['beskyttede filer', 'mapper uden for projektet', ...(collect?.commands ? [] : ['kommandoer']), 'nettet', 'udgivelse'];
    const sentence = list(asks);
    return { covered: list(covered), asks: sentence[0].toUpperCase() + sentence.slice(1) + '.' };
  }
  // «Godkend alt i denne samtale» dækker aldrig hjemmesider, mapper uden for projektet, søgning eller kort uden match (fx beskyttede filer) og
  // aldrig låste handlinger (approveAllApplies i core/chat-session.cjs). På de kort vises knappen ikke (Q:A-4). En kommando uden isolation, der
  // nævner beskyttede navne, dækkes heller ikke.
  function approveAllCovers(policy) {
    const kind = policy?.match?.kind;
    return Boolean(kind) && policy.blockedMode !== true && !['grep', 'external_directory', 'webfetch'].includes(kind) && !(kind === 'bash' && policy.commandProtected === true);
  }
  function receiptText({ count = 1, label = 'handlingen', allow = true, scope, message, automatic = false, collect }) {
    const number = `${count} ${count === 1 ? 'handling' : 'handlinger'}`;
    if (!allow) return message ? `Du afviste ${number} og skrev: ${message}` : `Du afviste ${number}. AI’en stopper.`;
    if (automatic) return `${number} godkendt automatisk: ${label}.`;
    if (scope === 'collect') return `${number} godkendt: ${label}. Resten af opgaven må AI’en ${collectScope(collect).covered} uden at spørge.`;
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
  const api = { serverRepairDraft, directoryTitle, parseUnifiedDiff, commandHints, failureText, retryText, commandResult, groupKey, receiptText, diffPage, collectScope, approveAllCovers };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ApprovalView = api;
})(typeof window === 'object' ? window : globalThis);
