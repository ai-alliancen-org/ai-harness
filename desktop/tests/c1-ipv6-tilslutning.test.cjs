// K3 (beta 3): «Tilslut en anden server» tog imod http://[::1]:<port>/, men appens egen indholdspolitik (frame-src i ui/index.html)
// har ingen IPv6-adresse, og en IPv6-adresse kan ikke skrives som kilde i en indholdspolitik. Rammen stod tom med teksten «Den viser kun
// projektets egen side. Tryk ↻», og ↻ gav samme blokering igen. Tilslutningen siger nu straks, at localhost er vejen til samme server.
// Prøven kører main.cjs' egen kanal preview:attach mod rigtige lokale servere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { cut, load, desktopRequire } = require('./c1-main-kilde.cjs');
const previewSession = desktopRequire('./core/preview-session.cjs');

function serve(host) {
  return new Promise(resolve => {
    const server = http.createServer((q, s) => s.end('<h1>hej</h1>'));
    server.once('error', () => resolve(null));
    server.listen(0, host, () => resolve(server));
  });
}
function attach() {
  const handlers = {}, space = { root: '/projekt', preview: null, externalPreview: null, devServer: { stop: async () => {} } };
  load([cut("handle('preview:attach'", '// Forhåndsvisningen af en Promte-app')], {
    handle: (channel, action) => { handlers[channel] = action; }, exclusive: action => action(), currentProject: () => ({ root: '/projekt' }),
    currentSpace: () => space, workspaceRoot: () => '/projekt', openProject: async () => ({ staticPreview: false }), previewSession,
    registry: { servers: () => [] }, spaces: new Map([['/projekt', space]])
  }, { lets: { selectedRoot: '/projekt' } });
  return { attach: value => handlers['preview:attach'](value), space };
}

test('en server på [::1] afvises med det samme med localhost som vej videre, i stedet for en tom ramme', async t => {
  const server = await serve('::1');
  if (server) t.after(() => server.close());
  const port = server ? server.address().port : 5173;
  const h = attach();
  await assert.rejects(h.attach(`http://[::1]:${port}/`), error => {
    assert.match(error.message, new RegExp(`Brug http://localhost:${port}/ i stedet`));
    assert.doesNotMatch(error.message, /svarer ikke/, 'det er ikke serveren, der fejler');
    return true;
  });
  assert.equal(h.space.externalPreview, null, 'adressen gemmes ikke');
  await assert.rejects(h.attach(`https://[::1]:${port}/app/`), /Brug https:\/\/localhost:\d+\/app\/ i stedet/);
});

test('modværn: en server på 127.0.0.1 og localhost kan stadig tilsluttes', async t => {
  const server = await serve('127.0.0.1');
  t.after(() => server.close());
  const port = server.address().port, h = attach();
  assert.equal(await h.attach(`http://127.0.0.1:${port}/`), `http://127.0.0.1:${port}/`);
  assert.equal(await h.attach(`http://localhost:${port}/`), `http://localhost:${port}/`);
  await assert.rejects(h.attach('ftp://[::1]/'), /Brug en lokal http- eller https-adresse/);
});
