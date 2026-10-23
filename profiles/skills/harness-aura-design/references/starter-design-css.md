# Valgfrit layoutlag til brugerprojektet

Denne reference gælder kun brugerens genererede app og kun inden for den konkret godkendte opgave. Den ændrer ikke værtsappen Aura, dens onboarding, planer eller godkendelser.

Dette er dokumentation med et CSS-eksempel, ikke en installeret fil eller en ændring af Auras UI. Materialisér kun relevante dele som `design.css` gennem normale godkendte filhandlinger. Indlæs efter `tokens.css` og `app.css`, før eventuel `brand.css`. Aktivér højst én opskrift fx med `data-design="modern-saas"` på html-elementet. Mulige værdier er `clean`, `modern-saas`, `editorial`, `dashboard` og `workspace`; vælg ud fra den godkendte retning. `.bento` er et særskilt sektionslayout. Tema, fonte og palette ændres ikke automatisk.

Eksemplet er tilpasset tokenkontrakten i token-generator.md: den udefinerede kildetoken `--t-hero` er erstattet af `--t-3xl`. Test stadig faktisk reflow, tastatur, zoom, kontrast og komponenttilstande i brugerprojektet. Kodeeksemplet er ingen fungerende chat-, agent- eller godkendelsesmotor.

```css
/* Valgfri Aura-komposition, egen implementering. Ikke eksterne skill-/CSS-filer.
   Indlæs efter app.css og før brand.css. Bevar alle genererede tokens.
   data-design vælger komposition; data-theme vælger fortsat tema. */
:root[data-design="clean"] .card,
:root[data-design="modern-saas"] .card,
:root[data-design="workspace"] .card { box-shadow: none; }
:root[data-design="modern-saas"] .main > * + * { margin-top: var(--s-7); }
:root[data-design="editorial"] .page-heading { padding-block: var(--s-7); }
:root[data-design="editorial"] .page-heading h1 {
  font: 600 var(--t-3xl)/1.08 var(--font-display); max-width: 18ch;
}
:root[data-design="editorial"] .prose { max-width: var(--prose); }
:root[data-design="dashboard"] .kpi-value { font-size: var(--t-3xl); }
.page-heading {
  display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between;
  gap: var(--s-5);
}
.page-heading > * { min-width: 0; }
.page-heading h1 { margin-bottom: var(--s-3); }
.page-heading p:last-child { margin-bottom: 0; }
.split-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-6); align-items: start; }
.split-layout > *, .metric-grid > *, .bento > *, .workspace-grid > * { min-width: 0; }
@media (min-width: 960px) {
  .split-layout { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
}
.metric-grid {
  display: grid; gap: var(--s-4);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
}
.metric-featured { background: var(--surface-2); border-color: var(--line-strong); }
.metric-featured .kpi-value { font-size: var(--t-3xl); }
/* Formidling: behold DOM-rækkefølge; ingen dense packing eller faste højder. */
.bento { display: grid; gap: var(--s-4); grid-template-columns: minmax(0, 1fr); }
.bento > * { overflow-wrap: anywhere; }
@media (min-width: 820px) {
  .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bento .bento-wide { grid-column: span 2; }
}
@media (min-width: 1200px) { .bento { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.feature-band { border-block: 1px solid var(--line-strong); padding-block: var(--s-7); }
.feature-band h2 { max-width: 24ch; }
/* To arbejdsområder; tilføj kun inspektør, når opgaven har relevante detaljer.
   På smalle flader ligger detaljerne efter hovedindholdet og skjules ikke. */
.workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-5); align-items: start; }
.workspace-panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: var(--s-5); }
.panel-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-4); }
.panel-heading h2 { margin: 0; font-size: var(--t-xl); }
.tool-call { background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-sm); }
.tool-call > summary { min-height: var(--tap); padding: var(--s-3) var(--s-4); cursor: pointer; overflow-wrap: anywhere; }
.tool-call > .tool-call-body { padding: var(--s-4); border-top: 1px solid var(--line); }
.tool-call pre { max-width: 100%; overflow-x: auto; }
.composer { display: grid; gap: var(--s-3); }
.statusbar { display: flex; flex-wrap: wrap; gap: var(--s-4); padding: var(--s-3) var(--s-4); border-top: 1px solid var(--line); color: var(--muted); font-size: var(--t-sm); }
@media (min-width: 1200px) {
  .workspace-grid { grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr); }
}
@media (forced-colors: active) { .metric-featured { border: 2px solid CanvasText; } }
```
