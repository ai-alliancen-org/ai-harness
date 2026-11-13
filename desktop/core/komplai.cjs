const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const API = 'https://api.komplai.dk/v1/aura';
const ISSUER = 'https://auth.komplai.dk';
const messages = {
  aura_not_configured: 'komplai-login er ikke åbnet endnu. Vælg en anden forbindelse, eller prøv igen senere.',
  insufficient_scope: 'Denne konto har ikke adgang til komplai Run.',
  invalid_token: 'Adgangen blev afvist. Log ind med komplai igen.',
  publishing_not_enabled: 'Din organisation har ikke komplai Run. Bed jeres administrator om adgang.',
  key_limit: 'Du har for mange aktive udgivelsesadgange. Log ud på en anden computer, eller vent til en adgang udløber.',
};
const PUBLISH_GRANT = /^komp_publish_grant_[a-f0-9]{64}$/;
// Kun oplysninger om organisationens udgivelsesadgang bruges i Aura.
function organisation(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string') throw new Error('komplais organisationer kunne ikke læses.');
  const publishing = entry.publishing && typeof entry.publishing.address === 'string' && /^[a-z0-9.-]{3,253}$/.test(entry.publishing.address) ? { address: entry.publishing.address, tier: String(entry.publishing.tier || '') } : null;
  return { id: entry.id, name: entry.name, publishing };
}
async function json(url, { key, body, method = body ? 'POST' : 'GET', signal, fetcher = fetch } = {}) {
  let response;
  try { response = await fetcher(url, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  // unreachable og unreadable skelner et kald, der ikke kom igennem, fra et svar, der ikke kunne læses (fx ved fjernelse i workbench.cjs).
  catch { throw Object.assign(new Error(signal?.aborted ? 'Login blev afbrudt.' : 'komplai kunne ikke kontaktes. Prøv igen, når forbindelsen virker.'), { unreachable: !signal?.aborted }); }
  let data;
  try { const bodyText = await readBounded(response, 2_000_000); try { data = JSON.parse(bodyText); } catch { throw new Error('Svaret fra komplai kunne ikke læses.'); } }
  catch (error) { throw Object.assign(error, { unreadable: true }); }
  if (!response.ok) { const error = new Error(messages[data.error] || (response.status === 401 ? messages.invalid_token : response.status === 403 ? messages.insufficient_scope : 'komplai kunne ikke gennemføre handlingen. Prøv igen.')); error.status = response.status; if (typeof data.error === 'string' && /^[a-z_]{1,50}$/.test(data.error)) error.code = data.error; throw error; }
  return data;
}
async function readBounded(response, maxBytes) {
  const reader = response.body?.getReader(); let size = 0, parts = [];
  if (!reader) throw new Error('komplai svarede ikke.');
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > maxBytes) throw new Error('Svaret fra komplai er for stort.'); parts.push(Buffer.from(item.value)); } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(parts).toString();
}
const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Siden, browseren viser efter login. Den er selvstændig: ingen scripts, eksterne filer eller data fra adressen,
// og stilen er tilladt med sin hash i Content-Security-Policy. Lyst og mørkt tema følger browseren.
const CALLBACK_STYLE = ':root{color-scheme:light dark;--ink:#182235;--muted:#58677d;--surface:#fff;--canvas:#f8fafc;--line:#e0e7f0}@media (prefers-color-scheme:dark){:root{--ink:#e8edf5;--muted:#9aa8bd;--surface:#161e2e;--canvas:#0d1320;--line:#26324a}svg{border-radius:14px;box-shadow:0 0 0 1px #34425f}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:100%;max-width:400px;padding:36px 32px 32px;border:1px solid var(--line);border-radius:16px;background:var(--surface);text-align:center;box-shadow:0 12px 32px #0f172a14}svg{display:block;margin:0 auto 20px}h1{margin:0 0 8px;font-size:20px;line-height:1.3;letter-spacing:-.01em}p{margin:0;color:var(--muted)}';
const CALLBACK_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(CALLBACK_STYLE).digest('base64')}'; frame-ancestors 'none'`;
const AURA_MARK = '<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><rect width="56" height="56" rx="14" fill="#14203a"/><path d="M20.7 14.9A15 15 0 1 0 40.4 19.6" fill="none" stroke="#1bb886" stroke-width="4.6" stroke-linecap="round"/><circle cx="31.8" cy="13.4" r="2.7" fill="#5b9bff"/><circle cx="28" cy="28" r="6.8" fill="#fff"/></svg>';
function callbackPage(res, status, title, text) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CALLBACK_CSP });
  res.end(`<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Aura</title><style>${CALLBACK_STYLE}</style><main>${AURA_MARK}<h1>${title}</h1><p>${text}</p></main></html>`);
}

/** Login foregår i systembrowseren. OAuth-tokenet findes kun i hukommelsen indtil organisationsvalget. */
class KomplaiLogin {
  constructor({ baseURL = API, issuer = ISSUER, fetcher = (...args) => fetch(...args) } = {}) { this.baseURL = baseURL; this.issuer = issuer; this.fetcher = fetcher; this.pending = null; }
  cancel() { const current = this.pending; this.pending = null; if (current) { clearTimeout(current.timer); current.controller.abort(); current.server?.close(); current.reject?.(new Error('Login blev afbrudt.')); current.token = ''; } }
  async start(openBrowser) {
    this.cancel();
    const current = { controller: new AbortController(), token: '', organisations: [] };
    this.pending = current;
    current.timer = setTimeout(() => { if (this.pending === current) this.cancel(); }, 300000); current.timer.unref();
    try {
      const config = await json(`${this.baseURL}/config`, { fetcher: this.fetcher, signal: current.controller.signal });
      if (config.issuer !== this.issuer || typeof config.clientId !== 'string' || !config.clientId || !Array.isArray(config.scopes) || config.scopes.some(s => typeof s !== 'string' || /\s/.test(s))) throw new Error('komplais loginopsætning kunne ikke bekræftes.');
      for (const endpoint of [config.authorizationEndpoint, config.tokenEndpoint]) { if (typeof endpoint !== 'string' || new URL(endpoint).origin !== this.issuer || new URL(endpoint).username || new URL(endpoint).password || new URL(endpoint).hash) throw new Error('komplais loginadresse kunne ikke bekræftes.'); }
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
      const code = new Promise((resolve, reject) => {
        current.reject = reject;
        current.server = http.createServer((req, res) => {
          res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); res.setHeader('Referrer-Policy', 'no-referrer');
          const expectedHost = `127.0.0.1:${current.server.address()?.port}`;
          if (req.method !== 'GET' || req.headers.host !== expectedHost || req.url.length > 8192) { res.writeHead(400).end(); return; }
          const url = new URL(req.url, `http://${expectedHost}`);
          if (url.pathname !== '/komplai/callback' || url.searchParams.getAll('state').length !== 1 || !same(url.searchParams.get('state'), state)) { callbackPage(res, 400, 'Login kunne ikke bekræftes', 'Start login igen fra Aura.'); return; }
          const value = url.searchParams.get('code');
          if (current.received) { res.writeHead(409).end(); return; }
          current.received = true;
          if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !value || value.length > 4096) { callbackPage(res, 400, 'Login blev ikke gennemført', 'Gå tilbage til Aura, og prøv igen.'); reject(new Error('Login blev ikke gennemført.')); }
          else { callbackPage(res, 200, 'Du er logget ind', 'Gå tilbage til Aura for at fortsætte. Du kan lukke denne fane.'); resolve(value); }
          current.server.close();
        });
        current.server.on('error', () => reject(new Error('Aura kunne ikke åbne den lokale loginforbindelse.')));
      });
      // Fejl ved åbning af browseren må ikke efterlade et ubehandlet Promise.
      code.catch(() => {});
      await new Promise((resolve, reject) => { current.server.once('error', reject); current.server.listen(0, '127.0.0.1', resolve); });
      const redirect = `http://127.0.0.1:${current.server.address().port}/komplai/callback`;
      const url = new URL(config.authorizationEndpoint);
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: config.clientId, redirect_uri: redirect, scope: config.scopes.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
      await openBrowser(url.href);
      const authorizationCode = await code;
      const response = await this.fetcher(config.tokenEndpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.any([current.controller.signal, AbortSignal.timeout(15000)]), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, code: authorizationCode, redirect_uri: redirect, code_verifier: verifier }) });
      // Tokenresponsen føres aldrig videre til brugerfladen eller til fejlbeskeder.
      if (!response.ok) { await response.body?.cancel(); throw new Error('komplai kunne ikke bekræfte login. Prøv igen.'); }
      const body = await readBounded(response, 64000);
      let tokens; try { tokens = JSON.parse(body); } catch { throw new Error('Ugyldigt svar fra login.'); }
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 16000 || tokens.token_type?.toLowerCase() !== 'bearer') throw new Error('Ugyldigt svar fra login.');
      if (this.pending !== current) throw new Error('Login blev afbrudt.');
      current.token = tokens.access_token;
      const result = await json(`${this.baseURL}/organisations?include=publishing`, { key: current.token, fetcher: this.fetcher, signal: current.controller.signal });
      if (!Array.isArray(result.organisations)) throw new Error('komplais organisationer kunne ikke læses.');
      current.organisations = result.organisations.map(organisation).filter(entry => entry.publishing);
      return { organisations: current.organisations };
    } catch (error) { if (this.pending === current) this.cancel(); throw error; }
  }
  /** komplai Run for samme login: en særskilt adgang, der kun kan oprette og opdatere personens egne apps. */
  async connectPublishing(organisationID, store) {
    const current = this.pending, organisation = current?.organisations.find(o => o.id === organisationID);
    if (!current?.token || !organisation) throw new Error('Log ind igen, og vælg din organisation.');
    if (!organisation.publishing) throw new Error(messages.publishing_not_enabled);
    store.encrypt('kontrol');
    const result = await json(`${this.baseURL}/publishing/connect`, { key: current.token, fetcher: this.fetcher, signal: current.controller.signal, body: { organisationId: organisation.id, acceptPublishing: true } });
    if (typeof result.secret !== 'string' || !PUBLISH_GRANT.test(result.secret) || typeof result.id !== 'string' || !Number.isFinite(Date.parse(result.expiresAt)) || result.address !== organisation.publishing.address) throw new Error('komplai returnerede ikke en gyldig udgivelsesadgang.');
    try {
      const previous = (await store.read()).hosting?.komplai;
      await store.update(state => { state.hosting = { ...state.hosting, komplai: { secret: store.encrypt(result.secret), grantId: result.id, organisationId: organisation.id, organisationName: organisation.name, address: result.address, expiresAt: result.expiresAt } }; });
      // En erstattet adgang tilbagekaldes, så den ikke ligger tilbage på serveren. Kan den gamle adgang ikke læses på denne
      // computer, kan den ikke tilbagekaldes herfra; den nye adgang gælder alligevel og må ikke rulles tilbage.
      if (previous?.secret) await Promise.resolve().then(() => revokePublishing(store.decrypt(previous), this.baseURL, this.fetcher)).catch(() => {});
    } catch (error) { await revokePublishing(result.secret, this.baseURL, this.fetcher).catch(() => {}); throw error; }
    return publishingState(store);
  }

}
// Afviser komplai adgangen som ugyldig eller ukendt (401, 404 med fejlkoden not_found, invalid_token), er den allerede væk på serveren.
// Så er tilbagekaldelsen lykkedes, og den lokale post kan slettes.
// En 404 uden komplais egen fejlkode kan være en forkert rute eller adresse, så den tæller ikke som slettet.
const alreadyGone = error => error?.status === 401 || (error?.status === 404 && error?.code === 'not_found') || error?.code === 'invalid_token';
async function gone(request) {
  try { return await request(); }
  catch (error) { if (alreadyGone(error)) return { revoked: true, alreadyGone: true }; throw error; }
}
async function revokePublishing(secret, baseURL = API, fetcher = fetch) {
  return gone(() => json(`${baseURL}/publishing/session`, { method: 'DELETE', key: secret, fetcher }));
}
async function publishingState(store, now = Date.now()) {
  const saved = (await store.read()).hosting?.komplai;
  if (!saved?.secret) return { connected: false };
  return { connected: true, organisationId: saved.organisationId, organisationName: saved.organisationName, address: saved.address, expiresAt: saved.expiresAt, expired: Date.parse(saved.expiresAt) <= now };
}
/** Log ud tilbagekalder på serveren før den lokale sletning. Ved netværksfejl bevares adgangen, så det kan prøves igen. En adgang, komplai selv afviser, er allerede væk og slettes lokalt. */
async function disconnectPublishing(store, baseURL = API, fetcher = fetch, { force = false } = {}) {
  const saved = (await store.read()).hosting?.komplai;
  let revoked = !saved?.secret;
  // «Fjern kun fra denne computer» (force): kan komplai ikke nås, eller kan adgangen ikke læses, fjernes kun den lokale
  // adgang. Den kan så stadig være gyldig hos komplai, til den udløber, og svaret siger det med revoked: false.
  if (saved?.secret) {
    try {
      let secret;
      try { secret = store.decrypt(saved); } catch { throw new Error('Udgivelsesadgangen kan ikke læses på denne computer, så Aura kan ikke tilbagekalde den hos komplai. Du kan fjerne den fra denne computer.'); }
      await revokePublishing(secret, baseURL, fetcher); revoked = true;
    } catch (error) { if (!force) throw error; }
  }
  await store.update(state => { if (state.hosting) delete state.hosting.komplai; });
  const state = await publishingState(store);
  return force ? { ...state, revoked } : state;
}
async function disconnect(connection, key) {
  return gone(() => json(`${connection.baseURL.replace(/\/v1$/, '')}/session`, { method: 'DELETE', key }));
}
module.exports = { API, ISSUER, KomplaiLogin, json, readBounded, disconnect, organisation, publishingState, disconnectPublishing, revokePublishing };
