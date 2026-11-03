(function (root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else root.ShareView = view;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const time = at => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' }) : 'tidspunkt ikke registreret';
  const version = r => `${r.version?.name || 'Gemt version'} · ${time(r.version?.at)}`;
  const provider = name => ({ komplai: 'komplai Run', azure: 'Azure Static Web Apps', vercel: 'Vercel', promte: 'Promte Apps', 'github-pages': 'GitHub Pages', cloudflare: 'Cloudflare Pages' })[name] || 'Udbyder';
  const states = { PREPARED: 'Version oprettet; upload ikke bekræftet', REVIEWING: 'Gennemgås hos udbyderen', BLOCKED: 'Kræver handling hos udbyderen', REJECTED: 'Afvist hos udbyderen', SUBMITTING: 'Upload påbegyndt; udfald endnu ikke bekræftet', UNKNOWN: 'Upload ikke bekræftet', QUEUED: 'I kø', BUILDING: 'Bygger', INITIALIZING: 'Forbereder', UPLOADED: 'Uploadsvaret er modtaget', READY: 'Udgivet ifølge udbyderen', ERROR: 'Fejl hos udbyderen', CANCELED: 'Annulleret hos udbyderen', AWAITING_UPDATE: 'Den nye version er endnu ikke bekræftet', REPLACED: 'En nyere version er udgivet siden', UNPUBLISHED: 'Appen er ikke udgivet lige nu', REMOVED: 'Appen er slettet hos komplai' };
  const address = value => { try { const u = new URL(value); return u.hostname + (u.pathname === '/' ? '' : u.pathname); } catch { return ''; } };
  const host = value => { try { return new URL(value).hostname; } catch { return ''; } };
  function destination(r) {
    if (r.config.provider === 'promte') return `Promte Apps · ${r.target.owner || r.config.workspaceId} · ${r.target.name || 'App-arbejdsområde'}`;
    if (['github-pages', 'cloudflare'].includes(r.config.provider)) return `${provider(r.config.provider)} · ${r.config.repository} · ${r.config.branch} · offentlig hjemmeside`;
    if (r.config.provider === 'komplai') return `komplai Run · ${r.target.owner || 'organisation'} · ${host(r.url) || host(r.target.url) || r.target.host}`;
    return `${provider(r.config.provider)} · ${r.config.provider === 'azure' ? `${r.config.subscription || 'abonnement ikke registreret'} / ${r.config.group || 'ressourcegruppe ikke registreret'}` : r.config.scope || r.target.owner || 'konto fra login'} · ${r.target.name || r.config.project} · ${r.config.provider === 'azure' ? 'harness-test' : 'preview'}`; }
  function checks(r) {
    const c = r.checks;
    let site = 'Ikke kontrolleret', content = 'Ikke kontrolleret';
    if (c?.site.status === 'unreachable') site = 'Adressen kunne ikke nås';
    if (c?.site.status === 'answered') {
      const http = c.site.http;
      site = `${http === 401 || http === 403 ? 'Kræver adgang' : http >= 300 && http < 400 ? 'Viderestiller' : http >= 200 && http < 300 ? 'Svar modtaget' : 'Fejlsvar'} · HTTP ${http} uden login`;
    }
    const contents = { matched: 'Startsiden matcher den godkendte fil', different: 'Startsiden matcher ikke den godkendte fil', built: 'Bygges hos udbyderen; filmatch er ikke kontrolleret', 'too-large': 'Svaret er for stort til filkontrollen', unreadable: 'Indholdet kunne ikke læses' };
    content = contents[c?.content.status] || content;
    const komplai = r.config.provider === 'komplai';
    const visibility = c?.provider.status === 'checked' ? c.provider.visibility : null;
    const access = visibility === 'private' ? 'Kun organisationens medlemmer efter login med komplai' : visibility === 'public' ? 'Alle med linket' : null;
    return [
      ['Udbyder', c?.provider.status === 'unknown' ? `Seneste statuskontrol mislykkedes · ${time(c.at)}` : `${states[r.state] || 'Ukendt udbyderstatus'}${c ? ` · ${time(c.at)}` : r.checkedAt ? ' · tidligere registreret; genkontrollér' : ['UNKNOWN', 'SUBMITTING'].includes(r.state) ? ' · registreret lokalt' : ' · fra uploadsvaret'}`],
      ...(komplai ? [['Aktuel adgang', access ? `${access} ifølge komplai.${visibility !== r.config.visibility ? ' Det afviger fra dit valg ved upload.' : ''}` : 'Ikke kontrolleret. Åbn appen i komplai for at se den aktuelle adgang.']] : []),
      ['Startside', site], ['Indhold', content],
      ['Testerens adgang', komplai && visibility === 'private' ? 'Ikke afprøvet. Bed en kollega i organisationen åbne linket; et svar fra startsiden beviser ikke adgang til resten af appen.' : 'Ikke afprøvet. Åbn linket som testpersonen; et svar fra startsiden beviser ikke adgang til resten af appen.']
    ];
  }
  function identity(r) {
    return {
      name: r.target.name || r.config.name || r.config.project || 'Din app',
      // Azure-inspektionens host er produktionsadressen, aldrig testmiljøet.
      address: r.config.provider === 'promte' ? 'Åbnes i Promte' : ['github-pages', 'cloudflare'].includes(r.config.provider) ? address(r.url) || address(r.target.url) || 'Adresse afventer udgivelse' : r.config.provider === 'azure' ? host(r.url) || 'Testadresse afventer udgivelse' : host(r.url) || host(r.target.url) || r.target.host || 'Adresse afventer udgivelse',
      account: [provider(r.config.provider), r.target.owner || r.config.scope].filter(Boolean).join(' · ')
    };
  }
  // Upload, adgang og indhold er forskellige beviser. Et READY-svar alene giver
  // aldrig en grøn indholdskontrol eller bevis for en persons adgang.
  function receiptSummary(r) {
    const c = r.checks, known = c?.provider?.status === 'checked', failed = c?.provider?.status === 'unknown';
    const pending = !r.id || ['SUBMITTING', 'UNKNOWN'].includes(r.state), legacy = r.checkedAt && !c;
    const titles = { PREPARED: 'Upload afventer', REVIEWING: 'Under gennemgang', BLOCKED: 'Kræver handling', REJECTED: 'Udgivelsen blev afvist', READY: 'Udgivet', UPLOADED: 'Upload modtaget', QUEUED: 'I kø', BUILDING: 'Bygger appen', INITIALIZING: 'Forbereder appen', ERROR: 'Udgivelsen fejlede', CANCELED: 'Udgivelsen blev annulleret', REPLACED: 'En nyere version er udgivet', UNPUBLISHED: 'Appen er ikke udgivet', REMOVED: 'Appen er slettet', AWAITING_UPDATE: 'Afventer den nye version' };
    const publication = pending ? { title: 'Upload ikke bekræftet', detail: 'Åbn udbyderens oversigt, før du prøver en ny upload.', tone: 'warning' }
      : failed ? { title: 'Status kunne ikke hentes', detail: 'Uploadsvaret er gemt. Prøv statuskontrollen igen.', tone: 'warning' }
      : legacy ? { title: 'Tidligere status: ' + (titles[r.state] || 'ukendt'), detail: 'Ældre kvittering. Kontrollér status igen.', tone: 'neutral' }
      : { title: titles[r.state] || 'Status er ukendt', detail: r.state === 'PREPARED' ? 'Versionen er oprettet. Kontrollér status, før du uploader igen.' : known ? 'Bekræftet af ' + provider(r.config.provider) + '.' : r.state === 'UPLOADED' ? 'Den aktive version er endnu ikke bekræftet.' : 'Fra udbyderens uploadsvar. Status kan kontrolleres igen.', tone: known && r.state === 'READY' ? 'positive' : ['ERROR', 'CANCELED', 'REMOVED', 'BLOCKED', 'REJECTED'].includes(r.state) ? 'warning' : 'neutral' };
    // Udbyderen har modtaget versionen, men adressen svarer ikke endnu eller giver en fejlside. Så er appen ikke klar, og kortet må ikke se færdigt ud.
    const notReady = known && r.state === 'READY' && (c.site?.status === 'unreachable' || (c.site?.status === 'answered' && (c.site.http === 404 || c.site.http >= 500)));
    if (notReady) publication.title = 'Appen er ikke klar endnu', publication.detail = 'Udbyderen har modtaget din version, men adressen svarer ikke endnu. Prøv kontrollen igen om lidt, før du åbner appen.', publication.tone = 'warning';
    const visibility = known ? c.provider.visibility : null;
    const changed = visibility && visibility !== r.config.visibility;
    const exposed = visibility === 'private' && c?.site?.status === 'answered' && c.site.http >= 200 && c.site.http < 300 && c?.content?.status === 'matched';
    const access = r.config.provider === 'promte' ? { title: 'Adgang via Promte', detail: 'Åbn arbejdsområdet i Promte for at afprøve appen og dens adgang.', tone: 'neutral' } : r.config.provider !== 'komplai' ? { title: 'Adgang skal afprøves', detail: 'Åbn linket som den person, der skal bruge appen.', tone: 'neutral' }
      : exposed ? { title: 'Startsiden er åben', detail: 'komplai angiver privat adgang, men startsiden kunne hentes uden login.', tone: 'warning' }
      : visibility === 'private' ? { title: 'Kun organisationen', detail: 'Log ind med komplai for at åbne appen.', tone: changed ? 'warning' : 'neutral' }
      : visibility === 'public' ? { title: 'Alle med linket', detail: 'Appen er offentlig.', tone: changed ? 'warning' : 'neutral' }
      : { title: 'Adgang ikke kontrolleret', detail: r.config.visibility === 'private' ? 'Valgt ved upload: kun organisationen.' : r.config.visibility === 'public' ? 'Valgt ved upload: alle med linket.' : 'Se adgangsindstillingerne hos udbyderen.', tone: 'neutral' };
    if (changed) access.detail += ' Adgangen er ændret siden uploaden.';
    let verification = { title: 'Startside ikke kontrolleret', detail: 'Kontrollér status og startside, eller prøv appen.', tone: 'neutral', hidden: true };
    if (pending) verification = { title: 'Indhold ikke kontrolleret', detail: '', tone: 'neutral', hidden: true };
    else if (failed) verification = { title: 'Kontrollen kunne ikke gennemføres', detail: 'Indhold og adgang skal kontrolleres igen.', tone: 'neutral' };
    else if (exposed) verification = { title: 'Kontrollér adgangsindstillingerne', detail: 'Den godkendte startside blev vist uden login, selv om appen er markeret privat.', tone: 'warning' };
    else if (c?.content?.status === 'matched') verification = { title: 'Startsiden matcher den gemte fil', detail: '', tone: 'positive' };
    else if (c?.content?.status === 'different') verification = { title: 'Startsiden er anderledes', detail: 'Indholdet matcher ikke den godkendte fil.', tone: 'warning' };
    else if (c?.site?.status === 'unreachable') verification = { title: 'Startsiden kunne ikke nås', detail: 'Prøv kontrollen igen, eller åbn appen.', tone: 'warning' };
    else if (c?.site?.status === 'answered' && [401, 403].includes(c.site.http)) verification = { title: visibility === 'private' ? 'Medlemsadgang er ikke afprøvet' : 'Startsiden kræver adgang', detail: visibility === 'private' ? 'Besøg uden login blev afvist. Åbn appen for at afprøve din adgang.' : 'Åbn linket med testpersonens adgang.', tone: 'neutral', hidden: visibility === 'private' };
    else if (c?.content?.status === 'built') verification = { title: 'Filernes indhold er ikke sammenlignet', detail: 'Udbyderen bygger appen fra kildekoden. Prøv resultatet i browseren.', tone: 'neutral', hidden: true };
    else if (c?.site?.status === 'answered') verification = { title: c.site.http >= 200 && c.site.http < 300 ? 'Startsiden svarer' : 'Kontrollér startsiden', detail: 'Indholdet er ikke bekræftet. Se kontrollens detaljer.', tone: c.site.http >= 400 ? 'warning' : 'neutral' };
    return { publication, access, verification };
  }
  const scope = c => c?.copyCount ? `Udgivelsen bruger projektets gemte version. ${c.copyCount === 1 ? 'En samtalekopi er' : `${c.copyCount} samtalekopier er`} endnu ikke flettet ind og kommer ikke med. Gennemgå ændringerne og flet dem ind, hvis de skal med.` : 'Udgivelsen bruger projektets gemte version. Ugemte rettelser kommer ikke med.';
  return { time, version, provider, destination, checks, identity, receiptSummary, scope };
});
