# Designretninger med Aura-fundament

Denne reference gælder kun brugerens genererede app og kun inden for den konkret godkendte opgave. Den ændrer ikke værtsappen Aura, dens onboarding, planer eller godkendelser.


## Indhold

- Valg og afgrænsning
- Opskrifter til leverancer
- Katalog: 43 retninger
- Effekter og implementering
- Kilder og rettigheder

## Valg og afgrænsning

Læs efter brand discovery, før tokens og implementering. Kataloget forbinder navnene fra SkillsUI med **egne Aura-vurderinger** af anvendelse og begrænsninger. Det er hverken deres skill-filer, identiske implementationer eller 43 færdige temaer.

1. Fastlæg opgaven: læse, finde, indtaste, sammenligne, beslutte eller opleve.
2. Kontrollér brand, scope og eventuel DKFDS-brug i BRAND.md.
3. Vælg én primær retning, som hjælper opgaven, og højst ét supplerende greb. Et sektionslayout som Bento eller en baggrundseffekt tæller som et greb.
4. Behold identitetsfarver, fontlicenser, logo, tokens og komponentadfærd. Indfør ikke en ny palette, fordi inspirationssiden viser den.
5. Beskriv både hvad der lånes og hvad der udelades. Vælg en anden retning, hvis de centrale greb ikke passer til kravene.

Katalogets kategorier er anbefalinger, ikke nye kravniveauer:
- **Basis:** mulig primær retning til en arbejdsapp efter brandtilpasning.
- **Tilpas:** kræver afgrænsning og ekstra kontrast-/brugbarhedskontrol.
- **Formidling:** udvalgte landingssider, slides, kultur-/læringsflader eller kampagner, når brandet tillader det; ikke standard i sagsbehandling eller selvbetjening.
- **Effekt:** dekorativt supplement til en afgrænset formidlingsflade; aldrig nødvendig betjening.

## Opskrifter til leverancer

| Leverance | Primær retning | Muligt supplement | Aura-tilpasning |
|---|---|---|---|
| Medarbejderapp / desktopværktøj | Clean eller Modern SaaS | Ingen nødvendig | Opgaveoverskrift, tydelig arbejdsflade, én primær handling. |
| Analyse-/ledelsesdashboard | SaaS Dashboard | Ingen nødvendig | Ét prioriteret nøgletal, periode og kilde, tilgængelig tabel. |
| Budget-/økonomioverblik | Fintech Dashboard | Ingen nødvendig | Lån taldisciplin; undlad finansbranding, betalingskort og unødvendig glød. |
| Aura-/AI-arbejdsrum | Clean eller AI SaaS | Atlas-panelmønster | Kilder, datagrænser, annullering og avancerede muligheder; læs agent-workspaces.md. |
| Borgerrettet selvbetjening | DKFDS, når relevant | Ingen ekstern komponentstil | Behold designsystemets formularer, feedback og navigation. |
| Projektside / produktoversigt | Modern SaaS | Bento i én sektion | Vis løsningen i brug, og vægt indhold efter betydning. |
| Artikler / faglig formidling | Minimal Serif | Bento ved korte overblik | Godkendt displayfont, læsbar brødtekst, rolig læserækkefølge. |
| Eventslides / intro | Studio eller Dark Luxury | Én rolig baggrundseffekt | Scenemotor, rolig tekstzone og statisk alternativ. |

### Gør de almindelige retninger konkrete

- **Clean:** vis hierarki gennem afstand og typografi. Brug luft eller linjer mellem sammenhængende sektioner frem for at indramme alt.
- **Modern SaaS:** gentag kontrolhøjder, grid og tilstande på tværs af flows. Skab særkende gennem afsenderen og opgaven.
- **Minimal Serif:** brug den godkendte displayfont til overskrifter og en rolig UI-font til labels. Veksl mellem tekst, illustration og luft, når indholdet kræver det. Stilen kræver ikke et nyt fontvalg eller lyst tema.
- **Bento Grid:** giv hvert felt ét budskab og en tydelig prioritet. Størrelse skal afspejle betydning. Bevar DOM-rækkefølgen på mobil, og hold sekventielle formularer udenfor.
- **Dashboard-retninger:** gruppér efter brugerens beslutning. Vis enhed, periode, kilde og opdatering. Skeln mellem manglende data og nul; lad betydning bestemme farverne.
- **Dark Luxury / AI SaaS:** lån hierarki og diskret, reel statusfeedback. Brug Aura-genererede mørke tokens og korrekt logoversion, når mørkt tema indgår; påtving ikke mørkt tema eller en fremmed palette.

## Katalog: 43 retninger

Navne og numre refererer til SkillsUIs offentlige katalog, set 23. oktober 2026. Anvendelse og grænser er egne Aura-anbefalinger. Featured fremhæver eksisterende poster og tælles ikke igen.

| Nr. | Navn i kilden | Brug | Aura-anvendelse og grænse |
|---|---|---|---|
| 01 | Clean | Basis | Rolige arbejdsflader; giv hovedopgaven reel vægt. |
| 02 | Glassmorphism | Tilpas | Chrome/overlays; opak baggrund og fallback bag læsetekst. |
| 03 | Neobrutalism | Formidling | Kampagnestruktur; behold brandets former og klikflader. |
| 04 | Dark Luxury | Tilpas | Arbejdsro med genererede mørke tokens og kontrolleret logo. |
| 05 | Neumorphism | Tilpas | Kun pynt; kontroller skal have målbare kanter og fokus. |
| 06 | Modern SaaS | Basis | Sammenhæng mellem navigation, formularer og tilstande. |
| 07 | Retro / Y2K | Formidling | Relevant målgruppe; nutidig tastaturbetjening består. |
| 08 | Minimal Serif | Basis | Læsning; begræns displaygreb i tætte arbejdsflows. |
| 09 | Bento Grid | Formidling | Sektionslayout; visuel rækkefølge følger DOM. |
| 10 | Liquid Background | Effekt | Introduktion med statisk tokenflade som alternativ. |
| 11 | Light Ripple | Effekt | Hold bevægelse væk fra læsetekst og felter. |
| 12 | Shader Lines | Effekt | Statisk alternativ på svag hardware. |
| 13 | SaaS Dashboard | Basis | Prioritér beslutninger frem for antallet af KPI-kort. |
| 14 | Crypto | Formidling | Evt. teknisk struktur; ingen irrelevant finansassociation. |
| 15 | Terminal | Tilpas | Tekniske målgrupper; klarsprog og almindelige kontroller. |
| 16 | Matrix | Formidling | Tema/intro; ingen konstant bevægelse i arbejdsflader. |
| 17 | Cozy | Formidling | Læring/kultur; tydelige interaktionssignaler. |
| 18 | Kawaii | Formidling | Afstem med målgruppen; undgå barnliggørelse af myndighedskontakt. |
| 19 | Claymorphism | Formidling | Illustration og funktion adskilles; dybde erstatter ikke kontrolkanter. |
| 20 | AI SaaS | Tilpas | Reelle AI-tilstande, kilder og datagrænser. |
| 21 | Fintech Dashboard | Tilpas | Taldisciplin; kommunale data kræver ikke betalingskort. |
| 22 | Cyber Brutalism | Formidling | Tekniske events; store overskrifter skal reflowe. |
| 23 | Jarvis | Tilpas | Specialistværktøj ved behov; ingen falske alarmer/live-data. |
| 24 | Art Deco | Formidling | Kultur/event; respektér frizone og brandets typografi. |
| 25 | Mech | Tilpas | Teknisk struktur; ingen fiktive statusaflæsninger. |
| 26 | Memphis | Formidling | Mønstre i billedzoner, aldrig bag formulartekst. |
| 27 | Deep Space | Tilpas | Rolige specialistvisninger med læsbare data. |
| 28 | Vaporwave | Formidling | Relevant tema; behold brandets farver og målte tekstflader. |
| 29 | Cyberpunk | Formidling | Oplevelsesflader uden flimren eller påtvungen støj. |
| 30 | Bauhaus | Formidling | Lån komposition; erstat ikke identiteten med en standardpalette. |
| 31 | Pixel Art | Formidling | Pixelillustration, almindelig læsbar UI-tekst. |
| 32 | Aurora Background | Effekt | Brandafledt hero/slidelag med opak tekstzone. |
| 33 | Cosmic Meteor Background | Effekt | Eventintro med pause og statisk alternativ. |
| 34 | Falling Colors | Effekt | Korte oplevelser; dekorative farver må ikke ligne status. |
| 35 | Interactive Constellations | Effekt | Cursorrespons må ikke bære nødvendig information. |
| 36 | Shooting Stars | Effekt | Ingen kamerarystelser i arbejdsapps; statisk alternativ. |
| 37 | Maximalism | Formidling | Struktur og enkel navigation består i ekspressive kampagner. |
| 38 | Fitness Dashboard | Tilpas | Relevante datamønstre; sundhedsdata følger eksisterende scopekrav. |
| 39 | Crypto Dashboard | Tilpas | Tekniske målinger; ingen irrelevante handelsmetaforer. |
| 40 | Radial Glow | Effekt | Må ikke forveksles med rigtig indlæser eller status. |
| 41 | Studio | Formidling | Projekt og afsender i fokus; ro omkring læseindhold. |
| 42 | Cinematic Scroll | Effekt | Almindeligt scroll, tastatur og statisk alternativ. |
| 43 | Hand Drawn | Formidling | Illustrationer til varme; entydige felter og klikflader. |

## Effekter og implementering

- Farver og fonte kommer fra brandet og tokeninputtet. Nye nødvendige farvepar genereres og måles i tokenlaget; ingen nye hex-værdier i komponent-/brand-/design-CSS.
- Behold tekst, formularer og vigtige tal på kendte, opake tokenflader. Ved transparens: test værste baggrund, ikke ét frame. Sørg for opak fallback ved manglende blur og fungerende kontroller i forced colors.
- Dekoration får `aria-hidden="true"`, `pointer-events: none` og ingen tab-stop. Ingen betydning kun i effekten.
- Brug højst ét vedvarende dekorativt bevægelseslag. Stop ved reduced motion, skjult dokument og uden for viewport. Giv pause/stop ved automatisk bevægelse over fem sekunder. Ingen blink eller lysglimt.
- Foretræk CSS/SVG frem for tunge afhængigheder. Video/WebGL kræver et konkret behov og statisk fallback; navigation og læsning virker uden effekten.
- Brug scenemotoren til slides/introer. En almindelig landingsside skal reflowe; læg ikke dens tekst/formularer på en nedskaleret 1920×1080-flade.
- Indfør ikke fiktive live-signaler, resultater, anmeldelser eller partnerlogoer for at fylde et layout. Mærk eksempler tydeligt.

layout-eksemplet i `starter-design-css.md` giver egne kompositionsgreb til `clean`, `modern-saas`, `editorial`, `dashboard` og `workspace` plus `.page-heading`, `.split-layout`, `.metric-grid` og `.bento`. Aktivér kun den valgte opskrift med `data-design` på html; tilføj klasser efter indholdet. Ingen opskrift vælger farver, fonte eller tema. Resten af kataloget er vejledning, ikke CSS-implementationer.

## Kilder og rettigheder

Kildeskillens dokumenterede inspirationskilder, angivet som læst 23. oktober 2026:
- Katalog/stilnavne: https://www.skillsui.app/skills
- Uddybning: https://www.skillsui.app/skills/clean · https://www.skillsui.app/skills/modern-saas · https://www.skillsui.app/skills/minimal-serif · https://www.skillsui.app/skills/bento-grid · https://www.skillsui.app/skills/dark-luxury · https://www.skillsui.app/skills/glassmorphism · https://www.skillsui.app/skills/fintech · https://www.skillsui.app/skills/saas-dashboard · https://www.skillsui.app/skills/ai-saas
- Vilkår: https://www.skillsui.app/terms

Kildeskillen angiver, at SkillsUIs vilkår ikke tillader videredistribution af downloadbare skill-filer uden tilladelse. Gratis adgang er ikke en open source-licens. Ingen af deres skill-/kodefiler, heller ikke Pro-filer, er hentet eller indlejret her. Dette er egne formuleringer og Aura-tilpasninger under repoets EUPL-1.2; SkillsUIs materiale er ikke omfattet af den licens. Kontrollér rettighederne igen før en senere import af konkrete filer.
