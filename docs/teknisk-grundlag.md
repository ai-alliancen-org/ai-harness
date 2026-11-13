# Hvad Aura Harness bygger på

Gennemgang af kode og leverandørdokumentation, 28. september 2026. Denne gennemgang ændrer ingen agentmotor eller integration. De foreslåede alternativer er ikke afprøvet som en del af Aura Harness.

## Produkt og målgruppe

Aura Harness er et udviklingsværktøj og en fælles arbejdsmetode for udviklere, IT-medarbejdere og teknisk interesserede kolleger. Brugeren kan få hjælp til at skrive kode og styre arbejdet uden at kunne bygge hele løsningen alene. Model, integrationer, hosting og ansvar skal stadig forstås og afklares med organisationen.

Det er en anden produktform end en samlet tjeneste, hvor leverandøren stiller udviklingsmiljø, hosting og administration til rådighed under fælles begrænsninger. Begge former kan være relevante. En simpel brugerflade eller mange blokerede funktioner dokumenterer ikke i sig selv sikkerhed. Vi har ikke foretaget en teknisk eller kontraktuel vurdering af Promte Kodning og fremsætter derfor ingen sikkerhedsgarantier på dets vegne.

Aura Harness har ingen afhængighed af et Promte-abonnement. De valgte model- og hostingtjenester har hver deres adgangskrav og vilkår. Open source er projektets mål; det nuværende repository har endnu ingen valgt og indlagt LICENSE-fil.

## Fra det oprindelige forslag til den aktuelle app

Det indledende oplæg foreslog at genbruge OpenCode som agentmotor, have egen brugerflade og separat konfiguration og lægge sektorens fælles praksis ovenpå. Det er den arkitektur, vi har fulgt. Mailen er projektinput, ikke dokumentation for, at alle foreslåede funktioner er implementeret eller vedtaget.

Den nuværende app består af:

1. **Vores egen brugerflade i Electron.** HTML, CSS og JavaScript i [desktop/ui](../desktop/ui/), med lokale funktioner i [main.cjs](../desktop/main.cjs), [preload.cjs](../desktop/preload.cjs) og [core](../desktop/core/). Appen er beregnet til Mac og Windows.
2. **OpenCode 1.19.5 som agentmotor.** Versionen står i [runtime-lock.json](../desktop/runtime-lock.json) og kontrolleres ved opstart. [engine.cjs](../desktop/core/engine.cjs) starter den originale motor som en adgangskodebeskyttet loopback-server og håndterer sessioner, løbende svar, stop, godkendelser og ændringsoversigt. Den bruger særskilte konfigurations- og datamapper og kontrollerer den effektive konfiguration. [OpenCodes serverinterface](https://opencode.ai/docs/server/) er integrationsgrundlaget; den aktuelle kode er bundet til den afprøvede version.
3. **Brugerens model via vores forbindelseslag.** Alle modelkald går gennem appens gateway, så API-nøglen bliver i hovedprocessen. Motoren melder sig over for OpenCode som klienten `harness`. OpenCode styrer agentens arbejde. AI-modellen leverer svar og forslag til handlinger. Det er to forskellige valg. En model kan køre lokalt eller hos en valgt udbyder; en lokal app indebærer derfor ikke, at alt projektmateriale bliver på computeren.
4. **Aura Harness' arbejdsforløb og indhold.** Opstart, designreferencer, dataoplysninger, preview, Git og testudgivelse ligger omkring agenten. Appens AI bruger det fælles skillbibliotek i `profiles/skills`, det samme som installationen i brugerens eget kodeværktøj gennem [own-tools.cjs](../desktop/core/own-tools.cjs).
   - [features.cjs](../desktop/core/features.cjs) afgør, hvilke funktioner der er slået til: standarden for alle projekter og undtagelser pr. projekt.
   - [skills.cjs](../desktop/core/skills.cjs) finder de tilhørende skills og en eventuel tilpasning i projektet.
   - Motoren lægger skillsene i sin egen konfigurationsmappe, og OpenCodes skill-værktøj henter dem efter behov.
   - Tilladelserne lader kun de aktive skills hente og deres filer læse uden spørgsmål.
   - Grundreglerne og appens egne regler fra [project-guidance.cjs](../desktop/core/project-guidance.cjs) står i systemprompten.

De medfølgende værktøjer og kontrolsummer er fastlagt i [runtime-lock.json](../desktop/runtime-lock.json). Vi vedligeholder ikke en fork af OpenCode. Der er heller ikke integreret kode fra Promtes private sikkerhedslag eller fra Pi.

Når en bruger henter en instruktionspakke til sit eget kodeværktøj, bruger vedkommende det værktøjs agent. Vores Electron-app og OpenCode-proces indgår ikke i den brugsvej.

## Hvilke dele af oplægget mangler?

Oplæggets samlede organisationsstyring, verificerede identiteter i revisionssporet, faste sikkerheds- og arkitekturagenter og fælles afprøvning på tværs af værktøjer er ikke implementeret. MCP-servere, OpenCode-plugins og delegerede agentopgaver er slået fra i den aktuelle motorkonfiguration.

Der findes konkrete programkontroller, blandt andet godkendelse af kommandoer og kontrol af den valgte modelkonfiguration. Men arbejdsområdet er ikke en fuldt isoleret sandbox: en godkendt kommando kan køre med brugerens rettigheder. Elektrons isolation af brugerfladen er en anden grænse end isolation af kodeagenten og dens underprocesser. Grundregler er instruktioner og kan ikke erstatte netværks- eller filadgangskontrol.

Oplægget nævnte også Codeberg og GPLv3. Vi har ikke flyttet repositoryet eller indført den licens. Repositoryet ligger fortsat på GitHub, og licensvalget skal afklares af vedligeholderne.

## Pi som alternativ motor

Pi er relevant på to måder. Det kan bruge vores fælles indhold gennem [Agent Skills](https://pi.dev/docs/latest/skills). Det kan også indbygges i en app via et [SDK eller et separat procesinterface](https://pi.dev/docs/latest/sdk). SDK'et giver adgang til blandt andet sessioner, modeller, værktøjer, løbende svar og stop.

Det gør Pi til en kandidat for en anden motor bag samme brugerflade. [workbench.cjs](../desktop/core/workbench.cjs) har allerede et sted, hvor motoren oprettes gennem `engineFactory`, men kun OpenCode-adapteren er implementeret. Pi er derfor ikke noget, brugeren kan vælge nu.

Pi dokumenterer selv, at det arbejder med procesbrugerens rettigheder og ikke kræver godkendelse før hvert værktøjskald. Projektets tillidsindstillinger er heller ikke en sandbox. En Pi-adapter skal opfylde Aura Harness' krav til kontrol af handlinger, konfiguration og data; de kan ikke antages at følge med SDK'et. [Pi om sikkerhed](https://pi.dev/docs/latest/security).

**Forslag til en sammenlignende afprøvning:** Brug den samme model, projektkopi og opgave i OpenCode og Pi. Undersøg:

- Om agenten kan bygge og ændre et konkret projekt, og om resultatet kan afprøves i preview.
- Om streaming, stop, fejl og genoptagelse har forståelig og pålidelig adfærd.
- Om afviste handlinger faktisk bliver afvist, herunder kommandoer og adgang uden for projektet.
- Om værktøjer og projektkonfiguration kan afgrænses uden at indlæse brugerens øvrige nøgler, plugins eller instruktioner utilsigtet.
- Om private referencer, modelvalg, ændringsoversigt, Mac og Windows kan opfylde samme kontrakt.

Det er kriterier for en senere afprøvning, ikke en konklusion om, at Pi er bedre. Vi beholder OpenCode, indtil der er et konkret grundlag for en ændring.

## Kan hele arbejdsforløbet bruges i en browser?

Ja. Brugerfladen, agenten, AI-modellen og projektets hosting behøver ikke køre samme sted. Der er tre mulige former, som løser forskellige behov. Ingen af dem er implementeret som fuld webudgave i dag.

### Browser med et arbejdsområde på brugerens computer

En browser kan få adgang til udvalgte lokale filer og mapper med brugerens tilladelse i understøttede browsere. Det giver ikke i sig selv adgang til at starte den installerede OpenCode-motor, Git, npm eller Docker. Et fuldt lokalt udviklingsmiljø fra browseren vil derfor kræve en lokal hjælpetjeneste eller desktopapp med et afgrænset og godkendt interface. [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Det passer til brugere, som vil beholde filer og udviklingsværktøjer lokalt. En hjælpetjeneste skal kontrollere login eller parring, tilladte websteder og projektadgang. Den nuværende OpenCode-server skal ikke blot gøres tilgængelig fra nettet.

### Browser med et arbejdsområde på en server

Her kører agent, Git, afhængigheder og preview på serveren. Browseren sender opgaver og viser resultater. Kommunen kan drive miljøet selv eller vælge en driftsleverandør. Udviklingen kræver både beregningskraft og lagerplads; diskplads alene er ikke nok.

Vores forslag til denne form er et isoleret arbejdsområde pr. projekt med serverkontrolleret adgang, varigt lager og mulighed for at lukke selve kørslen ned uden at miste filer. Isolationen skal omfatte agent, kommandoer og underprocesser. En delt server med forskellige mapper giver ikke alene adskillelse mellem brugerne.

Det kræver også separat adgang til previews, afgrænsede nøgler og netværksrettigheder, ressourcegrænser, backup, gendannelse og en kendt slettepolitik. Preview og genereret kode skal være adskilt fra appens login og administrative adgang. Agenten må ikke selv kunne ophæve de grænser. Container eller virtuel maskine er mulige byggesten, hvis de konfigureres og afprøves til opgaven.

GitHub eller Codeberg kan bevare den committede kode. Det erstatter ikke lagring af aktuelle filer og kladder eller drift af agent, preview og databaser. Den færdige app kan udgives et andet sted end udviklingsmiljøet. Valget af AI-model er også selvstændigt: en arbejdsserver i kommunen kan stadig sende materiale til en ekstern modeltjeneste.

### Udviklingsmiljø direkte i browseren

WebContainers viser, at et Node.js-miljø kan køre i browseren med et virtuelt filsystem. Det kan være relevant til afgrænsede webprojekter, men er ikke et almindeligt servermiljø med vilkårlige systemprogrammer. Browserunderstøttelse, afhængigheder og varig lagring skal undersøges for den konkrete løsning. [WebContainers](https://webcontainers.io/guides/introduction), [browserunderstøttelse](https://webcontainers.io/guides/browser-support).

**Arkitektonisk anbefaling:** Bevar fælles regler og brugerforløb, og adskil dem fra det sted, projektets filer og programmer kører. Lokal afvikling og et administreret arbejdsområde på en server kan så være forskellige implementeringer. Den nuværende Electron-kode bruger lokale processer, filstier, nøglering og IPC; en webudgave kræver derfor et nyt backendinterface og adgangskontrol, ikke bare publicering af HTML-filerne. [GitHub Pages er statisk hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages): det kan vise guiden og en statisk brugerflade, men kan ikke drive kodeagenten eller arbejdsområderne.
