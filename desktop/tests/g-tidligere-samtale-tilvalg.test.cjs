// Skeptikerens fund efter G1 og G2: efter Q:B1-2 får en ny AI-session altid de seneste beskeder, og en fortsat session får aldrig en kopi
// (ChatSession.prepare: handoff). Tilvalget «Medsend en ekstra kopi af tidligere samtale» ændrede derfor intet, men teksterne lovede en
// virkning. Et synligt valg uden virkning strider mod DESIGN.md og AGENTS.md («forklar, hvad der sker»). Tilvalget er fjernet, og teksten
// under «Tidligere samtale» siger, hvad der sker. At tilvalget ikke ændrede det, der sendes, viser tests/tidligere-samtale-linje.test.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');

test('under Tidligere samtale står intet tilvalg om en ekstra kopi', () => {
  assert.doesNotMatch(html, /id="include-history"/);
  assert.doesNotMatch(html, /Medsend en ekstra kopi/);
  // Hver henvisning til elementet ville fejle i den rigtige side, når elementet ikke findes.
  assert.doesNotMatch(app, /#include-history/);
});

test('teksten siger, hvad der sker med tidligere beskeder, og lover ikke et valg', () => {
  const resume = /\$\('#resume-text'\)\.textContent = \[[^\n]*?: '([^']+)';/.exec(app)?.[1];
  assert.ok(resume, 'teksten under Tidligere samtale findes');
  assert.doesNotMatch(resume, /vælge at medsende|ekstra kopi/);
  assert.match(resume, /Hos samme AI fortsætter samtalen med tidligere beskeder og værktøjsresultater\./);
  assert.match(resume, /Starter en ny AI-session, fx ved skift af AI, følger de seneste beskeder med som tekst\./);
});
