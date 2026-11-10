// Spørgsmål Q:C2-6 (beta 3): Electron-prøverne svarer med faste plansvar fra en kontrolleret model. Appen viser kun plankortet, når
// svaret har alle fire afsnit (concretePlan i ui/conversation-mode.js). verify-live-app.cjs svarede med én linje og ventede forgæves
// på plankortet fra 13. oktober til beta 3. Prøven læser hvert script i scripts/, der indeholder et plansvar, og kontrollerer hvert
// plansvar med appens egen regel, så et script ikke kan glide fra reglen igen uden at nogen ser det.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { concretePlan } = require('../ui/conversation-mode.js');

const scripts = process.env.AURA_PLAN_SCRIPTS || path.join(__dirname, '../scripts');
// Et plansvar i et script er enten én streng med linjeskift (\n) eller en liste af linjer, der sættes sammen med .join('\n').
// En liste kan afhænge af en parameter (fx version i verify-planning.cjs); den afprøves med 1 og 2. Kilden læses med en lille
// tokenlæser i én gennemgang (strenge, kommentarer, regulære udtryk og firkantede parenteser), så læsningen aldrig hænger.
function tokens(source) {
  const strings = [], arrays = [], open = [];
  let last = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    if (c === '/' && (!last || /[(,=:[!&|?{};]/.test(last))) {
      let inClass = false; i++;
      for (; i < source.length && source[i] !== '\n'; i++) { if (source[i] === '\\') { i++; continue; } if (source[i] === '[') inClass = true; else if (source[i] === ']') inClass = false; else if (source[i] === '/' && !inClass) break; }
      last = '/'; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const from = i;
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
      strings.push({ at: from, raw: source.slice(from, i + 1) }); last = c; continue;
    }
    if (c === '[') open.push(i);
    else if (c === ']' && open.length) arrays.push({ at: open.pop(), end: i });
    if (!/\s/.test(c)) last = c;
  }
  return { strings, arrays };
}
function plansIn(source) {
  const found = [], { strings, arrays } = tokens(source);
  for (const item of strings) if (item.raw.includes('Det bygger vi') && item.raw.includes('\\n') && item.raw[0] !== '`') found.push({ at: item.at, text: Function(`return ${item.raw}`)() });
  for (const { at, end } of arrays) {
    const list = source.slice(at, end + 1);
    if (!list.includes('Det bygger vi') || !source.startsWith(".join('\\n')", end + 1)) continue;
    const parameter = source.slice(Math.max(0, at - 40), at).match(/\(?(\w+)\)?\s*=>\s*$/)?.[1];
    for (const value of parameter ? [1, 2] : [undefined]) found.push({ at, text: Function(parameter || '_', `return ${list}.join('\\n')`)(value) });
  }
  return found;
}

test('alle faste plansvar i Electron-prøverne har de fire afsnit, som appen kræver for plankortet', () => {
  const files = fs.readdirSync(scripts).filter(name => name.endsWith('.cjs')).sort();
  const checked = [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(scripts, name), 'utf8');
    if (!/'(?:## )?Det bygger vi/.test(source)) continue;
    const plans = plansIn(source);
    // Et script med et plansvar, som prøven ikke kan læse, må ikke springes tavst over.
    assert.ok(plans.length, `${name}: plansvaret kunne ikke læses af prøven. Skriv det som én streng eller som en liste med .join('\\n').`);
    for (const plan of plans) {
      const line = source.slice(0, plan.at).split('\n').length;
      assert.equal(concretePlan(plan.text), true, `${name}:${line}: plansvaret mangler et af de fire afsnit (Det bygger vi, Sådan skal det se ud, Teknik og data, Det skal du prøve) eller deres indhold:\n${plan.text}`);
    }
    checked.push(name);
  }
  // De tre prøver, der fejlede eller blev rettet i beta 3, skal altid være med.
  for (const name of ['verify-live-app.cjs', 'verify-recovery.cjs', 'verify-conversation-progress.cjs']) assert.ok(checked.includes(name), `${name} blev ikke kontrolleret`);
});

test('modværn: prøvens læsning kender både et gyldigt og et ufuldstændigt plansvar', () => {
  const ok = "const plan = '## Det bygger vi\\nEn side.\\n## Sådan skal det se ud\\nRolig.\\n## Teknik og data\\nHTML.\\n## Det skal du prøve\\nSe siden.';";
  const liste = "const p = v => ['## Det bygger vi', v === 1 ? 'En' : `To ${v}`, '## Sådan skal det se ud', 'Rolig.', '## Teknik og data', 'HTML.', '## Det skal du prøve', 'Se siden.'].join('\\n');";
  const enLinje = "content: stage === 'plan' ? 'Det bygger vi\\nEn side med tre lokaler.' : 'Færdig'";
  assert.deepEqual(plansIn(ok).map(plan => concretePlan(plan.text)), [true]);
  assert.deepEqual(plansIn(liste).map(plan => concretePlan(plan.text)), [true, true]);
  assert.deepEqual(plansIn(enLinje).map(plan => concretePlan(plan.text)), [false]);
});
