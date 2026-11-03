// Ende-til-ende-prøve for kortene (årsag 13): en typisk byggeopgave i et nyt projekt må højst give fem godkendelseskort. Forespørgslerne er
// de rigtige, optagne fra OpenCode 1.18.33; Aura afgør dem med de standarder, et nyt projekt får (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'opencode-1.18.33');
const MAX_KORT = 5;
// En typisk opgave: fire filændringer i projektet, tre kommandoer i projektet (bygning, kort kommando, kommando i en undermappe).
const FORLOEB = [
  'free-git-filer__write-inde-absolut__1-edit', 'free-git-filer__write-inde-ny-mappe__1-edit', 'free-git-filer__write-inde-relativ__1-edit', 'free-git-filer__edit-inde-absolut__1-edit',
  'byg-git-soeg__bash-npm-build__1-bash', 'byg-git-soeg__bash-kort__1-bash', 'byg-git-soeg__bash-workdir-inde__1-bash'
];

async function antalKort(t, { defaults }) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kortgraense-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const projekt = path.join(base, 'projekt'), ekstern = path.join(base, 'ekstern'), scratch = path.join(projekt, '.aura', 'tmp');
  await fs.mkdir(path.join(projekt, 'sub'), { recursive: true }); await fs.mkdir(ekstern); await fs.mkdir(scratch, { recursive: true });
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  if (defaults) await policy.applyNewProjectDefaults(projekt, { commandsAvailable: true });
  const fyld = value => JSON.parse(JSON.stringify(value).replaceAll('${ROOT}', projekt).replaceAll('${OUTSIDE}', ekstern).replaceAll('${BASE}', base));
  const kontekst = { projectRoot: projekt, workspaceRoot: projekt, scratchRoot: scratch, mode: 'free', taskRules: new Set(), commandSandbox: true, commandSandboxSupported: true, autoCommandsSnapshot: defaults };
  let kort = 0; const kortliste = [];
  for (const navn of FORLOEB) {
    const input = fyld(JSON.parse(await fs.readFile(path.join(FIXTURES, navn + '.json'), 'utf8')).policyInput);
    const result = await policy.allowed(kontekst, input).catch(() => ({ allowed: false }));
    if (!result.allowed) { kort++; kortliste.push(navn); }
  }
  return { kort, kortliste };
}

test('en typisk byggeopgave i et nyt projekt giver højst fem kort', async t => {
  const { kort, kortliste } = await antalKort(t, { defaults: true });
  assert.ok(kort <= MAX_KORT, `${kort} kort: ${kortliste.join(', ')}`);
});

test('uden standarderne ville den samme opgave give mange flere kort (vagten kan fyre)', async t => {
  const { kort } = await antalKort(t, { defaults: false });
  assert.ok(kort > MAX_KORT, `kun ${kort} kort uden standarder; prøven ville ikke kunne fange en tilbagegang`);
});
