const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { initialBrief, normalizeBrief, addAnswers, addWishes, briefText } = require('../core/brief.cjs');
const { parsePlan, planSummary, planOutline, answerOptions } = require('../ui/plan-view.js');
const { Workbench } = require('../core/workbench.cjs');
const { WorkspaceHistory } = require('../core/workspace-history.cjs');
const profiles = path.join(__dirname, '../../profiles');
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-plan-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('briefen starter med idéen og får svar og ønsker med korte overskrifter; AI-tekst kommer ikke ind', () => {
  let brief = initialBrief('  En side om fælleshaven  ');
  assert.deepEqual(brief.items, [{ id: 'ide', label: 'Idé', value: 'En side om fælleshaven', source: 'idé' }]);
  brief = addAnswers(brief, [{ question: 'Hvem skal kunne bruge siden?', header: 'Brugere', options: [] }, { question: 'Skal data deles?', options: [] }], [['Alle naboer – uden login (anbefalet)'], ['Nej', 'Kun lokalt']]);
  assert.deepEqual(brief.items.slice(1).map(item => [item.label, item.value, item.source]), [['Brugere', 'Alle naboer – uden login', 'svar'], ['Skal data deles', 'Nej, Kun lokalt', 'svar']]);
  assert.equal(brief.items[1].question, 'Hvem skal kunne bruge siden?'); assert.ok(brief.updatedAt);
  // Et nyt svar med samme overskrift erstatter linjen og fjerner markeringen af en tidligere rettelse.
  brief.items[1].edited = true;
  brief = addAnswers(brief, [{ question: 'Hvem?', header: 'brugere' }], [['Kun personalet']]);
  assert.equal(brief.items.filter(item => item.label.toLowerCase() === 'brugere').length, 1); assert.equal(brief.items[1].value, 'Kun personalet'); assert.equal(brief.items[1].edited, undefined);
  brief = addWishes(brief, [{ label: 'Platform', value: 'Browser' }]);
  assert.equal(brief.items.at(-1).source, 'ønske');
  assert.equal(briefText(brief), '- Idé: En side om fælleshaven\n- Brugere: Kun personalet\n- Skal data deles: Nej, Kun lokalt\n- Platform: Browser');
  assert.deepEqual(initialBrief('').items, []);
});

test('briefen afviser tomme, for lange og for mange linjer og retter ukendte kilder', () => {
  assert.throws(() => normalizeBrief({ items: [{ label: '', value: 'x' }] }), /både en overskrift og en tekst/);
  assert.throws(() => normalizeBrief({ items: [{ label: 'x'.repeat(61), value: 'x' }] }), /højst have 60 tegn/);
  assert.throws(() => normalizeBrief({ items: [{ label: 'x', value: 'x'.repeat(2001) }] }), /2.000 tegn/);
  assert.throws(() => normalizeBrief({ items: Array.from({ length: 31 }, () => ({ label: 'a', value: 'b' })) }), /højst 30 linjer/);
  assert.throws(() => normalizeBrief(null), /kan ikke læses/);
  const brief = normalizeBrief({ items: [{ id: 'a', label: ' Data ', value: ' Lokalt ', source: 'model', edited: true }, { id: 'a', label: 'To', value: 'Samme id' }] });
  assert.equal(brief.items[0].source, 'dig'); assert.equal(brief.items[0].label, 'Data'); assert.equal(brief.items[0].edited, true);
  assert.notEqual(brief.items[1].id, 'a', 'dobbelte id’er får et nyt');
});

test('planen deles i de fire afsnit, og et resumé tager første linje under Det bygger vi', () => {
  const text = 'Kort intro.\n\n## Det bygger vi\nEn side med tre lokaler.\nMed filter.\n\n**Sådan skal det se ud:**\nRoligt og læsbart.\n\nTeknik og data\nHTML og lokale data.\n\n### Det skal du prøve\n- Skriv 8 i feltet\n- Prøv mobil\n```\n## ikke en overskrift\n```';
  const plan = parsePlan(text);
  assert.equal(plan.intro, 'Kort intro.'); assert.equal(plan.structured, true);
  assert.deepEqual(plan.sections.map(s => [s.key, s.title]), [['bygger', 'Det bygger vi'], ['design', 'Sådan skal det se ud'], ['teknik', 'Teknik og data'], ['proev', 'Det skal du prøve']]);
  assert.match(plan.sections[3].body, /## ikke en overskrift/, 'en overskrift i en kodeblok deler ikke planen');
  assert.equal(planSummary(text), 'En side med tre lokaler. Med filter.');
  assert.equal(parsePlan('Bare tekst uden overskrifter').structured, false);
  assert.equal(planSummary('x '.repeat(300), 40).endsWith(' …'), true);
});

test('svarmuligheder: AI’ens anbefaling markeres og står først, og etiketten bevares til svaret', () => {
  const options = answerOptions([{ label: 'Kun personalet', description: 'Med login' }, { label: 'Alle naboer (Recommended)', description: 'Uden login' }, { label: '' }, null]);
  assert.deepEqual(options.map(o => [o.label, o.text, o.recommended]), [['Alle naboer (Recommended)', 'Alle naboer', true], ['Kun personalet', 'Kun personalet', false]]);
  assert.equal(answerOptions([{ label: 'Ja (anbefalet)' }])[0].text, 'Ja');
});

test('rettet plan bygges, AI’ens version kan hentes igen, og en stoppet plan kan kun læses', async t => {
  const directory = await temp(t), root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const events = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root, name: 'Haven', purpose: 'En side om fælleshaven' });
  assert.deepEqual(bench.brief.items.map(i => i.value), ['En side om fælleshaven']); const chat = bench.chat;
  chat.plan = { id: 'ai-1', text: '## Det bygger vi\nEn side.', context: 'afklaring', source: 'ai', at: 1 }; chat.planConversation = ['idé'];
  await assert.rejects(bench.editPlan({ planID: 'forkert', text: 'x' }), /ændret i mellemtiden/);
  await assert.rejects(bench.editPlan({ planID: 'ai-1', text: '   ' }), /tom/);
  const edited = await bench.editPlan({ planID: 'ai-1', text: '## Det bygger vi\nEn side med kalender.' });
  assert.equal(edited.source, 'dig'); assert.equal(edited.previous.id, 'ai-1'); assert.notEqual(edited.id, 'ai-1');
  assert.match(chat.planConversation.at(-1), /selv rettet planen/);
  const stored = new WorkspaceHistory(bench.store);
  let saved = await stored.readChat(root, chat.id);
  assert.equal(saved.plan.text, '## Det bygger vi\nEn side med kalender.');
  // En ny rettelse bevarer AI'ens oprindelige version som den, der kan hentes igen.
  const again = await bench.editPlan({ planID: edited.id, text: 'Endnu en version' });
  assert.equal(again.previous.id, 'ai-1');
  const restored = await bench.restorePlan({ planID: again.id });
  assert.equal(restored.text, '## Det bygger vi\nEn side.'); assert.equal(restored.source, 'ai'); assert.equal(restored.previous, undefined);
  // Briefen gemmes og følger med til en ny samtale; planen gør ikke.
  await bench.saveBrief({ items: [...bench.brief.items, { label: 'Brugere', value: 'Naboer', source: 'dig' }] });
  assert.ok(events.some(e => e.type === 'brief.updated' && e.brief.items.length === 2));
  chat.retirePlan('stoppet');
  assert.equal(chat.plan, null); assert.equal(chat.lastPlan.reason, 'stoppet'); assert.equal(chat.lastPlan.text, restored.text);
  assert.ok(events.some(e => e.type === 'plan.retired' && e.lastPlan.reason === 'stoppet'));
  await assert.rejects(bench.editPlan({ planID: restored.id, text: 'x' }), /ingen plan/);
  chat.runUser = { id: 'u', role: 'user', text: 'En side om fælleshaven' }; await chat.saveHistory('stopped');
  await bench.newConversation();
  assert.notEqual(bench.chat.id, chat.id);
  saved = await stored.readChat(root, bench.chat.id);
  assert.equal((await stored.project(root)).brief.items[1].value, 'Naboer'); assert.equal(saved.plan, null); assert.equal(bench.chat.lastPlan, null);
  assert.equal((await stored.readChat(root, chat.id)).lastPlan.reason, 'stoppet', 'den gamle samtale beholder sin seneste plan');
  assert.equal((await bench.state()).brief.items.length, 2);
  await bench.close();
});

test('en afbrudt byggeopgave genåbnes med planen som seneste plan, ikke som en plan, der kan bygges', async t => {
  const history = new WorkspaceHistory({ root: await temp(t), projectKey: () => 'projekt', saveProject: async () => {} });
  const { active } = await history.open({ root: '/projekt', name: 'Projekt' });
  await history.saveRun('/projekt', active, { messages: [], plan: { id: 'p', text: 'Planen' }, planConversation: [], status: 'working', mode: 'build' });
  const reopened = await history.openChat('/projekt', active);
  assert.equal(reopened.plan, null); assert.equal(reopened.lastPlan.text, 'Planen'); assert.equal(reopened.lastPlan.reason, 'afbrudt');
});

test('svar på AI’ens spørgsmål sendes som etiketter og kommer i briefen; spring over lader AI’en vælge', async t => {
  const directory = await temp(t), root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  await bench.activate({ root, name: 'Haven', purpose: 'Haven' }); const chat = bench.chat;
  const calls = []; chat.engine = { request: async (url, method, body) => { calls.push([url, method, body]); return true; } }; chat.runMode = 'plan'; chat.running = true;
  chat.event({ type: 'question.asked', properties: { id: 'q1', questions: [{ question: 'Hvem bruger siden?', header: 'Brugere', options: [{ label: 'Naboer (anbefalet)', description: '' }] }] } });
  await assert.rejects(bench.question({ id: 'q1', answers: [[42]] }), /Ugyldigt svar/);
  await bench.question({ id: 'q1', answers: [['Naboer (anbefalet)']] });
  assert.deepEqual(calls[0], ['/question/q1/reply', 'POST', { answers: [['Naboer (anbefalet)']] }]);
  assert.equal(bench.brief.items.find(item => item.label === 'Brugere').value, 'Naboer');
  chat.event({ type: 'question.asked', properties: { id: 'q2', questions: [{ question: 'Farve?', options: [] }, { question: 'Logo?', options: [] }] } });
  await bench.question({ id: 'q2', skip: true });
  assert.equal(calls[1][0], '/question/q2/reply');
  assert.deepEqual(calls[1][2].answers.map(answer => answer[0].startsWith('Brugeren springer over')), [true, true], 'spring over svarer, så opgaven fortsætter');
  assert.equal(bench.brief.items.some(item => ['Farve', 'Logo'].includes(item.label)), false, 'et spring over kommer ikke i briefen');
  chat.running = false; chat.engine = null; await bench.close();
});

test('motoren får spørgeværktøjet; OpenCode tilbyder det ellers kun til sine egne klienter', () => {
  const { isolatedEnv } = require('../core/engine.cjs');
  const env = isolatedEnv(os.tmpdir(), {}, 'adgangskode');
  assert.equal(env.OPENCODE_CLIENT, 'harness'); assert.equal(env.OPENCODE_ENABLE_QUESTION_TOOL, 'true');
});

// Overblikket er afledt visning; ingen plan-id'er eller fuld tekst bliver omskrevet.
test('kort planoverblik viser design og afprøvning, mens tekniske og ukendte afsnit bevares i fuld plan', () => {
  const source = '## Det bygger vi\nBooking.\n## Sådan skal det se ud\nRoligt og læsbart.\n## Teknik og data\nHTML og lokale data.\n## Det skal du prøve\n- Bestil et lokale\n- Annuller\n## Et ekstra krav\nBevar dette.';
  assert.deepEqual(planOutline(source), [{ title: 'Sådan skal det se ud', text: 'Roligt og læsbart.' }, { title: 'Det skal du prøve', text: 'Bestil et lokale Annuller' }]);
  assert.equal(parsePlan(source).sections.at(-1).body, 'Bevar dette.');
  assert.deepEqual(planOutline('En fri plan uden faste overskrifter.'), []);
  assert.ok(planOutline('## Sådan skal det se ud\n' + 'lang tekst '.repeat(100))[0].text.length < 170);
});
