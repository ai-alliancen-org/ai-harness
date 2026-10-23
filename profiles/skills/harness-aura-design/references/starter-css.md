# Valgfrit komponentlag

Kodeblokken kan tilpasses til en godkendt app i brugerprojektet efter almindelige filgodkendelser. Den forudsætter `tokens.css`, fx fra den valgfrie offline-generator. Den må ikke kopieres til værtsappen Auras egen brugerflade. Komponenter og faktisk kontrast skal afprøves efter tilpasning; tokenrapporten er ikke en generel tilgængelighedsgaranti.

```css
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink); font: 400 var(--t-md)/1.55 var(--font-sans); }
img, svg, video { display: block; max-width: 100%; }
button, input, select, textarea { font: inherit; color: inherit; }
h1, h2, h3 { margin: 0 0 var(--s-3); font-family: var(--font-display); line-height: 1.15; overflow-wrap: anywhere; }
h1 { font-size: var(--t-3xl); } h2 { font-size: var(--t-xl); }
p { margin: 0 0 var(--s-4); max-width: var(--prose); overflow-wrap: anywhere; }
a { color: var(--primary-text); text-underline-offset: .18em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.skip-link { position: absolute; top: -100px; left: var(--s-4); z-index: 100; background: var(--ink); color: var(--bg); padding: var(--s-3); }
.skip-link:focus { top: var(--s-4); }
.shell { display: grid; grid-template-rows: auto 1fr auto; min-height: 100dvh; }
.topbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-4); padding: var(--s-4); background: var(--surface); border-bottom: 1px solid var(--line); }
.brand { display: inline-flex; align-items: center; gap: var(--s-3); color: var(--ink); text-decoration: none; font-weight: 650; overflow-wrap: anywhere; }
.brand img { width: auto; height: 32px; }
.logo-plate { padding: var(--s-1) var(--s-2); border-radius: var(--r-sm); background: var(--surface); }
.topbar nav { display: flex; flex-wrap: wrap; gap: var(--s-3); margin-left: auto; }
.topbar nav a { display: inline-flex; align-items: center; min-height: var(--tap); }
.main { width: 100%; max-width: var(--content); margin: 0 auto; padding: clamp(var(--s-5), 4vw, var(--s-8)) var(--s-4); }
.footer { padding: var(--s-5) var(--s-4); border-top: 1px solid var(--line); color: var(--muted); }
.stack > * + * { margin-top: var(--s-5); }
.cluster { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: var(--s-4); align-items: start; }
.grid > *, .stack > * { min-width: 0; }
.card { padding: var(--s-5); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow-1); }
.eyebrow { font: 600 var(--t-xs)/1.4 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.muted, .hint { color: var(--muted); }
.num, .kpi-value { font-variant-numeric: tabular-nums; }
.kpi-value { margin: 0; font-size: var(--t-2xl); font-weight: 700; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2); min-height: var(--tap); max-width: 100%; padding: var(--s-2) var(--s-5); border: 1px solid var(--line-strong); border-radius: var(--r-sm); font-weight: 600; white-space: normal; cursor: pointer; text-decoration: none; transition: background var(--d-fast) var(--ease); }
.btn-primary { background: var(--primary); color: var(--text-on-primary); }
.btn-primary:hover { background: var(--primary-hover); color: var(--text-on-primary-hover); }
.btn-secondary { background: var(--surface); color: var(--ink); }
.btn-secondary:hover { border-color: var(--ink); }
.btn-accent { background: var(--accent); color: var(--text-on-accent); }
.btn-accent:hover { background: var(--accent-hover); color: var(--text-on-accent-hover); }
.btn-danger { background: var(--danger); color: var(--text-on-danger); }
.btn-danger:hover { background: var(--danger-hover); color: var(--text-on-danger-hover); }
.btn:disabled { opacity: .65; cursor: not-allowed; }
.btn[aria-busy="true"]::after { content: ""; width: 1em; height: 1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.field { display: grid; gap: var(--s-2); }
.field label { font-weight: 600; }
.hint, .error { font-size: var(--t-sm); }
.input, .select, .textarea { min-width: 0; width: 100%; min-height: var(--tap); padding: var(--s-2) var(--s-3); border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface); color: var(--ink); }
.textarea { min-height: 8rem; resize: vertical; }
[aria-invalid="true"] { border-color: var(--danger); }
.error { color: var(--danger); font-weight: 600; }
.choice { display: flex; align-items: center; gap: var(--s-2); min-height: var(--tap); }
.choice input { width: 20px; height: 20px; accent-color: var(--primary); }
fieldset { border: 0; padding: 0; margin: 0; }
.pill { display: inline-flex; align-items: center; gap: var(--s-2); padding: var(--s-1) var(--s-3); border-radius: var(--r-pill); background: var(--surface-2); color: var(--ink-2); font-size: var(--t-sm); }
.pill[data-tone="ok"] { color: var(--ok); } .pill[data-tone="warn"] { color: var(--warn); } .pill[data-tone="danger"] { color: var(--danger); } .pill[data-tone="info"] { color: var(--info); }
.table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }
table { width: 100%; border-collapse: collapse; font-size: var(--t-sm); }
th, td { padding: var(--s-3); text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
th { background: var(--surface-2); color: var(--ink-2); }
td.num, th.num { text-align: right; }
.empty { padding: var(--s-6); border: 1px dashed var(--line-strong); border-radius: var(--r); color: var(--muted); text-align: center; }
.notice { padding: var(--s-4); border: 1px solid var(--line); border-left: 4px solid var(--info); border-radius: var(--r); background: var(--surface); }
.toast-region { position: fixed; right: var(--s-4); bottom: var(--s-4); max-width: min(28rem, calc(100% - 2 * var(--s-4))); padding: var(--s-3); background: var(--ink); color: var(--bg); border-radius: var(--r); z-index: 50; }
.toast-region:empty { display: none; }
dialog { max-width: min(32rem, 92vw); padding: var(--s-6); border: 1px solid var(--line-strong); border-radius: var(--r-lg); background: var(--surface); color: var(--ink); }
dialog::backdrop { background: rgb(0 0 0 / .45); }
@media (max-width: 640px) { .topbar nav { order: 3; width: 100%; margin-left: 0; } .btn { padding-inline: var(--s-3); } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
@media (forced-colors: active) { :focus-visible { outline: 3px solid Highlight; } .btn { border-color: ButtonText; } }
@media print { .topbar, .footer, .toast-region, .btn { display: none !important; } }
```

Logoer med en særlig mørk variant skal have eksplicit lokal assethåndtering; en klasse kan ikke garantere et korrekt logo. Fokus, tabeller, toast, dialoger og statusfarver skal undersøges i den konkrete app. Skabelonen indeholder ingen autorisation, netværkslogik eller indbygget godkendelse af eksterne tjenester.
