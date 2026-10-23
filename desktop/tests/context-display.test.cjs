const { test } = require('node:test');
const assert = require('node:assert/strict');
const { project, format } = require('../ui/context-display.js');
const { ContextUsage } = require('../core/context-usage.cjs');
const binding = { connectionID: 'chosen', modelID: 'vendor/model', routeID: 'exact', engineID: 'opencode@1.18.33', sessionID: 'session-a', model: { limits: { context: 1000 } } };
const step = { type: 'step-finish', tokens: { input: 100, output: 99999, cache: { read: 20, write: 10 } } };
function sample() { const usage = new ContextUsage(); usage.bind(binding); return usage.observe(step); }

test('visningen adskiller målt input med cache fra samtalens total og fra output', () => {
  const projected = project(binding, sample());
  assert.deepEqual(projected, { inputTokens: 130, windowTokens: 1000, percentage: 13 });
  const text = format(projected);
  assert.equal(text.label, 'Kontekst · 130 / 1.000 · 13 %');
  assert.match(text.description, /senest afsluttede modelkald/);
  assert.match(text.description, /ikke samtalens samlede forbrug/);
});
test('ændret forbindelse, model eller OpenRouter-rute viser aldrig gammel måling', () => {
  for (const key of ['connectionID', 'modelID', 'routeID']) {
    const value = project({ ...binding, [key]: 'changed' }, sample(), { limits: { context: 2000 } });
    assert.deepEqual(value, { inputTokens: null, windowTokens: 2000, percentage: null });
  }
});
test('ukendte og ufuldstændige målinger vises som ukendte, også ved store samtaletotaler', () => {
  const invalid = [null, { inputTokens: 500, windowTokens: 1000, known: true },
    { ...sample(), source: 'conversation-total', inputTokens: 1000000 },
    { ...sample(), known: false }, { ...sample(), inputTokens: -1 },
    { ...sample(), inputTokens: Number.MAX_VALUE }, { ...sample(), windowTokens: 0 },
    { ...sample(), binding: { ...binding, sessionID: '' } },
    { ...sample(), binding: { ...binding, engineID: '' } }];
  for (const snapshot of invalid) assert.equal(project(binding, snapshot).percentage, null);
  assert.equal(format(project(binding, null)).label, 'Kontekst ukendt');
  assert.equal(format(project(binding, null, binding.model)).label, 'Kontekst ukendt · vindue 1.000');
});
test('gyldigt nul er en måling, og et overskredet vindue skjules ikke i teksten', () => {
  assert.equal(format(project(binding, { ...sample(), inputTokens: 0 })).label, 'Kontekst · 0 / 1.000 · 0 %');
  assert.equal(format(project(binding, { ...sample(), inputTokens: 1200 })).label, 'Kontekst · 1.200 / 1.000 · 120 %');
});
test('et andet forbindelseskatalog kan ikke levere vinduet til den aktive opgaves model med samme id', () => {
  const unknownWindow = { ...sample(), windowTokens: null };
  const otherCatalogModel = { id: binding.modelID, limits: { context: 64000 } };
  assert.deepEqual(project(binding, unknownWindow, otherCatalogModel, 'another-connection'), { inputTokens: 130, windowTokens: null, percentage: null });
  assert.equal(format(project(binding, unknownWindow, otherCatalogModel, 'another-connection')).label, 'Kontekst ukendt');
  assert.equal(project(binding, sample(), otherCatalogModel, 'another-connection').windowTokens, 1000, 'en faktisk måling beholder sit eget vindue');
});

test('den rigtige ChatSession videresender kun sidste unikke afsluttede trin til sin egen visning', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Workbench } = require('../core/workbench.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-context-usage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const emitted = [], bench = new Workbench({ directory, profiles: path.resolve(__dirname, '../../profiles'), safeStorage: {}, emit: event => emitted.push(event) });
  await bench.activate({ root: path.join(directory, 'project'), name: 'Kontekstprøve' });
  t.after(() => bench.close());
  const chat = bench.chat;
  chat.contextUsage.bind(binding);
  const finish = (id, input) => chat.event({ type: 'message.part.updated', properties: { part: { ...step, id, tokens: { ...step.tokens, input } } } });
  finish('a', 100); finish('a', 999); finish('b', 20);
  assert.equal(chat.currentUsage().input, 120);
  assert.equal(chat.currentUsage().calls, 2);
  assert.equal(chat.view().contextUsage.inputTokens, 50);
  const events = emitted.filter(event => event.type === 'usage');
  assert.equal(events.length, 2);
  assert.equal(events[1].contextUsage.inputTokens, 50);
  assert.equal(events[1].chat, chat.id);
  chat.runUser = { id: 'user-a', role: 'user', text: 'Et syntetisk spørgsmål.' };
  await chat.saveHistory('idle');
  await bench.newConversation();
  assert.equal(bench.chat.view().contextUsage.inputTokens, null);
  await bench.openChat(chat.id);
  assert.equal(bench.chat.view().contextUsage.inputTokens, 50);
  await chat.close(false);
  assert.equal(chat.view().contextUsage.inputTokens, null);
});
