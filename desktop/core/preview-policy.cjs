const { normalizeRuntimeConfig, LOOPBACK } = require('./project-runtime.cjs');

function originOf(value) {
  try { const url = new URL(value); return url.host && !url.username && !url.password ? `${url.protocol}//${url.host}` : null; } catch { return null; }
}
const local = origin => { try { const h = new URL(origin).hostname.replace(/\.$/, ''); return LOOPBACK.has(h) || h.endsWith('.localhost') || /^127\./.test(h) || /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/i.test(h); } catch { return false; } };
// Lokale og private adresser: loopback, 10/8, 172.16/12, 192.168/16, link-local 169.254/16, delt adresserum 100.64/10 (CGNAT, Tailscale), 0/8
// samt de tilsvarende IPv6-adresser, også når en IPv4-adresse ligger indlejret (::ffff:, ::a.b.c.d, 64:ff9b:: og 6to4 2002::).
// Kun skemaet https: for billeder (en bred tilladelse) må aldrig nå brugerens eget netværk.
function privateV4(a, b) { return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127; }
function v6Groups(h) {
  let text = h, tail = [];
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) { const n = dotted.slice(1).map(Number); if (n.some(x => x > 255)) return null; tail = [n[0] * 256 + n[1], n[2] * 256 + n[3]]; text = text.slice(0, dotted.index) + '0:0'; }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = part => part === '' ? [] : part.split(':').map(x => /^[\da-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN);
  const head = read(halves[0]), rest = halves.length === 2 ? read(halves[1]) : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill(0), ...rest] : head;
  if (groups.length !== 8 || groups.some(Number.isNaN)) return null;
  if (dotted) { groups[6] = tail[0]; groups[7] = tail[1]; }
  return groups;
}
function privateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return true;
  const parts = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (parts) { const [a, b] = parts.slice(1).map(Number); return privateV4(a, b); }
  if (!h.includes(':')) return false;
  const g = v6Groups(h);
  if (!g) return true;
  const v4 = x => privateV4(x >> 8, x & 255);
  const zero = n => g.slice(0, n).every(x => x === 0);
  if (zero(8) || (zero(7) && g[7] === 1)) return true;
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
  if (zero(5) && g[5] === 0xffff) return v4(g[6]);
  if (zero(4) && g[4] === 0xffff && g[5] === 0) return v4(g[6]);
  if (zero(6)) return v4(g[6]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return v4(g[6]);
  if (g[0] === 0x2002) return v4(g[1]);
  return false;
}
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
  // Lokale og private adresser lukkes dog også for billeder, så https: ikke kan nå brugerens eget netværk.
  if (kind === 'images' && policy.network.images?.includes('https:') && origin.startsWith('https://') && !privateHost(new URL(origin).hostname)) return true;
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

// Samtykke pr. adresse (valg 4, 5. november 2026): kun brugerens klik i appen kan føje en adresse til projektets netliste.
// Kun https, kun den præcise vært med et rigtigt domænenavn, aldrig IP-adresser, lokale eller private adresser, brugernavn, port eller jokertegn.
// Typen følger adressens brug: kode, typografi eller skrifter, billeder. Forbindelser (connect) kan ikke gives på den måde.
const CONSENT_KINDS = ['scripts', 'styles', 'images'];
// Endelser, der er forbeholdt eller bruges til interne net, kan ikke få samtykke, selv om de ligner rigtige domænenavne.
const INTERNAL_SUFFIXES = ['local', 'internal', 'lan', 'home', 'home.arpa', 'intranet', 'corp', 'private', 'localdomain', 'test', 'example', 'invalid', 'onion', 'arpa'];
const internalHost = host => INTERNAL_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix));
function consentableAddress(kind, address) {
  if (!CONSENT_KINDS.includes(kind)) return { ok: false, reason: 'Kun kode, typografi, skrifter og billeder kan tillades herfra.' };
  let url; try { url = new URL(address); } catch { return { ok: false, reason: 'Adressen er ikke en gyldig adresse.' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Kun adresser med https kan tillades.' };
  if (url.username || url.password || url.port || String(address).includes('*') || url.origin !== String(address).replace(/\/$/, '')) return { ok: false, reason: 'Adressen skal være en præcis vært uden login, port, sti eller jokertegn.' };
  const host = url.hostname.toLowerCase();
  if (privateHost(host) || internalHost(host) || host.includes(':') || /^[\d.]+$/.test(host) || !/^(?:[a-z0-9-]+\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host)) return { ok: false, reason: 'IP-adresser, lokale og private adresser kan ikke tillades.' };
  return { ok: true, origin: url.origin };
}
// Returnerer projektets nye netliste. `seen` er de blokeringer, appen selv har set; en adresse, der ikke er set blokeret, kan ikke tillades.
function grantAddress(runtime, seen, { kind, origin } = {}) {
  const check = consentableAddress(kind, origin);
  if (!check.ok) throw Error(check.reason);
  if (!(seen || []).some(item => item && item.kind === kind && item.origin === check.origin)) throw Error('Forhåndsvisningen har ikke blokeret denne adresse.');
  const config = normalizeRuntimeConfig(runtime || {});
  const network = { scripts: [], styles: [], images: [], connect: [], ...(config.network || {}) };
  if (!network[kind].includes(check.origin)) network[kind] = [...network[kind], check.origin];
  return { ...config, network };
}

module.exports = { consentableAddress, grantAddress, CONSENT_KINDS, privateHost, originOf, policyFor, allowedRequest, contentSecurityPolicy, blockedRequest, requestKind };
