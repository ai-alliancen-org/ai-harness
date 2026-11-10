// Opstarten kan beskrives i .aura/preview.json i projektet, så AI'en kan skrive den, og brugeren gennemgår kommandoerne som sædvanligt.
// Filen er projektindhold og dermed ikke betroet: den læses kun, hvis den er en lille, almindelig fil med gyldige tjenester.
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeRuntimeConfig, networkOrigin, NETWORK_KINDS } = require('./project-runtime.cjs');
const { NETWORK_LIMIT } = require('./preview-policy.cjs');

const MAX_BYTES = 20_000;

async function readStartupFile(root) {
  const file = path.join(root, '.aura', 'preview.json');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    // Netadgang læses aldrig fra filen: den kan skrives af AI'en, og brugeren ser kun kommandoerne og pakkerne i startdialogen.
    const { network, ...raw } = JSON.parse(await fs.readFile(file, 'utf8'));
    const config = normalizeRuntimeConfig(raw);
    return config.services?.length ? config : null;
  } catch { return null; }
}

// Brugerens gemte opstart fra appens lager. Den kan være ugyldig, fx en netliste over loftet fra en tidligere fejl eller en opstart
// gemt af en ældre version. Projektet skal alligevel altid kunne åbnes: det gyldige bruges, og resten springes over, til brugeren
// gemmer opstarten igen under Projektets indstillinger. Ugyldige og overskydende adresser falder bort, så der aldrig åbnes for mere
// end før; ugyldige tjenester falder bort, så Aura finder opstarten selv, og den gennemgås som altid, før noget køres.
function storedRuntime(stored) {
  try { return normalizeRuntimeConfig(stored || {}); } catch { /* Det gyldige reddes nedenfor. */ }
  const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const config = { mode: ['auto', 'static'].includes(raw.mode) ? raw.mode : 'auto' };
  try { if (raw.services !== undefined) config.services = normalizeRuntimeConfig({ services: raw.services }).services; } catch { /* Aura finder opstarten selv. */ }
  if (raw.network && typeof raw.network === 'object' && !Array.isArray(raw.network)) {
    config.network = {};
    for (const kind of NETWORK_KINDS) {
      const kept = [];
      for (const entry of Array.isArray(raw.network[kind]) ? raw.network[kind] : []) {
        try { const origin = networkOrigin(entry, kind); if (!kept.includes(origin)) kept.push(origin); } catch { /* Ugyldig adresse. */ }
      }
      config.network[kind] = kept.slice(0, NETWORK_LIMIT);
    }
  }
  return normalizeRuntimeConfig(config);
}

// Feltnavnene under Projektets indstillinger › Forhåndsvisning › Se detaljer (ui/index.html), så brugeren kan finde listen.
const FIELD_NAMES = { connect: 'Data og forbindelser', scripts: 'Scripts', images: 'Billeder', styles: 'Typografi og stylesheets' };
// Hvad storedRuntime sprang over, i almindeligt dansk, så redningen ikke er tavs (Q:C1-4, beta 3). null, når opstarten er gyldig.
// Projektets indstillinger viser teksten, og detaljerne står bag Se detaljer. Gem opstart (under Se detaljer ved Opstart) eller et nyt valg af opstart gemmer det,
// Aura bruger, og beskeden forsvinder.
function storedRuntimeNotice(stored) {
  try { normalizeRuntimeConfig(stored || {}); return null; } catch { /* Beskrives nedenfor. */ }
  const details = [], used = storedRuntime(stored);
  const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
  if (!raw) details.push('Den gemte opstart kunne ikke læses, så Aura bruger Automatisk.');
  else {
    if (raw.mode !== undefined && !['auto', 'static'].includes(raw.mode)) details.push('Opstartsmåden kunne ikke læses, så Aura bruger Automatisk.');
    if (raw.services !== undefined && !used.services) details.push('De gemte lokale tjenester kunne ikke bruges, så Aura finder selv projektets opstart.');
    if (raw.network !== undefined && (!raw.network || typeof raw.network !== 'object' || Array.isArray(raw.network))) details.push('Adresserne i forhåndsvisningen kunne ikke læses og er sprunget over.');
    else if (raw.network) {
      let addresses = false;
      for (const kind of ['connect', 'scripts', 'images', 'styles']) {
        const entries = raw.network[kind];
        if (entries === undefined) continue;
        if (!Array.isArray(entries)) { details.push(`Adresserne under ${FIELD_NAMES[kind]} kunne ikke læses og er sprunget over.`); addresses = true; continue; }
        const skipped = entries.length - (used.network?.[kind]?.length || 0);
        if (skipped > 0) { details.push(`${skipped} ${skipped === 1 ? 'adresse' : 'adresser'} under ${FIELD_NAMES[kind]} er sprunget over.`); addresses = true; }
      }
      if (addresses) details.push(`En adresse skal være en præcis adresse som https://eksempel.dk, og der kan højst være ${NETWORK_LIMIT} af hver slags.`);
    }
  }
  return { text: 'En del af projektets gemte opstart kunne ikke bruges og er sprunget over. Aura bruger resten. Vil du gemme opstarten igen, så åbn Se detaljer under Opstart, og tryk Gem opstart.', details };
}

// Brugerens egne indstillinger (tjenester eller Enkel hjemmeside) går forud. Uden dem bruges filen, hvis den findes.
async function effectiveRuntime(root, stored) {
  const own = storedRuntime(stored);
  if (own.mode === 'static' || own.services?.length) return own;
  const fromFile = await readStartupFile(root);
  // Netlisten kommer kun fra brugerens egne gemte indstillinger, aldrig fra .aura/preview.json.
  return fromFile ? { ...own, ...fromFile, ...(own.network ? { network: own.network } : {}) } : own;
}

module.exports = { readStartupFile, effectiveRuntime, storedRuntime, storedRuntimeNotice };
