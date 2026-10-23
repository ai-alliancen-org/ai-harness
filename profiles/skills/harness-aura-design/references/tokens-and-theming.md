# Tokens og temaer

## Tre lag

1. **Brandinput:** organisationens farver, fontfamilier og radius fra det godkendte brandkort.
2. **Semantiske tokens:** `--bg`, `--surface`, `--surface-2`, `--line`, `--ink`, `--muted`, `--primary`, `--primary-text`, `--text-on-primary`, `--accent`, `--focus`, `--ok`, `--warn`, `--danger` og afstands-/typografiskala.
3. **Komponenter:** bruger tokenværdier frem for gentagne brandfarver i CSS.

Ét nyt brand bør i videst muligt omfang ændre tokenlaget frem for hver komponent. Undtagelser skal beskrives. Eksisterende brugeraccept og projektets designsystem går forud for starteren.

## Farve og tekst er forskellige roller

- Bevar den valgte brandfarve som `--primary` i lyst tema. En nødvendig mørk variant er en afledt UI-farve, ikke en ændring af logoet.
- Brug `--primary-text` og `--accent-text` til links og aktiv tekst, når brandets rå farve ikke kontrasterer tilstrækkeligt med baggrunden.
- Knapper skal have særskilte tekstfarver: `--text-on-primary`, `--text-on-primary-hover`, `--text-on-accent`, `--text-on-accent-hover`, `--text-on-danger` og `--text-on-danger-hover`. Hvid er ikke automatisk en sikker farve på en rød knap.
- Status skal også have tekst eller ikon. Farve alene er utilstrækkelig.
- Fokusmarkering skal være synlig på den faktisk tilstødende baggrund. Mål den renderede markering; en målt tokenfarve blandet med gennemsigtighed har en anden kontrast.

Offline-generatoren i `token-generator.md` måler kun de kontrastpar, dens rapport nævner. Det omfatter ikke alle komponenter, illustrationer, billeder, transparens, overlays eller tilstande i den færdige app. En rapport er ikke en WCAG-garanti, og reglerne for tilladelig stor tekst kan ikke antages ud fra en brandfarve.

## Mørkt tema

Afled rolige mørke flader frem for at invertere hele siden. Giv `body` eksplicit baggrund og tekstfarve. Respektér et gemt brugervalg og brug systemtema som neutral fallback i nye apps, medmindre brugeren har valgt en anden standard. Dette ændrer ikke værtsappen Auras eksisterende tema eller brugerindstillinger.

```css
:root { color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* De godkendte mørke tokens */ }
}
:root[data-theme="dark"] { color-scheme: dark; }
:root[data-theme="light"] { color-scheme: light; }
```

Et farvet headerbånd skal også have målt tekstkontrast i begge temaer. Lad ikke almindelige navigationslabels arve en undtagelse for stor tekst. En negativ logoversion vælges med en lokal godkendt fil; flerfarvede logoer inverteres ikke.

## Typografi, afstand og bevægelse

- Brug højst én brødtekstfamilie og én evt. displayfamilie; mono er en særskilt rolle til kode/tal.
- Brødtekst typisk mindst 16 px, læselig linjeafstand og omkring 68 tegn pr. linje. `clamp()` kan skalere overskrifter, men må ikke forhindre zoom.
- Tal, som skal sammenlignes, får `font-variant-numeric: tabular-nums` og dansk `Intl`-format, når målgruppen er dansk.
- Brug en sammenhængende afstandsskala, fx 4/8/12/16/24/32/48/64 px, og følg organisationens radius i stedet for tilfældige afrundinger.
- Sigt efter generøse klikflader, fx 44 px. Den konkrete tilgængelighedsvurdering skal også omfatte afstand og alternative handlinger.
- Hold animationer korte og funktionelle. Slå dekorativ bevægelse fra ved `prefers-reduced-motion`; bevar information om fokus, valgt tilstand og igangværende arbejde.

## Ændringer i tokens

Valider farver, fontnavne og præcis tre ikke-negative radiusværdier, før kode genereres. Interpolér ikke usanitiseret sideindhold i CSS. Gem både input og den faktiske kontrastoversigt lokalt under projektets dataregler. Lad ikke automatiske brandgæt eller en generator erstatte brugerens godkendelse af designet.
