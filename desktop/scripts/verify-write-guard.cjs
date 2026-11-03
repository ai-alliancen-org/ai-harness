// Rigtig OpenCode, syntetiske filer og lokal modelserver. Ingen Git-skrivninger eller ekstern AI.
// Beviser skrivevagten og AI'ens arbejdsmappe ende til ende:
//  - filer inde i projektet (også med [klammer] og secrets i stien) kan skrives, med write og med apply_patch
//  - filer uden for projektet nægtes som almindelig værktøjsfejl, også tre ad gangen, uden at opgaven stopper
//  - AI'ens kommandoer får .aura/tmp som TMPDIR, og motorens egne udpakkede filer lander ikke i projektet
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { OpenCodeEngine } = require('../core/engine.cjs');

// Hvert trin er ét svar fra modellen: en liste af [værktøj, argumenter eller funktion af stierne].
async function run({ modelId, steps, setup }) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-skrivevagt-')));
  const root = path.join(base, 'projekt'), outside = path.join(base, 'ekstern'), directory = path.join(base, 'motor');
  await fs.mkdir(path.join(root, '.aura', 'tmp'), { recursive: true }); await fs.mkdir(outside);
  await fs.writeFile(path.join(root, '.aura', 'tmp', '.gitignore'), '*\n');
  const paths = { root, outside };
  if (setup) await setup(paths);
  const requests = [], asked = [], failures = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const main = body.tools?.some(tool => tool.function?.name === 'read');
      const index = body.messages.filter(message => message.role === 'assistant' && message.tool_calls?.length).length;
      const step = main ? steps[index] : null;
      const delta = step
        ? { role: 'assistant', tool_calls: step.map(([tool, args], n) => ({ index: n, id: `skriv-${index}-${n}`, type: 'function', function: { name: tool, arguments: JSON.stringify(typeof args === 'function' ? args(paths) : args) } })) }
        : { role: 'assistant', content: main ? 'Færdig.' : 'Prøve' };
      res.setHeader('content-type', 'text/event-stream');
      const frame = { id: 'k', object: 'chat.completion.chunk', created: 1, model: modelId, choices: [{ index: 0, delta, finish_reason: null }] };
      res.write('data: ' + JSON.stringify(frame) + '\n\n');
      res.end('data: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let finish, timer;
  const completed = new Promise(resolve => { finish = resolve; timer = setTimeout(() => resolve('timeout'), 120000); });
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Lokal skriveprøve', options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'syntetisk' }, models: { [modelId]: { name: modelId, tool_call: true, limit: { context: 32768, output: 4096 } } } };
  const engine = new OpenCodeEngine({ root, directory, provider, model: { id: modelId }, references: [], mode: 'free', skills: [], tempRoot: path.join(root, '.aura', 'tmp'), onEvent: event => {
    if (event.type === 'permission.asked') { asked.push(event.properties); engine.reply(event.properties.id, true).catch(error => failures.push(error.message)); }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) finish(event.type);
  } });
  try {
    await engine.start(); await engine.send('Skriv filerne.', 'Brug kun værktøjerne.');
    const outcome = await completed;
    const main = requests.filter(body => body.tools?.some(tool => tool.function?.name === 'read'));
    const results = main.at(-1).messages.filter(message => message.role === 'tool').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    return { base, root, outside, directory, outcome, results, asked, failures, tools: (requests[0]?.tools || []).map(tool => tool.function?.name) };
  } finally { clearTimeout(timer); await engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const exists = file => fs.access(file).then(() => true, () => false);
const refused = /Skriv ikke uden for projektmappen/;
const patch = (kind, file) => ({ patchText: `*** Begin Patch\n*** Add File: ${file}\n+indhold\n*** End Patch` });

(async () => {
  const checks = [];
  // 1) Almindelig model: write, parallelle afvisninger og en kommando.
  const a = await run({
    modelId: 'skrivemodel',
    steps: [
      [['write', ({ root }) => ({ filePath: path.join(root, 'app', '[slug]', 'page.tsx'), content: 'inde 1' })]],
      [['write', ({ outside }) => ({ filePath: path.join(outside, 'ude.txt'), content: 'MÅ_IKKE_SKRIVES' })]],
      [0, 1, 2].map(n => ['write', ({ outside }) => ({ filePath: path.join(outside, `p${n}.txt`), content: 'MÅ_IKKE_SKRIVES' })]),
      [['bash', { command: 'echo "$TMPDIR" > "$TMPDIR/tmpdir.txt"; echo "$TMPDIR"', description: 'Vis temp' }]]
    ]
  });
  assert.equal(a.outcome, 'session.idle', 'opgaven afsluttes normalt: ' + JSON.stringify(a.failures));
  assert.equal(a.results.length, 6);
  assert.equal(await fs.readFile(path.join(a.root, 'app', '[slug]', 'page.tsx'), 'utf8'), 'inde 1'); checks.push('write med [klammer] i stien lykkes');
  for (const index of [1, 2, 3, 4]) assert.match(a.results[index], refused, 'resultat ' + index + ': ' + a.results[index].slice(0, 160));
  assert.deepEqual(await fs.readdir(a.outside), [], 'intet skrevet uden for projektet'); checks.push('write uden for projektet nægtes, også tre ad gangen, og opgaven fortsætter');
  const tmp = path.join(a.root, '.aura', 'tmp');
  assert.equal((await fs.readFile(path.join(tmp, 'tmpdir.txt'), 'utf8')).trim(), tmp, 'kommandoens TMPDIR er .aura/tmp'); checks.push('TMPDIR for AI\'ens kommando er projektets .aura/tmp');
  assert.deepEqual((await fs.readdir(tmp)).filter(name => name !== '.gitignore' && name !== 'tmpdir.txt'), [], 'motoren har ikke lagt filer i .aura/tmp'); checks.push('motorens egne udpakkede filer lander ikke i projektet');
  assert.ok((await fs.readdir(path.join(a.directory, 'tmp'))).length >= 0);
  assert.deepEqual(a.failures, []);
  // 2) GPT-model: kun apply_patch.
  const b = await run({
    modelId: 'gpt-5-prove',
    steps: [
      [['apply_patch', ({ root }) => patch('add', 'public/p1.html')]],
      [['apply_patch', () => patch('add', 'app/[slug]/side.tsx')]],
      [['apply_patch', ({ outside }) => patch('add', path.join(outside, 'ude.txt'))]],
      [['apply_patch', () => patch('add', '../ekstern/relativ.txt')]]
    ]
  });
  assert.ok(b.tools.includes('apply_patch') && !b.tools.includes('write'), 'GPT-modellen får kun apply_patch: ' + b.tools.join(','));
  assert.equal(b.outcome, 'session.idle', JSON.stringify(b.failures));
  assert.equal(await fs.readFile(path.join(b.root, 'public', 'p1.html'), 'utf8'), 'indhold\n'); checks.push('apply_patch med ny fil i projektet lykkes');
  assert.equal(await exists(path.join(b.root, 'app', '[slug]', 'side.tsx')), true); checks.push('apply_patch med [klammer] i stien lykkes');
  for (const index of [2, 3]) assert.match(b.results[index], refused, b.results[index].slice(0, 160));
  assert.deepEqual(await fs.readdir(b.outside), []); checks.push('apply_patch uden for projektet nægtes');
  assert.deepEqual(b.failures, []);
  // 3) Git-projekt: en godkendt læsning uden for projektet må ikke afvises af motorens egen regel (mønstrene for navne med punktum).
  const c = await run({
    modelId: 'skrivemodel',
    setup: async ({ root, outside }) => { require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: root }); await fs.writeFile(path.join(outside, 'fil.txt'), 'LÆSBART_UDENFOR'); },
    steps: [[['read', ({ outside }) => ({ filePath: path.join(outside, 'fil.txt') })]]]
  });
  assert.equal(c.outcome, 'session.idle', JSON.stringify(c.failures));
  assert.match(c.results[0], /LÆSBART_UDENFOR/, 'læsning uden for et Git-projekt efter godkendelse: ' + c.results[0].slice(0, 200)); checks.push('godkendt læsning uden for et Git-projekt lykkes');
  assert.deepEqual(c.asked.map(p => p.permission), ['external_directory']);
  const report = { status: 'bestået', platform: process.platform, checks, kort: { a: a.asked.map(p => p.permission), b: b.asked.map(p => p.permission) } };
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
