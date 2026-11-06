const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { usesResponses, assertSupported } = require('./connections.cjs');
const network = require('./network-journal.cjs');
const { StreamProgress } = require('./stream-progress.cjs');
const { redact } = require('./secrets.cjs');

const IDLE_LIMIT = 120_000, TOTAL_LIMIT = 20 * 60_000;
// En lokal model (Ollama, OpenAI-kompatibel server) kan bruge flere minutter på at indlæse modellen og læse prompten, før første byte kommer.
// Skyudbydere beholder de 120 sekunder. Grænsen ligger under det samlede loft.
const LOCAL_IDLE_LIMIT = 10 * 60_000;
const idleLimitFor = connection => ['ollama', 'compatible'].includes(connection?.kind) ? LOCAL_IDLE_LIMIT : IDLE_LIMIT;
// Udbyderens egen fejltekst vises kun bag Se detaljer. Den læses begrænset, renses for nøgler og afkortes, og den styrer aldrig fejltypen.
const DETAIL_LIMIT = 500, DETAIL_READ_BYTES = 8000;
async function upstreamDetail(response, key) {
  let text = '';
  try {
    const reader = response.body?.getReader(); if (!reader) return '';
    const decoder = new TextDecoder(); let bytes = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; text += decoder.decode(value, { stream: true }); if (bytes >= DETAIL_READ_BYTES) { await reader.cancel().catch(() => {}); break; } }
  } catch { /* Teksten er kun en hjælp; fejlen håndteres uden den. */ }
  try { const parsed = JSON.parse(text); const found = parsed?.error?.message ?? parsed?.message ?? parsed?.error ?? parsed?.detail; if (typeof found === 'string' && found.trim()) text = found; } catch { /* Ikke JSON: råteksten bruges. */ }
  if (key && key.length >= 6) text = text.split(key).join('[skjult]');
  return redact(text.replace(/\s+/g, ' ').trim()).slice(0, DETAIL_LIMIT);
}
// Fejl, der opstår her, før kaldet når udbyderen. De er ikke netfejl og låser ikke forbindelsen.
class LocalError extends Error {}
// Kun agentmotoren får en midlertidig adgangskode. Den rigtige modelnøgle bliver i hovedprocessen.
async function startGateway(connection, model, key, route, onFailure = () => {}, { idleLimit = idleLimitFor(connection), totalLimit = TOTAL_LIMIT, onProgress = () => {}, root = '', effort: initialEffort = null } = {}) {
  // Brugerens valgte indsats kan skifte mellem beskeder uden at starte en ny modelsession.
  let effort = initialEffort, images = [];
  assertSupported(connection);
  const token = randomBytes(32).toString('hex');
  const active = new Set();
  let failed = false, stopped = false;
  // Fejlen får en type, så appen kan vise den rigtige vej videre, fx nøgle, kvote eller forbindelse.
  function fail(message, kind, status, detail) { if (!failed && !stopped) { failed = true; onFailure(message, { kind, status: status || null, ...(detail ? { detail } : {}) }); } }
  let origin;
  const server = http.createServer(async (req, res) => {
    if (req.headers.host !== new URL(origin).host || (req.headers.authorization !== `Bearer ${token}` && req.headers['x-api-key'] !== token)) { res.writeHead(401); return res.end(); }
    if (failed || stopped) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Forbindelsen er stoppet. Start selv en ny opgave i appen.', type: 'api_error' } })); }
    const controller = new AbortController(); active.add(controller);
    res.on('close', () => { controller.abort(); active.delete(controller); });
    // Et langt svar må gerne tage tid, så længe der kommer data. Stilstand i to minutter afbryder kaldet.
    const idle = new AbortController(), total = AbortSignal.timeout(totalLimit); let idleTimer, reachedUpstream = false, observedResponse;
    const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => idle.abort(), idleLimit); };
    try {
      const responses = usesResponses(connection);
      const anthropic = connection.kind === 'anthropic' || connection.kind === 'zen' && /^claude-/.test(model.id);
      if (req.method !== 'POST' || req.url !== (responses ? '/v1/responses' : anthropic ? '/v1/messages' : '/v1/chat/completions')) throw new LocalError('Agentmotoren bad om en handling, som Aura ikke understøtter. Prøv igen, og start en ny opgave, hvis det gentager sig.');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4_000_000) throw new LocalError('Beskeden til modellen er for stor (over 4 MB). Fjern vedhæftede filer eller start en ny samtale.'); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new LocalError('Agentmotoren sendte en besked, som Aura ikke kunne læse. Prøv igen.'); }
      if (body.model !== model.id) throw new LocalError('Modelskift kræver et nyt valg i appen. Start en ny opgave med den ønskede model.');
      // Vedhæftede billeder lægges på brugerens egen besked i den form, udbyderen bruger.
      if (images.length) require('./chat-media.cjs').addImages(body, images, { responses, anthropic, mistral: connection.kind === 'mistral' });
      delete body.models; delete body.route; delete body.plugins;
      if (responses) {
        body.store = false;
        // Samtalen bor i Aura. Modellen får kun den historik, agenten faktisk sender i dette kald.
        delete body.previous_response_id; delete body.conversation; delete body.background;
      }
      if (connection.kind === 'openrouter') {
        if (!route?.id) throw new LocalError('Vælg en konkret OpenRouter-udbyder for modellen, før du sender en besked.');
        body.provider = { only: [route.id], allow_fallbacks: false };
        if (model.id.endsWith(':free')) body.provider.max_price = { prompt: 0, completion: 0, request: 0, image: 0 };
      }
      // Brugerens valgte indsats sættes, som udbyderen forventer. Uden et valg sendes udbyderens eget udgangspunkt uændret.
      if (effort) {
        if (anthropic) body.output_config = { ...(body.output_config || {}), effort };
        else if (responses || connection.kind === 'openrouter') body.reasoning = { ...(body.reasoning || {}), effort };
        else body.reasoning_effort = effort;
      }
      const base = connection.kind === 'ollama' ? `${connection.baseURL}/v1` : connection.baseURL;
      const headers = { 'content-type': 'application/json' };
      if (anthropic) { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key; }
      else if (key) { if (connection.kind === 'azure') headers['api-key'] = key; else headers.authorization = `Bearer ${key}`; }
      touch();
      const progress = new StreamProgress({ emit: onProgress, root });
      reachedUpstream = true;
      const response = observedResponse = await network.observedFetch(`${base}${responses ? '/responses' : anthropic ? '/messages' : '/chat/completions'}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, idle.signal, total]), redirect: 'error' }, { category: 'model', purpose: 'model-response', provider: connection.kind, timeoutSignal: idle.signal });
      if (!response.ok) {
        const detail = await upstreamDetail(response, key);
        network.finishResponse(response, { outcome: 'failed', error: { status: response.status } });
        // Forbigående fejl (408, 429 og 5xx) videresendes, så OpenCode genforsøger (docs/decisions.md). Aura låser
        // ikke forbindelsen og viser ingen fejl, så et nyt forsøg kan lykkes. Retry-After følger med.
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          // Et langt Retry-After ville holde opgaven i Arbejder i op til en time uden forklaring. Loft: 120 sekunder.
          const wait = Number(response.headers.get('retry-after'));
          res.writeHead(response.status, { 'content-type': 'application/json', ...(Number.isFinite(wait) && wait >= 0 && response.headers.get('retry-after') ? { 'retry-after': String(Math.min(Math.ceil(wait), 120)) } : {}) });
          return res.end(JSON.stringify({ error: { message: `Modelserveren svarede midlertidigt (HTTP ${response.status}).${detail ? ` Udbyderens svar: ${detail}` : ''}`, type: 'api_error' } }));
        }
        const advice = { 401: 'API-nøglen blev afvist. Kontrollér eller udskift den under AI-forbindelser.', 403: 'Din konto har ikke adgang til modellen. Kontrollér adgangen hos udbyderen.', 402: 'Udbyderen afviste kaldet på grund af saldo eller kvote. Kontrollér kontoen; appen vælger ikke en betalt erstatning.', 404: 'Modellen eller adressen blev ikke fundet. Hent modellisten igen, og kontrollér forbindelsen.', 429: 'Udbyderens forbrugsgrænse er nået. Prøv igen, når kvoten er tilgængelig.' }[response.status] || 'Kontrollér forbindelsen og modelvalget, og prøv igen.';
        const message = `Modelserveren afviste kaldet (HTTP ${response.status}). ${advice}`;
        const kind = { 401: 'key', 403: 'access', 402: 'quota', 404: 'notfound', 429: 'limit' }[response.status] || (response.status >= 500 ? 'server' : 'rejected');
        fail(message, kind, response.status, detail);
        res.writeHead(response.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message, type: 'api_error' } }));
      }
      res.writeHead(200, { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      const sse = (response.headers.get('content-type') || '').includes('text/event-stream');
      for await (const chunk of response.body) { network.observeResponseChunk(response, chunk); touch(); if (res.destroyed) break; res.write(chunk); try { progress.write(chunk, sse); } catch { /* Fremdrift må ikke afbryde svaret. */ } }
      try { progress.end(sse); } catch { /* Selve svaret er allerede sendt videre. */ }
      network.finishResponse(response, { outcome: controller.signal.aborted ? 'cancelled' : 'completed' });
      res.end();
    } catch (error) {
      if (error instanceof LocalError && !reachedUpstream && !res.headersSent) {
        // Lokal fejl før kaldet til udbyderen: egen tekst, ingen netfejl-vejledning, og forbindelsen forbliver åben.
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: error.message, type: 'invalid_request_error' } }));
      }
      network.finishResponse(observedResponse, { outcome: controller.signal.aborted ? 'cancelled' : 'failed', error: idle.signal.aborted ? { kind: 'idle' } : error });
      if (idle.signal.aborted) fail(`Modellen svarede ikke i ${idleLimit >= 60_000 ? `${Math.round(idleLimit / 60_000)} min` : `${Math.max(1, Math.round(idleLimit / 1000))} s`}, så forbindelsen blev afbrudt. Din besked er bevaret.`, 'idle');
      // En netfejl, før modellen har svaret (forbindelse nægtet, DNS, afbrudt), er forbigående: den sendes videre som 502, så OpenCode kan
      // prøve igen, og forbindelsen låses ikke. En strøm, der afbrydes midt i svaret, er stadig endelig, fordi svaret er ufuldstændigt.
      else if (reachedUpstream && !res.headersSent && !controller.signal.aborted) { /* videresendes som 502 nedenfor */ }
      else if (res.headersSent && total.aborted && !controller.signal.aborted) fail(`Svaret tog mere end ${Math.max(1, Math.round(totalLimit / 60_000))} min i alt, så Aura afbrød det. Din besked er bevaret. Prøv igen med en mindre opgave.`, 'total');
      else fail('Modelforbindelsen blev afbrudt. Din besked er bevaret. Kontrollér forbindelsen, og prøv igen.', 'network');
      // En afbrudt strøm må ikke ligne et færdigt modelsvar for agentmotoren.
      if (res.headersSent) { res.destroy(); return; }
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      if (!res.destroyed) res.end(JSON.stringify({ error: { message: 'Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.', type: 'api_error' } }));
    } finally { clearTimeout(idleTimer); active.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/v1`, token, setImages: value => { images = structuredClone(value || []); }, setEffort: value => { effort = value || null; }, abort: () => { stopped = true; for (const controller of active) controller.abort(); }, close: () => new Promise(resolve => { stopped = true; for (const controller of active) controller.abort(); server.close(resolve); server.closeAllConnections(); }) };
}
module.exports = { startGateway, idleLimitFor };
