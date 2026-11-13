// Overblik, runde 3 (reparation af spor D efter skeptikeren). «/*» og « // » i JSX-tekst er ingen kommentar, så et kald senere i
// .jsx- og .tsx-filen står som kald (RN:E-1 nævner JSX-tekst). En apostrof eller et anførselstegn i almindelig HTML-tekst er ingen
// streng, så en <!-- --> eller et <script> derimellem følger stadig HTML's regler. Angulars <a [routerLink]>, <a (click)>, <a #ref>
// og <a *ngIf> er stadig links og ikke kald.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyze } = require('../core/system-overview.cjs');

async function projekt(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-overblik-r3-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}
const vaerter = m => m.services.flatMap(s => s.hosts || [s.host]);
const kaldt = (m, vaert) => vaerter(m).includes(vaert);
const linket = (m, vaert) => m.links.some(link => link.host === vaert);

test('JSX: «/*» og « // » i JSX-tekst skjuler ingen kald senere i filen; rigtige kommentarer er stadig ingen kald', async t => {
  const m = await analyze(await projekt(t, {
    'src/Pris.tsx': [
      'export function Pris({ antal }: { antal: number }) {',
      '  return (<div><p>Priser /* foreløbige</p>',
      '    <p>Åbent 8-16 // fredag <img src="https://billeder.eksempel-tsx.dk/x.png" /></p>',
      '    <p>{antal} kr. /* inkl. moms</p></div>);',
      '}',
      'export const hent = () => fetch("https://api.eksempel-tsx.dk/data");',
      '/* Gammel: https://gammel.eksempel-tsx.dk */',
      '// Ældre: https://aeldre.eksempel-tsx.dk',
      'const kort: Map<string, number> = new Map(); // https://generisk.eksempel-tsx.dk',
      'export const Tom = () => (<main>{/* https://skitse.eksempel-tsx.dk */}</main>);',
      // «<b>» i en streng og «{Array<string>}» i en fjernet kommentar ligner ikke JSX for blikket bagud.
      'const fed = "<b>";',
      '// https://streng.eksempel-tsx.dk',
      '/** @param {Array<string>} navne */',
      '// https://jsdoc.eksempel-tsx.dk'
    ].join('\n'),
    'src/Kontakt.jsx': [
      'export const Kontakt = () => (',
      '  <section>',
      '    Ring på hverdage // eller skriv <img src="https://billeder.eksempel-jsx.dk/y.png" />',
      '  </section>',
      ');',
      '// https://gammel.eksempel-jsx.dk'
    ].join('\n')
  }));
  for (const vaert of ['api.eksempel-tsx.dk', 'billeder.eksempel-tsx.dk', 'billeder.eksempel-jsx.dk']) assert.ok(kaldt(m, vaert), `${vaert} mangler: ${JSON.stringify(vaerter(m))}`);
  for (const vaert of ['gammel.eksempel-tsx.dk', 'aeldre.eksempel-tsx.dk', 'generisk.eksempel-tsx.dk', 'skitse.eksempel-tsx.dk', 'streng.eksempel-tsx.dk', 'jsdoc.eksempel-tsx.dk', 'gammel.eksempel-jsx.dk']) assert.equal(kaldt(m, vaert), false, `${vaert} er en kommentar`);
});

test('HTML: en apostrof eller et anførselstegn i almindelig tekst er ingen streng; kommentarer og script derimellem følger HTML', async t => {
  const m = await analyze(await projekt(t, {
    'index.html': [
      "<p>Don't <!-- <img src=\"https://gammel.eksempel-html.dk/x.png\"> --> worry, it's fine</p>",
      "<p>Don't <script>/* https://gammel-script.eksempel-html.dk */ fetch('https://api.eksempel-html.dk/v1');</script> it's</p>",
      '<p>Han sagde "hej <!-- https://gammel-citat.eksempel-html.dk --> farvel"</p>',
      // En attributværdi er stadig en streng: «<!--» i den starter ingen kommentar, og billedet bagefter er et kald.
      '<div title="<!-- ikke en kommentar"></div><img src="https://billeder.eksempel-html.dk/x.png"><!-- slut -->'
    ].join('\n')
  }));
  for (const vaert of ['api.eksempel-html.dk', 'billeder.eksempel-html.dk']) assert.ok(kaldt(m, vaert), `${vaert} mangler: ${JSON.stringify(vaerter(m))}`);
  for (const vaert of ['gammel.eksempel-html.dk', 'gammel-script.eksempel-html.dk', 'gammel-citat.eksempel-html.dk']) assert.equal(kaldt(m, vaert), false, `${vaert} er en kommentar`);
});

test('Angular: <a [routerLink]>, <a (click)>, <a #ref> og <a *ngIf> er links, ikke kald; «n<a (b)» i kode er stadig intet tag', async t => {
  const m = await analyze(await projekt(t, {
    'src/app/menu.component.html': [
      '<a [routerLink]="[\'/borger\']" href="https://www.borger.dk">Borger.dk</a>',
      '<a #ref (click)="spor()" href="https://www.sundhed.dk">Sundhed</a>',
      '<a *ngIf="vis" [(ngModel)]="valgt" href="https://www.skat.dk">Skat</a>'
    ].join('\n'),
    'liste.js': 'const x = n<a ? hent("https://api.eksempel-angular.dk/v1") : (q > 2);'
  }));
  for (const vaert of ['www.borger.dk', 'www.sundhed.dk', 'www.skat.dk']) {
    assert.ok(linket(m, vaert), `${vaert} er et link: ${JSON.stringify(m.links)}`);
    assert.equal(kaldt(m, vaert), false, `${vaert} er intet kald`);
  }
  assert.ok(kaldt(m, 'api.eksempel-angular.dk'), JSON.stringify(vaerter(m)));
});
