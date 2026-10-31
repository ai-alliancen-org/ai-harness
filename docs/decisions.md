# Produktretning og beslutninger

## Promte før login · til 0.5.0-beta.3 · 22. oktober 2026

En tester loggede ind hos Promte, valgte app og fik så "Promte-kildekoden mangler en gyldig package.json." Promte tager kun imod React-apps, som Promte selv bygger med sin faste Vite-opsætning. Aura starter derimod et nyt projekt som en neutral pladsholder i `public/`, og AI'en vælger teknik efter opgaven: HTML/CSS til en enkel side, React med TypeScript til en interaktiv app og Python eller Node.js til en backend. Et almindeligt Aura-projekt er derfor ikke en Promte-app, før det er bygget som en. Promte-integrationen, som giver AI'en Promtes regler, er slået fra som standard.

Brugeren valgte, at Udgiv fanger det før login, forklarer det i almindeligt dansk og tilbyder at gøre projektet klar til Promte eller vælge en anden udbyder. Kontrollen bruger Promtes egne regler fra adapteren på projektets filer på computeren. Gør projektet klar slår Promte-integrationen til for netop dette projekt og lægger en besked i skrivefeltet i Planlæg. Intet sendes automatisk, og en kladde, brugeren selv har skrevet, bevares. Aura omskriver ikke selv projektet og ændrer ikke Promtes byggekontrakt.

## Alle projekter i sidepanelet · til 0.5.0-beta.3 · 22. oktober 2026

Sidepanelet viste højst de 12 senest åbnede projekter, og grænsen sad i kernen (`recent()`). Et 13. projekt forsvandt derfor helt fra sidepanelet og paletten og kunne ikke åbnes fra listen, selv om dets samtaler stadig var gemt. Nu husker kernen alle projekter, appen har åbnet. Sidepanelet viser de 12 senest åbnede og resten bag "Vis alle N projekter", ligesom samtalelisten gør. Paletten søger i alle.

Brugeren valgte ikke at scanne Dokumenter/Aura. Listen viser kun projekter, som netop denne installation har åbnet eller oprettet. Projekter kan ligge andre steder, og en scanning ville vise nogle og skjule andre tilfældigt. Projekter fra en anden installation, en kørsel fra kildekoden eller en prøve med egne appdata åbnes med **Åbn projekt**.

## Svarloft, indsats og komprimering · til 0.5.0-beta.3 · 22. oktober 2026

En tester fik "AI'en stoppede uden et resultat – Svaret blev for langt" med Cortis corti-s1 (GLM 5.3) efter en lang samtale. Årsagen er, at OpenCode 1.x sender højst 32.000 tokens pr. svar (`Math.min(limit.output, 32000)`). En tænkende model kan bruge hele loftet på at tænke. Det gælder også den nyeste 1.x (1.19.4). OpenCode 2 sætter intet sådant loft, men skiftet til 2 venter til en senere beta og undersøges for sig.

Brugeren har valgt:
- **Grænser:** Loftet pr. svar følger modellens dokumenterede maksimum. Kataloget har forrang, og ellers bruges udbydernes dokumentation med kilde og dato i `core/connections.cjs`. Ukendte modeller beholder et forsigtigt loft.
- **Fejlvalg:** Fejlkortet viser valg, og intet sendes uden et klik.
- **Omfang:** Det gælder alle udbydere.

Det betyder:
- **OpenCodes loft** hæves med `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` til Auras højeste svarloft, 128.000 (Claude og GPT-5). Modellens egen grænse i opsætningen bestemmer.
- **Grænser pr. model:**
  - Claude 5-familien og Opus/Sonnet 4.6+ får 128.000 (Anthropics Models API oplyser selv `max_tokens`).
  - GPT-5 får 128.000, og o-modellerne får 100.000.
  - corti-s1 får 128.000. Corti dokumenterer intet loft, men tog imod `max_tokens` op til hele konteksten 22. oktober.
  - Alexandra beholder sit anbefalede 16.384, og Mistral beholder Auras 32.000.
  - Lokale Ollama-modeller får halvdelen af konteksten.
  - Ukendte tænkende modeller får 32.000, og øvrige ukendte 4.096.
- **Komprimering:** Samtaler komprimeres ved 200.000 tokens (`limit.input`), også for modeller med 1M kontekst. Kald bliver ikke dyrere og langsommere, og en tænkende model får mindre at tænke over. Claude havde allerede dette valg.
- **Fejlkortet** tilbyder højst tre valg, når svaret stopper ved loftet:
  - "Prøv igen med lav indsats", når modellen tager imod `low`.
  - "Gør samtalen kortere og prøv igen", når samtalen har mere end én besked.
  - "Prøv igen".
- **Indsatsen:** En valgt indsats står under skrivefeltet og kan nulstilles under modellen. Den sendes som udbyderen forventer, kun når brugeren har valgt den, og den starter ikke en ny modelsession.
- **Ny samtale med planen blev til komprimering:** Brugeren valgte "Ny samtale med planen" i forslaget. Den er bygget som "Gør samtalen kortere" (OpenCodes `summarize`), fordi planen bor i samtalen. Komprimeringen bevarer plan, historik og filer uden at flytte noget.
- **Tænkende modeller markeres ikke for OpenCode.** I 1.18 styrer markeringen kun OpenCodes egne indsatsvarianter, som Aura ikke bruger. Aura bruger selv oplysningen om tænkning og indsats fra Cortis og OpenRouters kataloger og fra tabellen.

Afvejning: Et svar, der rammer det højere loft, koster mere end før. For corti-s1 er det omkring 1 USD ved 128.000 tokens mod omkring 0,26 USD ved 32.000. Til gengæld får modellen plads til at blive færdig. Lav indsats er den billige vej. Den 22. oktober tænkte corti-s1 ikke med `reasoning_effort: "low"` og svarede stadig rigtigt.

## Alexandra som fjerde ligestillede udbyder · til 0.5.0-beta.2 · 22. oktober 2026

Brugeren har valgt at vise Alexandra Instituttets AI-platform som fjerde fremhævede udbyderkort ved siden af Claude, Mistral og Corti, både i appen og i Aura-terminalen. Reglen i `AGENTS.md` er ændret til fire ligestillede valg; øvrige udbydere ligger fortsat bag "Vælg en anden". Ingen udbyder anbefales.

Ændringen er porteret fra Lasse Borlys PR #13. Platformen er Chat Completions-kompatibel på `https://inference.alexandra.dk/v1` med Bearer-nøgle. Vilkårene er kontrolleret på platformens egen dokumentation 21. oktober 2026: behandling på danske lokationer hos ScanNet (team.blue Denmark), ingen overførsel uden for EU/EØS, prompts og svar slettes efter svaret og logges ikke, og indhold bruges ikke til træning. Priserne er i DKK pr. million tokens og føres i en særskilt DKK-post. Standardmodellen `glm-5.3-flash` står som Alexandras eget udgangspunkt til kodeagenter; den eksperimentelle Qwen-model bliver aldrig standard. Ikonet er et bogstavmærke tegnet til Aura.

PR'en fandt også, at den første besked i Samtale, som er standardtilstanden, fejlede, før visningen "Før du sender" åbnede, fordi arbejdsmåden manglede i oversigten. Fejlen rammer alle udbydere i 0.4.0-beta.1 og 0.5.0-beta.1 og rettes i beta.2. Under porteringen er Alexandras ikon desuden tilføjet appens liste over tilladte udbyderikoner.

## Udgiv i stedet for Del, Corti EU-S og Promte-installationer · til 0.5.0-beta.2 · 22. oktober 2026

Brugeren har valgt ét ord for at lægge en app ud til andre: **Udgiv**. Knappen, funktionen (Udgivelse), forløbet, fejlbeskeder, agentens vejledning og skills bruger det. Interne id'er som `deling` er uændrede, så gemte indstillinger bevares. komplais og Promtes forløb forbliver forskellige, så længe de ligner hinanden; kun ordene er ensrettet.

Corti-nøgler fra projekter i EU-S (Sovereign), som KL-hackathonens, begynder med `eu-s:` og bruger `https://ai.eu-s.corti.app/v1`. EU-S står i Cortis konsol, ikke i dokumentationen; adressen er slået op 22. oktober og drives hos Scaleway i Frankrig ifølge IP-registeret. Afprøvet live med hackathonens nøgle: modelliste, Samtale, Planlæg og Byg.

Promte-integrationen fra PR 12 er lavet til installationer, der selv bygger kildekoden, fx kodning.promte.dk. En installation, der kun tager imod færdigbyggede apps (`uploadMode: built`, fx promte.kalundborg.dk), får nu en klar besked, og en installation uden appliste beder om arbejdsområdets ID med en forklaring. Aura tilføjer ikke færdigbyggede uploads til Promte.

## React-apps til komplai Run · lokal bygning · til 0.5.0-beta.2 · 22. oktober 2026

Brugeren har valgt, at Aura og ikke komplai bygger apps med et byggetrin, og at begge veje findes: Udgiv bruger en gemt byggemappe med `index.html`, ellers tilbyder Aura at bygge appen lokalt i en isoleret kopi af den gemte version efter brugerens ja, og uploader det byggede. komplai bygger intet, så fremmed kode køres aldrig på komplais servere.

Kravene: ingen nye installationer og ingen administratorrettigheder. Bygningen bruger Auras medfølgende Node og npm, kører i en midlertidig mappe under brugerens konto og uden pakkernes installationsscripts. Det, der virkede før, virker uændret: statiske apps udgives som hidtil, gemte opsætninger beholder deres mappe, og **Vælg en mappe i stedet** står altid ved bygningen. Promte (kodning.promte.dk) er uændret; dér bygger Promte selv. Afprøvet live 22. oktober med en React-app med Vite, bygget af Aura og udgivet til en eksisterende privat testapp i komplai Run.

## komplai Run i forhåndsvisningen og offentlige apps · til 0.5.0-beta.2 · 22. oktober 2026

Brugeren har valgt, at komplai Run får samme opbygning som Promte i forhåndsvisningen, med Hub som den, der svarer. Aura kopierer ikke komplais kode: forhåndsvisningen henter komplais officielle app-SDK fra Hub og sender SDK'ets kald gennem Aura. Hub giver en forhåndsvisning af personens egen app, også før udgivelse, med rigtig identitet, AI som personens egen Chat og Redact og gemte data i en særskilt, krypteret tabel. Brugeren har udtrykkeligt godkendt, at den native udgivelsesadgang må starte en sådan forhåndsvisning. Integrationen er slået fra som standard, og en app oprettes først efter brugerens klik.

Del beholder valget **Alle med linket** for nye apps med bekræftelse ved appens navn. komplai afviser at oprette offentlige apps direkte, så Aura opretter appen for organisationen og gør den offentlig med bekræftelsen før første upload.

komplai-loginet i Del viser kun **Log ind med komplai**. Brugeren har fravalgt "Kræver konto og betalt aftale" og linket "Få adgang til komplai", fordi det lød som salg. Udbyderlisten skriver "Kræver komplai-konto" som de andre udbydere, og fejlbeskeder beder om adgang hos jeres administrator i stedet for at kontakte komplai. Promtes tekster er uændrede.

Ændringerne hører til beta.2 sammen med den altid synlige Del-knap. komplai-delen releases af komplai og afprøves derefter mod den rigtige tjeneste.

## Promte i forhåndsvisningen · komplai Run efter beta.1 · 21. oktober 2026

Brugeren har flettet PR 12 med Promte-login, appvalg og forhåndsvisning med rigtige data ind i 0.5.0-beta.1. Forhåndsvisningen svarer kun en Promte-app, når Promte-integrationen er slået til. Aura opretter først en app i Promte, når brugeren vælger **Opret appen … i Promte**. Del er forudfyldt med `https://kodning.promte.dk`, som Promte selv foreslog i PR 12 (valgt 22. oktober til beta.2; i beta.1 var det `https://app.promte.dk`); en anden installation angives af brugeren. Forhåndsvisningen bruger projektets koblede app, den Promte, brugeren er logget ind på i Aura, ellers samme adresse.

komplai Run skal have en tilsvarende opbygning efter beta.1. Arbejdet begynder med at afklare, hvilke app-API'er komplai stiller til rådighed; Run er i dag statisk hosting uden data eller AI-proxy. Det er ikke implementeret.

## Del er altid synlig · aftalt til 0.5.0-beta.2 · 20. oktober 2026

Brugeren har valgt, at Del-knappen altid skal være synlig, også når der endnu ikke er en app at dele. Den eksisterende udgivelsesgennemgang og brugerens godkendelse bevares.

Implementeret i beta.2 22. oktober 2026: Er deling slået fra, viser Del ét trin, **Slå deling til**. Derefter starter det almindelige Del-forløb, også før appen har en gemt version, så login, app og adgang kan gøres klar, mens appen bygges. Brugeren fravalgte et særskilt trin "Der er endnu intet at dele". Først ved udgivelse kræves en gemt version, og Aura siger det med én sætning.

## komplai kun til udgivelse · 20. oktober 2026

Brugeren har besluttet at fjerne komplai som AI-udbyder i Aura og terminalværktøjet. komplai Run bevares under Del, inklusive browserlogin og særskilt udgivelsesadgang. Dette erstatter det tidligere fælles AI-/Publish-forløb beskrevet nedenfor.

Eksisterende AI-forbindelser bruges ikke længere til kataloger eller modelkald. Brugeren kan fjerne dem; projekter, samtaler, historisk forbrug og Run-adgang bevares. Et tidligere gemt modelvalg må ikke automatisk skifte til en anden udbyder.

komplai må heller ikke fremhæves i Del. Indgangen skelner mellem udgivelse fra Aura og vejledninger. Udbydere vises alfabetisk på lige fod, uden anbefaling eller forvalg; brugerens tidligere valgte destination kan genbruges.

## Systemkort og dataflow · 20. oktober 2026

Brugeren ønsker et løbende opdateret systemkort, som kan læses uden kendskab til kode. Det skal vise frontend, eksterne API'er, lokal lagring og eventuelle backends og databaser samt hosting, herunder komplai Run, Vercel og andre destinationer. Forbindelserne skal forklare, hvilke data der flyttes og hvor de gemmes, med relevante opmærksomhedspunkter om sikkerhed.

Hosting og dataflow skal med på kortet; de skal ikke fjernes fra Del. Dette er aftalt produktretning, ikke en implementeret fane eller en compliancegodkendelse.

## Flere udgivelsesformer · 20. oktober 2026

Brugeren ønsker en fælles guide til komplai Run, Promte Apps, Vercel, GitHub Pages, Cloudflare Pages, andre europæiske og amerikanske udbydere samt organisationens eget Azure-miljø. Guiden skal hjælpe med forbindelse, projektvalg og udgivelse. Udbyderens hjemland og de konkrete dataplaceringer skal holdes adskilt, og understøttelsen af frontend, backend og database skal fremgå af den valgte vej.

Brugeren ønsker også udgivelse som desktopapp, eksempelvis Electron med Windows-installation og Mac-DMG. Det er et særskilt forløb fra webhosting, hvor pakning, signering og opdateringer skal indgå. Desktop-pakning er fortsat produktretning. Den efterfølgende udgivelsesmilepæl tilføjer de webforløb, der er beskrevet nedenfor; den indeholder ingen pakning af brugerprojekter som EXE eller DMG.

## Fælles udgivelsesforløb · 20. oktober 2026

Promte Apps, GitHub Pages og Cloudflare Pages føjes til Del. Azure får guidet browserlogin og valg af abonnement og eksisterende app. De seks udbydere vises som en alfabetisk liste med logo og kontokrav, tre ad gangen. Promte og komplai kræver konto og betalt aftale. Ingen udbyder er anbefalet eller forvalgt.

Udbyderne bruger deres egne nødvendige trin inden for en fælles struktur. Browserlogin foretrækkes, når det understøttes. Komplai beholder OAuth uden at få særstatus. GitHub kan bruge browserlogin, når klienten er konfigureret, eller brugerens eksisterende CLI-login; adgangsnøgle ligger under hjælpen. Promte, Azure og Vercel bruger deres egne værktøjers browserlogin. Cloudflare-token til manuel CI gemmes i GitHubs hemmelighedslager.

Vercel får en særskilt vej til sin Git-integration. Brugeren forbinder sit repository hos Vercel og bekræfter projektet i Aura. Vercels produktionsbranch og preview-udgivelser vises særskilt. Den fælles status ved Del gælder alle udbydere; udgivelsesstatus må ikke forveksles med kontrolleret indhold eller adgang.

GitHub Pages og Cloudflare Pages får versionerede opsætningsfiler og manuelle workflows. Brugeren gennemgår filerne, gemmer og sender dem med sit Git-værktøj og godkender derefter én konkret udgivelse i Aura. En ændret Git-version eller ændret destination kræver ny gennemgang. Der aktiveres ingen automatiske Actions-workflows af dette valg. Vercels automatiske Git-builds aktiveres særskilt hos Vercel.

Omfang og udført verifikation står i [teststatus](teststatus.md). De nye flows udgiver ikke selve Aura og ændrer ikke de allerede offentliggjorte installationspakker.

## Fælles Harness og to brugsveje

Retning afklaret i projektsamtalen 28. september 2026. Dette er ikke en formel vedtagelse på vegne af deltagende kommuner.

AI Harness skal samle en fælles arbejdsmetode for kommunal udvikling med AI fra idé til drift. Indholdet skal hjælpe både nye og erfarne brugere med kodekvalitet, sikkerhed, databeskyttelse, kontrol over data og overdragelse. Det skal kunne bruges gennem eget kodeværktøj og en selvstændig webguide eller samlet i desktopappen. README og hjemmesidens forside skal forklare formålet og give de to veje samme vægt.

[Det faglige grundlag](harness-grundlag.md) indeholder research og forslag til skills, teknologivalg og integration. [Projektkontrol](projektkontrol.md) beskriver forslag til konkrete risikoregistreringer, versionsbundne beslutninger, Git og tilslutning af eksisterende projekter. De tekniske forslag er endnu ikke implementeret eller godkendt som organisationspolitik. Tekstinstruktioner må ikke omtales som teknisk håndhævelse eller en garanti for GDPR.

## Præcisering af målgruppe og teknisk grundlag

Afklaret i projektsamtalen 28. september 2026: Den primære målgruppe er udviklere, IT-medarbejdere og teknisk interesserede kolleger, som vil bygge med AI, men ønsker hjælp til kode og udviklingsarbejdsgang. De skal fortsat kunne tage stilling til tjenester, data og hosting med deres organisation. Guidet opstart og et enkelt sprog bevares. Harness kræver ikke et Promte-abonnement; det indebærer ikke, at valgte modeller eller hostingtjenester er gratis.

Kildegennemgangen bekræfter det oprindelige forslag om en egen brugerflade og konfiguration omkring OpenCode uden en fork. Det samlede forslag om organisationsstyring, revisionsspor og isolation er ikke implementeret. Pi skal vurderes som mulig alternativ motor; der er ikke besluttet eller udført et skift. Se [teknisk grundlag](teknisk-grundlag.md).

## Plan for Auras brugerflade · 5. oktober 2026

Brugeren ønsker en plan på grundlag af UX-gennemgangen af *Aura – designforslag og komponentguide* fra 1. oktober 2026. [Planen for Auras brugerflade](ux-plan.md) samler forbedringerne i syv milepæle, med bevarelse af branding, systemskrift og store bokse. Første milepæl samler arbejdsfaner, kodeindsigt, ændringsgennemgang og faktisk aktivitet.

Planen er skrevet; implementeringen afventer brugerens gennemgang. Den indfører ikke en fuld editor, interaktiv terminal, ny teknologistak eller nye hosting- og adgangssystemer. Efter hver milepæl gennemføres relevant verifikation, før brugeren gennemgår og selv håndterer Git.

Første milepæl, arbejdsfladen, er implementeret 5. oktober 2026. Valg i implementeringen, som kan ændres:
- **Tilskrivning:** En fil står kun som AI'ens, når AI'ens eget filværktøj skrev præcis det indhold, der ligger nu. Ændringer under en opgave uden AI'ens filværktøjer står som "En kommando eller dig" eller "Ikke AI'en". Hellere for forsigtig end at give AI'en æren for brugerens rettelser.
- **Sammenligningsgrundlag:** Pr. AI-opgave er det filerne ved opgavens start; for hele samtalen filerne, da den første opgave startede. Ændringer og aktivitet huskes i appens hukommelse, mens den er åben, og gemmes ikke på disken. Ældre ændringer findes under Versioner.
- **Filhenvisninger til AI'en:** Kun stien og eventuelle linjer sendes, og AI'en læser selv filen med sine værktøjer. Henvisningen indgår i samtykket, så Før du sender vises igen, men den starter ikke en ny modelsession.
- **Sidepanelet** foldes sammen af brugeren og automatisk, når vinduet er smallere end 760 CSS-pixels, fx med 150 % tekst ved 980 × 720.

Anden milepæl, afklaring og plan, er implementeret 6. oktober 2026. Brugeren valgte:
- **Placering:** brief og plan står i en femte fane, Plan. Spørgsmål og knappen Byg står i samtalen.
- **Rettelser:** planen kan rettes direkte og af AI'en. Brugerens version bruges ved bygning, og AI'ens version kan hentes igen.
- **Briefen** udfyldes kun fra idéen, ønskerne og svarene. AI'en skriver ikke i den.

Valg i implementeringen, som kan ændres:
- **Spørgeværktøjet:** OpenCode tilbyder kun værktøjet til sine egne klienter (`app`, `cli`, `desktop`). Aura melder sig som `harness` og slår det til med `OPENCODE_ENABLE_QUESTION_TOOL`. Før dette kunne AI'en ikke stille spørgsmål med svarmuligheder gennem Aura.
- **Spring over** svarer, at AI'en skal vælge selv og skrive antagelsen i planen. Et afvist spørgsmål stopper opgaven i OpenCode, og brugeren ville så stå uden plan.
- **Afbrudte planer:** Den tidligere beslutning gælder stadig: en plan fra en stoppet, fejlet eller afbrudt opgave må ikke bygges direkte. Den gemmes som seneste plan, kan læses under Plan og kan bruges som udgangspunkt for en ny planlægning.
- **Briefen følger projektet** og bevares ved Ny samtale. Ønskerne fra Ønsker til løsningen kommer i briefen, når planlægning er slået til.

Tredje milepæl, godkendelser og fejl, er implementeret 6. oktober 2026. Brugeren valgte:
- **Kontrol af forhåndsvisningen:** efter en opgave genindlæser Aura siden og siger, om den blev vist, og om den skrev fejl i konsollen. Aura klikker ikke og tester ikke funktioner.
- **Afvisning:** Afvis stopper opgaven som før; Afvis med en besked lader AI'en fortsætte med beskeden.

Valg i implementeringen, som kan ændres:
- **Fejltyper:** gatewayen giver hver fejl en type ud fra HTTP-status eller afbrydelse (nøgle, adgang, kvote, grænse, model, server, forbindelse, stilstand og motor). Typen afgør forklaring og handling. Aura forsøger stadig aldrig igen af sig selv.
- **Én status:** fejl under en opgave vises kun på resultatkortet. Advarselsboksen over samtalen bruges kun, når modelkataloget ikke kan læses før afsendelse.
- **Kontrollen** bruger Electrons konsolbeskeder og HTTP-status for previewets ramme i hovedprocessen. Previewets isolation og indholdspolitik er uændrede.

Fjerde milepæl, rettelser i forhåndsvisningen, er implementeret 6. oktober 2026. Brugeren valgte:
- **Tekstrettelse i et felt i Aura,** ikke direkte i siden. Siden forbliver uændret, mens man skriver, og det virker ens for HTML, React og Astro.
- **Gem straks med Fortryd.** Rettelsen står under Ændringer som brugerens egen.
- **Fortryd virker altid:** med versionen, når opgaven er gemt som version, ellers fra Auras øjebliksbillede, så længe appen er åben. Det gælder alle AI-opgaver.

Valg i implementeringen, som kan ændres:
- **Valgscriptet** indsættes fra hovedprocessen i previewets ramme, kun mens brugeren har slået Ret i siden til, og fjernes igen. Sandbox, indholdspolitik og netværksregler er uændrede, og siden får ingen IPC eller preload. Det, siden sender tilbage, er upålidelige data og renses i hovedprocessen. Electron kan kun køre scriptet i sidens egen verden, så sidens eget script kan se markeringen.
- **Direkte rettelse kun ved ét sikkert sted:** teksten skal stå ét sted i kildefilerne, på den viste side eller i det rette tag. Kommentarer, scripts, genererede mapper og beskyttede filer tæller ikke. Ellers siger kortet hvorfor, og AI'en er vejen videre. Aura gætter ikke.
- **Tegn, der kræver kode,** fx `{` i JSX eller Astro, rettes ikke direkte. `&`, `<` og `>` skrives som HTML-tegnkoder i HTML-filer.
- **Beskrivelsen til AI'en** kommer fra Auras eget valg i hovedprocessen og står ordret under Før du sender. Den indgår i samtykket som en filhenvisning, men starter ikke en ny modelsession. Den statiske servers nøgle i adressen sendes ikke.
- **Øjebliksbilleder:** en fil, Aura kun kunne læse før eller efter en opgave, fx fordi den blev for stor, tælles nu som udeladt og ikke som ny eller slettet. Det gør Ændringer mere præcis og forhindrer, at Fortryd sletter en fil, der fandtes før.

Femte milepæl, visuel historik, er implementeret 6. oktober 2026. Brugeren valgte:
- **Placering:** historikken står under Ændringer som visningen Versioner ved siden af Denne samtale. Dialogen Versioner er fjernet; projektmenuen åbner samme sted.
- **Billeder:** Aura tager automatisk billeder af forhåndsvisningen før og efter hver AI-opgave og gendannelse og efter en version, du selv gemmer. De gemmes kun i appens data på denne computer.
- **Fortryd beholder dine rettelser:** kun opgavens egne ændringer fjernes. Rører du og opgaven de samme linjer, afgør du det.
- **Navne:** Aura navngiver versionerne, og du kan omdøbe dem i Aura uden at ændre Git.

Valg i implementeringen, som kan ændres:
- **Billederne** tages i et skjult vindue med sin egen session uden lagring, uden preload og Node og kun med adgang til forhåndsvisningens adresse. Størrelsen er forhåndsvisningens, og siden er den, brugeren ser. De ældste ryddes efter 80 billeder pr. projekt.
- **Fletning** sker linje for linje i Aura (`core/merge.cjs`), ikke med Git, så den virker uden Git. Konflikter afgøres med ét valg for alle konflikter i én gennemgang; dine linjer er anbefalet.
- **Ugemte ændringer** i de filer, en gendannelse eller fortrydelse ændrer, gemmes først som en version, når automatiske versioner er slået til. Ellers bevares de i kopien før gendannelsen.
- **Fortryd uden Git** bruger samme gennemgang, kopi og journal som med Git, så også en fortrydelse uden versioner kan fortrydes.
- **Gendannelser og fortrydelser** får navne, der nævner versionen, de handler om, fx "Tilbage til »…«", så de ikke forveksles med den.

Sjette milepæl, navigation, deles i to. Første del (6A) er implementeret 6. oktober 2026. Brugeren valgte:
- **Kommandopalet:** kun ⌘K og en omtale i Hjælp; ingen ny synlig knap.
- **Starteksempler** er eksempler på idéer, der udfylder "Beskriv din idé". AI'en bygger dem, når projektet startes.
- **Genoptagelse** som i Codex og Claude Code: de seneste projekter i sidepanelet med samtalerne under hvert projekt, flere samtaler i samme projekt og + til en ny samtale.
- **Flere AI-opgaver på én gang** i samme projekt, men ikke på tværs af projekter. En kopi af projektet bruges kun, når en anden samtale allerede arbejder.

Valg i implementeringen, som kan ændres:
- **Én fil pr. samtale.** Projektfilen har briefen og oversigten; hver samtale har beskeder, kladde, plan, forbrug og OpenCodes sessions-id. Den tidligere samtale og arkiverede samtaler flyttes ved første åbning, og arkivet bevares.
- **AI-sessionen fortsætter** pr. samtale, når forbindelse, model og regler er de samme som sidst; ellers startes en ny, og Aktivitet siger det.
- **I 6A arbejder én samtale ad gangen** i projektmappen. De andre kan skrives i, og deres Send venter med en forklaring. Godkendelser, spørgsmål og resultater hører til den samtale, der stillede dem, også mens en anden er åben.
- **Kopi frem for Git-worktrees i 6B:** samtidige opgaver får hver sin kopi, som Aura laver og rydder op. Implementeringen bruger `fs.copyFile` med `COPYFILE_FICLONE`, som deler filindhold på understøttede filsystemer og ellers kopierer almindeligt. På macOS medtages `node_modules` med interne links til kopiens egne pakker; andre platforme installerer pakker efter gennemgang. Et worktree ville starte fra sidste commit uden de ugemte ændringer, kræve Git og tilføje grene. Kopien flettes ind med samme gennemgang som Fortryd og gendannelse.
- **Paletten** trykker på appens egne knapper, så valgte funktioner og låste handlinger gælder også dér. Genvejen fanges i hovedprocessen, så den også virker med fokus i forhåndsvisningen.

### Anden del: samtidige opgaver · 7. oktober 2026

- Hver opgave reserverer sin arbejdsmappe fra opstart til afslutning. Kun en optaget projektmappe udløser en ny kopi; en allerede uflettet kopi bruges videre af samme samtale. Samtaleskift låses ikke af en motors opstart.
- Grundlaget gemmes fra den oprettede kopi, så en samtidig ekstern rettelse under kopieringen ikke fejlagtigt tilskrives AI'en. Hver kopi har sit eget runtime, sin motor og sine preview-servere. Godkendelser og Stop følger samtalen.
- Indfletning kræver ledigt projekt og ledig kildekopi samt en aktuel gennemgang af begge. Default ved konflikt er brugerens linjer. Indfletningen registreres som brugerens godkendte handling, så brugerlinjer ikke tilskrives AI'en.
- Automatiske versioner gælder i projektet, når funktionen er aktiv. Kopier indeholder ingen `.git` og opretter ingen versioner. Previewbilleder før og efter indfletningen hører til det faktisk flettede projekt og bindes til versionen. Journalen gemmer indfletningens før- og efterindhold, så Fortryd også uden Git fjerner netop indfletningen og bevarer senere brugerrettelser med konfliktvalg ved samme linjer.
- Uflettede kopier bevares ved lukning og genstart, også hvis manifestet ikke længere kan læses. Kun dokumenterede uafsluttede oprettelser med deres egen markør og allerede indflettede kopier ryddes automatisk. Sletning kræver den eksisterende bekræftelse med en præcis advarsel om kopiens filer.
- Størrelsesgrænser og filbeskyttelse gælder også indfletning. Hvis en ændring ikke kan gennemgås, afvises indfletningen, og kopien bevares til manuel behandling. Godkendte kommandoer har fortsat brugerens OS-rettigheder.

## Få valg og udvælgelse af skills · 29. september 2026

Besluttet i projektsamtalen: Hvert beslutningspunkt har ét eller to hovedvalg og højst tre til fire synlige muligheder med resten bag ét link, fx "Bruger du en anden udbyder? Vælg en anden". Opsætningen skal kunne gennemføres uden tvivlsspørgsmål af en person uden teknisk baggrund. Reglen står i `AGENTS.md` og `desktop/DESIGN.md`.

Skills kan vælges til og fra som i en cookie-dialog: grundreglerne er altid med, og de 12 skills er delt i fire kategorier, som kan slås til og fra samlet eller enkeltvis. Udvalget gemmes i `.harness/installation.json` og bruges igen ved næste installation. Henvisninger mellem skills skal tåle, at den anden skill er fravalgt.

Standardvalg i implementeringen, som kan ændres i kataloget eller koden: fire fremhævede kodeværktøjer (Claude Code, GitHub Copilot, Codex og Cursor), tre udbyderkort (Claude, Mistral og Corti) og anbefalede modeller pr. udbyder i `desktop/ui/model-advice.js`.

## Fælles bibliotek og installation i eget kodeværktøj · 29. september 2026

Besluttet i projektsamtalen: Standardvalgene i [det faglige grundlag](harness-grundlag.md) er grundlaget for skillsene, det skal være let at læse om hver skill som en FAQ, og pakkerne skal dække flere værktøjer end Claude Code, Codex og OpenCode.

Tekniske valg i implementeringen:

- **Én kilde:** `profiles/catalog.json`, `profiles/grundregler.md` og `profiles/skills/` er kilden til appens installation, `scripts/harness.cjs`, webguidens ZIP-pakker og de genererede sider. Filplaceringer pr. værktøj er data, ikke kode.
- **Portable skills:** navne med præfikset `harness-` i ASCII, kun `name` og `description` i frontmatter, kun Markdown og ingen scripts eller værktøjstilladelser. Menneskelige beskrivelser og kilder står i kataloget, instruktionerne til agenten i SKILL.md.
- **Regler:** `AGENTS.md` er fælles regelfil. Claude Code og Gemini CLI får en `CLAUDE.md` eller `GEMINI.md`, der importerer den, så indholdet ikke står to gange. Aider og Zed kræver særskilt opmærksomhed og er beskrevet i deres forbehold.
- **Skillmapper:** så få mapper som muligt, så alle valgte værktøjer kan se skillsene; `.agents/skills` dækker de fleste. Ved lige dækning vælges værktøjets egen foretrukne mappe.
- **Sikker installation:** afgrænsede afsnit mellem faste markører i eksisterende filer, aldrig overskrivning, `.harness/installation.json` med version og kontrolsummer, konflikter ved ændrede filer, gennemgang med engangsnøgle og fjernelse af kun uændrede filer. Installationen gælder ét projekt ad gangen.
- **Udgåede værktøjer:** Continue og Roo Code får ingen pakker, fordi de ikke længere udvikles.
- **Appens egen agent:** bruger fortsat sine egne instruktioner, nu i `profiles/app`. Overgangen til det fælles bibliotek med indlæsning efter behov er en særskilt beslutning, fordi den ændrer den afprøvede agentadfærd. *Afløst 30. september 2026: appens AI bruger nu det fælles bibliotek. Se [Funktioner og ét fælles skillbibliotek](#funktioner-og-ét-fælles-skillbibliotek--30-september-2026).*

## Historiske møde- og produktnotater

**Aktuel implementeringsstatus:** POC 1 er implementeret. POC 2 omfatter lokal kodeagent via OpenCode 1.17.15, modeladaptere, synlige skills, dataoplysninger, vilkårlig projektåbning og genbrugelige designpakker. Se [desktopvejledningen](../desktop/README.md) for den faktiske verifikation og begrænsninger. Noterne nedenfor er historiske.

Meeting input · 22 September 2026

These records capture the project discussion, not formal approval by all participating organisations. No implementation has begun. The working name is **AI Harness** (`ai-harness`); municipal use is the initial context rather than a restriction on who can adopt it.

## AI Alliancen context

The [AI Alliancen website](https://ai-alliancen.org/) describes an independent professional network and introduces Agent Harness as an architecture proposal involving controls outside the agent. Its [member page](https://ai-alliancen.org/medlemmer) emphasises reusable experience across organisations and states that membership is not a product endorsement. Its [principles and meeting charter](https://ai-alliancen.org/charter) are explicitly a draft awaiting shared discussion and approval. These sources provide context, not adopted project governance or confirmed partner commitments. Reviewed 22 September 2026; the detailed knowledge page could not be retrieved during this review.

## Current direction

1. **Modular foundation.** The interface, client adapters, model connections, profiles, organisation configuration, execution controls, deployment, and evidence can be adopted separately, subject to documented dependencies.
2. **Approachable first-party interface.** Explore a downloadable application using OpenCode as its local coding backend. Do not require ordinary participants to operate a terminal.
3. **Other clients remain possible.** Design shared services and configuration contracts so participants can use existing coding clients. Do not promise equivalent support before testing each integration.
4. **Local workspaces for the POC.** Participants build on their laptops. This supersedes the earlier recommendation for centrally hosted coding workspaces. Local isolation and dependency installation remain design decisions.
5. **One real event organisation.** Assign participants to a shared Hackathon organisation. Store its configuration as organisation data rather than hardcoded application-wide settings.
6. **Individual access.** Shared organisation membership does not grant access to everyone else's projects. Service credentials and deployment permissions must be scoped and revocable.
7. **Optional organisation management.** Later deployments can inherit municipal configuration through verified organisational sign-in. Independent use remains possible without that service.
8. **Guided deployment.** Treat hosting as a separate module. Explain configuration, provider compatibility, secrets, audience, costs, checks, and recovery. Verify the actual hosted application.
9. **Open contribution model.** Providers and municipalities should be able to contribute model integrations, tool/data connectors, hosting adapters, profiles, and templates under documented contracts and tests.
10. **Evidence over blanket guarantees.** State exactly which version, environment, and configuration was tested. Guidance, enforced restrictions, application quality, and operational approval are distinct claims.

## Questions for upcoming meetings

### Product and event

- Which operating systems and managed municipal laptop restrictions must we support?
- Who are the participants, and what facilitator support will be available?
- Which concrete application tasks should demonstrate success?
- What is the required client coverage for the event, and what can be labelled experimental?
- Are only synthetic/public data permitted? Who approves the event data policy?
- Is the event outcome a preview, a persistent application, or both?

### Identity and organisation configuration

- How do participants enrol in the Hackathon organisation: invitation, event login, or existing identity providers?
- Which settings are adjustable defaults and which are mandatory restrictions?
- Who administers the event, approves publication, and can revoke access?
- Which event records are retained, for what purpose, and for how long?

### Local execution and service access

- What local sandbox mechanism supports each required OS, and what are its demonstrated limits?
- How does installation work without requiring unsupported administrator access?
- Which services must be reachable from municipal networks?
- Which credentials remain service-side, and which scoped tokens are issued to clients?
- How does each supported client inherit guidance and authenticate to shared services?

### Models and hosting

- Which actual model endpoints and versions are available, and what capacity is reserved for concurrent use?
- Which hosting integrations will partners supply, and under what licenses and operating responsibilities?
- Which application capabilities must deployments support: databases, persistent files, authentication, jobs, or external connectors?
- Who owns the hosting accounts, costs, application domains, backups, and post-event operation?
- What happens to previews, project data, and participant access after the event?

### Project stewardship

- Confirm repository name and whether discussion documents are public now.
- Select the project license and contribution terms before accepting reusable code contributions.
- Name maintainers and define how architectural decisions are accepted.
- Agree how integrations become verified and how vulnerabilities are reported privately.

## Recording later decisions

For each material decision, record the problem, chosen approach, responsible owner, consequences, and evidence needed to revisit it. Distinguish a proposal from an accepted decision. Record partner capabilities as unverified until confirmed and exercised.

## Opdateret POC-retning

- **POC 1:** En enkel dansk hjemmeside med download af fælles AI-instruktioner og værktøjsspecifikke vejledninger til Claude Code, Codex og OpenCode. Ingen konti, modelkald eller central styring i denne POC.
- **POC 2:** En installerbar app til Windows og Mac med lokal agentmotor og brugerens egne modelforbindelser. Samtalen vises til venstre og en løbende forhåndsvisning af den applikation, der bygges, til højre. Forhåndsvisningen skal afspejle de aktuelle ændringer og vise forståelig status ved opstart og fejl. De to POC'er skal dele konfigurationsgrundlag.
- Disse præciseringer erstatter tidligere beskrivelser af den første POC som en samlet desktop-, organisations- og hostingløsning. Den bredere arkitektur er fortsat en fremtidig retning.
- **POC 2, oplevelse:** Lovable-inspireret brugerflade med en lokal live-server. En fremtidig “Gem”-handling skal kunne oprette et Git-commit efter en synlig gennemgang af de relevante ændringer. En separat “Deploy”-handling skal udgive til den valgte, konfigurerede destination. Dette er produktfunktioner til senere afklaring og ændrer ikke reglen om, at assistenten ikke laver commits i dette repository.
- **POC 2, projektoprettelse:** Hjælp brugeren fra idé til et lokalt projekt gennem en enkel samtale. Spørg efter navn og formål, og afklar kun de valg, som kræver brugerens stillingtagen. Teknologi, kodekonventioner og teststrategi skal have forståelige standardforslag og kunne tilpasses af interesserede brugere; de må ikke være obligatoriske tekniske spørgsmål for alle. Appen opretter den aftalte mappestruktur og bevarer projektvalgene uden at kræve en særskilt dokumentarbejdsgang. Undersøg eksisterende indhold før oprettelse. Dette er et designkrav, ikke en implementeret funktion.
- **POC 2, platforme:** Første desktopversion skal understøtte både Windows og macOS. Afprøvning skal dokumenteres særskilt for hvert operativsystem; en vellykket Mac-kørsel er ikke en Windows-verifikation.
- **POC 2, opsætning:** Understøt både eksisterende udviklingsværktøjer på maskinen og en guidet opsætning for brugere uden dem. Undersøg eksisterende installationer først. Vis nødvendige installationer og tilladelser, og overskriv ikke brugerens værktøjer eller maskinopsætning uden konkret godkendelse. Den tekniske distributionsmekanisme er endnu ikke valgt.

## Inspiration til POC 2: Hamster (ikke valgt som hovedretning)

Følgende er forslag til drøftelse, ikke nye accepterede funktioner. Grundlaget er brugerens indsendte produkttekst og Hamsters offentlige produktsider, læst 22. september 2026. Produktet er ikke afprøvet i en indlogget session.

- **Projektgrundlag adskilt fra den aktuelle opgave:** Hamster beskriver [Blueprints](https://tryhamster.com/product/studio/blueprints) som produktkontekst og [Briefs](https://tryhamster.com/product/studio/briefs) som grundlag for en ændring. Hos os kan init-fasens godkendte valg være projektgrundlaget, mens hver efterfølgende ændring får en kort opgavebeskrivelse.
- **Synlige kriterier før kode:** Hamsters [Plans](https://tryhamster.com/product/studio/plans) forbinder opgaver med acceptkriterier. Forslag: vis i almindeligt dansk, hvad brugeren skal kunne gøre, og hvordan resultatet afprøves, før agenten starter.
- **Beslutninger skal følge projektet:** Hamsters [CLI](https://tryhamster.com/product/studio/cli) beskriver overførsel af kontekst til kodeværktøjer. Forslag: gem vores godkendte projektgrundlag og planer i læsbare lokale filer, så bruger og agent arbejder ud fra samme oplysninger. Det indebærer ikke en Hamster-integration.
- **Skeln mellem forslag og godkendt retning:** Vis agentens foreslåede ændringer til planen, før de erstatter godkendte valg. En teknisk ændring må ikke ubemærket ændre formålet eller teststrategien.

En kontekstgraf, mødeoptagelse, Slack-integration og teamsamarbejde fra Hamsters bredere produkt er ikke tilføjet til POC 2's omfang. Der er endnu ikke valgt en integration eller afhængighed til Hamster.

## Præcisering: et værktøj til at bygge og udgive

POC 2 skal primært gøre det muligt for ikke-tekniske brugere at vibe-code og hoste deres egne applikationer. Hamsters dokument- og planlægningsorienterede arbejdsgang er ikke valgt som produktets hovedretning.

- Brugeren beskriver ønsket i samtalen og ser resultatet i en lokal live-forhåndsvisning.
- Appen hjælper med Git, npm-pakker, nødvendige udviklingsværktøjer og Docker, hvor projektet kræver det, uden at forudsætte terminalkendskab.
- Første version skal tilstræbe både brugerens eget Claude-abonnement og en Anthropic API-nøgle, hvor den konkrete integration er understøttet og tilladt. Abonnementsadgang er en ønsket mulighed, ikke en verificeret produktfunktion. Agentmotor og loginform holdes adskilt fra brugerfladen. OpenCode er fortsat en kandidat, ikke et krav der må forhindre denne brugerrejse.
- Deployment skal være leverandøruafhængig gennem udskiftelige hostingadaptere. Azure er kun et eksempel sammen med Vercel, Hetzner, Promte og egne servere; ingen af disse er valgt som obligatorisk eller verificeret destination. Hver adapter skal beskrive understøttede applikationstyper, nødvendige tjenester, konfiguration, udgivelse og kontrol af resultatet. “Alle steder” er målet for udvidelighed, ikke et løfte om, at enhver app fungerer uændret på enhver host. Konto, ressourcevalg og omkostninger afklares ved opsætning.
- Lokal udvikling, egne modelforbindelser, Windows/macOS og de to opsætningsmuligheder fastholdes. Fælles profiler fra POC 1 skal støtte arbejdet i baggrunden.

Dette præciserer produktretningen; der er endnu ikke implementeret desktopfunktioner eller valgt en bestemt hostingtjeneste.

## POC 2: modulære forbindelser og visuel opstart

- **Uafhængige valg:** Brugerflade, agentmotor, model/login, lokal værktøjsopsætning, projektprofil og hostingforbindelse skal kunne udskiftes gennem afgrænsede grænseflader. Adaptere angiver deres faktiske muligheder; de må ikke foregive fuld kompatibilitet, når en funktion mangler.
- **Claude med API-nøgle:** Brug en dokumenteret API-/SDK-integration. Opbevar nøglen beskyttet, vis den valgte betalingsform, og skift ikke automatisk fra abonnement til betalt API-brug ved en fejl eller opbrugt kvote.
- **Claude med abonnement:** Bevar dette som krav under ekstern afklaring. Agent SDK-dokumentationen kræver forudgående godkendelse for at tilbyde claude.ai-login eller abonnementskvoter i tredjepartsprodukter. En eksisterende lokal login-session eller teknisk mulighed er ikke i sig selv dokumentation for tilladelse til vores distribution. Undgå tokenudtræk og identitetsmaskering som integrationsvej.
- **Designmateriale ved opstart:** Tilbyd et valgfrit trin, hvor brugeren kan vælge referencebilleder og andre inspirationsfiler fra maskinen, tilføje links til designguides, angive brandfarver og vælge logoer eller øvrige grafiske filer. Tilbyd også at fortsætte uden materiale og lade agenten foreslå en retning.
- **Appen organiserer materialet:** Brugeren vælger filer gennem brugerfladen; appen placerer kopier i passende projektmapper uden at overskrive eksisterende filer. Hold referencer adskilt fra aktiver, der skal offentliggøres med appen. En intern designguide må ikke automatisk ende i det offentlige webindhold. Forklar hvilke valgte materialer der deles med den tilsluttede model.
- **Visuel feedback:** Lad brugeren se og korrigere den foreslåede anvendelse af farver og logo i live-forhåndsvisningen. Gem valgene med projektet, så senere ændringer følger dem. Dette er en del af den enkle byggeoplevelse, ikke en obligatorisk dokumentproces.

### Kildegrundlag for Claude-forbindelser

Officiel dokumentation læst 22. september 2026; ingen login- eller modelkald afprøvet:

- [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview): API-nøgle er den dokumenterede start; tredjepartslogin kræver forudgående godkendelse.
- [Loginvejledning](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account): produktudviklere henvises til API-nøgler eller understøttede cloududbydere.
- [SDK med Claude-abonnement](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan): opdateringen øverst beskriver en pauseret ændring af afregning og fortsat abonnementsforbrug. Den historiske tekst nedenunder er markeret som ikke trådt i kraft på den annoncerede dato. Siden etablerer ikke i sig selv en godkendelse af vores produkt.

Konsekvens: arkitekturen skal give plads til begge forbindelser, men abonnementsadapteren må ikke præsenteres som tilgængelig, før adgang, afregning og produktgodkendelse er afklaret. Dette blokerer ikke design og implementering af resten af den modulære app.

## POC 2: første desktopmilepæl og designretning

Electron er valgt til det første desktopgrundlag. Projektoprettelse og lokal forhåndsvisning er adskilte moduler uden Electron-afhængighed. UI og native filhandlinger forbindes gennem en begrænset IPC-bro. Agentmotor, loginform og hostingudbyder er fortsat åbne, separate integrationsvalg.

Brugerfladen skal ligne et arbejdsredskab i stil med Codex, Claude Code og OpenCode: kompakt navigation, neutrale farver, diskrete værktøjslinjer og sammenhængende paneler. Store kampagneoverskrifter, kortbaseret landingpage-layout og dekorativ websitebranding er fravalgt. Det gælder selve værktøjet; de applikationer, brugeren bygger, kan have deres eget visuelle udtryk.

Denne milepæl omfatter nye lokale projekter med navn, idé, brandfarve, referencelinks og kopier af logoer/referencefiler; fælles AI-regler; genåbning; og automatisk genindlæsning af en statisk startside ved filændringer. AI-chat, Git-handlinger, npm-/Docker-opsætning, hosting og distributionspakker er endnu ikke implementeret. Windows er målplatform, men kræver særskilt afprøvning. Se [desktopvejledningen](../desktop/README.md) for verifikationsniveau og begrænsninger.


## POC 2: agent og genbrug af design · 23. september 2026

OpenCode er den første udskiftelige agentadapter. Modelnøgler beskyttes i appens datamappe og sendes ikke ind i projektets konfiguration. Et projekt kan åbnes uden manifest og uden filændringer. Modelvalg, skill-tilpasninger og navngivne designpakker gemmes uden for repositoryet. Designpakker indeholder farve, links og kopier af materialer; brugeren vælger stadig særskilt, hvilke referencer modellen må læse.

Modelplacering, arbejdsområde og hosting skal forblive separate moduler. Kun lokalt arbejdsområde er implementeret. Kommunal styring, cloud-login og remote eksekvering kræver en afklaret host og rettighedsmodel; de fremstilles ikke som aktive funktioner. Ingen bestemt hostingudbyder er obligatorisk. Skills er synlige instruktioner, ikke en erstatning for adgangskontrol. Godkendte kommandoer kører med brugerens lokale rettigheder.

## Første resultat uden spørgsmål · 29. september 2026

En begyndergennemgang af den rigtige app bestod af 30 skærmbilleder med en ren profil, Claude-kortet og en kontrolleret model. Den fandt syv knaster:
- en generel nøglehjælp
- en tvungen modeldialog før første besked
- et langt datavindue, der blev vist både ved plan og ved bygning
- en godkendelse pr. fil med en fuld systemsti
- projektnavne som "En oversigt over tre fiktive mødelokaler, hvor"
- mappenavne, hvor æ og ø forsvandt
- en grænse på 4.096 svartokens for alle modeller

Brugeren besluttede, at testerne selv skaffer en nøgle hos Anthropic, og at filændringer godkendes én gang pr. opgave.

- **Godkendelse pr. opgave:**
  - "Tillad for denne opgave" gælder kun filændringer, som OpenCode sender med en fuld sti inden for projektmappen.
  - `.git`, `.env*`, `*.key` og `*.pem` godkendes aldrig automatisk. Kommandoer, web og filer uden for projektet spørger hver gang.
  - Tilladelsen nulstilles, når opgaven slutter eller stoppes.
  - Afgørelsen træffes i `Workbench`, ikke i brugerfladen. Grunden er, at OpenCode regner stier relativt til Git-roden eller til computerens rod, når projektet ikke har Git.
- **Accepterede vilkår huskes pr. projekt:**
  - Højst ti sæt vilkår huskes. Nøglen dækker forbindelse, adresse, model, rute, modtager, behandlingssted, opbevaring, træning, pris, sikkerhed, referencer og medsendt samtale.
  - Arbejdsmåde og skills indgår ikke. Derfor vises resuméet ikke igen ved skift fra plan til bygning.
  - Afsendelsen kræver fortsat fingeraftrykket for den aktuelle forberedelse.
- **Forvalgt model:** For Claude, Mistral og Corti vælges den anbefalede model, når projektet åbnes. Det erstatter det tidligere princip om et aktivt modelvalg. Modellen står i skrivefeltet og i resuméet før første afsendelse. Andre forbindelser kræver fortsat et valg.
- **Tokengrænser:**
  - Kendte modeller får dokumenterede grænser, og tal fra modelkataloget har forrang. Claude får 32.000 svartokens, som er OpenCodes loft.
  - Konteksten sættes til 200.000 tokens, selv om Claude 5 kan rumme en million. Det holder prisen pr. kald nede.
  - Ukendte modeller beholder 32.768 og 4.096.
  - Gatewayen afbryder nu efter to minutters stilstand i stedet for tre minutter i alt, med et samlet loft på 20 minutter. Et langt, men levende svar når dermed igennem.
- **Vilkår og priser med kilde:** Kontrolleret 29. september 2026.
  - **Anthropic** behandler data globalt uden EU-mulighed. Data slettes inden for 30 dage og bruges ikke til træning som standard. Sonnet 5.5 koster 2/10 USD pr. million tokens.
  - **Mistral** hoster data i EU, men `api.mistral.ai` lover ikke, hvor behandlingen sker. Gratisplanen må træne på data.
  - **Corti** kører EU-projekter på sin egen klynge. Data gemmes ikke og bruges ikke til træning.
  - Mistral udfasede Devstral 31. juli 2026. Mistral Medium anbefales nu; Codestral anbefales ikke til agentarbejde.
- **Projektplacering:** Projekter lægges i `Dokumenter/AI Harness`. Et projekt med samme navn får et nummer, og æ, ø og å skrives om i mappenavnet. Tests sætter deres egen dokumentmappe med `app.setPath('documents', …)`.

Åbne spørgsmål:
- **Automatisk tilstand:** Claude Codes auto mode er lukket kode og virker kun med Claude-modeller i Claude Code og Agent SDK. OpenCodes `--auto` godkender alt. Forslaget er en særskilt milepæl med to dele:
  - en sandkasse til kommandoer med Anthropics open source `sandbox-runtime`, først på Mac
  - en bedømmer, der bruger brugerens egen AI og kun spørger ved tvivl

  Windows kræver en særskilt afklaring, fordi sandkasserne der kræver administratorrettigheder.
- **Mistrals EU-endpoint:** `api.eu.mistral.ai` garanterer behandling i EU mod 10 % højere pris. Det skal afprøves med en nøgle, før det bliver standard.
- **OpenCode 1.18.33 og Zens gratis modeller:** Brugeren ville ikke bruge penge på at afprøve med en rigtig model og bad om OpenCodes gratis modeller.
  - Zen afviste 1.17.15 med beskeden "OpenCode 1.18.0 or newer is required to use the free tier". Motoren er derfor opgraderet til 1.18.33, og låsefilen er opdateret for alle fire platforme.
  - Med 1.18.33 virker de gratis modeller fra OpenCodes egen kommandolinje. Fra appen afviser Zen dem stadig: "OpenCode's free tier can only be used from within OpenCode".
  - Årsagen er, at motoren melder sig som klienten `harness` gennem `OPENCODE_CLIENT`. OpenCodes standard er `cli`, og Zen giver kun gratis adgang til OpenCodes egne klienter.
  - Appen udgiver sig ikke for at være OpenCode for at komme uden om begrænsningen. En Zen-forbindelse kræver derfor en nøgle, og hjælpeteksten siger det. Vilkårene for hver af Zens modeller står i resuméet.
  - Rigtige modelprøver bruger i stedet Mistrals gratis plan. Brugeren valgte det 29. september 2026.
  - Under udvikling finder appen den motor, `npm run runtime:prepare` har hentet til `.runtime`, før en eventuel egen installation i `~/.opencode`.
- **Ingen anbefaling af udbydere eller modeller:** Brugeren besluttede 29. september 2026, at appen ikke må anbefale noget. Valget skal bygge på brugerens egne vurderinger.
  - Claude, Mistral og Corti står fortsat øverst i den rækkefølge med faktuelle oplysninger om udbyder og land. Resten ligger bag "Vælg en anden".
  - Standardmodellen er udbyderens eget dokumenterede udgangspunkt: Claude Opus 5.5 hos Anthropic ("If you're unsure which model to use, start with Claude Opus 5.5"), Mistral Medium hos Mistral og S1 hos Corti. Det står som udbyderens, ikke som vores.
  - Under skrivefeltet står altid model, udbyder og indsats. Indsatsen er udbyderens standard, fordi OpenCode 1.18.33 kun sender `thinking: adaptive` og ingen indsats. Samme sted står samtalens tokens ind og ud med en anslået pris.
  - Tokens tælles pr. modelkald ud fra OpenCodes `step-finish`, fordi beskeden kun beholder det sidste kalds tal. Ræsonnement afregnes som output. Forbruget gemmes med samtalen og nulstilles ved ny samtale.
  - Om pris siger vi, at man betaler pr. token, og at prisen varierer meget med opgavens kompleksitet.


## Gem, fortryd og kom tilbage · 30. september 2026

Brugeren besluttede, at der gemmes en version efter hver AI-opgave, så en opgave altid kan fortrydes.

- **Git fra start:**
  - Nye projekter får en lokal Git-historik med branchen `main` og en første version, "Projekt oprettet".
  - Har computeren ingen Git-identitet, bruges den anonyme `AI Harness-bruger <bruger@ai-harness.invalid>`. Adressen kan aldrig modtage post, og en eksisterende identitet overskrives ikke.
  - Åbnede mapper røres ikke.
- **Automatiske versioner efter hver opgave:** De erstatter de tidligere strenge checkpoints, som sprang over efter kommandoer, patchværktøjer, fejl, stop og afvisninger og derfor sjældent gav noget at fortryde.
  - En version indeholder nu de filer, der ændrede sig under opgaven, målt på indhold i forhold til opgavens start. Brugerens egne ugemte ændringer fra før opgaven kommer ikke med.
  - Et stop eller en fejl gemmes som "Afbrudt AI-opgave".
  - Aldrig automatisk: hemmeligheder, beskyttede stier og store eller ukendte binære filer. Heller ikke i repositories med hooks eller filtre, under igangværende Git-handlinger, med staged ændringer eller hvis historikken er ændret under opgaven.
  - Andre programmers samtidige ændringer kan komme med. Det står i hjælpeteksten.
- **Fortryd og Gå tilbage hertil:**
  - Begge bruger den eksisterende gendannelse med kopi før gendannelse.
  - Med automatiske versioner gemmes resultatet som en ny version ("Fortrudt: …" eller "Gendannet til: …"). Historikken er dermed lineær, og man kan altid gå frem igen.
  - Kopien før sidste gendannelse vises kun efter en afbrudt gendannelse eller uden automatiske versioner.
- **Versioner i almindeligt dansk:** Dialogen viser "Alt er gemt" eller antallet af ugemte ændringer, Gem version med ét klik og en historik med tidspunkter. Filvalg, branch og identitet ligger under Avanceret og Se detaljer.
- **Kom tilbage:** Appen åbner det projekt, der sidst var åbent, med samtale, kladde og forbrug. Et projekt, brugeren har lukket med Nyt projekt, åbnes ikke igen.

Brugeren foreslog samme dag, at de "smarte" funktioner blev moduler, som man selv slår til og fra. Det er besluttet og bygget i afsnittet nedenfor. Hostingmuligheder er undersøgt i [hosting.md](hosting.md).

## Funktioner og ét fælles skillbibliotek · 30. september 2026

Brugeren besluttede tre ting:
- Appen spørger ved første start, hvad den skal hjælpe med.
- Valget er standarden for alle projekter, men et projekt kan have undtagelser.
- Appens egen AI bruger det samme skillbibliotek som installationerne i brugerens kodeværktøj.

- **Seks funktioner.** De er beskrevet i `profiles/catalog.json` under `features`. Hver skill hører til præcis én funktion, og biblioteket afviser andet:
  - **Versioner og fortryd:** Git fra start, en version efter hver AI-opgave og Fortryd. Skill: `harness-git-og-samarbejde`.
  - **Planlægning før bygning:** Afklar og planlæg er arbejdsmåden, når man starter. Slået fra arbejder AI’en direkte. Skills: idé og afgrænsning, eksisterende projekt, arkitektur og teknologi.
  - **Design og tilgængelighed:** designpakker, logo og designlinks. Skill: design og tilgængelighed.
  - **Sikkerhed og data:** kun skills, nemlig nøgler og afhængigheder, data og leverandører samt sikkerhedsgennemgang.
  - **Kodekvalitet og afprøvning:** kun skills, nemlig kodestil samt afprøvning og fejlretning.
  - **Deling og udgivelse:** Del og Sikkerhedskopi. Skills: udgivelse og gendannelse, overdragelse og drift.

  Deling bygger på versionerne, fordi Del og Sikkerhedskopi udgiver fra en gemt version. Slås den ene til, følger den anden med, og omvendt.
- **Anbefalet pakke:** Hele pakken er alle funktioner undtagen Deling og udgivelse. Brugeren besluttede, at testere ikke skal møde Del, så længe den kræver Vercel CLI eller Azure CLI. Deling kan slås til under Indstillinger › Funktioner.
- **Deling med komplai Publish (17. oktober, opdateret 18. oktober 2026):** Når en komplai Publish-adgang er forbundet, er Deling og udgivelse med i Hele pakken, fordi Del så kan udgive uden CLI. Brugerens eget valg under Funktioner går forud. Ét login med komplai giver organisationens AI og komplai Publish som to særskilte adgange; i AI-opsætningen er Publish valgt på forhånd, i Del er AI fravalgt på forhånd. Ved en ny app vælges synlighed (organisationen eller alle med linket) uden forvalg. Eksisterende adgang vises og bevares; ændringer sker i Hub, fordi API'et ikke kan binde adgangsændring atomisk til den uploadede version. Kontrollen viser aktuel adgang og en eventuel afvigelse fra brugerens valg. Apps får adresser som budget.komplai.run.
  - Kataloget markerer det med `"default": false`.
  - Hele pakken gemmer ingen enkeltvalg, så en senere ændring af anbefalingen også gælder dem, der valgte den.
- **Altid slået til:** Disse kan ikke slås fra:
  - grundreglerne;
  - overblikket før afsendelse;
  - godkendelse af kommandoer, websider og filer uden for projektet;
  - krypterede API-nøgler;
  - model, tokens og pris under skrivefeltet.
- **Første start:** Efter AI-trinnet spørger appen: "Hvad skal AI Harness hjælpe med?". Der er to valg: Hele pakken (anbefalet) og Vælg selv. Vælg selv starter med alt slået fra, og knappen siger, hvor mange funktioner man fortsætter med. Vælg senere beholder den anbefalede pakke. Brugere, der har været igennem introduktionen før, bliver ikke spurgt.
- **Indstillinger › Funktioner:**
  - Én kontakt pr. funktion. Man vælger mellem Alle projekter og Kun det åbne projekt.
  - En undtagelse gemmes kun, hvis den afviger fra standarden, og kan fjernes med Brug standarden.
  - Ændringer gælder fra næste besked, fordi en ny modelsession starter med de nye skills og regler.
  - Afsnittet Avanceret har editoren for instruktioner i projektet. Den har ikke længere en kontakt pr. skill, fordi funktionerne bestemmer det.
- **Et fravalg skjuler og stopper, men sletter intet:**
  - Uden versioner får nye projekter ingen Git og ingen automatiske versioner, og knapperne til versioner skjules.
  - Uden deling skjules Del, Sikkerhedskopi og hostingønsket.
  - Uden design skjules designvalgene på startsiden, og designlinks og materiale følger ikke med nye projekter.
  - Eksisterende filer og historik røres ikke. Brugerens gemte standardvalg bevares.
- **Appens AI og skills:**
  - Motoren lægger de aktive skills i sin egen konfigurationsmappe, og OpenCode henter dem efter behov med skill-værktøjet.
  - Kun de aktive skills kan hentes. OpenCodes indbyggede skill er skjult, og projektets egne skill-mapper og AGENTS.md indlæses ikke.
  - Grundreglerne og appens egne regler står i systemprompten. De appspecifikke linjer fra `profiles/app` er flyttet ind i appens regler, og mappen er fjernet.
  - Appens regler følger funktionerne, fx at brugeren har slået versioner fra.
- **Rettet sikkerhedsfejl i læsetilladelserne:** OpenCode sammenligner fil- og læsetilladelser med stien i forhold til projektets Git-rod, eller til computerens rod uden Git.
  - Siden alle nye projekter fik Git, ramte `**/references/**` ikke længere `references/…`. AI’en kunne derfor læse alle private referencefiler, også dem brugeren ikke havde valgt. Det samme gjaldt `.git/` og `secrets/`.
  - Omvendt kunne udvalgte referencer ikke læses i projekter uden Git.
  - Reglerne skrives nu i begge former. Det er afprøvet mod den rigtige OpenCode med og uden Git.

## Foreslåede retninger · 30. september 2026

Brugeren foreslog to retninger under milepælen Funktioner. Rolige skærme er bygget; se afsnittet nedenfor. Integrationsskills er ikke besluttet.

### Rolige skærme

Brugeren oplever mange af appens skærme som tekstmættede og svære at bruge, fx Versioner, Tilslut din AI, indstillinger og Del. De skal være enklere, med lange forklaringer skjult i små forklaringer eller sammenfoldede afsnit.

Tilgangen, brugeren har valgt som næste milepæl:
- **Ét mønster for alle skærme:**
  - ét spørgsmål eller én status i almindelige ord;
  - én primær knap og højst én linje forklaring;
  - resten bag ⓘ eller Se detaljer;
  - indstillinger som lister med kontakter og detaljer på et nyt lag;
  - fagord som branch, commit, identitet og endpoint kun under Avanceret.
- **Det, der afgør beslutningen, står synligt:** modtageren af data, pris og handlinger, der ikke kan fortrydes, står som én kort linje. Forklaringer bag ⓘ åbnes med et klik og kan bruges med tastatur.
- **Målt før og efter:** antal ord, synlige valg og klik pr. opgave for hver skærm.

### Integrationsskills fra leverandører og kommuner

*Påbegyndt 30. september 2026; se afsnittet Integrationsskills nedenfor.*

Leverandører, der vil gøre det let for kommuner at integrere, kan bidrage med skills som pull requests. Kommuner kan på samme måde bidrage med fx gratis hostingmuligheder eller nye standarder.
- **Foreslåede standardskills:** Promte, Datafordeleren, CVR, websøgning, KMD Opus, eDoc/P360, KMD Nexus og SharePoint.
- **Eksempelskills:** skal vise, hvordan man opretter en bruger, får en API-nøgle og får åbnet i en firewall.

Forbehold, der skal på plads, før der åbnes for bidrag:
- **Gennemgang:** en ansvarlig for review og en fast skabelon. Hver skill angiver ejer, kilder, kontroldato og hvilke data der sendes hvorhen. En leverandør vedligeholder kun sin egen skill.
- **Neutralitet som ved AI-udbyderne:** faktuelle skills, der står side om side. En fælles standard får sin egen skill, og leverandørens skill bygger ovenpå.
- **Adgang via IT:** Adgang, der kræver aftaler eller certifikater, fører til en færdig bestilling til IT-afdelingen i stedet for trin, en begynder selv udfører.
- **Følsomme data:** Skills til systemer med fx helbredsdata starter med syntetiske data, databeskyttelsesrådgiveren og en konsekvensanalyse.
- **Nøgler og værktøjer:** Integrationsnøgler kræver et sikkert sted i appen, og websøgning kræver et værktøj med sin egen pris og sit eget dataflow. Begge er appfunktioner, ikke kun skills.
- **Rækkefølge:** skabelon og bidragsregler, derefter to eller tre åbne registre, der kan afprøves fra ende til anden, og til sidst ét eksempel via IT-afdelingen. Adgangskravene undersøges pr. system med kilder.

## Rolige skærme · 30. september 2026

Brugeren oplevede appens skærme som tekstmættede og svære at bruge. Alle skærme følger nu mønsteret i [DESIGN.md](../desktop/DESIGN.md#rolige-skærme):
- én ting øverst og højst én linje forklaring;
- resten bag en ⓘ, der åbnes med et klik;
- indstillinger som lister;
- modtager, pris og handlinger, der ikke kan fortrydes, altid synlige.

Brugeren besluttede:
- **Ingen fast grænse.** Skærmene måles før og efter med `npm run measure:screens`, men en test fejler ikke, hvis en skærm vokser.
- **De seneste valg huskes automatisk** i projektopstarten. Afkrydsningen "Husk disse valg" er fjernet; "Glem dem" nulstiller.

Ændret:
- **AI-forbindelser** er ét menupunkt i stedet for to:
  - en liste med Rediger på hver forbindelse;
  - Tilføj forbindelse går gennem den guidede opsætning med de tre udbyderkort;
  - Rediger har Test forbindelse og Fjern forbindelse.
- **Nøglehjælpen:** Hvert trin er én kort linje med sin knap og en ⓘ til uddybningen. Prisen står én gang: "Du betaler pr. token, og prisen varierer meget med opgavens kompleksitet."
- **Flere valg** er én flad liste: AI, udgivelse, tests og design. Kun farve, logo og inspiration ligger et lag længere nede.
- **Før du sender:**
  - Første lag har de fire linjer og én linje om betaling og data.
  - Tidligere samtale nævnes kun, når den sendes med.
  - Under "Se alle oplysninger" har lange tekster hver sin fold.
- **Versioner:** Automatisk gemning er en kontakt, versionsnavne forkortes, og filvalg, branch og identitet samles under Avanceret.
- **Funktioner:** Skills står bag en ⓘ, og hver funktion har en beskrivelse på én linje.
- **Arbejdsområdet:** "Forbered første besked" vises kun, når skrivefeltet er tomt.

Målt i Electron med en kontrolleret model på 32 skærme:
- **Synlige ord:** fra 3.789 til 1.923, 49 % færre.
- **Valg:** fra 209 til 186, plus 46 ⓘ.
- **Klik pr. opgave:** uændret, nemlig 5 for at forbinde Claude, 5 fra idé til første udkast og 2 for at fortryde.
- **Største fald:**
  - "Se alle oplysninger" fra 1.162 til 250 ord;
  - nøglehjælpen fra 217 til 100;
  - AI-forbindelser fra 107 til 9.

## Integrationsskills · 30. september 2026

Brugeren valgte tre ting:
- De første eksempler er åbne registre.
- Hver integration slås til for sig.
- Skabelon og regler for bidrag bygges nu. Åbningen for bidrag fra leverandører og kommuner besluttes sammen med licensen.

- **Integrationer er funktioner i gruppen "integrationer":**
  - Hver har præcis én skill og er slået fra, til brugeren vælger den under Indstillinger › Funktioner, for alle projekter eller ét projekt.
  - Ved første start vises kun de almindelige funktioner.
  - I eget kodeværktøj er integrationer ikke forvalgt, heller ikke i webguidens pakker eller i `scripts/harness.cjs`.
  - Integrationer tælles for sig. Tekster og tællere siger fx "12 af 12 skills og 1 integration", og en integration, der ikke er valgt, står som en, der kan vælges til, ikke som fravalgt.
  - `scripts/harness.cjs` bevarer nu udvalget fra `.harness/installation.json` ved en ny installation, ligesom appen. Før installerede den altid alle skills og skrev intet udvalg i manifestet, så en opdatering fra kommandolinjen ville have fjernet en integration valgt i appen.
- **Faste oplysninger:** Kataloget beskriver hver integration med system, ejer, vedligeholder, adgang, data, dataflow, pris, om IT-afdelingen skal hjælpe, om der er følsomme data, og kontroldato. Biblioteket afviser en integration uden disse oplysninger eller uden kilder.
- **Regler:** Skabelonen og kravene ved gennemgang står i [integrationsskills.md](integrationsskills.md). Appens regler minder AI’en om, at nøgler til en integration kun må ligge i `.env` og bruges fra en server.
- **Adresser:**
  - DAWA lukker 1. oktober 2026. Skillen bruger derfor Klimadatastyrelsens Adressevælger til søgning fra browseren.
  - Datafordeleren bruges med en API-nøgle fra en server.
  - Koordinaterne er i EPSG:25832, og kreditering følger CC BY 4.0.
- **CVR:**
  - Al adgang kræver en bruger hos Datafordeleren eller en ansøgning om Erhvervsstyrelsens system-til-system-adgang.
  - Skillen bygger først med opdigtede virksomheder.
  - Den kræver markering af reklamebeskyttelse og forbyder CPR-numre og automatisk læsning af cvr.dk (CVR-bekendtgørelsen § 17).
  - Det er uafklaret, om en bruger med MitID Privat får CVR-data fra Datafordeleren. Skillen beder brugeren kontrollere det.

## Foreslået retning: Jev vælger model og indsats · 1. oktober 2026

*Ikke besluttet og ikke bygget. Brugeren vil overveje det efter testversionen og hosting.*

OpenRouter har fået Jev Router (`typesafe/jev-router`). Den vælger model og indsats ved hver besked ud fra TypeSafes beslutningsmodel Jev. Brugeren foreslår to eksperimentelle kontakter, der er slået fra som standard:
- **Jev vælger indsats:** brugerens valgte model bevares. Jev vurderer hver besked, og appen sætter indsatsen ud fra svaret. Jev 1.13 kan besvare typede spørgsmål, fx en sværhedsgrad på en skala.
- **Jev vælger model:** modellen sættes til Jev Router, som vælger blandt OpenRouters modeller.

Hvorfor det er interessant:
- Begyndere slipper for at vælge model og indsats.
- Prisen kan falde, når lette beskeder går til en billigere model eller lavere indsats. Det er ikke målt.

Det skal være på plads, før kontakterne kan bygges:
- **Data til amerikanske virksomheder:** beskedens tekst sendes til OpenRouter og TypeSafe. Appen giver ingen databehandleraftale. Mange kommunale brugere bør derfor ikke slå kontakterne til, og ⓘ og "Før du sender" skal sige det klart.
- **Modtageren før afsendelse:** Med Jev vælger model kendes modeludbyderen først efter svaret. Det strider mod reglen om, at appen låser OpenRouter til én underleverandør uden automatisk skift. Kontakten skal enten kunne begrænses til bestemte udbydere, eller også skal "Før du sender" vise alle mulige modtagere.
- **Ingen EU-behandling:** Ifølge OpenRouters nyhedsbrev fra september 2026 virker routermodeller ikke på `eu.openrouter.ai`.
- **Statuslinjen:** den faktiske model, indsats og pris for hver besked skal kunne vises. Nyhedsbrevet lover en begrundelse i hvert svar, men modelsiden dokumenterer kun de almindelige felter. Det skal afprøves.
- **Neutralitet:** Jev står som en mulighed under OpenRouter, ikke som en anbefaling. Teksten forklarer, at Jev vælger for brugeren.

Første skridt, hvis retningen vælges: ét rigtigt kald gennem appens OpenRouter-forbindelse, der afklarer:
- hvilke data der kommer retur;
- om udbyderne kan begrænses;
- om værktøjskald virker gennem hele forløbet.

Samtidig undersøges OpenRouters vilkår for databehandleraftaler.

Kilder: [Jev Router](https://openrouter.ai/typesafe/jev-router), [Jev on OpenRouter](https://openrouter.ai/docs/guides/community/jev), [Jev 1.13](https://openrouter.ai/models/typesafe/jev-1.13) og OpenRouters nyhedsbrev fra september 2026.

## Navneskift til Aura · 1. oktober 2026

Brugeren besluttede:
- **Appen hedder Aura.** De fælles grundregler, skills og pakker til andre kodeværktøjer og hjemmesiden hedder **Aura Harness**. Senere repositories kan fx hedde `aura`, `aura-cli` og `aura-tools`.
- **Flere AI-værktøjer bruger allerede navnet Aura og AURA Harness.** Brugeren accepterer det, fordi projektet er open source og rettet mod danske kommuner.
- **Data på eksisterende installationer bevares.**
- **Markørerne i brugernes filer** bliver `aura-harness:start/slut`. De gamle `ai-harness`-markører genkendes og skiftes ud.

Sådan er det gjort:
- **Datamappe og nøglering** (`desktop/core/app-identity.cjs`):
  - En eksisterende installation beholder sin datamappe (`AI Harness`, under udvikling `ai-harness-desktop`) og sit navn i nøgleringen, så gemte nøgler kan læses.
  - Nye installationer bruger Aura.
  - Datamappen husker navnet i `harness/noeglering.json`.
- **Projekter:** Nye projekter lægges i Dokumenter › Aura. Dokumenter › AI Harness bruges fortsat, hvis den findes.
- **Filnavne:**
  - Installationsfilerne hedder `Aura-<version>-<os>-<arkitektur>`, og pakkerne hedder `aura-harness-<værktøj>-<version>.zip`.
  - Downloadsiderne viser også tidligere filer med navnet `AI-Harness-…`.
  - Nye projekter uden Git-identitet får `Aura-bruger <bruger@aura.invalid>`.

Bevidst uændret:
- **Neutrale tekniske navne:** `appId` `org.ai-alliancen.harness`, mappen `.harness/` i projekter, skillnavnene `harness-*`, URL-skemaet `harness:` og `OPENCODE_CLIENT=harness`. At ændre dem ville bryde eksisterende installationer.
- **GitHub-repoet `ai-alliancen-org/ai-harness` og links dertil:** De skifter, når repoet er omdøbt.
- **Historiske afsnit og faktiske filnavne fra tidligere versioner,** fx beta.3.
- **Vercel-testprojektet `progressify/ai-harness-test`.**

## Testversion uden blindgyder · 1. oktober 2026

Brugeren besluttede:
- **Testernes AI er Corti S1.** Hele forløbet afprøves med den, før invitationen sendes.
- **Første runde kører på Mac.** Windows følger, når Windows-pakken er signeret. Uden signering viser SmartScreen en advarsel, og kommunale pc'er kan blokere den.
- **Download:** Testerne henter appen fra en offentlig GitHub-udgivelse. Repoet bliver offentligt og beholder navnet `ai-alliancen-org/ai-harness`.
- **Licens:** Repoet og bidrag er under EUPL-1.2.
- **Feedback** går på e-mail til en navngiven kontakt, som står i `desktop/package.json` under `feedback`.

Fundet og rettet under afprøvningen med Corti:
- **Region:**
  - Cortis nøgler bærer deres miljø, fx `fr:` i base64, og virker kun dér.
  - Appen vælger nu `ai.fr.corti.app` eller `ai.eu.corti.app` ud fra nøglen og afviser nøgler fra USA.
  - "Før du sender" viser behandlingsstedet med Cortis kilde. Miljøet fr ligger hos Scaleway i Paris.
- **Svarlængde:**
  - Cortis katalog oplyser ingen grænse for svarlængden, så appen gav Corti S1 4.096 tokens. Modellen tænker først og nåede derfor ikke at skrive filerne.
  - Corti S1 har nu 262.144 tokens kontekst og 32.000 tokens svar.
  - En opgave, der slutter uden svar og uden ændringer, siger det nu og tilbyder Prøv igen.
- **Git-filtre:** Et globalt filter som Git LFS stoppede alle automatiske versioner. Nu stopper kun filtre, som projektet selv bruger via `.gitattributes`.

## Deling og samlet brugerforløb · 7. oktober 2026

Milepæl 7 præciserer de eksisterende GitHub-, Vercel- og Azure-forløb. Der tilføjes ingen hostingadapter, adgangstjeneste eller automatisk udgivelse. Projektets gemte version deles; uflettede kopier og ugemte rettelser er udeladt og forklares før afsendelse. Eksisterende konti, filbeskyttelse og engangsgodkendelser bevares.

- Versionens navn og tidspunkt står før de tekniske ID'er. Navnet i kvitteringen er det, der blev gennemgået; senere omdøbning ændrer ikke kvitteringen eller den sendte version.
- Destination, gennemgang og resultat vises hver for sig. Ret destination bevarer formularens værdier, men kræver en ny gennemgang og et nyt samtykke.
- En udbyderstatus, et anonymt HTTP-svar og et filmatch er særskilte kontroller. Ingen af dem beviser fuld funktion eller en bestemt testpersons adgang. En ny mislykket kontrol må ikke beholde gammel succes som aktuel evidens.
- Ved ubekræftet upload henvises til udbyderens oversigt før et nyt forsøg. Ingen automatisk gentagelse. GitHub-versionsbekræftelse beskriver kode og historik og kaldes ikke en udgivelse af appen.
- Observationen med en person uden udviklererfaring er endnu ikke udført. Guiden og notatskabelonen i testforloeb.md gør den konkret; automatiske prøver må ikke udfylde den på personens vegne. Milepælens tekniske evidens og den udestående observation registreres hver for sig i teststatus.md.

## Gennemgang før demo · 7. oktober 2026

Brugeren har bedt om en samlet UI/UX-gennemgang og klargøring før en pilot med testpersoner. Den eksisterende retning bevares: Mac og Corti S1 fra beslutningen den 1. oktober; ingen ny modelanbefaling, hostingadapter eller offentlig udgivelse foretages som del af gennemgangen.

- Uden gemt forbindelse går Vælg AI og Send direkte til forbindelsesguiden; kladden bevares ved Vælg senere.
- En fortsat AI-session kan bruge tidligere beskeder og værktøjsresultater. Før du sender forklarer det i første lag. Tilvalget handler om en ekstra historikkopi, ikke om at slå tidligere kontekst fra. Ny samtale starter et nyt forløb.
- Dialognavne følger synlige overskrifter, kontakter har egne navne, og fokus returnerer til en synlig menuåbner. Hjælp har en foldet førstegangsvejledning. Installationssiden følger Auras eksisterende koboltfarve.
- Gem version venter på den igangværende filgennemgang. Det kontrolleres med et forsinket faktisk IPC-svar i den pakkede app.
- Kandidaten er `0.2.0-beta.4`; den lokale pakke er ikke en notariseret eller publiceret udgivelse. CI-kontroller er skrevet, men ikke kørt på GitHub i denne gennemgang.
- Den første brugerobservation er pilotens formål. Afprøvet model, konkret installation og downloadadgang går forud for invitation; brugerobservationen fuldender derefter milepæl 7. Rapport og kort testmateriale ligger i demogennemgang.md og demo-til-testere.md.

## Bidrag fra Parthee Vijayamohan · 25. oktober 2026

33 bidrag (#17–#47, #49 og #50) er gennemgået statisk mod `dce68ea`. Ingen kode fra bidragene er kørt. #48 og Dependabot-bidragene er ikke gennemgået. Brugeren besluttede:

Arbejdsgang:
- **Bidragene er forslag.** Vi overtager selv arbejdet og bygger så meget som muligt af dem ind i vores egne milepæle, tilpasset beslutningerne nedenfor. Bidraget nævnes som kilde, når dets idé eller kode bruges. Bidragene flettes ikke direkte.
- **Bidragenes bevismateriale tages ikke med:** `docs/contributions/`, `docs/images/<id>/`, bevisfiler i `docs/`, de fælles `verify-contribution-*.cjs` og README-links til bevis. Vi afprøver selv det, vi bygger ind.
- **Lister med én post pr. linje.** Listen over filer, appen må levere, står i `desktop/core/ui-files.cjs`, og kanalerne står i `desktop/preload.cjs`, begge i alfabetisk orden. Scripts og stilark i `desktop/ui/index.html` står én pr. linje i den rækkefølge, de skal indlæses, fordi senere scripts bruger tidligere. `tests/ui-files.test.cjs` fanger en UI-fil, der mangler i listen, og en liste ude af orden.

Sessioner, fejl og genforsøg:
- **Tre bindinger.** Samtykke, motoridentitet (forbindelse, model, skills og sandkasse) og genoptagelse af AI-sessionen afgøres hver for sig. Arbejdsmåde, plan og designstatus sendes med hver besked. Tilladelserne følger en OpenCode-agent pr. arbejdsmåde i samme session.
- **Genforsøg ved forbigående fejl.** Gatewayen låser ikke længere et kald ved 408, 429 og 5xx, så OpenCodes egne genforsøg kommer igennem. Hvert forsøg tælles med i forbrug og pris. Det erstatter "Aura forsøger stadig aldrig igen af sig selv" under tredje milepæl.
- **Plan efter fejl.** Fejler eller stoppes en byggeopgave, bevares planen og Byg, og Prøv igen bygger videre i Byg. En plan fra en afbrudt planlægning må stadig ikke bygges direkte. Det præciserer reglen om afbrudte planer.
- Sessionen om hackathon-feedbacken bygger de tre punkter. #20, #41 og #42 lukkes, og brugbare dele genbruges med kreditering.

Samtalen og Før du sender:
- **En vedhæftning gælder én besked.** Valget ryddes efter afsendelse. Plan og planafklaring får filnavn og kontrolsum, ikke filteksten.
- **Plusmenuen har to punkter:** Fil fra computeren (tekst, billede og PDF) og Referencemappe.
- **Før du sender viser den præcise tekst ét sted** med almindelige navne. Kontrolsummer, revision og bytes ligger bag Se detaljer. Det viste er bundet til det sendte.
- **Links i AI-svar kan klikkes** og viser adresse eller værtsnavn i selve teksten. Det erstatter det tidligere valg om ikke-klikbare links.
- **Søgning i beskeder** har en knap i sidepanelet, også når det er foldet sammen, og findes i ⌘K.
- **Kontekstmålingen** ligger i statuslinjens detaljer og regnes mod Auras grænse på 200.000 tokens. Første lag viser kun en advarsel nær grænsen.
- **Modelstøtte** vises kun med udbyderens egne oplysninger. Appens egne observationer vises ikke som prøver.

Design og udseende:
- **Designmetoden fra #23 bliver en del af `harness-design-og-tilgaengelighed`.** Der kommer ingen ny skill, og design bliver ikke obligatorisk (#43 flettes ikke). Brugernes fravalg respekteres.
- **Retning for stilarter:** Flere stilskills, fx minimalistisk, shadcn/Radix, Apple-inspireret og Material, som brugeren vælger mellem med forhåndsvisninger. Højst tre til fire vises først, med et anbefalet udgangspunkt forrest og resten bag Vælg en anden. Stilarterne bruger kun materiale med afklarede rettigheder.
- **Udbyderlogoer** må stå ved modellen under skrivefeltet og på modelkortene. Alle bruger det fælles logosæt `desktop/ui/provider-*.svg` med samme størrelse og farveholdning. Ved OpenRouter vises forbindelsens logo.
- **Tema følger systemet** med et valg under Indstillinger. Lyst og mørkt bygger på ét sæt farvetokens, og de mørke værdier skrives ind i `desktop/DESIGN.md`.
- **Arbejdsstatus** vises som lyskant om skrivefeltet og som et lille mærke på forhåndsvisningen i Byg. Statusteksten står og læses op ét sted.
- **Designbriefet** skrives af designskillen i `docs/design.md` i brugerens projekt og genbruges. I Planlæg står et kort resumé under Sådan skal det se ud. Besluttet 26. oktober 2026.

Nøgler, godkendelser og pakning:
- **Nøgler og GitHub-token indtastes kun i et separat vindue.** Hovedvinduet får en engangskvittering. Udgivs felt flyttes med. Nøglen renses og kontrolleres, før den gemmes. Knappen hedder Indtast nøgle.
- **En afvist nøgle gemmes ikke.** Afviser udbyderen nøglen, bliver vinduet åbent med nøglen maskeret og udbyderens svar bag Se detaljer. Kan serveren ikke nås, fx en lokal server, der ikke kører, kan man vælge Gem alligevel. Besluttet 26. oktober 2026.
- **Godkend alt er et udtrykkeligt valg pr. samtale**, som også gælder over projektmappens grænse. Det får dansk navn og advarsel og bygges på den nye godkendelsesmodel, når kommandosandkassen er rettet. #45 flettes ikke i sin nuværende form.
- **Pakning sker fra et committet kildetræ.** Pakken får et kildebevis med commit og kontrolsummer, som også dækker byggekonfiguration, entitlements og byggescripts. Signeringskvitteringen gemmes pr. bygning. `docs/udgivelse.md` får den nye rækkefølge. `desktop/runtime-lock.json` følger med i `app.asar` og sammenlignes byte for byte mod kilden, fordi appens samtalekode læser motorversionen fra den; en vagt i `desktop/tests/packaging.test.cjs` afviser et relativt krav til en fil, der ikke står i fillisten.
- **PDF-udtræk** må bruge `pdfjs-dist` (Apache-2.0). `@napi-rs/canvas` kommer kun med, hvis udtrækket påviseligt ikke virker uden.
- **Indflettede kopier** ryddes fortsat automatisk. #24 flettes ikke.

Valg i implementeringen, som kan ændres:
- OneDrive og iCloud under `~/Library/CloudStorage` og `~/Library/Mobile Documents` kan bruges til vedhæftninger på Mac. Windows-stier normaliseres, før beskyttede mapper kontrolleres.
- #19 tager kun rettelsen af spørgsmålenes levetid med. Spørgsmålsinstruksen for alle arbejdsmåder og skjulningen af resultatkortet udgår.
- Versionsnummeret (#50) står i sidepanelet. Appvinduet maksimeres ikke ved start (#17).
- Forhåndsvisningen genbruger projektets sidste port, når den er ledig, så sidens lokale data bevares.
- Den engangsvise nulstilling af AI-sessioner samles i én udgivelse og nævnes i udgivelsesnoterne.
- Dependabot #11 (OpenCode 1.19.3) venter på motorarbejdet, og roden og `desktop/runtime-lock.json` løftes sammen.
- #15 (Electron 44.9.1, sikkerhed) og #51 tages, men `@opencode-ai/plugin` bliver på 1.18.33. `desktop/core/engine.cjs` holder versionen som en konstant og afviser motoren, hvis plugin'et ikke matcher, så en halv opgradering ville stoppe appen. Plugin'et hører derfor til samme løft som #11, roden og `runtime-lock.json`. #51's tre andre opdateringer (electron-builder, playwright, electron-updater) er uafhængige og er taget. Dependabot lukkede selv #15 og #51 efter commit `5f6116a` og åbnede #52 med kun plugin'et tilbage; den følger #11.
- Temaet (#46) sættes i Electrons `nativeTheme`. Vinduesramme, felter, menuer og udbyderlogoer følger derfor med, og forhåndsvisningen og skærmbilleder af projektets side bruger samme valg, når siden har et lyst og et mørkt udseende. Valget ligger under Indstillinger › Udseende og i ⌘K. #46's smalle layout ned til 320 px tages ikke med, fordi appvinduet er mindst 980 px bredt.
- #23 er foldet ind i `harness-design-og-tilgaengelighed` som to nye referencer, `designmetode.md` og `moenstre-og-tilstande.md`, med kilden nævnt i kataloget. Kataloget med 43 stilretninger fra SkillsUI, kodeskabelonerne, tokengeneratoren i Python og Atlas' rolletabel og panelmønstre er ikke med: rettighederne er ikke afklaret, eller materialet hører til startskabelonerne i M3 og de senere stilskills. Skillens beskrivelse er uændret, så M2 kan skrive den endelige. En tilpasset SKILL.md fra før en ny referencefil stopper ikke længere afsendelsen; motoren lister alle referencer. Pakkerne er bygget om under 0.2.1, fordi installationer sammenligner filernes indhold.
