// Køres af almindelig Node.js i en separat proces, først efter brugerens godkendelse.
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const net = require('node:net');
const [root, kind] = process.argv.slice(2);
let server;
// komplai Run-appens SDK på /_komplai/run/, som Run serverer det på appens egen adresse. Aura leverer filen.
let asked = 0;
const waiting = new Map();
process.on('message', message => { if (message?.type === 'komplai-sdk' && waiting.has(message.id)) { waiting.get(message.id)(message.script); waiting.delete(message.id); } });
const komplaiSdk = route => new Promise(resolve => { const id = ++asked; waiting.set(id, resolve); process.send?.({ type: 'komplai-sdk', id, route }); setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 20000).unref(); });
const komplai = { name: 'aura-komplai-sdk', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
  const route = (req.url || '').split('?')[0];
  if (!['/_komplai/run/v1.js', '/_komplai/run/v1.mjs'].includes(route)) return next();
  const script = await komplaiSdk(route);
  if (typeof script !== 'string') { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(script);
}); } };
async function close() { try { await (kind === 'vite' ? server?.close() : server?.stop()); } finally { process.exit(0); } }
process.on('disconnect', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
(async () => {
  const requireProject = createRequire(path.join(root, 'package.json'));
  let entry = requireProject.resolve(kind);
  // require.resolve vælger Vite 5's CJS-wrapper. Dens dynamiske exports bliver
  // ikke named exports ved import(), så createServer mangler. Vælg pakkens
  // import-betingelse, som en almindelig ESM-import ville gøre.
  try {
    const manifestFile = requireProject.resolve(`${kind}/package.json`), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const select = value => {
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.map(select).find(Boolean);
      if (value && typeof value === 'object') for (const [condition, target] of Object.entries(value)) if (['node', 'node-addons', 'import', 'default'].includes(condition)) { const found = select(target); if (found) return found; }
      return null;
    };
    const target = select(manifest.exports?.['.'] ?? manifest.exports);
    if (target?.startsWith('./')) {
      const folder = path.dirname(manifestFile), candidate = path.resolve(folder, target);
      if (!candidate.startsWith(folder + path.sep)) throw Error('Frameworkets startfil ligger uden for pakken.');
      entry = candidate;
    }
  } catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }
  if (!entry.startsWith(path.join(root, 'node_modules') + path.sep)) throw new Error('Projektets egen framework-installation mangler.');
  const imported = await import(pathToFileURL(entry).href);
  const framework = typeof imported[kind === 'vite' ? 'createServer' : 'dev'] === 'function' ? imported : imported.default;
  if (typeof framework?.[kind === 'vite' ? 'createServer' : 'dev'] !== 'function') throw Error('Frameworkets lokale startfunktion blev ikke fundet. Kontrollér pakkens version og installation.');
  // Vite interprets zero as its default port. Reserve a concrete loopback
  // candidate and keep strictPort so a later collision fails instead of routing
  // this workspace to another server. This probe is not an atomic port lease.
  const requestedPort = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(error => error ? reject(error) : resolve(port)); });
  });
  let port, base = '/';
  if (kind === 'vite') {
    server = await framework.createServer({ root, clearScreen: false, plugins: [komplai], server: { host: '127.0.0.1', port: requestedPort, strictPort: true, open: false } });
    await server.listen();
    const address = server.httpServer.address();
    if (address.address !== '127.0.0.1') throw new Error('Serveren skal lytte på loopback.');
    port = address.port; base = server.config.base;
  } else if (kind === 'astro') {
    server = await framework.dev({ root, server: { host: '127.0.0.1', port: requestedPort, open: false }, vite: { clearScreen: false, plugins: [komplai], server: { strictPort: true, open: false } }, integrations: [{ name: 'aura-preview', hooks: { 'astro:config:done': ({ config }) => { base = config.base; } } }] });
    if (server.address.address !== '127.0.0.1') throw new Error('Serveren skal lytte på loopback.');
    port = server.address.port;
  } else throw new Error('Ukendt framework.');
  process.send?.({ type: 'ready', url: `http://127.0.0.1:${port}${base.startsWith('/') ? base : '/'}` });
})().catch(error => { console.error(error.message); process.exitCode = 1; process.exit(1); });
