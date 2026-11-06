// Systemoversigten i almindeligt dansk: tekst og et enkelt diagram. Rene funktioner uden DOM, så de kan afprøves i Node.
(root => {
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  // Tre-fire sætninger, som en person uden teknisk baggrund kan læse.
  function summary(model) {
    const lines = [];
    const tech = model.technologies.map(t => t.name);
    lines.push(tech.length ? `Appen bruger ${list(tech)}.` : 'Appen bruger ingen kendte teknologier ud over almindelig HTML.');
    const outside = model.services.filter(s => s.kind !== 'Hosting');
    if (!outside.length) lines.push('Appen henter ikke noget fra eksterne tjenester, som oversigten kan se.');
    else lines.push(`Appen kalder ${outside.length === 1 ? 'én ekstern tjeneste' : `${outside.length} eksterne tjenester`}: ${list(outside.map(s => s.name))}.`);
    const ai = model.externalAI || [];
    if (ai.length) lines.push(`Data kan blive sendt til AI-leverandør${ai.length > 1 ? 'er' : ''}: ${list(ai.map(s => `${s.name}${s.hq ? ` (${s.hq})` : ''}`))}.`);
    lines.push(model.hosting.length ? `Appen er sat op til at blive hostet hos ${list(model.hosting.map(h => h.provider))}.` : 'Oversigten kan ikke se, hvor appen hostes. Det bestemmer du, når du udgiver den.');
    if (model.secrets.length) lines.push(`Appen forventer ${model.secrets.length === 1 ? 'en hemmelighed' : `${model.secrets.length} hemmeligheder`} i sit miljø (kun navnene vises).`);
    if (model.secretsUncertain) lines.push(model.secrets.length ? 'Listen over hemmeligheder kan være ufuldstændig, fordi koden også henter miljøet på måder, oversigten ikke genkender.' : 'Oversigten kan ikke sige, om appen bruger hemmeligheder: koden henter miljøet på måder, den ikke genkender, eller filer var for store at læse.');
    return lines;
  }
  function list(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} og ${items.at(-1)}`; }

  // Et lagdelt diagram: brugeren, appen, de eksterne tjenester og hosting. Kun navne, ingen fantasi om dataflow ud over det, koden viser.
  function diagram(model) {
    const box = (x, y, w, h, title, sub, tone) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="so-box so-${tone}"/><text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" class="so-title">${esc(title)}</text>${sub ? `<text x="${x + w / 2}" y="${y + 40}" text-anchor="middle" class="so-sub">${esc(sub.length > 34 ? sub.slice(0, 33) + '…' : sub)}</text>` : ''}</g>`;
    const services = model.services.filter(s => s.kind !== 'Hosting').slice(0, 6), hosts = model.hosting.slice(0, 3);
    const rows = Math.max(services.length, hosts.length, 1), height = 90 + rows * 66;
    const parts = [box(10, 10, 150, 54, 'Brugeren', 'i browseren', 'user'), box(210, 10, 200, 54, 'Din app', model.technologies.slice(0, 3).map(t => t.name).join(', '), 'app')];
    parts.push(`<path d="M160 37 H210" class="so-line"/>`);
    services.forEach((s, i) => { const y = 90 + i * 66; parts.push(box(460, y, 230, 54, s.name, [s.kind, s.hq].filter(Boolean).join(' · '), s.kind === 'AI' ? 'ai' : 'ext'), `<path d="M410 37 H435 V${y + 27} H460" class="so-line" fill="none"/>`); });
    // Hosting ligger under appen: det er appen, der hostes.
    hosts.forEach((h, i) => { const y = 90 + i * 66; parts.push(box(210, y, 200, 54, h.provider, 'hosting', 'host'), `<path d="M310 64 V${y}" class="so-line" fill="none"/>`); });
    return `<svg viewBox="0 0 700 ${height}" role="img" aria-label="Diagram over appens dele og eksterne tjenester" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
  }
  // Teksten under Hemmeligheder, når listen er tom: kun «ingen fundet», når oversigten genkendte alle opslag.
  const noSecrets = model => model.secretsUncertain ? 'Oversigten fandt ingen navne, men den kan ikke se alle måder at hente hemmeligheder på. Tom liste betyder ikke, at der ingen er. Selve værdierne vises aldrig.' : 'Ingen navne på hemmeligheder fundet. Selve værdierne vises aldrig.';
  const api = { summary, diagram, list, noSecrets };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SystemOverviewView = api;
})(typeof window === 'object' ? window : globalThis);
