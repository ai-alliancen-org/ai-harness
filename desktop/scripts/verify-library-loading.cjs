// Faktisk indlæsning gennem Workbench og OpenCode. Serveren styrer kald; den måler ikke modeladfærd.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.resolve(__dirname, '../../profiles');
async function scenario(surface, mode) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-indlaesning-')));
  const project = path.join(root, 'projekt med mellemrum'); await fs.mkdir(project);
  const own = '# Projektregler\nPROJEKTREGEL-' + surface + ': Brug projektets eksisterende konventioner.\n';
  await fs.writeFile(path.join(project, 'AGENTS.md'), own);
  const requests = [];
  let reference;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const main = body.tools?.some(tool => tool.function?.name === 'skill');
    const results = body.messages.filter(message => message.role === 'tool');
    const step = main ? [
      ['skill', { name: 'harness-design-og-tilgaengelighed' }],
      ['read', { filePath: reference }],
      ['skill', { name: 'harness-sikkerhedsgennemgang' }]
    ][results.length] : null;
    const delta = step ? { role: 'assistant', tool_calls: [{ index: 0, id: 'kald-' + requests.length, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] } : { role: 'assistant', content: 'Prøven er gennemført.' };
    res.setHeader('content-type', 'text/event-stream');
    res.write('data: ' + JSON.stringify({ id: 'prøve', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'prøve', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let complete, timer;
  let finished;
  const waitForRun = () => new Promise((resolve, reject) => { complete = resolve; timer = setTimeout(() => reject(Error('Indlæsningsprøven sluttede ikke')), 60000); });
  finished = waitForRun();
  const bench = new Workbench({ directory: path.join(root, 'data'), surface, profiles, safeStorage: {}, emit: event => {
    if (event.type === 'run.status' && ['idle', 'error', 'stopped'].includes(event.status)) complete(event.status);
  } });
  try {
    await bench.activate({ root: project, name: 'Indlæsningsprøve' });
    const library = await bench.library();
    await bench.features.save(project, { scope: 'projekt', values: Object.fromEntries(library.features.map(feature => [feature.id, feature.id === 'design'])) });
    bench.selection = async () => ({ connection: { id: 'prøve', kind: 'compatible', name: 'Lokal prøve', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, model: { id: 'model', name: 'Kontrolleret model', tool_call: true, limit: { context: 32768, output: 4096 } } });
    reference = path.join(bench.store.root, 'runtime', bench.store.projectKey(project), 'config/skills/harness-design-og-tilgaengelighed/references/tilgaengelighed.md');
    const review = await bench.prepare({ mode });
    assert.equal(review.projectInstructions.content, own);
    const firstFingerprint = review.fingerprint;
    await fs.writeFile(path.join(project, 'AGENTS.md'), own + 'NY-REGEL\n');
    await assert.rejects(bench.send({ text: 'Undersøg designet', fingerprint: firstFingerprint }), /har ændret sig/);
    assert.equal(requests.length, 0, 'Ingen modelkald efter en ændret instruktionsfil');
    const next = await bench.prepare({ mode }); assert.notEqual(next.fingerprint, firstFingerprint);
    await bench.send({ text: 'Undersøg designet uden filændringer', fingerprint: next.fingerprint });
    const status = await finished; assert.equal(status, 'idle');
    const main = requests.filter(body => body.tools?.some(tool => tool.function?.name === 'skill'));
    const system = JSON.stringify(main[0].messages.filter(message => message.role === 'system'));
    assert.match(system, new RegExp('PROJEKTREGEL-' + surface)); assert.match(system, /NY-REGEL/);
    assert.match(system, /Kilde: AGENTS.md/); assert.match(system, /Ved modstrid/); assert.match(system, /FÆLLES-GRUNDLAG-02/);
    assert.deepEqual([...system.matchAll(/<name>(harness-[a-z0-9-]+)<\/name>/g)].map(match => match[1]).sort(), ['harness-aura-design', 'harness-design-og-tilgaengelighed']);
    const tools = main.at(-1).messages.filter(message => message.role === 'tool').map(message => JSON.stringify(message.content));
    assert.match(tools[0], /skill_content/); assert.ok(tools[0].includes(reference)); assert.match(tools[1], /WCAG/);
    assert.match(tools[2], /not found/);
    if (surface === 'cli') { assert.match(system, /\/save/); assert.doesNotMatch(system, /appens Udgiv-knap|Auras knap Udgiv|Start forhåndsvisning/); }
    else assert.match(system, /APPENS REGLER/);
    assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), own + 'NY-REGEL\n');
    const previousSession = bench.chat.engine.session.id;
    clearTimeout(timer); finished = waitForRun();
    await fs.writeFile(path.join(project, 'AGENTS.md'), own + 'TREDJE-REGEL\n');
    const changed = await bench.prepare({ mode });
    await bench.send({ text: 'Læs med de nye regler', fingerprint: changed.fingerprint });
    assert.equal(await finished, 'idle');
    assert.notEqual(bench.chat.engine.session.id, previousSession, 'Ændrede regler starter en ny modelsession');
    const latest = requests.filter(body => body.tools?.some(tool => tool.function?.name === 'skill')).at(-1);
    const latestSystem = JSON.stringify(latest.messages.filter(message => message.role === 'system'));
    assert.match(latestSystem, /TREDJE-REGEL/); assert.doesNotMatch(latestSystem, /NY-REGEL/);
    return { surface, mode, root, modelkald: requests.filter(body => body.tools?.some(tool => tool.function?.name === 'skill')).length, betalteKald: 0, kontroller: ['projektregler med kilde', 'ny gennemgang og modelsession ved ændring', 'kun valgte skills', 'skill og reference læst', 'fravalgt skill afvist'] };
  } finally { clearTimeout(timer); await bench.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
(async () => console.log(JSON.stringify({ status: 'bestået', results: [await scenario('desktop', 'chat'), await scenario('desktop', 'plan'), await scenario('cli', 'free')] }, null, 2)))().catch(error => { console.error(error); process.exitCode = 1; });
