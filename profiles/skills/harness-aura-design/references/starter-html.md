# Valgfri HTML-starter

Dette er et mærket demonstrationseksempel til brugerprojektet. Det er ikke en Aura-skærm eller en færdig sagsløsning. Materialisér kun efter normale filgodkendelser, og tilpas til det accepterede behov. Generér `tokens.css`, og kopiér de relevante komponenter fra `starter-css.md` til `app.css`. Ingen netværk, eksterne fonte, logoer eller pakker er nødvendige.

Demoen har ingen backend, login, adgangsstyring eller varig sag-/kladdeopbevaring. Syntetiske sager er tydeligt markeret. `[Logo]` erstattes kun med en godkendt lokal logofil; indlejr ikke ubetroet SVG som HTML.

```html
<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eksempel · Sagsoverblik</title>
  <link rel="stylesheet" href="tokens.css">
  <link rel="stylesheet" href="app.css">
</head>
<body>
  <a class="skip-link" href="#indhold">Spring til indhold</a>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#indhold">[Logo] <span>Sagsoverblik · eksempel</span></a>
      <nav aria-label="Hovedmenu"><a href="#oversigt">Oversigt</a><a href="#ny-sag">Opret eksempel</a></nav>
      <button class="btn btn-secondary" id="theme" type="button" aria-label="Brug mørkt tema">Mørkt tema</button>
    </header>
    <main class="main stack" id="indhold">
      <div id="oversigt">
        <p class="eyebrow">Syntetisk demonstration</p>
        <h1>Mine eksempelsager</h1>
        <p>Afprøv forløbet med syntetiske data. Intet sendes, og sagerne forsvinder ved genindlæsning.</p>
      </div>
      <section class="grid" aria-label="Nøgletal">
        <article class="card"><h2>Åbne eksempler</h2><p class="kpi-value" id="count">0</p></article>
        <article class="card"><h2>Afprøv først</h2><p>Tastatur, kontrast, zoom, små skærme og fejltilstande.</p></article>
      </section>
      <section class="grid">
        <form class="card stack" id="form" novalidate aria-labelledby="ny-sag">
          <h2 id="ny-sag">Opret eksempelsag</h2>
          <div class="field">
            <label for="category">Kategori</label>
            <select class="select" id="category" required>
              <option value="">Vælg kategori</option><option>Hardware</option><option>Software</option><option>Adgang og login</option>
            </select>
          </div>
          <div class="field">
            <label for="description">Beskriv det syntetiske problem</label>
            <textarea class="textarea" id="description" required aria-describedby="description-hint"></textarea>
            <span class="hint" id="description-hint">Indsæt ikke rigtige navne, borgersager eller adgangsoplysninger.</span>
          </div>
          <div class="cluster">
            <button class="btn btn-primary" type="submit">Opret eksempel</button>
            <button class="btn btn-secondary" type="reset">Ryd felterne</button>
          </div>
        </form>
        <div class="stack">
          <div class="table-wrap" tabindex="0" role="region" aria-label="Liste over syntetiske eksempelsager">
            <table><thead><tr><th scope="col">Eksempel</th><th scope="col">Kategori</th><th scope="col">Beskrivelse</th><th scope="col">Oprettet</th></tr></thead><tbody id="rows"></tbody></table>
          </div>
          <div class="empty" id="empty">Ingen eksempler endnu. Opret en syntetisk sag for at afprøve forløbet.</div>
        </div>
      </section>
      <p class="notice">Eksemplet dokumenterer kun et lokalt UI-forløb; det er ikke en fungerende myndighedstjeneste.</p>
    </main>
    <footer class="footer">[Organisation] · Afklar rettigheder, data, drift og tilgængelighed før udgivelse.</footer>
  </div>
  <div class="toast-region" role="status" aria-live="polite" aria-atomic="true" id="status"></div>
  <script>
    const root = document.documentElement;
    const themeButton = document.getElementById('theme');
    const systemDark = matchMedia('(prefers-color-scheme: dark)');
    const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches;
    const themeLabel = () => {
      const text = dark() ? 'Brug lyst tema' : 'Brug mørkt tema';
      themeButton.textContent = text;
      themeButton.setAttribute('aria-label', text);
    };
    try {
      const saved = localStorage.getItem('example-theme');
      if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
    } catch (_) {}
    themeButton.addEventListener('click', () => {
      root.dataset.theme = dark() ? 'light' : 'dark';
      try { localStorage.setItem('example-theme', root.dataset.theme); } catch (_) {}
      themeLabel();
    });
    systemDark.addEventListener('change', themeLabel);
    themeLabel();

    const cases = [];
    const form = document.getElementById('form');
    const fields = [...form.querySelectorAll('[required]')];
    const rows = document.getElementById('rows');
    const numberFormat = new Intl.NumberFormat('da-DK');
    const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium' });
    function render() {
      rows.replaceChildren();
      for (const item of cases) {
        const row = document.createElement('tr');
        for (const text of ['Eksempel ' + numberFormat.format(item.id), item.category, item.description, dateFormat.format(item.date)]) {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        }
        rows.append(row);
      }
      document.getElementById('empty').hidden = cases.length > 0;
      document.getElementById('count').textContent = numberFormat.format(cases.length);
    }
    function error(field, message) {
      const id = field.id + '-error';
      document.getElementById(id)?.remove();
      const descriptions = (field.getAttribute('aria-describedby') || '').split(' ').filter(value => value && value !== id);
      if (message) {
        const label = document.createElement('span');
        label.id = id; label.className = 'error'; label.textContent = message;
        field.closest('.field').append(label);
        field.setAttribute('aria-invalid', 'true');
        descriptions.push(id);
      } else field.removeAttribute('aria-invalid');
      if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
      else field.removeAttribute('aria-describedby');
    }
    for (const field of fields) {
      for (const type of ['input', 'change']) field.addEventListener(type, () => {
        if (field.value.trim()) error(field, null);
      });
    }
    form.addEventListener('reset', () => fields.forEach(field => error(field, null)));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const invalid = fields.filter(field => !field.value.trim());
      for (const field of fields) error(field, invalid.includes(field) ? (field.tagName === 'SELECT' ? 'Vælg en kategori.' : 'Beskriv det syntetiske problem.') : null);
      if (invalid.length) { invalid[0].focus(); return; }
      cases.unshift({ id: cases.length + 1, category: fields[0].value, description: fields[1].value.trim(), date: new Date() });
      form.reset(); render();
      document.getElementById('status').textContent = 'Eksemplet er tilføjet lokalt. Det forsvinder ved genindlæsning.';
    });
    render();
  </script>
</body>
</html>
```

Selv dette lille eksempel skal afprøves. Efter kopiering skal appens faktiske krav, fejltilstande, datakilder og sprog implementeres særskilt. Gem ikke følsomme oplysninger i `localStorage`; eksemplet gemmer kun tema.
