// Uden isolation kan kun kommandoens tekst kontrolleres. Jokertegn, Windows' korte filnavne og git-kommandoer, der ændrer .git,
// nævner ikke et beskyttet navn, men rammer det alligevel. De må derfor ikke godkendes automatisk. Windows er simuleret.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');

const command = (text, cwd) => ({ id: 'k', permission: 'bash', metadata: {}, patterns: [text], toolInput: { tool: 'bash', command: text, workdir: cwd } });

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-w1-joker-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), scratch = path.join(base, 'scratch');
  await fs.mkdir(root); await fs.mkdir(scratch);
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  const win = { projectRoot: root, workspaceRoot: root, scratchRoot: scratch, mode: 'build', taskRules: new Set(), commandSandboxSupported: false, commandSandbox: false, commandUnisolated: true, autoCommandsSnapshot: true, autoCommandsUnisolated: true };
  return { root, policy, win };
}

test('jokertegn, korte Windows-navne og git-kommandoer, der ændrer .git, godkendes ikke uden kort', async t => {
  const { root, policy, win } = await fixture(t);
  for (const text of ['type .e*', 'type .en?', 'type .e[n]v', 'type ENV~1', 'type REFERE~1', 'Get-Content refer*\\*', 'cat sec*', 'type .s*h\\id_rsa', 'git commit -m x', 'git config user.name x', 'git remote set-url origin x', 'git -C . commit -m x', 'npm test && git add .']) {
    const result = await policy.allowed(win, command(text, root));
    assert.equal(result.allowed, false, text); assert.equal(result.descriptor.commandProtected, true, text); assert.equal(result.descriptor.persistable, false, text);
  }
});

test('almindelige kommandoer uden jokertegn og læsende git-kommandoer godkendes stadig automatisk uden isolation', async t => {
  const { root, policy, win } = await fixture(t);
  for (const text of ['node index.js', 'npm run build', 'git status', 'git diff --stat', 'git -C . log --oneline']) {
    assert.equal((await policy.describe(win, command(text, root))).commandProtected, false, text);
  }
});
