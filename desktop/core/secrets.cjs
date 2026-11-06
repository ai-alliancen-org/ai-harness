'use strict';
// Fælles rensning af hemmeligheder i Aura. Samler mønstrene fra terminalen, forbindelserne, udviklingsserveren,
// Git-tjekket og udgivelsen, så ingen af dem svækkes.
//
// redact(text) erstatter hemmeligheder med [skjult], aldrig kun delvist.
// scan(text) returnerer de fundne typer uden at røbe værdierne.
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

module.exports = { redact, scan, MASK };
