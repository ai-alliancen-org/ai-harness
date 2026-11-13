const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { publishingState } = require('./komplai.cjs');
const { appName } = require('./promte-preview.cjs');

// En komplai Run-app i Auras forhåndsvisning. Appen henter komplais app-SDK fra /_komplai/run/v1.js
// som på Run; Aura serverer SDK'et med en bro foran, så SDK'ets kald går til siden omkring appen.
// Hovedprocessen sender kaldet til Hubs forhåndsvisning af personens egen app. Hub bruger personens
// rigtige identitet og AI-adgang og holder forhåndsvisningens data adskilt fra appens rigtige data.
const ROUTE = /^\/_komplai\/api\/v1\/([a-z][a-z.]{0,30})(?:\/([a-z][a-z0-9-]{0,40}))?(?:\?([^#\s]{0,2048}))?$/;
const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const MANIFEST_BYTES = 16 * 1024, BODY_BYTES = 480 * 1024, SDK_LIFETIME = 5 * 60 * 1000;
const INLINE = /<script\b[^>]*\btype\s*=\s*["']application\/komplai\+json["'][^>]*>([\s\S]*?)<\/script\s*>/i;
// SDK'et bruger window.__komplaiPreview, når siden omkring appen sætter den. Kun i en ramme.
const BRIDGE = `(function () {
  if (window.parent === window) return;
  var next = 0, waiting = {};
  window.__komplaiPreview = {
    request: function (method, path, body) {
      return new Promise(function (resolve) {
        var id = ++next;
        waiting[id] = resolve;
        window.parent.postMessage({ komplaiPreview: 1, kind: "call", id: id, method: method, path: path, body: body }, "*");
      });
    }
  };
  window.addEventListener("message", function (event) {
    var d = event.data;
    if (event.source !== window.parent || !d || d.komplaiPreview !== 1 || d.kind !== "answer" || !waiting[d.id]) return;
    var resolve = waiting[d.id];
    delete waiting[d.id];
    resolve({ status: d.status, body: d.body });
  });
})();
`;
const MODULE = 'import "./v1.js";\nexport const komplai = globalThis.komplai;\nexport default komplai;\n';
const refuse = (error, status) => ({ status, body: { error } });

async function readText(file, max) {
  try { const stat = await fs.stat(file); return stat.isFile() && stat.size <= max ? await fs.readFile(file, 'utf8') : null; } catch { return null; }
}
/** Appens manifest, som Run læser det: komplai.json ved index.html, ellers i index.html's head. Ugyldig JSON giver { invalid: true }. */
async function localManifest(root) {
  for (const dir of ['public', '.']) {
    const text = await readText(path.join(root, dir, 'komplai.json'), MANIFEST_BYTES);
    if (text !== null) { try { return JSON.parse(text); } catch { return { invalid: true }; } }
  }
  for (const dir of ['public', '.']) {
    const inline = (await readText(path.join(root, dir, 'index.html'), 10 * 1024 * 1024))?.match(INLINE)?.[1];
    if (inline !== undefined) { if (Buffer.byteLength(inline) > MANIFEST_BYTES) return { invalid: true }; try { return JSON.parse(inline); } catch { return { invalid: true }; } }
  }
  return null;
}

class KomplaiPreview {
  constructor(store, { provider, enabled = async () => true, now = Date.now } = {}) {
    this.store = store; this.provider = provider; this.enabled = enabled; this.now = now; this.sessions = new Map(); this.sdk = null; this.problems = new Map();
  }
  /** Projektets app: oprettet fra forhåndsvisningen eller senest valgt i Udgiv. */
  async link(root) {
    const project = await this.store.project(root);
    const last = project.deploymentLast, config = project.deploymentConfig, created = project.deploymentCreatedApp;
    // En app, komplai oprettede ved et afvist forsøg, er den app, næste udgivelse går til, så længe den er projektets valgte
    // destination (samme regel som deployments.cjs, state().createdApp). Forhåndsvisningen følger den (RN:D2-3).
    if (created?.appId && config?.provider === 'komplai' && config.appId === created.appId) return { appId: created.appId, name: created.name || null };
    const appId = last?.config?.provider === 'komplai' ? last.appId || last.config.appId : config?.provider === 'komplai' ? config.appId : null;
    return appId ? { appId, name: last?.config?.provider === 'komplai' ? last.target?.name || null : null } : project.komplaiApp?.appId ? project.komplaiApp : null;
  }
  async state(root) {
    if (!await this.enabled(root)) return { active: false };
    const login = await publishingState(this.store, this.now());
    return { active: true, connected: Boolean(login.connected && !login.expired), link: await this.link(root), name: appName(root), problem: this.problems.get(root) || null };
  }
  /** Opretter projektets app hos komplai efter brugerens valg. Appen er kun for organisationen. */
  async create(root) {
    const state = await this.state(root);
    if (!state.active) throw Error('komplai Run er slået fra under Indstillinger › Funktioner.');
    if (!state.connected) throw Error('Log ind med komplai under Udgiv først.');
    if (state.link) return state;
    const app = await this.provider.createApp(state.name);
    await this.store.saveProject(root, { komplaiApp: { appId: app.id, name: app.name } });
    return this.state(root);
  }
  /** SDK-filen til forhåndsvisningen: broen og komplais officielle SDK. Uden integrationen findes den ikke. */
  async script(root, route) {
    if (route === '/_komplai/run/v1.mjs') return await this.enabled(root) ? MODULE : null;
    if (route !== '/_komplai/run/v1.js' || !await this.enabled(root)) return null;
    if (!this.sdk || this.now() - this.sdk.at > SDK_LIFETIME) this.sdk = { text: await this.provider.sdkScript(), at: this.now() };
    return BRIDGE + this.sdk.text;
  }
  async session(root, link, manifestRoot = root) {
    const manifest = await localManifest(manifestRoot), key = createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), cached = this.sessions.get(root);
    if (cached && cached.appId === link.appId && cached.manifest === key && Date.parse(cached.expiresAt) - this.now() > 60_000) return cached;
    if (manifest?.invalid) return { refusal: refuse('invalid_manifest', 400) };
    try {
      const d = await this.provider.preview(link.appId, manifest), s = { appId: link.appId, manifest: key, token: d.session, expiresAt: d.expiresAt, app: d.app };
      this.sessions.set(root, s); this.problems.delete(root); return s;
    } catch (error) {
      this.problems.set(root, error.message);
      return { refusal: refuse(typeof error.code === 'string' ? error.code : 'unavailable', Number.isInteger(error.status) ? error.status : 503) };
    }
  }
  /** Ét kald fra appens SDK. Svaret er det, Hub gav, eller en afvisning med SDK'ets fejlkoder.
   * Manifestet læses fra den viste arbejdsmappe, fx en samtales kopi. */
  async call(root, request, manifestRoot = root) {
    if (!await this.enabled(root)) return refuse('unavailable', 503);
    const method = String(request?.method || '').toUpperCase(), route = typeof request?.path === 'string' ? request.path : '';
    if (!METHODS.has(method)) return refuse('method_not_allowed', 405);
    const app = route === '/_komplai/api/v1/app', match = app ? null : route.match(ROUTE);
    if (!app && !match) return refuse('not_found', 404);
    const input = ['GET', 'DELETE'].includes(method) ? null : request.body ?? null;
    if (input !== null && Buffer.byteLength(JSON.stringify(input)) > BODY_BYTES) return refuse('invalid_input', 413);
    const link = await this.link(root), login = await publishingState(this.store, this.now());
    if (!link || !login.connected || login.expired) return refuse('unavailable', 503);
    let session = await this.session(root, link, manifestRoot);
    if (session.refusal) return session.refusal;
    if (app) return method === 'GET' ? { status: 200, body: session.app } : refuse('method_not_allowed', 405);
    const payload = { capability: match[1], operation: match[2] || '', method, query: match[3] || '', input };
    let answer = await this.provider.previewCall(link.appId, { ...payload, session: session.token });
    // En udløbet forhåndsvisning startes forfra én gang med det aktuelle manifest.
    if (answer.status === 401 && answer.body?.error === 'session_expired') {
      this.sessions.delete(root); session = await this.session(root, link, manifestRoot);
      if (session.refusal) return session.refusal;
      answer = await this.provider.previewCall(link.appId, { ...payload, session: session.token });
    }
    return answer;
  }
}
module.exports = { KomplaiPreview, localManifest, BRIDGE, ROUTE };
