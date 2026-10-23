# Skills i Aura Harness 0.2.1

Genereret fra `profiles/catalog.json` af `scripts/build-packages.cjs`. Ret kataloget eller skillfilerne, ikke denne fil.

Aura Harness indeholder fælles grundregler og 13 skills samt fire integrationer. Grundreglerne gælder altid. En skill er en kort vejledning til kodeagenten om én arbejdsopgave, som bruges, når opgaven passer. En integration er en skill om ét bestemt system, fx et offentligt register. Integrationerne følger ikke med pakkerne til kodeværktøjerne; de vælges til for de systemer, man bruger. I Aura-appen kan kategorier, enkelte skills og integrationer slås til og fra.

## Grundregler · altid med

Grundreglerne gælder i hele projektet og kan ikke fravælges. De står i [grundregler.md](grundregler.md).

## Planlægning og design

Afklar idéen, forstå et eksisterende projekt, og vælg teknologi og design.

### Idé og afgrænsning

`harness-ide-og-afgraensning` · [SKILL.md](skills/harness-ide-og-afgraensning/SKILL.md)

**Hvad gør den?** Hjælper dig og agenten med at blive enige om opgaven: hvem løsningen er til, hvad den skal kunne, hvilke data den bruger, og hvad der ikke er med. Agenten stiller kun de spørgsmål, der ændrer et væsentligt valg, og skriver resten som antagelser, du kan rette.

**Hvornår bruges den?** Når du starter et nyt projekt, beskriver en ny funktion, eller når en opgave skifter retning undervejs.

**Hvad får du?** En kort opgavebeskrivelse med acceptkriterier, du selv kan afprøve, gemt i projektet, fx i docs/opgave.md.

**Hvad gør den ikke?** Den vælger ikke teknologi og skriver ikke kode. Den afgør heller ikke, om en behandling af personoplysninger er lovlig.

### Eksisterende projekt

`harness-eksisterende-projekt` · [SKILL.md](skills/harness-eksisterende-projekt/SKILL.md)

**Hvad gør den?** Agenten gennemgår projektet uden at køre kommandoer: instruktioner, teknologi, låsefiler, start- og testkommandoer, Git-status, CI og hosting. Derefter får du en kort oversigt og forslag, der passer til projektet.

**Hvornår bruges den?** Når du åbner et projekt første gang, overtager det fra andre eller vil tilføje Aura Harness til et projekt, der allerede findes.

**Hvad får du?** Et overblik over projektet med kendte risici og usikkerheder samt forslag med præcise filændringer, som du selv vælger imellem.

**Hvad gør den ikke?** Den skifter ikke teknologi, pakkehåndtering eller Git-model, og den rydder ikke op med reset, rebase eller force-push.

### Arkitektur og teknologi

`harness-arkitektur-og-teknologi` · [SKILL.md](skills/harness-arkitektur-og-teknologi/SKILL.md)

**Hvad gør den?** Hjælper med de valg, der er svære at lave om senere: platform, framework, datalagring, backend, login og hosting. Agenten foreslår ét begrundet valg, nævner relevante alternativer og forklarer konti, udgifter, drift og hvor data behandles. I offentlige organisationer peger den på genbrug gennem OS2, login med MitID og fælles registre.

**Hvornår bruges den?** Når et nyt projekt skal have sin første opsætning, eller når en opgave kræver en ny tjeneste, database, login eller hostingløsning.

**Hvad får du?** En anbefaling med begrundelse, alternativer, konsekvenser og de godkendelser, der skal på plads, før noget oprettes.

**Hvad gør den ikke?** Den opretter ingen konti, tjenester eller betalte ressourcer og skifter ikke teknologi i et eksisterende projekt uden en grund.

Kilder: [React om at oprette en ny app](https://react.dev/learn/creating-a-react-app), [Astros anvendelsesområde](https://docs.astro.build/en/concepts/why-astro/), [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict), [OS2](https://www.os2.eu/), [Lov om MitID og NemLog-in](https://www.retsinformation.dk/eli/lta/2025/333), [Vejledning om open source i den offentlige sektor](https://arkitektur.digst.dk/Vejledning-om-brug-af-open-source-i-den-offentlige-sektor)

### Design og tilgængelighed

`harness-design-og-tilgaengelighed` · [SKILL.md](skills/harness-design-og-tilgaengelighed/SKILL.md)

**Hvad gør den?** Hjælper med et sammenhængende design ud fra kommunens designsystem eller dine referencer og kontrollerer tilgængelighed: tastatur, fokus, kontrast, fejlbeskeder, overskrifter og små skærme. Den bygger efter WCAG på niveau AA og minder om tilgængelighedserklæringen, som offentlige websteder og apps skal have.

**Hvornår bruges den?** Når en side, formular eller komponent bygges eller ændres, og før en offentlig side udgives.

**Hvad får du?** En brugerflade, der er set i browseren på computer- og mobilbredde, og en liste over, hvad der er kontrolleret, og hvad der mangler.

**Hvad gør den ikke?** Den erklærer ikke løsningen tilgængelig. Et automatisk værktøj kan ikke alene afgøre, om en side er tilgængelig.

Kilder: [Lov om tilgængelighed af offentlige organers websteder og mobilapplikationer](https://www.retsinformation.dk/eli/lta/2018/692), [Digitaliseringsstyrelsen om tilgængelighedserklæringen](https://digst.dk/digital-inklusion/webtilgaengelighed/om-tilgaengelighedserklaeringen/), [W3C om evaluering af tilgængelighed](https://www.w3.org/WAI/test-evaluate/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

### Aura-design til dine apps

`harness-aura-design` · [SKILL.md](skills/harness-aura-design/SKILL.md)

**Hvad gør den?** Hjælper med at finde dokumenterede brandreferencer og omsætte dem til et sammenhængende appdesign med lyst og mørkt tema, begrundede designretninger, skabeloner, agentarbejdsrum og konkrete kvalitetskontroller. Metoden gælder det projekt, du bygger med Aura Harness.

**Hvornår bruges den?** Når et nyt appdesign planlægges, eller når du udtrykkeligt beder om at ændre designet i dit projekt. Eksisterende godkendt UI bevares ellers.

**Hvad får du?** Et designgrundlag med kilder og godkendt retning, farve- og typografitokens, komponenter og en ærlig oversigt over faktisk afprøvning og resterende arbejde.

**Hvad gør den ikke?** Den ændrer ikke Auras egen brugerflade, giver ingen ekstra værktøjs- eller datatilladelser og erklærer ikke automatisk en app tilgængelig. Hjælpekode er læsbart referenceindhold og køres ikke ved indlæsning.

Kilder: [Aura Design — metode og referencer af Parthee Vijayamohan](https://github.com/Parthee-Vijaya/skills_claude/tree/88ef16cf3f8916911f5f26cb5a334dbdf332d1f5/aura-design)

## Kode og kvalitet

Læsbar kode, afprøvning, fejlretning og styr på Git.

### Kodestil og vedligeholdelse

`harness-kodestil` · [SKILL.md](skills/harness-kodestil/SKILL.md)

**Hvad gør den?** Får agenten til at følge projektets konventioner og skrive kode, en anden udvikler kan overtage: forståelige navne, enkle funktioner, ingen død kode og kommentarer, der forklarer begrundelser frem for at gentage koden. I nye projekter foreslås engelske kodenavne og dansk brugerflade.

**Hvornår bruges den?** Når der skrives eller ændres kode, og når en ændring gennemgås før et commit.

**Hvad får du?** Kode, der ligner resten af projektet, og en kort gennemgang af ændringen med eventuelle bevidste afvigelser.

**Hvad gør den ikke?** Den indfører ikke en ny formatter eller stil i et eksisterende projekt uden aftale.

Kilder: [Google om kodegennemgang](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict)

### Afprøvning og fejlretning

`harness-afproevning-og-fejlretning` · [SKILL.md](skills/harness-afproevning-og-fejlretning/SKILL.md)

**Hvad gør den?** Agenten vælger relevante tests, reproducerer fejl før rettelsen og afprøver den faktiske brugerrejse. Den skelner mellem skrevet, unit-testet, afprøvet på rigtigt materiale og i drift og observeret og påstår aldrig mere, end den har vist.

**Hvornår bruges den?** Ved enhver kodeændring, når noget ikke virker, og før agenten melder en opgave færdig.

**Hvad får du?** En aflevering med de kørte kontroller og deres resultat, manuelle trin du selv kan prøve, og det der ikke er afprøvet.

**Hvad gør den ikke?** Den gør ikke en høj testdækning til et mål i sig selv og retter ikke tests, så de passer til forkert kode.

Kilder: [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)

### Git og samarbejde

`harness-git-og-samarbejde` · [SKILL.md](skills/harness-git-og-samarbejde/SKILL.md)

**Hvad gør den?** Forklarer og følger forskellen på at gemme en fil, lave et checkpoint, pushe, åbne en pull request og udgive. Agenten foreslår sammenhængende versioner med en præcis commit-besked, men laver kun Git-handlinger, du udtrykkeligt beder om. Branches vælges efter, om du arbejder alene eller i et team.

**Hvornår bruges den?** Ved milepæle, før et commit eller push og når arbejdet skal deles med andre.

**Hvad får du?** En gennemgået ændring med kun de tilsigtede filer, et forslag til commit-besked og en anbefaling til branches, der passer til samarbejdet.

**Hvad gør den ikke?** Den laver ikke force-push, rebase eller oprydning i historikken og ændrer ikke Git-identitet eller branchbeskyttelse.

Kilder: [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow), [Git worktree](https://git-scm.com/docs/git-worktree), [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

## Sikkerhed og data

Nøgler, afhængigheder, persondata, leverandører og sikkerhedsgennemgang.

### Nøgler og afhængigheder

`harness-noegler-og-afhaengigheder` · [SKILL.md](skills/harness-noegler-og-afhaengigheder/SKILL.md)

**Hvad gør den?** Holder hemmeligheder ude af kode, logs, rapporter og Git. Ved nye pakker kontrollerer agenten officiel kilde, udgiver, faktisk version, installationsscripts, licens og kendte sårbarheder. Offentlige klientnøgler vurderes efter deres rettigheder.

**Hvornår bruges den?** Når løsningen skal forbindes til en anden tjeneste, når der skal bruges en nøgle, og når pakker tilføjes eller opdateres.

**Hvad får du?** Konfiguration uden hemmelige værdier og en begrundet pakkekontrol med version, kilde og eventuelle uafklarede forhold. Fundne hemmeligheder gengives ikke.

**Hvad gør den ikke?** Den finder ikke alle hemmeligheder automatisk og erstatter ikke en egentlig hemmelighedsscanning eller udskiftning af en lækket nøgle.

Kilder: [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [Vite om miljøvariabler i browserkode](https://vite.dev/guide/env-and-mode), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [npm om installationsscripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/), [npm audit om sårbarheder, signaturer og dataflow](https://docs.npmjs.com/cli/v11/commands/npm-audit/)

### Data og leverandører

`harness-data-og-leverandoerer` · [SKILL.md](skills/harness-data-og-leverandoerer/SKILL.md)

**Hvad gør den?** Holder styr på, hvilke data løsningen bruger, hvem der modtager dem, hvor de behandles og gemmes, og hvad der stadig er uafklaret. Den skelner mellem data i udviklingen og i den færdige app og kender de danske offentlige krav, der typisk udløses: databehandleraftale, fortegnelse, konsekvensanalyse, anmeldelse af brud og journalisering.

**Hvornår bruges den?** Når løsningen får et nyt dataforløb, en ny tjeneste eller leverandør, eller når der skal bruges personoplysninger.

**Hvad får du?** En opdateret dataoversigt i projektet med kilder, kontroldatoer og konkrete spørgsmål til fx databeskyttelsesrådgiver og informationssikkerhed.

**Hvad gør den ikke?** Den erklærer ingen behandling for lovlig og godkender ikke på organisationens vegne. En registrering i filen er ikke en verificeret godkendelse.

Kilder: [Datatilsynet om cloud](https://www.datatilsynet.dk/regler-og-vejledning/cloud), [Databeskyttelse gennem design og standardindstillinger](https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/databeskyttelse-gennem-design-og-standardindstillinger), [Konsekvensanalyse](https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/konsekvensanalyse), [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [Datatilsynet om testdata](https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/testdata-anvendelse-af-personoplysninger-ved-udvikling-og-test-af-it-systemer), [Offentlighedsloven](https://www.retsinformation.dk/eli/lta/2020/145), [AI-forordningen](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)

### Sikkerhedsgennemgang

`harness-sikkerhedsgennemgang` · [SKILL.md](skills/harness-sikkerhedsgennemgang/SKILL.md)

**Hvad gør den?** Gennemgår de relevante dele af projektet og afprøver, at brugere og organisationer kun kan tilgå tilladte data. Omfatter også kodeagentens MCP-servere, hooks og rettigheder. Kontroller og fund dokumenteres uden hemmeligheder.

**Hvornår bruges den?** Ved ændringer i login, adgang, input, data, eksterne tjenester eller agentværktøjer og før en app sættes i drift.

**Hvad får du?** En gennemgang knyttet til kodeversion og miljø med omfang, værktøjer, bekræftede fejl, mistanker og manglende kontroller. Hvert fund har evidens, konsekvens og næste handling.

**Hvad gør den ikke?** Den er ikke en automatisk scanner, sandbox, penetrationstest eller GDPR-godkendelse. Fravær af fund er ikke bevis for fravær af problemer.

Kilder: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/), [OWASP Top 10](https://owasp.org/Top10/), [OWASP Top 10 for LLM-applikationer](https://genai.owasp.org/llm-top-10/), [NIS2-loven](https://www.retsinformation.dk/eli/lta/2025/434), [OWASP om adgangskontrol](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [OWASP om MCP-sikkerhed](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html), [OWASP om prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

## Udgivelse og drift

Sæt i drift, rul tilbage, og gør arbejdet klar til at blive overtaget.

### Udgivelse og gendannelse

`harness-udgivelse-og-gendannelse` · [SKILL.md](skills/harness-udgivelse-og-gendannelse/SKILL.md)

**Hvad gør den?** Gennemgår version, miljø, dataændringer, kontroller, nødvendige godkendelser og vejen tilbage. Manglende prøver og åbne fund skal fremgå. Berørte godkendelser vurderes på ny ved ændringer. Efter udgivelsen afprøves den rigtige adresse, adgang og logs.

**Hvornår bruges den?** Når du vil udgive til et test- eller driftsmiljø, eller når en version skal rulles tilbage.

**Hvad får du?** En udgivelsesnote med commit, miljø, kontrolgrundlag, åbne fund, ansvarlige roller og faktisk modtagne godkendelser samt en afprøvet vej tilbage.

**Hvad gør den ikke?** Den udgiver ikke til drift og opretter ikke betalte ressourcer uden din udtrykkelige godkendelse. En godkendelse registreret i en fil er ikke en verificeret identitet.

Kilder: [GitHub om udgivelsesmiljøer](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

### Overdragelse og drift

`harness-overdragelse-og-drift` · [SKILL.md](skills/harness-overdragelse-og-drift/SKILL.md)

**Hvad gør den?** Gør appen klar til, at en anden kan starte, drive, opdatere og gendanne den uden den oprindelige udvikler eller AI-værktøjet. Agenten skriver en afprøvet startvejledning og en driftsvejledning og afklarer ejerskab af konti og udgifter.

**Hvornår bruges den?** Før en app sættes i drift, når projektet skal overdrages, og når driftsopsætningen ændres.

**Hvad får du?** En opdateret README og driftsvejledning samt en liste over åbne spørgsmål, der skal afklares før overdragelse.

**Hvad gør den ikke?** Den skriver aldrig adgangskoder, nøgler eller personoplysninger i dokumentationen.

## Integrationer

Vejledning til registre og tjenester. Vælges til for de systemer, du bruger.

### Adresser

`harness-integration-adresser` · [SKILL.md](skills/harness-integration-adresser/SKILL.md)

**Hvad gør den?** Hjælper agenten med at bruge Klimadatastyrelsens Adressevælger til adressesøgning og Datafordeleren til flere oplysninger. Den forklarer token, nøgler, koordinater og kreditering og skifter væk fra DAWA, som lukker 1. oktober 2026.

**Hvornår bruges den?** Når en løsning skal søge efter, udfylde eller vise danske adresser, fx i en formular eller på et kort.

**Hvad får du?** En adressesøgning, der virker fra browseren, korrekt kreditering og, når der er brug for mere, opslag fra en server med nøglen i .env.

**Hvad gør den ikke?** Opretter ikke brugere eller nøgler for dig og henter ikke personoplysninger. Beskyttede data fra Datafordeleren kræver en særskilt aftale.

- **System:** Danmarks Adresseregister (DAR) via Adressevælgeren og Datafordeleren
- **Ejer:** Klimadatastyrelsen
- **Adgang:** Adressevælgeren kræver ingen bruger. Datafordeleren kræver en gratis bruger og en API-nøgle.
- **Data:** Offentlige adresser, husnumre, postnumre og koordinater. Ingen personoplysninger i sig selv.
- **Dataflow:** Søgeteksten sendes fra den app, du bygger, til Klimadatastyrelsen. Kald til Datafordeleren går fra en server med nøglen.
- **Pris:** Gratis
- **IT-afdelingen:** Kræver ikke hjælp fra IT-afdelingen.

Skillen vedligeholdes af Aura Harness og er kontrolleret mod kilderne 2026-09-30.

Kilder: [Adressevælger · fonetisk søgning (Klimadatastyrelsen)](https://confluence.kds.dk/pages/viewpage.action?pageId=244318431), [Adressevælger · opslag med ID (Klimadatastyrelsen)](https://confluence.kds.dk/pages/viewpage.action?pageId=246743156), [Adressevælger · brugerstyring og token (Klimadatastyrelsen)](https://confluence.kds.dk/pages/viewpage.action?pageId=236486723), [DAWA lukker (Dataforsyningen)](https://dataforsyningen.dk/data/4924), [Datafordeleren · adgangsmetoder (Klimadatastyrelsen)](https://confluence.kds.dk/pages/viewpage.action?pageId=187105503), [Datafordeleren · brugervilkår](https://datafordeler.dk/vejledning/brugervilkaar/)

### CVR

`harness-integration-cvr` · [SKILL.md](skills/harness-integration-cvr/SKILL.md)

**Hvad gør den?** Hjælper agenten med at vælge mellem Datafordeleren og Erhvervsstyrelsens system-til-system-adgang, bygge med opdigtede virksomheder, indtil adgangen er på plads, og holde nøglerne på en server.

**Hvornår bruges den?** Når en løsning skal slå virksomheder op eller vise oplysninger fra CVR.

**Hvad får du?** En løsning, der henter CVR-data fra en server, markerer reklamebeskyttede enheder og aldrig viser CPR-numre.

**Hvad gør den ikke?** Søger ikke om adgang for dig og læser aldrig cvr.dk automatisk, fordi det er forbudt. Oplysninger om personer og reelle ejere kræver særskilt ret.

- **System:** Det Centrale Virksomhedsregister (CVR) via Datafordeleren eller Erhvervsstyrelsens system-til-system-adgang
- **Ejer:** Erhvervsstyrelsen
- **Adgang:** Kræver en bruger med API-nøgle hos Datafordeleren eller en ansøgning om system-til-system-adgang, som normalt tager tre uger. Oplysninger om personer kræver MitID Erhverv.
- **Data:** Offentlige virksomhedsoplysninger. Enkeltmandsvirksomheder og ejere er personer, og nogle er reklamebeskyttede.
- **Dataflow:** Forespørgsler går fra en server i den app, du bygger, til Datafordeleren eller Erhvervsstyrelsen med brugerens nøgle.
- **Pris:** Gratis
- **IT-afdelingen:** Kræver ikke hjælp fra IT-afdelingen.

Skillen vedligeholdes af Aura Harness og er kontrolleret mod kilderne 2026-09-30.

Kilder: [System-til-system-adgang til CVR-data (Erhvervsstyrelsen)](https://datacvr.virk.dk/artikel/system-til-system-adgang-til-cvr-data), [CVR på Datafordeleren](https://datafordeler.dk/vejledning/brugeradgang/anmodning-om-adgang/det-centrale-virksomhedsregister-cvr/), [Reklamebeskyttelse (Erhvervsstyrelsen)](https://datacvr.virk.dk/artikel/reklamebeskyttelse), [CVR-loven, LBK nr. 246 af 5. februar 2026](https://www.retsinformation.dk/eli/lta/2026/246), [CVR-bekendtgørelsen](https://www.retsinformation.dk/eli/lta/2022/1243), [Logning af brugernes anvendelser af personoplysninger (Datatilsynet)](https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/katalog-over-foranstaltninger/logning-af-brugernes-anvendelser-af-personoplysninger)

### Promte

`harness-integration-promte` · [SKILL.md](skills/harness-integration-promte/SKILL.md)

**Hvad gør den?** Hjælper agenten med at opsætte et React-projekt efter Promtes byggeregler og bruge app-biblioteket til modeller, vidensbaser og data. I Aura udgiver brugeren med Udgiv, i andre værktøjer med Promtes kommandolinjeværktøj.

**Hvornår bruges den?** Når en løsning skal køre som app i et Promte-arbejdsområde.

**Hvad får du?** Et projekt, som Promte kan bygge, uden nøgler i koden, og en version, der venter på godkendelse eller er udgivet i arbejdsområdet.

**Hvad gør den ikke?** Opretter ikke en Promte-konto eller administratorrettigheder for dig og godkender ikke versioner. Agenten udgiver ikke selv fra Aura. Kommandolinjeværktøjet i andre værktøjer hentes fra npm, når brugeren siger ja.

- **System:** Promte-apps via app-biblioteket og kommandolinjeværktøjet til upload
- **Ejer:** Promte
- **Adgang:** Kræver en Promte-installation og administratorrettighed i appens arbejdsområde. Login til udgivelse godkendes i browseren og gælder i 30 dage. En ny app kan oprettes fra Aura.
- **Data:** Appens egne data og filer i Promte, privat for hver bruger eller fælles for arbejdsområdet. Om der er persondata, afhænger af appen.
- **Dataflow:** Appen kalder kun organisationens Promte-server, som sender modelkald videre til de modeller, organisationen har valgt. Kildekoden uploades til samme server, som bygger og gennemgår den.
- **Pris:** Kræver en aftale med Promte. Prisen er ikke offentliggjort og er ikke verificeret her.
- **IT-afdelingen:** Adgangen kræver hjælp fra IT-afdelingen.

Skillen vedligeholdes af Promte og er kontrolleret mod kilderne 2026-10-21.

Kilder: [Udvikl apps med kodeagenter (Promte)](https://app.promte.dk/docs/admin/udvikl-apps-med-kodeagenter), [Byg og udgiv AI-apps (Promte)](https://app.promte.dk/docs/admin/ai-apps), [@promte/app-library (npm)](https://www.npmjs.com/package/@promte/app-library), [@promte/app-upload (npm)](https://www.npmjs.com/package/@promte/app-upload)

### Komplai Run

`harness-integration-komplai-run` · [SKILL.md](skills/harness-integration-komplai-run/SKILL.md)

**Hvad gør den?** Hjælper med at bygge og gennemgå de filer, Run kan vise, bruge komplais app-SDK til login, AI, Redact, gemte data og hændelseslog, vælge adgang og kontrollere den udgivne app. I Auras desktopapp bruges Udgiv; fra Aura-terminalen henvises til manuel upload i Run. Andre kodeværktøjer kan bruge komplais terminalværktøj.

**Hvornår bruges den?** Når du har valgt Komplai Run til en browserapp eller vil opdatere en app der.

**Hvad får du?** En gennemgået browserapp med alle nødvendige filer, en vej til udgivelse og en tydelig beskrivelse af, hvad der er afprøvet.

**Hvad gør den ikke?** Giver ingen adgang, godkender ikke appens brug af komplai og udgiver ikke uden dit valg. Agentens kommandoværktøj må ikke publicere i Aura. Run kører ingen serverkode; login, AI, Redact og gemte data fås kun gennem app-SDK'et efter en administrators godkendelse.

- **System:** Komplai Run
- **Ejer:** Komplai
- **Adgang:** Kræver en komplai-organisation med Run. Aura bruger login og en udgivelsesadgang til dine egne apps i 30 dage. Eget kodeværktøj bruger en nøgle til én app i syv dage. En administrator godkender appens brug af login, AI, Redact og gemte data i Run.
- **Data:** Færdig HTML, CSS, JavaScript og appens øvrige filer. Offentlig adgang gør alle de uploadede filer tilgængelige for enhver. Apps for organisationen kan gemme data og sende tekst til AI og Redact gennem app-SDK'et; om der er persondata, afhænger af appen.
- **Dataflow:** Filer uploades fra din computer til organisationens appmiljø gennem komplai. Besøgende henter filerne til deres browser. Appens SDK-kald går til appens egen adresse og derfra til komplai med den indloggede persons egen adgang; appens eventuelle eksterne kald skal gennemgås særskilt.
- **Pris:** Følger organisationens aftale. Aktuelle lager- og trafikrammer vises i Hub.
- **IT-afdelingen:** Adgangen kræver hjælp fra IT-afdelingen.

Skillen vedligeholdes af Aura Harness og er kontrolleret mod kilderne 2026-10-22.

Kilder: [komplai Run · vejledning i Hub](https://hub.komplai.dk/publish?guide=1), [komplais udgivelseskit · API med app-SDK, skill og CLI 0.2.1](https://hub.komplai.dk/komplai-publish/komplai-publish.zip)

## Spørgsmål og svar

### Hvad er en skill?

En skill er en kort vejledning til kodeagenten om én bestemt arbejdsopgave, fx en sikkerhedsgennemgang eller en udgivelse. Den ligger som en almindelig tekstfil, SKILL.md, i projektet. Agenten læser først kun navn og beskrivelse og henter resten, når opgaven passer. Det holder instruktionerne korte i det daglige arbejde.

### Bruges alle skills hver gang?

Nej. Mange værktøjer vælger selv en skill, når opgaven passer til beskrivelsen, og du kan også bede om en bestemt skill. En tekstændring skal fx ikke udløse en sikkerhedsgennemgang. Hvordan skills startes, afhænger af værktøjet; se værktøjets vejledning i webguiden.

### Hvad er forskellen på grundregler og skills?

Grundreglerne gælder altid: nøgler, Git, afprøvning og ærlig rapportering. De står i fx AGENTS.md eller CLAUDE.md. Skills er de længere arbejdsgange, der kun bruges, når opgaven kræver dem.

### Hvad er en integration?

En integration er en skill om ét bestemt system, fx adresser, CVR eller udgivelse med Komplai Run. Den forklarer adgang, nøgler, data og regler for systemet. Integrationerne følger ikke med pakkerne. Du vælger dem til i Aura-appen for de systemer, dit projekt bruger.

### Kan jeg ændre en skill?

Ja. Filerne er dine. Hvis du ændrer en installeret fil, springer en senere opdatering netop den fil over og fortæller dig det. Projektets egne regler skrives uden for Aura Harness-afsnittet i AGENTS.md eller CLAUDE.md, så de aldrig overskrives.

### Sender Aura Harness mine data nogen steder hen?

Nej. Installationen kopierer tekstfiler til dit projekt. Dit kodeværktøj og den model, du har valgt, læser filerne som en del af dit arbejde. Hvor de data behandles, afhænger af værktøjet og modellen.

### Gør skillsene min app sikker eller lovlig?

Nej. Skills er vejledning til agenten. De er ikke adgangskontrol, en sikkerhedsgodkendelse eller en vurdering efter databeskyttelsesreglerne. De hjælper med at stille de rigtige spørgsmål og inddrage de rigtige fagpersoner, men ansvaret for løsningen ligger fortsat hos organisationen.

### Bliver koden bedre af det?

Det har vi endnu ikke målt for vores målgruppe. Undersøgelser fra 2026 viser, at generelle instruktionsfiler sjældent gør kodeagenter mere korrekte og koster ekstra tokens, mens fokuserede skills kan hjælpe ved bestemte opgaver. Derfor er grundreglerne korte, og skills indlæses kun, når opgaven passer. Vi vil sammenligne de samme opgaver med og uden Aura Harness på flere modeller.

### Kan en skill gøre skade?

En skill fra en ukendt kilde skal behandles som software, fordi den kan få agenten til at køre kommandoer. Aura Harness' skills indeholder kun tekst, ingen scripts, og giver ingen værktøjstilladelser. Du kan læse dem alle på denne side, før du installerer dem.

### Hvordan opdaterer eller fjerner jeg Aura Harness?

Installér en ny version på samme måde. Aura Harness opdaterer kun filer, der er uændrede siden installationen, og viser konflikter for resten. Fjernelse sletter kun uændrede filer og afsnit. Oplysningerne står i .harness/installation.json, som også skal med i Git.

### Hvilke kodeværktøjer virker det med?

Webguiden viser hvert værktøj med status. "Afprøvet" betyder, at vi har set værktøjet indlæse grundregler og skills og sende dem til modellen. "Efter dokumentation" betyder, at filplaceringen følger værktøjets officielle dokumentation, men endnu ikke er afprøvet af os. Ingen af delene viser, hvor godt en bestemt model følger instruktionerne.
