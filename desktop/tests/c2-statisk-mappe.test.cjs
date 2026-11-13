// Den statiske forhåndsvisning viser en mappes index.html (gennemgangens fund 22, beta 3), som GitHub Pages og de
// andre statiske værter gør: /om/ viser public/om/index.html, og /om sendes videre til /om/, så sidens relative links
// peger ind i mappen. Reglerne mod skjulte led, symbolske links og stier uden for public gælder stadig.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { readPreviewAsset, startPreview } = require('../core/preview.cjs');
function request(url) { return new Promise((resolve, reject) => { http.get(url, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })); }).on('error', reject); }); }

async function site(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-mappe-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); };
  await write('public/index.html', '<h1>Forside</h1><a href="om/">Om os</a>');
  await write('public/om/index.html', '<h1>Om os</h1><link rel="stylesheet" href="stil.css">');
  await write('public/om/stil.css', 'h1{color:teal}');
  await write('public/møder/index.html', '<h1>Møder</h1>');
  await fs.mkdir(path.join(root, 'public/tom'));
  await write('public/.skjult/index.html', 'SKJULT');
  await write('privat/index.html', 'PRIVAT');
  await fs.symlink(path.join(root, 'privat'), path.join(root, 'public/genvej'), 'junction');
  return root;
}

test('Electron-protokollen: /om/ viser mappens index.html, og /om giver besked om at sende videre til /om/', async t => {
  const root = await site(t);
  const page = await readPreviewAsset(root, '/om/');
  assert.equal(String(page.data), '<h1>Om os</h1><link rel="stylesheet" href="stil.css">');
  assert.equal(page.contentType, 'text/html; charset=utf-8');
  assert.equal(String((await readPreviewAsset(root, '/møder/')).data), '<h1>Møder</h1>');
  assert.equal(String((await readPreviewAsset(root, '/om/stil.css')).data), 'h1{color:teal}');
  assert.equal(String((await readPreviewAsset(root, '/')).data), '<h1>Forside</h1><a href="om/">Om os</a>', 'roden er uændret');
  // En mappe uden / til sidst: kun en kalder, der kan sende videre, får svaret; andre får fejlen som før.
  assert.deepEqual(await readPreviewAsset(root, '/om', { redirects: true }), { redirect: true });
  await assert.rejects(readPreviewAsset(root, '/om'));
  // Ingen index.html, skjulte led og symbolske links giver stadig en fejl.
  for (const pathname of ['/tom/', '/tom', '/.skjult/', '/.skjult', '/genvej/', '/genvej', '/../privat/', '/om//']) await assert.rejects(readPreviewAsset(root, pathname, { redirects: true }), pathname);
});

test('CLI’ens forhåndsvisning: /om/ viser mappens index.html, og /om sender videre til /om/ med nøglen i stien', async t => {
  const root = await site(t);
  const server = await startPreview(root);
  t.after(() => server.close());
  const base = new URL(server.url);
  const page = await request(server.url + 'om/');
  assert.equal(page.status, 200); assert.equal(page.text, '<h1>Om os</h1><link rel="stylesheet" href="stil.css">');
  assert.equal((await request(server.url + 'om/stil.css')).text, 'h1{color:teal}', 'det relative link peger ind i mappen');
  assert.equal((await request(server.url + encodeURIComponent('møder') + '/')).text, '<h1>Møder</h1>');
  const moved = await request(server.url + 'om?side=2');
  assert.equal(moved.status, 302); assert.equal(moved.headers.location, `${base.pathname}om/?side=2`);
  assert.equal(moved.headers['cache-control'], 'no-store');
  const encoded = await request(server.url + encodeURIComponent('møder'));
  assert.equal(encoded.status, 302); assert.equal(encoded.headers.location, `${base.pathname}${encodeURIComponent('møder')}/`);
  for (const relative of ['tom/', 'tom', '.skjult/', 'genvej/', 'genvej', '%2e%2e/privat/']) {
    const result = await request(server.url + relative);
    assert.equal(result.status, 404, relative); assert.ok(!/SKJULT|PRIVAT/.test(result.text), relative);
  }
});
