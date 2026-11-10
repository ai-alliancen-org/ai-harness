const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { policyFor, contentSecurityPolicy } = require('./preview-policy.cjs');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

async function publicFile(root, relative) {
  const parts = relative.split('/');
  if (parts.some(part => !part || part.startsWith('.') || part.includes('\\') || part.includes(':'))) throw new Error('Ugyldig sti.');
  let target = root;
  if (!(await fs.lstat(target)).isDirectory()) throw new Error('Ugyldig rodmappe.');
  for (const part of parts) {
    target = path.join(target, part);
    if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Symbolske links serveres ikke.');
  }
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('Filen kan ikke vises.');
  return target;
}
// Bruges også af Electron-protokollen, hvis main giver hvert projekt en fast, særskilt origin.
// En mappe vises med sin index.html, som på GitHub Pages og de andre statiske værter (fund 22, beta 3): en adresse med /
// til sidst giver mappens index.html. En mappe uden / til sidst giver { redirect: true } til en kalder, der kan sende
// browseren videre til samme adresse med /, så sidens relative links peger ind i mappen. Andre kaldere får fejlen som før.
async function readPreviewAsset(projectRoot, pathname, { sdk, redirects = false } = {}) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) throw Error('Ugyldig sti.');
  if (sdk && pathname.startsWith('/_komplai/run/')) {
    const script = await sdk(pathname);
    if (typeof script !== 'string') throw Error('SDK-filen findes ikke.');
    return { data: Buffer.from(script), contentType: 'text/javascript; charset=utf-8' };
  }
  const publicRoot = path.join(projectRoot, 'public'), relative = pathname.slice(1);
  let file;
  try { file = await publicFile(publicRoot, !relative || relative.endsWith('/') ? relative + 'index.html' : relative); }
  catch (error) {
    if (redirects && relative && !relative.endsWith('/') && await publicFile(publicRoot, relative + '/index.html').then(() => true, () => false)) return { redirect: true };
    throw error;
  }
  return { data: await fs.readFile(file), contentType: mime[path.extname(file).toLowerCase()] || 'application/octet-stream' };
}
// sdk(route) leverer komplai Run-appens SDK på /_komplai/run/, som Run gør på appens egen adresse.
async function startPreview(projectRoot, { sdk, network = {}, serviceOrigins = [], host = '127.0.0.1', port = 0 } = {}) {
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535) throw Error('Forhåndsvisningen skal bruge en lokal port.');
  const token = randomBytes(24).toString('hex');
  let origin, cookie;
  // Adressen med nøglen i stien giver browseren en cookie med samme nøgle (HttpOnly, SameSite=Strict, navngivet efter porten).
  // Så virker sidens rod-absolutte links, fx href="/om/" og "/style.css", som på en rigtig vært (Q:C2-3). Uden nøglen i stien
  // eller cookien afvises kaldet som før.
  const admitted = header => String(header || '').split(';').some(part => { const [name, ...value] = part.trim().split('='); return name === cookie && value.join('=') === token; });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(policyFor({ origin, network, serviceOrigins, static: true })));
    try {
      if (req.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(req.method)) throw new Error('Afvist.');
      const url = new URL(req.url, origin), pathname = decodeURIComponent(url.pathname);
      const sdkRoute = sdk && pathname.startsWith('/_komplai/run/'), keyed = pathname.startsWith(`/${token}/`);
      if (!sdkRoute && !keyed && !admitted(req.headers.cookie)) throw new Error('Afvist.');
      const { data, contentType, redirect } = await readPreviewAsset(projectRoot, sdkRoute || !keyed ? pathname : '/' + pathname.slice(token.length + 2), { sdk, redirects: true });
      if (keyed) res.setHeader('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      // En mappe uden / til sidst: samme adresse med /, med nøglen i stien, hvis den stod der, og adressens egen kodning.
      if (redirect) { res.writeHead(302, { Location: `${url.pathname}/${url.search}` }); return res.end(); }
      res.setHeader('Content-Type', contentType);
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Filen findes ikke i projektets offentlige mappe.');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  origin = `http://127.0.0.1:${server.address().port}`; cookie = `aura-preview-${server.address().port}`;
  return { url: `${origin}/${token}/`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
module.exports = { startPreview, publicFile, readPreviewAsset };
