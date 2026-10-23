// Appens AI og det fælles skillbibliotek i den rigtige OpenCode-motor med appens egne tilladelser.
// En kontrolleret modelserver beder om skills og filer i en fast rækkefølge. Prøven viser, hvad motoren faktisk tillader:
// kun aktive skills, skillens referencer uden spørgsmål, udvalgte private referencer og intet andet fra references/ eller .git/.
// Den køres i et projekt med Git og i et uden, fordi OpenCode sammenligner stier med Git-roden.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { OpenCodeEngine } = require('../core/engine.cjs');
const { Store } = require('../core/store.cjs');
const { Features } = require('../core/features.cjs');
const { Skills } = require('../core/skills.cjs');
const { loadLibrary } = require('../core/library.cjs');
const profiles = path.join(__dirname, '../../profiles');

async function scenario(root, { git, mode }) {
  const project = path.join(root, `projekt-${git ? 'git' : 'uden-git'}-${mode}`), directory = path.join(root, 'Library', 'Application Support', 'Aura', 'harness', 'runtime', require('node:crypto').createHash('sha256').update(`${git}-${mode}`).digest('hex'));
  await fs.mkdir(path.join(project, 'references'), { recursive: true });
  await fs.writeFile(path.join(project, 'references/valgt.md'), 'VALGT-REFERENCE');
  await fs.writeFile(path.join(project, 'references/andet.md'), 'PRIVAT-REFERENCE');
  await fs.writeFile(path.join(project, '.env'), 'HEMMELIG=1');
  await fs.writeFile(path.join(project, 'AGENTS.md'), '# Projektets egne regler\nPROJEKT-AGENTS-MARKOER\n');
  if (git) execFileSync('git', ['init', '-q'], { cwd: project });
  // Kun Design og tilgængelighed samt Kodekvalitet og afprøvning er slået til.
  const store = new Store(path.join(root, `data-${git}-${mode}`)), library = () => loadLibrary(profiles);
  const features = new Features(store, library), skills = new Skills(library, store, features);
  await features.save(null, { scope: 'alle', values: { versioner: false, planlaegning: false, design: true, sikkerhed: false, kvalitet: true, deling: false, 'integration-adresser': true } });
  const context = await skills.context(project);
  assert.deepEqual(context.skills.map(skill => skill.name).sort(), ['harness-afproevning-og-fejlretning', 'harness-aura-design', 'harness-design-og-tilgaengelighed', 'harness-integration-adresser', 'harness-kodestil']);
  assert.deepEqual(context.integrations, ['Adresser']);
  const skillReference = path.join(directory, 'config/skills/harness-design-og-tilgaengelighed/references/tilgaengelighed.md');
  const auraReference = path.join(directory, 'config/skills/harness-aura-design/references/brand-discovery.md');
  const steps = [
    ['skill', { name: 'harness-design-og-tilgaengelighed' }],
    ['read', { filePath: skillReference }],
    ['read', { filePath: path.join(project, 'references/andet.md') }],
    ['read', { filePath: path.join(project, 'references/valgt.md') }],
    ['skill', { name: 'customize-opencode' }],
    ['skill', { name: 'harness-sikkerhedsgennemgang' }],
    ['read', { filePath: path.join(project, '.env') }],
    ...(git ? [['read', { filePath: path.join(project, '.git/config') }]] : []),
    // En valgt integration hentes som andre skills, og dens reference kan læses.
    ['skill', { name: 'harness-integration-adresser' }],
    ['read', { filePath: path.join(directory, 'config/skills/harness-integration-adresser/references/adressevaelger.md') }],
    ['skill', { name: 'harness-aura-design' }],
    ['read', { filePath: auraReference }]
  ];
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'model', object: 'model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const done = (body.messages || []).filter(message => message.role === 'tool').length;
    const main = (body.tools || []).some(tool => tool.function?.name === 'read');
    let step = main ? steps[done] : null;
    if (main && done === 1) {
      const result = body.messages.filter(message => message.role === 'tool').at(-1);
      const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      assert.ok(content.includes('Referencefiler i denne kørsel'), 'skillen viser præcise referencestier');
      assert.ok(content.includes(skillReference), 'referencefilens sti kommer fra skill-værktøjet');
      step = ['read', { filePath: skillReference }];
    }
    if (main && done === steps.length - 1) {
      const result = body.messages.filter(message => message.role === 'tool').at(-1);
      const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      assert.ok(content.includes(auraReference), 'Aura-design viser den præcise sti til sin brandreference');
    }
    res.setHeader('content-type', 'text/event-stream');
    const send = delta => res.write(`data: ${JSON.stringify({ id: 'prøve', object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    if (step) send({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${requests.length}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] });
    else send({ role: 'assistant', content: main ? 'Færdig.' : 'Titel' });
    res.write(`data: ${JSON.stringify({ id: 'prøve', object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const asked = [];
  let idle;
  const finished = new Promise(resolve => { idle = resolve; });
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Prøve', options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'ikke-en-rigtig-noegle' }, models: { model: { name: 'model', tool_call: true, limit: { context: 32768, output: 4096 } } } };
  const engine = new OpenCodeEngine({ root: project, directory, provider, model: { id: 'model' }, references: ['references/valgt.md'], mode, skills: context.skills, onEvent: event => {
    if (event.type === 'permission.asked') { asked.push(`${event.properties.permission}: ${event.properties.patterns}`); engine.reply(event.properties.id, false).catch(() => {}); }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) idle(event.type);
  } });
  let timeout;
  try {
    await engine.start();
    await engine.send('Hjælp med en tilgængelig forside.', 'APPENS-SYSTEMPROMPT');
    const outcome = await Promise.race([finished, new Promise(resolve => { timeout = setTimeout(() => resolve('timeout'), 120000); })]);
    assert.equal(outcome, 'session.idle', `motoren sluttede med ${outcome}`);
    const main = requests.filter(body => (body.tools || []).some(tool => tool.function?.name === 'read'));
    const system = JSON.stringify(main[0].messages.filter(message => message.role === 'system'));
    const listed = [...system.matchAll(/<name>([a-z0-9-]+)<\/name>/g)].map(found => found[1]).sort();
    const results = main.at(-1).messages.filter(message => message.role === 'tool').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    const denied = text => /prevents you from using this specific tool call|Aura beskytter denne fil\./.test(text);
    assert.deepEqual(listed, context.skills.map(skill => skill.name).sort(), 'modellen ser præcis de aktive skills');
    assert.match(system, /APPENS-SYSTEMPROMPT/);
    assert.doesNotMatch(system, /PROJEKT-AGENTS-MARKOER/, 'projektets AGENTS.md indlæses ikke; appen sender selv grundreglerne');
    assert.match(results[0], /skill_content name="harness-design-og-tilgaengelighed"/, 'en aktiv skill kan hentes');
    assert.ok(results[1].includes('WCAG') || results[1].includes('tilgængelig'), `skillens reference kan læses: ${results[1].slice(0, 200)}`);
    assert.ok(denied(results[2]), `en ikke valgt privat reference afvises: ${results[2].slice(0, 160)}`);
    assert.match(results[3], /VALGT-REFERENCE/, 'den valgte reference kan læses');
    assert.ok(denied(results[4]), 'OpenCodes egen skill er skjult');
    // En skill under en slået fra funktion lægges slet ikke i motoren.
    assert.match(results[5], /Skill "harness-sikkerhedsgennemgang" not found/, 'en skill under en slået fra funktion findes ikke');
    assert.ok(denied(results[6]), '.env afvises');
    if (git) assert.ok(denied(results[7]), 'Git-mappen afvises');
    const integration = git ? 8 : 7;
    assert.match(results[integration], /skill_content name="harness-integration-adresser"[\s\S]*adressevaelger\.dk/, 'en valgt integration kan hentes');
    assert.match(results[integration + 1], /EPSG:25832/, 'integrationens reference kan læses');
    assert.match(results[integration + 2], /skill_content name="harness-aura-design"/, 'den nye designskill kan hentes gennem den oprindelige motor');
    assert.match(results[integration + 3], /Brand Discovery|Brandmetode|brand/i, 'den nye brandreference kan faktisk læses');
    assert.deepEqual(asked, [], 'intet af det spørger brugeren');
    return { git, mode, skills: listed.length, checks: results.length };
  } finally { clearTimeout(timeout); await engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-app-skills-')));
  try {
    const results = [];
    for (const setup of [{ git: true, mode: 'free' }, { git: false, mode: 'free' }, { git: true, mode: 'plan' }]) results.push(await scenario(root, setup));
    console.log(JSON.stringify({ status: 'bestået', results, checks: ['kun aktive skills vises for modellen', 'aktiv skill hentes', 'skillens reference læses uden spørgsmål', 'ikke valgt privat reference afvises', 'valgt reference læses', 'OpenCodes egen skill skjult', 'skill under slået fra funktion findes ikke i motoren', '.env og .git afvist', 'valgt integration og dens reference hentes', 'Aura-design og dens annoncerede brandreference hentes', 'projektets AGENTS.md indlæses ikke', 'med og uden Git', 'også under planlægning'] }, null, 2));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
