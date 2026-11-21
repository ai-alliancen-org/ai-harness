'use strict';

const { PrivacyGateError } = require('./policy.cjs');
const MAX_BYTES = 4_000_000, MAX_NODES = 100_000, MAX_DEPTH = 80;
const TEXT_KEYS = new Set(['content','text','prompt','input','system','instructions','output','arguments','result','description','title','filename','file_name','name']);
const STRUCTURAL_KEYS = new Set(['id','call_id','tool_call_id','type','role','model','url','uri','image_url','file_id','format','name','$ref','schema','json_schema','parameters','properties','provider','route','tools','tool_choice','arguments']);
// Exact public reference bytes shipped in the built-in skill library. These
// human-readable paths otherwise resemble a long base64 token. This is not a
// URL/domain allowlist or an external-fetch permission: only the length test
// may recognize these immutable fragments. Original text, encodings, source
// labels and secrets are still inspected. Project/model input cannot add one.
const PUBLIC_REFERENCE_FRAGMENTS = Object.freeze([
  'https://arkitektur.digst.dk/principper/princip-2-arkitektur-fremmer-sammenhaeng-innovation-og-effektivitet/arkitekturregel-23',
  'https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/testdata-anvendelse-af-personoplysninger-ved-udvikling-og-test-af-it-systemer',
  'https://digst.dk/kunstig-intelligens/guides-til-brug-af-kunstig-intelligens/guide-offentlige-myndigheder/',
  'https://github.com/Parthee-Vijaya/skills_claude/tree/88ef16cf3f8916911f5f26cb5a334dbdf332d1f5/aura-design',
  'https://www.klimadatastyrelsen.dk/om-klimadatastyrelsen/nyheder/nyhedsarkiv/2026/jun/paralleldrift-paa-datafordeleren-ophoerer-den-15-januar-2027',
  'https://datafordeler.dk/vejledning/brugeradgang/anmodning-om-adgang/det-centrale-virksomhedsregister-cvr/',
  'https://assets.eu.ctfassets.net/i6cea2ilpb83/6m9zr6aCNR3Bou4FEluutV/fe0b60f32ab7b40e7bc0260265864280/vilkaar_for_brug_af_danske_offentlige_data_v4.pdf',
  'https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/katalog-over-foranstaltninger/logning-af-brugernes-anvendelser-af-personoplysninger',
]);
const PUBLIC_REFERENCE_PATTERN = new RegExp('(^|[\\s"\'(<\\[=:])(?:' + PUBLIC_REFERENCE_FRAGMENTS.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=$|[\\s"\'<>`),;\\]]|\\\\(?:n|r|t|["\\\\])|\\.(?:\\s|$))', 'g');
const DETECTORS = [
  ['email', /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?){1,12}/gi],
  ['person', /\b(?:navn|name|borger|patient|person|sagsbehandler|medarbejder|kontaktperson)\s*:\s*(?:\p{Lu}[\p{L}'-]{1,40}[ \t]+){1,4}\p{Lu}[\p{L}'-]{1,40}/giu],
  ['person', /\b(?:Borger|Patient|Citizen|Patient named|Person named)\s+(?:\p{Lu}[\p{L}'-]{1,40}[ \t]+){1,4}\p{Lu}[\p{L}'-]{1,40}/gu],
  ['cpr', /\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[- ]?\d{4}\b/g],
  ['account', /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g],
  ['account', /\b(?:reg(?:istrerings)?(?:nummer|nr)?[.: ]*)\d{4}[\s,;/-]+(?:konto(?:nummer|nr)?[.: ]*)?\d{6,10}\b/gi],
  ['secret', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|(?:gh[pousr]_[A-Za-z0-9_]{20,})|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g],
  ['secret', /\bBearer[ \t]+[A-Za-z0-9._~+/-]{12,}={0,2}/gi],
  ['secret', /\b(?:api[_ -]?key|password|passwd|adgangskode|access[_ -]?token|client[_ -]?secret)["']?\s*[:=]\s*["']?[^\s"',;}]{6,}/gi],
];
function failure(reason) { return new PrivacyGateError('PRIVACY_LOCAL_REQUIRED', 'Indholdet kan ikke kontrolleres sikkert til ekstern deling. Behandl det lokalt.', { reason }); }
function findSensitive(text, values = []) {
  const findings = [];
  for (const [kind, detector] of DETECTORS) {
    detector.lastIndex = 0;
    for (const match of text.matchAll(detector)) findings.push({ kind, start: match.index, end: match.index + match[0].length });
  }
  for (const entry of values) {
    // Values are server-owned exact rules, never regular expressions supplied
    // by a model. Match normalized text so simple Unicode variants do not hide it.
    const needle = entry.value.normalize('NFKC').toLocaleLowerCase('en-US');
    const haystack = text.normalize('NFKC').toLocaleLowerCase('en-US');
    let index = haystack.indexOf(needle);
    while (index !== -1) { findings.push({ kind: entry.kind, start: index, end: index + needle.length }); index = haystack.indexOf(needle, index + Math.max(1, needle.length)); }
  }
  return findings.sort((a,b) => a.start - b.start || b.end - a.end).filter((value,index,array) => !array.slice(0,index).some(other => other.kind === value.kind && other.start <= value.start && other.end >= value.end));
}
function opaqueHeuristicText(value) {
  // OpenCode's ordinary Plan reminder contains this app-generated home path.
  // Its adjacent short directory names + 64-hex runtime fingerprint otherwise
  // look like one long base64 token. Break ONLY this precise fragment for the
  // length heuristic; never skip the original leaf or other media detectors.
  let result = value.replace(PUBLIC_REFERENCE_PATTERN, '$1[public-reference]');
  result = result.replace(/(^|\/)aura-runtime\/runtime\/[a-f0-9]{64}\/home\/\.opencode\/plan(?=$|[\s/])/g, '$1[opencode-plan-directory]');
  const worker = /\/privacy\/workers\/[a-f0-9]{64}\/(?:workers|single-workers)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/(workspace|engine)(?=$|[\s/]|[.,:;](?:\s|$))/g;
  const segmented = result.replace(worker, '/[privacy-worker]/$1');
  if (segmented !== result) {
    // macOS's temporary-directory identity plus the host's hashed worker
    // identity can form an 80+ character slash-delimited pseudo-base64 token.
    // Only these precise runtime fragments are separated for that heuristic;
    // original paths, each segment, secrets and source labels remain inspected.
    result = segmented.replace(/\/(?:private\/)?var\/folders\/[A-Za-z0-9_-]{2}\/[A-Za-z0-9_-]{20,40}\/T\//g, '/[macos-temporary-directory]/');
  }
  return result;
}
function isOpaque(value, path) {
  const key = path.at(-1) || '';
  if (typeof value === 'string') return /data:(?:image|audio|video|application)\//i.test(value)
    || /^https?:\/\//i.test(value) && /(?:image_url|file_url|audio_url|video_url|uri|url)$/.test(key)
    || /^(?:file_data|inline_data|b64_json|base64|binary|encrypted|ciphertext|audio_data)$/i.test(key) && !!value
    || /(?:\bbase64\s*[:,]|-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----)/i.test(value)
    || /[A-Za-z0-9+/_-]{80,}={0,2}/.test(opaqueHeuristicText(value));
  if (!value || typeof value !== 'object') return false;
  return ['image','image_url','input_image','input_audio','audio','video','input_file','file','document'].includes(value.type) || value.type === 'base64' || (value.media_type && /^(?:image|audio|video|application)\//.test(value.media_type));
}
function parseInspectedJSON(body, { numbers } = {}) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES) throw failure('request_limit');
  let parsed; try { parsed = JSON.parse(body); } catch { throw failure('invalid_json'); }
  // JSON.parse keeps only the last duplicate member. The cloud still receives
  // all original wire bytes, including any overwritten private value. Reject
  // that ambiguity before inspection rather than silently trusting the winner.
  const stack = []; let members = 0;
  for (const token of body.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const value = token[0], current = stack.at(-1);
    if (value === '{' || value === '[') {
      if (stack.length >= MAX_DEPTH || ++members > MAX_NODES) throw failure('inspection_limit');
      stack.push(value === '{' ? { object: true, key: true, names: new Set() } : { object: false });
    }
    else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && current?.object) current.key = true;
    else if (value.startsWith('"') && current?.object && current.key) {
      const name = JSON.parse(value);
      if (++members > MAX_NODES) throw failure('inspection_limit');
      if (current.names.has(name)) throw failure('ambiguous_json_member');
      current.names.add(name); current.key = false;
    }
    else if (/^-?\d/.test(value)) {
      if (++members > MAX_NODES) throw failure('inspection_limit');
      numbers?.push(value);
    }
  }
  return parsed;
}
function inspectRequest(body, policy, { contentType = 'application/json' } = {}) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES) throw failure('request_limit');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw failure('unsupported_content_type');
  const numericLexemes = [];
  const parsed = parseInspectedJSON(body, { numbers: numericLexemes });
  // JSON numbers can round, underflow, or change notation during parsing. The
  // provider receives the original numeric bytes, so inspect those too. Numeric
  // content is structural and must never be partially redacted into new code.
  if (numericLexemes.some(value => findSensitive(value, policy.protectedValues || []).length)) throw failure('unsafe_structural_content');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure('invalid_request');
  let nodes = 0, structuralFinding = false, changed = false;
  const inspectedStrings = [];
  let observedBytes = 0;
  function observe(value) {
    if ((observedBytes += Buffer.byteLength(value)) > MAX_BYTES * 8) throw failure('inspection_limit');
    inspectedStrings.push(value);
  }
  const counts = {}, mappings = new Map();
  const protectedValues = policy.protectedValues || [];
  function inspectEncoded(value, depth = 0, seen = new Set()) {
    const normalized = value.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'');
    if (seen.has(normalized)) return;
    if (depth > 8) throw failure('unknown_encoding');
    seen.add(normalized);
    if (depth > 0) {
      observe(normalized);
      if (findSensitive(normalized,protectedValues).length) throw failure('encoded_sensitive_content');
      if (isOpaque(normalized,[])) throw failure('opaque_content');
    }
    if (/%[0-9a-f]{2}/i.test(normalized)) {
      let decoded;
      // Source code and prose legitimately mix URL escapes with literal '%'
      // (for example Python '#%02x%02x%02x' % values). Decode every real %XX
      // byte, while preserving bare percent signs instead of rejecting the
      // entire leaf. Invalid encoded UTF-8 still fails closed.
      try { decoded = decodeURIComponent(normalized.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { throw failure('unknown_encoding'); }
      inspectEncoded(decoded,depth + 1,seen);
    }
    // Bounded recursive decoding prevents base64(hex(PII)), repeated base64,
    // or percent-encoded base64 from being treated as harmless prose. Only
    // canonical encodings that decode to valid UTF-8 are candidates. This is
    // detection, never permission to send an unknown binary representation.
    const segmented = opaqueHeuristicText(normalized);
    const encodingInputs = segmented === normalized ? [normalized] : [normalized,segmented,...normalized.split('/')];
    for (const input of encodingInputs) for (const candidate of input.matchAll(/[A-Za-z0-9+/_-]{8,79}={0,2}/g)) {
      const bytes = Buffer.from(candidate[0],'base64url');
      if (bytes.toString('base64url') !== candidate[0].replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')) continue;
      const decoded = bytes.toString('utf8');
      if (!Buffer.from(decoded,'utf8').equals(bytes)) continue;
      inspectEncoded(decoded,depth + 1,seen);
    }
    for (const candidate of normalized.matchAll(/(?:[a-f0-9]{2}){4,39}/gi)) {
      const bytes = Buffer.from(candidate[0],'hex'), decoded = bytes.toString('utf8');
      if (Buffer.from(decoded,'utf8').equals(bytes)) inspectEncoded(decoded,depth + 1,seen);
    }
  }
  function inspectString(value, path, isKey = false) {
    observe(value);
    // Normalize before matching so concealed compatibility characters are
    // found, but do not guess source offsets after a normalization length change.
    const normalized = value.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'');
    if (normalized !== value) observe(normalized);
    inspectEncoded(normalized);
    const found = findSensitive(normalized, protectedValues);
    if (!found.length) return value;
    for (const item of found) counts[item.kind] = (counts[item.kind] || 0) + 1;
    const structural = isKey || path.some(key => STRUCTURAL_KEYS.has(key)) || !path.some(key => TEXT_KEYS.has(key) || key === 'metadata');
    if (structural) { structuralFinding = true; return value; }
    const disallowed = found.filter(item => item.kind === 'protected' || (item.kind === 'secret' ? !policy.allowSecrets : !policy.allowPersonalData));
    if (!disallowed.length) return value;
    if (!policy.redact) { structuralFinding = true; return value; }
    // Keep independent rule kinds until policy has chosen the disallowed ones.
    // Otherwise an allowed email/secret finding can swallow a stricter exact
    // protected value. Merge only the actual redaction intervals; overlapping
    // replacements must never shift offsets and expose part of another match.
    const spans = [];
    for (const item of disallowed) {
      const prior = spans.at(-1);
      if (prior && item.start < prior.end) { prior.end = Math.max(prior.end, item.end); if (item.kind === 'protected') prior.kind = 'protected'; }
      else spans.push({ ...item });
    }
    let result = normalized;
    for (const item of spans.reverse()) {
      const original = normalized.slice(item.start, item.end), mapKey = `${item.kind}:${original}`;
      if (!mappings.has(mapKey)) mappings.set(mapKey, `${item.kind === 'secret' ? 'SECRET' : item.kind === 'person' ? 'PERSON' : item.kind.toUpperCase()}_${mappings.size + 1}`);
      result = result.slice(0,item.start) + mappings.get(mapKey) + result.slice(item.end);
    }
    changed = true; return result;
  }
  function walk(value, path = [], depth = 0) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw failure('inspection_limit');
    if (isOpaque(value, path)) throw failure('opaque_content');
    if (typeof value === 'string') return inspectString(value,path);
    if (typeof value === 'number') {
      // JSON scalars are request content too. Inspect the decoded value rather
      // than serialized syntax, and never rewrite a number into a placeholder
      // string or silently inspect an overflowed/rounded integer.
      if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) throw failure('uninspectable_number');
      const found = findSensitive(String(value), protectedValues);
      for (const item of found) counts[item.kind] = (counts[item.kind] || 0) + 1;
      if (found.length) structuralFinding = true;
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item,index) => walk(item,[...path,String(index)],depth + 1));
    const result = Object.create(null);
    for (const [key,item] of Object.entries(value)) {
      inspectString(key,[...path,key],true);
      // JSON metadata can carry a secret as a structured key/value rather than
      // prose. Do not silently pass the unrecognized value to a provider.
      if (/^(?:password|passwd|adgangskode|api[_ -]?key|access[_ -]?token|client[_ -]?secret|authorization|secret|token)$/i.test(key) && item !== null && item !== '') { counts.secret = (counts.secret || 0) + 1; structuralFinding = true; }
      if (/^(?:name|navn|person_name|full_name|fullname|patient|borger)$/i.test(key) && typeof item === 'string' && /^(?:\p{L}[\p{L}'-]{1,40}[ \t]+){1,4}\p{L}[\p{L}'-]{1,40}$/u.test(item.trim())) { counts.person = (counts.person || 0) + 1; structuralFinding = true; }
      result[key] = walk(item,[...path,key],depth + 1);
    }
    return result;
  }
  const inspected = walk(parsed);
  // Request-visible protected source paths are additive provenance. A filename
  // is not proof that a source is absent; adapters also supply trusted sources.
  const canonical = value => value.normalize('NFKC').replace(/\\/g,'/').toLocaleLowerCase('en-US');
  const visibleSources = (policy.protectedSources || []).filter(source => {
    const sourcePath = canonical(source.path);
    // Known source names remain provenance even inside a longer encoded token
    // which a generic detector cannot uniquely segment. This is additive only;
    // it never makes a source public or authorizes the original encoded bytes.
    const bytes = Buffer.from(source.path), representations = [bytes.toString('hex'), bytes.toString('base64').replace(/=+$/,''), bytes.toString('base64url')];
    return inspectedStrings.some(value => canonical(value).includes(sourcePath) || representations.some(encoded => value.includes(encoded)));
  });
  if (structuralFinding) throw failure('unsafe_structural_content');
  const output = changed ? JSON.stringify(inspected) : body;
  // Reinspect the complete transformed request. Placeholders never carry the
  // original mapping outside this function and no tool/identifier gets rewritten.
  if (changed) {
    const residue = findSensitive(output.normalize('NFKC'), protectedValues).filter(item => item.kind === 'protected' || (item.kind === 'secret' ? !policy.allowSecrets : !policy.allowPersonalData));
    if (residue.length) throw failure('redaction_incomplete');
  }
  return { body: output, changed, findings: Object.entries(counts).map(([kind,count]) => ({ kind,count })), visibleSources, hasPersonalData: Object.keys(counts).some(key => key !== 'secret'), hasSecrets: !!counts.secret };
}

module.exports = { inspectRequest, findSensitive, parseInspectedJSON, MAX_BYTES };
