// One trusted name policy; callers retain their own realpath, content and consent checks.
const RULES = Object.freeze({
  credentials: Object.freeze(['.ssh', '.aws', '.gnupg', '.kube', '.azure', '.npmrc', '.pypirc', '.env*', '*.env', '*.env.*', '*.env*', '*.key', '*.pem', '*.p12', '*.pfx', '*credentials*', '*secrets*']),
  metadata: Object.freeze(['.git', '.aura-private']),
  references: Object.freeze(['references'])
});
// Self-contained so the read plugin can embed this function and the same immutable
// host data. Project content never supplies rules or executable classifier code.
function createPathClassifier(rules) {
  const compile = pattern => new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  const groups = Object.entries(rules).map(([kind, patterns]) => [kind, patterns.map(compile)]);
  return value => {
    const result = { credentials: false, metadata: false, references: false, invalid: false };
    if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) { result.invalid = true; return result; }
    // Win32 aliases must not turn a private name into a public one, even when
    // classifying paths on another OS. Path validity is still checked by callers.
    const segments = value.split(/[\\/]/);
    // Keep the complete POSIX name as well: a colon is a legal character there,
    // so stripping it must never hide e.g. public:credentials.json.
    const parts = segments.flatMap(part => [part, part.split(':')[0]]).map(part => part.toLowerCase());
    // Reject ambiguous portable names rather than using prefix globs such as
    // .git.* (which would also deny the ordinary file .git.notes). This covers
    // every trailing-dot/space spelling, including repeated Win32 aliases.
    result.invalid = parts.some(part => part !== '.' && part !== '..' && /[. ]$/.test(part));
    for (const [kind, expressions] of groups) result[kind] = parts.some(part => expressions.some(expression => expression.test(part)));
    return result;
  };
}
const classify = createPathClassifier(RULES);
function isProtected(value, { references = true, metadata = true } = {}) {
  const result = classify(value);
  return result.invalid || result.credentials || metadata && result.metadata || references && result.references;
}
function patterns({ references = true, metadata = true } = {}) {
  return [...RULES.credentials, ...(metadata ? RULES.metadata : []), ...(references ? RULES.references : [])];
}
function toOpenCodeGlobs(options) {
  // OpenCode's patterns are an early deny. The read hook also checks case,
  // aliases, the actual target and exact selected references before reading.
  return [...new Set([...patterns(options).flatMap(pattern => [pattern, pattern + ':*']), '*.', '* ', '*.:*', '* :*'].flatMap(name => [name, '*/' + name, name + '/*', '*/' + name + '/*']))];
}
function toSandboxGlobs(options) {
  const insensitive = value => value.replace(/[a-z]/g, letter => '[' + letter + letter.toUpperCase() + ']');
  // SRT deny globs cover the matching directory and every descendant. Character
  // sets are supported by its native macOS regex and Linux glob expansion.
  return [...new Set([...patterns(options).flatMap(pattern => [pattern, pattern + ':*']), '*.', '* ', '*.:*', '* :*'].map(pattern => '**/' + insensitive(pattern)))];
}
module.exports = { RULES, createPathClassifier, classify, isProtected, toOpenCodeGlobs, toSandboxGlobs };
