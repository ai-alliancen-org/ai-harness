// AI'en starter forhåndsvisningen gennem værktøjet aura_preview (beslutning for beta 2). Værktøjet kører som plugin i
// agentmotoren og taler med hovedprocessen gennem en lokal bro på 127.0.0.1 med en hemmelig nøgle. Broen kan kun starte
// forhåndsvisningen og spørge til status, og kun for det projekt, pluginet blev skrevet til. Samtykket gives af brugeren
// i forhåndsvisningens dialog og huskes, til projektets pakkefiler ændres.
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

let active = null;

async function listen(handlers) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const given = Buffer.from(String(req.headers.authorization || '')), wanted = Buffer.from(`Bearer ${token}`);
      if (req.method !== 'POST' || given.length !== wanted.length || !timingSafeEqual(given, wanted)) { req.resume(); return reply(401, { error: 'Ikke tilladt.' }); }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return reply(413, { error: 'For stor forespørgsel.' }); }
      const input = JSON.parse(raw || '{}');
      if (!['start', 'status'].includes(input.action) || typeof input.root !== 'string' || !input.root) return reply(400, { error: 'Ukendt handling eller projekt.' });
      try { return reply(200, await handlers[input.action]({ root: input.root })); }
      catch (error) { return reply(200, { state: 'error', message: String(error?.message || 'Forhåndsvisningen kunne ikke startes.').slice(0, 500) }); }
    } catch { return reply(400, { error: 'Ugyldig forespørgsel.' }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const bridge = { url: `http://127.0.0.1:${server.address().port}/`, token, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
  return bridge;
}

// Hovedprocessen installerer broen ved opstart; headless brug (CLI) har ingen bro og dermed intet værktøj.
function install(bridge) { active = bridge; }
function info(root) { return active ? { url: active.url, token: active.token, root } : null; }

// Samtykket er givet til netop dette fingeraftryk (package.json, lockfiler og opstartsfiler). Ændres de, spørges brugeren igen.
function consentValid(consent, fingerprint) { return Boolean(consent && typeof consent.fingerprint === 'string' && consent.fingerprint === fingerprint); }

// Så længe venter Aura højst, når AI'en starter forhåndsvisningen: på en handling, der allerede er i gang, på installationen
// og på starten. Pluginet venter længere end installation og start tilsammen, så AI'en får Auras eget svar og ikke en
// besked om, at Aura ikke svarede, mens Aura stadig installerer (fund 25, beta 3). Stop afbryder ventetiden med det samme.
// Motoren kører pluginet i Bun, hvor fetch selv giver op efter cirka 360 sekunder (målt i Bun 1.4.4 med OpenCode 1.19.5),
// også med et længere signal. Derfor slår pluginet Buns egen grænse fra med timeout: false; signalet er den eneste grænse.
const WAITS = Object.freeze({ busy: 90_000, install: 300_000, start: 90_000 });
const PLUGIN_TIMEOUT = WAITS.install + WAITS.start + 60_000;

// Pluginet er selvstændigt: det kender kun broens adresse, nøglen og projektets rod.
function pluginSource({ url, token, root }) {
  return `import { tool } from '@opencode-ai/plugin';
const bridge = ${JSON.stringify(url)}, token = ${JSON.stringify(token)}, root = ${JSON.stringify(root)};
const call = async (action, stop) => {
  const timeout = AbortSignal.timeout(${PLUGIN_TIMEOUT}), signal = stop && AbortSignal.any ? AbortSignal.any([timeout, stop]) : timeout;
  const response = await fetch(bridge, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ action, root }), signal, timeout: false });
  return JSON.stringify(await response.json());
};
const failed = (error, stop) => stop?.aborted ? 'Opgaven blev stoppet, før Aura svarede.' : error?.name === 'TimeoutError' ? 'Aura svarede ikke i tide. Spørg til status med action status, og start ikke selv en server.' : 'Aura svarede ikke. Bed brugeren starte forhåndsvisningen i appen.';
export const AuraPreview = async () => ({
  tool: {
    aura_preview: tool({
      description: 'Starter appens forhåndsvisning gennem Aura, eller viser dens status. Brug dette værktøj i stedet for at køre npm run dev, vite eller en anden server med kommandoer: serveren bliver ellers aldrig koblet til forhåndsvisningen. Svaret er JSON med state (running, error, needs_consent, idle), url og en kort besked. Hvis state er needs_consent, skal brugeren selv godkende start i forhåndsvisningen; spørg brugeren, og gæt ikke. Indeholder svaret blocked, henter siden fra en adresse uden for projektets netliste, og den bliver blokeret: ret siden til at bruge lokale filer eller projektets egne pakker i stedet, bed ikke om netadgang, og skjul ikke fejlen eller brug opdigtede eksempeldata i stedet for rigtige data.',
      args: { action: tool.schema.enum(['start', 'status']).describe('start for at starte forhåndsvisningen, status for at se, om den kører') },
      async execute(args, context) { try { return await call(args.action, context?.abort); } catch (error) { return JSON.stringify({ state: 'error', message: failed(error, context?.abort) }); } }
    })
  }
});
`;
}

module.exports = { listen, install, info, consentValid, pluginSource, WAITS, PLUGIN_TIMEOUT };
