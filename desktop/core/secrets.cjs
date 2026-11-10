'use strict';
// Fælles rensning af hemmeligheder i Aura. Samler mønstrene fra terminalen, forbindelserne, udviklingsserveren,
// Git-tjekket og udgivelsen, så ingen af dem svækkes.
//
// redact(text) erstatter hemmeligheder med [skjult], aldrig kun delvist.
// scan(text) returnerer de fundne typer uden at røbe værdierne.
// blockingSecret(text) afgør, om en fil spærres i versioner og udgivelse. Den er snævrere end maskeringen; se nederst.
//
// Alle mønstre er skrevet, så de ikke bliver kvadratiske: hver prøve starter kun ved starten af en sammenhængende
// række tegn (lookbehind), afgrænsede gentagelser er begrænset, og citerede værdier kan afsluttes uden lukketegn.
const MASK = '[skjult]';

const SECRET_SUFFIX = /(?:token|secret|password|passwd|passphrase)$/i;
const KEY_SUFFIX = /(?:api|access|secret|private|auth|license|encryption|signing|master|service|client|app|ssh|admin|publish|session|account|project|bearer|subscription|x-api)[_.-]?key$/i;
const CODE_WORDS = new Set(['true', 'false', 'null', 'undefined', 'none', 'nil', 'string', 'str', 'number', 'int', 'boolean', 'bool', 'any', 'unknown', 'required', 'optional', 'await', 'async', 'new', 'function']);

function secretName(name) {
  if (SECRET_SUFFIX.test(name) || KEY_SUFFIX.test(name)) return true;
  // Miljøvariabler i store bogstaver som FOO_KEY er næsten altid nøgler.
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)*_KEY$/.test(name) || /^[A-Z0-9]+_?KEY$/.test(name) && name !== 'KEY';
}
function lookedUpValue(value) {
  return /^(?:process\.|os\.|import\.meta|\$|<|%|\[skjult|\{\{)/i.test(value) || value.includes('(') || CODE_WORDS.has(value.toLowerCase().replace(/[;,]+$/, ''));
}

// Hver regel: type, mønster og en erstatning. Erstatningen returnerer null, når fundet ikke skal røres.
const rules = [
  { type: 'private_key', re: /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,30}PRIVATE KEY-----|$)/g, to: () => MASK },
  { type: 'url_credentials', re: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s/@:]*):([^\s/@]+)@/gi, to: (m, scheme) => `${scheme}${MASK}@` },
  { type: 'jwt', re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, to: () => MASK },
  { type: 'openai_key', re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/g, to: () => MASK },
  { type: 'aws_key', re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g, to: () => MASK },
  { type: 'github_token', re: /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})/g, to: () => MASK },
  { type: 'komplai_key', re: /(?<![A-Za-z0-9])(?:komp_publish_(?:grant_)?[A-Za-z0-9_-]{8,}|kp_live_[A-Za-z0-9_-]{8,})/g, to: () => MASK },
  { type: 'provider_token', re: /(?<![A-Za-z0-9])(?:xox[abprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{35}|npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,})/g, to: () => MASK },
  // Authorization-hoved: selve tokenet skjules, ordet Bearer bevares.
  { type: 'authorization', re: /(authorization["']?\s*[:=]\s*["']?)(?:(Bearer|Basic|Token|Digest)[ \t]+)?([^\s"',;}]+)/gi,
    to: (m, head, scheme, value) => (value === MASK ? null : `${head}${scheme ? scheme + ' ' : ''}${MASK}`) },
  // Bearer uden hoved: kun når det ligner et token, så ordene "bearer authentication" i en sætning står.
  { type: 'bearer', re: /(?<![A-Za-z0-9])(Bearer)[ \t]+([A-Za-z0-9._~+/=-]{6,})/g,
    to: (m, word, token) => (token === MASK || !(/[0-9._~+/=-]/.test(token) || token.length >= 20) ? null : `${word} ${MASK}`) },
  // NAVN=værdi, "navn": "værdi" og navn: værdi, hvor navnet ender på key, token, secret eller password.
  { type: 'named_secret',
    re: /(?<![\w.-])(\\?["']?)([\w.-]+)(\\?["']?)([ \t]*[:=][ \t]*)(?:(\\?["'])((?:[^"'\\\n]|\\[^"'\n])*)(\\?["'])?|([^\s,;&"'})\]\\]+))/g,
    to: (m, q1, name, q2, sep, vq, quoted, vclose, bare) => {
      if (!secretName(name)) return null;
      if (vq !== undefined) return quoted === MASK || quoted === '' ? null : `${q1}${name}${q2}${sep}${vq}${MASK}${vclose || ''}`;
      if (lookedUpValue(bare)) return null;
      // "token = await hentToken()" og lignende kode: uden citationstegn kræves noget, der ligner en nøgle.
      if (/^[ \t]|[ \t]$/.test(sep) && sep.includes('=') && !(bare.length >= 12 || /[0-9]/.test(bare))) return null;
      return `${q1}${name}${q2}${sep}${MASK}`;
    } },
  // Lange tilfældige strenge uden præfiks. Kræver store og små bogstaver samt ciffer, så hashes og stier står.
  { type: 'long_key', re: /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{40,}/g,
    to: m => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m) ? MASK : null) }
];

function run(text, onHit) {
  let out = String(text ?? '');
  for (const rule of rules) {
    out = out.replace(rule.re, (...args) => {
      const groups = args.slice(0, -2 - (typeof args.at(-1) === 'object' ? 1 : 0));
      const replacement = rule.to(...groups);
      if (replacement === null) return groups[0];
      if (onHit) onHit(rule.type);
      return replacement;
    });
  }
  return out;
}

function redact(text) { return run(text); }
function scan(text) {
  const found = new Set();
  run(text, type => found.add(type));
  return [...found];
}

// Præcise fund, der spærrer en fil i versioner, gennemgang og udgivelse. Maskeringen ovenfor må gerne skjule for meget,
// men en fil spærres kun for typer, der næsten altid er en rigtig hemmelighed, som i 0.7.0-beta.2. Offentlige
// klientnøgler (JWT med role anon, fx Supabases anon-nøgle, og Googles AIza-nøgler til Google Maps og Firebase),
// CSS-navne som .sk-chase-dot og pladsholdere som ${PASSWORD}, <password> og DIN_NOEGLE_HER spærrer ikke. Funktionen
// indlejres uændret i Pages-workflowet, så Aura og workflowet bruger samme regler; den må derfor ikke bruge noget uden
// for sig selv. Svaret er fundets type eller en tom tekst.
function blockingSecret(text) {
  text = String(text ?? '');
  const template = value => /^(?:\$\{[^}]*\}|\$[A-Za-z_]\w*|\{\{[^}]*\}\}|<[^>]*>|\[[^\]]*\]|%[sd]|%\([\w-]+\)s|x{3,}|\*{3,}|\.{3,}|…)$/i.test(value);
  // En pladsholder beder læseren skrive sin egen værdi: YOUR_API_KEY, DIN_NOEGLE_HER, your-api-key-here, eller den navngiver en
  // variabel som DB_PASSWORD. Et ord som my_ eller min- foran en værdi med tal (my_session_secret_8f3k2Lq, min-kode-2024!xyz) er en
  // rigtig værdi, og det er store bogstaver uden et pladsholderord også (CORRECTHORSEBATTERYSTAPLE, PROD_KEY_ALPHA_BRAVO_CHARLIE).
  // Sætninger med mellemrum efter ordet (your password …) er uændrede.
  const marker = /^(?:your|my|din|dit|dine|min|mit|mine|insert|indsæt|replace|erstat|here|her)$/i, noun = /^(?:key|password|passwd|pass|pwd|secret|token|kode|kodeord|adgangskode|noegle|nøgle)$/i;
  const placeholder = value => template(value) || /^(?:password|passwd|pass|pwd|secret|kode|kodeord|adgangskode|hemmelig)$/i.test(value)
    || /^(?:your|my|din|dit|min|mit|insert|indsæt|replace|erstat) /i.test(value) || (/^(?:your|my|din|dit|min|mit|insert|indsæt|replace|erstat)[_-]/i.test(value) && !/[0-9]/.test(value))
    || (/^[A-ZÆØÅ]+(?:_[A-ZÆØÅ]+)*$/.test(value) && (value.split('_').some(word => marker.test(word)) || (value.includes('_') && noun.test(value.slice(value.lastIndexOf('_') + 1)))));
  // En sætning er en tekst til læseren, ikke en hemmelighed: password: "Adgangskoden er forkert" eller 'The password is required'.
  // Den har mindst to ord, alle kun bogstaver (med bindestreg eller apostrof inde i ordet og evt. tegnsætning til sidst), og mindst ét
  // almindeligt lille ord som er, skal, the eller is. Adgangsfraser uden små ord (correct horse battery staple) og alt med tal eller
  // tegn er ikke sætninger og spærrer stadig. Hele ord afgøres ved opdeling på mellemrum, så det er lineært.
  const smallWords = new Set(['er', 'skal', 'kan', 'må', 'ikke', 'og', 'eller', 'at', 'en', 'et', 'den', 'det', 'til', 'for', 'med', 'på', 'af', 'som', 'har', 'du', 'din', 'dit', 'jeg', 'vi', 'der', 'de', 'i', 'så', 'hvis', 'the', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'or', 'not', 'your', 'must', 'should', 'will', 'can', 'a', 'an', 'in', 'with', 'if', 'it', 'this', 'that', 'on']);
  const sentence = value => {
    const words = value.trim().split(/\s+/);
    if (words.length < 2) return false;
    let small = false;
    for (const word of words) {
      if (!/^[A-Za-zÆØÅæøåéèüöä]+(?:['’-][A-Za-zÆØÅæøåéèüöä]+)*[.,!?:;]*$/.test(word)) return false;
      if (smallWords.has(word.toLowerCase().replace(/[.,!?:;]+$/, ''))) small = true;
    }
    return small;
  };
  const anon = token => { try { return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role === 'anon'; } catch { return false; } };
  const publicKey = value => /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value) && anon(value);
  // Googles AIza-nøgler har samme form, uanset om de er offentlige (Google Maps, Firebase) eller hemmelige (fx Gemini).
  // Den nærmeste sammenhæng op til 300 tegn fra nøglen afgør: en Gemini-kommentar eller -import et andet sted i filen gør ikke en
  // Google Maps-nøgle hemmelig, men står Gemini lige så tæt på nøglen som Maps eller Firebase, er den hemmelig.
  const geminiMark = /gemini|genai|generative-?ai|generativelanguage|aistudio/gi, clientMark = /firebase|authDomain|google[._-]?maps?|maps\.googleapis|\bnew Loader\s*\(/gi;
  const distance = (re, start, end) => {
    const from = Math.max(0, start - 300); let best = Infinity;
    for (const x of text.slice(from, end + 300).matchAll(re)) { const a = from + x.index, b = a + x[0].length; best = Math.min(best, b <= start ? start - b : a >= end ? a - end : 0); }
    return best;
  };
  const clientCloser = (start, end) => { const client = distance(clientMark, start, end); return client < Infinity && client < distance(geminiMark, start, end); };
  // En navngiven nøgle er kun offentlig, når navnet er en API-nøgle uden anden tjeneste end Google, Maps eller Firebase
  // (fx apiKey, googleMapsApiKey, VITE_FIREBASE_API_KEY), og Maps eller Firebase står nærmere end Gemini.
  // GEMINI_API_KEY og new GoogleGenAI({ apiKey }) spærrer derfor som i 0.7.0-beta.2.
  const googleClientKey = (m, value) => {
    if (!/^AIza[A-Za-z0-9_-]{35}$/.test(value) || !/^api[_-]?key/i.test(m[0])) return false;
    let start = m.index;
    while (start > 0 && m.index - start < 60 && /[\w$.-]/.test(text[start - 1])) start--;
    if (!/^(?:(?:next|nuxt|vite|react|app|expo|gatsby|public|google|maps?|firebase|web|js|config|settings|options|window|this)[._$-]?)*$/i.test(text.slice(start, m.index))) return false;
    return clientCloser(start, m.index + m[0].length);
  };
  if (/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/.test(text)) return 'private_key';
  if (/(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(text)) return 'github_token';
  if (/(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/.test(text)) return 'aws_key';
  if (/(?<![A-Za-z0-9_])(?:kp_live_[A-Za-z0-9_-]{43}|komp_publish_(?:grant_)?[a-f0-9]{64})/.test(text)) return 'komplai_key';
  if (/(?<![A-Za-z0-9])(?:xox[abprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])|glpat-[A-Za-z0-9_-]{20,})/.test(text)) return 'provider_token';
  // Supabases hemmelige nøgler (sb_secret_…). Den offentlige sb_publishable_… spærrer ikke.
  for (const m of text.matchAll(/(?<![A-Za-z0-9_])sb_secret_([A-Za-z0-9_-]{20,})/g)) if (/[0-9A-Z]/.test(m[1])) return 'supabase_secret';
  // sk- kræver mindst 20 tegn med et tal eller et stort bogstav, som alle rigtige nøgler har (sk-proj-, sk-ant-, sk-or-v1-).
  for (const m of text.matchAll(/(?<![A-Za-z0-9_.-])sk-([A-Za-z0-9_-]{20,})/g)) if (/[0-9A-Z]/.test(m[1])) return 'openai_key';
  for (const m of text.matchAll(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g)) if (!anon(m[0])) return 'jwt';
  // bruger:kode@ i en adresse. Kun kodeordet afgør: ${user}:${pass}@ og USER:PASSWORD@ er skabeloner, men ${user}:S3cr3t@ er ikke.
  for (const m of text.matchAll(/(?<![A-Za-z0-9_+.-])[a-z][a-z0-9+.-]{1,20}:\/\/([^\s/@:]*):([^\s/@]+)@/gi)) if (!placeholder(m[2])) return 'url_credentials';
  // Et bogstaveligt token i et Authorization-hoved, som i Pages-workflowet før 0.7.0-beta.3. Bearer ${token} og "Bearer " + token har
  // intet bogstaveligt token, og Bearer your-token-here er en pladsholder. Et rigtigt token er en tilfældig værdi fra en tjeneste med tal
  // eller både store og små bogstaver, så ord som authentication-required i en vejledning er ikke et token. Det begynder heller aldrig
  // med your- eller din-, så your-token-123 er en pladsholder, også med tal. Adgangskoder vælger man selv, så den undtagelse gælder ikke dem.
  const randomToken = value => /[0-9]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
  for (const m of text.matchAll(/authorization["']?\s*[:=]\s*["'`]?(?:Bearer|Basic|Token)[ \t]+([A-Za-z0-9._~+\/=-]{12,})/gi)) if (!placeholder(m[1]) && !/^(?:your|din|dit|insert|replace|erstat)[_-]/i.test(m[1]) && randomToken(m[1])) return 'authorization';
  // Navngivne værdier i anførselstegn som i 0.7.0-beta.2, fx api_key = "…" eller password: "…".
  for (const m of text.matchAll(/(?:api[_-]?key|secret|password|access[_-]?token)\s*(?:["']\s*)?[:=]\s*["']([^"'\r\n]{12,})["']/gi)) if (!placeholder(m[1]) && !sentence(m[1]) && !publicKey(m[1]) && !googleClientKey(m, m[1])) return 'named_secret';
  // En Google-nøgle uden navn (fx new GoogleGenerativeAI('AIza…') eller ?key=AIza… til generativelanguage) er hemmelig, når Gemini står
  // inden for 300 tegn og mindst lige så tæt på nøglen som Maps eller Firebase. Ellers er den en offentlig klientnøgle som i 0.7.0-beta.2.
  if (/gemini|genai|generative-?ai|generativelanguage|aistudio/i.test(text)) for (const m of text.matchAll(/(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g)) {
    const end = m.index + m[0].length;
    if (distance(geminiMark, m.index, end) < Infinity && !clientCloser(m.index, end)) return 'provider_token';
  }
  return '';
}

module.exports = { redact, scan, blockingSecret, MASK };
