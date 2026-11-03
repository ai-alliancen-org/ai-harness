// Skrivevagten kører som plugin i motoren (tool.execute.before), så en afvisning er en almindelig værktøjsfejl uden
// godkendelseskort og uden at lukke andre ventende kort. Den nægter kun ved positivt bevis for en sti uden for projektet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWriteGuard } = require('../core/engine.cjs');

async function rod(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-skrivevagt-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const projekt = path.join(base, 'projekt'); await fs.mkdir(projekt); await fs.mkdir(path.join(base, 'ekstern'));
  return { base, projekt, guard: createWriteGuard({ fs, path, root: projekt }) };
}
const kør = (guard, tool, args) => guard({ tool }, { args });

test('filer i projektet nægtes aldrig, heller ikke med klammer, secrets eller credentials i stien', async t => {
  const { projekt, guard } = await rod(t);
  for (const sti of ['public/a.html', 'app/[slug]/page.tsx', 'src/pages/blog/[...rest].astro', 'secrets-app/x.txt', 'Acme Inc./ny.txt', '.aura/tmp/op-1/note.txt']) {
    await assert.doesNotReject(kør(guard, 'write', { filePath: path.join(projekt, sti) }), sti);
    await assert.doesNotReject(kør(guard, 'edit', { filePath: sti }), 'relativ ' + sti);
  }
});

test('en sti uden for projektet nægtes med en besked, der peger på .aura/tmp', async t => {
  const { base, guard } = await rod(t);
  await assert.rejects(kør(guard, 'write', { filePath: path.join(base, 'ekstern', 'a.txt') }), /uden for projektmappen[\s\S]*\.aura\/tmp/);
  await assert.rejects(kør(guard, 'write', { filePath: '../ekstern/a.txt' }), /uden for projektmappen/);
  await assert.rejects(kør(guard, 'edit', { filePath: '/etc/hosts' }), /uden for projektmappen/);
});

test('apply_patch: nye filer inde i projektet går igennem, og en fil uden for projektet nægtes', async t => {
  const { base, guard } = await rod(t);
  await assert.doesNotReject(kør(guard, 'apply_patch', { patchText: '*** Begin Patch\n*** Add File: public/p1.html\n+hej\n*** End Patch' }));
  await assert.doesNotReject(kør(guard, 'apply_patch', { patchText: '*** Begin Patch\n*** Add File: app/[slug]/page.tsx\n+hej\n*** End Patch' }));
  await assert.rejects(kør(guard, 'apply_patch', { patchText: `*** Begin Patch\n*** Add File: ../ekstern/p.txt\n+x\n*** End Patch` }), /uden for projektmappen/);
  await assert.rejects(kør(guard, 'apply_patch', { patchText: `*** Begin Patch\n*** Update File: ok.txt\n*** Move to: ${path.join(base, 'ekstern', 'flyt.txt')}\n*** End Patch` }), /uden for projektmappen/);
});

test('et symbolsk link ud af projektet nægtes, og andre værktøjer berøres ikke', async t => {
  const { base, projekt, guard } = await rod(t);
  await fs.symlink(path.join(base, 'ekstern'), path.join(projekt, 'link'));
  await assert.rejects(kør(guard, 'write', { filePath: path.join(projekt, 'link', 'a.txt') }), /uden for projektmappen/);
  await assert.doesNotReject(kør(guard, 'read', { filePath: '/etc/hosts' }));
  await assert.doesNotReject(kør(guard, 'bash', { command: 'echo hej' }));
});
