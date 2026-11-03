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

// Pluginet er selvstændigt: det kender kun broens adresse, nøglen og projektets rod.
function pluginSource({ url, token, root }) {
  return `import { tool } from '@opencode-ai/plugin';
const bridge = ${JSON.stringify(url)}, token = ${JSON.stringify(token)}, root = ${JSON.stringify(root)};
const call = async action => {
  const response = await fetch(bridge, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ action, root }), signal: AbortSignal.timeout(120000) });
  return JSON.stringify(await response.json());
};
export const AuraPreview = async () => ({
  tool: {
    aura_preview: tool({
      description: 'Starter appens forhåndsvisning gennem Aura, eller viser dens status. Brug dette værktøj i stedet for at køre npm run dev, vite eller en anden server med kommandoer: serveren bliver ellers aldrig koblet til forhåndsvisningen. Svaret er JSON med state (running, error, needs_consent, idle), url og en kort besked. Hvis state er needs_consent, skal brugeren selv godkende start i forhåndsvisningen; spørg brugeren, og gæt ikke.',
      args: { action: tool.schema.enum(['start', 'status']).describe('start for at starte forhåndsvisningen, status for at se, om den kører') },
      async execute(args) { try { return await call(args.action); } catch { return JSON.stringify({ state: 'error', message: 'Aura svarede ikke. Bed brugeren starte forhåndsvisningen i appen.' }); } }
    })
  }
});
`;
}

module.exports = { listen, install, info, consentValid, pluginSource };
