// Spor P1: CDN-diagnosen når AI'ens værktøj aura_preview, og importmap og ESM-imports med i den statiske diagnose.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { aiPreview } = require('../core/ai-preview.cjs');
const { pluginSource } = require('../core/preview-bridge.cjs');
const { inspectPreviewDependencies } = require('../core/project-runtime.cjs');

async function projekt(t, html) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-p1-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public')); await fs.writeFile(path.join(root, 'public', 'index.html'), html);
  return root;
}
const find = (list, origin) => list.find(item => item.origin === origin);

test('et importmap med adresser på nettet giver en diagnose pr. adresse uden for netlisten', async t => {
  const root = await projekt(t, '<script type="importmap">{"imports":{"react":"https://esm.sh/react@18","lokal":"./a.js"},"scopes":{"/x/":{"d3":"https://cdn.skypack.dev/d3"}}}</script>');
  const fund = await inspectPreviewDependencies(root, {});
  assert.ok(find(fund, 'https://esm.sh')); assert.ok(find(fund, 'https://cdn.skypack.dev'));
  assert.equal(fund.length, 2, 'den lokale sti giver ingen diagnose');
  assert.equal(find(fund, 'https://esm.sh').kind, 'scripts');
});

test('ESM-imports fra https i et indlejret modulscript giver en diagnose', async t => {
  const root = await projekt(t, `<script type="module">import React from 'https://esm.sh/react'; import 'https://unpkg.com/x.js'; const m = await import("https://cdn.jsdelivr.net/y.js"); import local from './l.js';</script>`);
  const fund = await inspectPreviewDependencies(root, {});
  assert.deepEqual(fund.map(item => item.origin).sort(), ['https://cdn.jsdelivr.net', 'https://esm.sh', 'https://unpkg.com']);
});

test('script-sluttags med attributter, ASCII-mellemrum eller skråstreg bevarer importmap- og ESM-diagnoser', async t => {
  for (const closing of ['</script\t\n bar>', '</ScRiPt ignored=value>', '</script/>', '</script\f extra="x">']) {
    for (const [type, body] of [['importmap', '{"imports":{"x":"https://blocked.example/x.js"}}'], ['module', 'import x from "https://blocked.example/x.js";']]) {
      const root = await projekt(t, `<script type="${type}">${body}${closing}`);
      assert.deepEqual((await inspectPreviewDependencies(root)).map(item => item.origin), ['https://blocked.example'], `${type}: ${JSON.stringify(closing)}`);
    }
  }
});

test('script-lignende navne og ikke-HTML-mellemrum afslutter ikke et modulscript', async t => {
  for (const text of ['</script-template>', '</script:custom>', '</script\u00a0>']) {
    const root = await projekt(t, `<script type="module">const text = ${JSON.stringify(text)}; import x from "https://after.example/x.js";</script>`);
    assert.deepEqual((await inspectPreviewDependencies(root)).map(item => item.origin), ['https://after.example'], JSON.stringify(text));
  }
  const root = await projekt(t, '<script-template type="module">import x from "https://not-a-script.example/x.js";</script>');
  assert.deepEqual(await inspectPreviewDependencies(root), []);
});

test('importmap og imports på netlisten, i kommentarer eller uden adresse giver ingen diagnose', async t => {
  const root = await projekt(t, `<!-- <script type="importmap">{"imports":{"a":"https://skjult.example.net/a.js"}}</script> --><script type="importmap">{"imports":{"r":"https://esm.sh/r"}}</script><script type="module">import x from './x.js'; const tekst = "fra https://eksempel.dk";</script><script type="importmap">ikke json</script>`);
  assert.deepEqual(await inspectPreviewDependencies(root, { network: { scripts: ['https://esm.sh'] } }), []);
});

test('kommentarer sammenføjer ikke HTML- eller JavaScript-fragmenter til falske netafhængigheder', async t => {
  const root = await projekt(t, '<scr<!-- adskil -->ipt src="https://not-a-tag.example/a.js"></script>'
    + '<script type="module">im<!-- adskil -->port "https://not-an-import.example/b.js";</script>'
    + '<script type="module">import "https://real.example/c.js";</script>');
  assert.deepEqual((await inspectPreviewDependencies(root)).map(item => item.origin), ['https://real.example']);
});

test('JavaScript-kommentarer, strenge og andre scripttyper giver ingen falsk ESM-diagnose, men rigtige imports gør', async t => {
  const falsk = '<script>// import "https://old.example.com/x.js"\nconst a=1; /* import "https://blok.example.com/y.js" */ const b="Hent data from \'https://api.example.org/v1\' her"; const c=`import \'https://skabelon.example.com/z.js\'`;</script>'
    + '<script type="application/json">{"t":"import \'https://json.example.com/a.js\'"}</script>';
  assert.deepEqual(await inspectPreviewDependencies(await projekt(t, falsk), {}), []);
  const aegte = '<script type="module">// kommentar\nimport a from "https://aegte.example.com/a.js"; const s = "x"; const m = await import(\'https://dynamisk.example.com/b.js\');</script>';
  assert.deepEqual((await inspectPreviewDependencies(await projekt(t, aegte), {})).map(item => item.origin).sort(), ['https://dynamisk.example.com', 'https://aegte.example.com'].sort());
});

function rum(diagnostics) {
  const server = { state: 'running', snapshot() { return { state: 'running', url: 'http://127.0.0.1:4100/', message: '', output: '' }; },
    async status() { return { project: { kind: 'vite', diagnostics, fingerprint: 'f' } }; } };
  return { devServer: server, preview: { url: 'http://127.0.0.1:4100/' } };
}

test('aura_preview siger hvilken adresse der blokeres og beder om lokale filer, ikke netadgang', async () => {
  const svar = await aiPreview(rum([{ kind: 'scripts', origin: 'https://esm.sh' }]), 'status', { wait: async () => {} });
  assert.equal(svar.state, 'running'); assert.equal(svar.url, 'http://127.0.0.1:4100/');
  assert.deepEqual(svar.blocked, [{ adresse: 'https://esm.sh', slags: 'scripts' }]);
  assert.match(svar.message, /https:\/\/esm\.sh/); assert.match(svar.message, /lokale filer/);
  assert.match(svar.message, /Bed ikke om netadgang/); assert.match(svar.message, /opdigtede/);
});

test('uden blokerede adresser er svaret fra aura_preview uændret', async () => {
  const svar = await aiPreview(rum([]), 'status', { wait: async () => {} });
  assert.equal(svar.blocked, undefined); assert.equal(svar.message, '');
});

test('værktøjsbeskrivelsen i pluginet nævner blocked og lokale filer', () => {
  const kilde = pluginSource({ url: 'http://127.0.0.1:1/', token: 't', root: '/p' });
  assert.match(kilde, /blocked/); assert.match(kilde, /lokale filer/); assert.match(kilde, /netadgang/);
});
