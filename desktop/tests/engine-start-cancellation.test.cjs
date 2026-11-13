const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeEngine, VERSION } = require('../core/engine.cjs');

// En rigtig separat proces og den rigtige vagtproces, men ingen model. Filer giver præcise opstartsbarrierer;
// prøven afhænger ikke af, om en bestemt computer starter OpenCode hurtigere end et klik på Stop.
const program = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
const file = name => path.join(__dirname, name);
const reached = name => fs.writeFileSync(file(name + '.ready'), String(process.pid));
const seen = name => fs.appendFileSync(file('requests.txt'), name + '\n');
const watchdog = setTimeout(() => process.exit(99), 10000); watchdog.unref();
if (process.argv.includes('--version')) {
  reached('version');
  if (config.hold === 'version') {
    const timer = setInterval(() => {
      if (fs.existsSync(file('release-version'))) { clearInterval(timer); console.log(config.version); }
    }, 5);
  } else console.log(config.version);
} else {
  reached('serve');
  (async () => {
    const engine = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
    // Den genererede skrive-/læsevagt kvitterer på samme måde, som når OpenCode indlæser den.
    for (const source of engine.plugin) {
      const plugin = await import(source);
      if (plugin.AuraReadProtection) await plugin.AuraReadProtection();
    }
    const answer = (res, value) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    const server = http.createServer((req, res) => {
      seen(req.method + ' ' + req.url);
      if (req.url === '/global/health') { reached('health'); if (config.hold !== 'health') answer(res, { version: config.version }); }
      else if (req.url === '/config') answer(res, engine);
      else if (req.url === '/session' && req.method === 'POST') { reached('session'); if (config.hold !== 'session') answer(res, { id: 'ses_startup_test' }); }
      else if (req.url === '/event') {
        reached('events');
        if (config.hold !== 'events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': ready\n\n'); }
      } else if (req.url === '/session/ses_startup_test/abort') { reached('abort'); if (config.hold !== 'prompt-and-abort') answer(res, true); }
      else if (req.url === '/session/ses_startup_test/prompt_async') { reached('prompt'); if (!['prompt', 'prompt-and-abort'].includes(config.hold)) answer(res, true); }
      else { res.writeHead(404); res.end('{}'); }
    });
    server.listen(0, '127.0.0.1', () => {
      if (config.hold !== 'address') console.log('http://127.0.0.1:' + server.address().port);
    });
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
`;

async function within(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function until(check, message, ms = 2000) {
  const started = Date.now();
  while (!await check()) {
    if (Date.now() - started >= ms) throw new Error(message);
    await delay(5);
  }
}
const exists = file => fs.access(file).then(() => true, () => false);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

async function fixture(t, hold) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-start-cancel-')));
  const root = path.join(base, 'project'), binary = path.join(base, 'opencode');
  await fs.mkdir(root);
  await fs.symlink(process.execPath, path.join(base, 'node'));
  await fs.writeFile(binary, '#!/bin/sh\nexec "$(dirname "$0")/node" "$(dirname "$0")/server.cjs" "$@"\n', { mode: 0o755 });
  await fs.writeFile(path.join(base, 'server.cjs'), program);
  await fs.writeFile(path.join(base, 'fixture.json'), JSON.stringify({ version: VERSION, hold }));
  const previous = process.env.HARNESS_OPENCODE_PATH;
  process.env.HARNESS_OPENCODE_PATH = binary;
  const events = [], engine = new OpenCodeEngine({ root, directory: path.join(base, 'runtime'), model: { id: 'test' },
    provider: { npm: '@ai-sdk/openai-compatible', name: 'test', options: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'synthetic-only' }, models: { test: { name: 'test' } } },
    startTimeout: 8000, onEvent: event => events.push(event) });
  let settled = false;
  const started = engine.start().then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  t.after(async () => {
    // Også den gamle kode skal kunne ryddes efter en fejlet påstand: frigiv en holdt --version, og vent på den
    // kontrollerede serve-proces, før den lukkes. Ingen fallback til en anden installeret motor er nødvendig.
    await fs.writeFile(path.join(base, 'release-version'), '').catch(() => {});
    if (!settled) await until(async () => settled || await exists(path.join(base, 'serve.ready')), 'fixture cleanup did not reach serve', 2000).catch(() => {});
    await engine.close().catch(() => {});
    await within(started, 2000, 'fixture startup did not close').catch(() => {});
    for (const phase of ['version', 'serve']) {
      const pid = Number(await fs.readFile(path.join(base, phase + '.ready'), 'utf8').catch(() => ''));
      if (pid && alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (previous === undefined) delete process.env.HARNESS_OPENCODE_PATH; else process.env.HARNESS_OPENCODE_PATH = previous;
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, engine, events, started,
    reached: phase => until(() => exists(path.join(base, phase + '.ready')), 'startup did not reach ' + phase),
    requests: async () => (await fs.readFile(path.join(base, 'requests.txt'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean) };
}

for (const [phase, barrier] of [['version', 'version'], ['address', 'serve'], ['health', 'health'], ['session', 'session'], ['events', 'events']]) {
  test('Stop cancels startup while awaiting ' + phase + ' and leaves no process or prompt', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
    const f = await fixture(t, phase);
    await f.reached(barrier);
    await within(f.engine.abort(), 1500, 'Stop did not finish promptly');
    const outcome = await within(f.started, 1500, 'startup remained pending after Stop');
    assert.equal(outcome.error?.name, 'AbortError', outcome.error?.message || 'startup unexpectedly succeeded');
    assert.equal(f.engine.active, false);
    await delay(30);
    for (const name of ['version', 'serve']) {
      const pid = Number(await fs.readFile(path.join(f.base, name + '.ready'), 'utf8').catch(() => ''));
      if (pid) await until(() => !alive(pid), name + ' process survived Stop', 500);
    }
    assert.equal((await f.requests()).some(request => request.endsWith('/prompt_async')), false);
    assert.equal(f.events.some(event => event.type === 'engine.error'), false, 'cancelled startup is not an engine failure');
    if (phase === 'version') assert.equal(await exists(path.join(f.base, 'serve.ready')), false, 'a cancelled version probe must never start the server');
    if (['version', 'address', 'health'].includes(phase)) assert.equal((await f.requests()).some(request => request === 'POST /session'), false, 'a later startup phase cannot create a session after Stop');
  });
}

test('abort after successful startup keeps the active session usable', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const f = await fixture(t, null);
  const outcome = await within(f.started, 2000, 'controlled startup did not complete');
  assert.equal(outcome.value, 'ses_startup_test', outcome.error?.message);
  await f.engine.abort();
  assert.equal(f.engine.active, true, 'normal Stop preserves the reusable engine session');
  const listening = f.engine.listen();
  await f.engine.eventStream.ready;
  await f.engine.send('A new controlled turn', 'Synthetic rules');
  assert.deepEqual((await f.requests()).filter(request => request.endsWith('/abort') || request.endsWith('/prompt_async')),
    ['POST /session/ses_startup_test/abort', 'POST /session/ses_startup_test/prompt_async']);
  await f.engine.close(); await listening;
});

for (const hold of ['prompt', 'prompt-and-abort']) test('Stop before prompt acknowledgement cancels the single POST and closes the engine' + (hold === 'prompt-and-abort' ? ', even if abort acknowledgement stalls' : ''), { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const f = await fixture(t, hold);
  const startup = await within(f.started, 2000, 'controlled startup did not complete');
  assert.equal(startup.value, 'ses_startup_test', startup.error?.message);
  const sent = f.engine.send('A controlled turn with a held acknowledgement', 'Synthetic rules').then(value => ({ value }), error => ({ error }));
  await f.reached('prompt');
  await within(f.engine.abort({ starting: true }), 1500, 'Stop did not finish before the acknowledgement');
  const outcome = await within(sent, 1500, 'the prompt POST remained pending after Stop');
  assert.equal(outcome.error?.name, 'AbortError', outcome.error?.message || 'the held POST unexpectedly succeeded');
  assert.equal(f.engine.active, false);
  const pid = Number(await fs.readFile(path.join(f.base, 'serve.ready'), 'utf8'));
  await until(() => !alive(pid), 'engine process survived Stop before acknowledgement', 500);
  const requests = await f.requests();
  assert.equal(requests.filter(request => request.endsWith('/prompt_async')).length, 1, 'cancellation must not retry the POST');
  assert.equal(requests.filter(request => request.endsWith('/abort')).length, 1, 'the engine must be asked to clean up tools before process shutdown');
  assert.equal(await exists(path.join(f.base, 'abort.ready')), true);
  assert.equal(f.events.some(event => event.type === 'engine.error'), false);
});
