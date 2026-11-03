const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mode = require('../ui/conversation-mode.js');
const { permissions, OpenCodeEngine } = require('../core/engine.cjs');
const { Workbench } = require('../core/workbench.cjs');
const { capture } = require('../core/changes.cjs');
const plan = '## Det bygger vi\nEn blomst.\n## Sådan skal det se ud\nLyserøde blade.\n## Teknik og data\nHTML og CSS.\n## Det skal du prøve\nSe blomsten springe ud.';
test('kun en konkret plan giver et byggekort; afvisningen fra demoen er almindelig samtale', () => {
  const reply = 'Forstået! Da planen allerede er lagt frem og godkendt, er der ikke mere at afklare. Sig til, når du vil have mig til at bygge blomsten. 🌸';
  assert.equal(mode.concretePlan(reply), false);
  assert.equal(mode.concretePlan('## Det bygger vi\n'), false);
  assert.equal(mode.concretePlan(plan), true);
  for (let i = 1; i <= '<!-- aura:offer-plan -->'.length; i++) assert.equal(mode.visible('Et svar.\n' + '<!-- aura:offer-plan -->'.slice(0, i)), 'Et svar.');
  assert.equal(mode.action('Et svar.\n<!-- aura:offer-plan -->'), 'plan');
  assert.equal(mode.action('Et almindeligt spørgsmål'), null);
});
test('planoverskriften fra den faktiske Promte-samtale giver et byggekort', () => {
  for (const title of ['Det skal du prøve (i forhåndsvisningen)', 'Det skal du prøve i forhåndsvisningen']) {
    const actual = plan.replace('Det skal du prøve', title);
    assert.equal(mode.concretePlan(actual), true);
  }
});
test('brugerens klare byggebesked kan starte bygning, men omtale og afvisning kan ikke', () => {
  for (const text of ['byg', 'Byg planen', 'ja, byg den', 'go ahead and build', 'Build it!', 'gå i gang med at bygge']) assert.equal(mode.buildRequest(text), true, text);
  for (const text of ['byg ikke endnu', 'nej, byg ikke', 'kan du bygge?', 'hvordan bygger man?', 'modellen sagde "byg"', 'for at fortsætte: byg', 'go ahead and build?']) assert.equal(mode.buildRequest(text), false, text);
});
test('Samtale bruger plan-agenten med forbud mod ændringer og kommandoer', async () => {
  const policy = permissions('/projekt', [], 'chat');
  for (const tool of ['write', 'edit', 'bash', 'task', 'apply_patch']) assert.equal(policy[tool] || policy['*'], 'deny');
  const engine = new OpenCodeEngine({ root: '/projekt', mode: 'chat', model: { id: 'test' } });
  engine.active = true; engine.session = { id: 'prøve' }; let sent;
  engine.request = async (_, __, body) => { sent = body; }; await engine.send('Hej', 'Regler');
  assert.equal(sent.agent, 'plan');
});
test('rigtige samtalehændelser viser tilbud, husker afvisning og afviser et almindeligt plansvar', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-intent-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'projekt'); await fs.mkdir(project);
  const events = [], bench = new Workbench({ directory: path.join(root, 'data'), profiles: path.resolve(__dirname, '../../profiles'), emit: e => events.push(e), safeStorage: {} });
  await bench.activate({ root: project, name: 'Blomst' }); t.after(() => bench.close());
  const chat = bench.chat; assert.equal(chat.data.mode, 'chat');
  async function answer(text, workmode = 'chat') {
    chat.running = true; chat.runMode = workmode; chat.runBefore = await capture(project);
    chat.runRoles = new Map([['a', 'assistant']]); chat.runText = new Map([['a', { id: 'a' + events.length, messageID: 'a', text }]]);
    chat.event({ type: 'session.idle' }); await chat.finishing;
  }
  await answer('Vi kan lave en plan.\n<!-- aura:offer-plan -->');
  assert.ok(events.some(e => e.type === 'plan.offer' && e.offered)); assert.equal(chat.plan, null);
  await chat.saveDraft({ text: '', mode: 'chat', dismissPlanOffer: true }); events.length = 0;
  await answer('Vi kan lave en plan.\n<!-- aura:offer-plan -->');
  assert.equal(events.some(e => e.type === 'plan.offer' && e.offered), false);
  await answer('Forstået! Vi bygger ikke noget.', 'plan'); assert.equal(chat.plan, null);
  await answer(plan, 'plan'); assert.ok(chat.plan);
  // Markøren gælder kun i Samtale: i Planlæg og Byg trækker den ikke en plan tilbage og slår ikke planforslag fra (årsag 3).
  chat.dismissedProbe = chat.data.planOffersDismissed;
  await answer('Vi bliver i planlægningen.\n<!-- aura:stay -->', 'plan'); assert.ok(chat.plan, 'planen står stadig efter stay i Planlæg');
  await answer('Vi bliver i byggeriet.\n<!-- aura:stay -->', 'build'); assert.ok(chat.plan, 'planen står stadig efter stay i Byg');
  await answer('Vi bliver i samtalen.\n<!-- aura:stay -->'); assert.equal(chat.plan, null);
  const saved = await bench.history.readChat(project, chat.id);
  assert.equal(saved.planOffersDismissed, true); assert.equal(saved.messages.some(m => m.text.includes('<!-- aura:')), false);
});
