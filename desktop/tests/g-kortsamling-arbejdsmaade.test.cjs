// Kortsamlingen (brugerens beslutning 10. november 2026, «Byg samlingen») gælder kun, hvor AI'en må arbejde i projektmappen: Byg.
// I Samtale og Planlæg må et ja til «resten af opgaven» aldrig dække noget, heller ikke en søgning i projektet, som ellers ikke er spærret
// i de to arbejdsmåder. Skeptikerens fund: !writable(context.mode) i coversProjectFolder var ikke dækket af nogen prøve.
// Forespørgslen er den rigtige, optaget fra OpenCode 1.19.5 (VERSION).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ApprovalsPolicy, coversProjectFolder, TASK_PROJECT } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const { VERSION } = require('../core/engine.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', `opencode-${VERSION}`);
async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kortsamling-maade-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const projekt = path.join(base, 'projekt'), scratch = path.join(projekt, '.aura', 'tmp');
  await fs.mkdir(scratch, { recursive: true });
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  const input = async name => JSON.parse(JSON.stringify(JSON.parse(await fs.readFile(path.join(FIXTURES, name + '.json'), 'utf8')).policyInput).replaceAll('${ROOT}', projekt).replaceAll('${OUTSIDE}', path.join(base, 'ekstern')).replaceAll('${BASE}', base));
  const kontekst = mode => ({ projectRoot: projekt, workspaceRoot: projekt, scratchRoot: scratch, mode, grepGuard: true, taskRules: new Set([TASK_PROJECT]), commandSandbox: true, commandSandboxSupported: true, autoCommandsSnapshot: false });
  return { policy, input, kontekst };
}

test('i Byg dækker et ja til resten af opgaven en søgning i projektet (forudsætningen)', async t => {
  const f = await fixture(t), soeg = await f.input('byg-git-soeg__grep-uden-sti__1-grep');
  const result = await f.policy.allowed(f.kontekst('free'), soeg);
  assert.equal(result.allowed, true); assert.equal(result.source, 'task');
  assert.equal(coversProjectFolder(result.descriptor, f.kontekst('free')), true);
});

for (const mode of ['chat', 'plan']) test(`i ${mode === 'chat' ? 'Samtale' : 'Planlæg'} dækker kortsamlingen intet, heller ikke en søgning i projektet`, async t => {
  const f = await fixture(t), soeg = await f.input('byg-git-soeg__grep-uden-sti__1-grep'), context = f.kontekst(mode);
  const descriptor = await f.policy.describe(context, soeg);
  assert.equal(descriptor.projectSearch, true, 'søgningen er i projektet');
  assert.equal(descriptor.blockedMode, false, 'søgningen er ikke spærret i arbejdsmåden, så kun kortsamlingens egen kontrol holder den ude');
  assert.equal(coversProjectFolder(descriptor, context), false);
  const result = await f.policy.allowed(context, soeg);
  assert.equal(result.allowed, false, 'søgningen venter på et kort');
  // Spørgsmålet om resten af opgaven kan heller ikke besvares med ja her.
  const fresh = { ...context, taskRules: new Set() };
  await assert.rejects(f.policy.grant(fresh, soeg, { scope: 'collect' }), /Kun handlinger i projektmappen/);
  assert.equal(fresh.taskRules.has(TASK_PROJECT), false);
});
