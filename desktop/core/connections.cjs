const network = require('./network-journal.cjs');
const { randomUUID, createHash } = require('node:crypto');
const definitions = {
  openai: { name: 'OpenAI API', provider: 'OpenAI', baseURL: 'https://api.openai.com/v1', protocol: 'responses', keyRequired: true, source: 'https://developers.openai.com/api/docs/guides/your-data', checkedAt: '2026-10-15',
    training: 'API-data bruges ikke til træning som standard. Et aktivt tilvalg hos OpenAI kan ændre dette.', trainingShort: 'Bruges ikke til træning som standard',
    region: 'Ikke fastlagt. Aura bruger OpenAIs globale API-adresse; den dokumenterer ikke behandling i EU.', regionShort: 'Global API-adresse, region ikke fastlagt',
    retention: 'Aura slår lagring af Responses-svar fra. OpenAI kan som standard gemme indhold i misbrugslogs i op til 30 dage. Særlige aftaler kan ændre dette.', retentionShort: 'Misbrugslogs i op til 30 dage som standard' },
  azure: { name: 'Azure OpenAI / Microsoft Foundry', provider: 'Microsoft Azure', baseURL: '', protocol: 'responses', keyRequired: true, source: 'https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy', checkedAt: '2026-10-15',
    training: 'Microsoft oplyser, at prompts og svar ikke bruges til at træne grundmodeller uden tilladelse eller instruktion.', trainingShort: 'Grundmodeller trænes ikke uden tilladelse',
    region: 'Afhænger af jeres deployment. Global kan behandle data på tværs af geografier, DataZone inden for sin zone. Serveradressen alene dokumenterer ikke regionen.', regionShort: 'Afhænger af jeres Azure-deployment',
    retention: 'Afhænger af jeres aftale og misbrugsovervågning. Aura slår lagring af Responses-svar fra; det slår ikke Microsofts misbrugsovervågning fra.', retentionShort: 'Afhænger af aftale og misbrugsovervågning' },
  // Vilkår for de tre udbydere i opsætningen er kontrolleret hos udbyderne 29. september 2026. De korte tekster vises i resuméet før afsendelse.
  corti: { name: 'Corti S1 · EU', provider: 'Corti', baseURL: 'https://ai.eu.corti.app/v1', protocol: 'openai', keyRequired: true, source: 'https://docs.corti.ai/models/regions', checkedAt: '2026-09-29',
    training: 'Corti oplyser, at data i EU-projekter aldrig bruges til træning. Kontrollér aftalen for jeres projekt.', trainingShort: 'Bruges ikke til træning, ifølge Corti',
    region: 'EU ifølge Cortis dokumentation: EU-projekter kører på Cortis egen klynge i EU. Appen bruger adressen fra nøglens miljø, EU, EU-S eller Frankrig; den konkrete installation er ikke uafhængigt verificeret.', regionShort: 'EU, på Cortis egne servere',
    retention: 'Corti oplyser, at prompts og svar i EU-projekter aldrig gemmes eller logges.', retentionShort: 'Gemmes ikke, ifølge Corti' },
  // Vilkårene for Alexandra er kontrolleret på platformens egen dokumentation 21. oktober 2026.
  alexandra: { name: 'Alexandra AI Platform', provider: 'Alexandra Instituttet', baseURL: 'https://inference.alexandra.dk/v1', protocol: 'openai', keyRequired: true, source: 'https://platform.alexandra.dk/privacy/', checkedAt: '2026-10-21',
    training: 'Alexandra oplyser, at indhold fra API-kald ikke bruges til træning. Data behandles kun for at producere svaret. Kontrollér databehandleraftalen for jeres organisation.', trainingShort: 'Bruges ikke til træning, ifølge Alexandra',
    region: 'Danmark ifølge Alexandras dokumentation: hele behandlingen foregår på danske lokationer, og hardware lejes hos ScanNet (team.blue Denmark), der er ISO 27001-certificeret. Der sker ingen overførsel uden for EU/EØS. Denne adapter bruger kun platformens egen adresse; den konkrete installation er ikke uafhængigt verificeret.', regionShort: 'Danmark, hos Alexandra Instituttet',
    retention: 'Alexandra oplyser, at prompts og svar slettes, når modellen er færdig med at svare, og at indholdet ikke logges. Tekniske data kan midlertidigt ligge i hukommelsen, men gemmes ikke permanent.' },
  mistral: { name: 'Mistral API', provider: 'Mistral', baseURL: 'https://api.mistral.ai/v1', protocol: 'openai', keyRequired: true, source: 'https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models', checkedAt: '2026-09-29',
    training: 'På Mistrals gratis plan kan input og svar bruges til træning. Med betalt forbrug kan du fravælge det under Privacy i Mistral Admin. Appen kontrollerer ikke kontoens valg.', trainingShort: 'Kan bruges til træning på gratisplanen',
    region: 'Mistral hoster data i EU, men det globale endpoint api.mistral.ai lover ikke, hvor selve behandlingen sker. Garanteret EU-behandling kræver Mistrals EU-endpoint, som appen ikke bruger endnu.', regionShort: 'Hostes i EU, behandlingssted ikke garanteret',
    retention: 'Gemmes i 30 dage til misbrugskontrol. Nuldataopbevaring kan aftales ved betalt forbrug.', retentionShort: 'Gemmes i 30 dage' },
  anthropic: { name: 'Anthropic API', provider: 'Anthropic', baseURL: 'https://api.anthropic.com/v1', protocol: 'anthropic', keyRequired: true, source: 'https://platform.claude.com/docs/en/manage-claude/data-residency', checkedAt: '2026-09-29',
    training: 'Anthropic oplyser: API-data bruges ikke som standard til træning; aftaler og aktivt tilvalg kan ændre dette.', trainingShort: 'Bruges ikke til træning som standard',
    region: 'Globalt. Anthropic kan behandle data i flere lande, også uden for EU, og gemmer data i USA. Der findes ingen EU-mulighed.', regionShort: 'Globalt, også uden for EU',
    retention: 'Slettes inden for 30 dage. Indhold, der markeres for misbrug, kan gemmes i op til 2 år.', retentionShort: 'Slettes inden for 30 dage' },
  openrouter: { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', protocol: 'openai', keyRequired: true, source: 'https://openrouter.ai/docs/guides/privacy/provider-logging', training: 'Afhænger af den valgte modeludbyder og kontoens indstillinger.' },
  // Zen-vilkår kontrolleret på opencode.ai/docs/zen 29. september 2026. Træning afhænger af modellen; se zenTerms.
  zen: { name: 'OpenCode Zen', provider: 'OpenCode Zen', baseURL: 'https://opencode.ai/zen/v1', protocol: 'openai', keyRequired: false, source: 'https://opencode.ai/docs/zen/', checkedAt: '2026-09-29',
    training: 'Afhænger af modellen. Flere af Zens gratis modeller kan bruge dine data til at forbedre eller træne modeller.', region: 'USA. Zen oplyser, at alle modeller hostes i USA.', regionShort: 'USA',
    retention: 'Afhænger af modellen. Zen oplyser nul opbevaring for de fleste modeller og 30 dage for OpenAI og Anthropic.' },
  ollama: { name: 'Ollama', baseURL: 'http://127.0.0.1:11434', protocol: 'openai', keyRequired: false, source: 'https://docs.ollama.com/api/introduction', training: 'Afhænger af den valgte lokale modelserver og eventuel cloud-videresendelse.' },
  compatible: { name: 'Egen server', baseURL: '', protocol: 'openai', keyRequired: false, source: '', training: 'Ukendt. Kontroller serverens konfiguration og eventuel videresendelse.' }
};
// Zens gratis modeller har forskellige vilkår. Kontrolleret på opencode.ai/docs/zen 29. september 2026.
const zenTerms = [
  [/^(space-bunny|longcat)/, 'Gemmes ikke og bruges ikke til træning, ifølge Zen', 'Zen oplyser nul opbevaring, og at data ikke bruges.'],
  [/^muse-spark/, 'Bruges til at træne Metas modeller', 'Zen oplyser, at prompts og svar må bruges til at træne fremtidige Meta-modeller.'],
  [/^(big-pickle|mimo|ling|nemotron|jev|deepseek)/, 'Kan bruges til at forbedre modellen', 'Zen oplyser, at indsamlede data kan bruges til at forbedre modellen.']
];
// Oplyste API-priser i USD pr. million tokens. Kontrolleret 29. september 2026, med særskilte datoer ved nye opslag.
// Kataloget har forrang, når det selv oplyser en pris.
const knownPrices = [
  ['anthropic', /^claude-fable-5/, 10, 50], ['anthropic', /^claude-opus-5/, 4, 20], ['anthropic', /^claude-sonnet-5/, 2, 10], ['anthropic', /^claude-haiku-4-5/, 1, 5],
  ['mistral', /^mistral-large-4(?:-0)?$/, 1.36, 4.18, { cacheRead: 0.14, checkedAt: '2026-10-07', note: 'Overslaget bruger normal listepris. Mistrals midlertidige lanceringsrabat er ikke trukket fra.' }],
  // Et bevægeligt "latest"-alias må ikke få den gamle Large 3-pris uden dokumentation for, hvad det peger på.
  ['mistral', /^mistral-medium-(3-5|latest)/, 1.5, 7.5], ['mistral', /^mistral-large-2512$/, 0.5, 1.5], ['mistral', /^codestral-(2508|latest)/, 0.3, 0.9],
  ['corti', /^corti-s1-mini/, 1, 4], ['corti', /^corti-s1/, 2, 8],
  // Alexandras priser er i DKK pr. million tokens og er kontrolleret på platform.alexandra.dk/platform-ui/docs/models 21. oktober 2026.
  ['alexandra', /^glm-5\.3-flash$/, 6, 30, { currency: 'DKK', cacheRead: 3 }], ['alexandra', /^qwen3\.8-flash-next$/, 1, 5, { currency: 'DKK', cacheRead: 0.2 }]
];
const priceSources = { anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing', mistral: 'https://docs.mistral.ai/inference/pricing', corti: 'https://docs.corti.ai/models/models', alexandra: 'https://platform.alexandra.dk/platform-ui/docs/models' };
// Pris i USD pr. million tokens til et anslået forbrug. Cachelæsning og -skrivning følger udbydernes prislister;
// kendes cacheprisen ikke, regnes den som almindeligt input.
function priceFor(connection, model, route = null) {
  const catalog = route?.price || model.price;
  if (catalog && catalog.prompt != null && catalog.completion != null) {
    const per = value => Number(value) * 1e6, input = per(catalog.prompt);
    if (!Number.isFinite(input) || !Number.isFinite(per(catalog.completion))) return null;
    return { ...(catalog.currency === 'DKK' ? { currency: 'DKK' } : {}), input, output: per(catalog.completion), cacheRead: catalog.input_cache_read != null ? per(catalog.input_cache_read) : input, cacheWrite: catalog.input_cache_write != null ? per(catalog.input_cache_write) : input };
  }
  const known = knownPrice(connection.kind, model.id);
  if (!known) return null;
  const read = connection.kind === 'anthropic' ? (/^claude-fable-5/.test(model.id) ? 0.025 : /^claude-opus-5-5/.test(model.id) ? 0.05 : 0.1) : connection.kind === 'corti' ? 0.1 : 1;
  // Alexandras prisliste er i DKK; forbruget føres derfor i en særskilt post, så USD og DKK ikke blandes.
  return { ...(known.currency === 'DKK' ? { currency: 'DKK' } : {}), input: known.input, output: known.output, cacheRead: known.cacheRead ?? known.input * read, cacheWrite: connection.kind === 'anthropic' ? known.input * 1.25 : known.input };
}
function knownPrice(kind, id) { const found = knownPrices.find(([provider, pattern]) => provider === kind && pattern.test(id)); return found ? { input: found[2], output: found[3], source: priceSources[kind], checkedAt: definitions[kind].checkedAt, ...found[4] } : null; }
const usd = value => value.toLocaleString('da-DK', { maximumFractionDigits: 2 });
function endpoint(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Angiv en fuld serveradresse med http:// eller https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Serveradressen må ikke indeholde login, parametre eller fragmenter.');
  return url.href.replace(/\/$/, '');
}
// Cortis nøgler bærer deres miljø først, fx "fr:" eller "eu-s:" i base64, og virker kun i deres eget miljø. Appen vælger derfor
// adressen ud fra nøglen. Kun EU, EU-S og Frankrig bruges; appen skifter aldrig til USA.
const CORTI = { eu: 'https://ai.eu.corti.app/v1', 'eu-s': 'https://ai.eu-s.corti.app/v1', fr: 'https://ai.fr.corti.app/v1' };
const cortiFrance = {
  region: 'Frankrig ifølge Corti: miljøet fr kører hos Scaleway i Paris, og adgang kræver aftale med Corti. Appen bruger kun Cortis adresser i EU og Frankrig og skifter aldrig til USA.',
  regionShort: 'Frankrig, hos Scaleway i Paris ifølge Corti', source: 'https://docs.corti.ai/authentication/environments_tenants'
};
// EU-S står i Cortis konsol, ikke i dokumentationen. Adressen er slået op 22. oktober 2026: Scaleway i Frankrig ifølge IP-registeret.
const cortiSovereign = {
  region: 'EU-S (Sovereign) ifølge Cortis konsol. Adressen ai.eu-s.corti.app drives hos Scaleway i Frankrig ifølge IP-registeret. Appen bruger kun Cortis adresser i EU og skifter aldrig til USA.',
  regionShort: 'EU-S (Sovereign), hos Scaleway i Frankrig', source: 'https://console.corti.app/'
};
function cortiEndpoint(key) {
  const environment = /^([a-z]{2}(?:-[a-z]+)?):/.exec(Buffer.from(String(key), 'base64').toString('utf8'))?.[1];
  if (!environment) return CORTI.eu;
  if (CORTI[environment]) return CORTI[environment];
  throw new Error(environment === 'us' ? 'Nøglen hører til Cortis amerikanske miljø. Aura bruger kun Corti i EU og Frankrig.' : `Nøglen hører til Cortis miljø "${environment}", som Aura endnu ikke bruger. Brug en nøgle fra et projekt i EU, EU-S eller Frankrig.`);
}
// Navnet på en Corti-forbindelse følger nøglens miljø, så en EU-S-nøgle ikke står som EU.
function cortiName(baseURL) { return `Corti S1 · ${baseURL === CORTI.fr ? 'Frankrig' : baseURL === CORTI['eu-s'] ? 'EU-S' : 'EU'}`; }
function assertSupported(connection) {
  if (connection?.kind === 'komplai') throw new Error('komplai bruges nu kun til udgivelse via Udgiv. Vælg en anden AI-forbindelse.');
  if (!connection || !Object.hasOwn(definitions, connection.kind)) throw new Error('Vælg en understøttet forbindelsestype.');
}
// Indsatte nøgler har ofte mellemrum, usynlige tegn, anførselstegn eller et navn foran fra en .env-fil eller en
// Authorization-linje. Rensningen fjerner dem og siger, hvad der er rettet. Ingen fejlbesked gentager nøglen.
const INVISIBLE = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const QUOTED = /^(["'`“”„‘’«»‹›])([\s\S]+)(["'`“”„‘’«»‹›])$/;
const keyError = message => Object.assign(new Error(message), { reason: 'invalid' });
/**
 * Den fælles rensning til kontrol og lagring. strict bruges ved indtastning og afviser alt uden for synlig ASCII, som
 * rigtige nøgler består af. Uden strict afvises kun tegn, der ikke kan sendes i en HTTP-header.
 */
function cleanKey(raw, kind, { strict = false } = {}) {
  if (typeof raw !== 'string' || raw.length > 4096) throw keyError('Nøglen er ugyldig eller for lang.');
  const changes = new Set();
  let key = raw;
  const strip = (pattern, change) => { const next = key.replace(pattern, ''); if (next !== key) { changes.add(change); key = next; } };
  strip(INVISIBLE, 'usynlige tegn');
  // Flere lag på hinanden, fx export CORTI_API_KEY="…" eller Authorization: Bearer ….
  for (let round = 0; round < 3; round++) {
    strip(/^[\s ]+|[\s ]+$/g, 'mellemrum');
    strip(/^authorization\s*:\s*/i, 'Authorization foran');
    // Kun navne som i en .env-fil, fx CORTI_API_KEY=. En base64-nøgle med = til sidst rammes ikke.
    strip(/^(?:export\s+)?[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*=\s*/, 'navn foran');
    strip(/^bearer\s+/i, 'Bearer foran');
    const quoted = QUOTED.exec(key);
    if (quoted) { key = quoted[2]; changes.add('anførselstegn'); }
  }
  if (!key) throw keyError('Feltet er tomt. Sæt nøglen ind fra udbyderens side.');
  if (/\s/.test(key)) throw keyError('Nøglen har mellemrum inde i sig. Kopiér den igen med kopiér-knappen hos udbyderen.');
  if (strict ? /[^\x21-\x7e]/.test(key) : /[\x00-\x1f\x7f]|[^\x00-\xff]/.test(key)) throw keyError('Nøglen indeholder tegn, der ikke hører til en API-nøgle, fx typografiske tegn. Kopiér den igen med kopiér-knappen hos udbyderen.');
  // Cortis nøgler er base64. Mangler et = til sidst, tilføjes det; en nøgle, der ikke kan være base64, er afkortet.
  if (kind === 'corti' && /^[A-Za-z0-9+/]+=*$/.test(key)) {
    const body = key.replace(/=+$/, '');
    if (body.length % 4 === 1) throw keyError('Nøglen ser afkortet ud. Brug kopiér-knappen i Corti Console.');
    const padded = body + '='.repeat((4 - body.length % 4) % 4);
    if (padded !== key) { changes.add(padded.length > key.length ? 'manglende = til sidst' : 'for mange = til sidst'); key = padded; }
  }
  if (kind !== 'github' && /^(gh[pousr]_|github_pat_)/.test(key)) throw keyError('Det ligner en GitHub-nøgle. Brug en API-nøgle fra AI-udbyderen.');
  if (kind === 'github' && /^sk-/.test(key)) throw keyError('Det ligner en API-nøgle til en AI-udbyder. Brug en GitHub-nøgle, der begynder med github_pat_ eller ghp_.');
  if (strict && (kind === 'github' || definitions[kind]?.keyRequired) && key.length < 20) throw keyError('Nøglen ser afkortet ud. Brug kopiér-knappen hos udbyderen.');
  return { key, changes: [...changes] };
}
// Udbydernes egne sider til konto og nøgler. Nøglevinduet bruger dem til "Har du ikke en nøgle?".
const accountPages = {
  openai: { start: 'https://platform.openai.com/', keys: 'https://platform.openai.com/api-keys' },
  azure: { start: 'https://ai.azure.com/' },
  anthropic: { start: 'https://platform.claude.com/', billing: 'https://platform.claude.com/settings/billing', keys: 'https://platform.claude.com/settings/keys' },
  mistral: { start: 'https://console.mistral.ai/', billing: 'https://admin.mistral.ai/organization/billing', privacy: 'https://admin.mistral.ai/plateforme/privacy', keys: 'https://console.mistral.ai/api-keys' },
  corti: { start: 'https://console.corti.app/signup', console: 'https://console.corti.app/', keys: 'https://console.corti.app/corti-models' },
  alexandra: { start: 'https://platform.alexandra.dk/platform-ui/register', keys: 'https://platform.alexandra.dk/platform-ui/keys', billing: 'https://platform.alexandra.dk/platform-ui/billing', usage: 'https://platform.alexandra.dk/platform-ui/usage' },
  openrouter: { start: 'https://openrouter.ai/settings/keys' }, zen: { start: 'https://opencode.ai/auth' }
};
function normalize(input) {
  assertSupported(input);
  const def = definitions[input.kind];
  const key = input.apiKey ? cleanKey(input.apiKey, input.kind).key : '';
  const baseURL = input.kind === 'azure' ? azureEndpoint(input.baseURL) : endpoint(['compatible', 'ollama'].includes(input.kind) ? input.baseURL : input.kind === 'corti' && key ? cortiEndpoint(key) : def.baseURL);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('Angiv et forbindelsesnavn på højst 100 tegn.');
  const extra = {};
  if (input.kind === 'azure') {
    if (typeof input.deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.deployment.trim())) throw new Error('Angiv deployment-navnet fra Azure. Brug bogstaver, tal, punktum, bindestreg eller understregning.');
    if (input.protocol && !['responses', 'openai'].includes(input.protocol)) throw new Error('Vælg Responses eller Chat Completions.');
    extra.deployment = input.deployment.trim(); extra.protocol = input.protocol || 'responses';
  }
  return { id: input.id || randomUUID(), name: input.name.trim(), kind: input.kind, baseURL, ...extra };
}
function azureEndpoint(value) {
  const url = new URL(endpoint(value));
  if (url.protocol !== 'https:' || url.port || !/^[a-z0-9-]+\.(openai\.azure\.com|services\.ai\.azure\.com)$/.test(url.hostname) || !['/', '/openai/v1'].includes(url.pathname)) throw new Error('Brug ressourcens HTTPS-adresse fra Azure OpenAI eller Foundry, fx https://mit-projekt.openai.azure.com.');
  return `${url.origin}/openai/v1`;
}
// Udbyderne oplyser billedstøtte tre forskellige steder. Står den ingen af dem, er den ikke oplyst.
function visionFrom(model) {
  if (typeof model.capabilities?.vision === 'boolean') return { vision: model.capabilities.vision };
  if (typeof model.capabilities?.image_input?.supported === 'boolean') return { vision: model.capabilities.image_input.supported };
  if (Array.isArray(model.architecture?.input_modalities)) return { vision: model.architecture.input_modalities.includes('image') };
  return {};
}
function usesResponses(connection) { return (connection.protocol || definitions[connection.kind]?.protocol) === 'responses'; }
// Fjerner nøgler og nøglelignende tekst fra et svar, før det vises bag Se detaljer.
function redact(text, keys = []) {
  let out = String(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  for (const key of keys) if (typeof key === 'string' && key.length >= 6) out = out.split(key).join('••••');
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})/g, '••••').replace(/\b(bearer|api-key|x-api-key)(["']?\s*[:=]?\s*["']?)[^\s"',}]+/gi, '$1$2••••').replace(/[A-Za-z0-9+/_=-]{40,}/g, '••••');
  return out.length > 600 ? out.slice(0, 600) + ' …' : out;
}
// Kendte afvisninger fra udbydernes svar, oversat til dansk. Selve svaret står bag Se detaljer.
const providerReasons = [
  [/not valid base64|invalid base64/i, 'Udbyderen siger, at nøglen ikke er gyldig base64. Den er måske afkortet; brug kopiér-knappen hos udbyderen.'],
  [/invalid[ _-]?(api[ _-]?)?key|incorrect api key|invalid x-api-key|api key (is )?(invalid|not valid)|unauthorized/i, 'Udbyderen genkender ikke nøglen.'],
  [/insufficient[ _-]?quota|credit balance|billing|payment required/i, 'Kontoen har ikke kredit eller kvote tilbage hos udbyderen.'],
  [/rate[ _-]?limit|too many requests/i, 'Udbyderen får for mange forespørgsler lige nu. Vent lidt, og prøv igen.'],
  [/permission|forbidden|not allowed|access denied/i, 'Nøglen har ikke adgang til modellerne. Kontrollér nøglens tilladelser hos udbyderen.']
];
// En fejl har en grund: unreachable og timeout betyder, at serveren ikke kunne nås, rejected at den afviste nøglen.
const failure = (message, reason, details = '') => Object.assign(new Error(message), { reason, details });
function networkFailure(error) {
  const code = error?.cause?.code || error?.code || '', name = error?.name || '';
  if (name === 'TimeoutError' || name === 'AbortError' || /TIMEOUT/.test(code)) return failure('Serveren svarede ikke inden for 15 sekunder. Kontrollér adresse, netværk og eventuelt Tailscale.', 'timeout', code || name);
  if (/redirect/i.test(String(error?.cause?.message || error?.message))) return failure('Serveren sendte appen videre til en anden adresse. Aura følger ikke en omdirigering med en nøgle. Brug den adresse, udbyderen oplyser.', 'rejected', 'omdirigering');
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return failure('Serverens certifikat kunne ikke godkendes. Kontrollér adressen.', 'unreachable', code);
  // Undici skriver headerens værdi i sin fejltekst. Den tekst vises derfor aldrig.
  if (/INVALID_ARG/.test(code) || /header/i.test(`${error?.message} ${error?.cause?.message || ''}`)) return failure('Nøglen indeholder tegn, der ikke kan sendes. Kopiér den igen med kopiér-knappen hos udbyderen.', 'invalid');
  return failure('Serveren svarer ikke. Kontrollér adresse, port, netværk og eventuelt Tailscale.', 'unreachable', code);
}
async function readExcerpt(response) {
  try {
    const reader = response.body?.getReader(); if (!reader) return '';
    const chunks = []; let size = 0;
    while (size < 4096) { const { done, value } = await reader.read(); if (done) break; network.observeResponseChunk(response, value); chunks.push(value); size += value.length; }
    await reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString('utf8').slice(0, 4096);
  } catch { return ''; }
}
async function requestJSON(url, { key = '', kind, method = 'GET', body, signal, purpose = 'model-catalog' } = {}) {
  const headers = { accept: 'application/json' };
  if (key) Object.assign(headers, kind === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : kind === 'azure' ? { 'api-key': key } : { Authorization: `Bearer ${key}` });
  if (body) headers['content-type'] = 'application/json';
  let response;
  try { response = await network.observedFetch(url, { method, headers, body: body && JSON.stringify(body), signal: signal || AbortSignal.timeout(15000), redirect: 'error' }, { category: 'catalog', purpose, provider: kind }); }
  catch (error) { throw networkFailure(error); }
  try {
    if (!response.ok) {
      const excerpt = await readExcerpt(response);
      let said = excerpt; try { const data = JSON.parse(excerpt); said = data?.error?.message || data?.error || data?.message || data?.detail || excerpt; } catch { /* Svaret er ikke JSON. */ }
      if (typeof said !== 'string') said = JSON.stringify(said);
      const known = providerReasons.find(([pattern]) => pattern.test(said))?.[1];
      const details = redact(`HTTP ${response.status}${said ? ': ' + said : ''}`, [key]);
      // En Corti-nøgle virker kun i sit eget miljø. Beskeden siger, hvilken adresse appen prøvede, så testeren ved, hvad der skal tjekkes.
      if (kind === 'corti' && (response.status === 401 || response.status === 403)) throw failure(`Corti afviste nøglen på ${url.startsWith(CORTI.fr) ? 'adressen i Frankrig' : url.startsWith(CORTI['eu-s']) ? 'adressen i EU-S (Sovereign)' : 'adressen i EU'}. ${known ? known + ' ' : ''}Brug en nøgle fra Corti Models i et projekt i EU, EU-S eller Frankrig; en nøgle virker kun i sit eget miljø.`, 'rejected', details);
      if (response.status === 401 || response.status === 403) throw failure(`Serveren afviste adgangen. ${known || 'Kontrollér API-nøglen og tilladelserne.'}`, 'rejected', details);
      if (response.status === 429 || response.status === 402) throw failure(known || `Udbyderen svarede med HTTP ${response.status}. Prøv igen senere.`, 'rejected', details);
      throw failure(`Serveren svarede med HTTP ${response.status}. ${known ? known + ' ' : ''}Ingen anden forbindelse blev valgt.`, response.status >= 500 ? 'server' : 'rejected', details);
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      network.observeResponseChunk(response, chunk);
      size += chunk.length;
      if (size > 8_000_000) throw new Error('Serverens svar er for stort.');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('Serveren returnerede ikke gyldige modeloplysninger.'); }
    network.finishResponse(response, { outcome: 'completed' });
    return result;
  } catch (error) {
    network.finishResponse(response, { outcome: signal?.aborted || error.name === 'AbortError' ? 'cancelled' : 'failed', error });
    throw error;
  }
}
// Tænkning og indsatsniveauer fra kataloget: Corti oplyser capabilities.reasoning og effort.levels, OpenRouter supported_parameters.
function catalogReasoning(model) {
  const out = {};
  if (typeof model.capabilities?.reasoning === 'boolean') out.reasoning = model.capabilities.reasoning;
  else if (Array.isArray(model.supported_parameters)) out.reasoning = model.supported_parameters.includes('reasoning');
  if (model.effort?.supported === true && Array.isArray(model.effort.levels)) out.effort = model.effort.levels.slice(0, 8);
  else if (out.reasoning && Array.isArray(model.supported_parameters)) out.effort = ['low', 'medium', 'high'];
  return out;
}
async function listModels(connection, key) {
  assertSupported(connection);
  if (definitions[connection.kind].keyRequired && !key) throw new Error('Denne forbindelse kræver en API-nøgle.');
  const ollama = connection.kind === 'ollama';
  const response = await requestJSON(`${connection.baseURL}${ollama ? '/api/tags' : '/models'}`, { key, kind: connection.kind });
  const models = response[ollama ? 'models' : 'data'];
  if (!Array.isArray(models)) throw new Error('Serveren returnerede ingen læsbar modelliste.');
  // Azures katalog beskriver modeller, ikke kundens deployment-navne. Vi sender kun til navnet, brugeren har angivet.
  if (connection.kind === 'azure') return [{ id: connection.deployment, name: connection.deployment, price: null, capabilities: { tools: null }, configuredDeployment: true }];
  return models.slice(0, 5000).filter(model => model && model.capabilities?.completion_chat !== false && !(connection.kind === 'corti' && /embedding/.test(model.id)) && (connection.kind !== 'openai' || /^(gpt-|chatgpt-|codex-|o\d)/.test(model.id) && !/audio|realtime|transcribe|image|tts|search|deep-research/.test(model.id))).map(model => ({
    id: ollama ? model.name : model.id, name: model.name || model.display_name || model.id,
    price: model.pricing || null, capabilities: { tools: model.capabilities?.function_calling ?? model.supported_parameters?.includes('tools') ?? null, ...catalogReasoning(model), ...visionFrom(model) },
    limits: { context: tokenCount(model.context_length ?? model.max_context_length ?? model.context_window ?? model.max_input_tokens), output: tokenCount(model.top_provider?.max_completion_tokens ?? model.max_output_tokens ?? model.max_tokens) },
    local: ollama && !model.remote_host && !/:.*cloud/.test(model.name) ? 'Ikke verificeret' : null
  })).filter(model => typeof model.id === 'string');
}
async function routes(connection, key, model) {
  assertSupported(connection);
  if (connection.kind !== 'openrouter') return [];
  const data = await requestJSON(`${connection.baseURL}/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`, { key, kind: connection.kind, purpose: 'route-catalog' });
  return (data.data?.endpoints || []).map(item => ({ id: item.tag || item.provider_name, name: item.provider_name, price: item.pricing || null, policy: item.data_policy || null, capabilities: { tools: item.supported_parameters?.includes('tools') ?? null, vision: typeof item.capabilities?.vision === 'boolean' ? item.capabilities.vision : Array.isArray(item.input_modalities) ? item.input_modalities.includes('image') : null } })).filter(route => route.id);
}
function disclosure(connection, model, route = null) {
  assertSupported(connection);
  const def = definitions[connection.kind];
  const url = new URL(connection.baseURL);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const site = connection.kind !== 'corti' ? {} : `${url.origin}/v1` === CORTI.fr ? cortiFrance : `${url.origin}/v1` === CORTI['eu-s'] ? cortiSovereign : {};
  const price = route?.price || model.price;
  const free = price && Number(price.prompt) === 0 && Number(price.completion) === 0;
  const known = knownPrice(connection.kind, model.id);
  const zen = connection.kind === 'zen' ? zenTerms.find(([pattern]) => pattern.test(model.id)) : null;
  const data = {
    connection: connection.name, model: model.id, endpoint: connection.baseURL, protocol: connection.protocol || def.protocol,
    recipients: connection.kind === 'openrouter' ? `OpenRouter → ${route?.name || 'Ukendt modeludbyder'}` : `${def.name} · ${url.hostname}`,
    region: site.region || def.region || (loopback ? 'Forbindelsen går til denne computer. Selve modellens behandlingssted er endnu ikke verificeret.' : 'Ukendt; serveradressen dokumenterer ikke behandlingsstedet.'),
    retention: def.retention || 'Ikke verificeret for denne forbindelse. Konto-, model- og servervilkår kan variere.',
    training: zen ? zen[2] : def.training, price: free ? '0 i oplyst pris for input/output. Kvoter, øvrige gebyrer og senere prisændringer kan gælde.' : price ? `Oplyst API-pris: ${JSON.stringify(price)}` : known ? `${usd(known.input)} ${known.currency || 'USD'} pr. million tokens, du sender, og ${usd(known.output)} ${known.currency || 'USD'} pr. million tokens i svar, ifølge ${def.provider}s prisliste (kontrolleret ${known.checkedAt}). ${known.note ? known.note + ' ' : ''}Prisen kan ændre sig; se dit forbrug hos udbyderen. Kilde: ${known.source}` : 'Ukendt pris eller egen drift. Ingen garanti om gratis brug.',
    provider: def.provider || def.name, regionShort: site.regionShort || def.regionShort || null, trainingShort: zen?.[1] || def.trainingShort || null, retentionShort: def.retentionShort || null,
    priceShort: free ? 'Gratis ifølge kataloget. Kvoter kan gælde.' : known && !price ? `${usd(known.input)} ${known.currency || 'USD'} ind og ${usd(known.output)} ${known.currency || 'USD'} ud pr. million tokens${known.note ? ' · normal listepris' : ''}` : null,
    capabilities: model.capabilities?.tools === true ? 'Kataloget angiver værktøjskald; faktisk kodearbejde er ikke verificeret for denne model.' : model.capabilities?.tools === false ? 'Kataloget angiver ikke værktøjsunderstøttelse. Modellen kan være uegnet som kodeagent.' : 'Værktøjsunderstøttelse er ukendt. Modelkataloget er ikke et kompatibilitetsbevis.',
    material: 'Beskeder, samtalehistorik, fælles regler, projektkontekst og de filer/værktøjsresultater agenten læser. Referencefiler kræver særskilt tilvalg. Modelskift starter en ny session.',
    security: url.protocol === 'http:' && !loopback ? 'HTTP uden TLS. Tailscale-kryptering er kun gældende, hvis forbindelsen faktisk går gennem Tailscale; det er ikke verificeret her.' : 'Forbindelsesadressen er kontrolleret. Det er ikke en sikkerhedsgodkendelse af tjenesten.',
    source: site.source || def.source || 'Ingen leverandørkilde registreret; oplysninger skal kontrolleres hos serverens ejer.', checkedAt: def.checkedAt || '2026-09-22', evidence: 'Leverandørdokumentation og modelkatalog; ikke uafhængig revision.', route: route?.id || null
  };
  return { ...data, fingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
// Tal fra et modelkatalog bruges kun, når de ligner rigtige tokengrænser.
function tokenCount(value) { const number = Number(value); return Number.isInteger(number) && number >= 1024 && number <= 10_000_000 ? number : null; }
// Grænser for kendte modeller fra udbydernes dokumentation, kontrolleret 22. oktober 2026. Kataloget har forrang, når det
// oplyser grænserne, fx Anthropics Models API (max_input_tokens og max_tokens) og OpenRouters max_completion_tokens.
// reasoning: modellen tænker, før den svarer, og tænkningen tæller med i svarets loft.
// effort: de indsatsniveauer, udbyderen tager imod. Aura sender kun en indsats, når brugeren selv har valgt en.
const CLAUDE_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
const knownLimits = [
  ['anthropic', /^claude-3-haiku/, { context: 200000, output: 4096 }],
  ['anthropic', /^claude-3-5-/, { context: 200000, output: 8192 }],
  ['anthropic', /^claude-opus-4-(?:2025\d{4}|1)(?:-|$)/, { context: 200000, output: 32000 }],
  ['anthropic', /^claude-opus-4-5(?:-|$)/, { context: 200000, output: 64000, reasoning: true, effort: ['low', 'medium', 'high'] }],
  ['anthropic', /^claude-(?:sonnet-4-(?:2025\d{4}|5)|haiku-4-5)(?:-|$)/, { context: 200000, output: 64000 }],
  // Claude 5-familien og Opus/Sonnet 4.6 og nyere: 1M kontekst og op til 128.000 tokens pr. svar.
  ['anthropic', /^claude-/, { context: 1000000, output: 128000, reasoning: true, effort: CLAUDE_EFFORT }],
  ['zen', /^claude-/, { context: 1000000, output: 128000, reasoning: true, effort: CLAUDE_EFFORT }],
  // OpenAI's modelsider. Azure følger samme grænser, når deployment-navnet er modellens navn.
  ...['openai', 'azure'].flatMap(kind => [
    [kind, /^gpt-5/, { context: 400000, output: 128000, reasoning: true, effort: ['minimal', 'low', 'medium', 'high'] }],
    [kind, /^o\d/, { context: 200000, output: 100000, reasoning: true, effort: ['low', 'medium', 'high'] }],
    [kind, /^gpt-4\.1/, { context: 1047576, output: 32768 }],
    [kind, /^gpt-4o/, { context: 128000, output: 16384 }]
  ]),
  // Mistrals modelkort oplyser konteksten, men ikke svarlængden. Svarloftet er Auras valg og ikke et dokumenteret maksimum.
  ['mistral', /^mistral-large-4(?:-0)?$/, { context: 1000000, output: 32000 }],
  ['mistral', /^mistral-(large|medium)/, { context: 200000, output: 16384 }],
  ['mistral', /codestral|devstral/, { context: 128000, output: 16384 }],
  // Cortis katalog oplyser konteksten, tænkning og indsatsniveauer, men ingen grænse for svarlængden, og dokumentationen
  // nævner ingen. Corti tog 22. oktober imod max_tokens op til hele konteksten, så corti-s1 (GLM 5.3) får Auras højeste loft.
  // Med OpenCodes faste loft på 32.000 kunne tænkningen fylde hele svaret ved store opgaver.
  ['corti', /^corti-s1(?:-instant)?$/, { context: 1048576, output: 128000 }],
  ['corti', /^corti-s1-mini/, { context: 262144, output: 32000 }],
  // Alexandras modelside oplyser kontekstvinduerne. Grænsen for svar er platformens eget tal fra vejledningen til
  // kodeagenter: et unødigt højt max_tokens reserverer flere penge, før svaret skrives, og kan afvises for saldo eller
  // månedsbudget. Tænkning tæller med i svaret, så grænsen sættes ikke lavere end vejledningens 16.384.
  ['alexandra', /^glm-5\.3-flash$/, { context: 1048576, output: 16384 }],
  ['alexandra', /^qwen3\.8-flash-next$/, { context: 262144, output: 16384 }]
];
// Det højeste dokumenterede svarloft (Claude og GPT-5). OpenCode får samme loft, så modellens egen grænse bestemmer.
const OUTPUT_CEILING = 128000;
// Samtaler komprimeres, når et kald nærmer sig 200.000 tokens, også for modeller med større kontekst. Hvert kald bliver
// dermed ikke dyrere og langsommere, og en tænkende model får ikke hele historikken at tænke over.
const WORKING_WINDOW = 200000;
const known = (connection, model) => knownLimits.find(([kind, pattern]) => kind === connection.kind && pattern.test(model.id))?.[2];
/** Om modellen tænker, før den svarer: kataloget først, ellers tabellen. */
function reasons(connection, model) { return typeof model.capabilities?.reasoning === 'boolean' ? model.capabilities.reasoning : known(connection, model)?.reasoning === true; }
/** De indsatsniveauer, udbyderen tager imod for modellen, eller en tom liste. */
function effortLevels(connection, model) {
  const levels = Array.isArray(model.capabilities?.effort) ? model.capabilities.effort : known(connection, model)?.effort || [];
  return levels.filter(level => typeof level === 'string' && /^[a-z]{2,10}$/.test(level));
}
// Det kontekstvindue, udbyderen eller tabellen faktisk oplyser, eller null. Én kilde til, hvad "oplyst" betyder,
// så modelLimits' reservetal og contextLimit aldrig kan komme ud af takt.
const documentedContext = (connection, model) => model.limits?.context || known(connection, model)?.context || null;
function modelLimits(connection, model) {
  const k = known(connection, model);
  const context = documentedContext(connection, model) || 32768;
  // Ukendte modeller får et forsigtigt loft. En tænkende model har brug for plads til både tanker og svar, og en lokal
  // Ollama-model kan bruge op til halvdelen af sin kontekst.
  const fallback = connection.kind === 'ollama' ? Math.floor(context / 2) : reasons(connection, model) ? 32000 : 4096;
  // Et svar må aldrig kunne fylde hele konteksten.
  const output = Math.min(model.limits?.output || k?.output || fallback, OUTPUT_CEILING, Math.floor(context / 2));
  // OpenCode komprimerer ved limit.input minus en reserve; uden den ved konteksten minus svarloftet.
  return context > WORKING_WINDOW ? { context, output, input: Math.min(WORKING_WINDOW, context - output) } : { context, output };
}
// Kun et oplyst kontekstvindue må være nævner i en procent, brugeren ser. Oplyser hverken kataloget eller tabellen
// det, er modelLimits' context Auras forsigtige reservetal, og grænsen er ukendt. Reserven bliver stående til
// motorens egen komprimering; den må blot ikke fremstilles som en målt grænse.
function contextLimit(connection, model) {
  if (!documentedContext(connection, model)) return null;
  const limits = modelLimits(connection, model);
  return limits.input ?? limits.context;
}
function engineProvider(connection, model, gatewayURL, token) {
  assertSupported(connection);
  const anthropic = connection.kind === 'anthropic' || (connection.kind === 'zen' && /^claude-/.test(model.id));
  // Mistral sender både tekst og strukturerede tænkeafsnit. Dets adapter bevarer disse gennem streaming og værktøjssvar.
  return { npm: anthropic ? '@ai-sdk/anthropic' : connection.kind === 'mistral' ? '@ai-sdk/mistral' : usesResponses(connection) ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible', name: connection.name,
    options: { baseURL: gatewayURL, apiKey: token },
    models: { [model.id]: { name: model.name, tool_call: true, limit: modelLimits(connection, model), ...(usesResponses(connection) ? { options: { store: false, include: ['reasoning.encrypted_content'] } } : {}) } } };
}
module.exports = { definitions, accountPages, assertSupported, endpoint, normalize, cleanKey, redact, cortiName, requestJSON, listModels, routes, disclosure, engineProvider, modelLimits, contextLimit, effortLevels, reasons, priceFor, usesResponses, OUTPUT_CEILING, WORKING_WINDOW };
