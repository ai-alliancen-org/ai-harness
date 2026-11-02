// AI's arbejdsmappe .aura/tmp hører ikke til projektets ændringer eller kopier. Ellers ville midlertidige filer
// vises som brugerens ændringer, og en kopi af samtalen ville tage dem med (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const changes = require('../core/changes.cjs');

test('.aura er udelukket fra ændringsoversigten', async t => {
  const rod = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-udeluk-'));
  t.after(() => fs.rm(rod, { recursive: true, force: true }));
  await fs.mkdir(path.join(rod, '.aura', 'tmp', 'op-1'), { recursive: true });
  await fs.writeFile(path.join(rod, '.aura', 'tmp', 'op-1', 'midlertidig.txt'), 'x');
  await fs.writeFile(path.join(rod, 'synlig.txt'), 'y');
  const fundet = await changes.capture(rod).then(result => [...result.files.keys()]);
  assert.ok(fundet.some(name => name.includes('synlig.txt')), 'projektets egne filer skal med');
  assert.equal(fundet.some(name => name.includes('.aura')), false, 'AI-mappen skal ikke med: ' + fundet.join(', '));
});
