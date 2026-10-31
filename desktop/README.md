# Aura · desktop, POC 2

Dansk desktop-app med lokale arbejdsområder, kodeagent, modelvalg, skills, genbrugelige designpakker og forhåndsvisning. OpenCode er den første agentadapter; versionen står i `runtime-lock.json`. Modellen kan køre på egen maskine, egen server eller hos en ekstern udbyder; projektfiler og agentprocessen kører fortsat lokalt.

Invitation, installationskontrol og observationsopgaver er samlet i [testforløbet](../docs/testforloeb.md). [Aktuel teststatus](../docs/teststatus.md) skelner mellem automatiske prøver, rigtige modeller og kontrol af installationspakker.

Arbejdet mod 0.6 og den særskilte lokale verifikation står i [afprøvning af 0.6](../docs/afproevning-0.6.md). Det er ikke en offentliggjort version; installationspakkernes gældende status står fortsat i teststatus.

## Aura Harness i dit eget kodeværktøj

Vælg **Brug Aura Harness i mit kodeværktøj** ved første start, eller **Aura Harness i dit kodeværktøj** i sidepanelet. Vælg dit værktøj blandt fire kort, Claude Code, GitHub Copilot, Codex og Cursor, eller under **Et andet værktøj**, og vælg derefter projektmappen. Er Aura Harness allerede installeret til et andet værktøj i mappen, tilføjes det nye værktøj til installationen. Under **Det følger med** står hver skill med, hvad den gør, hvornår den bruges, hvad du får, og hvad den ikke gør. Appen skal ikke have en AI-forbindelse til dette og sender intet over netværket.

Før installationen vises et resumé i almindeligt dansk, fx "Grundreglerne tilføjes nederst i AGENTS.md. Dine egne regler bevares." Hver fil og hvert afsnit står under **Se de præcise ændringer**. Intet skrives før **Installer**. Eksisterende filer overskrives aldrig: I fx `AGENTS.md`, `CLAUDE.md` og `.gitignore` tilføjes et afsnit mellem markørerne `aura-harness:start` og `aura-harness:slut` (de tidligere `ai-harness`-markører genkendes og skiftes ud), og projektets egne regler bevares. En fil, du har ændret siden installationen, røres ikke; knappen hedder da **Installer resten**. Gennemgangen advarer, hvis mappen ikke bruger Git, har ændringer, der ikke er gemt, eller hvis projektets `.gitignore` udelader skillmapper.

`.harness/installation.json` registrerer version, værktøjer og kontrolsummer; tidspunktet kommer fra computerens ur. Filen skal med i Git, så andre kan opdatere eller fjerne installationen sikkert. **Fjern igen** sletter kun uændrede filer og afsnit. Mappen vælges i hovedprocessen, og brugerfladen sender kun værktøjsvalg og bekræftelser. En gennemgang kan kun bruges én gang, og projektet kontrolleres igen før skrivning.

Gennemgangen viser, hvor mange skills der følger med. **Tilpas** åbner en oversigt som i en cookie-dialog: grundreglerne er altid med, og de fire kategorier kan slås til og fra samlet eller foldes ud til de enkelte skills. Hver kategori viser, hvor mange der er valgt. Udvalget gemmes i installationen og bruges igen, når projektet åbnes næste gang. Fravalgte skills, der er uændrede, fjernes ved næste installation.

Webplatforme, der ikke læser filer fra projektet, som Lovable, får en tekst, der kan kopieres til platformens egne felter.

Afprøvning fra `desktop/`:

```bash
npm run test:tools
```

```bash
npm run test:skills-claude
```

```bash
npm run test:skills-opencode
```

`test:tools` gennemfører forløbet i Electron med et rigtigt Git-projekt. De to andre installerer i et syntetisk projekt og kører den installerede Claude Code eller OpenCode mod en kontrolleret lokal modelserver. De viser, at grundregler og skills sendes til modellen, og at en skill indlæses ved brug. De kræver ingen konto eller nøgle og siger intet om, hvor godt en rigtig model følger instruktionerne.

## Gendannelse og fejlrapport

Åbn projektmenuen → Versioner, og vælg en gemt version for at gennemgå filerne før gendannelse. Appen gemmer først en lokal kopi af de berørte filer. **Kopien før sidste gendannelse** kan åbnes efter genstart og bruges til at fortryde. HEAD, index og commits ændres ikke. Gendannede filer fremstår som almindelige ændringer, der senere kan gemmes som en ny version.

Kun de viste filer ændres. Nye filer uden for historikken, ignorerede filer, installerede pakker og eksterne databaser bevares. Gendannelse stopper den preview-server, appen selv har startet, og afslutter den gamle agentsession. Staged ændringer, konflikter, symbolske links, Git LFS, store filer og muligt nøgleindhold kan kræve manuel gennemgang i et Git-værktøj. Appens kopier ligger uden for projektet og er ikke en online sikkerhedskopi.

Ved fejl fra modelserveren stopper forbindelsen, så agentmotorens genforsøg ikke udløser flere kald. Appen vælger ingen reserveudbyder. Beskeden bevares som kladde; brugeren vælger selv at prøve igen. En afbrudt strøm bliver behandlet som en fejl, ikke som en godkendt plan.

**Indstillinger → Hjælp og feedback** viser appversion og en lokal fejlrapport med faste statusfelter. Rapporten indeholder ingen samtaler, projektfiler, stier, serveradresser, kontonavne eller API-nøgler. Den gemmes og deles kun efter brugerens eget valg. Samme sted findes vejledning til at installere næste testversion med bevarede projekter og indstillinger.

## Start fra kildekoden

Kræver Node.js 22.12 eller nyere og npm. Kør `npm run runtime:prepare` én gang; det henter og kontrollerer den OpenCode-version, som står i `runtime-lock.json` (i dag 1.18.33), til `desktop/.runtime`. Appen søger i `HARNESS_OPENCODE_PATH`, i `desktop/.runtime`, i `~/.opencode/bin/` og på PATH og bruger kun den låste version. Den installerer eller opgraderer ikke OpenCode. Kør fra `desktop/`:

```bash
npm ci
npm start
```

Der findes lokale betapakker og pakker fra GitHub Actions; se [teststatus](../docs/teststatus.md) for præcis version og platform. Filernes signering og notarisation fremgår af den daterede teststatus. Pakker fra workflowet **Byg testpakker** er usignerede. Electron kan kræve netadgang ved installation fra kildekoden.

Appens navn og egne menuer er **Aura**. En installation fra før navneskiftet beholder sin datamappe og sit navn i nøgleringen, så gemte forbindelser og nøgler kan læses (`core/app-identity.cjs`). Under `npm start` bruges stadig udviklingsprogrammet `Electron.app` på macOS; procesvisning og visse systemdialoger kan derfor fortsat vise Electron. Dock-ikonet sættes til Aura-logoet ved opstart. Fuld systemnavngivning kræver en pakket app med egne bundle-oplysninger. Der ændres ikke i den installerede Electron-afhængighed. Navneskiftet bevarer eksisterende data- og sessionsmapper.

Logoets original er `docs/images/aura-icon.png`. `npm run icons` kopierer den uændret til brugerfladen og installationsikonet; det sker også før `npm start` og pakning. Sidepanel, introduktion, AI-opsætning og favicon bruger samme billedfil.

## Opstart og forbindelser

komplai findes kun som udgivelsesdestination under **Udgiv → komplai Run**. Der oprettes ingen AI-forbindelse gennem dette login.

Tidligere gemte komplai-AI-forbindelser vises under **AI-forbindelser** med en besked om at vælge en anden AI. De kan fjernes, men bruges ikke til modelkataloger eller beskeder. Et projekt med en tidligere komplai-forbindelse vælger ikke automatisk en anden udbyder. Fjernelse af en gammel AI-forbindelse berører ikke Run-adgangen; historiske samtaler og forbrug bevares.

### Den guidede opstart

Ved første start vælger brugeren mellem **Byg i Aura-appen** og **Brug Aura Harness i mit kodeværktøj**. Den første vej viser **Hvordan vil du starte?** med Start et projekt, Prøv et eksempel og Åbn et projekt. **Spring introduktionen over** går direkte til projektoprettelsen og huskes på denne computer. Introduktionen kan åbnes igen fra sidepanelet. Den guidede vej tilbyder AI-forbindelse eller fortsættelse uden AI; derefter beskriver brugeren sin idé og får et kort, redigerbart navneforslag, fx **Oversigt over tre fiktive mødelokaler**. Projektet lægges i **Dokumenter › Aura** uden mappedialog; **Vælg en anden placering** åbner dialogen. Mappenavnet skriver æ, ø og å om til ae, oe og aa, og et projekt med samme navn får et nummer, så en eksisterende mappe aldrig genbruges. Designmateriale og avancerede projektvalg er foldet sammen. Brugeren kan oprette eller åbne et lokalt projekt uden AI- eller GitHub-konto. Velkomst og demonstration kontakter ingen modelserver. Når AI-opsætningen åbnes, henter appen automatisk Ollamas modelliste fra http://127.0.0.1:11434/api/tags med en kort timeout. Ingen modelnøgle dekrypteres under søgningen.

AI-opsætningen viser to store valg: **Jeg har en adgangsnøgle** og **AI på min computer**. En gemt forbindelse vises som et tredje valg. Udbyderoversigten viser fire ligeværdige kort med logo: Claude, Mistral, Corti og Alexandra. **Bruger du en anden udbyder? Vælg en anden** viser Azure, Egen server, OpenAI, OpenCode Zen og OpenRouter; Ollama nås gennem **AI på min computer**. Først efter valget vises formularen. **Har du ikke en nøgle? Sådan får du en** åbner vejledning og faste sider hos udbyderen. Den guidede introduktion skjuler sidepanelet og viser ét trin ad gangen. **Vælg senere** går videre uden AI og bevarer idéen. Tilbage vender til valgene uden at sende en besked.

Til højre i opsætningen står et roligt statuspanel, **Din opsætning**, med den valgte udbyder og de tre led: din computer, forbindelsen og modellen. Det henter intet selv; teksten kommer fra det, appen allerede ved. Grønt står først, når et modelkatalog faktisk er hentet for den forbindelse, og en udbyder, musen hviler på, vises som forhåndsvisning uden at vælge eller sende noget. Logoerne er appens eget sæt gennem `ProviderBrand`. Efter forslag i #17.

Nøgler og GitHub-token indtastes kun i et eget vindue med sin egen session, som ikke kan nå internettet eller hovedvinduets indhold. Hovedvinduet har intet felt til en nøgle; det beder om vinduet med **Indtast nøgle** og får en engangskvittering tilbage med forbindelsens id, den nye tilstand, modelkataloget fra kontrollen og hvad rensningen rettede i den indsatte nøgle (mellemrum, usynlige tegn, anførselstegn og `Bearer`, `Authorization:` eller `NAVN=` foran). Nøglen renses og kontrolleres hos udbyderen, før den gemmes; en nøgle, udbyderen afviser, gemmes aldrig, og udbyderens svar står bag **Se detaljer** uden nøglen. Kan serveren ikke nås, fx en lokal server, der ikke kører, kan man vælge **Gem alligevel**. Ollama og Egen server har **Gem uden nøgle**.

Der kan gemmes flere forbindelser til samme udbyder, fx to Azure-miljøer med hvert sit navn, endpoint og nøgle. Efter tilslutning tilbyder **Tilføj en AI mere** at gentage forløbet. Oversigten under Indstillinger har søgning, fire forbindelser pr. side og **Kontrollér alle**. Status viser **Ikke kontrolleret**, **Forbundet** med tidspunkt, **Ingen modeller** eller **Ikke forbundet**. Kontrollen henter kun modelkataloget og sender ingen AI-opgave. **Gennemgå opsætningen** bevarer eksisterende forbindelser, projekt og kladde.

**OpenAI** bruger en API-nøgle og Responses API. Det er ikke login med et ChatGPT/Codex-abonnement. **Azure** kræver endpoint fra Azure OpenAI eller Microsoft Foundry, API-nøgle og modellens deploymentnavn. Responses API er udgangspunktet; Chat Completions kan vælges for en deployment, der kræver det. Azure-katalogkontrollen viser adgang til ressourcen, men beviser ikke, at den indtastede deployment kan køre. Priser og modelgrænser bruges kun, når der er grundlag for dem; der vælges ingen reserveudbyder.

**Gem og kontrollér** gemmer forbindelsen og henter modellisten. Ved en tom liste eller en fejl kan oplysningerne rettes og kontrollen gentages. **Fortsæt** bliver tilgængelig, når listen indeholder modeller. Et katalogsvar beviser ikke adgang til modelkald, kvote eller kodeværktøjer. For Claude, Mistral, Corti og Alexandra vælges udbyderens eget udgangspunkt på forhånd, når projektet åbnes, fx Claude Opus 5.5, som Anthropic selv angiver. Appen anbefaler ingen udbyder eller model. Under skrivefeltet står model, udbyder og indsats og samtalens tokens ind og ud med en anslået pris. For andre forbindelser vælger brugeren selv model. Den foretrukne forbindelse huskes lokalt, men bliver ukontrolleret efter genstart. Der skiftes aldrig automatisk til en anden model eller udbyder. **Indstillinger → AI-forbindelser** åbner oversigten; GitHub og lokale værktøjer findes under **Avanceret opsætning**.

Arbejdsområdet viser samtalen og ved siden af den en arbejdsflade med Forhåndsvisning, Plan, Ændringer, Kode og Aktivitet; Plan afhænger af de valgte funktioner. Se [Arbejdsfladen](#arbejdsfladen). Modelknappen i skrivefeltet åbner **Din AI** med højst tre modelkort; et klik vælger modellen og lukker dialogen. Referencer vises kun, når projektet har referencefiler. Før den første afsendelse viser **Før du sender** et kort resumé: hvem der modtager beskeden, hvor behandlingen sker, om data bruges til træning, og prisen. Alle oplysninger ligger under **Se alle oplysninger**. Accepterede vilkår huskes for projektet. Ændret modtager, model, pris, vilkår eller udvalg af private referencer kræver nyt samtykke. Almindelig fortsættelse, interne filhenvisninger og skift mellem Samtale, Planlæg og Byg gentager ikke resuméet. Tilføjelse af en almindelig API-forbindelse viser udbyder og nøgle; navn og serveradresse ligger under **Avanceret**. Egen server og Ollama åbner adressefelterne. Der er endnu ingen automatisk organisationsopsætning eller Claude-abonnementsforbindelse.

Efter projektoprettelse står idéen som en redigerbar kladde i **Byg**. Intet sendes automatisk; første afsendelse går gennem det almindelige modelsamtykke. Ekstra samtaler fra projektets + starter i **Samtale**, hvor AI'en kan besvare spørgsmål og læse relevante projektfiler. Filskrivning og kommandoer afvises i agentmotoren. Hvis en plan er relevant, kan AI'en tilbyde **Planlæg** ved siden af **Bliv i samtalen**. Planlæg forbereder en besked, som brugeren kan rette og sende. Et fravalg huskes i samtalen. Arbejdsmåden kan også vælges under skrivefeltet.

**Planlæg** er ligeledes skrivebeskyttet. Et svar med de fire konkrete planafsnit giver **Byg planen**. Et byggeforslag uden genkendelige afsnit kan få **Byg videre**, som bruger samtalen uden at kalde den en godkendt plan; et nej eller et åbent spørgsmål giver ikke knappen. **Byg** kan vælges direkte under skrivefeltet. En tydelig brugerbesked som "byg" skifter også til bygning før afsendelse. **Enter sender, Shift+Enter laver en ny linje.** ⌘Enter og Ctrl+Enter virker også gennem samme forløb som Send.

Et konkret forslag med de fire planafsnit i **Samtale** kan også bygges direkte. Det går forud for et tilbud om endnu en plan, også efter genåbning. Ved skift til Byg følger idéen, brugerens svar og den relevante samtale med til modellen.

Under projektindstillingerne kan **Auto-godkend filændringer** gemmes for projektet. Ellers spørger første filændring med **Tillad én gang**, **Tillad altid i projektet** og **Afvis**; tilladelse til resten af opgaven ligger under **Flere valg**. En konkret kommando eller adgang til en valgt mappe kan huskes og senere fjernes. Automatisk godkendte kommandoer kræver aktiv teknisk isolation, også når en konkret kommando er husket; se [Begrænsninger](#begrænsninger). Ændrede indstillinger gælder næste opgave. Hemmeligheder, Git-metadata og ikke-valgte private referencer er fortsat beskyttet.

På en platform uden understøttet kommandoisolation kan almindelige byggeopgaver og filændringer fortsætte. Kommandoer kræver enkeltgodkendelse, og **Tillad altid i projektet** vises ikke for kommandoer. En tidligere gemt kommandotilladelse aktiverer ikke automatisk kørsel dér. Hvis **Byg og kontrollér automatisk** udtrykkeligt er slået til, stopper opgaven med en forklaring, når isolation ikke kan etableres.

Tekniske aktiviteter står under fanen **Aktivitet**; samtalen viser én linje pr. opgave med antallet af værktøjer og **Se Aktivitet**. Resultatkortet viser antal ændrede filer og **Se ændringer**, som bliver til **Ændringer gennemgået** efter brug. **Fortryd opgaven** ligger under **Flere valg** og fjernes efter fortrydelsen. Projektmenuen **•••** indeholder versionsgemning og sikkerhedskopi. **Nyt projekt** står øverst i sidepanelets handlinger; en ny samtale startes med **+** ved projektet. Preview har skærmstørrelse, genindlæsning og en menu til skalering, egne mål og lokal server.

Farver, afstande, typografi og principper for synlige valg er beskrevet i [designstandarden](DESIGN.md).

Fejl i modelkataloget før afsendelse vises i arbejdsområdet med **Gennemgå AI-forbindelse** og **Fortsæt uden AI**. En fejl under en opgave står ét sted: på resultatkortet med en forklaring efter fejlens type og den handling, der kan hjælpe, fx **Gennemgå AI-forbindelse** ved en afvist nøgle, **Åbn kontoen hos udbyderen** ved opbrugt kvote og **Prøv igen** ved en afbrudt forbindelse. Udbyderens egen besked står under **Se detaljer**. Projekt, preview og beskedkladde bevares. Ingen automatisk gentagelse eller baggrundskontrol. GitHub er valgfri sikkerhedskopi og samarbejde; manglende adgang blokerer kun publiceringen. Manglende Git blokerer ikke oprettelse eller preview.

## Brugerrejse

1. Opret et projekt eller åbn en eksisterende eller tom mappe. Åbning kræver ikke `harness.json` og ændrer ingen projektfiler. Et ugyldigt manifest giver en advarsel.
2. Ved oprettelse kan du vælge farve, logo, links og referencefiler. Gem dem som en navngiven **designpakke** og vælg pakken igen ved et senere projekt. Biblioteket gemmer egne kopier lokalt i appens datamappe; flyttede originalfiler bryder derfor ikke pakken. Gentofte-adressen er kun et eksempel i inputfeltet og bliver ikke automatisk tilføjet. Pakker synkroniseres ikke mellem computere og opdaterer ikke allerede oprettede projekter.
3. Åbn **Indstillinger → AI-forbindelser**. **Tilføj forbindelse** går gennem den guidede opsætning. **Åbn** viser en gemt forbindelse med **Kontrollér forbindelse**, som kontrollerer kataloget; det beviser ikke, at modellen kan bruge kodeværktøjer. Vælg derefter model i arbejdsområdet. OpenRouter kræver en konkret underleverandør og bruger ingen automatisk fallback.
4. Gennemse **Indstillinger → Funktioner**. Funktionerne afgør, hvilke skills AI’en kan hente, for alle projekter eller kun det åbne. Under **Integrationer** slår du de systemer til, projektet skal hente data fra, fx Adresser og CVR. Under **Avanceret** kan instruktionerne redigeres og gendannes pr. projekt. API-nøgler hører til forbindelser, aldrig i skills. Skills er modelinstruktioner; tekniske tilladelser er adskilt.
5. Skriv en opgave. Før første afsendelse og ved ændrede modtagere, vilkår, pris, model eller private referencer viser appen datagennemgangen. Ukendte oplysninger vises som ukendte. Referencefiler vælges særskilt; links kan besøges via godkendte webopslag, inklusive relevante undersider.
6. Gennemgå filændringer, kommandoer og webopslag, når agenten beder om tilladelse. **Stop** afbryder opgaven. Fanen **Ændringer** viser først et resumé og derefter en linje-diff og siger, hvilke filer AI'en selv skrev.
7. En statisk `public/index.html` vises automatisk. React med Vite og Astro får i stedet **Start forhåndsvisning**, som fører til gennemgang af installation og serverstart. Under preview-menuens **Server og opstart** kan du også tilslutte en allerede startet loopback-server. Projektåbning kører ingen kommando. Manglende preview blokerer ikke chatten.

En faktisk læsning af projektmappen kontrollerer adgang ved åbning og oprettelse. Ved afvisning kan brugeren rette systemtilladelsen eller vælge en anden mappe før første AI-opgave. Det er en adgangsprøve, ikke en garanti for adgang til hver enkelt fil eller for kommandoværktøjernes OS-tilladelser.

Farve er et aktivt tilvalg. Uden det gemmes ingen brandfarve, og den midlertidige startside bruger neutral typografi. Agentens kontekst skelner mellem en uændret startside, eksisterende applikationskode og brugerens dokumenterede designvalg. Ældre projekters automatiske grønne farve regnes ikke som et bekræftet valg. Agenten kan foreslå og skrive backends i Python, Node.js eller andre sprog. Python, databaser og Docker følger ikke med Aura; andre kørende lokale webservere kan tilsluttes manuelt i preview.

Under en opgave skelner status mellem modellens forberedelse, svartekst og kode under modtagelse. Ræsonnement tælles ikke som synlig svartekst og vises ikke. **Følg arbejdet** åbner Aktivitet med AI'ens faktiske delopgaver og et valgfrit kodeudkast. Udkastet er tydeligt markeret som endnu ikke gemt; det skrives ikke til projektet og køres ikke i preview. Når filværktøjet har skrevet, opdateres fillisten og ændringerne under den igangværende opgave. En pause uden nye signaler får en særskilt tekst med mulighed for at vente eller stoppe. Udbydere uden delvise værktøjsargumenter får almindelig status uden et kodeudkast. Tokens og pris følger motorens faktiske forbrugsoplysninger, ikke et løbende gæt. Svar følges automatisk, når man står nederst. Ruller man op, bevares læsepositionen, og **Seneste svar** fører tilbage. Hex-farver i svar vises med en lille farveprøve; tekst kopieres uændret. Reduceret bevægelse slår animationen fra.

Projektets versionsstatus står ved projektmenuen. **Ændringer › Versioner** kan læses under en opgave; versionsgemning og gendannelse venter på, at arbejdet er afsluttet. **Fortryd opgaven** er et sekundært valg på resultatkortet. Efter gennemgang og gendannelse viser samtalen, hvor mange filer der er sat tilbage, og om de er gemt som en ny version.

`npm run test:conversation-progress` afprøver Samtale → frivillig Planlæg → Byg med rigtig Electron, OpenCode, midlertidige projektfiler og kontrollerede lokale modelsvar. Den afprøver også demoens konkrete afvisning, livekode før filskrivning, ændringer og historik under arbejde samt gennemgang og kvittering ved Fortryd. Den bruger ingen ekstern modelkonto.

Arbejdsområdet holder sig inden for vinduet. Samtale og aktivitet ruller i hvert sit panel, mens skrivefeltet bliver stående. Opstartsformularer og dialoger beholder deres egen rulning.

## Projekter og samtaler

Sidepanelet viser de seneste projekter med deres samtaler, nyeste først. Det åbne projekt er foldet ud; et klik på en samtale åbner den, og **+** ved projektet starter en ny. **Nyt projekt** opretter en særskilt app. En tom samtale genbruges, så der ikke opstår mange tomme. En samtale får navn efter første besked og kan omdøbes, arkiveres eller slettes under **•••**. Arkiverede samtaler kan hentes tilbage. Sletning flytter samtalefilen til papirkurven; projektfilerne og versionerne ændres ikke.

Flere samtaler og projekter kan arbejde samtidigt. Sidepanelet viser **arbejder**, **venter på dig**, **nyt resultat** og **klar til at flette** under samtalens navn. Godkendelser, spørgsmål, Stop og forbrug gælder hver sin samtale. Nyt projekt, Åbn projekt, AI-forbindelser, Funktioner, introduktion og Udgiv kan bruges under arbejdet. Ændrede AI- og funktionsvalg bruges fra næste opgave. Login og valg af udgivelsessted kan forberedes med det samme; selve upload venter på opgaver, der skriver i projektmappen.

Den første opgave bruger projektmappen. Sender en anden samtale, mens mappen er optaget, får den en lokal kopi med projektets aktuelle, også ugemte, filer. **Samtalens kopi** står over forhåndsvisningen, og samtalen viser **Flet ind i projektet**. Indfletning venter kun på projektet og kildekopien; andre kopier kan fortsætte. Kode, ændringer, aktivitet og forhåndsvisning følger samtalens arbejdsmappe. Formularer og rulning i preview bevares ved samtaleskift. Vite og Astro har hver sin server; en kopis server startes efter den eksisterende gennemgang og genstarter ikke automatisk efter lukning.

**Flet ind i projektet** gennemgår kopiens ændringer i forhold til filerne ved kopiens oprettelse og projektets filer nu. Projektets øvrige rettelser bevares. Ved konflikt viser Aura begge linjer, og **Behold dine linjer** er anbefalet. Filerne kontrolleres igen før indfletning. Med aktive automatiske versioner gemmes berørte ugemte projektfiler først, og indfletningen gemmes som en ny version. Når projektets preview kører, får versionen billeder før og efter af det faktisk flettede projekt, i samme visning. **Fortryd indfletningen** står på resultatkortet og bruger Auras journal, også uden Git og med versionsfunktionen slået fra. Den fjerner indfletningens ændringer og bevarer dine senere rettelser; ved samme linjer vælger du igen. Den seneste indfletning kan desuden fortrydes fra **Ændringer › Versioner**. En senere gendannelse afløser journalen; kortet afviser i så fald at fortryde en anden handling.

En uflettet kopi bevares over genstart og kan bruges til flere opgaver. Den fjernes efter indfletning eller bekræftet sletning af samtalen; sletningen advarer om tab af uflettede ændringer. Kopierne ligger under appens lokale data og er ikke en online sikkerhedskopi. På macOS bruges filkloner, hvor filsystemet understøtter det; andre platforme bruger almindelig kopiering uden `node_modules`. Git-metadata, kendte nøglefiler, genererede mapper og projektets symbolske links udelades. Interne pakkelinks på macOS peger på kopiens egne pakker. Valgte private referencer følger stadig datagennemgangen og motorens læsebeskyttelse.

Hver samtale fortsætter sin egen AI-session i OpenCode, også efter genstart, så længe arbejdsmappe, forbindelse, model og regler er de samme som sidst. Ved skift til en kopi eller tilbage til projektet starter en ny session med det nye arbejdsområde. Plan og afklaring følger med; tidligere beskeder medsendes efter dit valg. En ny session står under Aktivitet.

**Kommandopalet:** ⌘K (Ctrl+K på Windows og Linux) åbner en valgfri palet, hvor man kan søge efter en handling, en samtale eller et projekt. Den har ingen knap og nævnes under **Hjælp og feedback**. Paletten trykker på appens egne knapper, så en funktion, der er slået fra, eller en handling, der er låst, mens AI'en arbejder, heller ikke kan vælges dér. Piletasterne vælger, Enter udfører, og Escape lukker og giver fokus tilbage. Genvejen virker også med fokus i forhåndsvisningen.

## Luk og fortsæt

Samtalerne gemmes i appens datamappe, adskilt fra projektfilerne: én fil pr. samtale med beskeder, kladde, plan, forbrug og AI-sessionens id, og én projektfil med briefen og listen over samtaler. En hurtig lokal kopi af kladden beskytter også tekst, der endnu ikke er skrevet gennem appens lagring. Der sendes ingen AI-opgave ved genåbning. Godkendelser og valg af private referencer nulstilles.

Første gang et projekt fra før samtalerne åbnes, flyttes den gemte samtale og de arkiverede samtaler til hver sin samtalefil. Arkivfilerne bevares uændret.

Under **Tidligere samtale** kan brugeren vælge at medtage gemte beskeder i en ny modelsession. Det præcise materiale står i datagennemgangen. En valgt plan indeholder stadig sin afklaring, og en igangværende modelsession beholder sin egen kontekst. Tilvalget er ikke en måde at slette data fra udbyderen på.

Ved lukning under arbejde gemmes opgaven som afbrudt. Delvise svar vises, men agenten genstartes ikke, og brugeren opfordres til at gennemgå filerne. Projektfilerne ændres ikke. Kan oversigten over projektets samtaler ikke læses, bevares filen; **+** lægger den til side i arkivet og finder samtalerne igen ud fra samtalefilerne. En samtalefil, der ikke kan læses, bevares og kan slettes fra sidepanelet.

Samtaleindholdet er ikke krypteret. Modelnøgler gemmes fortsat separat med `safeStorage`; de kopieres ikke fra forbindelsesindstillinger til historikken. Hver samtale gemmer højst 200 beskeder og 200.000 tegn. Ved aktivt tilvalg medsendes op til 16 beskeder og 60.000 tegn. Ældre arkiver, slettede samtaler i papirkurven og OpenCodes rå log slettes ikke automatisk.

## Arbejdsfladen

Ved siden af samtalen står fem faner: **Forhåndsvisning**, **Plan**, **Ændringer**, **Kode** og **Aktivitet**. Forhåndsvisning er udgangspunktet, når et projekt åbnes. Fanerne ligger oven på hinanden og skjules kun visuelt, så previewets formularer og rulning, filvalget i Kode og rulningen i de andre faner bevares ved faneskift. Beskedkladden står uden for fanerne og påvirkes ikke. Kun brugeren skifter fane: når AI'en arbejder, får **Ændringer** et tal og **Aktivitet** en prik, men den åbne fane skifter ikke. Fanerne bruger piletasterne, Home og End.

- **Plan:** Øverst står **Projektbriefen**: det, brugeren selv har sagt. Den udfyldes fra idéen, ønskerne under **Ønsker til løsningen** og svarene på AI'ens spørgsmål, og hver linje viser, hvor den kommer fra, fx Dit svar. Brugeren kan rette, fjerne og tilføje linjer. AI'en skriver aldrig i briefen; den får den med hver besked som data, og den står under **Se alle oplysninger** i Før du sender. Under briefen står planen i fire afsnit, Det bygger vi, Sådan skal det se ud, Teknik og data (foldet sammen) og Det skal du prøve. **Byg første udkast** bygger efter planen. **Rediger planen** ændrer teksten direkte; brugerens version bruges ved bygning og kan føres tilbage med **Gendan AI'ens version**. **Bed AI'en rette** sender en rettelse. Ændres briefen efter planen, siger planen det. En bygget plan kan genåbnes og bygges igen. En plan fra en opgave, der blev stoppet, fejlede eller afløst, kan læses, men ikke bygges; **Bed AI'en om en ny plan ud fra den** lægger den i en ny besked. Briefen følger med til en ny samtale; planen gør ikke. Fanen vises, når funktionen Planlægning før bygning er slået til, eller når der findes en plan.
- **Spørgsmål fra AI'en** vises i samtalen ét ad gangen, fx "Spørgsmål 1 af 3 · Brugere", med store, klikbare svar og højst fire synlige ad gangen. AI'ens anbefalede svar står først og er markeret **AI'en anbefaler**. Spørgsmål med flere svar har **Fortsæt**. Under svarene står **Skriv dit eget svar**, **Tilbage** og **Spring over**; et spring over beder AI'en vælge selv og skrive antagelsen i planen. Svarene kommer i briefen. Et spørgsmål tager ikke fokus fra skrivefeltet. OpenCode tilbyder kun spørgeværktøjet til sine egne klienter, så Aura slår det til med `OPENCODE_ENABLE_QUESTION_TOOL`.
- **Ret i siden:** Knappen i forhåndsvisningens værktøjslinje slår en frivillig ændringstilstand til. Man peger og klikker på en tekst, et billede eller en knap; sidens egne klik og links reagerer ikke imens, og Escape afslutter. Med tastaturet flytter pil op og ned markeringen, pil venstre vælger det omgivende element, og Enter vælger. Kortet ved forhåndsvisningen viser elementets navn på dansk, fx Overskrift, teksten og linjen i koden, hvor Aura fandt teksten. **Ret teksten** retter teksten i et felt i Aura, ikke i selve siden; rettelsen gemmes straks i filen, forhåndsvisningen opdateres, og kortet siger, om siden viser den nye tekst. **Fortryd** sætter filen tilbage, så længe den er, som rettelsen efterlod den. Aura retter kun direkte, når teksten står ét sted i koden; står den flere steder, sættes den sammen i koden, ligger i et element med andre elementer eller kan indeholde en nøgle, siger kortet hvorfor, og **Bed AI'en ændre det** er vejen videre. Det gør elementet til målet for næste besked: målet står over skrivefeltet, i **Før du sender** med den præcise beskrivelse, AI'en får, i samtalen og på resultatkortet. Virker med statisk HTML og med React/Vite og Astro gennem deres egen udviklingsserver.
- **Ændringer:** To visninger: **Denne samtale** og **Versioner** (se Lokale Git-versioner). Under Denne samtale vælges den igangværende eller en afsluttet AI-opgave, en af dine rettelser eller **Hele samtalen**. En AI-opgave viser billeder af forhåndsvisningen før og efter, når Aura har taget dem. Resuméet siger, hvad der sammenlignes med, fx filerne, da opgaven startede, og hvor mange linjer der er tilføjet og fjernet. Hver fil står med Ny, Ændret eller Slettet og med, hvem der ændrede den: **AI'en**, når AI'ens eget filværktøj skrev præcis det indhold, der ligger nu; **AI'en og andre**, når filen også er ændret af andre; **En kommando eller dig**, når filen ændrede sig under opgaven uden AI'ens filværktøjer, og AI'en kørte kommandoer; **Dig**, når du ændrede filen i Aura med Ret i siden eller Fortryd; ellers **Ikke AI'en**. Dine rettelser og fortrydelser står også under Vis. Under listen står filens linje-diff med linjenumre, + og −. En fil med en mulig nøgle viser kun antallet af linjer. Ændringerne huskes, så længe appen er åben; ældre ændringer findes under Versioner. Har AI'en lavet nye ændringer, mens fanen er åben, vises **Vis dem** i stedet for at skifte indholdet.
- **Kode:** Projektets filer kan læses, men ikke ændres. Filer, der er ændret i samtalen, står først, og der er søgning. Nøgler og `.env`-filer, private referencer, Git-historik, installerede pakker, genererede mapper, symbolske links og filer med mulige nøgler i indholdet vises ikke; stien kontrolleres i hovedprocessen (`core/project-files.cjs`). Koden vises som tekst, aldrig som HTML. Billeder vises som billeder. Et klik på et linjenummer vælger linjen, Skift-klik et område. **Henvis i beskeden** tilføjer filens sti og eventuelle linjer til næste besked. AI'en får kun stien og læser selv filen; henvisningen står i skrivefeltet og i **Før du sender**, og beskyttede filer kan ikke henvises til.
- **Filhenvisninger i samtalen:** En sti i AI'ens svar, fx `public/index.html` eller `src/app.js:12`, bliver et link, når filen findes i projektet og kan vises. Linket åbner filen under Kode ved linjen. Resultatkortet viser de ændrede filer som links til deres diff.
- **Aktivitet:** Én række pr. faktisk hændelse: opgavens start med model, hvert værktøj med mål og status, godkendelser med ventetid og dit svar, spørgsmål, fejl, Stop, opgavens resultat, versioner og forhåndsvisningens server. En kommandos output kan foldes ud; kendte nøglemønstre er skjult. Afsluttet betyder ikke bestået. Loggen gemmes ikke på disken og forsvinder, når Aura lukkes.

Sidepanelet kan foldes sammen til en smal række ikoner med knappen ved Aura-navnet. Valget huskes på computeren. I et smalt vindue eller med stor tekst (Vis › Zoom ind) er det foldet sammen og lægger sig oven på indholdet, når det foldes ud; Escape lukker det igen.

## Paneler og skærmstørrelser

Træk skillelinjen mellem samtale og preview for at ændre panelbredden. Skillelinjen kan også fokuseres med Tab og flyttes med piletasterne (Shift giver større trin); Home/End vælger yderpunkterne, og dobbeltklik gendanner standardbredden.

Preview tilbyder fleksibel størrelse, desktop 1920 × 1080, tablet/iPad 768 × 1024, mobil/iPhone 390 × 844 og egne mål fra 240 til 7680 CSS-pixels. Du kan rotere visningen, tilpasse den visuelt til panelet eller vise den ved 100 % med rulning. Nedskalering ændrer ikke sidens layoutbredde eller media queries. Valgene gemmes lokalt i appens brugerflade og ændrer ingen projektfiler. Størrelserne er repræsentative layouts, ikke emulering af Safari, touch eller en bestemt fysisk enhed.

Afprøvet i Electron på macOS med et rigtigt projekt: træk, tastatur, faste og egne mål, rotation, iframe-layoutmål, skalering og vinduesstørrelse. Arbejdsfladen er desuden afprøvet ved 980 × 720 med 100 %, 125 % og 150 % tekst. Windows er ikke afprøvet.

## Lokale Git-versioner

Nye projekter fra appen har versioner fra start. Ved oprettelsen laver appen en lokal Git-historik med branchen `main` og gemmer startfilerne som første version, "Projekt oprettet". Har computeren ingen Git-identitet, bruges den anonyme identitet `Aura-bruger <bruger@aura.invalid>`. Adressen kan aldrig modtage post, og en eksisterende identitet overskrives ikke. Eksisterende mapper og repositories røres ikke ved åbning. Brugeren kan selv slå versioner til, og mangler navn eller e-mail, viser appen en formular.

Historikken står under **Ændringer › Versioner**; projektmenuens **Versioner** åbner samme sted. Øverst står i almindeligt dansk, om alt er gemt, eller hvor mange ændringer der ikke er gemt. **Gem version** gemmer med ét klik alle ændrede filer, som versionsgemningen accepterer, og navnet er valgfrit. Filer med mulige nøgler og andre beskyttede filer nævnes og bliver ugemte. Aktivt filvalg, branch og identitet ligger under **Avanceret**.

- **Navne:** Hver version har et kort navn ud fra opgaven, fx "Byg første udkast efter den plan, jeg har gennemgået", og en type: AI-opgave, Din version, Gendannet, Fortrudt eller Start. En gendannelse hedder "Tilbage til »…«" og en fortrydelse "Fortrudt »…«". **Omdøb** giver versionen et andet navn i Aura. Navnet gemmes kun i appens data på denne computer; Git-beskeden ændres ikke.
- **Billeder før og efter:** Aura tager i baggrunden et billede af forhåndsvisningen før og efter en AI-opgave og en gendannelse, af samme side i samme størrelse som forhåndsvisningen. Når du selv gemmer en version, tages et billede efter, og det seneste billede af samme side bruges som før. Billederne tages i et skjult vindue uden adgang til andet end forhåndsvisningen, gemmes i appens data, ikke i projektet, sendes ikke til AI'en, og de ældste ryddes efter 80. Uden en kørende forhåndsvisning tages ingen billeder.
- **Én version:** Et klik på en version viser billederne, filerne med linje-diff og to veje tilbage: **Gå tilbage hertil** gør projektet som versionen, og **Fortryd kun denne version** fjerner kun den versions egne ændringer.
- **Gennemgang før enhver gendannelse:** Dialogen viser forhåndsvisningen nu og det, den går tilbage til, hvad der sker med hver fil, dine ugemte ændringer og, foldet sammen, hvad der ellers berøres: kopien, filer uden for versionerne, nøgler og installerede pakker, samtalen, briefen og planen, forhåndsvisningen og om resultatet gemmes som version. Kildekodeversionen kræver Git; installationspakken medleverer Git. Projektet er et almindeligt Git-repository, som kan overtages uden Aura.

Nye projekter gemmer en version efter hver AI-opgave. For åbnede mapper vælges det i Versioner.
- **Hvad der gemmes:** De filer, der ændrede sig under opgaven, målt på indhold i forhold til opgavens start. Det gælder uanset, om AI'en skrev filen, brugte en kommando eller et patchværktøj.
- **Hvad der ikke kommer med:** Brugerens egne ugemte ændringer fra før opgaven. En afbrudt eller mislykket opgave gemmes som "Afbrudt AI-opgave", så den kan fortrydes.
- **Hvad der aldrig gemmes automatisk:** hemmeligheder, beskyttede stier og store eller ukendte binære filer.
- **Hvornår der springes over:** ved hooks, filtre, igangværende Git-handlinger, staged ændringer, ændret historik under opgaven og manglende første version.

Resultatkortet tilbyder **Fortryd opgaven**. Den fjerner kun opgavens egne ændringer: har du selv rettet i projektet bagefter, også i samme fil, bevares det. Har du og opgaven rettet de samme linjer, viser dialogen begge dele og spørger, hvad der skal gælde; som standard beholdes dine linjer. Er opgaven gemt som version, fortrydes versionen; ellers bruges Auras øjebliksbilleder, så længe appen er åben, også i en mappe uden Git. Med automatiske versioner gemmes dine ugemte ændringer i de berørte filer først som versionen "Dine ændringer før fortrydelsen" eller "… før gendannelsen", og resultatet gemmes som en ny version. Historikken ændres aldrig bagud, og man kan altid gå frem igen. Uden automatiske versioner kan en gendannelse fortrydes med **Fortryd sidste gendannelse**. En version bekræfter ikke, at koden virker.

Eksisterende staged ændringer, konflikter, igangværende Git-operationer og detached HEAD blokerer appens versionsgemning. Mapper inde i et overordnet repository skal åbnes fra repositoryets rod. Manuel gemning respekterer Git-hooks og signering; disse kan køre lokale programmer. Hvis et commit afvises, kan de valgte filer forblive staged til gennemgang i brugerens Git-værktøj.

Visningen understøtter højst 200 ændrede filer og 2 MB pr. fil. Kendte hemmelighedsfiler, private referencer, symbolske links og mistænkeligt tekstindhold blokeres. Visse billed- og skrifttypefiler kan vælges manuelt uden indholdsvisning. Kontrollen er heuristisk og finder ikke alle hemmeligheder; `.env`-skabeloner blokeres også. Undgå samtidige filændringer fra andre programmer under versionsgemning: Git-kontrollerne er ikke en lås på hele filsystemet.

Versionsgemning pusher eller deployer ikke. Kodepublicering er en særskilt, eksplicit handling beskrevet nedenfor. Lokale funktioner kræver fortsat ingen hostingkonto.

## GitHub og kodepublicering

**Forbind GitHub** under Forbindelser og konto og **Sikkerhedskopi** i arbejdsområdet åbner samme modul. GitHub er den første udbyderadapter; `Publishing` afhænger af en provider med `id`, `get` og `credential`, samt en udskiftelig Git-transport. Codeberg, GitHub Enterprise og egne servere har endnu ingen færdig adapter. Projektet forbliver et almindeligt Git-repository.

Browserlogin bruger GitHubs Device Flow. En vedligeholder skal registrere en OAuth-app, aktivere Device Flow og angive dens offentlige Client ID i `HARNESS_GITHUB_CLIENT_ID` ved start. Ingen client secret skal indbygges eller deles. OAuth beder om `repo read:org`; dette er bred adgang. Organisationen kan kræve egen godkendelse eller SSO. En GitHub App med finere rettigheder er ikke implementeret her. Alternativt kan brugeren indtaste et GitHub-token i appens skjulte felt. Et afgrænset token skal have relevante repositories og Contents read/write; oprettelse og workflows kan kræve yderligere rettigheder. Browserlogin uden Client ID er tydeligt deaktiveret.

Adgangstokens valideres mod GitHubs bruger-API og gemmes med Electron safeStorage adskilt fra modelnøgler. Renderer og projektfiler får ikke tokenet retur. Annullering og udløb kræver nyt login; refresh-tokens bruges ikke. **Fjern adgang fra appen** sletter kun den lokale adgang, ikke GitHubs autorisation. I Pages-guiden kan brugeren udtrykkeligt vælge at genbruge et eksisterende `gh`-login. Intet login overtages automatisk, og brugerens Git-identitet ændres ikke.

Efter kontrol af kontoen kan brugeren vælge egen konto eller en organisation, inklusive AI Alliancen ved tilstrækkelige rettigheder. Repositorylisten viser adgang, ikke en garanti for at organisations- og branchregler tillader handlingen. Oprettelse kræver særskilt bekræftelse af ejer, navn og privat/offentlig synlighed. Et nyt repository oprettes tomt uden commit; det tilsluttes derefter aktivt. Eksisterende repositories kan vælges fra listen eller angives som `ejer/navn`.

Tilslutning tilføjer `origin` eller `harness-github`, hvis der ikke allerede findes en passende remote. En eksisterende remote overskrives aldrig. Appens valg gemmes desuden pr. projekt uden for repositoryet. Push bruger den præcist gennemgåede HTTPS-destination og branch, ikke en skjult standardremote.

**Gennemgå historik til push** kræver rent arbejdsområde, en gemt version og afklaret Git-status. Den henter serverens branch og nødvendige Git-objekter uden at ændre arbejdsfiler, lokal branch eller FETCH_HEAD. Serverhistorik foran eller forskellig fra den lokale afvises til manuel integration. Ingen automatisk merge, rebase, pull eller force-push. Ved første push kan den gennemgåede branch oprettes på serveren; ingen andre branches eller tags pushes.

Kontrollen gennemgår filindhold i alle udgående versioner, også slettede hemmeligheder i tidligere commits. Kendte private filer, symbolske links, undermoduler, ukendte binærtyper, store historikker, shallow repositories og lokale historikerstatninger afvises. Grænser: 100 commits, 2.000 filer, 2 MB pr. blob og 20 MB samlet. Filnavne, almindelige tokenmønstre og disse grænser er ikke en garanti mod hemmeligheder. Git-hooks, Git LFS og særlige netværks-/URL-regler kræver publicering i brugerens Git-værktøj; appen slår dem ikke fra.

Før push vises destination, synlighed, branch, commitantal og filer. Brugeren bekræfter aktivt. Lokal HEAD, serverreference og synlighed kontrolleres igen; ændringer kræver en ny gennemgang. Almindeligt Git-push beskytter desuden mod samtidige ikke-fast-forward-opdateringer. GitHub-branchregler kan afvise push. Nøglen gives kun til Git-processens miljø for den faste HTTPS-destination, aldrig til argumenter, logs eller Git-konfiguration på disk. Git er en betroet lokal proces, ikke en OS-sandbox.

Et bekræftet push betyder, at versionen blev set på serveren ved kontrollen. Senere ændringer kræver ny kontrol. En netværksfejl kan gøre udfaldet ukendt; appen forsøger ikke automatisk igen. **Kode på GitHub er ikke en deployet applikation.** Testudgivelse er en separat handling beskrevet nedenfor.

## Moduler og data

- `core/github.cjs`, `core/publishing.cjs`: GitHub-login, repositoryvalg, historikgennemgang og separat push.
- `core/git.cjs`, `core/checkpoints.cjs`: lokal Git-gennemgang, Git fra start i nye projekter, Gem version med ét klik, aktivt filvalg og automatiske versioner efter AI-opgaver.
- `core/projects.cjs`: lokale mapper og kompatibilitet med `harness.json`, version 1.
- `core/designs.cjs`: genbrug af designmateriale uden modelkald. Kopier i appdata er almindelige lokale filer, ikke krypteret dokumentlagring.
- `core/workspaces.cjs`, `core/workbench.cjs`, `core/chat-session.cjs`, `core/workspace-history.cjs`: en arbejdsbænk pr. projekt, særskilt opgavetilstand og motor pr. samtale, samtalefiler og reservation af arbejdsmapper; agentmotoren kan udskiftes via `engineFactory`.
- `core/copies.cjs`: lokale samtalekopier, sammenligningsgrundlag, genåbning og oprydning. Indfletning bruger den eksisterende `core/restoration.cjs` og `core/merge.cjs`; der oprettes ingen Git-worktrees eller grene.
- `ui/chats.js`, `ui/palette.js`: sidepanelets projekter og samtaler samt søgning efter eksisterende handlinger.
- `core/connections.cjs`: normalisering, modelkatalog, egenskaber, leverandørrouting, dataoplysninger og motorkonfiguration. Anthropic Messages samt OpenAI-kompatible Chat Completions er implementeret. Responses-only modeller og modeller uden brugbare værktøjskald er ikke generelt understøttet; katalogsynlighed er ikke kompatibilitetsbevis.
- `core/engine.cjs`: versionskontrol, adgangskodebeskyttet loopback-server, sessionsstream, stop og godkendelser. Motoren får isolerede konfigurations-/datamapper; brugerens OpenCode-opsætning overskrives ikke. Effektive tilladelser kontrolleres før start. Automatisk deling, snapshots, brugerplugins, MCP og eksterne skills er slået fra. Auras eget plugin indlæses ved isoleret kommandokørsel og skal kvittere før start.
- `core/command-sandbox.cjs`, `core/command-sandbox-runner.mjs`, `core/approvals-policy.cjs`: teknisk isolation og tilladelser pr. projekt. `core/model-consent.cjs` adskiller datagodkendelsen fra den enkelte opgaves indstillinger.
- `core/gateway.cjs`: autentificeret loopback-forbindelse mellem motor og valgt model. Den rigtige udbydernøgle bliver i hovedprocessen; motoren får en midlertidig nøgle. Ingen reserveudbyder eller automatisk ændring til en anden model.
- `core/store.cjs`: modelvalg, skills og indstillinger under Electrons `userData/harness`, uden for repositoryet. Modelnøgler krypteres med Electron `safeStorage`; appen afviser lagring, hvis kryptering ikke er tilgængelig. Lokalt samtale-/værktøjsindhold gemmes af OpenCode i samme appområde. Appens samtalevisning genåbner beskeder, og arkiverede samtaler kan gendannes fra projektet. OpenCodes rå værktøjslog har ingen historikbrowser eller automatisk slettefrist.
- `core/skills.cjs` og `../profiles/skills/`: synlige danske instruktioner om mål, Git, nøgler, test og designresearch; de fælles grundregler vises også som en redigerbar skill.
- `core/preview.cjs`, `core/dev-server.cjs`, `core/dev-server-runner.cjs`: statisk visning samt godkendt npm-installation og styring af lokale frameworkservere.
- `core/changes.cjs`: øjebliksbilleder af projektets tekstfiler med størrelsesgrænser.
- `core/diff.cjs`, `core/change-review.cjs`: linje-diff, resumé og tilskrivning af ændringer pr. opgave og for hele samtalen.
- `core/project-files.cjs`: skrivebeskyttet fillæsning og filhenvisninger med appens filbeskyttelse.
- `core/history.cjs`, `core/merge.cjs`, `ui/history.js`: versionernes navne og typer, hvad en version ændrede, billeder af forhåndsvisningen før og efter, trevejsfletning til Fortryd og gennemgangen før gendannelse. `core/restoration.cjs` udfører gendannelse og fortrydelse med kopi og journal, også uden Git.
- `core/preview-edit.cjs`, `ui/preview-edit.js`: Ret i siden: valgscriptet, rensning af data fra siden, tekstsøgning i kildefilerne, direkte tekstrettelse og beskrivelsen af et valgt element til AI'en. Fortryd ud fra øjebliksbilleder ligger i `core/workbench.cjs`.
- `core/activity.cjs`: aktivitetsloggen fra agentens hændelser, godkendelser og forhåndsvisningens server.
- `ui/approval-view.js`, `ui/approvals.js`: godkendelseskort, kommandogæt, fejltyper og kommandoresultater.
- `core/brief.cjs`, `ui/plan-view.js`, `ui/planning.js`: projektbriefen, planens afsnit, rettelser af planen og AI'ens spørgsmål ét ad gangen.
- `main.cjs`, `preload.cjs`, `ui/`: validerede native handlinger, begrænset IPC-bro og brugerflade uden Node-adgang.

## Begrænsninger

**Byg og kontrollér automatisk** isolerer agentens shellkommandoer med den fastlåste `@anthropic-ai/sandbox-runtime` på macOS og Linux. Kommandoer får projektet og opgavens midlertidige mappe, renset miljø og adgang til de angivne offentlige pakkeregistre. Andre projektmapper, hjemmemappen, kendte hemmeligheder og Git-metadata afvises. Muligheden er ikke understøttet på Windows og afvises, hvis beskyttelsen ikke kan starte. Linux-integrationen skal afprøves på Linux før en platformsudgivelse.

Dette er ikke isolation af hele Aura. Agentens læse-/filværktøjer har særskilte tilladelser; Auras eksplicit godkendte preview-, installations-, Git- og udgivelsesforløb bruger andre betroede processer. Uden automatisk kommandokørsel kan en særskilt godkendt kommando fortsat bruge brugerens almindelige adgang. Skills kan ikke ophæve de tekniske tilladelser.

Previewets renderer har ikke Node-/IPC-adgang. Statisk preview serverer kun almindelige filer under `public/` og afviser skjulte filer og symbolske links. Hvert arbejdsområde har sin egen stabile `aura-preview`-adresse og dermed sit eget browserlager. Eksternt netværk er lukket som udgangspunkt; projektindstillingerne kan tillade præcise adresser for forbindelser, scripts, billeder og typografi. En tilsluttet udviklingsserver tillader sin egen origin og WebSocket-forbindelse. Reglerne gælder den enkelte ramme, så et projekt ikke arver et andet projekts adgang. Devserveres automatiske port kan ændres ved genstart; deres browserlager er derfor ikke garanteret stabilt. Serverens egne indlejringsregler bevares.

Ret i siden indsætter kun et valgscript i forhåndsvisningens ramme, mens brugeren selv har slået tilstanden til. Scriptet kører i sidens egen verden fra hovedprocessen; sandbox, indholdspolitik og netværksregler er de samme, og siden får ingen adgang til Aura. Det, siden sender tilbage, er upålidelige data: felterne begrænses, kontroltegn fjernes, og et element med en mulig nøgle vises og sendes ikke. Sidens eget script kan stadig se markeringen og kalde valgscriptet, mens tilstanden er slået til. Tekstsøgningen finder den viste tekst i kildefilerne og tåler linjeskift og almindelige HTML-tegnkoder, men ikke tekst, der sættes sammen i koden, kommer fra data eller ændres af CSS. Aura retter aldrig i kommentarer, scripts, genererede mapper eller beskyttede filer. Fortryd uden version virker for tekstfiler, så længe appen er åben, og kun når filerne stadig er, som ændringen efterlod dem. Fortryd for en tekstrettelse står på kortet, indtil man vælger et nyt element; derefter er Versioner vejen tilbage.

Fletningen ved Fortryd sammenligner linjer. Ændringer på linjer lige op ad hinanden flettes; ændringer af de samme linjer er en konflikt. Billedfiler og andre binære filer flettes ikke; ændrede du dem efter opgaven, vælger du hele filen. Efter en gendannelse stoppes en Vite- eller Astro-server, og der tages intet billede efter, før den er startet igen.

Indfletning fra en samtalekopi har samme filbeskyttelse som gendannelse: højst 200 ændrede filer, 2 MB pr. fil og gennemgangens samlede størrelsesgrænse. Ændrede private referencer, symbolske links, mulige nøgler, Git LFS og ændrede eksekveringsrettigheder kræver manuel gennemgang; kopien bevares. Grundlaget omfatter højst 2.000 filer og 64 MB. Ændringer, der ikke kan gennemgås, må ikke forsvinde ved en ellers vellykket indfletning. Kopien er et separat arbejdsområde, ikke en OS-sandbox for godkendte kommandoer.

Statisk preview genindlæser ved filændringer; Vite og Astro bruger deres egen HMR. Filgrænsen for statiske filer er 10 MB. Ændringsoversigten udelader afhængigheder, kendte hemmelighedsfiler, referencer, binære/store filer og overstiger ikke 1.000 tekstfiler/10 MB samlet. Filnavne alene identificerer ikke alle hemmeligheder.

Private modelservere bruger **Egen server** med den faktiske adresse, port og kompatible modeltjeneste. Det kan også være en server over Tailscale. Appen ændrer ikke netværket eller serveren. Adresse og netværk fortæller ikke i sig selv, hvor modellen behandler data eller om den videresender til cloud.

Cloud-arbejdsområder, kommunale rettighedspolitikker, Docker-opsætning og andre deploymenttyper end dem beskrevet nedenfor er ikke tilsluttet. GitHub er den eneste færdige kodepubliceringsadapter. Modelplacering og arbejdsområdets placering er separate valg i arkitekturen; denne version tilbyder kun lokale arbejdsområder. En cloud-implementering kræver et aftalt host-/loginmodul og håndhævelse af kommunens rettigheder. Azure er ikke valgt som obligatorisk destination. Claude-abonnement er utilgængeligt; Anthropic API-nøgle er den implementerede forbindelsesvej.

## Start projektets lokale app

Når projektet får en `package.json`, genkender appen Vite og Astro uden at køre kode. En gammel `public/index.html` bliver ikke vist som frameworkets resultat. Vælg **Start forhåndsvisning**, gennemgå installationen, og start derefter serveren. Det samme forløb ligger under preview-menuens **Server og opstart**.

**Automatisk** er udgangspunktet. Aura genkender Vite, Astro, npm-startscripts samt almindelige Django-, FastAPI- og Flask-projekter. Under projektindstillinger kan op til fire tjenester beskrives med program, argumenter, mappe og port, fx frontend og backend. Python og andre sprog følger ikke med Aura. **Enkel hjemmeside** kan vælges særskilt. Andre kørende lokale servere kan fortsat tilsluttes manuelt.

- Installationen bruger `npm ci`, når en npm-lockfil findes; ellers `npm install`. `node_modules` kan erstattes, og uden lockfil kan `package-lock.json` oprettes eller ændres. Pakker hentes fra projektets og brugerens npm-opsætning, som også kan indeholde private registre. Installation kræver særskilt godkendelse.
- Installationsscripts er slået fra som standard. De kan tillades under **Detaljer og fejlfinding** ved en ny gennemgang. Start bruger frameworkets API direkte og kører ikke npm `predev` eller `postdev`.
- Godkendelsen gælder én handling i ét projekt. Ændringer i manifest, lockfiler, npm-opsætning eller de kendte frameworkkonfigurationer kræver ny gennemgang. Starten fastlåser ikke alle projektets kildefiler.
- Vite og Astro bindes til `127.0.0.1` på en ledig port. Egne tjenester får `HOST` og `PORT`; programmet skal bruge dem eller de angivne argumenter. Siden kontrolleres over HTTP før visning. Stop findes i dialogen; projektskift bevarer serveren, og lukning af Aura stopper den. Genåbning starter den ikke igen. Afbrudt installation bevarer filer og eventuelt delvise pakker, som kan geninstalleres efter gennemgang.
- Projektkode, konfiguration og tilladte pakkescripts har brugerens adgang til filer og netværk. Det er ikke en OS-sandbox. Appens miljønøgler og `NODE_OPTIONS` arves ikke; projektkode kan stadig selv læse lokale filer og opsætning. Procesloggen er afgrænset og bliver i hukommelsen. Kendte nøglemønstre maskeres, men loggen skal gennemgås før deling.

Pakkerne har Node/npm med. Ved kørsel fra kildekoden bruges en eksisterende Node-installation fra PATH. Serverstarteren pakkes uden for `app.asar`, så almindelig Node kan læse den. Intet installeres globalt.

`npm run test:frameworks` henter fastlåste testpakker til nye midlertidige mapper og gennemfører forløbet i Electron. Den bruger React 19.3.0, Vite 8.3.1 og Astro 7.3.5 med syntetisk indhold. Den er derfor separat fra `npm test`. Andre frameworkversioner kan have ændrede API'er, især Astro, hvis program-API er eksperimentelt. Se [Vites API](https://vite.dev/guide/api-javascript), [Astros API](https://docs.astro.build/en/reference/programmatic-reference/) og [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), kontrolleret 28. september 2026.

## Afprøvning

Kør fra `desktop/`:

```bash
node --test --test-concurrency=1 tests/*.test.cjs
npm run test:desktop
npm run test:setup
npm run test:key-window
npm run test:agent
npm run test:chat
npm run test:chat-feedback
npm run test:layout
npm run test:connections
npm run test:openai-azure
npm run test:mistral
npm run test:resume
npm run test:frameworks
npm run test:hosting
npm run test:workspace
npm run test:planning
npm run test:approvals
npm run test:preview-edit
npm run test:history
npm run test:chats
npm run test:concurrent
AURA_COPY_FRAMEWORK=astro npm run test:concurrent
```

`npm run test:preview-edit` henter de samme fastlåste React-, Vite- og Astro-pakker som `test:frameworks`. `AURA_SKIP_FRAMEWORKS=1` springer den del over.

`test:concurrent` bruger flere rigtige OpenCode-motorer, en kontrolleret lokal modelserver og midlertidige projektfiler. Den afprøver samtidige godkendelser, særskilt kode og preview, formularer ved samtaleskift, indfletning uden og med konflikt, Fortryd uden Git, Stop, genstart, oprydning og to rigtige frameworkservere. Standardprøven bruger Vite 8.3.1; `AURA_COPY_FRAMEWORK=astro` bruger Astro 7.3.5. Begge gennemgår også indfletning fra en kopi, hvor frameworket har kørt, og at kopiens server stoppes uden at stoppe projektets. Automatiske versioner og før/efter-billeder kontrolleres alene i testprojektet. Tastaturfokus kontrolleres med styret ventetid efter den faktiske filindlæsning. Kør Electron-prøver og enhedsprøver hver for sig. ZIP-prøvens bytekontrol kræver samme Node/zlib som ved pakkegenereringen; brug den fastlåste Node fra `desktop/.runtime/<platform>/node/`, hvis systemets version komprimerer anderledes.

Astro-varianten flytter også kopiens manifest til side mellem to opstarter og kontrollerer, at appen viser problemet og bevarer filerne. Billedprøven venter på faktiske IPC-svar i en løkke; den fastlåste Playwright gentager ikke en asynkron `waitForFunction`-betingelse, som returnerer `false`.

Git-, publicerings- og chattestene opretter rigtige commits med syntetiske filer og testidentitet i nye, isolerede midlertidige repositories. Publiceringstestene pusher kun mellem nye lokale testrepositories. GitHub-API’et simuleres i testen; ingen eksterne repositories oprettes. De committer eller pusher ikke dette projekt. Electron-testen bevarer den normale hjemmemappe, så macOS safeStorage kan bruge den eksisterende nøglering; testidentiteten sættes kun lokalt i testrepositoryet. Nøgleringen skal aldrig nulstilles som led i testen.

Desktop- og chattest kræver en grafisk session. Agent- og chattest kræver den låste OpenCode-version fra `npm run runtime:prepare`. Native dialogers svar simuleres med isolerede teststier; operativsystemets dialogbetjening skal afprøves manuelt. Integrationstestene bruger en kontrolleret lokal modelserver, rigtige filer og rigtige OpenCode-værktøjer. Testmapper/skærmbilleder bevares under systemets midlertidige mappe, og stierne udskrives.

`tests/opencode-contract.test.cjs` holder Aura op mod rigtige tilladelsesforespørgsler fra den låste OpenCode i `tests/fixtures/opencode-<VERSION>/`. Testen fejler, når OpenCode-versionen skifter, indtil der er optaget forfra med `node scripts/record-opencode-contract.cjs`. Optageren køres kun manuelt og lokalt med en lokal testmodel; `README.md` i fixturemappen forklarer sættene og de målte fakta.

Den valgfrie webkontrol bruger en lokal testmodel, men lader den rigtige agents webværktøj hente Gentofte-guidens offentlige forside og underside:

```bash
node scripts/verify-design-web.cjs
```

`test:live-app` gennemfører det afgrænsede mødelokaleforløb i Aura med en rigtig model: plan, bygning, filtrering i preview på computer/mobil, rettelse og bytekontrol efter Fortryd. Nøglen indtastes direkte i prøvens isolerede appvindue. Brug kun syntetiske data og egen godkendte adgang; modelkald kan koste penge. Prøven sletter sine appdata med den krypterede nøgle bagefter og ændrer ikke brugerens normale appdata eller nøglering. Resultatstien udskrives; en valgfri resultatmappe skal være ny.

```bash
HARNESS_LIVE_PROVIDER=corti HARNESS_TEST_PACKAGE="release/mac-arm64/Aura.app" npm run test:live-app -- /private/tmp/aura-corti-proeve corti-s1
```

Udelad `HARNESS_TEST_PACKAGE` for at køre fra kildekoden. `--controlled` gennemfører samme prøve med lokal kontrolleret model og rigtig OpenCode; det er ikke en live-modelprøve. `--controlled --controlled-failure` fremkalder HTTP 401 og skal ende med exit 1 og en fejlrapport. Den signerede kandidat og den faktiske eksterne status står i [teststatus](../docs/teststatus.md#tre-konkrete-prøver-før-udsendelse--8-oktober-2026).

Den særskilte eksterne modelprøve sender kun syntetisk projektmateriale og offentlige regler til Zen-modellen `big-pickle`, uden API-nøgle. Kontrollér aktuelle vilkår før en ny kørsel; den indgår ikke i standardtestene:

```bash
npm run test:live
```

En særskilt prøve med en rigtig gratis OpenRouter-model køres med `npm run test:openrouter`. Den beder om en testnøgle i terminalen uden ekko og sender kun syntetiske projektdata samt offentlige regler. Den bruger som standard `cohere/north-mini-code:free`, kontrollerer model- og rutepriser og bruger én konkret gratis rute uden fallback. For OpenRouters `:free`-varianter sætter gatewayen også nul som maksimal input-, output-, request- og billedpris. Nøglen må ikke angives som argument, i kildekoden eller i chatlogs. Testen er ikke en del af standardtestsuiten.

## Aktuel afprøvning

Se [teststatus før invitation](../docs/teststatus.md) for de aktuelle resultater, installationsfiler og manglende kontroller. Den skelner mellem kontrollerede modelservere, rigtige modeller, lokale pakker og CI. De daterede afsnit nedenfor beskriver tidligere afprøvninger og erstatter ikke den aktuelle status.

React/TypeScript med Vite og Astro er desuden afprøvet med rigtig installation, opstart, klik, mobilvisning og opdatering efter filændringer. Prøven omfatter en ændret godkendelse, en fremkaldt Astro-fejl, rettelse, basissti, stop, projektskift og genåbning uden autostart. Forløbet bestod i kildekoden og i den foregående lokale pakke med begrænset PATH. Frameworkprojekterne var syntetisk testmateriale, ikke resultatet af en ekstern model.

## Verifikationsstatus · 24. september 2026

- **Skrevet og automatisk testet:** mapper uden manifest, designbibliotek, krypteringsfejl, projektspecifikke skills, stop under motoropstart, serveradresser, ukendte vilkår og låst routing. 25 tests består. Git-testene bruger rigtige midlertidige repositories og kontrollerer aktivt filvalg, sletning, forældet gennemgang, hemmeligheder, eksisterende stage, afvisende hooks samt checkpoint-afvisning ved stop, værktøjsfejl, kommandoer og samtidige ændringer.
- **Afprøvet på konkret materiale:** macOS/Electron 44.4.4, genåbning, rigtigt preview og designpakke genbrugt efter genstart og sletning af originaler. OpenCode 1.17.15 gennemførte en rigtig filændring med kontrolleret modelserver, godkendelse, afvisning og stop. Den samlede desktop-chatrejse består også: modelvalg, datagennemgang, streaming, godkendt filændring, preview, ændringsoversigt og skill-redigering. Genåbning bevarer modelvalg, og tilslutning til en eksisterende udviklingsserver er afprøvet. OpenCodes webværktøj hentede Gentofte-guidens forside og en relevant underside gennem godkendelser med en kontrolleret testmodel. Electron safeStorage blev afprøvet med en syntetisk nøgle; hverken rendererens forbindelsesdata eller indstillingsfilen indeholdt nøglen i klartekst.
- **Git-milepæl afprøvet i Electron på macOS:** UI-oprettelse af Git-historik, manuelt første commit, tilvalg af checkpoints og automatisk andet commit efter en rigtig OpenCode-filændring med en kontrolleret lokal modelserver. Git-historikken indeholdt det ændrede indhold, arbejdsområdet var rent, og preview viste resultatet. Nøglekryptering og genlæsning bestod med normal macOS-hjemmemappe. En tidligere test med midlertidig HOME udløste en nøgleringsdialog; testopsætningen isolerer nu Git via et testværktøj på PATH og ændrer ikke Electrons HOME. Ingen nulstilling af nøgleringen er en del af testen.
- **Opstartsskærm afprøvet i Electron på macOS:** første start uden modelkald, lokal adgang, tilføjelse af forbindelse, tomt katalog, utilgængelig server, genoprettelse, bevarede kladder, manglende Git og ny kontrol efter genstart. En rigtig OpenCode-session mod den kontrollerede testserver fik afvist modeladgang; opsætningen kom frem, beskeden blev bevaret, og intet automatisk checkpoint blev oprettet.
- **GitHub/publicering afprøvet:** 25 automatiske tests består. Electron gennemfører Device Flow mod et kontrolleret GitHub-API, ejer-/organisationsvalg, eksplicit privat oprettelse, remote-tilslutning, gennemgang og almindeligt push til en rigtig lokal Git-server. Serverindhold og efterfølgende synkroniseringsstatus kontrolleres. Forløbet blev også gennemført med netop HTML-filen fra den rigtige OpenRouter-prøve. API-token er ikke tilgængeligt i rendererens offentlige tilstand eller i klartekst i indstillingsfilen. Rigtigt GitHub-login og push til github.com er endnu ikke afprøvet; det kræver den faktiske appregistrering eller en brugerforbundet konto.
- **Ekstern OpenRouter-prøve:** `cohere/north-mini-code:free` via ruten `cohere` gennemførte en rigtig filændring gennem OpenCode 1.17.15, med godkendelse og preview i Electron. Både katalog- og rutepris var nul; gatewayen fastholdt udbyderen, deaktiverede fallback og satte maksimal pris til nul. Testen brugte kun syntetiske projektfiler og offentlige regler. To tidligere forsøg blev afvist af testens eget stifilter; tredje forsøg bestod efter præcisering af den ene tilladte fil.
- **Tidligere Zen-prøve:** Zen-kataloget svarede, men modelkaldet uden nøgle blev afvist med HTTP 403. Denne Zen-forbindelse gav ikke en vellykket kodeændring. Ingen anden model eller betalingsvej blev forsøgt som fallback.
- **Ikke verificeret:** Windows, øvrige providerkonti, Ollama, DGX Spark/Tailscale, en rigtig AI-models selvstændige fortolkning af designguiden samt cloud-arbejdsområder. Ingen installationer er pakket, deployet eller observeret i drift.

Kilder: [GitHub Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow), [GitHub repository-API](https://docs.github.com/en/rest/repos/repos), [OpenRouter prisgrænser](https://openrouter.ai/docs/guides/routing/provider-selection#max-price), [OpenCode server](https://opencode.ai/docs/server/), [Zen-vilkår](https://opencode.ai/docs/en/zen/#privacy), [OpenRouter og databehandling](https://openrouter.ai/docs/guides/privacy/provider-logging), [Anthropic og træning](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). Datavisningen er leverandøroplysninger og eksplicitte ukendte forhold, ikke en juridisk eller teknisk sikkerhedsgodkendelse.

## Afprøvning af enkel opstart

Den forenklede brugerrejse afprøves med `test:setup`, `test:desktop`, `test:chat` og `test:hosting`. Testene kontrollerer foldede standardvalg, lokal adgang uden konto, bevarede kladder ved forbindelsesfejl, eksplicit modelvalg, designpakker, preview og uændrede godkendelser. GitHub-kald i publiceringstesten er simulerede; Git og filerne er virkelige, isolerede testmaterialer. Denne milepæl kræver ingen nye eksterne modelkald og ændrer ikke deployment eller installationspakker.

I arbejdsområdet kan brugeren folde **Ønsker til løsningen** ud og vælge platform, datadeling og eventuelle tekniske ønsker. Standardvalget overlader anbefalingen til AI’en. **Forbered første besked** lægger idéen i en redigerbar kladde og ønskerne i projektbriefen under Plan uden at sende noget eller overskrive en eksisterende kladde. Er planlægning slået fra, står ønskerne i kladden som før. Ønskerne nulstilles, når et projekt åbnes, og bliver først en del af afklaringen, når beskeden sendes. De er ikke installations- eller deploymentgodkendelser.

**Ret forslaget** fører tilbage til planlægning og bevarer eventuel tekst i skrivefeltet. Ved afsluttet planlægning bruges kun det sidste agentsvar som forslag. Tekst fra tidligere værktøjstrin bevares i den viste datakontekst, men bliver ikke samlet sammen som selve planen. Samtalen viser et kort med planens første linje, **Se planen**, **Ret forslaget** og **Byg første udkast**; selve planen står under Plan. Appen vurderer ikke automatisk, om alle spørgsmål er afklaret. Streaming af modeldele markeret som `reasoning` vises ikke som almindelige svar. Aktivitetsfeltet viser arbejdet, spørgsmål og ventende godkendelser. `test:chat` er afprøvet i Electron på macOS med en kontrolleret lokal modelserver, rigtig OpenCode, filændring og preview. Testen kontrollerer også, at de valgte ønsker når modelkaldet, at kladder bevares, og at valgene ikke overføres til en anden mappe. De opdaterede sproginstruktioner er ikke genafprøvet med en ekstern model; Windows og nye installationspakker er heller ikke kontrolleret i denne omgang.


## Valg, der kan huskes eller springes over

Projektskærmen viser idé, projektnavn og **Opret og fortsæt**. Er idéfeltet tomt, står linket **Mangler du en idé? Se tre eksempler** under det. De tre faste eksempler kan bygges som en lokal side uden server; et klik udfylder idé og projektnavn, og AI'en bygger først, når projektet startes. **Flere valg** er en flad liste med AI-forbindelse, udgivelsesønske, tests og designpakke. Linket opsummerer de valg, der er truffet. De seneste valg huskes automatisk ved en faktisk projektoprettelse; en annulleret mappedialog gemmer intet. **Glem dem** fjerner de huskede valg uden at ændre skærmen eller eksisterende projekter.

Standarderne ligger i appdata. Nye projekter får deres egen kopi i projektindstillingerne uden for repositoryet. Et eksisterende projekts modelvalg har forrang. Manglende forbindelser og designpakker giver en forklaring og vælges ikke automatisk på ny. En husket AI-forbindelse kontakter ikke serveren; brug **Hent modeller** før modelvalg. Designpakken kopieres lokalt som hidtil; private referencer er stadig ikke valgt til modellen.

Hostingønsket vises i projektoplysninger og medsendes som kontekst efter datagennemgangen. Det opretter ingen cloudressource og er ikke en godkendelse af upload, omkostninger eller publicering. Startskabelonen er stadig statisk HTML/CSS/JavaScript. Hostingønsket foreslår nu udbyder i udgivelsesdialogen. Organisationers centrale standarder er endnu ikke tilsluttet. Der loves derfor ikke automatisk tilpasning af projekttypen til destinationen.

`npm run test:preferences` afprøver gemning, genstart, spring-over og glem i Electron med isolerede projekter. `tests/preferences.test.cjs` kontrollerer validering, manglende henvisninger og at nye standarder ikke ændrer eksisterende projekter eller gemmer godkendelser/nøgler.

## Udgiv til test

**Udgiv** er valgfri. Guiden viser udbydere alfabetisk uden anbefaling eller forvalg: Azure Static Web Apps, Cloudflare Pages, GitHub Pages, komplai Run, Promte Apps og Vercel. Derudover findes en vejledning til Netlify Drop. GitHub-forbindelse kræves til Pages; Vercel bruger sit projekts Git-integration. Azure, komplai og Promte har deres egne loginforløb.

Opsætningen gemmes efter særskilt gennemgang i `.aura/publishing/<udbyder>.json`. Pages får desuden et manuelt workflow i `.github/workflows/`. Eksisterende indhold vises før skrivning og kontrolleres igen; ændringer, links og usikre filstier afvises. Tokens og nøgler medtages ikke. Brugeren håndterer selv commit og push. Appen opretter eller ændrer ikke Git-historik som en del af opsætningen. Den lokale destination og seneste kvittering huskes desuden i appdata.

Manuelle udgivelser læses fra den gemte Git-version i den valgte mappe, som bliver uploadens rod. Arbejdsområdet skal være rent. Ignorerede buildfiler på disken medtages ikke: ved færdigbygget frontend skal det faktiske output være gemt i Git. Promte modtager kildekode og bygger selv; Vercel bygger det, der kommer gennem Git-forbindelsen. Auras manuelle filkontrol har grænser på 2.000 filer, 2 MB pr. fil og 20 MB samlet. Kendte hemmelighedsfiler, private referencer, links, undermoduler og LFS-pointere afvises før udbyderens filudvalg. Indholdskontrollen er heuristisk.

Gennemgangen viser destination, den gemte version, adgang og mulige omkostninger. Under **Se detaljer** findes versionens ID, filer, eventuelle udeladte filer, fingeraftryk, placering, miljøvariabelnavne og build. **Ret** vender tilbage til opsætningen og kræver en ny gennemgang. Version og destination genkontrolleres før upload eller manuel workflowstart. Godkendelsen er engangsbrug og udløber. En gemt opsætning er ikke godkendelse af næste udgivelse.

Udgivelsen bruger altid hovedprojektets gemte version. Dialogen viser, når der findes uflettede samtalekopier: deres rettelser kommer ikke med, før brugeren vælger **Flet ind i projektet** og gemmer resultatet. Aktive opgaver blokerer udgivelse. Ingen kopi flettes eller udgives automatisk.

GitHubs særskilte sikkerhedskopiering viser versionsnavn, destination, synlighed og tidspunkt for serverkontrollen. Et bekræftet push viser, at kode og historik findes på serveren; det er ikke i sig selv bevis for en fungerende app. Hvis repositoryet er forbundet til Vercel eller anden automatisk hosting, kan push udløse udgivelse efter den opsætning. “Privat” fra repository-API'et beviser ikke en bestemt testpersons adgang til appen.

### Vejledninger og dataplacering

**Udgiv** starter med **Udgiv fra Aura** og **Se udgivelsesvejledning**. De seks integrerede udbydere vises som ligeværdige valg; Netlify Drop ligger blandt vejledningerne. En tidligere valgt destination kan genbruges. Kontooprettelse, installation af manglende værktøjer og oprettelse af cloudressourcer foregår hos udbyderen. Åbning af en vejledning udgiver intet.

Hvert valg har en kort beskrivelse af leverandør og dataplacering. **Opsætning, data og aftaler** viser trin, anvendelsesområde, adgangsforhold, kilder og kontroldato. En leverandørs hjemland, en API-region, global levering og databehandleraftalen beskrives særskilt. Aura kender ikke automatisk organisationens aftale eller godkendelse. Katalog og faste links ligger i `core/hosting-guidance.cjs`; samme fil beskriver appens reelle muligheder for agenten, så den kan henvise til Udgiv uden at gætte.

Cloudflare Pages, Netlify Drop og GitHub Pages er her til færdige frontendfiler. En almindelig Python- eller Node-server kræver en anden driftsopsætning. Komplais Run-API modtager færdig HTML/ZIP med særskilt appadgang. Promte modtager en React-kildepakke efter sine byggeregler. Promte Apps kræver konto og betalt aftale. komplai Run kræver en komplai-konto.

### Cloudflare Pages og GitHub Pages

Forbind GitHub via browserlogin, hvis en OAuth-app er konfigureret, eller genbrug efter eget valg et eksisterende `gh`-login. Et token kan også forbindes i appens GitHub-opsætning. Vælg repository, branch og en mappe med den færdige frontend. Aura skriver kun konfigurationen lokalt efter gennemgang; brugeren committer og pusher selv. Workflowet skal findes på standardbranchen, og den valgte branches version og workflowindhold skal matche den gennemgåede lokale version.

GitHub Pages skal være sat til **GitHub Actions** under **Settings → Pages**. Workflowet har begrænsede jobrettigheder, fastlåste Actions og kun `workflow_dispatch`. **Udgiv** starter én kørsel med præcis Git-version, filfingeraftryk og forespørgsels-ID. Kørslen genkontrollerer version, filstier, hemmelighedsmønstre og alle bytes før upload; ingen projektkode eller buildkommando køres. Skjulte webfiler som `.well-known/security.txt` bevares. Basisstien kan være `/repository-navn/`; billeder og navigation skal afprøves på den faktiske adresse.

Cloudflare bruger samme manuelle GitHub-forløb med et eksisterende Pages-projekt, konto-ID og projektnavn. Brugeren gemmer `CLOUDFLARE_API_TOKEN` i repositoryets **Actions secrets** med adgang til Cloudflare Pages for den valgte konto. Aura kontrollerer kun hemmelighedens navn, aldrig dens værdi. Konto, projekt, produktionsbranch og fravær af serverfunktioner kontrolleres af workflowet før upload. Et Git-forbundet Cloudflare-projekt skal have automatiske produktions- og previewudgivelser slået fra. Opsætningen opretter hverken projekt, token eller hemmelighed.

GitHub-tokenet skal kunne læse repository og workflow og starte Actions. GitHub Pages kræver også læseadgang til Pages; Cloudflare-forløbet læser navnet i Actions secrets og GitHub-deploymentstatus. Organisationens regler kan kræve yderligere godkendelse. Workflowet har ingen automatisk start ved push eller tidsplan. Begge Pages-forløb opdaterer den valgte hjemmeside; en privat GitHub-kodemappe gør ikke automatisk siden privat.

### komplai Run

Log ind i Komplais egen browserformular, og forbind organisationens udgivelsesadgang. Har kontoen én organisation, vises den direkte; flere organisationer får et særskilt valg. Login bruges kun til udgivelse, og adgangen lagres krypteret. En genstart bevarer forbindelsen. **Konto og adgang → Log ud af komplai Run** tilbagekalder den på serveren, før den fjernes lokalt.

Vælg **Ny app** eller **Eksisterende app**. Nye apps får navn, adresse og et udtrykkeligt valg mellem **Organisationen** og **Alle med linket**, uden forvalg. **Alle med linket** bekræftes ved at skrive appens navn. komplai opretter altid en ny app for organisationen; Aura gør den derefter offentlig med bekræftelsen, før første version uploades. Eksisterende apps beholder deres adgang; ændringer foretages i Komplai. Navn, adgang og filer kan rettes inden den endelige gennemgang. **Udgiv en ny version** genbruger den seneste app, mens **Skift app** åbner appvalget direkte.

**Apps med et byggetrin.** Run modtager kun færdige filer, og komplai bygger intet. Udgiv bruger en gemt byggemappe (`dist`, `build` eller `out` med `index.html`). Har projektet et `build`-script i `package.json` og ingen gemt byggemappe, tilbyder Udgiv **Byg og gennemgå**: Aura kopierer den gemte version til en midlertidig mappe, kører `npm ci` (eller `npm install` uden låsefil) uden pakkernes installationsscripts og `npm run build` med den Node og npm, der følger med Aura, og viser de byggede filer i gennemgangen. Kildekort udelades. Intet installeres globalt, projektmappen røres ikke, og der kræves ingen administratorrettigheder; kun projektets npm-pakker hentes. **Vælg en mappe i stedet** udgiver færdige filer som hidtil. Et projekt med en gemt opsætning beholder sin mappe.

**Forhåndsvisning med komplais app-SDK.** Når **komplai Run** er slået til under **Indstillinger → Funktioner → Integrationer**, serverer forhåndsvisningen `/_komplai/run/v1.js` med komplais officielle SDK, hentet fra Hub, og en bro foran. SDK'ets kald går gennem Aura til Hubs forhåndsvisning af din egen app: rigtig identitet, AI som din egen Chat og Redact, mens gemte data holdes adskilt fra appens rigtige data. Uden login tilbyder forhåndsvisningen login under Udgiv; uden app tilbyder den at oprette appen for organisationen. Projektets `komplai.json` gælder kun forhåndsvisningen; efter udgivelse godkender en administrator brugene i Run.

Den faktiske prøve 18. oktober 2026 gennemførte browserlogin, forbindelse, genstart og offentlige/private HTML-udgivelser fra en gemt syntetisk Git-version. Den offentlige fil matchede byte for byte. Den private app afviste anonyme besøg og viste indholdet efter medlemslogin. ZIP-forløbet er separat afprøvet mod Run-arkivlæseren lokalt. Se [teststatus](../docs/teststatus.md) for præcist omfang og begrænsninger.

### Promte Apps

Kræver konto, betalt aftale, administratoradgang til app-arbejdsområdet og Promtes officielle `@promte/app-upload`-værktøj. Aura starter værktøjets browserlogin for den valgte Promte-installation. Appen læser kun værktøjets login for den præcise vært; tokens sendes ikke til brugerfladen eller projektfiler. Arbejdsområdets ID angives fra Promte, fordi CLI-kontrakten ikke stiller en dokumenteret liste til rådighed.

Efter den fælles Git- og hemmelighedskontrol anvendes Promtes filudvalg. Lokale værktøjer, byggeoutput og `vite.config.*` udelades; en lockfil udelades også, når der kun findes udviklingsafhængigheder. Gennemgangen viser de faktiske uploadfiler, udeladelser og et nyt fingeraftryk. Det samme valg og fingeraftryk genberegnes før upload. Projektets egne filer ændres ikke.

Kildepakken følger Promte-skillens byggeregler og sendes til den valgte installation eller den dokumenterede fælles uploadtjeneste på `app.promte.dk`. Versionsnummeret gemmes før upload, modtagelse gemmes før afslutning, og status følger præcis denne version. Bygning, gennemgang og afvisning vises særskilt. `published` er Promtes egen status; Aura gætter ikke en appadresse, som API-kontrakten ikke lover. Se [Promte-udgivelsesvejledningen](../docs/promte-udgivelse.md) for filkrav, modtagere og afprøvning.

### Vercel via Git

Det nye forløb bruger Vercels eksisterende GitHub-integration. Installér Vercel CLI, og vælg browserlogin i Aura. Vælg team og et Git-forbundet projekt fra listerne. Hvis forbindelsen mangler, åbnes Vercels importforløb; Aura opretter eller ændrer ikke Vercel-projektet. Repositoryforbindelsen kontrolleres igen, før valget gemmes.

Aura gemmer forbindelsen som ikke-hemmelig projektkonfiguration. Brugeren committer og pusher med sit Git-værktøj. Vercel bygger derefter efter projektets Git-regler. Push til produktionsbranchen kan opdatere produktion; øvrige grene kan få previews. Aura kører ingen manuel Vercel-upload eller promovering i dette forløb og ændrer ikke fjernopsætningen. Et andet CLI-program kan angives med `HARNESS_VERCEL_PATH`.

Status læses fra Vercel og knyttes til projekt, repository, branch, Git-version og udgivelsens kilde. En manuel upload med lignende Git-metadata tæller ikke som en Git-udgivelse. Buildindstillinger, miljøvariabler, region og adgang administreres i Vercel. Projektets buildkode kan læse de miljøværdier, der er tilgængelige dér. En klar udgivelse er ikke dokumentation for afprøvede brugerrejser.

### Azure Static Web Apps

Kræver Azure CLI, SWA CLI og en eksisterende Static Web App i Azure Public Cloud. Guiden kontrollerer de lokale værktøjer, åbner Microsoft-login gennem Azure CLI og viser de tilgængelige abonnementer og apps. Ressourcegruppe og navn kommer fra den valgte app. Hvis en ressource eller et værktøj mangler, åbnes den relevante vejledning eller Azure-portalen; Aura opretter intet automatisk.

Opsætningen kan gennemgås og gemmes i projektet før versionsgemning og udgivelse. Programstier kan angives med `HARNESS_AZ_PATH` og `HARNESS_SWA_PATH`. SWA CLI kan hente sit deploymentværktøj ved første brug. Projektets afhængigheder installeres ikke, og der startes ingen projektkommandoer lokalt.

Adapteren bruger det navngivne **harness-test**-miljø; næste upload erstatter dets indhold. Produktion er ikke destination. Azure-kontoen skal have rettighed til at læse ressourcen og hente deploymentnøglen. Nøglen gives kortvarigt til SWA-processens miljø, aldrig argumenter, renderer, projektfiler eller appens kvittering. CLI'ernes eksisterende kontologin administreres af deres egne værktøjer.

Færdigbygget frontend skal have `index.html`. Frontend med Functions kræver adskilte mapper, fx `public` og `api`, med `host.json` og færdigt selvstændigt Node.js 22-API. `node_modules` medtages ikke; afhængigheder skal være bundlet. Appen bygger ikke Functions. Langvarige serverprocesser, Docker, databaser og automatisk ressourceoprettelse er ikke en del af adapteren. Hemmeligheder og adgangsregler opsættes særskilt i Azure-testmiljøet.

### Status og kontrol

**Kontrollér status og startside** følger den registrerede manuelle udgivelse. Resultatet viser separat udbyderens status, startsidens svar uden login, filmatch og testpersonens endnu ikke afprøvede adgang. Tidspunktet gælder den seneste kontrol, også når den mislykkes; gammel succes bliver ikke vist som aktuel evidens. Kvitteringen med version og destination bevares ved genåbning. Et forsinket statuscheck kan ikke overskrive en nyere udgivelse eller kontrol. Formularændringer ændrer ikke den tidligere kvittering.

Pages-status kræver samme forespørgsels-ID, workflow og Git-version samt et fuldført uploadtrin. Cloudflare-adressen hentes fra samme kørsels deploymentstatus; den udledes ikke af projektnavnet. GitHub Pages kan have et eget domæne. Automatisk indholdskontrol af Pages afviser private eller reserverede DNS-adresser, fastholder den kontrollerede IP under HTTPS-forbindelsen og følger ingen redirects. Øvrige uploadadaptere kontrollerer kendte HTTPS-adresser hos udbyderen. Ingen loginoplysninger sendes med sidekontrollen.

Ved statiske sider sammenlignes startsideindholdet med den godkendte fil. Udbyderindsatte scripts kan give forskelligt fingeraftryk; appen beder da om manuel gennemgang frem for at erklære fuld overensstemmelse. Promte og Vercel har deres særskilte statusforløb ovenfor. Backend, login og brugerrejser kræver yderligere afprøvning. En loginbeskyttet side bliver ikke meldt som verificeret.

Azure-status skal have et opdateringstidspunkt efter uploadstart, før en gammel testversion kan tælle som klar. Dette er ikke en lås mod andre, der samtidig udgiver til samme miljø. Uploadfejl kan have ukendt udfald: kontrollér udbyderens oversigt før nyt forsøg. Appen gentager ikke automatisk. Lukning af dialogen annullerer ikke en allerede igangsat cloududgivelse.

### Verifikation og kilder

Se [teststatus](../docs/teststatus.md) for den aktuelle samlede suite og appens visuelle afprøvning. De nye Pages- og Promte-adaptere er skrevet og enhedstestet med kontrollerede API-svar. Pages-workflowets faktiske filkontrol er også kørt på HTML og CSS fra Auras eksisterende gemte hjemmeside. Integrationstestene bruger de rigtige providermoduler til gennemgang, uploadudvalg, afbrudt dispatch, status og DNS-beskyttet sidekontrol, men netværk og cloudkørsler er simuleret. De opretter ingen commits eller eksterne udgivelser. Rigtigt login og udgivelse til Pages, Promte, Azure og det nye Vercel-Git-forløb er ikke dermed verificeret.

**Historisk Vercel-prøve, 24. september 2026:** Det daværende manuelle uploadforløb blev afprøvet gennem Electron med en syntetisk HTML-side i `progressify/ai-harness-test`; Vercel bekræftede `target: null` og `READY`. Den anonyme kontrol registrerede viderestilling til login. En særskilt autentificeret CLI-kontrol hentede den godkendte HTML-side; Vercel havde tilføjet sit feedback-script, så hele HTTP-svaret var ikke byteidentisk. De to syntetiske udgivelser, som Vercel klassificerede som produktion under fejlsøgningen, blev fjernet. Kontrollen før upload afviste derefter korrekt manglende startversion. Kun preview-testudgivelsen blev efterladt. Denne prøve dokumenterer ikke det nye Git-forløb.

Azure er ikke liveafprøvet; der er endnu ingen testressource. Windows og framework-/Functions-apps er ikke afprøvet live i denne milepæl. Browserlogin og ressourcevalg er nu en del af guiden, mens installation af værktøjer og oprettelse af manglende ressourcer fortsat sker uden for Aura.

Integrationskilder kontrolleret 20. oktober 2026: [GitHub Pages-workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [Cloudflare Pages fra CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github), [Azure browserlogin](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively), [SWA deploy](https://azure.github.io/static-web-apps-cli/docs/cli/swa-deploy/) og [Promtes officielle uploadværktøj](https://www.npmjs.com/package/@promte/app-upload). Daterede historiske prøver erstatter ikke en kontrol af den aktuelle konto og opsætning.

## Flere hostingmuligheder

Netlify Drop har en vejledning i Udgiv, men ingen uploadadapter. Andre mulige destinationer er ikke aktive integrationer i appen:

- [Cloudflare Workers](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/): kræver en kompatibel runtime; den eksisterende Pages-adapter udgiver kun frontend.
- [Netlify](https://cli.netlify.com/commands/deploy/): CLI'en opretter som standard draft-deploys. Funktioner og build skal håndteres efter Netlifys format.
- [Render](https://render.com/docs/preview-environments): preview-miljøer til flere tjenester og datalagre.
- [Railway](https://docs.railway.com/environments): særskilte vedvarende miljøer og PR-miljøer.
- Egen server, fx kommunal infrastruktur eller Hetzner: kræver en adapter til den valgte runtime, adgang og testadresse.

Valgmulighederne er ikke et løfte om gratis drift eller godkendt databehandling. Pris, region, logging, opbevaring, hemmeligheder og adgang skal vurderes pr. konto og tjeneste. Kilder kontrolleret 24. september 2026.

## Introduktion og bevægelse · 25. september 2026

Introduktionen er valgfri. Spring over og Escape gemmer kun et lokalt navigationsvalg; de giver ingen værktøjstilladelser, accepterer ingen datavilkår og tilslutter ingen konto. Tilbage-navigation og Vis introduktion gør det muligt at vende tilbage. Et annulleret mappevalg efterlader kladden.

Den lokale demonstration viser en aktivitetsoversigt med faste svar og skift mellem kort og liste. Den er tydeligt markeret som demonstration, bruger ingen model og opretter intet projekt. Eksemplet vises i en sandboxet iframe uden scriptrettigheder. Appens indholdspolitik er bevaret.

Idé og projektnavn gemmes automatisk i rendererens lokale lager, uden kryptering. Nøgler og private referencefiler gemmes ikke dér. Kladden genlæses ved genstart og ryddes efter vellykket projektoprettelse. Manuelt rettede navne bliver ikke overskrevet af navneforslaget.

Tilslut AI viser en vejledning til egen API-adgang. Udbyderknappen åbner kun faste adresser for Anthropic, OpenRouter og OpenCode Zen gennem main-processen. Egen server og Ollama viser deres adresseopsætning i stedet. Ingen nøgle eller projektdetalje sendes til hjemmesiden af appen. En ny gemt forbindelse vælges lokalt i opsætningen, men kontakter først udbyderen ved brugerens kontrol. Katalogkontrol er stadig ikke en afprøvet kodeopgave; den første rigtige AI-opgave kræver modelvalg og datagennemgang.

Datagennemgangen viser model, modtagere, behandlingssted, pris, opbevaring og træning før afsendelse. Yderligere oplysninger og regler kan foldes ud. Ingen standardmodel eller betalingsrute vælges automatisk.

Navigation og status bruger samme typografi og rolige overgange mellem trin. Operativsystemets reduceret-bevægelse-indstilling slår animationer og overgange fra. Fokus flyttes til det nye trin; interaktive kontroller beholder synligt tastaturfokus.

**Verifikation:** `npm run test:introduction` afprøver velkomst, demonstration, reduceret bevægelse, spring over, genindlæsning, navneforslag, kladde, tilbage-navigation, annulleret mappevalg og oprettelse af et virkeligt projekt med preview i Electron. De øvrige UI-tests bruger den rigtige Spring over-knap ved start. Ingen fælles organisationslogin, browserlogin til modeludbydere, automatisk værktøjsinstallation eller signeret installationspakke er implementeret i denne milepæl. Forløbet er endnu ikke brugertestet med kommunale medarbejdere, og Windows er ikke afprøvet.

Udbydervejledningen bygger på [Anthropics adgangsvejledning](https://platform.claude.com/docs/en/manage-claude/authentication), [OpenRouters introduktion](https://openrouter.ai/docs/quickstart) og [OpenCodes udbydervejledning](https://opencode.ai/docs/providers), kontrolleret 25. september 2026.

## Fra idé til første udkast · 25. september 2026

Modelknappen i skrivefeltet tilbyder højst tre modelkort fra den valgte forbindelses aktuelle katalog. For Claude, Mistral, Corti, Alexandra, OpenRouter og OpenCode Zen viser kortene først udbyderens eget udgangspunkt og op til to alternativer med faktuelle forklaringer. Aura anbefaler ingen model. For andre forbindelser vises modeller med oplyste værktøjskald først og derefter alfabetisk, uden anbefaling. Modeller med udtrykkeligt manglende værktøjsstøtte vises kun i det fulde katalog. Anbefalingerne ligger i `ui/model-advice.js`. **Alle modeller · avanceret** har søgning og fuld valgliste. Ingen model, betalingsrute eller reserveudbyder vælges automatisk. Input-/outputpris vises som oplyst af kataloget; andre gebyrer, kvoter og ukendte vilkår afklares fortsat i datagennemgangen. Katalogdata beviser ikke, at en model kan gennemføre kodeopgaver.

Nye og eksisterende projekter starter i **Afklar og planlæg**, medmindre en gemt samtale har en anden arbejdsmåde. Efter en afsluttet byggeopgave kan næste besked rette resultatet i samme modelsession. Arbejdsmåden kan også ændres under modelknappens avancerede indstillinger. Planlægning tillader læsning under de eksisterende filbegrænsninger, spørgsmål og godkendte webopslag; skriveværktøjer, shell og øvrige ukendte værktøjer er afvist af motorens tilladelser. Det er ikke alene en promptinstruktion. Der oprettes ingen automatiske checkpoints for planlægningsopgaver. Det er fortsat ikke en OS-sandbox mod andre processer.

AI’en bliver bedt om kun at stille nødvendige spørgsmål og foreslå en kort plan med konkrete ting, brugeren skal prøve. Spørgsmål kan besvares i samtalen eller med de klikbare svar, når AI'en bruger spørgeværktøjet. Seneste afsluttede forslag vises med **Byg første udkast**. Appen vurderer ikke automatisk, om forslaget er tilstrækkeligt eller alle spørgsmål er afklaret; brugeren gennemgår det. En ny planlægningsbesked ugyldiggør den tidligere plan. Bygning kræver den aktuelle plans ID og ny datagennemgang. Kommandoer og filændringer kræver stadig deres egne godkendelser.

Plan og afklaringsbeskeder medsendes ved overgangen til en ny byggesession og vises under Data og vilkår. Almindelige opfølgende afklaringer kræver ikke gentaget samtykke, når model, regler, referencer og vilkår er uændrede. Plan og afklaringsbeskeder gemmes lokalt og genåbnes med projektet. En afbrudt opgave genstartes ikke, og dens plan kan ikke bruges til bygning. Skift af model eller forbindelse kan sende den viste afklaring til den nye modtager efter datagennemgang.

Godkendelseskort siger **Hvad** (filen med antal tilføjede og fjernede linjer, kommandoen med mappe, eller hjemmesidens domæne), **Hvorfor** (AI'ens egen begrundelse, markeret som AI'ens) og **Hvis du tillader** (konsekvensen). En filændring kan ses under **Se ændringen**, og rå værktøjsdata ligger under **Tekniske detaljer**. For kommandoer gætter Aura i almindeligt dansk, hvad de gør, fx "Installerer pakker fra internettet"; kortet siger, at det er et gæt ud fra teksten, ikke en kontrol, og en kommando har ingen fremhævet Tillad-knap. **Afvis** stopper opgaven, som OpenCode gør ved en afvisning. **Afvis med en besked** sender beskeden til AI'en som rettelse, og opgaven fortsætter. Mens AI'en venter, siger statuslinjen under samtalens overskrift "Venter på dig: …" med **Vis**, der fører til kortet. Ét sted viser status: overskriften siger kort Arbejder, Venter på dig, Klar, Stoppet eller Fejl, og linjen under siger, hvad der sker.

Afslutningen viser ændrede tekstfiler registreret i den enkelte opgave og **Kontroller** med faktiske resultater: Aura genindlæser forhåndsvisningen og siger, om siden blev vist, og om den skrev fejl i konsollen, med fejlene under **Se fejlene**; hver kommando står med sin afslutningskode og de sidste linjer af output. Aura klikker ikke i siden og afprøver ingen funktioner, så kontrollen er ikke et bevis for, at appen virker. Efter Stop siger kortet, hvad AI'en nåede, med **Fortryd det, den nåede**, når det er gemt som en version, og **Send igen**. Efter en afvisning siger kortet, hvad der blev afvist, med **Skriv, hvad AI'en skal gøre i stedet**. En afsluttet kommando er ikke automatisk en bestået test. AI’en bliver desuden bedt om at beskrive ændringer, faktisk udførte kontroller og manuelle prøvetrin. Appen markerer eksplicit, når ingen kommandoer er kørt, og tilbyder ændringsgennemgang og den eksisterende **Gem version**-dialog. Oversigten kan omfatte samtidige manuelle ændringer og udelader store/private/binære filer efter de eksisterende grænser. Den samlede Ændringer-dialog dækker stadig fra første besked i arbejdsområdet.

**Verifikation:** 41 automatiske tests består. Den rigtige OpenCode-motor er kørt mod en kontrolleret lokal modelserver: et bevidst skriveforsøg under planlægning blev afvist uden filændring; en forældet plan blev afvist; den godkendte plan fulgte med til en rigtig filændring og preview. Electron-forløbet omfatter modelkort, opfølgende afklaring, eksplicit bygning, datagennemgang, godkendelse, ændringsoversigt og Git-version i et isoleret testrepository. Projekt-/preview- og forbindelsestestene består også på macOS. Ingen ny ekstern modelafprøvning, Windows-kørsel, brugertest med kommunale medarbejdere eller cloududgivelse er udført i denne milepæl.

## Installationspakker · beta

### Udgivelser

[Downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) viser den seneste offentliggjorte desktopbeta og dens udgivelsesnoter. `0.5.0-beta.3` er offentliggjort og kan hentes uden login. Begge Mac-pakker er signerede og notariserede; Windows-pakken er usigneret og indholdskontrolleret. En lokal kandidat vises først efter offentliggørelse i GitHub Releases og den særskilte Pages-kørsel. [Noterne til 0.5.0-beta.3](../docs/releases/0.5.0-beta.3.md) og [teststatus](../docs/teststatus.md) beskriver den faktiske afprøvning, herunder de platformsprøver, der mangler. [Udgivelsesvejledningen](../docs/udgivelse.md) beskriver pakning, kildekontrol og de manuelle udgivelsestrin. Terminalpakken har sit eget versionsnummer og udgivelsesforløb.

### Demogennemgang · 7. oktober 2026

Kandidaten ved denne gennemgang var `0.2.0-beta.5`. [Demogennemgangen](../docs/demogennemgang.md) beskriver UI/UX, datagrænser og det, der stadig kræves før udsendelse. [Demo til testere](../docs/demo-til-testere.md) er det korte testmateriale; [teststatus](../docs/teststatus.md) skelner mellem lokal kode, pakket app, rigtig model og publiceret installation. Beta.5 retter indlæsning af skills med Windows-linjeskift. Repositoryets `.gitattributes` bevarer desuden ens tekstfiler ved checkout, så de genererede instruktionspakker kan kontrolleres byte for byte på begge platforme.

`npm run test:demo` prøver første start uden AI, kladde, forbindelsesguide, navngivne kontroller, fokus, tastatur, 980 × 720, 150 % zoom, reduceret bevægelse og genåbning. Det kan også køres med `HARNESS_TEST_PACKAGE` sat til den konkrete `.app` eller `.exe`. `measure:screens` registrerer en afgrænset DOM-kontrol og tager billeder direkte fra Electron-vinduet. Det erstatter ikke en skærmlæserprøve eller brugerobservation.

`npm run test:demo-web -- RELEASE-JSON REPOSITORY-JSON` bygger og afprøver den samlede side lokalt fra eksplicitte GitHub-metadata; se [website](../docs/website.md) for læsning af metadata. `node scripts/verify-download.cjs PAKKEMAPPE` henter alle installationsfiler gennem en lokal browser og kontrollerer filnavne, størrelser og SHA-256 mod mappens `release.json`. Den kontrollerer også valgene App og Terminal samt mobilvisningen. Uden argument bruges `release/`. Generer først filoversigten med `npm run release:site -- PAKKEMAPPE`. Ingen af disse kontroller publicerer noget.

Kør alle følgende kommandoer fra `desktop/`. Pakningen henter kun fastlåste værktøjer fra `runtime-lock.json`, kontrollerer deres SHA-256/SHA-512 og kopierer dem til appens ressourcemappe. Byg ikke fra en mappe med ukendte lokale ændringer. Appens kode pakkes fra en eksplicit filliste; projekter, nøgler, testmapper og udviklerens indstillinger medtages ikke. Git, Node/npm og OpenCode følger med; model, API-adgang, Docker og hosting-CLI'er følger ikke med. Installationen ændrer ikke systemets PATH eller eksisterende værktøjer.

```bash
npm ci
npm run runtime:prepare -- darwin-arm64
npm run package:mac -- --arm64
```

Pakningen kræver, at produktfilerne er committet, og lægger et kildebevis (`source-proof.json`) med commit og kontrolsummer i pakken. Runtime-værktøjerne kontrolleres fil for fil mod den forberedte runtime; kør derfor `runtime:prepare` igen, hvis manifestet mangler sit runtimebevis. Prøver på en pakket app, fx `test:package`, kan derfor først køres, når ændringerne er committet. Se [udgivelsesforløbet](../docs/udgivelse.md).

Intel-Mac bruger `darwin-x64` og `--x64`. Windows bruger mål `win32-x64` og `npm run package:windows -- --x64`; ARM64 bruger `win32-arm64` og `--arm64`. Windows-pakken kan også bygges lokalt fra Mac med de nødvendige byggeværktøjer. En krydsbygget `.exe` er ikke en afprøvning på Windows: installation, første start og opdatering skal stadig prøves der. Pakken er en betaversion.

Signering sker kun, når `HARNESS_SIGN_IDENTITY` eksplicit angives til det godkendte Developer ID-certifikat ved Mac-bygning. Angiv certifikatnavnet uden præfikset `Developer ID Application:`; den lokalt godkendte identitet er `mekbas IVS (2UX98897JW)`. Der er ingen automatisk valg af certifikat. Notarisation er særskilt og kræver en opsat Apple-profil; en signeret pakke er ikke automatisk notariseret. Indtil notarisation er gennemført, må testpakken ikke beskrives som en friktionsfri installation på andre Mac-computere. Omgå ikke kommunens installationspolitik.

```bash
npm run test:package -- "release/mac-arm64/Aura.app"
npm run release:site
```

`test:package` starter den pakkede app med isoleret brugerdata og begrænset PATH, kontrollerer medfølgende værktøjer og åbner syntetiske projektfiler fra pakkens projektfunktion i preview. Prøven foretager ingen Git-skrivninger og dækker derfor ikke automatisk versionsgemning ved projektoprettelse eller knappen Gem version. Den nulstiller aldrig macOS-nøgleringen. Downloadfiler og den genererede downloadside ligger i `desktop/release/` og skal distribueres separat, ikke committes som binære filer. Bygning uploader ikke noget. Downloadsiden viser kun faktiske filer og SHA-256; den opfinder ikke publicerede links.

Workflowet **Byg testpakker** har kun manuel start. Fra 10. oktober 2026 kræver hver konkret kørsel brugerens udtrykkelige tilladelse, også efter commit/push. Byg lokalt som udgangspunkt; et ønske om installationsfiler er ikke tilladelse til at bruge GitHub-minutter. Workflowet uploader byggeartefakter til den konkrete GitHub Actions-kørsel, ikke en offentlig Release. Mac-pakker fra workflowet er usignerede, medmindre en særskilt godkendt signeringsopsætning tilføjes. Kildearkiver og tredjepartslicenser følger med runtime; projektets egen kode er under EUPL-1.2; se LICENSE.

Workflowet prøver også plan, filændring, preview og fortrydelse gennem rigtig OpenCode med en lokal testmodel. Det bruger ingen ekstern model eller API-nøgle. Byggearkiver gemmes i syv dage; de er midlertidige prøver og skal ikke bruges som permanente downloadlinks. Den ændring frigør ikke plads fra ældre arkiver. En fuld lagerkvote skal håndteres særskilt, før en ny kørsel kan gemme sine filer.

### Apple-notarisation

Hver udgivelse har seks Apple-indsendelser. Hver indsendelse kræver udtrykkelig godkendelse.

1. Byg og signér appen til Apple Silicon og Intel, og notariser de to første DMG'er.
2. Vedhæft billetten til hver signerede `.app` med `xcrun stapler staple`, og kontrollér appen igen med `xcrun stapler validate` og `syspolicy_check distribution`. En billet på diskbilledet er ikke en billet på selve appen: kontrollen 10. oktober fandt `Notary Ticket Missing` på appen, selv om Gatekeeper accepterede den som `Notarized Developer ID`.
3. Pak den samme app med `electron-builder --prepackaged` til en ny outputmappe; se eksemplet nedenfor. Det bevarer den afprøvede kode og signatur og giver den endelige DMG og ZIP. Overskriv ikke en tidligere afprøvet installationsfil undervejs.
4. Notariser den endelige DMG og ZIP til hver arkitektur. Dan først derefter filoversigt og kontrolsummer efter [udgivelsesvejledningen](../docs/udgivelse.md#saml-filer-og-dokumentation).

Send filerne én ad gangen, og vent, til den ene er færdig, før den næste sendes. Brug en fast forbindelse, helst kabel eller et stabilt wi-fi, ikke en mobil hotspot: ved 0.5.0-beta.2 blev fire uploads afbrudt over en iPhone-hotspot. Hold Mac'en vågen med `caffeinate`, tilsluttet strøm og med låget åbent. Kør fra `desktop/` efter opsætning af en lokal `notarytool`-profil, med den konkrete fil:

```bash
caffeinate -is node scripts/notarize.cjs release/Aura-VERSION-mac-arm64.dmg ai-harness-notary
```

`caffeinate -is` forhindrer dvale, så længe scriptet kører og Mac'en er på strøm. Scriptet sender filen uden at holde forbindelsen åben under Apples behandling. Så snart Apple har givet et indsendelses-id, gemmes id, filnavn og SHA-256 i `FIL.notarization-pending.json` ved siden af filen. Derefter venter scriptet med `notarytool wait`. Før billetten hæftes på, kontrollerer det med `notarytool log`, at Apples SHA-256 er den samme som den sendte fils. Til sidst skrives kvitteringen `FIL.notarized.json` med filnavn, SHA-256, status, id og kontroltidspunkt, og ventefilen slettes. For en DMG gælder kvitteringens SHA-256 filen med billet. En ZIP kan ikke selv staples; scriptet pakker den ud og kontrollerer appens signatur, billet og distributionskontrol.

Downloadsiden markerer kun en fil som notariseret, hvis kvittering og aktuel kontrolsum matcher. En ny bygning kræver ny notarisation. Profilnavnet er ikke en adgangskode; profilen oprettes lokalt med Apples værktøj. Apple-login og private nøgler må ikke lægges i repositoryet.

Hvis forbindelsen falder ud:

- **Under ventetiden:** Scriptet prøver igen tre gange med stigende pauser og stopper derefter med indsendelsens id. Kør samme kommando igen. Scriptet genoptager fra det gemte id og sender ikke filen igen, også selv om Apple har godkendt den i mellemtiden.
- **Under uploaden:** Apple har oprettet en indsendelse, men har ikke fået hele filen, og den bliver stående som In Progress. Scriptet sender ikke filen igen af sig selv. Kør samme kommando med `--send-igen` på en fast forbindelse for at sende filen på ny. Uden `--send-igen` kontrollerer scriptet kun, om Apple alligevel har modtaget og godkendt filen.
- **Efter godkendelsen:** Fejler vedhæftningen eller kontrollen af billetten, genoptager samme kommando uden ny indsendelse og uden at hæfte billetten på igen.

Uden ventefil slår scriptet op i Apples liste over indsendelser, før det sender. En godkendt indsendelse med samme filnavn genbruges, hvis Apples log har samme SHA-256 som filen. Har Apple en uafsluttet indsendelse med samme filnavn, stopper scriptet. Vent, og kør igen; hænger indsendelsen efter en afbrudt upload, så brug `--send-igen`.

Slet ikke ventefilen, før kvitteringen er skrevet. Afviser Apple filen, eller passer Apples SHA-256 ikke, stopper scriptet med indsendelsens id uden at hæfte billetten på. Hent Apples log med `xcrun notarytool log ID --keychain-profile ai-harness-notary`. `--send-igen` sender den samme fil igen; normalt skal der bygges en rettet fil. `tests/notarize.test.cjs` afprøver forløbet med en falsk `xcrun` uden at kontakte Apple.

Eksempel på pakning af en allerede signeret og staplet Apple Silicon-app fra `desktop/`:

```bash
npx --no-install electron-builder --config electron-builder.cjs --mac dmg zip --arm64 --prepackaged release/mac-arm64/Aura.app --publish never --config.directories.output=release/notarized-arm64
```

Intel bruger `--x64` og den tilsvarende Intel-app. En Intel-app kørt med Rosetta er ikke en prøve på Intel-hardware; den medfølgende OpenCode-binær kan kræve CPU-egenskaber, som Rosetta ikke stiller til rådighed. Windows- og Intel-pakker må ikke beskrives som installationsafprøvet alene på baggrund af en vellykket bygning.


### Faktisk afprøvning · 25. september 2026

45 automatiske tests består. Den signerede Apple Silicon-app er startet som pakket app med isolerede brugerdata, normal HOME og begrænset PATH. De medfølgende OpenCode-, Git- og Node/npm-værktøjer er kontrolleret. Et syntetisk projekt er oprettet, vist i preview og versionsgemt gennem brugerfladen med eksplicit lokal Git-identitet. En rigtig OpenCode-session mod en kontrolleret lokal modelserver har gennemført planlægning, godkendt filændring, preview og manuel versionsgemning. Testen bruger ingen ekstern betalt model. Automatiske checkpoints afvises korrekt, når Git-filtre er aktive; den manuelle vej er afprøvet i pakken.

Apple Silicon-DMG'en er monteret skrivebeskyttet; appens signatur og overensstemmelse med den afprøvede app er kontrolleret. Downloadsiden er afprøvet i Chrome på desktop- og mobilbredde med faktisk download og kontrolsum. Intel-Mac og Windows x64 er pakket, men ikke kørt på deres målmaskiner; Windows er usigneret. GitHub-workflowet er skrevet, men ikke kørt på GitHub. Der er endnu ingen offentlig downloadadresse, Apple-notarisation eller afprøvning på en separat, nyinstalleret computer.

Opret om nødvendigt en lokal Apple-loginprofil interaktivt:

```bash
xcrun notarytool store-credentials ai-harness-notary --team-id 2UX98897JW
```

Værktøjet spørger efter Apple-konto og en app-specifik adgangskode. Indtast dem kun lokalt. Profilen gemmes i nøgleringen og valideres af Apple; almindelig Apple-kontoadgangskode skal ikke bruges. En eksisterende profil kan bruges i stedet. Nulstil ikke nøgleringen, hvis der opstår en adgangsfejl.

Team `2UX98897JW` tilhører Progressify ApS; det eksisterende signeringscertifikat viser stadig navnet mekbas IVS. HTTP 401 ved validering peger på loginoplysningerne. HTTP 403 med besked om en manglende eller udløbet aftale kræver, at Account Holder kontrollerer medlemskab og ventende aftaler på [Apple Developer-kontoen](https://developer.apple.com/account/). Apple beskriver blokeringen i sin [vejledning om adgangsproblemer](https://developer.apple.com/help/account/access/resolving-access-issues). En afvist profilvalidering er ikke en indsendt notarisation. Se den aktuelle status og CI-resultaterne i [teststatus](../docs/teststatus.md#pakker-og-ci).


## Corti S1 og Mistral · 25. september 2026

### Mistral Large 4 · 7. oktober 2026

Mistrals katalog hentes, når forbindelsen åbnes. Når kontoen har `mistral-large-4` eller `mistral-large-4-0`, vises modellen blandt højst tre modelkort som **offentlig prøveversion**. Et gemt modelvalg bevares. Mistral Medium er fortsat Mistrals hidtidige udgangspunkt til kode; mangler den i kataloget, vælger brugeren selv. Large 4 overtager ikke automatisk pladsen.

Mistral-forbindelser bruger nu `@ai-sdk/mistral`, som følger med den fastlåste OpenCode 1.18.33. Adapteren læser både almindelig tekst og strukturerede tænkeafsnit, adskiller dem under streaming og bevarer tænkeafsnittene i samtalehistorikken efter værktøjskald. Aura sender ikke et valg af indsats; modellens niveau er derfor ikke angivet som verificeret i appen. Andre kompatible servere beholder deres eksisterende adapter.

Katalogets tokengrænser har forrang. Uden en oplyst grænse bruges modelkortets 1M kontekst for Large 4. Appens loft på 32.000 svartokens pr. kald er ikke en påstand om modellens maksimale svarlængde. Prisen følger kataloget, hvis det oplyser en; ellers bruges normal listepris på 1,36 USD ind, 4,18 USD ud og 0,14 USD for cachelæst input pr. million tokens. Mistrals lanceringsrabat er ikke trukket fra dette overslag. Det står i gennemgangen før afsendelse. Det bevægelige `mistral-large-latest` får ikke længere en gammel Large 3-pris uden dokumentation for aliasets indhold.

Kilder kontrolleret 7. oktober 2026: [modelkort](https://docs.mistral.ai/models/mistral-large), [prisliste](https://docs.mistral.ai/inference/pricing), [svarformat og historik](https://docs.mistral.ai/studio/conversations/reasoning) og [lancering](https://mistral.ai/news/mistral-large-4/). Prisopslaget ændrer ikke kontroldatoen for datavilkårene. Adgang til API'et betyder heller ikke, at modellens vægte allerede kan hentes til lokal drift.

`npm run test:mistral` afprøver modelvalget, prisgennemgangen, streaming, bevaret historik, godkendt filændring, preview, afvisning, Stop, nøglefejl og genåbning. Den bruger den rigtige Electron-app og OpenCode, men en kontrolleret lokal modelserver og syntetiske data. Den kontakter ikke Mistral og siger ikke noget om modellens kode- eller sprogkvalitet. Se den daterede afprøvning i [teststatus](../docs/teststatus.md).

### Den oprindelige tilslutning

Vælg **Corti S1 · EU** eller **Mistral API** under forbindelser, gem din API-nøgle, og hent kontoens aktuelle modeller. Intet modelvalg, forbrug eller skift til anden udbyder sker automatisk. Nøgler bruger det eksisterende krypterede lager og sendes kun fra hovedprocessens gateway.

Corti bruger fast `https://ai.eu.corti.app/v1` og kræver en nøgle fra et EU-projekt. Modellerne hentes fra `/models`; embedding-modeller udelades fra kodechatten. Samme Corti-modelnavn kan dække andre underliggende modeller i USA, så adapteren skifter ikke region. EU-oplysningerne er leverandørudsagn, ikke en kontrol af jeres aftale eller installation. Se [Cortis regioner](https://docs.corti.ai/models/regions) og [API-vejledning](https://docs.corti.ai/models/quickstart).

Mistral bruger fast `https://api.mistral.ai/v1`. Katalogets `completion_chat: false` udelader modeller uden chat, og `function_calling` bruges til at vise oplyst værktøjsstøtte. Manglende pris eller egenskaber vises fortsat som ukendte. Træningsvalg og opbevaring afhænger af konto og model; appen kan ikke verificere kontoens indstillinger. Se [modelkatalog](https://docs.mistral.ai/api/endpoint/models) og [træningsvilkår](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models). Kilder kontrolleret 25. september 2026.

Promte er efter aftale udeladt fra denne milepæl. Den fundne [Responses API-vejledning](https://kommune.applai.dk/docs/admin/api-og-responses) beskriver arbejdsområde-assistenter, men dokumenterer ikke egne kodeværktøjer; en fremtidig adapter kræver afklaring.

Verifikation: katalog, Bearer-adgang, streaming, værktøjskald og afviste kald er afprøvet gennem gatewayen med lokale kontrollerede HTTP-servere. Udbydervalgene er afprøvet i Electron på macOS. Ingen live-modelopgave mod Corti eller Mistral er gennemført; det kræver konto/nøgle og valgt model. Eksisterende installationspakker indeholder ikke disse kildeændringer før en ny bygning.


## Lokal modelopdagelse og projektforslag · 26. september 2026

AI-opsætningen søger efter en kørende Ollama på standardadressen på denne computer. Der søges ikke på netværket eller på Tailscale. Appen sender ingen prompt, starter ingen model og installerer intet. Brugeren vælger aktivt at gemme forbindelsen; en eksisterende forbindelse med samme type og adresse genbruges. Manglende server, tomt katalog og ugyldigt svar har hver sin forklaring. Andre adresser og API-udbydere tilføjes gennem den eksisterende forbindelsesdialog.

Modeller med cloudmarkører vises som mulige cloudmodeller. Fravær af markøren beviser ikke lokal databehandling. Modelvalg og datagennemgang gælder fortsat før første afsendelse.

Agenten får nu fælles instruktioner om at begrunde teknologivalg, bevare eksisterende kode, afklare behov for backend og login samt foreslå et konkret design. React/TypeScript, Astro og designbiblioteker er muligheder i samtalen, ikke nye indbyggede skabeloner. Agenten skal foreslå ét designvalg, tilbyde relevante alternativer og respektere brugerens valg før installation. Tailscale behandles separat som netværksadgang. Planlægningen omfatter også målplatform, offlinebrug, fælles data, login og valget mellem ingen backend, serverless, administrerede tjenester og egen backend. Native teknologier kan foreslås, men appen har ingen indbygget native bygning, simulator eller appbutiksudgivelse. React med Vite og Astro kan installeres og startes fra previewets gennemgang. Andre framework-servere startes særskilt.

Verifikation: Ti relevante automatiske tests består, inklusive HTTP-katalog og afviste redirects. Opstarten er kørt i Electron på macOS med kontrolleret Ollama-katalog og et faktisk prøveprojekt med preview. Ingen rigtig Ollama-model, Corti-opgave, Windows-installation eller kvalitetsvurdering af et modelgenereret design er afprøvet i denne milepæl. De nye agentinstruktioner er skrevet og koblet til afsendelsen; deres effekt kræver en live-opgave.

## Afprøvning af første app · 26. september 2026

Planlægning bruger nu OpenCodes `plan`-agent, mens bygning bruger `build`. Plan-agentens tilladelser sættes eksplicit og kontrolleres ved opstart. Den tidligere opsætning brugte byggeagenten i begge tilstande; skrivebeskyttelsen blokerede ændringer under planlægning, men en rigtig model forsøgte gentagne gange at bygge alligevel.

Appens ekstra vejledning om platform, backend og design kan læses under Data og vilkår og indgår nu i godkendelsens kontrolsum. Integrationstesten kontrollerer, at vejledningen når frem til modelserveren i både planlægnings- og byggesessionen.

Den eksterne prøve har nu to forløb. Standardforløbet ændrer én overskrift. Det udvidede forløb planlægger og bygger en oversigt over fiktive mødelokaler, prøver kapacitetsfilter og tom tilstand og kontrollerer vandret overløb i mobilvisningen. Kør fra `desktop/`:

```bash
HARNESS_LIVE_SCENARIO=first-app npm run test:openrouter
```

Model vælges eventuelt med `HARNESS_LIVE_MODEL`. Testen kræver en `:free`-model med oplyste værktøjskald og nulpris samt en konkret rute med nulpris. Der vælges ikke en betalt reserveudbyder. API-nøglen indtastes skjult i terminalen. Testen bruger isolerede projektfiler og fjerner sin gemte forbindelse ved afslutning. Resultater og skærmbilleder gemmes i den midlertidige testmappe; installationspakkerne ændres ikke.

Faktisk resultat den 27. september: `cohere/north-mini-code:free` via Cohere gennemførte planlægning, godkendt filændring og preview i Electron. Filtrering, tom tilstand, nulstilling og mobilbredde bestod i samme prøve. Den svarede stadig delvist på engelsk. Det viser, at integrationen kan gennemføre opgaven; det er ikke en kvalitetsanbefaling til danske begyndere. Den efterfølgende forenkling af menuerne er desuden afprøvet med den rigtige OpenCode-motor og en kontrolleret lokal modelserver.

Et allerede genereret mødelokaleprojekt kan afprøves uden nye modelkald med `node scripts/verify-generated-preview.cjs /sti/til/projekt`. Kontrollen åbner projektet med isolerede appindstillinger og ændrer ikke projektfilen.


### Opdateringer fra 0.3.0

Indstillinger › Opdateringer viser den installerede version og søger efter næste udgivelse. Automatisk søgning er slået til som udgangspunkt; download og genstart kræver brugerens valg. Kritiske rettelser giver en vedvarende advarsel uden at blokere. Beta.6 installeres videre med den nye installationsfil én gang.

Mac-opdateringer kræver et ZIP-arkiv af den signerede og staplede app. Windows bruger den samme NSIS-installationsfil som downloadsiden. Filer, kontrolsummer, separate kanaler og godkendelser beskrives i [udgivelsesforløbet](../docs/udgivelse.md). De opdaterede Pages-feeds offentliggøres kun ved en manuelt godkendt Pages-kørsel. `npm run test:updates` afprøver klienten lokalt uden at offentliggøre noget.
