const { readPreviewAsset } = require('./preview.cjs');
const { originOf, policyFor, allowedRequest, contentSecurityPolicy, blockedRequest, blockedNavigation } = require('./preview-policy.cjs');

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
// Arbejdsområdets egen adresse. Den mangler, mens projektets server er stoppet, er ved at starte eller har fejlet.
const ownAddress = ctx => originOf(ctx?.preview?.url || ctx?.externalPreview);
// Et arbejdsområde uden egen adresse har intet at vise, så intet er tilladt. Det sker for en bundet ramme, fx ved ↻ efter Stop (K3).
function allowedForContext(ctx, details) { return Boolean(ctx && ownAddress(ctx) && allowedRequest(details, contextPolicy(ctx))); }

// Forhåndsvisningen viser ikke sidens egne dialogbokse: rammen har ingen allow-modals, for en side kunne ellers fryse hele Aura.
// Chromium skriver det kun i konsollen, og confirm() svarer da altid nej. Aura siger det derfor selv i almindeligt dansk.
const DIALOG_TEXT = {
  alert: 'Siden prøvede at vise en besked med alert(). Forhåndsvisningen i Aura viser ikke sidens egne dialogbokse, så beskeden blev ikke vist. I en almindelig browser vises den.',
  confirm: 'Siden prøvede at stille et ja/nej-spørgsmål med confirm(). Forhåndsvisningen i Aura viser ikke sidens egne dialogbokse, så svaret blev automatisk nej, og handlingen blev ikke udført. I en almindelig browser vises spørgsmålet.',
  prompt: 'Siden prøvede at bede om et svar med prompt(). Forhåndsvisningen i Aura viser ikke sidens egne dialogbokse, så der kom intet svar. I en almindelig browser vises feltet.',
  print: 'Siden prøvede at åbne udskrivning med print(). Forhåndsvisningen i Aura åbner ikke udskrivning. I en almindelig browser virker det.'
};
const DIALOG_REPAIR = 'Siden bruger browserens dialogbokse (alert, confirm eller prompt), som forhåndsvisningen i Aura ikke viser. Brug i stedet en dialog i selve siden, fx et <dialog>-element med tydelige knapper, så funktionen også kan afprøves i forhåndsvisningen.';
function dialogDiagnostic(message) {
  const call = message.match(/Ignored call to '(alert|confirm|prompt|print)\(\)'\. The document is sandboxed/)?.[1];
  return call ? { kind: 'dialog', origin: null, resourceType: 'dialog', reason: 'sandboxed-dialog', call, message: DIALOG_TEXT[call], repair: call === 'print' ? '' : DIALOG_REPAIR } : null;
}

// Browserens CSP kan stoppe kald, inden webRequest ser dem. Kun den konkrete,
// blokerede origin beholdes; stier, forespørgsler og konsollens øvrige data gemmes ikke.
function diagnosticForConsole(event) {
  const message = String(event.message || '');
  const dialog = dialogDiagnostic(message);
  if (dialog) return dialog;
  if (!/Content Security Policy|violates the following.*directive|Refused to (?:load|connect)/i.test(message)) return null;
  const address = message.match(/(?:https?|wss?):\/\/[^\s"'<>]+/)?.[0];
  if (!address) return null;
  const directive = message.match(/\b(script-src|style-src|font-src|img-src|media-src|connect-src)\b/)?.[1];
  const resourceType = ({ 'script-src': 'script', 'style-src': 'stylesheet', 'font-src': 'font', 'img-src': 'image', 'media-src': 'media', 'connect-src': 'xhr' })[directive];
  return blockedRequest({ url: address, resourceType });
}
// Appens egen indholdspolitik (frame-src i ui/index.html) stopper, at forhåndsvisningens ramme åbner et andet websted, fx et link
// til borger.dk. Chromium stopper det, før nogen anmodning sendes, og skriver det kun i appens egen konsol. Rammen står ellers tom
// uden forklaring. Chromium 152 skriver "Framing '…' violates …", ældre versioner "Refused to frame '…' because it violates …".
function diagnosticForFrameBlock(event) {
  const message = String(event?.message || '');
  const address = message.match(/^(?:Framing|Refused to frame) '([^']+)'/)?.[1];
  if (!address || / as a fenced frame/.test(message) || !/\bframe-src\b/.test(message)) return null;
  return blockedNavigation(address);
}

function installSession(ses, { contexts, resolveFrame = () => null, sdk, onDiagnostic = () => {}, appOrigin = 'harness://app' } = {}) {
  if (typeof contexts !== 'function') throw Error('Forhåndsvisningen mangler arbejdsområderne.');
  const all = () => [...contexts()];
  const find = value => contextForURL(all(), value);
  // Hver ramme bindes til sit arbejdsområde, første gang appen navigerer den (og hvert billedvindue ved sin første side). Nøglen er
  // rammens frameTreeNodeId, som browseren tildeler, og som siden ikke kan ændre (modsat window.name). En omdirigering eller en senere
  // navigation i rammen afgøres derfor af rammens eget arbejdsområde, ikke af måladressen: den kan ikke lande på et andet arbejdsområdes
  // server, og en blokering kan forklares i stedet for at være tavs.
  const frames = new Map();
  const navigation = details => details.resourceType === 'subFrame' || details.resourceType === 'mainFrame';
  const frameKey = details => { try { const id = details.frame?.frameTreeNodeId; return Number.isSafeInteger(id) ? id : null; } catch { return null; } };
  // undefined: rammen er ikke bundet. null: rammens arbejdsområde findes ikke længere, og anmodningen afvises.
  const boundContext = details => {
    const key = navigation(details) ? frameKey(details) : null;
    if (key === null || !frames.has(key)) return undefined;
    return all().find(ctx => ctx.root === frames.get(key)) || null;
  };
  const bind = (details, ctx) => {
    const key = frameKey(details);
    if (key === null || !ctx?.root || frames.has(key)) return ctx;
    frames.set(key, ctx.root);
    while (frames.size > 500) frames.delete(frames.keys().next().value);
    return ctx;
  };
  const context = details => {
    const explicit = resolveFrame(details);
    if (explicit) return explicit;
    const bound = boundContext(details);
    if (bound !== undefined) return bound;
    if (details.initiatorOrigin && details.initiatorOrigin !== 'null' && originOf(details.initiatorOrigin) !== appOrigin) return find(details.initiatorOrigin);
    // Frame-URL er autoritativ for underressourcer. En referrer kan udelades eller
    // ændres af siden og må aldrig åbne en anden samtales lokale tjeneste. Er rammens origin kendt, vinder den:
    // en omdirigering fra ét arbejdsområdes server til et andets må ikke kunne afgøres af måladressen.
    if (originOf(details.frame?.url) && originOf(details.frame.url) !== appOrigin) { const byFrame = find(details.frame.url); if (byFrame) return byFrame; }
    // Appens egen navigation af forhåndsvisningens ramme: rammens URL er endnu det forrige dokument, fx den
    // statiske aura-preview-side, så kun målet kan afgøre konteksten. Kun forælderens URL må bestemme det;
    // en referrer kan siden udelade eller ændre og må aldrig pege på appen.
    // Her bindes rammen: det er appens første navigation af den, før siden har kørt noget i den.
    if (details.resourceType === 'subFrame' && originOf(details.frame?.parent?.url) === appOrigin) return bind(details, find(details.url));
    if (details.resourceType === 'mainFrame') return bind(details, find(details.url));
    return null;
  };
  const diagnose = (ctx, details) => { try { onDiagnostic(ctx, { at: Date.now(), ...blockedRequest(details) }); } catch {} };
  ses.protocol.handle('aura-preview', async request => {
    let ctx;
    try {
      const url = new URL(request.url); ctx = find(url.href);
      if (!ctx || !ctx.preview || originOf(ctx.preview.url) !== originOf(url.href) || !['GET', 'HEAD'].includes(request.method)) return new Response('Ikke fundet', { status: 404 });
      const asset = await readPreviewAsset(ctx.root, decodeURIComponent(url.pathname), { sdk: sdk ? route => sdk(ctx, route) : undefined, redirects: true });
      // En mappe uden / til sidst sendes videre til samme adresse med /, så sidens relative links peger ind i mappen (fund 22, beta 3).
      if (asset.redirect) return new Response(null, { status: 302, headers: { Location: new URL(`${url.pathname}/${url.search}`, url).href, 'Cache-Control': 'no-store' } });
      return new Response(request.method === 'HEAD' ? null : asset.data, { headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': contentSecurityPolicy(contextPolicy(ctx)) } });
    } catch { return new Response('Filen findes ikke i projektets offentlige mappe.', { status: 404 }); }
  });
  // Electron skal altid have sit svar. En fejl i lytterne må aldrig kaste ud af webRequest, for så hænger navigationen, og
  // hovedprocessen får en ufanget fejl. Anmodningen afvises i stedet (fail-closed).
  ses.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const source = originOf(details.initiatorOrigin || details.frame?.url || details.referrer);
      // En navigation i en forhåndsvisningsramme er aldrig appens egen ressource, heller ikke når appen startede den.
      const appResource = originOf(details.url) === appOrigin && (!source || source === appOrigin) && !resolveFrame(details) && boundContext(details) === undefined;
      const ctx = context(details);
      allowed = appResource || allowedForContext(ctx, details);
      // Har rammens arbejdsområde ingen adresse, fordi serveren er stoppet, starter eller har fejlet, er det ikke et andet websted,
      // der blev stoppet, og ↻ ville give samme blokering. Brugerfladen viser serverens tilstand i stedet for en forklaring her.
      if (!allowed && ownAddress(ctx)) diagnose(ctx, details);
    } catch { allowed = false; }
    callback({ cancel: !allowed });
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    let answer;
    try {
      const ctx = context(details), headers = { ...details.responseHeaders };
      // Et svar til et arbejdsområde, der ikke længere har en adresse (serveren er stoppet undervejs), vises ikke uden Auras indholdspolitik.
      if (ctx && !ownAddress(ctx)) answer = { cancel: true };
      else {
        const policy = ctx ? contextPolicy(ctx) : null;
        if (policy && originOf(details.url) === policy.origin) {
          const existing = Object.keys(headers).find(key => key.toLowerCase() === 'content-security-policy');
          const previous = existing ? headers[existing] : [];
          if (existing) delete headers[existing];
          headers['Content-Security-Policy'] = [...new Set([...(Array.isArray(previous) ? previous : [previous]), contentSecurityPolicy(policy)])];
        }
        answer = { responseHeaders: headers };
      }
    } catch { answer = { cancel: true }; }
    callback(answer);
  });
  // Arbejdsområdet for en bundet ramme ud fra rammen selv, fx når Electron melder, at rammen ikke kunne indlæse en side.
  // undefined: rammen er ikke bundet. null: rammens arbejdsområde findes ikke længere.
  const contextForFrame = frame => boundContext({ resourceType: 'subFrame', frame });
  return { contextForRequest: context, allowed: details => allowedForContext(context(details), details), contextForFrame };
}

module.exports = { installSession, staticPreview, contextForURL, contextPolicy, allowedForContext, diagnosticForConsole, diagnosticForFrameBlock };
