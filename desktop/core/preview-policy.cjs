const { normalizeRuntimeConfig, LOOPBACK } = require('./project-runtime.cjs');

function originOf(value) {
  try { const url = new URL(value); return url.host && !url.username && !url.password ? `${url.protocol}//${url.host}` : null; } catch { return null; }
}
const local = origin => { try { const h = new URL(origin).hostname.replace(/\.$/, ''); return LOOPBACK.has(h) || h.endsWith('.localhost') || /^127\./.test(h) || /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/i.test(h); } catch { return false; } };
function policyFor({ origin, projectOrigin, serviceOrigins = [], services = [], network = {}, static: isStatic = false } = {}) {
  const own = originOf(projectOrigin || origin);
  if (!own) throw Error('Forhåndsvisningen mangler sin egen adresse.');
  const attached = new Set([own, ...serviceOrigins.map(originOf), ...services.map(s => originOf(s.url))].filter(Boolean));
  const config = normalizeRuntimeConfig({ network }).network;
  const permitted = {};
  for (const [kind, origins] of Object.entries(config)) {
    // En lokal adresse kan kun godkendes, når tjenesten hører til netop dette projekt.
    permitted[kind] = origins.filter(address => !local(address) || attached.has(address));
  }
  return { origin: own, serviceOrigins: [...attached], network: permitted, static: isStatic };
}
function requestKind(resourceType) {
  return ({ script: 'scripts', stylesheet: 'styles', font: 'styles', image: 'images', media: 'images', xhr: 'connect', fetch: 'connect', webSocket: 'connect', ping: 'connect' })[resourceType] || null;
}
function socketOrigin(origin) { return origin.startsWith('https:') ? origin.replace(/^https:/, 'wss:') : origin.startsWith('http:') ? origin.replace(/^http:/, 'ws:') : null; }
function allowedRequest(input, supplied) {
  const policy = supplied || input.policy || policyFor(input), url = input.url, kind = requestKind(input.resourceType);
  if (typeof url !== 'string') return false;
  if (/^(?:data:|blob:)/.test(url)) return ['image', 'media'].includes(input.resourceType);
  const origin = originOf(url);
  if (!origin) return false;
  if (origin === policy.origin) return true;
  // https: for billeder og medier er et skema, ikke en adresse (beslutning for beta 2).
  if (kind === 'images' && policy.network.images?.includes('https:') && origin.startsWith('https://')) return true;
  if (kind === 'connect' && policy.serviceOrigins.some(service => origin === service || origin === socketOrigin(service))) return true;
  return Boolean(kind && policy.network[kind]?.includes(origin));
}
function contentSecurityPolicy(input) {
  const p = input.origin && input.serviceOrigins && input.network ? input : policyFor(input);
  const values = key => [...new Set(p.network[key] || [])].join(' ');
  const connections = [...new Set([...p.serviceOrigins, ...p.serviceOrigins.map(socketOrigin).filter(Boolean), ...(p.network.connect || [])])].join(' ');
  return [`default-src 'self'`, `script-src 'self' 'unsafe-inline' 'unsafe-eval'${values('scripts') ? ' ' + values('scripts') : ''}`, `style-src 'self' 'unsafe-inline'${values('styles') ? ' ' + values('styles') : ''}`, `font-src 'self' data:${values('styles') ? ' ' + values('styles') : ''}`, `img-src 'self' data: blob:${values('images') ? ' ' + values('images') : ''}`, `media-src 'self' blob:${values('images') ? ' ' + values('images') : ''}`, `connect-src 'self' ${connections}`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, ...(p.static ? ['sandbox allow-scripts allow-same-origin allow-forms'] : [])].join('; ');
}
function blockedRequest(input) {
  const kind = requestKind(input.resourceType), origin = originOf(input.url);
  const label = { scripts: 'Et kodebibliotek', styles: 'En typografi eller stilfil', images: 'Et billede eller en mediefil', connect: 'En forbindelse til en tjeneste' }[kind] || 'En ressource';
  return { kind: kind || 'resource', origin, resourceType: input.resourceType || 'other', reason: 'network-policy', message: `${label} fra ${origin || 'en ukendt adresse'} blev blokeret af projektets netadgang.`, repair: kind === 'scripts' || kind === 'styles' ? 'Brug projektets lokale pakker og filer, eller gennemgå netadgangen til den konkrete adresse. Bevar projektets valgte teknologi.' : 'Kontrollér, om appen skal bruge denne tjeneste, og gennemgå projektets netadgang. Erstat ikke rigtige data med opdigtede resultater.' };
}

module.exports = { originOf, policyFor, allowedRequest, contentSecurityPolicy, blockedRequest, requestKind };
