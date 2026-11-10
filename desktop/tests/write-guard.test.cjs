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

// Spørgsmål A-3 fra første runde: vagten krævede også, at den leksikalske sti lå i projektet, så en skrivning gennem et link til projektet
// blev afvist, selv om den landede i projektet. På macOS er /var et link til /private/var, så en sti fra os.tmpdir() ramte det (test:agent).
// Nu afgør den faktiske sti alene. Et link i projektet, der peger ud, afvises stadig.
test('den faktiske sti afgør: en sti gennem et link til projektet går igennem, et link ud af projektet nægtes', { skip: process.platform === 'win32' }, async t => {
  const { base, projekt, guard } = await rod(t);
  await fs.symlink(projekt, path.join(base, 'genvej-til-projektet'));
  await fs.mkdir(path.join(projekt, 'public'));
  for (const sti of [path.join(base, 'genvej-til-projektet', 'public', 'a.html'), path.join(base, 'genvej-til-projektet', 'ny-mappe', 'b.html'), '../genvej-til-projektet/c.html']) {
    await assert.doesNotReject(kør(guard, 'write', { filePath: sti }), sti);
    await assert.doesNotReject(kør(guard, 'edit', { filePath: sti }), sti);
  }
  await assert.doesNotReject(kør(guard, 'apply_patch', { patchText: `*** Begin Patch\n*** Add File: ${path.join(base, 'genvej-til-projektet', 'p.html')}\n+x\n*** End Patch` }));
  // macOS: projektet ligger under /private/var, og stien kommer som /var/… (ikke-kanonisk).
  if (projekt.startsWith('/private/var/')) await assert.doesNotReject(kør(guard, 'write', { filePath: projekt.slice('/private'.length) + '/public/d.html' }));
  // Et link i projektet, der peger ud, og et link uden for projektet, der peger ud, nægtes stadig.
  await fs.symlink(path.join(base, 'ekstern'), path.join(projekt, 'ud'));
  await fs.symlink(path.join(base, 'ekstern'), path.join(base, 'genvej-ud'));
  for (const sti of [path.join(projekt, 'ud', 'a.txt'), 'ud/ny/b.txt', path.join(base, 'genvej-ud', 'c.txt'), path.join(base, 'genvej-til-projektet', 'ud', 'd.txt')]) await assert.rejects(kør(guard, 'write', { filePath: sti }), /uden for projektmappen/, sti);
  await assert.rejects(kør(guard, 'apply_patch', { patchText: '*** Begin Patch\n*** Update File: public/a.html\n*** Move to: ud/flyttet.html\n*** End Patch' }), /uden for projektmappen/);
});

test('skrivevagten sidder i det genererede plugin: write, edit og apply_patch uden for projektet afvises i tool.execute.before', async t => {
  // Prøverne ovenfor kalder createWriteGuard direkte. Denne prøve går gennem pluginet, som motoren indlæser, så den fejler, hvis
  // kaldet af skrivevagten forsvinder fra pluginets kilde (fund 7 i gennemgangen af beta 3: ingen anden enhedsprøve opdagede det).
  const { writeReadGuard } = require('../core/engine.cjs');
  const { base, projekt } = await rod(t);
  const directory = path.join(base, 'motor'); await fs.mkdir(directory);
  const configured = await writeReadGuard(directory, projekt, [], []);
  const hooks = await (await import(configured.pluginURL)).AuraReadProtection();
  const før = (tool, args) => hooks['tool.execute.before']({ tool, sessionID: 's', callID: 'c' }, { args });
  await assert.rejects(før('write', { filePath: path.join(base, 'ekstern', 'a.txt'), content: 'x' }), /Skriv ikke uden for projektmappen/);
  await assert.rejects(før('edit', { filePath: '../ekstern/b.txt', oldString: 'a', newString: 'b' }), /Skriv ikke uden for projektmappen/);
  await assert.rejects(før('apply_patch', { patchText: '*** Begin Patch\n*** Add File: ../ekstern/p.txt\n+x\n*** End Patch' }), /Skriv ikke uden for projektmappen/);
  await assert.rejects(før('apply_patch', { patchText: `*** Begin Patch\n*** Update File: ok.txt\n*** Move to: ${path.join(base, 'ekstern', 'flyt.txt')}\n*** End Patch` }), /Skriv ikke uden for projektmappen/);
  // Inde i projektet går skrivningen igennem pluginet.
  await assert.doesNotReject(før('write', { filePath: path.join(projekt, 'public', 'a.html'), content: 'x' }));
  await assert.doesNotReject(før('apply_patch', { patchText: '*** Begin Patch\n*** Add File: public/p.html\n+x\n*** End Patch' }));
});

// Skeptikerens fund i reparationen af spor S: et hængende link i projektet (projekt/genvej.txt -> /uden/for/ny.txt, hvor målet ikke
// findes endnu) gik igennem, fordi realpath fejlede, og vagten så på forælderen i stedet. Skrivningen fulgte linket ud af projektet.
// Nu følges linkets mål, så det er målet, der afgør. Et hængende link til en ny fil i projektet går stadig igennem.
test('et hængende link afgøres af sit mål: ud af projektet nægtes, ind i projektet går igennem', { skip: process.platform === 'win32' }, async t => {
  const { base, projekt, guard } = await rod(t);
  await fs.symlink(path.join(base, 'ekstern', 'ny.txt'), path.join(projekt, 'genvej.txt'));
  await fs.symlink(path.join(base, 'ekstern', 'ny-mappe'), path.join(projekt, 'mappe-ud'));
  await fs.symlink('../ekstern/relativ.txt', path.join(projekt, 'relativ.txt'));
  for (const sti of [path.join(projekt, 'genvej.txt'), 'genvej.txt', 'mappe-ud/a.txt', 'relativ.txt']) {
    await assert.rejects(kør(guard, 'write', { filePath: sti }), /uden for projektmappen/, sti);
    await assert.rejects(kør(guard, 'edit', { filePath: sti }), /uden for projektmappen/, sti);
  }
  await assert.rejects(kør(guard, 'apply_patch', { patchText: '*** Begin Patch\n*** Add File: genvej.txt\n+x\n*** End Patch' }), /uden for projektmappen/);
  // Et link, der peger på et link ud af projektet, og en løkke af links nægtes også.
  await fs.symlink(path.join(projekt, 'genvej.txt'), path.join(projekt, 'kæde.txt'));
  await fs.symlink(path.join(projekt, 'løkke-b'), path.join(projekt, 'løkke-a')); await fs.symlink(path.join(projekt, 'løkke-a'), path.join(projekt, 'løkke-b'));
  for (const sti of ['kæde.txt', 'løkke-a', 'løkke-a/x.txt']) await assert.rejects(kør(guard, 'write', { filePath: sti }), /uden for projektmappen/, sti);
  // Hængende links, der peger ind i projektet, går igennem: målet ligger i projektet.
  await fs.symlink(path.join(projekt, 'kommer-senere.txt'), path.join(projekt, 'ind.txt'));
  await fs.symlink('ny-undermappe/fil.txt', path.join(projekt, 'ind-relativ.txt'));
  for (const sti of ['ind.txt', 'ind-relativ.txt']) await assert.doesNotReject(kør(guard, 'write', { filePath: sti }), sti);
});

test('det genererede plugin nægter en skrivning gennem et hængende link ud af projektet', { skip: process.platform === 'win32' }, async t => {
  const { writeReadGuard } = require('../core/engine.cjs');
  const { base, projekt } = await rod(t);
  const directory = path.join(base, 'motor'); await fs.mkdir(directory);
  await fs.symlink(path.join(base, 'ekstern', 'ny.txt'), path.join(projekt, 'genvej.txt'));
  const hooks = await (await import((await writeReadGuard(directory, projekt, [], [])).pluginURL)).AuraReadProtection();
  const før = (tool, args) => hooks['tool.execute.before']({ tool, sessionID: 's', callID: tool }, { args });
  await assert.rejects(før('write', { filePath: path.join(projekt, 'genvej.txt'), content: 'x' }), /Skriv ikke uden for projektmappen/);
  await assert.rejects(før('edit', { filePath: 'genvej.txt', oldString: 'a', newString: 'b' }), /Skriv ikke uden for projektmappen/);
  await assert.rejects(før('apply_patch', { patchText: '*** Begin Patch\n*** Add File: genvej.txt\n+x\n*** End Patch' }), /Skriv ikke uden for projektmappen/);
});
