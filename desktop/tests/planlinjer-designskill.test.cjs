// Spørgsmål A-8 fra første runde: en installation fra før 27.10 fik to planlinjer for designskillen («1 skill opdateres» og «1 skill lægges i»),
// fordi planLines grupperede pr. fil. Designskillen fik to nye referencer (a15245f), mens SKILL.md og tilgaengelighed.md blev opdateret.
// Operationerne er dem, installer.cjs gav for en rigtig installation med profiles fra a15245f~1, gennemgået med de nuværende profiles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const cut = (from, to) => { const start = source.indexOf(from), end = source.indexOf(to, start); if (start < 0 || end < 0) throw Error('ui/app.js mangler ' + from); return source.slice(start, end); };
const planLines = new Function(cut('const plural = ', '\n') + '\n' + cut('function planLines(review) {', '\nfunction reviewNotes') + '\nreturn planLines;')();
const skill = (name, file, action) => ({ path: `.claude/skills/${name}/${file}`, kind: 'fil', action });

test('en skill med både nye og ændrede filer står på én planlinje som opdateret', () => {
  const design = 'harness-design-og-tilgaengelighed';
  const lines = planLines({ version: '0.2.1', operations: [skill(design, 'SKILL.md', 'opdater'), skill(design, 'references/designmetode.md', 'opret'), skill(design, 'references/moenstre-og-tilstande.md', 'opret'), skill(design, 'references/tilgaengelighed.md', 'opdater'), skill('harness-kodestil', 'SKILL.md', 'uaendret')] });
  assert.deepEqual(lines, ['1 skill opdateres i .claude/skills.']);
});

test('nye, fjernede og opdaterede skills tælles hver for sig og én gang', () => {
  const lines = planLines({ version: '0.2.1', operations: [skill('harness-a', 'SKILL.md', 'opret'), skill('harness-a', 'references/x.md', 'opret'), skill('harness-b', 'SKILL.md', 'fjern'), skill('harness-b', 'references/y.md', 'fjern'), skill('harness-c', 'SKILL.md', 'opdater'), skill('harness-c', 'references/z.md', 'fjern')] });
  assert.deepEqual(lines, ['1 skill lægges i .claude/skills.', '1 skill fra en tidligere installation fjernes fra .claude/skills.', '1 skill opdateres i .claude/skills.']);
});
