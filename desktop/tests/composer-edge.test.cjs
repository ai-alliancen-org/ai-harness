// Skrivefeltet har én arbejdskant. docs/decisions.md siger "lyskant" i ental, og DESIGN.md siger, at det er
// metalkanten under #chat-form[data-work-state]: den drejer, mens der arbejdes, står stille efter 15 sekunder
// og forsvinder, når opgaven venter på brugeren. En anden regel, der også tegner en pulserende kant om feltet,
// giver to rytmer oven i hinanden og lader en kant blive stående i waiting.
// Vagten måler reglen, ikke navnet: enhver regel på selve skrivefeltet med en animation fanges, også en
// omdøbt. Den låser ikke fraværet af en bestemt selektor, så en eksplicit waiting-regel må gerne skrives.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../ui/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
// Kommentarer fjernes først, som i theme.test.cjs, så en historisk note ikke gør prøven rød.
// Høj kontrast bruger systemets farver og står for sig.
const rent = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media \(forced-colors: active\) \{[\s\S]*?\n\}\n/, '');
const regler = [...rent.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));

// Rammer selektoren selve skrivefeltet? Efterkommere (.composer textarea), naboklasser (.composer-status)
// og ringen (#chat-form::before) gør ikke.
const rammerFeltet = selector => selector.split(',').some(del => {
  const sidste = del.trim().split(/[\s>+~]+/).pop() || '';
  return !sidste.includes('::') && /^(\.composer|#chat-form)(?![\w-])/.test(sidste);
});

test('kun metalkanten animerer skrivefeltet', () => {
  const animerede = regler.filter(r => rammerFeltet(r.selector) && /(^|;)\s*animation\s*:/.test(r.body)).map(r => r.selector);
  assert.deepEqual(animerede, [], 'Disse regler lægger en animation på selve skrivefeltet ved siden af metalkanten:\n' + animerede.join('\n'));
});

test('arbejdsstatus om skrivefeltet styres ikke med klasser', () => {
  const traef = [...app.matchAll(/#chat-form[^\n]{0,40}classList/g)].map(m => m[0]);
  assert.deepEqual(traef, [], 'app.js sætter en klasse på skrivefeltet; arbejdsstatus skal komme fra data-work-state:\n' + traef.join('\n'));
});

test('metalkanten tegnes af data-work-state, og mærkets animation er stadig med', () => {
  assert.ok(/#chat-form\[data-work-state="working"\]::before/.test(rent), 'working mangler sin regel på ringen');
  assert.ok(/@keyframes composer-working/.test(rent), 'forhåndsvisningens mærke bruger composer-working');
  assert.ok(/\.preview-working::before[^{]*\{[^}]*composer-working/.test(rent), 'mærket skal stadig bruge animationen');
});
