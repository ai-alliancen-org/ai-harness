# F35: kontrolleret modeltransport og Privacy Gate

**Udkast til integration.** Bidraget indeholder en afgrænset kerne og transportadapter med tests. Ingen af dem importeres endnu af Auras gateway. En sammenfletning aktiverer derfor ikke datakontrol i appen og må ikke markedsføres som fuld Privacy Gate.

## Hvad koden gør

`desktop/core/privacy/` indlæser regler gennem værtsappens betroede callbacks, sammensætter organisationens, projektets og samtalens begrænsninger og kontrollerer en hel serialiseret JSON-forespørgsel før afsendelse. Det omfatter første besked, historik, værktøjsresultater og metadata. Afledte resultater beholder deres angivne kildeklassifikation.

Faste lokale regler genkender blandt andet CPR, e-mail, kendte beskyttede værdier og nøglemønstre. Uigennemsigtigt eller ikke-understøttet materiale, strengt beskyttede kilder og ulovlige destinationer giver ingen cloudafsendelse. Det er heuristik og eksplicitte regler, **ikke en komplet persondatadetektor** eller en lokal klassifikationsmodel.

Omskrivninger kræver konkret gennemgang af de bearbejdede bytes. Godkendelsen bindes til indhold, destination, formål, kontekst, revision og regelversion, udløber og forbruges én gang. Regler og destination kontrolleres igen efter asynkrone callbacks og umiddelbart før transporten. Stop eller ændrede regler kasserer tilladelsen. En almindelig godkendelse kan ikke ophæve organisationens loft.

`createControlledModelTransport()` leverer de godkendte bytes direkte til én POST. Nøgler kommer kun fra en main-ejet callback og indgår ikke i modeldata, gennemgang eller revisionsmetadata. Redirects afvises, og en transportfejl giver ingen gentagelse eller reserveudbyder. En ny OpenCode-anmodning skal gennem kontrollen igen. Adapterens indgang afviser også deaktiveret politik; kernens eksisterende bytebevarende kompatibilitetssti er ikke en genvej gennem denne adapter.

Adapteren kræver `readCurrentState(scope, destinationRef)`: ét **synkront** opslag i main-processens aktuelle regel- og destinationsregister, som returnerer `{ policy, destination }`. Det er ikke et nyt asynkront netværksopslag eller en tidligere cache. Resultatet sammenlignes med hele regelbindingen og den gennemgåede destination efter alle ventepunkter. Ingen `await` ligger mellem denne sidste kontrol og `fetch`. En valgfri kontrol af den aktive opgave kan kun begrænse yderligere; den kan ikke erstatte registerkontrollen. Ved direkte brug af kernen skal værtsappen selv levere en eksplicit `assertCurrent(binding)`, som også udfører den afsluttende synkrone kontrol. Bindingen indeholder blandt andet payloadens hash, proveniens, kontekst, revision og regelbinding og må ikke kopieres til revisionssporet.

En registreret udbyderrute kræver, at den faktiske body angiver `provider.only` med præcis den rute og `provider.allow_fallbacks: false`. En anden eller manglende rute, en ikke-registreret `provider`-blok eller felter til alternative modeller/ruter afvises. Det afgrænser adapteren til eksplicitte modtagere; det er ikke en generel adapter for alle udbyderes routingfelter.

## Forholdet til F33 og R08

- **F33 er observation:** målte kald, ventetid og lokal rapport. Det håndhæver ikke datatilladelser. F33 kan flettes og bruges uden F35.
- **F35 er en foreslået afsendelsesgrænse:** den kontrollerer præcis indhold og modtager før transport. Den afhænger ikke af F33; en senere journaladapter må kun modtage minimalt metadata og skal adskille afviste handlinger fra faktiske netværkskald.
- **R08 handler om genoptagelse:** originalens OpenCode ejer genforsøg. F35 indfører ingen konkurrerende retry-motor. Ved en ny anmodning genkontrolleres materialet, og et delvist leveret svar gensendes aldrig af adapteren.

Kernens revisionspost `allow`/`rewrite` er en kontrolbeslutning før slutkontrollen, ikke bevis for et sendt kald eller et modtaget svar. En ændring under den efterfølgende kontrol giver en separat blokering og nul transportkald.

## Mangler før aktivering i main

1. Et destinationsregister med behandlingssted, model, konto, eventuel OpenRouter-rute og revision samt den synkrone `readCurrentState`-kontrakt ovenfor. Regler og destination skal læses fra samme aktuelle main-ejede tilstand; en asynkron resolver alene kan efterlade et kapløb før afsendelse. En organisationsserver er en anden maskine; en lokal URL alene dokumenterer ikke lokal behandling.
2. Main-ejet politiklagring og kildeproveniens. Renderer, projektdokumenter, modeltekst og værktøjer må ikke kunne hæve reglerne. Slå ikke kontrollen til med opdigtet proveniens.
3. Integrér adapteren **efter** gatewayens tilføjelse af billeder, routing og indsatsniveau. Gennemgå alle indgange, også idéhjælp og komprimering, så den undersøgte body er den faktisk sendte.
4. Tilpas den konkrete datagennemgang til originalens Før du sender og godkendelsesmodel. Bevar plan-, værktøjs- og sessionsgodkendelser; modelvalg giver ikke flere datarettigheder. UI er ikke med i dette bidrag.
5. Lad fejl, Stop, regelændring og udløb afbryde korrekt. Bevar den lokale plan og session uden at genudsende ukendte udførte handlinger. Test med den faktisk låste OpenCode-version.
6. Hybrid kræver særskilte lokale/cloudsessioner og kontrollerede overdragelser. Filsystem- og netværksisolation af værktøjer, underprocesser og previews er en yderligere leverance. Denne kerne blokerer **ikke** terminal, Git, browser, telemetri eller uploads uden om modellen.
7. Afprøv alle understøttede udbyderformater og billed-/PDF-forløb samt OS-grænser. Test falske positiver og ukendt følsomt indhold. Aftal retention og visning af revisionssporet.

## Afprøvning, risiko og tilbagerulning

Kør `node --test desktop/tests/privacy-gate-core.test.cjs desktop/tests/privacy-gate-inspector.test.cjs desktop/tests/privacy-transport.test.cjs`. Prøverne bruger syntetiske data og lokale HTTP-modtagere og verificerer faktisk modtagne bytes, nul kald ved blokering, Stop, ændrede regler/modtagere, udløb, redirect og ingen adaptergenforsøg. Regressionerne omfatter en regelændring under den sidste asynkrone modtageropløsning, forældede resolverresultater, ugyldig rute/fallback og fravær af et ventepunkt mellem slutkontrol og transport. De er ikke en prøve med en rigtig cloudmodel, et bevis for komplet detektion eller en test af den endnu manglende produktintegration.

Der er ingen nye afhængigheder eller nye OS-rettigheder. Før integration kan modulet fjernes uden ændring af brugerdata. Efter integration skal en tilbagerulning af kontrollerede projekter stoppe dem eller bevare deres regler; den må aldrig stiltiende sende uden kontrol. F35 bygger direkte på main og kræver ingen af de øvrige bidrag.
