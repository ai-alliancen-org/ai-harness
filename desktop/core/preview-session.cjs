const { readPreviewAsset } = require('./preview.cjs');
const { originOf, policyFor, allowedRequest, contentSecurityPolicy, blockedRequest } = require('./preview-policy.cjs');

function staticPreview(ctx) {
  const key = ctx.key || ctx.workspaceKey;
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(key)) throw Error('Arbejdsområdet mangler sin faste adresse.');
  return { url: `aura-preview://${key}/`, close: async () => {} };
}
function contextForURL(contexts, value) {
  const origin = originOf(value);
  if (!origin) return null;
  return [...contexts].find(ctx => [ctx.preview?.url, ctx.externalPreview].some(url => url && originOf(url) === origin)) || null;
}
function contextPolicy(ctx) {
  const origin = ctx.preview?.url || ctx.externalPreview;
  const snapshot = ctx.devServer?.snapshot?.() || {};
  return policyFor({ origin, services: snapshot.services || [], network: (snapshot.runtimeConfig || ctx.runtimeConfig)?.network || {}, static: Boolean(ctx.preview && originOf(ctx.preview.url)?.startsWith('aura-preview:')) });
}
function allowedForContext(ctx, details) { return Boolean(ctx && allowedRequest(details, contextPolicy(ctx))); }

// Browserens CSP kan stoppe kald, inden webRequest ser dem. Kun den konkrete,
// blokerede origin beholdes; stier, forespørgsler og konsollens øvrige data gemmes ikke.
function diagnosticForConsole(event) {
  const message = String(event.message || '');
  if (!/Content Security Policy|violates the following.*directive|Refused to (?:load|connect)/i.test(message)) return null;
  const address = message.match(/(?:https?|wss?):\/\/[^\s"'<>]+/)?.[0];
  if (!address) return null;
  const directive = message.match(/\b(script-src|style-src|font-src|img-src|media-src|connect-src)\b/)?.[1];
  const resourceType = ({ 'script-src': 'script', 'style-src': 'stylesheet', 'font-src': 'font', 'img-src': 'image', 'media-src': 'media', 'connect-src': 'xhr' })[directive];
  return blockedRequest({ url: address, resourceType });
}

function installSession(ses, { contexts, resolveFrame = () => null, sdk, onDiagnostic = () => {}, appOrigin = 'harness://app' } = {}) {
  if (typeof contexts !== 'function') throw Error('Forhåndsvisningen mangler arbejdsområderne.');
  const all = () => [...contexts()];
  const find = value => contextForURL(all(), value);
  const context = details => {
    const explicit = resolveFrame(details);
    if (explicit) return explicit;
    if (details.initiatorOrigin && details.initiatorOrigin !== 'null' && originOf(details.initiatorOrigin) !== appOrigin) return find(details.initiatorOrigin);
    // Frame-URL er autoritativ for underressourcer. En referrer kan udelades eller
    // ændres af siden og må aldrig åbne en anden samtales lokale tjeneste. Er rammens origin kendt, vinder den:
    // en omdirigering fra ét arbejdsområdes server til et andets må ikke kunne afgøres af måladressen.
    if (originOf(details.frame?.url) && originOf(details.frame.url) !== appOrigin) { const byFrame = find(details.frame.url); if (byFrame) return byFrame; }
    // Appens egen navigation af forhåndsvisningens ramme: rammens URL er endnu det forrige dokument, fx den
    // statiske aura-preview-side, så kun målet kan afgøre konteksten. Kun forælderens URL må bestemme det;
    // en referrer kan siden udelade eller ændre og må aldrig pege på appen.
    if (details.resourceType === 'subFrame' && originOf(details.frame?.parent?.url) === appOrigin) return find(details.url);
    if (details.resourceType === 'mainFrame') return find(details.url);
    return null;
  };
  const diagnose = (ctx, details) => { try { onDiagnostic(ctx, { at: Date.now(), ...blockedRequest(details) }); } catch {} };
  ses.protocol.handle('aura-preview', async request => {
    let ctx;
    try {
      const url = new URL(request.url); ctx = find(url.href);
      if (!ctx || !ctx.preview || originOf(ctx.preview.url) !== originOf(url.href) || !['GET', 'HEAD'].includes(request.method)) return new Response('Ikke fundet', { status: 404 });
      const asset = await readPreviewAsset(ctx.root, decodeURIComponent(url.pathname), { sdk: sdk ? route => sdk(ctx, route) : undefined });
      return new Response(request.method === 'HEAD' ? null : asset.data, { headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': contentSecurityPolicy(contextPolicy(ctx)) } });
    } catch { return new Response('Filen findes ikke i projektets offentlige mappe.', { status: 404 }); }
  });
  ses.webRequest.onBeforeRequest((details, callback) => {
    const source = originOf(details.initiatorOrigin || details.frame?.url || details.referrer);
    const appResource = originOf(details.url) === appOrigin && (!source || source === appOrigin) && !resolveFrame(details);
    const ctx = context(details), allowed = appResource || allowedForContext(ctx, details);
    if (!allowed && ctx) diagnose(ctx, details);
    callback({ cancel: !allowed });
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    const ctx = context(details), headers = { ...details.responseHeaders };
    if (ctx && originOf(details.url) === contextPolicy(ctx).origin) {
      const existing = Object.keys(headers).find(key => key.toLowerCase() === 'content-security-policy');
      const previous = existing ? headers[existing] : [];
      if (existing) delete headers[existing];
      headers['Content-Security-Policy'] = [...new Set([...(Array.isArray(previous) ? previous : [previous]), contentSecurityPolicy(contextPolicy(ctx))])];
    }
    callback({ responseHeaders: headers });
  });
  return { contextForRequest: context, allowed: details => allowedForContext(context(details), details) };
}

module.exports = { installSession, staticPreview, contextForURL, contextPolicy, allowedForContext, diagnosticForConsole };
