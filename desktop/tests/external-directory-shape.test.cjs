// OpenCode 1.18.33 sender en mappeadgang uden for projektet med metadata.filepath og metadata.parentDir, og
// patterns med <mappe>/*. Aura læste kun metadata.path, så kortet blev "Denne handling", som kun kan tillades én
// gang, og mappen kunne aldrig huskes. Prøven bruger samme form som den optagede forespørgsel i tests/fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');

async function rammer() {
  const rod = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-mappe-'));
  const projekt = path.join(rod, 'projekt'), udenfor = path.join(rod, 'ekstern');
  await fs.mkdir(projekt); await fs.mkdir(udenfor);
  return { rod, projekt, udenfor };
}

test('en mappeadgang uden for projektet får navn og kan huskes, ligesom OpenCodes rigtige form', async t => {
  const { rod, projekt, udenfor } = await rammer();
  t.after(() => fs.rm(rod, { recursive: true, force: true }));
  const politik = new ApprovalsPolicy({ project: async () => ({ approvals: null }) });
  const kontekst = { projectRoot: projekt, workspaceRoot: projekt };
  const d = await politik.describe(kontekst, {
    id: 'p1', permission: 'external_directory',
    patterns: [udenfor + '/*'],
    metadata: { filepath: udenfor, parentDir: udenfor }
  });
  assert.notEqual(d.label, 'Denne handling', 'kortet skal have et navn, ikke en generisk tekst');
  assert.match(d.label, /^Mappeadgang: /);
  assert.equal(d.persistable, true, 'mappen kan huskes');
  assert.equal(d.folder, await fs.realpath(udenfor), 'mappen er den, der huskes (kanonisk sti, macOS har /var som /private/var)');
});
