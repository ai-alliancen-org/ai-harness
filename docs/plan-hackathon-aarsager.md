# Plan: de tretten grundårsager fra hackathonen

Grundlaget er [årsagsdokumentet](hackathon-aarsager.md). Dette er rækkefølgen, afhængighederne og den vagt, der skal bevise hver rettelse. Intet herfra er bygget endnu.

**Slutmål:** Aura spørger kun ved reelle grænseoverskridelser og husker svarene, holder AI'en i projektmappen, mister ikke planer, overlever en forbigående udbyderfejl, og viser AI'en resultatet af sit eget arbejde.

## Hvorfor planen findes

De 27 overtagne bidrag var funktioner. De tretten grundårsager er noget andet: Auras opsætning oven på motoren. Målt 31. oktober 2026 på den udgivne 0.7.0-beta.1:

| # | Grundårsag | Status | Bevis |
|---|---|---|---|
| 1 | Spørger om alt, husker ikke svarene | **åben** | `describe()` giver `label: "Denne handling"`, `persistable: false`, `folder: null` |
| 2 | Sender AI'en ud af projektmappen | **åben** | `parentDir` findes ikke i produktkoden; `approvals-policy.cjs:102` læser `metadata.path` |
| 3 | Planer forsvinder | **åben** | `ui/app.js:831` rydder `activePlan` i Planlæg |
| 4 | Motoren genstartes, samtalen glemmes | **åben** | #58 løser det, ikke overtaget |
| 5 | Én udbyderfejl stopper opgaven | **åben** | `gateway.cjs:64` gør 429 til et stop, ikke et genforsøg |
| 6 | React og servere når ikke forhåndsvisningen | **delvis** | #25 dækker kun scriptet præcis `vite` / `astro dev` (`dev-server.cjs:51`). Scripts med flag, og tjenestestien, bruger en tilfældig port (`dev-server.cjs:298`). Intet AI-kaldbart værktøj. |
| 7 | AI'en bygger i blinde | **delvis** | Kontrollen kører igen, men resultatet når ikke modellen: `app.js:1919` sluger fejlen, og prompten læser ikke Aktivitet. *Hypotesen om at modellen bygger bedre med resultatet er ikke målt.* |
| 8 | Prompten er stor og skubber mod proces | **delvis** | Grundreglerne står to gange: `projects.cjs:59-60` skriver dem til AGENTS.md, og `chat-session.cjs:42` sender dem med. Stien står efter hele `composeAppContext` (`chat-session.cjs:428`). Størrelsen 39.741 tegn er *ikke* genfundet; frisk Byg-kald er ca. 17.400 tegn, med kopien ca. 22.200. |
| 9 | Kommandosandkassen: ét klik ændrer alt | **åben** | Bekræftet ved kodelæsning: `chat-session.cjs:228` (sandkassen tændes af en bash-regel), `approvals-policy.cjs:155-157`. "Godkend alt" findes kun i beslutningsloggen. Læst, ikke kørt. |
| 10 | Nøgler renses ikke, fejl peger forkert | **delvis** | nøglevinduet renser og kontrollerer; fælles rensefunktion mangler |
| 11 | CLI'en | **åben** | Nøglering er ikke implementeret: `cli/storage.cjs:47-48` bruger en adgangssætning. Region vises ikke i login. CLI er en separat udgivelsesstrøm, men deler kernen i `desktop/core`. |
| 12 | komplai Run siger "Udgivet" for tidligt | **åben** | "Udgivet" er komplais egen state. Adressen kontrolleres hvert 30. sekund, men kun når Deling er slået til og vinduet er synligt (`deployment-setup.js:328`, `deployments.cjs:157-162`). Grønt kommer først efter udbyderkontrol (`share-view.js:54`). |
| 13 | Ikke prøvet ende til ende | **delvis** | tre røde suiter grønne 31. okt.; grænse for antal kort mangler |

## Rækkefølge

Trin 1-5 er det, en bruger mærker. Trin 3 har en låst rækkefølge: prøven før rettelsen.

1. **Overtag #58.** Lukker nr. 3 og 4. Diffen bevarer planen med `planRetained` og genopretter sessionen uden at sende beskeden igen.
2. **Overtag #56.** Én liste over beskyttede filstier på tværs af motorens læseregler, filgodkendelser, sandkasse, ændringsoversigt, Git og eksport. Grundlag for nr. 1 og 2.
3. **Godkendelserne genkender motorens rigtige former.** `approvals-policy.cjs` skal læse `metadata.parentDir` og `filepath`. **Kontraktprøvens del 2 skrives først og skal fejle på nuværende kode.** Fixtures findes i `desktop/tests/fixtures/opencode-1.18.33/`.
4. **AI'en holdes i projektet.** Arbejdsfiler til `.aura/tmp/<opgave>`, som også bliver `TMPDIR`/`TEMP`/`TMP`. Skrivning uden for projektet nægtes i Byg med en besked til AI'en. Korttitlerne skelner "skrive" fra "se".
5. **Forbigående udbyderfejl stopper ikke opgaven.** `gateway.cjs` lader 429 og 5xx gå tilbage som genforsøg i stedet for `engine.error`.
6. **Kommandosandkassen lagt om**, og "Godkend alt" bygget på den nye godkendelsesmodel. Dette låser resten af nr. 1 op.
7. **Nr. 6, 7 og 8:** eget værktøj til at starte forhåndsvisningen gennem Auras DevServer med status og maskeret log; resultatet af kontrollen går til modellen; grundreglerne skrives kun én gang. **Forudsætning:** at resultatet går til modellen ændrer en besluttet adfærd (`decisions.md:158`), og skal derfor først godkendes af brugeren. Måling først: en ren opgave med og uden resultatet.
8. **Nr. 10, 11 og 12:** fælles rensefunktion i `core/connections.cjs`; CLI'ens login og nøglering; samme udgivelsesmodel for Promte og GitHub Pages.

## Vagter

Hver rettelse skal have en prøve, der **fejler før den**. To er allerede identificeret:

- **Kontraktprøvens del 2** (nr. 1 og 2). Del 1 findes og beskriver kun, hvad motoren sender. Del 2 prøver Auras fortolkning af de samme optagede forespørgsler.
- **Grænse for antal kort** (nr. 13). En ende-til-ende-prøve med en typisk byggeopgave, der fejler, hvis antallet af godkendelseskort overstiger en grænse. Målt udgangspunkt: et byggeforløb på 26 trin gav 28 godkendelser, heraf 13 med teksten "Denne handling".

## Uden for planen

- **#55 og #57** flettes ikke først. De er erklærede udkast, som appen ikke kalder: tilsammen 1577 linjer uden virkning.
- **#53 og #54** er funktioner, ortogonale til grundårsagerne. Kan tages når som helst.

## Huller i denne plan

Disse mangler undersøgelse, før de kan bygges: nr. 8 (promptens faktiske størrelse og hvad der kan skæres), nr. 11 (CLI'ens tilstand efter pausen) og nr. 12 (hvorfor komplai Run melder for tidligt). Nr. 6, 7 og 9 har anbefalinger i årsagsdokumentet, men ikke en gennemgang af den nuværende kode.

## Rettelser til undersøgelsen 1. november

Seks agenter undersøgte nr. 6, 7, 8, 9, 11 og 12, og seks skeptikere angreb konklusionerne. Fire citater var forkerte og er rettet ovenfor:

- **Nr. 7:** skærmbilledesætningen står i `profiles/skills/harness-design-og-tilgaengelighed/SKILL.md:45` og er *betinget* af, at værktøjet kan tage skærmbilleder. Den kræver ikke en kontrol, AI'en mangler. Referencelinjerne er `:23-26`, ikke `:31-33`.
- **Nr. 8:** årsagsdokumentets størrelse og planens tre forekomster blev ikke genfundet. Det står nu som *ikke målt*.
- **Nr. 12:** undersøgelsen sagde, at ingen automatisk adressekontrol findes. Den findes, men den er betinget. Det var en fejl i undersøgelsen.
- **Nr. 11:** planen havde CLI både som "sat på pause" og som trin 8. Det er nu afklaret som en separat strøm.

**Prøver:** de foreslåede prøver er ikke kørt. Hver skal fejle før rettelsen, og de skal skrives ind i planens trin, ikke bruges som bevis.

**Beslutninger, der skal tages af brugeren:**
1. Må resultatet af forhåndsvisningskontrollen gå til modellen? Det ændrer `decisions.md:158`.
2. Må AI'en starte forhåndsvisningen, og må et samtykke huskes? Det er ny adfærd (`decisions.md:385-387` dækker kun OpenCode-kommandoer).
3. Hvem kontrollerer komplais adresse, og med hvilket interval? Det er et produktvalg.
4. Må AI'en bruge Tailwind, webskrifter og eksterne billeder? Reglen står i `project-guidance.cjs:25`, men listen mangler.
