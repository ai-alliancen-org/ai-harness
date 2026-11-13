// Spor M3, årsag 5c: en langsom motorstart forklares i almindeligt dansk, og starttiden gemmes som et tal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeEngine, VERSION, SLOW_START_MS } = require('../core/engine.cjs');

const unix = { skip: process.platform === 'win32' };
// Falsk motor: svarer på --version, men printer aldrig sin adresse, når den startes som server.
async function langsomMotor(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m3-start-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'opencode');
  await fs.writeFile(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${VERSION}; exit 0; fi\nsleep 20\n`, { mode: 0o755 });
  return { dir, file };
}

test('5c: starter motoren ikke i tide, forklarer fejlen ventetiden og ikke installationen', unix, async t => {
  const { dir, file } = await langsomMotor(t);
  const før = process.env.HARNESS_OPENCODE_PATH; process.env.HARNESS_OPENCODE_PATH = file; t.after(() => { if (før === undefined) delete process.env.HARNESS_OPENCODE_PATH; else process.env.HARNESS_OPENCODE_PATH = før; });
  const root = path.join(dir, 'projekt'); await fs.mkdir(root);
  const engine = new OpenCodeEngine({ root, directory: path.join(dir, 'motor'), provider: { npm: '@ai-sdk/openai-compatible', name: 'x', options: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'x' }, models: { m: { name: 'm' } } }, model: { id: 'm' }, startTimeout: 400 });
  await assert.rejects(engine.start(), error => {
    assert.match(error.message, /længere tid end normalt/);
    assert.match(error.message, /Vent lidt, og prøv igen/);
    assert.ok(!/Kontrollér installationen/.test(error.message), error.message);
    return true;
  });
});

test('5c: grænsen for en langsom start ligger under timeoutten, så en lykkedes men langsom start også kan forklares', () => {
  assert.ok(SLOW_START_MS > 0 && SLOW_START_MS < 30000);
});

test('5c: en start, der lykkes men er langsom, gemmer starttiden som tal og markerer den som langsom', unix, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m3-start-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // Motoren printer sin adresse efter en forsinkelse. Selve kontrollen bagefter afvises af en falsk server, men tiden er målt til da.
  const server = require('node:http').createServer((req, res) => { res.writeHead(500); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const file = path.join(dir, 'opencode');
  await fs.writeFile(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${VERSION}; exit 0; fi\nsleep 0.4\necho "listening on http://127.0.0.1:${server.address().port}"\nsleep 20\n`, { mode: 0o755 });
  const før = process.env.HARNESS_OPENCODE_PATH; process.env.HARNESS_OPENCODE_PATH = file; t.after(() => { if (før === undefined) delete process.env.HARNESS_OPENCODE_PATH; else process.env.HARNESS_OPENCODE_PATH = før; });
  const root = path.join(dir, 'projekt'); await fs.mkdir(root);
  const engine = new OpenCodeEngine({ root, directory: path.join(dir, 'motor'), provider: { npm: '@ai-sdk/openai-compatible', name: 'x', options: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'x' }, models: { m: { name: 'm' } } }, model: { id: 'm' }, slowStartMs: 100 });
  await assert.rejects(engine.start());
  assert.ok(Number.isInteger(engine.startMs) && engine.startMs >= 100, String(engine.startMs));
  assert.equal(engine.slowStart, true);
});
