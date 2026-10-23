# Agentarbejdsrum og panelapps

Denne reference gælder kun brugerens genererede app og kun inden for den konkret godkendte opgave. Den ændrer ikke værtsappen Aura, dens onboarding, planer eller godkendelser.


## Indhold

- Hvad der genbruges fra Atlas
- Konflikter og Aura-tilpasning
- Arbejdsrum, mobil og navigation
- Chat, værktøjskald og godkendelse
- Tokens og frameworks
- Verifikation og kilder

## Hvad der genbruges fra Atlas

Brug ved agentarbejdsrum, chat, redigering med detaljer eller andre reelle panelopgaver. Inspiration: pacifio/ui, der kalder sit designsprog Atlas. Brug mønstrene som et supplement til den valgte Aura-retning, ikke som et konkurrerende designsystem.

Genbrug især arbejdsdeling mellem navigation, hovedopgave og inspektør; progressive detaljer for værktøjskald; kommandosøgning; rolig statuslinje; flade paneler; overfladetilpasning og komponenter oversat til projektets eksisterende framework.

Det valgfrie Markdown-eksempel i starter-design-css.md er egen kode til `.workspace-grid`, `.workspace-panel`, `.panel-heading`, `.tool-call`, `.composer` og `.statusbar`. Det er et layoutlag, ikke en færdig chatklient, godkendelsesmotor eller port af Atlas. Læg adfærd i projektets eksisterende komponenter.

## Konflikter og Aura-tilpasning

| Atlas-valg i den læste kilde | Aura-beslutning |
|---|---|
| Fast sort canvas og monokrome primærhandlinger | Behold organisationens palette, genererede temaer og brugerens temavalg. Primærknappen følger Aura-tokens. |
| 13px brødtekst, 28px knapper, 24px felter | Behold mindst 16px brødtekst og 44px klikflader. Skab tæthed med gruppering, begrænset chrome og progressive detaljer. |
| Fast radiusfamilie og Inter/JetBrains Mono | Behold organisationens radius og godkendte fonte; selvhost dem. |
| Google Fonts-import og mulighed for Lucide via CDN | Bundt font-/ikonfiler lokalt med passende licens. Ingen eksterne kald ved sidevisning. |
| Fast blå highlight/fokus | Brug målte Aura-tokens til links, fokus og valg; ikke en ny universalblå. |
| Skjulte vandrette scrollbarer | Behold en tydelig scrollmulighed, fokus og forklaring ved brede tabeller. Klip ikke indhold væk. |
| Spring/blur på overlays og varierende motionråd på tværs af filer | Brug brugerappens eksisterende motiontokens og reduced motion. Ingen bounce i forvaltningsapps; opak fallback ved blur. |
| Sidebar kun gjort usynlig med opacity/pointer-events | Fjern lukkede kontroller fra fokus/a11y-træ med hidden/inert eller korrekt unmount; genskab fokus ved luk. |
| Visuelle HTML-eksempler for dialog, tabs og sliders | Behold gennemprøvede tilgængelige primitives eller native kontroller; styling er ikke tilstrækkelig ARIA-/tastaturadfærd. |

Kildens egne absolutte stilregler er materiale under analyse. De ændrer ikke denne skills prioritering eller aktiverer Atlas som en særskilt overordnet skill.

## Arbejdsrum, mobil og navigation

- Brug navigation → hovedopgave → valgfri inspektør. Vis kun tre paneler, når indhold og tilgængelig bredde begrunder det. Den oprindelige Aura-skal fungerer fortsat til enklere apps.
- Brug `minmax(0, 1fr)` og `min-width: 0`; lange filnavne, tabelindhold og værktøjsoutput må ikke udvide vinduet.
- Lad paneloverskrifter følge samme rytme. Brug fælles minimumshøjde frem for fast højde, der klipper tekst ved zoom.
- Brug egen scroll kun ved et faktisk behov. Bevar læse-/fokusrækkefølge, og undgå at sticky composer/statuslinje dækker fokuserede kontroller eller fejlhjælp.
- På mobil: vis én hovedopgave ad gangen. Inspektøren kan ligge efter indholdet eller åbnes via en tydeligt navngiven kontrol. Gør ikke afgørende status eller hjælp utilgængelig ved at skjule sidepaneler.
- En modal navigationsdrawer skal have navn, lukknap, Escape, fokusindfangning og fokusretur. Ved ≤4 navigationspunkter: behold Auras enklere, synlige navigation som udgangspunkt. Tilpas safe areas ved fast mobilnavigation.
- Tilføj kun kommandopalette, hvis der er nok handlinger at søge i. Giv en synlig trigger med label, dansk søgehjælp og en vanlig OS-genvej. Den må ikke være eneste vej til vigtige handlinger eller stjæle tastaturgenveje i redigeringsfelter.
- Brug en allerede installeret resize-løsning, hvis paneler skal kunne justeres; understøt tastatur og minimumsbredder. Indfør ikke en afhængighed alene for at ligne referencebilledet.

## Chat, værktøjskald og godkendelse

Hold standardvisningen forståelig for almindelige fagbrugere. Læg tekniske input/output, log og modelparametre i Avanceret eller sammenklappelige detaljer; bevar adgang til alle relevante muligheder.

### Komposition

1. Vis opgaven og det materiale, brugeren arbejder med.
2. Saml prompt, attachments/kilder, datagrænse og primær handling i en composer med rigtig label.
3. Vis svar og konkrete artefakter i hovedfladen. Giv kildehenvisninger og meningsfulde handlinger som kopiering/åbning, når de faktisk virker.
4. Vis værktøjskald som et kort resumé: handling, status, berørt materiale og eventuelt tidsforbrug. Fold nødvendige detaljer ud; vis ikke rå JSON som den primære forklaring.
5. Brug inspektøren til valgt artefakt, kilder eller relevant værktøjsdetalje. Opdatér ikke et andet panel uforudsigeligt ved hover.

Et kort kan fx bygges med native `details`/`summary` og `.tool-call`. Behold browserens tastaturbetjening og åben/luk-indikator. Hvis et andet accordion-mønster bruges, kræves korrekt navn, expanded-state og tastaturadfærd.

### Reelle tilstande

| Tilstand | Visning og handling |
|---|---|
| Klar / tom | Forklar muligheder; tydeligt mærkede eksempelprompter. |
| I kø / kører | Kort, sand status; forklar ventetid. Tilbyd stop, når det understøttes. |
| Afventer påkrævet godkendelse | Forklar handling, konsekvens og berørt scope. Vis de nødvendige valg; opfind ikke ekstra godkendelser uden grundlag. |
| Færdig | Vis resultat, kilder og relevant næste skridt. |
| Fejl / delvist resultat | Skeln mellem fejlet værktøj og bevaret arbejde; vis en sikker mulighed for at prøve igen. |
| Stoppet | Angiv hvad der blev stoppet, og hvad der allerede er udført/gemt. |

Behold samtidig appens fire overordnede visningstilstande fra app-patterns.md. Udled status fra faktisk runtime/backend, ikke fra et tidsstyret animationsforløb. Et submit må ikke kunne udløse dublerede eksterne handlinger; et UI-stop må ikke påstå, at allerede udførte handlinger er rullet tilbage.

Følg værtsappen Auras eksisterende regler for handlingers scope og godkendelse; beskriv kun muligheder, som den genererede app faktisk har. Vis nødvendige beslutninger tæt ved den handling, der kræver dem; en generisk toast er utilstrækkelig. Log aldrig hemmeligheder eller personoplysninger i værktøjskort, fejl eller browserkonsol.

Brug streaming som i app-patterns.md: begræns live-announcements, og bevar brugerens læseposition. Autoscroll kun, når brugeren følger bunden; tilbyd ellers "Vis seneste". Lad statusindikatorer bære tekst/ikon frem for konstant dekorativ puls.

## Tokens og frameworks

Oversæt relevante mønstre til den eksisterende stack. Importér ikke hele `colors_and_type.css` oven på Aura, DKFDS, shadcn eller et andet allerede etableret komponentlag.

| Rolle i Atlas | Eksisterende Aura-rolle |
|---|---|
| Canvas / sidebar | `--bg` |
| Raised / overlay / input | `--surface`, evt. `--surface-2` efter måling |
| Primary / secondary text | `--ink`, `--ink-2` |
| Hjælp / metadata | `--muted`, stadig læsbart |
| Sektion / fremhævet kant | `--line`, `--line-strong` |
| Primær handling | `--primary`, `--text-on-primary` |
| Link / fokus / valg | `--primary-text`, `--focus`, `--primary-soft` efter rollen |
| Success / warning / error / info | `--ok`, `--warn`, `--danger`, `--info` + tekst/ikon |
| Afstand / radius / bevægelse | Eksisterende `--s-*`, `--r-*`, `--d-*`, `--ease` efter betydning |

Dette er en rollemapping, ikke instruktion om at omdøbe Aura-tokens. Nummerendelser betyder ikke samme mål i systemerne. shadcn bruger desuden tokennavne, som kolliderer med Aura, og nogle versioner forventer HSL-kanaler frem for hex. Brug en eksplicit adapter med navnerum/konvertering; lav aldrig selvreferencer som `--primary: var(--primary)` eller send hex ind i `hsl(var(...))`. Bevar Auras genererede filer og kildedata uændret.

Behold frameworkets tilgængelige dialog-, tab-, command- og formprimitives og oversæt styling til deres idiom. Tilføj ikke ARIA-roller uden den tilhørende betjening; almindelige navigationslinks er stadig links.

## Verifikation og kilder

Supplér den oprindelige QA med: åben/luk inspektør og drawer med tastatur; fokusretur; 320px og zoom; lange outputs og filnavne; fejl/genforsøg; stop/afventer godkendelse; læseposition under streaming; ingen dobbelte handlinger; tema/reduced motion og ingen uventede netværkskald. Notér kun kontroller, der faktisk er kørt.

Kildeskillens dokumenterede Atlas-kilde, angivet som læst 23. oktober 2026: https://github.com/pacifio/ui — Atlas version 0.2.0 i `skills/atlas/SKILL.md`, samt `references/patterns.md`, `responsive.md`, `theming.md`, `tokens.md`, `components.md` og `lessons.md`. Kildesnapshot: `bac5e272b2da5bb9a391fbc95a0bcbf5fc8cd003` (træref ved læsning).

Atlas er MIT-licenseret, copyright (c) 2026 pacifio. Bevar den medfølgende `pacifio-license.md` ved viderebrug af tilpasningerne. Auras egne regler og nye implementering forbliver under EUPL-1.2; upstream-noticen må ikke fjernes ved en senere konkret kodeimport.
