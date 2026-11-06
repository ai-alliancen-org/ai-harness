// Ende-til-ende-prøve for kortene (årsag 13): en typisk byggeopgave i et nyt projekt må højst give fem godkendelseskort. Forespørgslerne er
// de rigtige, optagne fra OpenCode 1.19.5 (VERSION); Aura afgør dem med de standarder, et nyt projekt får (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const { VERSION } = require('../core/engine.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', `opencode-${VERSION}`);
const MAX_KORT = 5;
// En typisk opgave: fire filændringer i projektet, tre kommandoer i projektet (bygning, kort kommando, kommando i en undermappe).
const FORLOEB = [
  'free-git-filer__write-inde-absolut__1-edit', 'free-git-filer__write-inde-ny-mappe__1-edit', 'free-git-filer__write-inde-relativ__1-edit', 'free-git-filer__edit-inde-absolut__1-edit',
  'byg-git-soeg__bash-npm-build__1-bash', 'byg-git-soeg__bash-kort__1-bash', 'byg-git-soeg__bash-workdir-inde__1-bash'
];

async function antalKort(t, { defaults, forloeb = FORLOEB, grepGuard = false, mode = 'free' }) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kortgraense-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const projekt = path.join(base, 'projekt'), ekstern = path.join(base, 'ekstern'), scratch = path.join(projekt, '.aura', 'tmp');
  await fs.mkdir(path.join(projekt, 'sub'), { recursive: true }); await fs.mkdir(ekstern); await fs.mkdir(scratch, { recursive: true });
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  if (defaults) await policy.applyNewProjectDefaults(projekt, { commandsAvailable: true });
  const fyld = value => JSON.parse(JSON.stringify(value).replaceAll('${ROOT}', projekt).replaceAll('${OUTSIDE}', ekstern).replaceAll('${BASE}', base));
  const kontekst = { projectRoot: projekt, workspaceRoot: projekt, scratchRoot: scratch, mode, grepGuard, taskRules: new Set(), commandSandbox: true, commandSandboxSupported: true, autoCommandsSnapshot: defaults };
  let kort = 0; const kortliste = [];
  for (const navn of forloeb) {
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

// Det længere forløb (årsag 13, rest 1): ca. 26 trin, som i den målte byggeopgave. Hvert trin er en liste af optagne forespørgsler (permission.asked);
// en tom liste er et trin, OpenCode ikke spørger om. Læsning, glob og list i projektet står til 'allow' i motoren (permissions() i core/engine.cjs),
// så de kommer aldrig til Aura; det kontrollerer den første prøve nedenfor. Et kort er en forespørgsel, som Aura ikke selv afgør.
// Forløbet er konstrueret ud fra de optagne former og viser ikke, hvor ofte en rigtig model spørger.
const LAES = [];
const LANGT_FORLOEB = [
  LAES, LAES, LAES, LAES, LAES, LAES, LAES, LAES, LAES,
  ['byg-git-soeg__grep-uden-sti__1-grep'], ['byg-git-soeg__grep-sti-inde-relativ__1-grep'], ['byg-git-soeg__grep-include__1-grep'], ['byg-git-soeg__grep-sti-inde-absolut__1-grep'],
  ['byg-git-filer__write-inde-absolut__1-edit'], ['byg-git-filer__write-inde-ny-mappe__1-edit'], ['byg-git-filer__write-inde-relativ__1-edit'], ['byg-git-filer__edit-inde-absolut__1-edit'], ['byg-git-filer__edit-inde-relativ__1-edit'],
  ['apply-patch-git__patch-opdater-inde__1-edit'], ['apply-patch-git__patch-tilfoej-inde__1-edit'],
  ['byg-git-soeg__bash-npm-build__1-bash'], ['byg-git-soeg__bash-kort__1-bash'], ['byg-git-soeg__bash-workdir-inde__1-bash'], ['byg-git-soeg__bash-pipe__1-bash'], ['byg-git-soeg__bash-lang__1-bash'], ['byg-git-soeg__bash-langt-output__1-bash']
];
const LANGT_FLAD = LANGT_FORLOEB.flat();

test('det lange forløb har ca. 26 trin, og alle optagelserne findes og har den form, tællingen forudsætter', async () => {
  assert.equal(LANGT_FORLOEB.length, 26);
  assert.equal(LANGT_FORLOEB.filter(trin => trin.length === 0).length, 9, 'ni trin uden forespørgsel: læsning, glob og list i projektet');
  const permissions = require('../core/engine.cjs').permissions('/projekt', [], 'build');
  for (const vaerktoej of ['read', 'glob', 'list']) assert.equal(permissions[vaerktoej] === 'allow' || permissions[vaerktoej]?.['*'] === 'allow', true, `${vaerktoej} skal stå til allow i motoren, ellers er de tomme trin ikke tomme`);
  for (const navn of LANGT_FLAD) {
    const fixture = JSON.parse(await fs.readFile(path.join(FIXTURES, navn + '.json'), 'utf8'));
    assert.ok(fixture.policyInput?.permission, navn);
    assert.notEqual(fixture.policyInput.permission, 'external_directory', `${navn}: forløbet skal blive i projektet`);
  }
});

test('et længere byggeforløb på 26 trin i et nyt projekt giver højst fem kort (årsag 13)', async t => {
  const { kort, kortliste } = await antalKort(t, { defaults: true, forloeb: LANGT_FLAD, grepGuard: true, mode: 'build' });
  assert.ok(kort <= MAX_KORT, `${kort} kort på ${LANGT_FORLOEB.length} trin: ${kortliste.join(', ')}`);
});

test('det lange forløb: søgevagten er det, der gør grep kortfri; uden den tæller hver søgning som et kort', async t => {
  const med = await antalKort(t, { defaults: true, forloeb: LANGT_FLAD, grepGuard: true, mode: 'build' });
  const uden = await antalKort(t, { defaults: true, forloeb: LANGT_FLAD, grepGuard: false, mode: 'build' });
  assert.equal(uden.kort - med.kort, 4, `de fire søgninger skal være kort uden søgevagten: ${uden.kortliste.join(', ')}`);
});

test('uden standarderne ville det lange forløb give mange flere kort (vagten kan fyre)', async t => {
  const { kort } = await antalKort(t, { defaults: false, forloeb: LANGT_FLAD, grepGuard: true, mode: 'build' });
  assert.ok(kort > MAX_KORT, `kun ${kort} kort uden standarder`);
});
