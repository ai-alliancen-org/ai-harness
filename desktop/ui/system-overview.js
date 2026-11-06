// Fanen Overblik: hvad appen bruger, hvilke eksterne tjenester den kalder, og hvor den hostes. Udledt af projektets filer.
(() => {
  let loaded = null, loading = false, generation = 0, shown = false;
  const body = () => $('#overview-body');
  function section(title, items, empty) {
    const box = node('section', undefined, 'overview-section'); box.append(node('h3', title));
    if (!items.length) box.append(node('p', empty, 'hint')); else { const ul = node('ul', undefined, 'overview-list'); for (const item of items) ul.append(item); box.append(ul); }
    return box;
  }
  function row(title, meta) { const li = node('li'); li.append(node('strong', title)); if (meta) li.append(node('span', ' · ' + meta, 'overview-meta')); return li; }
  function render(model) {
    shown = true;
    const view = window.SystemOverviewView, root = body(); root.replaceChildren();
    const lead = node('div', undefined, 'overview-lead'); for (const line of view.summary(model)) lead.append(node('p', line)); root.append(lead);
    const figure = node('div', undefined, 'overview-diagram'); figure.innerHTML = view.diagram(model); root.append(figure);
    const details = node('details', undefined, 'overview-details'); details.append(node('summary', 'Se detaljer'));
    details.append(
      section('Teknologier', model.technologies.map(t => row(t.name, `${t.kind} · ${t.source}`)), 'Ingen kendte teknologier fundet.'),
      section('Eksterne tjenester', model.services.map(s => row(s.name, [s.kind, s.owner && `leverandør ${s.owner}`, s.hq && `hovedsæde ${s.hq}`, s.known ? '' : 'ukendt leverandør', s.host].filter(Boolean).join(' · '))), 'Ingen eksterne tjenester fundet i koden.'),
      section('Hosting', model.hosting.map(h => row(h.provider, `fundet i ${h.evidence}`)), 'Ingen hosting fundet i projektets filer.'),
      section('Hemmeligheder appen forventer', model.secrets.map(s => row(s.name, s.files.join(', '))), view.noSecrets(model)));
    root.append(details);
    root.append(node('p', `Oversigten bygger på ${model.scanned} kodefiler og viser kun det, der står i koden og konfigurationen. Hvor dataene ligger hos en leverandør, kan koden ikke fortælle.${model.notes.length ? ' ' + model.notes.join(' ') : ''}`, 'hint'));
  }
  async function load() {
    if (loading) return;
    // Et projektskift eller en afsluttet opgave under indlæsningen gør svaret gammelt: det vises ikke, og der læses igen.
    const mine = generation; loading = true; $('#overview-status').textContent = 'Læser projektet …';
    try {
      const result = await call('systemOverview'), model = result.value || result;
      if (mine === generation) { loaded = model; render(model); $('#overview-status').textContent = 'Overblik over appen'; }
    }
    catch (error) { if (mine === generation) { if (shown) $('#overview-status').textContent = 'Kunne ikke opdatere overblikket: ' + error.message; else { body().replaceChildren(node('p', 'Overblikket kunne ikke læses: ' + error.message, 'hint')); $('#overview-status').textContent = 'Fejl'; } } }
    finally { loading = false; if (mine !== generation && visible()) load(); }
  }
  const visible = () => !$('#panel-overview').inert;
  $('#overview-refresh').onclick = () => load();
  window.systemOverview = { show: () => { if (!loaded) load(); }, refresh: load, stale: () => { loaded = null; generation++; },
    invalidate: () => { loaded = null; generation++; shown = false; if (!loading) { body().replaceChildren(); $('#overview-status').textContent = 'Overblik over appen'; } } };
})();
