// Opstarten kan beskrives i .aura/preview.json i projektet, så AI'en kan skrive den, og brugeren gennemgår kommandoerne som sædvanligt.
// Filen er projektindhold og dermed ikke betroet: den læses kun, hvis den er en lille, almindelig fil med gyldige tjenester.
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeRuntimeConfig } = require('./project-runtime.cjs');

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

// Brugerens egne indstillinger (tjenester eller Enkel hjemmeside) går forud. Uden dem bruges filen, hvis den findes.
async function effectiveRuntime(root, stored) {
  const own = normalizeRuntimeConfig(stored || {});
  if (own.mode === 'static' || own.services?.length) return own;
  const fromFile = await readStartupFile(root);
  // Netlisten kommer kun fra brugerens egne gemte indstillinger, aldrig fra .aura/preview.json.
  return fromFile ? { ...own, ...fromFile, ...(own.network ? { network: own.network } : {}) } : own;
}

module.exports = { readStartupFile, effectiveRuntime };
