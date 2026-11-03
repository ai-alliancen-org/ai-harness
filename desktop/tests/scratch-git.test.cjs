// .aura/tmp må aldrig gøre projektet urent: AI'ens kladder, pakkecaches og store filer skal være usynlige for Git, så
// Udgiv, Gem version og de automatiske versioner ikke spærres (beslutning for beta 2, fund fra gennemgangen 3. november).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const chat = require('../core/chat-session.cjs');

test('filer i .aura/tmp, også store og mange, gør ikke git status uren', async t => {
  const projekt = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-scratchgit-')));
  t.after(() => fs.rm(projekt, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: projekt, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q'); await fs.writeFile(path.join(projekt, 'index.html'), 'hej'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'start');
  const scratch = chat.scratchRootFor(projekt, 'op-1');
  await chat.prepareScratch(projekt, scratch);
  await fs.writeFile(path.join(scratch, 'stor.bin'), Buffer.alloc(3 * 1024 * 1024));
  for (let n = 0; n < 250; n++) await fs.writeFile(path.join(scratch, `cache-${n}.txt`), 'x');
  assert.equal(git('status', '--porcelain', '--untracked-files=all').trim(), '', 'projektet er rent trods filerne i .aura/tmp');
});
