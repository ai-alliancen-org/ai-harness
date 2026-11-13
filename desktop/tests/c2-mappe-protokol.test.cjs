// Fund 22 (beta 3): appens statiske forhåndsvisning (protokollen aura-preview) sender en mappe uden / til sidst videre til
// samme adresse med /, så sidens relative links peger ind i mappen. Med / til sidst vises mappens index.html.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installSession, staticPreview } = require('../core/preview-session.cjs');

test('den statiske forhåndsvisning sender en mappe uden / videre til samme adresse med /', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-mappe-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public/om'), { recursive: true }); await fs.mkdir(path.join(root, 'public/tom'));
  await fs.writeFile(path.join(root, 'public/index.html'), '<h1>Forside</h1>'); await fs.writeFile(path.join(root, 'public/om/index.html'), '<h1>Om os</h1>');
  const ctx = { key: 'projekt-a', root }; ctx.preview = staticPreview(ctx);
  let handler; installSession({ protocol: { handle(scheme, fn) { handler = fn; } }, webRequest: { onBeforeRequest() {}, onHeadersReceived() {} } }, { contexts: () => [ctx] });
  const moved = await handler(new Request('aura-preview://projekt-a/om?side=2'));
  assert.equal(moved.status, 302); assert.equal(moved.headers.get('location'), 'aura-preview://projekt-a/om/?side=2');
  const page = await handler(new Request('aura-preview://projekt-a/om/'));
  assert.equal(page.status, 200); assert.equal(await page.text(), '<h1>Om os</h1>');
  assert.equal((await handler(new Request('aura-preview://projekt-a/tom'))).status, 404, 'en mappe uden index.html sendes ikke videre');
});
