# Implementeringsplan: hackathon-årsagerne

**Status 1. november 2026: ikke klar til at bygge efter.** Specifikationerne er skrevet og rettet to gange mod skeptikerkritik. Ingen af de 13 holdt ved den sidste kontrol. Citater og påstande om den nuværende kode skal verificeres igen ved hvert trin, før der bygges (jf. tripwire 3 i CLAUDE.md). Det her er et kort over arbejdet, ikke en facit.

Grundlag: [årsagsdokumentet](hackathon-aarsager.md) og [planen](plan-hackathon-aarsager.md). Brugerens beslutninger står i planen.

## Åbne beslutninger, der skal besvares før bygning

1. Beslutning 1: Må planen bevares efter fejl og Stop under Byg, og må docs/decisions.md:154 ændres? PR-diffen gør det, og den besluttede regel siger det modsatte. _(trin 1)_
2. Beslutning 2: Hvordan overtages commit'en? a) cherry-pick eller merge med Partheds forfatter bevaret, eller b) ny commit under brugerens identitet med PR-diffen. AGENTS.md peger på a) for historisk tilskrivning; b) er nødvendig, hvis commit'en skal ændres. _(trin 1)_
3. Beslutning 3: Hvilken regel gælder for Git-handlinger? Memory-noten 2026-10-26 siger, at Claude må committe, pushe og merge ved overtagelse. CLAUDE.md og AGENTS.md for os_harness kræver brugerens ja til hver handling. _(trin 1)_
4. Beslutning 4: Skal engine.cjs-konflikten løses som beskrevet med main's kommentar, eller skal kommentaren også opdateres? _(trin 1)_
5. Beslutning 5: Skal npm run test:recovery køres før merge, og med hvilken pakke (HARNESS_TEST_PACKAGE)? Den kører en rigtig OpenCode-motor og en lokal modelserver. _(trin 1)_
6. Beslutning 1: Må AI'en redigere i references, secrets, credentials-filer og navne med secrets eller credentials? På main er redigering 'ask' (engine.cjs:67-68). PR #56 gør alle RULES.credentials og RULES.metadata til 'deny' (PR-diffen linje 86), inkl. .ssh, .aws, .kube, .azure, .gnupg, .npmrc, .pypirc, *.p12, *.pfx og .aura-private. Skal det begrænses til references, secrets og credentials, eller accepteres hele listen? _(trin 2)_
7. Beslutning 2: Skal *secrets* og *credentials* gælde for almindelige filnavne som secrets-policy.md i læsning, sandkasse og Promte, eller kun i ændringsoversigt som i dag (changes.cjs:10)? Og skal de udvidede sandkassemønstre (.kube, .azure, .gnupg, p12, pfx) gælde der? _(trin 2)_
8. Beslutning 3: Skal Promte-eksport afvise hele eksporten, når en fil rammer en beskyttet regel (provider-promte.cjs:63 kaster fejl i dag), eller kun springe den over (provider-promte.cjs:96)? _(trin 2)_
9. Beslutning 4: Skal .aura-private med i RULES.metadata, når der ikke findes en producent af mappen i main? _(trin 2)_
10. Beslutning 5: Skal navne med afsluttende punktum eller mellemrum afvises for alle filer (som PR #56 gør via invalid i protected-paths.cjs), eller kun for beskyttede navne? De fire eksisterende kontroller i approvals-policy.cjs:23, deployment-artifact.cjs:26, pages-publishing.cjs:102 og provider-promte.cjs:61 skal også besluttes. _(trin 2)_
11. Beslutning 6: Skal Pages-publicering (pages-publishing.cjs:79 og :103) og chat-session projectEdit (chat-session.cjs:630) med i den fælles liste, eller bevares de særskilt? _(trin 2)_
12. Beslutning 7: Skal references-undtagelsen ved kopiering (copies.cjs:62, og visningen i copies.cjs:23) bevares, når PR #56 gør references til deny i redigering og læsning? Det er en modsigelse, der ikke står i den tidligere specifikation. _(trin 2)_
13. Beslutning 8: Skal PR #56 flettes ind i main, og med hvilken git-handling og konto? Det kræver brugerens ja for den konkrete kørsel. Denne undersøgelse har ikke kørt nogen. _(trin 2)_
14. Beslutning 1, ikke truffet: filændringer med relativ pattern i Git-layout. Skal worktree sendes ind i context fra Workbench, så patternet kan verificeres, eller skal metadata.filepath alene være målet? Del 2 C og filændringer uden for projektet venter på svaret. _(trin 3)_
15. Beslutning 2, ikke truffet: mappeadgang fra parentDir. Kun den ene mappe (direkte børn), eller også undermapper (subtree=true, som i dag for '/*')? Del 2 A's forventede folder og describe-form venter på svaret. _(trin 3)_
16. Beslutning 3, ikke truffet og ikke implementeret: huskeregel pr. kategori for kommandoer. I dag matcher bash-nøglen exakt kommando, cwd og input (describe linje 150-158). Hvilke kategorier og præfikser, og hvem definerer listen? Årsagsdokumentet skal præciseres. _(trin 3)_
17. Beslutning 4, ikke truffet: skal en mapperegel for læsning, søgning og filændring være adskilt efter kind (som i dag, linje 222), eller én regel for alle? _(trin 3)_
18. Beslutning 5, ikke truffet og i konflikt med docs/decisions.md linje 387: må en mappeadgang uden for projektet, udledt af parentDir, huskes pr. projekt, eller skal den spørge hver gang som i beslutningsloggen? Svaret afgør forventningen i Del 2 A og B samt risikoen for plan-tilstand. Den sidste linje i denne liste er ikke en del af planens beslutninger fra 1. november 2026, hvor ingen af de fire beslutninger ovenfor er besvaret. _(trin 3)_
19. 1. Placering i samtalens kopi eller i den åbne projektmappe? Nuværende placering er bench.store.root/scratch (chat-session.cjs:379). Kopimappen er this.root (chat-session.cjs:65, verificeret). copies.cjs er ikke undersøgt for scratch-placering. _(trin 4)_
20. 2. Pr. opgave eller pr. motor? Hvis mappen følger opgave-id, skal motoren genstartes for hver opgave uden kommandoisolation, og det strider mod årsag 4 i planen (motoren genstartes, samtalen glemmes). Alternativ: én fast mappe pr. samtale eller projekt, hvor AI'en selv opretter en undermappe. Med kommandoisolation genstartes motoren allerede (chat-session.cjs:392). _(trin 4)_
21. 3. Skal .aura/tmp udelukkes fra Git, Ændringer, versioner og kopier i dette trin? Årsagsdokumentets afsnit 2 foreslår det (ikke læst i denne gennemgang). Planens trin 4 nævner det ikke. _(trin 4)_
22. 4. Hvad betyder 'skrivning i .aura/tmp nægtes' i årsagsdokumentets linje 115 (verificeret: docs/hackathon-aarsager.md:115 siger, at i Byg skal skrivning uden for projektet og .aura/tmp nægtes)? Det modsiger arbejdsfiler i .aura/tmp. Forslag: kun andre opgavers mapper nægtes. _(trin 4)_
23. 5. Må skrivning uden for projektet i Byg afvises uden kort? Det ændrer decisions.md:387 og :474. _(trin 4)_
24. 6. Dansk ordlyd af afvisningen til AI’en og af de to korttitler. Forslag: 'Må AI’en skrive i en mappe uden for projektet?' til skrivning og 'Må AI’en se …' til læsning. Ordlyden godkendes af brugeren. _(trin 4)_
25. Beslutning 1: Hvem genforsøger, OpenCode (pass-through, som docs/decisions.md:698 beskriver) eller Aura i gatewayen (årsagsdokumentets retning). Brugeren skal også svare, om docs/decisions.md:698 står ved magt. Venter på beslutning 1: maal, gateway.cjs:60-66, prøverne for 408, 429, 500 og 503 samt ende-til-ende-prøven. _(trin 5)_
26. Beslutning 2: Antal forsøg, pauser og loft for Retry-After. Hvis OpenCode genforsøger, er tallene ikke verificeret: i OpenCode-binæren findes strengene retry-after, maxRetries og failing connection after retries, men de præcise værdier er ikke læst. Målt er kun ét genforsøg efter cirka 1,1 s. Venter på beslutning 1 og 2. _(trin 5)_
27. Beslutning 3: Hvad der sker, når sidste forsøg fejler: vises OpenCodes egen fejl med udbyderens tekst, eller en Aura-fejl med type limit eller server, og hvilken tekst brugeren ser. Venter på beslutning 1 og 2. _(trin 5)_
28. Beslutning 4: Skal 408 og 5xx behandles ens med 429, eller skal 500 og 502 have anden adfærd? Venter på beslutning 1. _(trin 5)_
29. Beslutning 5: Skal netværksfejl og afbrudt strøm (gateway.cjs:73-79) også genforsøges? Det er ikke en del af trin 5 og derfor åbent. _(trin 5)_
30. Beslutning 6: Skal planen bevares ved udbyderfejl i Planlæg, hvor chat-session.cjs:708 i dag trækker den tilbage? docs/decisions.md:699 gælder kun for en byggeopgave. Det er uafhængigt af trin 5. _(trin 5)_
31. 1. Netadgang i sandkassen er IKKE truffet. Ud over registry.npmjs.org, pypi.org og files.pythonhosted.org (command-sandbox.cjs:9) er det ikke besluttet, om localhost (127.0.0.1 og ::1), projektets porte eller andre netadresser må nås. Listen skal godkendes af brugeren, før den bygges (docs/plan-hackathon-aarsager.md:78 og docs/hackathon-aarsager.md:309). _(trin 6)_
32. 2. Skal en husket kommando stadig tænde sandkassen for projektets øvrige opgaver (nuværende adfærd, chat-session.cjs:228)? Årsagsdokumentet anbefaler at skille 'husk denne kommando' fra 'kør alle kommandoer i sandkasse' (hackathon-aarsager.md:312), men brugeren har ikke besluttet det. _(trin 6)_
33. 3. Det danske navn og den præcise advarselstekst for 'Godkend alt'. decisions.md:722 kræver dansk navn og advarsel, men ikke ordlyden. _(trin 6)_
34. 4. Hvad 'Godkend alt' omfatter. decisions.md:722 siger, at det gælder over projektmappens grænse. Det står i modstrid med decisions.md:387, der siger, at kommandoer, web og filer uden for projektet spørger hver gang, og med hackathon-aarsager.md:76. Skal det dække udgivelse, sletning af mange filer og nye netdomæner, eller kun filer og kommandoer uden for projektet? _(trin 6)_
35. 5. Nøglens omfang for en husket kommando: den præcise kommando eller en kategori/præfiks (hackathon-aarsager.md:311). Årsagsdokumentet foreslår kategorier med dansk forklaring (hackathon-aarsager.md:76), men valget er ikke truffet. _(trin 6)_
36. 6. Windows: skal 'Godkend alt' og automatisk kørsel være helt fra på Windows, indtil der findes en løsning (hackathon-aarsager.md:314 og :299)? Efter den nuværende kode er automatisk kørsel fra (command-sandbox.cjs:23). _(trin 6)_
37. 7. Skal den delte npm-cache pr. bruger (hackathon-aarsager.md:314) være en del af trin 6 eller af trin 4? _(trin 6)_
38. 8. Gating af 'Godkend alt' (ny beslutning): vises det kun, når kommandosandkassen er aktiv, så det kun dækker kommandoer i projektet (P8), eller også uden sandkasse, så det kan dække handlinger uden for projektet (P10)? De to krav kan ikke stå samtidig; et descriptor-felt for sandkassestatus skal også navngives. _(trin 6)_
39. 9. Må /Library/Developer/CommandLineTools (xcode-select-værktøjer) læses i sandkassen (command-sandbox.cjs:42)? hackathon-aarsager.md:303 viser en xcode-select-fejl, men ikke at CLT-stien alene er årsagen. Et ja udvider læseadgangen og kræver en beslutning, før det bygges. _(trin 6)_
40. Venter på beslutning 6 (docs/hackathon-aarsager.md linje 434): skal AI'en starte forhåndsvisningen automatisk efter første bygning, og gælder samtykket pr. projekt? Ikke afgjort. Brugerens beslutning 2 dækker kun, at AI'en må starte og at samtykket huskes. _(trin 7)_
41. Venter på beslutning 7 (docs/hackathon-aarsager.md linje 435): skal opstarten ligge i en fil i projektet, fx .aura/preview.json eller .claude/launch.json? Ikke afgjort, så specifikationen har ingen opstartsfil. _(trin 7)_
42. Venter på beslutning 8 (docs/hackathon-aarsager.md linje 436): må log og konsolfejl sendes maskeret til modellen efter hver opgave, og må værktøjets svar indeholde maskeret log? Brugerens beslutning 1 dækker kun kontrolresultatet, ikke loggen. Det er derfor ikke afgjort, at loggen når modellen. _(trin 7)_
43. Ordlyden af samtykket i almindeligt dansk, fx Må Aura installere og starte appen?, er et forslag fra docs/hackathon-aarsager.md linje 224. Brugeren har ikke godkendt ordlyden. _(trin 7)_
44. Standardliste eller pr. projekt: skal de godkendte kilder gælde for nye projekter fra start (listen forhåndsudfyldes i oprettelsesstien), eller skal hver adresse godkendes pr. projekt i netlisten? Standard for alle projekter ændrer adfærd for eksisterende projekter uden samtykke. Valget er brugerens. _(trin 8)_
45. Den præcise liste pr. slags netadgang. Forslaget fra specifikationen er: styles fonts.googleapis.com og fonts.gstatic.com; scripts cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com og code.jquery.com; images ingen; connect ingen. cdn.tailwindcss.com kun med, hvis en måling viser, at den virker uden unsafe-eval. Listen er ikke afgjort. _(trin 8)_
46. Må eksterne billeder være tilladt som standard, og i givet fald hvilke? Det berører rettigheder og er ikke afgjort. _(trin 8)_
47. Skal CDN-scripts kun tillades med fastlåste versioner og SRI? SRI findes ikke i desktop i dag. Det er et produktvalg og er ikke afgjort. _(trin 8)_
48. Skal der bygges en lokal Tailwind-opsætning med npm i sandkassen som alternativ til CDN? Det kræver godkendelse af npm-installation, jf. desktop/core/project-guidance.cjs:24, som siger at npm-installation springer pakkescripts over, medmindre brugeren aktivt tillader dem. decisions.md har ingen sådan regel. Ikke afgjort. _(trin 8)_
49. Skal PACKAGE_HOSTS i desktop/core/command-sandbox.cjs:9 udvides, eller holdes den uændret? Forslaget er uændret. Det er brugerens valg. _(trin 8)_
50. Skal diagnosen i desktop/core/project-runtime.cjs:98 have en knap, der tillader adressen med ét klik, og skal knappen kun gælde for det aktuelle projekt? Det er en produktbeslutning. _(trin 8)_
51. Skal de fire eksisterende tekstfelter i desktop/ui/index.html:417-420 erstattes af listen og knappen, eller bevares ved siden af? Ikke afgjort. _(trin 8)_
52. Skal trinnet optages i planens rækkefølge i docs/plan-hackathon-aarsager.md? Planens trin 8 er i dag nr. 10, 11 og 12 (linje :38). Trinnet er nyt omfang ud over de 13 grundårsager. _(trin 8)_
53. A. Hvilken kopi er den, der bevares: (1) AGENTS.md beholdes som fuld kopi, og blokken springes over i systemprompten, eller (2) nye projekter får ikke grundreglerne i AGENTS.md (projects.cjs:59-60), og prøven projects.test.cjs:15 ændres. Option 1 bevarer AGENTS.md til andre værktøjer; option 2 fjerner dubleringen i filen. _(trin 9)_
54. B. Hvad gælder, når projektets AGENTS.md og de gemte grundregler er forskellige: (1) projektets AGENTS.md går forud, som i dag, (2) grundreglerne går forud, eller (3) afsendelsen afvises med en besked til brugeren. Og skal sammenligningen ske mod de effektive regler (skills.cjs:17 og :49) eller mod profilfilen (library.cjs:133)? Alle dele af specifikationen, der afhænger af B, venter på beslutning B. _(trin 9)_
55. C. CLAUDE.md: import @AGENTS.md (som desktop/core/adapters.cjs:59-60 og docs/decisions.md:229 beskriver for Claude Code og Gemini CLI) eller fortsat en fuld kopi. Gælder kun, hvis A er option 1 eller 2. _(trin 9)_
56. D. Skal eksisterende projekter migreres, så deres CLAUDE.md-kopi bliver til importen? Det er en ændring af brugerens filer og kræver en beslutning. _(trin 9)_
57. 1. Corti-nøgle uden miljøpræfiks: falder appen stille tilbage til EU (desktop/tests/providers.test.cjs:112 låser det i dag), eller skal en sådan nøgle afvises med besked? Ikke truffet. _(trin 10)_
58. 2. Gemte nøgler fra før rensningen (0.6.0-beta.1, uden 21923f8): renses de stille ved brug i models(), eller beder appen brugeren om at indtaste nøglen igen? Ikke truffet. _(trin 10)_
59. 3. Præfikser ud over dem, der findes i dag: skal api-key:, x-api-key: og navne uden understreg som token= fjernes? I dag fjerner reglerne kun Authorization:, Bearer og NAVN= med store bogstaver og understreg (connections.cjs:119-122). Ikke truffet. _(trin 10)_
60. 4. Corti-region før kontrol: vises regionen via en preview-metode, mens brugeren skriver nøglen, eller først efter kontrol? Ikke truffet. _(trin 10)_
61. 5. Corti 401 eller 403 med kendt udbyderårsag: skal sætningen om miljøet fjernes, så desktop/tests/key-cleaning.test.cjs:77 ændres? Ikke truffet. _(trin 10)_
62. 6. Ordlyd: skal etiketterne navn foran og Bearer foran skrives om til almindeligt dansk? Hvilken ordlyd skal 404-beskeden og DNS-beskeden have? Må Tailscale kun nævnes for private adresser? Ikke truffet; forslaget er ikke godkendt. _(trin 10)_
63. 7. Blank valgfri nøgle (Ollama, Egen server, OpenCode Zen i CLI'en og nøglevinduet): skal den behandles som ingen nøgle uden fejlen Feltet er tomt? Ikke truffet. _(trin 10)_
64. 8. Opdeling mellem trin 10 og trin 11: CLI-rensning og rettelseslinje i trin 10, kontrol før gem i CLI'en i trin 11. Skal opdelingen bekræftes? Ikke truffet. _(trin 10)_
65. 9. Azure- og Ollama-adressefelter (årsagsdokumentets sidste retningspunkt): hører de til trin 10 eller senere? Ikke truffet. _(trin 10)_
66. 1. Nøgleringsmekanisme pr. platform: macOS Keychain, Windows (Credential Manager eller DPAPI) og Linux Secret Service. Må CLI'en bruge en native npm-afhængighed eller systemværktøjer som security og secret-tool? Ingen af dem findes i dag. Venter på beslutning 1: cli/keychain.cjs, adapterens prøver og trin 2. _(trin 11)_
67. 2. Hvilken post i nøgleringen: en separat CLI-post eller den samme som desktop (Aura Safe Storage)? Desktop-nøgler kan ikke læses af CLI'en (desktop/core/app-identity.cjs:10-21). _(trin 11)_
68. 3. Reserven: skifter CLI'en automatisk til adgangssætningslageret, hvis nøgleringen fejler, eller kun efter brugerens valg? Må en nøgle gemmes uden nøglering og uden adgangssætning? docs/hackathon-aarsager.md:373 siger 'Brug nøglering som standard med det nuværende lager som reserve (beslutning)'. docs/hackathon-aarsager.md:357 siger, at adgangssætningslageret er et bevidst designvalg, og at ønsket om nøglering er brugerens. Beslutning 13 står åben i :441. _(trin 11)_
69. 4. Migration: skal eksisterende vault.json og krypterede nøgler flyttes til nøgleringen (kræver adgangssætningen én gang), eller læses de fortsat med adgangssætningen, indtil brugeren gemmer en ny nøgle? _(trin 11)_
70. 5. Nulstilling: hvad sletter den (kun nøglen, vault.json eller også forbindelserne i settings.json)? Hvad hedder kommandoen? Skal den kræve bekræftelse? docs/hackathon-aarsager.md:373 siger kun 'gør det muligt at nulstille nøglelageret'. _(trin 11)_
71. 6. Regionlinjens placering i login: før nøglen gemmes (så brugeren kan afbryde), efter kontrollen (efter normalize) eller kun i gennemgangen før afsendelse (cli/connections.cjs:76 disclose)? _(trin 11)_
72. 7. Standardnavnet: følger det regionen som i desktop (cortiName i desktop/core/connections.cjs:96, brugt i desktop/core/key-window.cjs:174), eller bevares 'Corti S1 · EU'? Ensartethed med desktop taler for regionen. Valget er brugerens. _(trin 11)_
73. 8. Gælder AGENTS.md's valgregel (ét spørgsmål pr. skærm, højst tre-fire valg) også for CLI-terminalen? AGENTS.md nævner i dag app, webguide og installationer. Og hvordan formuleres spørgsmålet om nøglering? _(trin 11)_
74. 9. Udgivelse: skal CLI-versionen hæves og udgives, og skal den udgivne 0.2.0-beta.6 trækkes tilbage fra terminalsiden? Begge dele kræver brugerens ja (docs/hackathon-aarsager.md:441, beslutning 13). _(trin 11)_
75. 10. Corti-nøgler uden miljøpræfiks falder i dag tilbage til EU (desktop/core/connections.cjs:91, låst af desktop/tests/providers.test.cjs:112). Hører til trin 10 og er ikke afgjort her. _(trin 11)_
76. Beslutning 1: Hvem kontrollerer komplais adresse? Kun muligheder i koden: Aura via Deployments.check (deployments.cjs:138, med adressekald 157-162), eller komplais overblik via provider status (komplai-publish.cjs:181). Valget står åbent. _(trin 12)_
77. Beslutning 2: Interval og synlighedskrav? I dag: 30 sekunder i appens vindue, kun når deling er slået til og appen er synlig (deployment-setup.js:328), og manuel kontrol med knappen deployment-tracking-refresh (index.html:313). Andre intervaller er brugerens valg og står åbent. _(trin 12)_
78. Beslutning 3: Hvilket ord vises før adressen er kontrolleret? Eksisterende muligheder: Udgivet (share-view.js:50 og deployment-setup.js:13) eller Upload modtaget (share-view.js:50, UPLOADED). Valget står åbent. _(trin 12)_
79. Beslutning 4: Hvilke kontrolfelter kræves før grøn tone? Eksisterende muligheder: kun startsidens HTTP-svar, eller også indholdsmatch (content matched i share-view.js:25). Valget står åbent. _(trin 12)_
80. Beslutning 1: grænsens tal N. Højst hvor mange godkendelseskort må et fast byggeforløb på 26 trin give? Tallet vælges af brugeren. _(trin 13)_
81. Beslutning 2: hvilket element tæller? Kortene i #approvals, Aktivitet-posterne .activity-entry.kind-approval, eller begge? Tæller automatisk godkendte handlinger med (approval-view.js:60 'godkendt automatisk')? _(trin 13)_
82. Beslutning 3: hvad er et typisk byggeforløb? Antal trin og fordeling mellem læsning, søgning, filændring, kommando og web. Skal fastlægges, før manuskriptet skrives. _(trin 13)_
83. Beslutning 4: skal grep i projektmappen være allow eller ask? decisions.md dækker det ikke; i dag er grep ask i Samtale, Planlæg og Byg (engine.cjs:66 og :70). _(trin 13)_
84. Beslutning 5: må prøven kun bruge den kontrollerede falske model, eller også en rigtig lokal model som qwen3:8b som supplement? Betalte målinger med Corti eller andre udbydere kræver særskilt godkendelse. _(trin 13)_
85. Beslutning 6: skal 'Byg og kontrollér automatisk' være slået til i prøven? Det ændrer, hvor mange kort der kan ventes. _(trin 13)_
86. Beslutning 7: skal prøven køre som manuel npm-kommando, eller også som fast kontrol i udgivelsesarbejdet? AGENTS.md tillader kun manuel start, så en automatisk kørsel kræver brugerens tilladelse. _(trin 13)_
87. Beslutning 8: hvilke kommandotyper i projektmappen må stadig spørge, fx publicering eller sletning af mange filer? decisions.md:387 dækker kun kommandoer uden for projektet; trin 6 venter på dette. _(trin 13)_

## Trin

### 1. #58 overtages

**Mål:** Når brugeren har godkendt overtagelsen (beslutning 3) og valgt metode (beslutning 2), ligger PR #58's ændringer på main som én ny commit. Hændelsesstrømmen genoprettes efter et tab, uden at prompten sendes igen; det er den del af PR #58, som planen beskriver. Planen bevares efter fejl og Stop under Byg er ikke et mål endnu, fordi det venter på beslutning 1 og strider mod docs/decisions.md:154. Status for dette mål: skrevet, ikke kørt. De 14 prøver i engine-recovery og de 6 i recovery-state er ikke kørt i denne vurdering.

**Kontrol:** holdt ikke ved sidste kontrol: Skeptisk gennemgang af rettelsen for trin 1 (overtag PR #58). Resultat: holder false, fordi der er tre fejl i rettelsen eller i planen. Verificerede citater (læst i filen selv): docs/decisions.md:154 (Afbrudte planer, stoppet/fejlet/afbrudt opgave må ikke bygges direkte) korrekt; docs/decisions.md:1

**Afhængigheder:**
- Trin 2 (overtag #56, beskyttede filstier) er uafhængigt af filsættet i PR #58, men bør vente, til #58 er på main, så kontraktprøven kører mod samme engine.cjs.
- Planbevarelsen (planRetained under Byg, og grenen i app.js) venter på beslutning 1.
- Valget mellem cherry-pick med bevaret forfatter og ny commit under brugerens identitet venter på beslutning 2.
- Overtagelsen kræver brugerens ja til hver Git-handling (branch, commit, merge), jf. os_harness AGENTS.md. Global CLAUDE.md sætter os_harness i gruppen recommend, I approve. Memory-noten fra 2026-10-26 siger noget andet; det venter på beslutning 3.

**Prøver (ingen er kørt endnu):**
- desktop/tests/engine-recovery.test.cjs: 14 test()-kald (verificeret i PR-diffen). Ikke kørt på main. Filen findes ikke på main, og den kræver ../core/engine-events.cjs, som heller ikke findes på main. En fejl ved kørsel vil derfor være en modul-mangel og ikke bevis for manglende adfærd. Navne verificeret i PR-diffen: event loss reconnects the same session and restores missed text without POST; lost prompt acknowledgement checks its unique ID and never resends the POST; unconfirmed prompt acknowledgement fails boundedly without a second POST; exhausted event reconnects stop once without sending another prompt or tool action; Stop invalidates a permission snapshot that was already in flight.
- desktop/tests/recovery-state.test.cjs: 4 test()-kald på øverste niveau (verificeret i PR-diffen). Ét af dem indeholder en løkke med to t.test-underprøver (outcome stopped og error), altså 6 prøver i alt. Ikke kørt på main, og filen findes ikke på main.
- Ikke kørt i denne vurdering: 14/14 i engine-recovery og 6/6 i recovery-state i scratch-klon, som den tidligere specifikation angiver. Disse tal er antagelser, indtil de er kørt.
- Ikke kørt i denne vurdering: fuldt testsæt med 699 prøver på main og 719 med PR, begge med 20 fejl. Tallene er antagelser. Fejlene antages at være miljøbundne, men det er ikke verificeret, og de tæller ikke som bevis for eller imod trinnet.
- Ikke kørt: npm run test:recovery (scripts/verify-recovery.cjs) med rigtig Electron og rigtig OpenCode-motor. Den kræver brugerens ja, jf. beslutning 5.
- Rettelse af prøven engine-recovery: den bør omformuleres, så den fejler af adfærdsårsager, fx manglende messageID eller genforsøg i engine.cjs send(), og ikke af manglende modul. Hvilken prøve der skrives før rettelsen, er ikke fastlagt i denne specifikation.

**Filer (citater ikke fuldt verificeret):**
- Ingen fil i repoet er ændret af denne rettelse. Konflikt med main: PR-diffen er ren mod main for desktop/core/chat-session.cjs og desktop/ui/app.js. Kun desktop/core/engine.cjs konflikter. På main står const run = promisify(execFile) på linje 8 og kommentaren på linje 9 (verificeret). Løsning: behold main's linje 8-9 og tilføj de to require efter linje 8.
- PR #58 har 7 filer, +542/-41 (verificeret med gh pr view 58): desktop/core/engine-events.cjs (ny); desktop/core/engine.cjs (ændret); desktop/core/chat-session.cjs (ændret); desktop/ui/app.js (ændret); desktop/tests/engine-recovery.test.cjs (ny); desktop/tests/recovery-state.test.cjs (ny); desktop/tests/engine-compaction.test.cjs (ændret).
- desktop/core/engine.cjs: prompt_async står på linje 317 på main (verificeret), og det er stedet, hvor prompten sendes. Linjeangivelserne for send(), listen(), handleEvent() og abort() i PR-diffen er ikke verificeret mod main.
- desktop/core/chat-session.cjs på main: run.status-emit står på linje 459 (fejlstien), 738 (afslutningsstien) og 746 (stop()); retirePlan('fejl') står på linje 708 og retirePlan('stoppet') på linje 746 (verificeret). Ingen af de tre run.status-linjer indeholder planRetained på main. PR-diffen tilføjer den og springer retirePlan over for runMode build. Engine-recovery-grenen i event() findes i PR-diffen; dens linjer 662-670 er ikke verificeret.
- desktop/ui/app.js på main: run.status-handleren starter på linje 950, og v.plan = null; v.planCard = false; står på linje 955 (verificeret). PR-diffen bevarer v.plan, når event.planRetained er true. engine.recovery har ingen gren i app.js i PR-diffen (verificeret ved søgning i diffen).

**Risici:**
- Besluttet adfærd modsiges: docs/decisions.md:154 siger, at en plan fra en stoppet, fejlet eller afbrudt opgave ikke må bygges direkte (verificeret). PR-diffen bevarer planen under Byg. Det venter på beslutning 1.
- engine.cjs send() ændres i opgavens startfase med messageID og genforsøg ved 5xx og netværksfejl. Det kan påvirke alle opgaver. PR-diffen er ikke afprøvet mod rigtig OpenCode.
- engine.recovery vises i PR-diffen kun som loglinje i chat-session; UI-stien til den er ikke verificeret og kræver en kørsel.
- Konflikten i engine.cjs er triviel, men et forkert valg fjerner enten de to require eller main's kommentar.
- PR-hovedcommit 0431c169eee95a0cb4e5287d0e2a3dce7ac9cebe er verificeret som PR's headRefOid. PR-forfatteren er Parthee-Vijaya (verificeret). Commit-forfatteren er ikke kontrolleret. AGENTS.md siger, at historisk tilskrivning bevares.

**Bevidst uden for trinnet:**
- Ingen Git-handling er udført: ingen branch, commit, push, merge eller PR-ændring.
- Ingen ændring af main, af PR #58 på GitHub eller af docs/decisions.md.
- Ingen rettelse af de 20 fejl i fuldt testsæt, som endnu ikke er verificeret.
- Ingen overtagelse af #56 og intet arbejde på hackathon-årsagerne 2-13.
- Ingen kørsel af rigtig Electron-prøve, rigtig OpenCode-motor eller rigtig udbyder.
- Ingen gennemgang af de fire åbne beslutninger i planen (forhåndsvisning, samtykke, Tailwind-kilder og adressekontrol).

### 2. #56 overtages

**Mål:** Når trin 2 er færdigt og sammenflettet, findes der én kilde (desktop/core/protected-paths.cjs fra PR #56) for beskyttede navne, og motorens læse- og redigeringsregler, læseplugin, godkendelser, kommandosandkasse, ændringsoversigt, Git-hjælpere, filvisning og Promte-eksport læser fra den. Det er et mål, ikke en færdig tilstand. I dag står hver liste for sig selv på main; kørt med node gav git.protectedPath('.kube/config') værdien false, og projectFiles.isProtected('production.env') gav true. Dele, der afhænger af en ikke truffet beslutning, står ikke som fakta: redigeringsafvisningen venter på beslutning 1, udvidelsen til almindelige filnavne venter på beslutning 2, Promte-adfærden venter på beslutning 3, .aura-private venter på beslutning 4, afsluttende punktum og mellemrum venter på beslutning 5, Pages og projectEdit venter på beslutning 6, references-undtagelsen ved kopiering venter på beslutning 7, og sammenfletningen venter på beslutning 8.

**Kontrol:** holdt ikke ved sidste kontrol: Holder: false. Fejl fundet; Verificeret selv (læsende kørsel på main 8ed23c9, ingen filer ændret): tre tilfældige citater er korrekte: desktop/core/engine.cjs:67-68 (edit-regler, linje 68 er løkken for .git); desktop/core/project-files.cjs:16 (regex for .env og secrets i samme return); desktop/core/

**Afhængigheder:**
- Trin 1 (#58) er ikke en forudsætning for denne ændring; git apply --check af PR-diffen på main 8ed23c9 lykkes (kørt, ingen skrivning).
- Trin 3 (godkendelser genkender motorens rigtige former) afhænger af dette trin, fordi approvals-policy.cjs skal bruge den fælles liste (docs/plan-hackathon-aarsager.md, trin 3).
- Redigeringsafvisningen for references, secrets og credentials, samt for de øvrige RULES-mønstre, venter på beslutning 1.
- Udvidelsen til almindelige filnavne med secrets og credentials venter på beslutning 2.
- Promte-eksportens adfærd ved beskyttede filer venter på beslutning 3.
- Med eller uden .aura-private i listen venter på beslutning 4.
- Afvisning af navne med afsluttende punktum eller mellemrum venter på beslutning 5.
- Pages-publicering og projectEdit venter på beslutning 6; references-undtagelsen ved kopiering venter på beslutning 7.
- Sammenfletningen af PR #56 venter på beslutning 8 og på brugerens ja til den konkrete git-kørsel (AGENTS.md og CLAUDE.md: git og GitHub-handlinger godkendes af brugeren).

**Prøver (ingen er kørt endnu):**
- Kørt på main 8ed23c9: git.protectedPath('.kube/config') giver false, og prøven forventer true; prøven fejler i dag (git.cjs:34-36).
- Kørt på main: projectFiles.isProtected('production.env') giver true (project-files.cjs:16); prøven består i dag og er en regressionsvagt for filvisning.
- Kørt på main: git.protectedPath('secrets-policy.md') giver false, og projectFiles.isProtected('secrets-policy.md') er ligeledes falsk, så filen kan læses i dag. Efter PR #56 bliver den blokeret, fordi RULES.credentials indeholder *secrets* (PR-diffen linje 154); prøven er en beslutningsprøve og venter på beslutning 2.
- Kørt på main: permissions('/project', [], 'build') giver read['*.p12'] som undefined og read['*'] som allow, så ingen deny-regel rammer certificate.p12. Den tidligere prøve read['*.p12'] er deny er derfor ikke en effektiv afgørelse. Ny prøve: den effektive læseafgørelse for certificate.p12 skal være deny efter PR #56 og skal også ramme createReadGuard (engine.cjs:161-165).
- Kørt på main: permissions('/project', [], 'build') giver edit['*'] som ask, og edit['references/x'] er undefined. Den effektive afgørelse for references/x på main er derfor ask (engine.cjs:67). Efter PR #56 skal den være deny; det er en ændring af adfærd og venter på beslutning 1.
- Erstattet prøve: 'shared names...' i PR-testen fejler i dag kun, fordi require af protected-paths.cjs kaster en fejl, og den beviser ikke .kube-adfærden. Ny prøve: git.protectedPath('.kube/config') skal være true; kørt på main giver den false.
- Ikke kørt; kodelæsning: approvals-policy.cjs:11 har ingen .kube, så protectedPath stopper ikke redigering af .kube/config. Om ApprovalsPolicy.allowed alligevel afviser, afgøres af resten af allowed(), som ikke er læst. Prøven skal køres før den bruges som bevis.
- Ikke kørt; kodelæsning: changes.cjs:3 og :10 rammer ikke .kube, så capture(root) vil medtage .kube/config i dag. Prøven forventes at fejle i dag, men er ikke kørt.
- Ikke kørt; kodelæsning: command-sandbox.cjs:46 og :49 har ingen .kube, så denyRead indeholder ikke <root>/**/.kube. Prøven er kun macOS og kan springes over uden sandkasse.
- Ikke kørt; kodelæsning: provider-promte.cjs har ingen forekomst af references (grep med antal 0), så ignoredSource i :23 lader references/private.txt passere. Prøven forventes at fejle i dag, men er ikke kørt.
- Ikke kørt: PR-testen 'engine policy generates read and edit denials' (PR-diffen linje 298-312) forventer, at alle toOpenCodeGlobs-mønstre er deny for read og edit i alle tilstande, og at references/token.pem ikke får en read-tilladelse. Prøven er ikke kørt.
- Ikke kørt: decisions.md:493-496 kræver, at læseregler testes i begge former mod den rigtige OpenCode med og uden Git. PR-testen tester kun permissions()-objektet; OpenCode 1.18.33 er ikke kørt med de nye mønstre. Det er rung to, ikke rung tre.
- Ikke kørt: desktop-testsuiten (686 bestået ifølge PR-beskrivelsen, ikke verificeret af mig), kommandosandkassen og læseplugin på Windows og Linux.

**Filer (citater ikke fuldt verificeret):**
- NY desktop/core/protected-paths.cjs (fra PR #56, PR-diffen linje 146 til 199): RULES.credentials, RULES.metadata (.git og .aura-private), RULES.references (references); eksporterer RULES, createPathClassifier, classify, isProtected, toOpenCodeGlobs og toSandboxGlobs.
- desktop/core/engine.cjs:52-55 permissions(): læseregler skrevet ud for *.env, *.env.*, *.key, *.pem, .git, secrets og references (linje 52 er read-objektet, linje 55 løkken for .git, secrets og references). PR-diffen linje 74: read = { '*': 'allow', ...denials }.
- desktop/core/engine.cjs:67-68 permissions(): redigeringsregler for *.env*, *.key, *.pem og .git (linje 67 er edit-objektet, linje 68 er løkken for .git). PR-diffen linje 86: edit = { '*': 'ask', ...denials }, så alle RULES.credentials og RULES.metadata bliver 'deny'; se beslutning 1.
- desktop/core/engine.cjs:161-165 createReadGuard og protectedFile: egen liste (.git, secrets, references, præfiks .env, endelse .key og .pem), ingen .p12 eller .pfx. PR: createReadGuard får classifyPath og afviser invalid, credentials og metadata; classify indlejres i læseplugin i writeReadGuard (engine.cjs:180; indlejringen i kildeteksten står i engine.cjs:185).
- desktop/core/approvals-policy.cjs:11 protectedPath: egen liste (.git, secrets, references, præfiks .env, endelse .key og .pem), bruges i :169 og :243. PR: importerer isProtected fra protected-paths.cjs (PR-diffen linje 10).
- desktop/core/command-sandbox.cjs:46 sensitive: egen liste (**/.env, **/.env.*, **/*.key, **/*.pem, **/.git, **/secrets, **/references, **/.ssh, **/.aws, **/.npmrc, **/.pypirc), bruges kun i :49 (denyRead og denyWrite). PR: sensitive erstattes af toSandboxGlobs() (PR-diffen linje 44); listens indhold er ikke verificeret linje for linje.
- desktop/core/changes.cjs:3 OMIT (indeholder også references og .secrets) og :10 regex (filnavne med præfiks .env, endelserne pem, key, p12 og pfx, samt navne med credentials eller secrets). PR: linje 21 fjernes og linje 31 bruger isProtected(entry.name) (PR-diffen linje 22 og 31); OMIT-konstantens nye indhold er ikke verificeret.
- desktop/core/git.cjs:34-36 protectedPath: egen liste (.git, .env, .npmrc, .pypirc, references, secrets, .secrets, node_modules, credentials i stien, pem, key, p12, pfx). Bruges af copies.cjs:20, history.cjs:88, publishing.cjs:86, restoration.cjs:11, deployment-artifact.cjs:27 og project-files.cjs:6. PR: protectedPath kalder isProtected og tilføjer node_modules (PR-diffen linje 128-129).
- desktop/core/project-files.cjs:15-17 isProtected: protectedPath plus regex for .env-filer (linje 16) og secrets-mapper (linje 16). PR: regexerne for .env og secrets fjernes fra denne funktion (PR-diffen linje 139-141) og dækkes af RULES.
- desktop/core/provider-promte.cjs:20-23 SKIP_DIRS (linje 20), SKIP_FILE (linje 21) og ignoredSource (linje 23), samt :63 (kaster fejl for hele eksporten) og :96 (springer over). PR: ignoredSource tilføjer isProtected (PR-diffen linje 210); SKIP-listerne bevares, fordi de er eksportspecifikke.
- Ikke i PR #56, og stadig egen liste: desktop/core/chat-session.cjs:630 projectEdit; desktop/core/copies.cjs:8 OMIT (.secrets) og :62 undtagelse for references; desktop/core/pages-publishing.cjs:79 (package.json, wrangler, functions, api, .github, .env) og :103 (.git, .github, .env, node_modules, .npmrc, .netrc, .ssh, .aws, private).
- Tests: desktop/tests/protected-paths.test.cjs (ny i PR, 127 linjer, PR-diffen linje 214-346); desktop/tests/windows-agent-paths.test.cjs:20 vm-kald, som PR ændrer til createRequire (PR-diffen linje 355).

**Risici:**
- Forskelle i dag, der samles: .p12 og .pfx findes i ændringsoversigten (changes.cjs:10), i Git (git.cjs:35) og i Promte (SKIP_FILE, provider-promte.cjs:21), men ikke i motorens læse- og redigeringsregler (engine.cjs:52-68), i godkendelser (approvals-policy.cjs:11) eller i sandkassen (command-sandbox.cjs:46-49).
- .kube og .azure findes kun i Promte (SKIP_DIRS, provider-promte.cjs:20). .gnupg findes ikke i desktop/core på main. .ssh og .aws findes i sandkassen (command-sandbox.cjs:46) og i Promte, men ikke i motoren.
- .env: godkendelser bruger en præfiksregel (approvals-policy.cjs:11), der også rammer fx .envrc; motoren bruger *.env og *.env.* (engine.cjs:52). Filen production.env rammes af motorens *.env-regel og af filvisning (project-files.cjs:16), ikke af ændringsoversigten, fordi changes.cjs:10 kun rammer filnavne, der starter med .env.
- references: findes i motoren (engine.cjs:52-55, kun læsning), godkendelser (approvals-policy.cjs:11), Git (git.cjs:34-36), sandkassen (command-sandbox.cjs:46) og ændringsoversigten (changes.cjs:3, udeladt via OMIT); ikke i Promte.
- secrets-mapper findes i motoren, godkendelser, Git og filvisning (project-files.cjs:16), men ikke i Promte.
- Afsluttende punktum eller mellemrum: /[. ]$/ findes også i approvals-policy.cjs:23, deployment-artifact.cjs:26, pages-publishing.cjs:102 og provider-promte.cjs:61. Læseplugin bruger replace med /[. ]+$/ (engine.cjs:164). Det er ikke kun i læseplugin.
- Adfærdsændring i PR #56: redigering af alle RULES.credentials og RULES.metadata bliver automatisk 'deny' i stedet for 'ask' (PR-diffen linje 86). Det inkluderer .ssh, .aws, .kube, .azure, .gnupg, .npmrc, .pypirc, *.p12, *.pfx og .aura-private, ikke kun references, secrets, credentials og secrets. Det er ikke besluttet i docs/decisions.md; decisions.md:387 nævner kun .git, .env*, *.key og *.pem for godkendelse pr. opgave.
- Bredere navnematch: *secrets* og *credentials* rammer også almindelige filnavne som secrets-policy.md i læsning, sandkasse og Promte. Det er ny adfærd, ikke en rettelse; venter på beslutning 2.
- Promte-eksport: ignoredSource bruges i provider-promte.cjs:63 til at kaste fejl for hele eksporten. Et projekt med en fil, der rammer en beskyttet regel, bliver dermed afvist helt; venter på beslutning 3.
- .aura-private står i RULES.metadata i PR #56. Der findes ingen forekomst i repoet uden node_modules og .git (grep). Navnet er en forberedelse, ikke en eksisterende beskyttelse; venter på beslutning 4.
- Afvisning af navne med afsluttende punktum eller mellemrum gælder med PR #56 for alle filer, fordi isProtected i protected-paths.cjs kontrollerer invalid; det påvirker også filvisning og ændringsoversigt. Venter på beslutning 5.
- Målet om én kilde rammer en åben modsigelse: copies.cjs:62 undtager references fra beskyttelsen ved kopiering, mens PR #56 gør references til deny i redigering og læsning. Venter på beslutning 7.
- decisions.md:493-496 kræver, at læseregler testes i begge former mod den rigtige OpenCode med og uden Git. Linje 496 hedder 'Det er afprøvet mod den rigtige OpenCode med og uden Git', som påstand om udført arbejde, ikke som krav. PR #56 tester kun permissions()-objektet i enhedstest. Det er rung to, ikke rung tre.
- Kommandosandkassen og læseplugin er ikke kørt native; PR-beskrivelsen siger selv, at Windows- og Linux-prøver mangler.

**Bevidst uden for trinnet:**
- Ingen ændring af filer i denne specifikation; ingen git-skrivekommandoer; ingen sammenfletning eller overtagelse af PR #56.
- Ikke med i trinnet: SKIP_DIRS og SKIP_FILE i provider-promte.cjs (eksportspecifikke, bevares), copies.cjs OMIT (.secrets), Pages-listen i pages-publishing.cjs:79 (venter på beslutning 6), og chat-session.cjs:630 projectEdit (venter på beslutning 6).
- Ikke med i trinnet: nøglering, CLI, udbyderfejl, forhåndsvisningen, Aktivitet-kontrol og sandkassens netadgang (plan trin 4 til 8). Netadgang i sandkassen er et sikkerhedsspørgsmål og følger sin egen liste.
- Ikke kørt: desktop-testsuiten, OpenCode 1.18.33 mod de nye mønstre og native sandkasse på Windows eller Linux.

### 3. Godkendelser og kontraktprøve del 2

**Mål:** Efter trin 3 læser Aura metadata.parentDir fra OpenCodes mappeforespørgsler, så de genkendes i describe og får et mappeforslag på kortet med label Mappeadgang og folder lig den kanoniske parentDir for ikke-brede mapper. Om en sådan mappeadgang må huskes, er ikke besluttet: docs/decisions.md linje 387 siger, at filer uden for projektet spørger hver gang, og det er beslutning 5. Filændringer uden for projektet i Git-layout venter på beslutning 1. Målet er, at Del 2 A er grøn efter rettelsen, og at Del 2 B er grøn, hvis beslutning 5 tillader mappehukommelse.

**Kontrol:** holdt ikke ved sidste kontrol: Holder false. Verificerede citater: approvals-policy.cjs linje 47 (fileTargets), 53-72 (bindTargets), 54 (safe med ? * [ ] { } og ..), 98-100 (candidates-grenen), 101-105 (uændret), 107-111 (broadDirectory), 143 (describe), 165 (Ingen entydig sti), 183-184, 186, 195-196, 199 (catch), 221-227, 231 og

**Afhængigheder:**
- Trin 1 (#58) og trin 2 (#56) skal være på main; ikke verificeret i denne undersøgelse. #56 leverer den fælles liste over beskyttede filstier, som describe bruger i linje 143-205.
- Del 2 A og B skal skrives og fejle før fileTargets-rettelsen, jf. planens låste rækkefølge.
- Del 2 C og filændring uden for projektet i Git-layout venter på beslutning 1.
- Mappehukommelse for parentDir uden for projektet venter på beslutning 5; Del 2 A har forventningen persistable true venter derfor også på beslutning 5. Del 2 B venter på beslutning 5.
- Huskeregler pr. kategori for kommandoer venter på beslutning 3.

**Prøver (ingen er kørt endnu):**
- Del 2 A (fejler i dag, målt i scratchpad-probe, prøven er ikke skrevet endnu): for hver external_directory-forespørgsel med metadata.parentDir i fixturerne skal describe() give label der starter med 'Mappeadgang:', folder lig den kanoniske parentDir for ikke-brede mapper, og persistable true, hvis beslutning 5 tillader mappehukommelse; ellers persistable false. Målt i dag: 46 af 46 top-level-forespørgsler i fixturerne gav label 'Denne handling', persistable false og folder null. De 92 forespørgsler med metadata.parentDir er ikke kørt hver for sig. Årsag: bindTargets afviser mønstret med '*' (linje 54), describe kaster 'Ingen entydig sti.' (linje 165), og catch i linje 199 nulstiller.
- Del 2 B (ikke kørt; kodelæsning viser fejl i dag): grant(scope 'project') på en parentDir-forespørgsel gemmer en mappe-regel, og en ny forespørgsel i samme mappe giver allowed true med source 'rule'. I dag kaster grant 'Denne handling kan kun godkendes én gang.' i linje 238, fordi persistable er false. Afhænger af beslutning 5.
- Del 2 C (ikke kørt; venter på beslutning 1): en filændring uden for projektet i Git-layout med pattern '../ekstern/ny2.txt' og absolut metadata.filepath skal få label 'Filændring:' og persistable true. Fixturen byg-git-filer__write-ude-relativ__2-edit.json findes; ingen probe er kørt mod den. Må ikke skrives før beslutning 1 er truffet.
- Vagt 1 (ikke kørt): en filændring i projektet med pattern 'public/ny2.html' og absolut filepath skal give persistable true og projectFile true. Fixturen byg-git-filer__write-inde-relativ__1-edit.json findes.
- Vagt 2 (ikke kørt): parentDir .git, .env eller en nøglemappe skal give persistable false. Den skal skrives med en mappe, som ellers ville være godkendelig, så vagten kan fejle. Dens nuværende grønhed er ikke undersøgt.
- Plan-tilstand (ikke kørt; kodelæsning): blockedMode i linje 195-196 fanger kun edit og bash eller skrivende værktøjer. En parentDir-forespørgsel i Planlæg med et læseværktøj blokeres derfor ikke af linjen i dag. Del 2 skal også dække build og plan, og resultatet skal være persistable false i plan, hvis beslutning 5 tillader mappehukommelse i build.
- Eksisterende (kørt i denne undersøgelse): node --test tests/opencode-contract.test.cjs i desktop gav 16 af 16 grønne. Ikke kørt: approvals-policy.test.cjs, approvals.test.cjs og npm test. Helperen folder() i approvals-policy.test.cjs linje 18-20 bruger metadata {} og er ikke motorens form; den må ikke ændres for at få del 2 grøn.
- Fixturetælling (JSON-tælling i scratchpad, kørt): 92 forespørgsler med metadata.parentDir, alle external_directory, ford818 i 46 filer. Ikke kørt: 18 kommandoer med metadata.directories og 15 af 56 filændringer med '..' i patterns.

**Filer (citater ikke fuldt verificeret):**
- desktop/tests/opencode-contract.test.cjs: nye test-blokke efter linje 317, som er filens sidste linje. Helperen filler() linje 29-40 er den eksisterende pladsholderhelper. Del 2 skal tilføje en ny helper, der bygger et midlertidigt træ med realpath og t.after-oprydning og en in-memory store-stub; Del 2 rører dermed filsystemet, i modsætning til del 1.
- desktop/core/approvals-policy.cjs fileTargets (linje 47-106): ny gren før linje 98, fordi candidates i linje 48 allerede indeholder metadata.filepath og derfor rammer bindTargets i linje 98-100. Gren for external_directory med metadata.parentDir: parentDir bruges som måldirectory, kun når patterns er præcis [parentDir + '/*'] og filepath er parentDir eller ligger under parentDir. Linje 101-105 ændres ikke for andre former.
- desktop/core/approvals-policy.cjs bindTargets (linje 53-72) og safe (linje 54): i dag afviser safe patterns med '*' og '..', så bindTargets returnerer []. Undtagelsen fra safe må kun gælde den præcise form [parentDir + '/*']. For filændringer uden for projektet i Git-layout kræves beslutning 1 før rettelsen.
- desktop/core/approvals-policy.cjs describe (linje 143-205), grant (linje 231-253), folder-forslag (linje 183-184), persistable (linje 186), blockedMode (linje 195-196), folder-regelmatch (linje 221-227) og folder-grant (linje 240-246) ændres ikke, men Del 2 bruger dem. broadDirectory (linje 107-111) ændres heller ikke.

**Risici:**
- Åbner for mappeadgang: en husket parentDir-regel dækker alle mapper under den, så subtree-valget (beslutning 2) afgør omfanget. Broad-mapper (rod, hjem, tmp, opencode) er udelukket i broadDirectory (linje 107-111) og skal forblive udelukket.
- Konflikt med docs/decisions.md linje 387 under overskriften Første resultat uden spørgsmål (linje 372): der står, at kommandoer, web og filer uden for projektet spørger hver gang. Specifikationens husbare mappeadgang uden for projektet er ny adfærd i strid med dette, og konflikten er ikke markeret i planen. Den skal afklares i beslutning 5, før Del 2 A og B skrives som grønne krav.
- Plan- og Samtale-tilstand: blockedMode (linje 195-196) dækker ikke alle læseformer i Planlæg; se prøven om plan-tilstand. Dette er en ikke-målt risiko, der skal dækkes af Del 2.
- Del 2 skriver til os.tmpdir. Den skal rydde op med t.after og må ikke røre repoet.
- Windows: store/små bogstaver og drevbogstaver i parentDir er ikke prøvet. Windows er uprøvet. Del 2 kører kun på macOS.
- Del 2 fejler til trin 3 er rettet, og det gør npm test rødt. Det er forventet; kør den enkelte fil ved tjek. npm test er ikke kørt i denne undersøgelse.
- Den eksisterende approvals-policy-testhelper bruger en form, motoren ikke sender. Den må ikke erstattes i samme trin uden at være dækket af del 2.

**Bevidst uden for trinnet:**
- Korttekster og titler (årsag 2, retning punkt 3, ui/approvals.js). Eget trin.
- AI'ens arbejdsmappe i .aura/tmp (trin 4) og læsebeskyttelse af opencode.db.
- Sandkassen, 'Godkend alt' og kommandoregler (trin 6, årsag 9).
- Ny optagelse eller ændring af fixtures, README og VERSION. Del 1 er uændret.
- Ændring af docs/decisions.md, herunder linje 387 og den konflikt, beslutning 5 beskriver. Det skrives, når adfærden er bygget og beslutning 5 er truffet.
- Grænsen for antal kort (nr. 13) og ende-til-ende-prøven.
- Gateway, prompt og kopier.

### 4. AI-filer holdes i projektet

**Mål:** Efter trinnet skriver AI'ens arbejdsfiler i den mappe, som beslutning 1 og 2 fastlægger (forslag: <arbejdsmappe>/.aura/tmp/<opgave-id>), og AI'ens kommandoer får samme mappe som TMPDIR, TEMP og TMP. Systemprompten nævner ingen absolut appdata-sti. Venter på beslutning 5: en skrivning uden for projektet i Byg afvises med en besked til AI'en uden godkendelseskort. Venter på beslutning 6: kortene siger 'Må AI’en skrive …' ved skrivning og 'Må AI’en se …' ved læsning.

**Kontrol:** holdt ikke ved sidste kontrol: Holder nej. Verificeret ved læsning: tre tilfældige citater er korrekte: desktop/core/chat-session.cjs:428 (Midlertidige hjælpefiler-sætningen); desktop/core/approvals-policy.cjs:185 (label bygget ud fra kind); desktop/core/command-sandbox.cjs:47 (TMPDIR). Også korrekte: chat-session.cjs:379, :392, 

**Afhængigheder:**
- Trin 3 (godkendelserne læser metadata.parentDir og filepath) står før trin 4 i planens rækkefølge. Kode: fileTargets i approvals-policy.cjs:47-48 læser metadata.filepath, metadata.filePath, toolInput.filePath og toolInput.filepath; parentDir findes ikke i desktop/core eller desktop/ui (verificeret med grep). Uden trin 3 kan afvisningen i Byg ramme den forkerte form.
- Trin 2 (#56, én liste over beskyttede stier): planen beskriver #56 som en fælles liste, men at protectedPath i approvals-policy.cjs:11 skal dække .aura/tmp er en antagelse, der afhænger af beslutning 3.
- Venter på beslutning 1 og 2: sti og opgavevalg (kopi eller projektmappe; pr. opgave eller fast mappe pr. samtale eller projekt). Alle sti-dele i maal, filer og prøver afhænger af dem.
- Venter på beslutning 3: udelukkelse af .aura/tmp fra Git, Ændringer, kopier og versioner.
- Venter på beslutning 5: Byg-afvisningen uden kort og prøven for den.
- Venter på beslutning 6: korttitlerne og afvisningens ordlyd.

**Prøver (ingen er kørt endnu):**
- approvals-policy.test.cjs (ny, venter på beslutning 5): i mode 'build' afvises en filændring uden for arbejdsområdet med en besked og uden kort. Ikke kørt. Forventes at fejle i dag, fordi describe og allowed (approvals-policy.cjs:145-196 og :206-210) ikke returnerer et besked-felt.
- approvals-policy.test.cjs eller approvals.test.cjs (ny, venter på beslutning 6): skrivning via external_directory med toolInput.tool 'write' eller 'edit' giver en titel med 'skrive', og læsning giver 'se'. Ikke kørt. Forventes at fejle i dag, fordi approvals.js:24 kun har 'Må AI’en se en mappe uden for projektet?' og approvals-policy.cjs:185 bygger labelen ud fra kind alene.
- Adfærdsprøve for isolatedEnv (fil valgt ved implementering, fx engine-start.test.cjs, som findes): kald isolatedEnv med scratchRoot og med TEMP, TMP og TMPDIR sat til andre værdier i process.env; alle tre skal være lig scratchRoot. Ikke kørt. Forventes at fejle i dag, fordi engine.cjs:93-95 kopierer process.env og ingen scratchRoot-option findes. Erstatter den API-prøve, der kun ville fejle, fordi parameteren mangler.
- Prøve for systemprompten (fil: desktop/tests/app-context.test.cjs, :52-53 opdateres): systemprompten indeholder ingen absolut sti under bench.store.root og indeholder den relative .aura/tmp-sti. Ikke kørt. Forventes at fejle i dag, fordi chat-session.cjs:428 indsætter JSON.stringify(this.scratchRoot), og scratchRoot ligger under bench.store.root (:379).
- Prøve af den faktiske sti (ny, ikke kørt): ved at køre sendPrepared med de stubbede motorer i app-context.test.cjs skal motorens scratchRoot ligge i <projektmappe>/.aura/tmp/<opgave>. Den bruger den rigtige kode og ikke kun fixturen i approvals-policy.test.cjs, som kun beviser, at en sti i projektet giver source 'scratch'. Forventes at fejle i dag, fordi :379 lægger scratch under bench.store.root.
- Regressionsvagt i approvals-policy.test.cjs (ny, ikke kørt): filer i <root>/.aura/tmp/<opgave> giver source 'scratch' med fixturen. Forventes at passe i dag, fordi scratch-tjekket på :177-179 og :210 er path-baserede. Prøven alene beviser ikke placeringen; det gør prøven ovenfor.
- Eksisterende prøver approvals-policy.test.cjs:148-168 skal forblive grønne. Prøven på :58 ændres kun for Byg-skrivning, og det angives i ændringen (venter på beslutning 5).
- Ende-til-ende (ikke kørt, rung 3): en byggeopgave skriver .aura/tmp/<opgave>/test.txt og får ingen godkendelseskort. Kræver kørsel mod den rigtige Aura og OpenCode 1.18.33 (verificeret: engine.cjs:10 VERSION) med en falsk lokal model.
- Venter på beslutning 3: prøver i change-review.test.cjs, git.test.cjs og copies.test.cjs skal vise, at .aura/tmp udelukkes fra Ændringer, Git og kopier. Filerne er ikke læst og ikke kørt.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/chat-session.cjs:379-380 (sendPrepared, funktionen starter på :330, verificeret): this.scratchRoot flyttes fra bench.store.root/scratch/<projectKey>/<taskId> til den mappe, som beslutning 1 og 2 fastlægger (forslag: <this.root>/.aura/tmp/<taskId>). mkdir med mode 0o700 beholdes. Samme værdi bruges af kommandoisolationen på :394 og af approvalContext på :633 (verificeret).
- desktop/core/chat-session.cjs:408 (bench.engineFactory-kaldet, verificeret): scratchRoot skal med som ny option, så motoren kan give den videre til isolatedEnv. Kaldet stod ikke i den tidligere fillise.
- desktop/core/engine.cjs:191 (konstruktøren, verificeret): scratchRoot tilføjes til parameterlisten og til Object.assign, så instansen har den.
- desktop/core/engine.cjs:228 (isolatedEnv-kaldet i start, verificeret): scratchRoot videregives, så kaldet bliver isolatedEnv(this.directory, this.config, password, { commandIsolation: Boolean(this.sandbox), scratchRoot: this.scratchRoot }).
- desktop/core/engine.cjs:93-95 (isolatedEnv, verificeret): får en scratchRoot-option og sætter TEMP, TMP og TMPDIR til den i stedet for at kopiere dem fra process.env på :95. Funktionen eksporteres på :370 (verificeret).
- desktop/core/chat-session.cjs:428 (verificeret): sætningen 'Midlertidige hjælpefiler til denne opgave kan ligge i ' + JSON.stringify(this.scratchRoot) indsætter i dag den absolutte appdata-sti. Den erstattes af den relative sti .aura/tmp/<opgave> uden absolut sti; den nøjagtige placering afhænger af beslutning 1. Sætningen findes kun her og i desktop/tests/app-context.test.cjs:52-53 (verificeret). Den findes ikke i profiles/grundregler.md, core/project-guidance.cjs eller core/engine.cjs (verificeret ved grep). Mappen desktop/profiles findes ikke; grundregler ligger i profiles/ i repoets rod.
- desktop/tests/app-context.test.cjs:52-53 (verificeret): prøven assert.match på 'Midlertidige hjælpefiler' og prøven, der kræver at sætningen ikke er i de gennemgåede fragmenter, skal opdateres til den nye sætning. Det er en eksisterende prøve, der ændres.
- desktop/core/chat-session.cjs:33 og :36 (CONTEXT_SCOPE, verificeret): omtalen af den midlertidige mappe opdateres til den nye placering.
- desktop/core/approvals-policy.cjs:145-196 (describe, verificeret): for kind 'edit' uden projectFile i en skrivbar mode (writable er defineret på :12, verificeret) skal der returneres en afvisning med besked i stedet for et kort. Feltet er nyt og findes ikke i dag; grep efter message i filen giver ingen treff. Venter på beslutning 5 og 6.
- desktop/core/approvals-policy.cjs:185 (verificeret): labelen bygges kun ud fra kind ('Filændring', 'Mappeadgang' eller 'Læsning'). Skelnen mellem write, edit og apply_patch via p.toolInput?.tool findes i dag kun i blockedMode-tjekket på :195 og skal indføres i labelen som ny adfærd. Venter på beslutning 6.
- desktop/core/approvals-policy.cjs:177-179 og allowed() :206-210 (verificeret): scratch-tjekket og den automatiske scratch-tilladelse på :210 er path-baserede og ændres ikke af placeringen alene; de skal bekræftes mod den nye placering i prøverne.
- desktop/ui/approvals.js:21 (edit-titler, verificeret) og :24 (external_directory-titel, verificeret): ny titel for skrivning til en mappe uden for projektet, og den nuværende 'Må AI’en se en mappe uden for projektet?' bliver til læsning. Ordlyden er beslutning 6.
- desktop/core/command-sandbox.cjs:38 og :47 (verificeret): TMPDIR afledes af scratchRoot (temp = scratch/tmp på :38, TMPDIR på :47) og følger med. allowWrite på :49 (verificeret) rammer nu projektets .aura/tmp. Ingen kodeændring forventes; bekræftes i command-sandbox.test.cjs (findes, ikke læst).
- desktop/tests/approvals-policy.test.cjs: fixturen på :13-16 (verificeret) bevares; ny fixture-variant med scratch i <root>/.aura/tmp/<opgave>; nye prøver for Byg-afvisning og korttitler. Prøven på :58 (verificeret: allowed false for en skrivning uden for projektet i build) ændres kun for Byg-skrivning, og det angives i ændringen. Venter på beslutning 5.
- desktop/tests/approvals-policy.test.cjs:148-168 (verificeret: prøverne på :148 og :155) bevares.
- Venter på beslutning 3: desktop/core/git.cjs:35 (protectedPath-regex, verificeret), desktop/core/changes.cjs:3 (OMIT-sæt, verificeret), desktop/core/copies.cjs:8 (OMIT-sæt, verificeret) og desktop/core/pages-publishing.cjs:103 (udgivelsesfilter, verificeret) skal få .aura/tmp, hvis beslutning 3 siger ja. Tests change-review.test.cjs, git.test.cjs og copies.test.cjs findes, men er ikke læst.

**Risici:**
- Motoren genbruges mellem opgaver. chat-session.cjs:392 genstarter, når engineIdentity ændres, motoren ikke er aktiv, eller prepared.commandIsolation er sat (verificeret; ikke kun ved ændret identitet). Uden kommandoisolation genbruges motoren, og TMPDIR sættes ved start i engine.cjs:228 via isolatedEnv. Et opgave-id i stien låser derfor TMPDIR til den første opgave i den motor, når kommandoisolation er slået fra. Se beslutning 2.
- Filer i projektmappen ender i Ændringer, Git-status, kopier og udgivelser, medmindre .aura/tmp udelukkes. changes.cjs:3 og copies.cjs:8 har OMIT-sæt uden .aura; git.cjs:35 har en protectedPath-regex uden .aura; pages-publishing.cjs:103 har et udgivelsesfilter uden .aura (verificeret). Det rører change-review.test.cjs, git.test.cjs og copies.test.cjs, som ikke er læst. Se beslutning 3.
- Nægtelse i Byg ændrer en besluttet adfærd: decisions.md:387 siger, at kommandoer, web og filer uden for projektet spørger hver gang, og decisions.md:474 opregner godkendelse af filer uden for projektet blandt det, der er slået til (verificeret). Beslutningsloggen skal opdateres, når beslutning 5 er truffet.
- Hvordan en afvist forespørgsel sendes tilbage til OpenCode med en besked, er ikke undersøgt. Det skal verificeres, før afvisningen bygges.
- Årsagsdokumentets linjenumre er forældede. docs/hackathon-aarsager.md:101 og :278 nævner chat-session.cjs:286 og :332; i dag ligger sendPrepared på :330 og scratch-linjen på :379-428 (verificeret). Årsagsdokumentets engine.cjs-henvisninger til grep: 'ask' ligger nu på engine.cjs:66 og :70 (verificeret).
- .aura/tmp må ikke kollidere med .aura/publishing, som er versionsstyret (deployment-configuration.cjs:10, verificeret).
- Sandkassen tillader skrivning i root og scratch (command-sandbox.cjs:49, verificeret). Med scratch i projektet ændres sikkerhedsgrænsen ikke, men det skal bekræftes i command-sandbox.test.cjs (findes, ikke læst).
- Eksisterende scratch-mapper i appdata ryddes ikke i dette trin og bliver liggende.

**Bevidst uden for trinnet:**
- Oprydning af eksisterende appdata-scratch-mapper og migration af gamle mapper.
- Flytning af OpenCodes data, tool-output, npm-cache og skills til projektet, og læsebeskyttelse af opencode.db (engine.cjs:41 og :152-155).
- Ryd op efter hver opgave og ved start, og nøgling af projektdata på id i harness.json.
- Godkendelsesmodellen i øvrigt, herunder søgekortet og Stop, som hører til trin 1.
- Genkendelse af parentDir og filepath, som hører til trin 3 og er en forudsætning, ikke en del af dette trin.
- Kommandosandkassens omlægning (trin 6), npm-cache og Windows-løsningen.

### 5. Udbyderfejl stopper ikke opgaven

**Mål:** Efter trin 5 videresender gatewayen 408, 429 og 5xx til OpenCode med status, fejltekst og Retry-After, uden at låse forbindelsen og uden at kalde onFailure. 401, 402, 403 og 404 forbliver endelige og låser forbindelsen som i dag. Afbrudt strøm og stilstand er uændret. Målet forudsætter, at OpenCode genforsøger (pass-through). Det venter på beslutning 1, fordi docs/decisions.md:698 og årsagsdokumentet docs/hackathon-aarsager.md:193 peger i hver sin retning; hvis Aura i stedet genforsøger, ændres målet. Antal forsøg, pauser og loft for Retry-After venter på beslutning 2.

**Kontrol:** holdt ikke ved sidste kontrol: Holder er false. Fejl 1: idle-vagten og "Vent" og "Stop og prøv igen" står i docs/hackathon-aarsager.md på linje 195, ikke linje 16. Linje 192 er overskriften Retning, og linje 195 er punktet om vagten. Fejlen står i både udenfor-punktet og rettelse-punktet om udenfor. Fejl 2: proever 1 (429) og pro

**Afhængigheder:**
- Ingen afhængighed af trin 1-4 for gatewayen. PR #58 (trin 1) ændrer ikke desktop/core/gateway.cjs (verificeret med gh pr diff 1. nov.: filer chat-session.cjs, engine-events.cjs, engine.cjs, tests og ui/app.js), så #58 løser ikke trin 5.
- Trin 5 ændrer ikke chat-session.cjs. #58 ændrer chat-session.cjs (retirePlan('fejl') og retirePlan('stoppet') kun uden for Byg) og ui/app.js (planRetained). Der er derfor ingen filkonflikt mellem trin 5 og #58; planens tilbagetrækning ligger i chat-session.cjs:708 og er et andet problem end gatewayen.

**Prøver (ingen er kørt endnu):**
- Ny prøve i desktop/tests/gateway-recovery.test.cjs: 429 med Retry-After 1 første gang, derefter 200 SSE. Påstand: første svar har status 429 og headeren retry-after 1; andet kald får status 200, og onFailure kaldes ikke. Fejler i dag: ja. Set med probe (scratchpad/trin5/probe.cjs, kørt 1. nov. med Node 22 fra desktop/.runtime): kald 1 = 429, retry-after = null, kald 2 = 409, onFailure-kald = 1 med kind limit. Output: scratchpad/spec/kritik-5-probe-kørsel.txt.
- Ny prøve, 503 første gang, derefter 200. Påstand: kald 2 får status 200, og onFailure kaldes ikke. Fejler i dag: ja. Set med probe: kald 2 = 409, onFailure-kald = 1 med kind server. Testen kan kun observere onFailure, ikke engine.error.
- Ny prøve, 408 første gang, derefter 200. Påstand: kald 2 får status 200, og onFailure kaldes ikke. Fejler i dag: ikke kørt; forventes at fejle af samme grund som 429 og 503.
- Ny prøve, 500 eller 429 hver gang. Påstand: hvert kald videresendes med samme status, og onFailure kaldes ikke. Denne prøve afhænger af beslutning 1 og er ikke kørt. Fejler i dag: ikke kørt; probe viser kun, at kald 2 får 409 efter første 429.
- Nye prøver for 402, 403 og 404 (ét fejlsvar og derefter ét kald): Påstand: kald 2 får 409, og onFailure kaldes én gang med kind quota, access og notfound. Fejler i dag: ikke kørt; forventes at bestå i dag, fordi adfærden er uændret, og skal bestå også efter trin 5.
- Eksisterende scenarie key (401 og efterfølgende 409) og scenarie stop (gateway.abort() giver ingen onFailure-kald) i den ene test i gateway-recovery.test.cjs: kørt 1. nov. med Node 22, 1 test og 0 fejl. Skal fortsat bestå. Dækker ikke 429, 408 eller 503.
- Ende-til-ende-prøve mod OpenCode 1.18.33-fixtures i desktop/tests/fixtures/opencode-1.18.33/: én 429, derefter 200, opgaven gennemføres med session.idle og uden engine.error. Fejler i dag: ikke kørt. Målt i årsagsdokumentet (docs/hackathon-aarsager.md:187): Aura stoppede efter 4,1 s, og kun ét kald nåede frem. Prøven er den eneste, der viser at OpenCode genforsøger, og den skal være kørt, før trin 5 markeres færdigt.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/gateway.cjs:60-66 (grenen if (!response.ok) i startGateway): for 408, 429 og status 500 eller højere må fail() på :65 ikke kaldes; status, fejltekst (:62-63) og svar (:66) sendes videre. I dag sætter :66 kun content-type. Retry-After skal kopieres fra det 429-svar, der har headeren, til svaret gatewayen sender videre. Der findes ingen retry-kode i gateway.cjs i dag, og Retry-After har intet loft.
- desktop/core/gateway.cjs:64 er kind-mapping (429 giver limit, 5xx giver server) og :65 er selve fail-kaldet. I trin 5 skal fail-kaldet udelades for 408, 429 og 5xx; 401, 402, 403 og 404 beholder fail-kaldet.
- desktop/core/gateway.cjs:16 (fail) og :20 (409) er uændret. fail() låser nye kald med 409 og kalder onFailure, som chat-session.cjs:397-398 sender som engine.error.
- desktop/core/gateway.cjs:73-79 (catch, afbrudt strøm og stilstand) er uændret i trin 5, fordi det ikke er et udbyderfejlsvar.
- desktop/core/chat-session.cjs er ikke ændret i trin 5. sessionFailure (:56-60) og runFailure (:685-686) afleder kind, når gatewayen ikke kalder onFailure, og så kommer fejlen fra OpenCodes session.error. Det er uafklaret, om OpenCodes fejlobjekt har data.statusCode.
- desktop/tests/gateway-recovery.test.cjs: den eksisterende test (linje 5-16) har tre scenarier i en løkke (key, stream, stop; løkken står på linje 9-15). Ny test eller nye scenarier for 429 med Retry-After, 408, 503, 402, 403 og 404. Det eksisterende scenarie key og stop ændres ikke.

**Risici:**
- Pass-through gør, at OpenCodes genforsøg tæller med i forbrug og pris, jf. docs/decisions.md:698. Pris- og forbrugsvisningen skal vise de ekstra kald, ellers ser brugeren dem ikke.
- Retry-After har i dag intet loft. Et langt Retry-After kan holde opgaven i Arbejder i lang tid; det er ikke afgrænset i koden.
- Fjernes låsen for 5xx, og OpenCode ikke genforsøger ved 5xx, ender opgaven i session.error uden gateway-låsning. Det er uafklaret og skal måles.
- Planen forsvinder stadig i Planlæg ved alle fejl: chat-session.cjs:708 kalder retirePlan('fejl') i alle arbejdsmåder, og #58 ændrer det kun for Byg. app.js:955 og :960 nulstiller v.plan og activePlan. Trin 5 fjerner kun årsagen til forbigående udbyderfejl og løser ikke planen.
- PR #58 (ai-alliancen-org/ai-harness, OPEN, CONFLICTING) ændrer ikke gateway.cjs. Diffen viser ingen ændring af retirePlan('ny') i chat-session.cjs:365. #58 løser planen i Byg, men ikke i Planlæg.
- Årsagsdokumentet docs/hackathon-aarsager.md:187 peger på chat-session.cjs:304-305 og :594-598. De linjer er i dag composeAppContext (:304-305) og undoTask (:594-598), ikke fejlhåndteringen. De relevante linjer er chat-session.cjs:397-398 (engine.error), :685-686 (runFailure) og :708 (retirePlan fejl). gateway.cjs:64 er kind-mapping, og selve fail-kaldet er :65. Bevisbulletens gateway-linjer :16, :20 og :63 passer med den nuværende fil, dog er :63 kun fejlteksten.
- Modstrid: docs/decisions.md:698 (afsnit fra 25. oktober 2026, Bidrag fra Parthee Vijayamohan) siger, at gatewayen ikke længere låser ved 408, 429 og 5xx, så OpenCodes genforsøg kommer igennem. Koden gør det ikke endnu (gateway.cjs:65). Årsagsdokumentet (docs/hackathon-aarsager.md:193) foreslår derimod, at Aura selv genforsøger med stigende pause og respekterer Retry-After. Det er to forskellige modeller; se beslutning 1.

**Bevidst uden for trinnet:**
- Idle-vagten med Vent og Stop og prøv igen, den synlige stilstandsbesked og den samlede tidsgrænse (docs/hackathon-aarsager.md årsag 5, retning 3, linje 16). Retning 2 på linje 15 handler om planen, ikke om vagten.
- Motorstartens forklaring og tekst: desktop/core/engine.cjs:40 (forklaringen) og :251 (30 sekunder og fejlteksten Agentmotoren kunne ikke starte). Versionskontrollen står i cli/runtime.cjs:26 (roden af repoet, ikke desktop/cli).
- Visning af udbyderens fejltekst under Se detaljer (årsag 10, afsnit 10 i årsagsdokumentet).
- Ændringer i ui/app.js og den plan-bevarelse, PR #58 allerede gør for Byg.
- Ændring af docs/decisions.md. Det sker først, når brugeren har besluttet modellen.
- Ændring af det eksisterende scenarie key og stop i gateway-recovery.test.cjs.

### 6. Kommandosandkasse og Godkend alt

**Mål:** Når trin 6 er færdigt, huskes en 'Tillad altid'-kommando som netop den kommando i netop den mappe, den blev godkendt i; nøglens omfang (præcis kommando eller kategori) venter på beslutning 5, og den nuværende kode matcher præcis kommando og cwd (approvals-policy.cjs:155-157). En husket kommando tænder ikke sandkassen for alle senere kommandoer i projektet; det venter på beslutning 2. Motoren genstartes ikke ved hver besked; det afhænger af trin 1 (#58). 'Godkend alt' findes som et udtrykkeligt, dansk og advaret valg under Flere valg, og gælder kun den samtale, der valgte det (decisions.md:722, pr. samtale). Navn og ordlyd venter på beslutning 3. Om valget vises uden kommandosandkasse, og om det må dække handlinger uden for projektmappen, venter på beslutning 4 og 8.

**Kontrol:** holdt ikke ved sidste kontrol: Holder er false. Fund: (1) maal siger, at den nuværende kode matcher præcis kommando og cwd (approvals-policy.cjs:155-157). Det er ufuldstændigt: match i :155 er {kind, command, cwd, input: stable(toolInput.input)}, så input indgår i nøglen. Teksten skal rettes. (2) maal og P8 præsenterer 'Godkend a

**Afhængigheder:**
- Trin 1 (#58): genstart og planbevarelse i chat-session.cjs ved :392; overlapper med P4 og skal skrives sammen med den prøve.
- Trin 2 (#56): én liste over beskyttede stier, som bruges af sandkassens denyRead (command-sandbox.cjs:49) og af godkendelsen.
- Trin 3: godkendelsesmodellen skal læse metadata.parentDir og filepath, og kontraktprøvens del 2 skal være skrevet og fejle før trin 6 (docs/plan-hackathon-aarsager.md:33 og :44). Kontraktprøvens del 2 er ikke defineret i denne spec, og den nye godkendelsesmodel er ikke beskrevet her; P8-P10 kan ikke færdiggøres før trin 3 er gennemført.
- Trin 4: TMPDIR, TEMP og TMP peger på .aura/tmp (docs/plan-hackathon-aarsager.md:34), og command-sandbox.cjs:47 skal følge samme mappe, før nøglen bliver stabil.
- Beslutning 2 og 8 skal være truffet, før sandkassens gating og genstart kan ændres. Beslutning 1 skal være truffet, før netadgang og tests i command-sandbox.test.cjs:36 og :56-62 ændres.

**Prøver (ingen er kørt endnu):**
- P1 Samme kommando i to opgaver i samme projekt, hvor kun opgavens id i den omskrevne command-sti er forskelligt, matcher den gemte regel. Ikke kørt. Fejlkilden er command (chat-session.cjs:394 og command-sandbox.cjs:56-57), ikke alene input. Prøven skal først bekræfte, hvilket felt describe() modtager (approvals-policy.cjs:151-155), og varierer indpakningens sti. Målt: hackathon-aarsager.md:305 (kørt) viser 0 automatiske godkendelser i 6 forsøg med regler gemt med tomt input; hackathon-aarsager.md:297 er ikke markeret målt.
- P2 En regel gemt med Tillad altid for kommando X ændrer ikke, om kommando Y i samme projekt spørges igen. Ikke kørt. Delvist dækket af approvals-policy.test.cjs:69 (andre kommandoer matcher ikke) og allowed() :220 med præcis lighed. Skal være en vagt, der består før og efter trin 6.
- P3 Efter en husket bash-regel starter en ny opgave i samme projekt ikke kommandosandkassen, medmindre Byg og kontrollér automatisk eller Godkend alt er valgt. Ikke kørt. Kode-læst: chat-session.cjs:228 tænder commandIsolation, når en bash-regel findes. Gyldig kun, når beslutning 2 er truffet som adskilt; venter på beslutning 2.
- P4 To på hinanden følgende beskeder i samme tilstand med aktiv sandkasse genstarter ikke motoren. Ikke kørt. Kode-læst: chat-session.cjs:392 har '|| prepared.commandIsolation', så motoren lukkes ved hver besked. Overlap med trin 1 (#58); prøven skrives sammen med den.
- P5 Samme kommando før og efter sandkassen tændes giver samme regelnøgle, fordi nøglen bruger den oprindelige kommando og ikke sandkasse-indpakningen. Ikke kørt. Målt: hackathon-aarsager.md:305 (kørt) viser, at indpakningerne fra to opgaver adskiller sig fra tegn 404; kommandoen omskrives i command-sandbox.cjs:57. hackathon-aarsager.md:296 er en påstand om cirka 2.400 tegn og ikke markeret målt; de målte 2.442-2.449 tegn står i :304.
- P6 Et Node-program kan lytte på 127.0.0.1 i sandkassen, og en kommando kan nå en projektport på localhost. Målt: listen EPERM 127.0.0.1:5199 (hackathon-aarsager.md:303, kørt), med allowLocalBinding false (command-sandbox.cjs:48). Afhænger af beslutning 1; den ønskede adfærd er ikke besluttet, så prøven kan ikke skrives som krav før beslutning 1.
- P7 git status i projektmappen lykkes i sandkassen. Ikke kørt; kan ikke påstås som målt. hackathon-aarsager.md:303 (kørt) måler kun git --version med exit 1 og en xcode-select-fejl, ikke læsning af .git. Mål først med en git-kommando, der ikke læser .git, og derefter git status, før prøven står som påstand. Afhænger af beslutning 9.
- P8 'Godkend alt' findes som valg under Flere valg, kun når kommandosandkassen er aktiv, med dansk advarsel. Fejler i dag: teksten findes ikke i desktop/ (grep, kørt), og approvals.js tilbyder kun Tillad én gang, Tillad altid i projektet og Afvis (:123). Gating afhænger af beslutning 8; navn af beslutning 3.
- P9 'Godkend alt' i samtale A gør ikke kommandoer i samtale B automatiske, og efter genstart af appen spørges igen. Fejler i dag, da funktionen mangler (grep, kørt). Bygges pr. samtale efter decisions.md:722.
- P10 'Godkend alt' dækker handlinger uden for projektmappen, fx en mappeadgang, men kun i den samtale, der valgte det. Fejler i dag, da funktionen mangler (grep, kørt). Venter på beslutning 4. Indtil beslutning 4 er skrevet ned, står prøven i modstrid med decisions.md:387, som siger, at kommandoer, web og filer uden for projektet spørger hver gang.
- P11 Windows får ikke Tillad altid for kommandoer og ikke Godkend alt. Tillad altid består i dag ved kodelæsning: approvals-policy.cjs:157 og approvals-policy.test.cjs:88. Ikke kørt. Godkend alt fejler i dag, da den mangler.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/approvals-policy.cjs describe() :143-157: descriptor oprettes i :145 med label 'Denne handling'; kommando-match i :155 er {kind, command, cwd, input: stable(toolInput.input)}; persistable i :157 kræver writable(mode) og commandSandboxSupported. Ændres: nøglen må ikke afhænge af opgavens id i policy-stien. Det felt, der faktisk indeholder id'et, er command, fordi chat-session.cjs:394 sætter policy-mappen til task.id plus -policy, og command-sandbox.cjs:56 indsætter policyPath i præfikset. input er ikke bevist som årsag. Den oprindelige kommando kan gendannes fra base64url-payloaden i den omskrevne kommando (command-sandbox.cjs:57); hvordan det gøres, er et implementeringsvalg, ikke truffet.
- desktop/core/approvals-policy.cjs allowed() :209 og :215-218: kommando kræver commandSandbox === true (:209); autoCommands-snapshot tillader kommandoer under arbejdsområde og scratch (:215-218). Ændres efter beslutning 2. 'Godkend alt' tilføjes som scope pr. samtale på samme mønster som taskRules (:211 og grant :235-236), ikke som projektregel. Gating efter beslutning 8.
- desktop/core/approvals-policy.cjs allowed() :220 og grant() :238 og :249: regel-match er digest af match med præcis lighed (:220); gem sker i :249 (const rule = { id: digest(match) ... }). Ændres: en prøve skal vise, at 'npm install x' ikke matcher 'npm install y'. Regel-label viser allerede hele kommandoen (:156, 'Kommando: ' plus command); ingen ændring der.
- desktop/core/chat-session.cjs :223-228: commandIsolation sættes i :228 til commandSupport.available og (autoCommandsSnapshot eller en bash-regel i projektet). Ændres efter beslutning 2: en husket kommando må ikke alene tænde sandkassen for projektets øvrige opgaver.
- desktop/core/chat-session.cjs :392 og :394: motoren lukkes og sandkassen forberedes ved hver besked, fordi :392 har '|| prepared.commandIsolation'. Ændres: genstart kun ved ændret motoridentitet (decisions.md:697 og trin 1 med #58). Overlap med P4.
- desktop/core/chat-session.cjs approvalContext() :633: tilføj scope for 'Godkend alt' i hukommelsen pr. samtale, på samme måde som taskRules (sat i :92 og :360, nulstillet i :737 og :746). Ikke i projektets approvals.
- desktop/core/chat-session.cjs :429: systemprompten nævner netadgang til de tre pakkehosts. Skal opdateres i takt med beslutning 1.
- desktop/core/command-sandbox.cjs :9 og :48: PACKAGE_HOSTS er netallowlisten (registry.npmjs.org, pypi.org, files.pythonhosted.org), og allowLocalBinding er false i :48. Ændres kun efter beslutning 1.
- desktop/core/command-sandbox.cjs :22-23 og :41-43: support() returnerer available false på Windows (:23). systemRead for darwin i :42 indeholder ikke /Library/Developer/CommandLineTools. Tilføjelse af den sti er ikke en del af trin 6, før beslutning 9 er truffet og P7 er målt.
- desktop/core/command-sandbox.cjs :46-49 og :56-57: sensitive-listen i :46 (inkl. **/.git), denyRead i :49, exec-præfiks i :56 og before-hook i :57, der omskriver bash-kommandoer. Ændres: den oprindelige kommando gemmes i approvals, så nøglen ikke ændrer sig, når sandkassen tændes. Ændring af .git-læsning følger først af P7.
- desktop/ui/approvals.js :123 (choices-listen), :142 (hint om gemt tilladelse) og :144 (knappen Flere valg): tilføj 'Godkend alt' med advarsel i almindeligt dansk under Flere valg, og skjul den, når sandkassen ikke er aktiv (beslutning 8). Navn og ordlyd venter på beslutning 3. Der mangler et descriptor-felt, der fortæller UI'et om sandkassestatus; feltnavn er ikke fastlagt, forslaget er commandSandbox i descriptor fra approvals-policy.cjs:145, og feltet findes ikke i dag.
- desktop/ui/project-settings.js :28-35 (commandAvailability) og :79-80 samt desktop/ui/index.html:409: teksten 'Kommandoer kører isoleret med adgang til projektet. Gælder fra næste opgave.' og afkrydsningen 'Byg og kontrollér automatisk'. Tekst og sammenhæng med 'Godkend alt' skal afklares; afhænger af beslutning 2 og 8.
- desktop/tests/command-sandbox.test.cjs :36 (allowedDomains lig PACKAGE_HOSTS) og :56-62 (netværksprøve med example.com i :59 og direkte 127.0.0.1:9 i :61). Ændres bevidst, når beslutning 1 er truffet, ikke stilles stille om.
- desktop/tests/approvals-policy.test.cjs :63 (kommandomatch og tilbagekaldelse), :88 (Windows uden isolation) og :101 (opt-in for lokale kommandoer) skal fortsat bestå.

**Risici:**
- Eksisterende prøver låser netpolitikken: command-sandbox.test.cjs:36 bliver rød, når allowedDomains ændres efter beslutning 1. Prøven på :56-62 bliver kun rød, hvis example.com (:59) eller en lytter på 127.0.0.1:9 (:61) kan nås; den tester ikke loopback alene, fordi curl mod et lukket port 9 fejler uanset. Prøverne kører kun på darwin og linux med rigtig isolation og er ikke kørt.
- Sandkassen omskriver kommandoer (command-sandbox.cjs:57), og modellen får den omskrevne version tilbage (hackathon-aarsager.md:304 målt til 2.442-2.449 tegn). Hvis nøglen bruger den omskrevne command, falder husk fra hinanden (P5).
- Motorgenstart (chat-session.cjs:392) og motoridentitet (decisions.md:697, hvor sandkassen er med) rører #58 fra trin 1. Ændringer her kan give kold start pr. besked.
- decisions.md:387 siger, at kommandoer, web og filer uden for projektet spørger hver gang. decisions.md:722 siger, at Godkend alt gælder over projektmappens grænse. De står i modstrid, indtil beslutning 4 er truffet skriftligt. hackathon-aarsager.md:76 siger, at handlinger uden for mappen giver et kort; det er ikke belæg for Godkend alt over grænsen.
- Windows har ingen sandkasse (command-sandbox.cjs:23). chat-session.cjs:225 kaster kun en fejl, når autoCommandsSnapshot er sand. Uden autoCommands bliver commandIsolation falsk (:228), og kommandoen spørger igen. Der må ikke ske automatisk kørsel uden isolation.
- En husket kommando kan blive en generel tilladelse, hvis nøglen bliver for bred. Det gælder kun, hvis beslutning 5 vælger præcis kommando og ikke kategori. Derfor skal den kun matche den præcise kommando i den præcise mappe (approvals-policy.cjs:153-155 og prøven i approvals-policy.test.cjs:63).

**Bevidst uden for trinnet:**
- Windows-sandkasse (sandbox-runtime, administratorrettigheder eller alternativ isolation) er ikke med; Godkend alt og automatisk kørsel forbliver fra dér (command-sandbox.cjs:23).
- Den konkrete netallowlist-ændring i command-sandbox.cjs:9 og :48 bygges først efter beslutning 1.
- Motorgenstart pr. besked og planbevarelse er trin 1 (#58) og ændres ikke her ud over det, P4 kræver.
- Ændring af systemRead i command-sandbox.cjs:42 for CommandLineTools er ikke med, før beslutning 9 er truffet.
- Korttekster som 'Hvorfor' og gæt-tekster (ui/approvals.js:112-117) og CLI-kortene hører til senere i årsag 1 og til årsag 11.
- Den nye godkendelsesmodel (trin 3) og kontraktprøvens del 2 er ikke specificeret her; de skal skrives først.
- Ingen filer i repoet er ændret, ingen git-kommandoer er kørt, og ingen prøver er kørt. P1-P11 er læst fra koden og fra årsagsdokumentets målinger, og 'fejler i dag' er kun angivet, hvor det er vist ved læsning eller grep.

### 7. Forhåndsvisning: AI starter den, resultat til modellen

**Mål:** Tre sammenhængende ændringer. (a) AI'en får et eget værktøj, der starter forhåndsvisningen gennem Auras DevServer og returnerer status og maskeret log. (b) Kontrolresultatet efter en opgave med filændringer føres ind i prompten, så modellen ser, om siden blev vist og om der var konsolfejl. (c) Et samtykke i almindeligt dansk til installation og start huskes, indtil package.json eller lockfilen ændres (beslutning 2). Udgangspunkt i dag: der findes intet AI-kaldbart værktøj til forhåndsvisningen; checkPreview sluger fejl; resultatet skrives kun til Aktivitet og når ikke modellen. Rung: skrevet, ikke testet.

**Kontrol:** holdt ikke ved sidste kontrol: Holder er false, fordi der findes tre fejl og en stavefejl. (1) Åben beslutning stået som fakta: maal punkt (a) siger, at AI-værktøjet returnerer maskeret log, men det afhænger af beslutning 8 i docs/hackathon-aarsager.md linje 436, som er ikke afgjort. Ret til at status returneres, og at log-delen 

**Afhængigheder:**
- Trin 6 i planen (kommandosandkassen og Godkend alt) venter: starten af tjenester og npm skal følge samme godkendelse som preview:prepare og preview:execute i desktop/main.cjs linje 877-884.
- Trin 3 i planen (godkendelser efter motorens rigtige former): et værktøjskald fra AI'en skal godkendes gennem den godkendelsesmodel, der bygges der, ikke ved en vej uden om den.
- Beslutning 1 er godkendt: resultatet af forhåndsvisningskontrollen går til modellen. Det ophæver forudsætningen i planen, men docs/decisions.md linje 158 er endnu ikke opdateret.
- Beslutning 2 er godkendt for selve AI-start og huskning af samtykket. Automatisk start efter første bygning er ikke godkendt; se beslutningerKraevet.

**Prøver (ingen er kørt endnu):**
- Ikke kørt. Prøve A, skal fejle på nuværende kode: der findes intet AI-kaldbart værktøj til forhåndsvisningen; desktop/core/engine.cjs linje 225 har kun læsebeskyttelse og sandkasse som plugins.
- Ikke kørt. Prøve B, skal fejle på nuværende kode: en fejl i konsollen efter en opgave med filændringer når ikke modellen; ui/app.js linje 1919 sluger fejlen, og composeAppContext indeholder ingen kontrolresultater.
- Ikke kørt. Prøve C, tjenestestien: et start-script med vite --port 4399 eller en fast port skal give en adresse, som status viser som kørende. Årsagsdokumentet melder fejl efter 45,3 s på nuværende kode; det er ikke reproduceret her.
- Ikke kørt. Prøve D, samtykke: et samtykke gælder ved næste opgave og næste start, og det nulstilles, når package.json eller lockfilen ændres. Fingeraftrykket i desktop/core/dev-server.cjs linje 47-48 kan bruges som udgangspunkt.
- Ikke kørt. Prøve E, måling før rettelsen: en ren opgave med og uden kontrolresultatet i prompten, som planen kræver før rettelsen. Det er et krav til prøven, ikke et resultat.
- Ikke kørt. Prøve F, logmaskering: cleanOutput i desktop/core/dev-server.cjs linje 24-29 maskerer nøgler og adgangskoder. Den dækker ikke persondata, som beslutning 8 endnu ikke har afgjort.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/engine.cjs: ingen værktøjer registreres her for AI'en; config.plugin sættes kun til læsebeskyttelse og sandkasse (linje 225); permissions starter på linje 51; OPENCODE_ENABLE_QUESTION_TOOL sættes på linje 104
- desktop/core/own-tools.cjs: registrerer ikke AI-værktøjer; klassen OwnTools (linje 10) installerer skills i brugerens eget kodeværktøj, så filen er ikke stedet for værktøjet
- desktop/core/dev-server.cjs: linje 51 (præcis vite, vite dev, vite serve, astro dev); linje 156-176 prepare; linje 177-183 execute med tokenkontrol; linje 206 maskeret proceslog på højst 16000 tegn; linje 224 og 312 har 45 s-frist; tjenestestien executeServices står på linje 248-327 med freePort på linje 298
- desktop/core/dev-server-runner.cjs: AURA_PREVIEW_PORT og strictPort i linje 58-63
- desktop/main.cjs: previewOrigin linje 737; preview:check linje 740-750 skriver til Aktivitet via workbench.log; preview:prepare og preview:execute linje 877-884; preview:stop linje 885
- desktop/ui/app.js: checkPreview står på linje 1902-1920, og fejlen sluges i catch på linje 1919; kaldet fra renderRunReview ligger på linje 2001
- desktop/core/chat-session.cjs: composeAppContext starter på linje 37; prompten bygges af komponenterne på linje 40-51 og indeholder ikke Aktivitet; hashkontrollen står på linje 422-424
- desktop/preload.cjs: kanalerne previewPrepare og previewExecute på linje 98-100
- docs/decisions.md: linje 158 skal opdateres til at sige, at resultatet går til modellen (beslutning 1); der skal tilføjes en ny post om AI-start og huskет samtykke (beslutning 2)
- Ny fil, navn og placering ikke valgt: værktøjsmodul til AI'en og dets registrering

**Risici:**
- Et AI-værktøj kan blive en omvej uden om token-godkendelsen i preview:prepare og preview:execute (desktop/core/dev-server.cjs linje 177-179). Prøven skal vise, at et kald uden gyldigt token afvises.
- Huskning af samtykket kan blive forkert, hvis fingeraftrykket ikke dækker alle pakkehåndteringsfiler; inspect bruger package.json, lockfiler, npmrc, yarn og bun samt vite- og astro-konfiguration (desktop/core/dev-server.cjs linje 47-48).
- Kontrolresultatet gør prompten større. Hashkontrollen i desktop/core/chat-session.cjs linje 422-424 afviser afsendelse, hvis konteksten ændrer sig, så resultatet skal være med i det, brugeren gennemgår.
- previewOrigin i desktop/main.cjs linje 737 bygger på currentSpace().preview eller externalPreview. Det er ikke verificeret, at det dækker tjenestestien, hvor adressen sættes i desktop/core/dev-server.cjs linje 319. Hvis ikke, returnerer preview:check preview false for tjenester.
- Maskeret log kan indeholde persondata; cleanOutput maskerer kun nøgler og adgangskoder (desktop/core/dev-server.cjs linje 24-29).
- Loggen er begrænset til 16000 tegn (linje 206 og 254), så tidlige fejl kan forsvinde.
- Tidsgrænsen for et værktøjskald i OpenCode er ikke målt. Starten kan vare op til 45 s i DevServer (linje 224 og 312), så AI'en kan få en timeout før svar.
- Ændringen af docs/decisions.md linje 158 ændrer resultatkortets tekst. Prøven i desktop/tests/preload-channels.test.cjs linje 43 kræver, at kontrollen kører én gang pr. opgave, og den må ikke brydes.

**Bevidst uden for trinnet:**
- Årsag 8 (grundregler to gange, promptens størrelse og sti efter composeAppContext). Planens trin 7 nævner den, men opgaven dækker kun årsag 6 og 7.
- Årsag 6 om projekttyper (FastAPI, Streamlit, undermapper og pnpm), Ret med AI for serverfejl, og <option>-fejlen i ui/index.html linje 365.
- CDN-diagnosen og listen over tilladte kilder (Tailwind, webskrifter, eksterne billeder). Det hører til beslutning 5 i årsagsdokumentet og trin 8 i planen.
- Designskill med skala, tokens og tilstande, samt skærmbilleder i mobil- og desktopbredde (årsag 7, Design).
- Sprogserver til TypeScript og en Aura-ejet grundprompt (årsag 7).
- Kommandosandkassen og godkendelsesmodellen (trin 3 og 6 i planen), samt komplai Run og CLI (nr. 11 og 12).

### 8. Design og netadgang

**Mål:** Når trinnet er bygget, står en konkret liste over tilladte kilder for styles, scripts og billeder i guidancen (desktop/core/project-guidance.cjs:25) og i designskill'en (profiles/skills/harness-design-og-tilgaengelighed/SKILL.md:18). Projektets netliste under Projektets indstillinger viser den godkendte liste og lader brugeren godkende én præcis adresse ad gangen. Forhåndsvisningens eksisterende kontrol (desktop/core/preview-policy.cjs:23-37) er uændret og blokerer alt uden for netadgangen. Sandkassens netadgang for kommandoer er uændret. Om listen gælder for nye projekter, for alle projekter eller kun pr. projekt, og hvad listen indeholder, afhænger af beslutningerKraevet 1 og 2. Ingen af dem er truffet.

**Kontrol:** holdt ikke ved sidste kontrol: Holder: false, fordi der er en citatfejl. Filen desktop/main.cjs:689 er forkert: funktionen saveProjectSettings findes ikke i main.cjs. Navnet er kun en IPC-nøgle i desktop/preload.cjs:123, som peger på kanalen project:settings-save. Den håndterende handle står i desktop/main.cjs:686, og gemningen s

**Afhængigheder:**
- Trin 6 i planen (kommandosandkassen lagt om, docs/plan-hackathon-aarsager.md:36), fordi sandkassens netadgang kun må ændres efter ombygningen.
- Trin 7 i planen (docs/plan-hackathon-aarsager.md:37), fordi netliste-diagnosen i desktop/core/project-runtime.cjs:98 skal pege på netlisten, før standardlisten bygges.
- Beslutning 4 fra brugeren 1. november 2026 (docs/plan-hackathon-aarsager.md:78): listen skal godkendes, før den bygges. Listen i dette trin er et forslag, ikke en godkendt liste.
- Beslutningerne 1 til 9 i beslutningerKraevet skal være truffet og skrevet i docs/decisions.md før bygning. Venter på beslutning 1 og 2: oprettelsesstien, normalizeRuntimeConfig, describeRuntime, guidance-listen og SKILL.md. Venter på beslutning 4: SRI-krav for CDN-scripts. Venter på beslutning 6: PACKAGE_HOSTS. Venter på beslutning 8: de fire tekstfelter. Venter på beslutning 9: optagelse i planen.

**Prøver (ingen er kørt endnu):**
- Ny prøve i desktop/tests/project-runtime.test.cjs: standardlisten findes og indeholder https://fonts.googleapis.com og https://fonts.gstatic.com i styles. Ikke kørt. Udledt af kodesøgning: ingen streng med fonts.googleapis eller fonts.gstatic findes i desktop/core, desktop/ui eller desktop/tests, og konstanten findes ikke. Prøven fejler derfor i dag, når den skrives. Konstantens navn fastlægges efter beslutningerKraevet 2.
- Ny prøve i desktop/tests/project-runtime.test.cjs, styles-kilde: allowedRequest med resourceType font for https://fonts.gstatic.com/s/x.woff2 og standardlisten som policy giver true. Ikke kørt. Med en bogstavelig liste består den allerede i dag (desktop/core/preview-policy.cjs:31). Den fejler i dag kun, fordi konstanten mangler, og beviser derfor ikke, at netadgangen i dag er tom.
- Ny prøve i desktop/tests/project-runtime.test.cjs: contentSecurityPolicy med standardlisten har fonts.googleapis.com i style-src og fonts.gstatic.com i font-src (preview-policy.cjs:35-37). Ikke kørt. Består med en bogstavelig liste i dag, og fejler kun med konstanten, fordi den mangler.
- Ny negativ prøve i desktop/tests/project-runtime.test.cjs: ingen adresse fra standardlisten gives som connect-kilde, og allowedRequest med resourceType xhr giver false for alle CDN-adresser. Ikke kørt. Skal bestå før og efter rettelsen, som vagt mod at en CDN bliver en datakanal.
- Ny negativ prøve i desktop/tests/project-runtime.test.cjs: contentSecurityPolicy for statisk forhåndsvisning indeholder ikke unsafe-eval (preview-policy.cjs:37). Ikke kørt. Skal bestå før og efter rettelsen.
- Eksisterende prøve desktop/tests/command-sandbox.test.cjs:36-37: allowedDomains er lig PACKAGE_HOSTS, og strictAllowlist er true. Ikke kørt. Skal bestå før og efter rettelsen, så sandkassen ikke udvides ved en fejl.
- Ny prøve i desktop/tests/command-sandbox.test.cjs: PACKAGE_HOSTS indeholder ingen CDN-adresse fra standardlisten. Ikke kørt. Skal bestå før og efter rettelsen.
- Eksisterende prøve desktop/tests/project-runtime.test.cjs:27: jokertegn, login, stier og http afvises af networkOrigin. Ikke kørt. Læst i koden; prøven skal bestå efter rettelsen.
- Eksisterende prøve desktop/tests/project-runtime.test.cjs:110-113 skal opdateres i samme rettelse. Den forventer 2 diagnoser med tom netadgang og 1 diagnose, når unpkg.com er tilladt i scripts. Med unpkg.com på standardlisten bliver tallet 1 uden tilladelse, fordi inspect i desktop/core/dev-server.cjs:63 og inspectPreviewDependencies i desktop/core/project-runtime.cjs:86 normaliserer netadgangen. Ikke kørt.
- Ny prøve i desktop/tests/project-runtime.test.cjs: guidanceFor() indeholder den godkendte liste, og sætningen åbn ikke netadgang for at skjule en fejl står stadig. Ikke kørt. Den anden del består i dag. Den første del fejler i dag, fordi linje :25 ikke har en liste, og henvisningen til netlisten findes allerede.
- Ny prøve i desktop/tests/project-runtime.test.cjs: SKILL.md punkt 7 (profiles/skills/harness-design-og-tilgaengelighed/SKILL.md:18) og guidanceFor() nævner samme liste. Ikke kørt. Fejler i dag, udledt af læsning: SKILL.md:18 nævner ingen liste. Ikke set fejle.
- Ny prøve i desktop/tests/project-runtime.test.cjs: describeRuntime uden netadgang viser den godkendte liste i stedet for tomme arrays (project-runtime.cjs:49). Ikke kørt. Fejler i dag, udledt af læsning af linje :49.
- Ny prøve i desktop/tests/project-runtime.test.cjs: normalizeRuntimeConfig uden netadgangsnøgle giver samme resultat som i dag, og en gemt netadgang bevares uændret. Ikke kørt. Skal bestå før og efter rettelsen, som vagt mod at standarden rammer eksisterende projekter uden samtykke.
- Kørsel for alle prøver: npm test i desktop (desktop/package.json:17, node --test tests/*.test.cjs relativt til desktop). Ikke kørt i denne gennemgang.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/project-guidance.cjs:25 (linjen FORHÅNDSVISNINGENS NETADGANG): tilføjes den konkrete liste. Henvisningen til netlisten findes allerede på linjen (godkendt på projektets præcise netliste). Sætningen åbn ikke netadgang for at skjule en fejl bevares. Linje :20 nævner Tailwind kun som designvalg og ændres ikke.
- desktop/core/project-runtime.cjs:5-13: ny konstant for den godkendte liste pr. slags netadgang (scripts, connect, images, styles). Listen går gennem networkOrigin (:8-13), så jokertegn, stier og http afvises som i dag. Indholdet afgøres af beslutningerKraevet 1 og 2.
- desktop/core/project-runtime.cjs:36-44 (grenen value.network): ingen standardværdi her, fordi normalizeRuntimeConfig kaldes for alle projekter (project-runtime.cjs:48, :71, :86; desktop/main.cjs:59, :82, :683, :698). Standarden skal sættes i oprettelsesstien for nye projekter. Oprettelsesstien er ikke fundet i denne gennemgang og skal pejles ud før bygning. Den gælder kun, hvis beslutning 1 vælger standard for nye projekter.
- desktop/core/project-runtime.cjs:49 (describeRuntime): viser den godkendte liste i stedet for tomme arrays, når netadgang ikke er sat. Projektets indstillinger læser via desktop/main.cjs:683.
- desktop/core/preview-policy.cjs:23-32 (allowedRequest) og :33-37 (contentSecurityPolicy): ingen ændring i logikken. Prøverne bruger den eksisterende kontrol med den nye liste som input. requestKind (:19-21) mapper font og stylesheet til kind styles, og font-src bruger styles-listen på :37.
- desktop/core/command-sandbox.cjs:9 (PACKAGE_HOSTS) og :48: ingen ændring i denne fase. PACKAGE_HOSTS er i dag registry.npmjs.org, pypi.org og files.pythonhosted.org. Forhåndsvisningens netadgang og kommandoernes netadgang er to mekanismer.
- desktop/core/preview-session.cjs:17 (contextPolicy): ingen ændring. Læser netadgangen fra runtimeConfig, så ny liste virker automatisk.
- desktop/ui/project-settings.js:6 (networkKinds) og desktop/ui/index.html:416-420: visning af den godkendte liste og en knap til at godkende én adresse ad gangen. De fire eksisterende tekstfelter (connect, scripts, images, styles) erstattes eller bevares først efter beslutningerKraevet 8. Projektets indstillinger gemmer via saveProjectSettings i desktop/main.cjs:689, og adresserne valideres af networkOrigin.
- profiles/skills/harness-design-og-tilgaengelighed/SKILL.md:18 (punkt 7): skriver den samme liste som guidancen, så skillen og appen siger det samme. Sker først efter beslutningerKraevet 1 og 2.
- docs/decisions.md: ny post om den godkendte liste, netlisten og afgrænsningen mod sandkassen. Skrives kun efter brugerens godkendelse af beslutningerKraevet 1 til 9.
- desktop/tests/project-runtime.test.cjs: tilføjelse af nye prøver og opdatering af den eksisterende prøve på :110-113 (se proever). Filen findes allerede, så det er en tilføjelse.
- desktop/tests/command-sandbox.test.cjs: tilføjelse af én prøve. Eksisterende :36-37 ændres ikke.

**Risici:**
- Sikkerhed: cdn.jsdelivr.net og unpkg.com serverer npm-pakker via URL-sti. Det er ekstern viden, ikke læst i repoet. networkOrigin afviser stier (desktop/core/project-runtime.cjs:10), så netadgangen kan ikke fastlåse en version. SRI findes ikke: der er ingen integrity-attribut i desktop/core eller desktop/ui.
- Sikkerhed: cdn.tailwindcss.com kan kræve unsafe-eval. Den statiske forhåndsvisning har ikke unsafe-eval (preview-policy.cjs:37). Ikke målt.
- Sikkerhed: en generel tilladelse til billedhosts bryder reglen i SKILL.md punkt 7 om projektets egne billeder. Billeder bør ikke stå på standardlisten uden beslutning 3.
- Samtykke: en standardliste i normalizeRuntimeConfig ville ramme alle projekter, også dem uden netadgangsnøgle, fordi funktionen kaldes for alle (desktop/main.cjs:59, :82, :683, :698). Det er den adfærd, trinnet selv vil undgå.
- Eksisterende prøve: desktop/tests/project-runtime.test.cjs:110-113 ændrer antal diagnoser, når standardlisten rammer inspect(). Prøven fejler uden opdatering.
- Sandkassen: hvis CDN-hosts lægges i PACKAGE_HOSTS (desktop/core/command-sandbox.cjs:9), udvides kommandoernes netadgang. Prøven i desktop/tests/command-sandbox.test.cjs:36 fanger det.
- Dokumentation: der findes ingen netadgangsbeslutning i docs/decisions.md. Hvis listen bygges uden ny post, står den kun i kode og guidance.

**Bevidst uden for trinnet:**
- Ingen ændring af sandkassens netadgang (desktop/core/command-sandbox.cjs:9 og :48). Den holdes uændret i dette trin.
- Ingen ændring af preview-policy.cjs' logik eller CSP-struktur. Der tilføjes ingen unsafe-inline for eksterne kilder og ingen unsafe-eval til statisk forhåndsvisning.
- Ingen SRI-implementering og ingen ændring af preview-policy.cjs for SRI før beslutning 4.
- Ingen automatisk godkendelse, og ingen ændring af eksisterende projekters netlister uden samtykke.
- Ingen connect-kilder (API'er, data, login, wss). Eksterne API'er er særskilte integrationer, jf. desktop/core/project-guidance.cjs:25.
- Ingen generelle kodehosts som github.com, raw.githubusercontent.com, gist eller esm.sh på listen.
- Ingen logoer, billeder, skrifter eller tekster med uafklarede rettigheder.
- Ingen ændring af designskill'ens referencer ud over punkt 7 i SKILL.md. Tokens, skala og tilstande hører til designmetoden.
- Ingen ændring af Tailscale-regler (desktop/core/project-guidance.cjs:21), CLI-guidancen eller Promte- og komplai-integrationer.
- Ingen ændring af måling mod rigtige modeller. Det er ikke målt, om modeller bruger CDN i praksis.
- Ingen ændring af planens rækkefølge uden beslutning 9.

### 9. Prompt: grundregler kun én gang

**Mål:** Venter på beslutning A og B: grundreglerne står i systemprompten én gang, fordi blokken Projektets AGENTS.md springes over, når projektets AGENTS.md er ordret lig de effektive grundregler (skills.cjs:17 og :49). Størrelsen pr. kald måles i scratchpad før og efter rettelsen, i tegn og bytes, så den ikke står som et uspecificeret tal.

**Kontrol:** holdt ikke ved sidste kontrol: Holder falsk, fordi to påstande ikke stemmer med filerne. Verificeret med læsning: chat-session.cjs:37 er composeAppContext; :42 er Projektets AGENTS.md; checkContext står på :311-:323; :325-:327 er starten af send(); :342 og :430 sammenligner projectInstructions. project-instructions.cjs:32-35 er i

**Afhængigheder:**
- Beslutning A, B, C og D skal være truffet, før chat-session.cjs:42, project-instructions.cjs:32-35 og projects.cjs:59-60 ændres. Beslutning D er kun nødvendig, hvis eksisterende projekter skal migreres.
- Målingen før rettelsen skal køres, før den første ændring, så før og efter kan sammenlignes.
- Fixturen i desktop/tests/app-context.test.cjs skal udvides med en AGENTS.md, før dublet- og konfliktprøven kan køres. I dag har fixturen kun index.html (linje 20).
- Kørsel af prøverne kræver, at tests/app-context.test.cjs og tests/projects.test.cjs er grønne på nuværende kode først. Det er ikke tjekket i denne specifikation.

**Prøver (ingen er kørt endnu):**
- desktop/tests/app-context.test.cjs (ny prøve; fixturen skal selv skrive AGENTS.md lig profiles/grundregler.md, jf. rettelser): kontrolordet FÆLLES-GRUNDLAG-02 (profiles/grundregler.md:52) skal stå præcis én gang i engines[0].sent[0].system efter bench.send. Ikke kørt; udledt: i dag står det to gange, fordi chat-session.cjs:40 og :42 begge tilføjer teksten, så prøven forventes at give 2. Afhænger af beslutning B for den identiske tilfælde.
- desktop/tests/app-context.test.cjs (ny prøve, samme fixture): fragmentet med titlen Projektets AGENTS.md skal ikke indeholde grundreglernes tekst, når AGENTS.md er identisk. Titlen skal stadig findes, fordi kilde-linjen står der. Ikke kørt; udledt: i dag indeholder fragmentet hele teksten (chat-session.cjs:42). Afhænger af beslutning B.
- desktop/tests/app-context.test.cjs (ny prøve; afhænger af beslutning B): gemte, ændrede grundregler med en uændret AGENTS.md med original tekst skal stadig give blokken med projektets regler. Ikke kørt; udledt: skal bestå både i dag og efter rettelsen, så konflikttilfældet ikke tabes.
- desktop/tests/app-context.test.cjs:38: grundreglerne står i et fragment med kontrolordet. Ikke kørt; udledt: skal bestå før og efter, fordi fragmentet Appens grundregler og projektkontekst (chat-session.cjs:40) ikke røres.
- desktop/tests/app-context.test.cjs:78: en ændret AGENTS.md efter gennemgangen skal afvise afsendelsen. Ikke kørt; udledt: skal bestå før og efter rettelsen.
- desktop/tests/projects.test.cjs:15: AGENTS.md skal være ordret lig profiles/grundregler.md. Ikke kørt. Bliver kun rød ved beslutning A option 2, og så skal prøven ændres bevidst.
- Ny prøve for CLAUDE.md (betinget af beslutning A og C, option 1 for CLAUDE.md): CLAUDE.md skal være importen @AGENTS.md, ikke en kopi. Ikke kørt; udledt: i dag skriver projects.cjs:60 hele grundregler.md til både AGENTS.md og CLAUDE.md, så prøven forventes at fejle.
- Ny prøve for fjernelse af AGENTS.md (betinget af beslutning A option 2): nye projekter må ikke have AGENTS.md med grundreglerne. Ikke kørt. Ændrer projects.test.cjs:15 bevidst.
- Ny prøve for flaget i engine.cjs:102 (ubetinget): isolatedEnv i desktop/core/engine.cjs:370 skal give OPENCODE_DISABLE_PROJECT_CONFIG lig med true. Ikke kørt. Ingen prøve i desktop/tests nævner flaget. desktop/tests/providers.test.cjs:176-178 tester isolatedEnv for en anden variabel. Prøven skal bevises ved at fjerne flaget i en kopi i scratchpad og se den fejle.
- Måling i scratchpad, ikke en prøve med påstand: en fake-motor fra engineFactory i fixturen i desktop/tests/app-context.test.cjs (linje 14-17) optager system i engines[0].sent (linje 15). Målingen kører bench.prepare og bench.send med input fra fixturen for mode chat, plan, build og free, og måler system.length i tegn, Buffer.byteLength(system,'utf8') i bytes og længden af hver komponent efter title. Kørsel med Node 22 fra desktop/.runtime/darwin-arm64/node/bin/node før og efter rettelsen. Grundregler-filen er 4.778 tegn (wc -m); besparelsen måles og antages ikke.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/chat-session.cjs:42 (i composeAppContext, som starter på :37): venter på beslutning B. Når projectInstructions.content er lig med prepared.context.rules, skrives i samme fragment kun kilde-linjen og SHA-256 og en kort tekst om, at indholdet er identisk med grundreglerne. Titlen Projektets AGENTS.md bevares, fordi fragmentet i dag altid tilføjes, også når AGENTS.md mangler (instructionText returnerer da tom tekst).
- desktop/core/project-instructions.cjs:32-35 (instructionText): venter på beslutning B. Ny variant, der ved identisk indhold kun skriver kilde, SHA-256 og identisk med grundreglerne uden selve teksten.
- desktop/core/chat-session.cjs:342 og :430: uændrede. De sammenligner projectInstructions med prepared.context.projectInstructions, så en ændret AGENTS.md efter gennemgangen fortsat afviser afsendelsen.
- desktop/core/projects.cjs:59-60 (createProject; linje 59 læser grundregler.md, linje 60 skriver AGENTS.md og CLAUDE.md med samme indhold): venter på beslutning A og C. Option 1 for CLAUDE.md: importen @AGENTS.md i stedet for en kopi, mønster fra desktop/core/adapters.cjs:59-60. Option 2 for AGENTS.md: linje 60 skriver den ikke for nye projekter.
- desktop/core/engine.cjs:102: ingen ændring. Flaget står ikke som literal tekst i filen. Det bygges i en løkke som OPENCODE_ plus DISABLE_PROJECT_CONFIG, og det skal blive.
- desktop/core/engine.cjs:370: isolatedEnv er eksporteret, så en prøve kan kalde den direkte.

**Risici:**
- Duplikatfjernelsen ændrer systemprompten én gang ved opgradering, så første besked efter opdateringen kan give et cache-miss hos udbyderen. Effekten er uafklaret og er ikke målt.
- Når projektets AGENTS.md ikke er identisk, fx efter brugerens redigering af grundregler, sendes stadig både grundregler og fuld AGENTS.md (chat-session.cjs:40 og :42). Det er en konflikt mellem to regelsæt, som ikke er løst i dag. Beslutning B afgør, hvad der gælder.
- Sammenligningsmålet er venter på beslutning B: de effektive regler (skills.cjs:17 og :49) eller profilfilen (library.cjs:133). Sammenlignes der med profilfilen, springes blokken over, når AGENTS.md er lig profilen, selv om de effektive regler er tilpasset og derfor ikke er identiske.
- Option 2 for AGENTS.md i projects.cjs:59-60 bryder desktop/tests/projects.test.cjs:15, og AGENTS.md mangler så for andre kodeværktøjer. Det venter på beslutning A.
- OpenCode 1.18.33 (binæren desktop/.runtime/darwin-arm64/opencode/bin/opencode) skal gate projektets AGENTS.md- og CLAUDE.md-søgning på flaget. Det er ikke kørt i denne gennemgang. Kilden sætter flaget i engine.cjs:102. Hvis flaget fjernes, eller en ny version ændrer det, kan AGENTS.md sendes en tredje gang. Den nye flagprøve dækker det.
- Årsagsdokumentets henvisning chat-session.cjs:325-327 peger på starten af send(), ikke på checkContext. checkContext står på :311-:323. composeAppContext starter på :37. Dokumentet skal rettes, når trinnet bygges.
- Årsagsdokumentets tal for systemprompten og kaldene er ikke målt her, og de bruges ikke som påstand.
- Den læste kode bekræfter kun, at AGENTS.md og grundreglerne er identiske, når brugeren ikke har redigeret dem. Det er ikke kørt med en rigtig model.
- Denne repos egen AGENTS.md er ikke ordret lig profiles/grundregler.md; cmp viser forskel fra linje 1. Fixturen i prøven må derfor skrive sin egen AGENTS.md og må ikke læse denne repos fil.

**Bevidst uden for trinnet:**
- Gentagelsen af planen i Byg (planen står tre gange efter én planrunde, årsag 8 under Årsagen) er ikke med. Den er en særskilt beslutning om planens placering.
- Teksten om udgivelse, når Udgiv er slået fra, er ikke med.
- Placeringen af den midlertidige mappe i systemprompten og præfiks-cachen er ikke med; den står i årsagsdokumentet under punktet om stien.
- Skill-beskrivelser og hosting-guidance er ikke med.
- Den gamle påstand om 39.741 tegn og 471-475 KB er ikke brugt eller genfundet. Den er ikke målt her og står derfor ude.
- Ingen ændring af engine.cjs:102: flaget bevares, og der tilføjes kun en prøve.
- Ingen kørsel af prøver eller målinger i denne specifikation. Filer er ikke ændret, og der er ikke kørt git-kommandoer.
- Forsinkelse og Corti-cache er ikke målt, og tidsestimater er ikke angivet.

### 10. API-nøgler: fælles rensning

**Mål:** Der findes én rensefunktion, cleanKey i desktop/core/connections.cjs, og den bruges af nøglevinduet, normalize, storeConnection, læsning af gemte nøgler i models() og CLI'ens login. Hver fejl om nøgle eller adresse peger på det, brugeren kan rette. Status i dag, læst i koden: nøglevinduet (desktop/core/key-window.cjs:168 og :204), normalize (desktop/core/connections.cjs:154) og storeConnection (desktop/core/workbench.cjs:233) bruger cleanKey. models() (desktop/core/workbench.cjs:283) og CLI'en (cli/connections.cjs:37-43 i repoets rod) bruger den ikke. Ordlyden af fejlene afgøres af beslutning 6. Adfærden ved tomme valgfri nøgler, gemte nøgler og præfikser afgøres af beslutning 7, 2 og 3.

**Kontrol:** holdt ikke ved sidste kontrol: Hold er false; rettelsen er ikke korrekt endnu. Fejl 1: maal-feltets første sætning siger i nutid, at models() og CLI'en bruger cleanKey; det er forkert, for desktop/core/workbench.cjs:283 og cli/connections.cjs bruger den ikke (grep og læsning), og sætningen skal skrive skal bruge. Fejl 2: filer-pu

**Afhængigheder:**
- Ingen af trin 1-9 er forudsætning for trin 10. Trin 10 er uafhængigt af kontraktprøvens del 2 (trin 3), fordi den ikke rører desktop/core/connections.cjs.
- Venter på beslutning 7: optional-option i cleanKey (punkt 1), normalize (punkt 2), P3.
- Venter på beslutning 3 og 6: præfiksudvidelse og længdeafvisning i cleanKey (punkt 1), P1 og P2.
- Venter på beslutning 6: ordlyd i networkFailure (punkt 3), 404-besked (punkt 5), CLI-linje og ui-tekst (punkt 8 og 10), P4 og P5. Grenen for ENOTFOUND og signaturen networkFailure(error, url) venter ikke.
- Venter på beslutning 5: Corti 401-sætning (punkt 4), P6 og linje 77 i key-cleaning.test.cjs.
- Venter på beslutning 2: rens af gemte nøgler i models() (punkt 6), P7.
- Venter på beslutning 4: preview-metoden i connectionPurpose (punkt 7), P9.
- Venter på beslutning 8: CLI-rensning og rettelseslinje (punkt 8), P8. Trin 11 bygger på punkt 8, når beslutning 8 er truffet.
- Venter på beslutning 1: ingen ændring i providers.test.cjs:112; P10 er kun en vagt.
- Venter på beslutning 9: Azure- og Ollama-adressefelter hører kun til trin 10, hvis brugeren vælger det.

**Prøver (ingen er kørt endnu):**
- P1 desktop/tests/key-cleaning.test.cjs (ny): cleanKey('token=' plus en syntetisk 40 tegn OpenAI-nøgle, 'openai', strict) giver nøglen uden præfiks og changes ['navn foran']. Fejler i dag: ja, målt med node 22.23.3: nøglen beholder token= og changes er tom. Venter på beslutning 3.
- P1b (guard, ikke fix): cleanKey('OPENAI_API_KEY=' plus nøgle, 'openai', strict) giver nøglen og changes ['navn foran']. Grøn i dag, målt. Skal bevares.
- P2 desktop/tests/key-cleaning.test.cjs (ny): cleanKey('key=abc', 'openai', strict) må ikke give beskeden med ordet afkortet, når der er tekst foran nøglen. Tekst foran betyder tegn før nøglen, som cleanKey ikke fjerner. Fejler i dag: ja, målt: Nøglen ser afkortet ud. Brug kopiér-knappen hos udbyderen. Venter på beslutning 3 (hvad fjernes) og 6 (ordlyd). Prøven bruger en præfiks med småt, som i dag ikke fjernes.
- P3 desktop/tests/key-cleaning.test.cjs (ny): normalize({ kind compatible, name x, baseURL http://127.0.0.1:1/v1, apiKey blank med tre mellemrum }) kaster ikke, og key er tom. Fejler i dag: ja, målt: Feltet er tomt. Sæt nøglen ind fra udbyderens side. Venter på beslutning 7.
- P4 desktop/tests/key-cleaning.test.cjs (ny): requestJSON mod en lokal server, der svarer 404, giver en besked, der nævner serveradressen, og ikke Ingen anden forbindelse blev valgt. Fejler i dag: ja, målt: Serveren svarede med HTTP 404. Ingen anden forbindelse blev valgt. Prøven låser kravet om adresse; den faste ordlyd venter på beslutning 6.
- P5 desktop/tests/key-cleaning.test.cjs (ny): listModels med et konstrueret connection-objekt { kind openai, baseURL https://nonexistent-host.invalid/v1 } giver en besked uden Tailscale og uden port ved ENOTFOUND. Normalize kan ikke bruges, fordi openai altid bruger def.baseURL i linje 155. Fejler i dag: ja, målt: Serveren svarer ikke. Kontrollér adresse, port, netværk og eventuelt Tailscale. Prøven er DNS-afhængig og kan give en anden fejl i miljøer med DNS-omskrivning. Ordlyden venter på beslutning 6.
- P6 desktop/tests/key-cleaning.test.cjs (ny): requestJSON mod en lokal server med kind corti, der svarer 401 med API key is not valid base64, giver en besked uden sætningen virker kun i sit eget miljø. Fejler i dag: ja, målt: sætningen står i beskeden. Venter på beslutning 5. Eksisterende linje 77 låser kun præfikset og består.
- P7 desktop/tests/workbench-keys.test.cjs (ny): en forbindelse med en gemt rå nøgle, der har anførselstegn omkring K, sender Authorization Bearer K ved models(). Fejler i dag: ikke kørt. Kodelæsning viser, at workbench.cjs:283 bruger store.decrypt uden cleanKey. Venter på beslutning 2.
- P8 cli-prøve (cli/tests/cli.test.cjs eller terminal_driver.py): login med en rå nøgle med Bearer og anførselstegn, syntetisk nøgle på mindst 20 tegn. Læs kun linjen Rettet i den indsatte nøgle; læs ikke den gemte nøgle, fordi storeConnection allerede renser den. Fejler i dag: ikke kørt. Kodelæsning viser, at cli/connections.cjs:37-43 ikke skriver linjen. Venter på beslutning 8.
- P9 desktop/tests/key-window.test.cjs (ny): preview af en syntetisk Corti-nøgle med miljøet eu-s i base64 giver regionen EU-S før submit uden netkald. Fejler i dag: ikke kørt. Metoden preview findes ikke i desktop/core/key-window.cjs (grep). Prøven skal kalde den nye metode og tjekke regionen, ikke kun at metoden mangler. Venter på beslutning 4.
- P10 (guard, ikke fix): normalize med kind corti og en nøgle uden miljøpræfiks giver adressen https://ai.eu.corti.app/v1. desktop/tests/providers.test.cjs:112 låser det i dag. Læst, ikke kørt i denne runde. Må ikke ændres uden beslutning 1.

**Filer (citater ikke fuldt verificeret):**
- Status på HEAD 8ed23c9: tag v0.7.0-beta.1 indeholder commit 21923f8, og tag v0.6.0-beta.1 indeholder den ikke (verificeret med git merge-base). Årsagsdokumentets afsnit 10 (docs/hackathon-aarsager.md:318-343) er delvist forældet: fælles rensefunktion findes, og udbydervælgeren viser fire kort, ikke ti.
- desktop/core/connections.cjs:101-140 cleanKey: tilføj option optional, så en blank nøgle for udbydere uden nøgle giver tom nøgle; venter på beslutning 7. Ret længdeafvisningen i linje 138, så den kun siger afkortet, når der ikke er tekst foran nøglen; venter på beslutning 3 og 6. Navnemønsteret i linje 121 ændres kun ved beslutning 3. changes returneres uændret, som i dag.
- desktop/core/connections.cjs:151-155 normalize: cleanKey kaldes i linje 154 uden strict; send optional med værdien !definitions[kind].keyRequired; venter på beslutning 7. Corti-regionen følger den rensede nøgle i linje 155, som i dag.
- desktop/core/connections.cjs:195-202 networkFailure: får ny signatur networkFailure(error, url), og kaldet i linje 219 sender url med. ENOTFOUND og ECONNREFUSED får hver sin gren før standardgrenen i linje 202; grenene er uafhængige af beslutningerne. Teksterne venter på beslutning 6, og Tailscale må kun nævnes for private adresser ved beslutning 6.
- desktop/core/connections.cjs:227 Corti 401/403: sætningen om miljøet står i dag altid. Den skal kun stå, når udbyderens svar ikke er genkendt; venter på beslutning 5.
- desktop/core/connections.cjs:230 HTTP 404 og andre ikke-500-fejl: teksten Ingen anden forbindelse blev valgt. erstattes af en besked, der nævner serveradressen; ordlyden venter på beslutning 6. I dag står teksten uden adresse.
- desktop/core/workbench.cjs:279-287 models(): den gemte nøgle renses med cleanKey før listModels i linje 283; venter på beslutning 2. I dag bruges store.decrypt uden cleanKey. storeConnection i linje 233 renser allerede med cleanKey uden strict.
- desktop/core/key-window.cjs:150-166 connectionPurpose: ny metode preview(raw) uden netkald, der finder Corti-regionen ud fra nøglens miljø og returnerer changes; venter på beslutning 4. Metoden ligger i connectionPurpose, ikke i klassen KeyWindow. Linje 155 har i dag teksten Nøglen sendes til Corti i EU, EU-S eller Frankrig, alt efter hvor nøglen hører til. Linje 174 navngiver forbindelsen efter regionen.
- cli/connections.cjs i repoets rod (ikke desktop/cli): linje 37-41 kører cleanKey(apiKey, kind, strict true) før bench.saveConnection i linje 41, og linjen Rettet i den indsatte nøgle skrives, når changes ikke er tom. Venter på beslutning 8. I dag går den rå nøgle direkte til saveConnection, og linje 43 skriver kun Forbindelsen er gemt.
- cli/terminal.cjs:36 ændres ikke. result || fallback kan give blank tekst ved valgfri nøgle; det håndteres i cleanKey med option optional, venter på beslutning 7.
- desktop/ui/app.js:1092 ændres ikke. Formatet Rettet i den indsatte nøgle bruges også af CLI-linjen; ordlyden venter på beslutning 6.
- desktop/scripts/verify-setup.cjs: ny sektion efter linje 49 med en forurenet Bearer-nøgle mod en lokal compatible-server, der registrerer Authorization-headeren. Linje 47 og 49 ændres ikke; linje 49 bekræfter fire kort i første lag.
- desktop/tests/key-cleaning.test.cjs: nye prøver P1-P6 og P3. Eksisterende tilfælde i linje 9-27, 29-40 (linje 39 base64), 42-52, 54-58 og 65-78 bevares. Linje 77 ændres kun ved beslutning 5. Linje 88 bevares.
- desktop/tests/key-window.test.cjs: ny prøve P9. Linjerne 222-229, 252 og 322 bevares, da de låser teksten Serveren svarer ikke.
- desktop/tests/providers.test.cjs:112 ændres ikke. Linjen låser EU-fallback for Corti uden miljøpræfiks; ny guard-prøve P10 bevarer det, indtil beslutning 1 er truffet.
- desktop/tests/workbench-keys.test.cjs (ny fil, P7) og en CLI-prøve (P8) via cli/tests/cli.test.cjs eller cli/tests/terminal_driver.py. Driveren er ikke undersøgt endnu.
- docs/plan-hackathon-aarsager.md række 10 og docs/hackathon-aarsager.md afsnit 10 (318-343) opdateres til HEAD (punkt 13). Denne opdatering kan ske uden beslutninger, fordi de forældede påstande er målt forkerte.

**Risici:**
- Det udvidede navnemønster i connections.cjs:121 kan fjerne = fra base64-nøgler, der slutter med =. desktop/tests/key-cleaning.test.cjs:39 og Corti-prøver i providers skal forblive grønne før og efter ændringen.
- Teksten i connections.cjs:227 rammes af desktop/tests/key-cleaning.test.cjs:77. Linjen ændres kun ved beslutning 5.
- Ændringer i 404- og netværksbeskederne (connections.cjs:202 og :230) må ikke fjerne Serveren svarer ikke ved ECONNREFUSED. desktop/tests/key-cleaning.test.cjs:88, desktop/tests/key-window.test.cjs:222-229, :252 og :322 låser teksten.
- Rens ved læsning (workbench.cjs:283) kan gøre et gemt rå nøgleindhold med mellemrum midt i til en fejl ved modelkontrol i stedet for et forsøg. Fejlen skal have dansk besked med henvisning til at gemme nøglen igen. Venter på beslutning 2.
- Optional-flaget ændrer normalize for compatible, ollama og zen, fordi keyRequired er false. providers-prøverne og desktop/scripts/verify-setup.cjs skal stadig bestå. Venter på beslutning 7.
- Eksisterende guard, skal bevares: desktop/tests/key-cleaning.test.cjs linje 9-27, 29-40, 42-52 og 65-78; desktop/scripts/verify-setup.cjs:49 bekræfter fire kort i første lag.
- Allerede rettet på HEAD og bevaret som vagt: Bearer foran med EU-S-nøgle går til den rigtige adresse (connections.cjs:154-155; test key-cleaning.test.cjs:35). Usynlige tegn og NUL renses før netkald (connections.cjs:103 og :127-128). Gem alligevel ved utilgængelig server er besluttet (docs/decisions.md:721).
- Prøvekørsel: desktop/tests/key-cleaning.test.cjs og desktop/tests/providers.test.cjs blev kørt af kritikken med node 22 og bestod 20 af 20. Denne runde kørte kun en skrivefri probe på HEAD (scratchpad/probe10/probe.cjs) for P1-P6, P3 og P9 nedenfor. Probe-tallene er målt i denne runde. De nye prøver P1-P10 er ikke kørt som prøver.
- P5 afhænger af netværksmiljøet. Med DNS-omskrivning kan ENOTFOUND udebliver, og prøven skal da markeres som ikke kørt, ikke grøn.

**Bevidst uden for trinnet:**
- CLI'ens login-flow ud over punkt 8: kontrol før gem, adgangssætning, nøglering og dubletter af forbindelser hører til trin 11.
- Udtræk af Azure-ressourcens adresse fra fuld URI og tilføjelse af http:// for localhost hører ikke til nøgle-påstanden; kun med svar på beslutning 9.
- Udbydervælgerens layout: ingen ændring; fire kort findes allerede og bekræftes af desktop/scripts/verify-setup.cjs:49.
- GitHub-nøglen (desktop/core/key-window.cjs:204) bruger samme cleanKey, men får ingen nye fejltekster i dette trin.
- Redigering af en gemt forbindelse nulstiller nøglen, når adressen ændres (desktop/core/workbench.cjs:233). Det er en observation, ikke rettet her.
- Ændringer i nøglehjælpen (udbydernes kontosider) og i Corti EU-S-adressen.

### 11. CLI: nøglering og region

**Mål:** Når beslutning 1 til 7 er truffet, skal CLI'ens login kunne gemme nøgler i systemets nøglering, bruge det nuværende adgangssætningslager som reserve og vise Corti-regionen ved login. Ingen af delene er besluttet endnu: mekanisme, reserve, migration, nulstilling, regionlinjens placering og standardnavn står som åbne beslutninger. I dag gemmer CLI'en kun med adgangssætning (cli/storage.cjs:41-61) og viser ingen region ved login (cli/connections.cjs:43-45). Intet er bygget eller kørt.

**Kontrol:** holdt ikke ved sidste kontrol: Skeptikerens vurdering af trin 11 (CLI nøglering og region). Holder er false, fordi der er fejl der skal rettes før specifikationen kan godkendes. Verificerede citater: cli/storage.cjs:47-48 er korrekt (forklaringstekst og ui.ask med secret); cli/connections.cjs:39 er korrekt (if apiKey kalder vault

**Afhængigheder:**
- Ingen blokering af appen. Trinnet læser desktop/core/connections.cjs og desktop/core/store.cjs, men ændrer dem ikke.
- Deler normalize-stien med trin 10: cleanKey i desktop/core/connections.cjs:154 og region i :155. Rækkefølgen skal aftales, hvis begge ændrer den.
- Nøgleringen afhænger af beslutning 1 og 2. Reserven og migrationen afhænger af beslutning 3 og 4. Regionlinjen afhænger af beslutning 6. Standardnavnet afhænger af beslutning 7. Nulstillingen afhænger af beslutning 5.
- Prøverne skal skrives og køres mod den nuværende kode og fejle, før der rettes (planens vagt-regel i docs/plan-hackathon-aarsager.md under Vagter). Ingen prøve er kørt i denne undersøgelse.
- Trinnet står i planens rækkefølge som trin 8 sammen med trin 10 og 12, mens planens rettelse fra 1. november kalder CLI en separat udgivelsesstrøm. Rækkefølgen skal bekræftes.

**Prøver (ingen er kørt endnu):**
- cli/tests/cli.test.cjs (ny): login med API-nøgle og injiceret vault-adapter spørger ikke om adgangssætning. Venter på beslutning 1 og 3. Status: ikke kørt. Læst: cli/connections.cjs:39 kalder vault.unlock(ui), når apiKey er sat, så prøven ville fejle i dag, men den kan først skrives, når adapterens mekanisme er valgt.
- cli/tests/cli.test.cjs (ny): nøglen gemmes via adapteren, settings.json indeholder ikke klartekst, og decryptString giver samme værdi. Venter på beslutning 1 og 2. Status: ikke kørt. Læst: Vault har ingen adapterindgang i dag (cli/storage.cjs:41-61).
- cli/tests/cli.test.cjs (ny, migration): en eksisterende vault.json med kendt adgangssætning giver adgang til de gamle nøgler, og de flyttes eller læses videre efter beslutning 4. Venter på beslutning 4. Status: ikke kørt.
- cli/tests/cli.test.cjs (ny, regression): når adapteren kaster en fejl, bruges adgangssætningslageret, og den eksisterende prøve i :59-69 består uændret. Venter på beslutning 3 for reservens regler. Status: ikke kørt. Prøven tester ikke en adapter, fordi den ikke findes endnu.
- cli/tests/cli.test.cjs (ny, adfærd): login med en EU-S-nøgle giver baseURL https://ai.eu-s.corti.app/v1. Status: ikke kørt. Læst: normalize og cortiEndpoint (desktop/core/connections.cjs:89-94 og :155) vælger allerede adressen, og desktop/tests/providers.test.cjs:110 dækker den. Det er en adfærdsprøve, ikke en fejlprøve.
- cli/tests/cli.test.cjs (ny): regionlinjen i login-outputtet indeholder teksten fra desktop/core/connections.cjs:87 (EU-S (Sovereign), hos Scaleway i Frankrig) før 'Forbindelsen er gemt.', efter nøglen er kontrolleret. Venter på beslutning 6. Status: ikke kørt. Læst: cli/connections.cjs:43-45 skriver ingen region, så prøven ville fejle i dag.
- cli/tests/cli.test.cjs (ny): en fr-nøgle giver regionen fra desktop/core/connections.cjs:82 (Frankrig, hos Scaleway i Paris ifølge Corti). Venter på beslutning 6. Status: ikke kørt.
- cli/tests/cli.test.cjs (ny): standardnavnet er en funktion af nøglens region, enten EU-S eller EU. Venter på beslutning 7. Status: ikke kørt. Læst: UI-stubben i cli.test.cjs:24 returnerer en tom streng, så navnet ville blive tomt, og normalize i desktop/core/connections.cjs:156 ville kaste. Stubben skal honorere standardværdien først.
- cli/tests/cli.test.cjs (eksisterende, må ikke ændres): Linux-prøven i :70-76 og Windows-prøven i :77-80 samt desktop/tests/github.test.cjs og komplai*.test.cjs skal bestå uændret. Status: ikke kørt. Regressionsprøver.
- Nulstillingsprøve: skrives først, når beslutning 5 har valgt kommandonavn og slettescope. Ingen prøve foreslås før da. Status: ikke skrevet.

**Filer (citater ikke fuldt verificeret):**
- cli/storage.cjs, class Vault (:25-63): isEncryptionAvailable :27 returnerer Boolean(this.key); encryptString :28-34 kaster uden oplåst nøgle (:29); decryptString :35-40 (:36); unlock :41-61 spørger adgangssætningen (:47 forklaringstekst, :48 ui.ask med secret, :50 krav om 12 tegn og gentagelse, :51-52 scrypt med N=32768, :57-58 skriver vault.json med mode 0600). Ændres afhængigt af beslutning 1 til 4. close :62 og exports :87 bevares.
- cli/connections.cjs, login (:10-47): :36 standardnavn er definition.name som fallback; :37-38 nøgleprompt; :39 kalder vault.unlock(ui), når apiKey er sat; :40-42 gemmer forbindelsen; :43-45 meddelelser uden regionlinje; disclose :76. Regionlinjen og navnet indsættes efter beslutning 6 og 7. unlockConnection :4-9 (kald :7) bevares.
- cli/app.cjs: Application tager allerede vault som parameter (:16) og sender den som safeStorage til Workbench (:20). Standard: adapteren injiceres via denne vault-parameter, ligesom prøvefixturen gør i cli/tests/cli.test.cjs:33. Ingen ny parameter forudsat.
- cli/aura.cjs: HELP :17-24 og parse :37 kommandolisten; logout :52-63 med vault.unlock i :61 bevares. Ny nulstil-kommando tilføjes kun efter beslutning 5.
- Ny fil, navn ikke valgt: cli/keychain.cjs, adapter med samme grænseflade som Vault (isEncryptionAvailable, encryptString, decryptString). Oprettes kun efter beslutning 1 og 2.
- cli/tests/cli.test.cjs (241 linjer): nye prøver ved siden af de eksisterende. Vault-prøven :59-69, Linux-prøven :70-76 og Windows-prøven :77-80 bevares uændret. UI-stubben i :19-28 skal honorere standardværdien (ask :24 returnerer i dag den næste værdi i listen, også når den er tom), før navneprøver kan skrives.
- cli/README.md:54-56 og cli/MACOS.md:3 beskriver i dag kun adgangssætningslageret og at CLI'en ikke deler desktopappens Keychain. Begge skal rettes, når trinnet er bygget.
- docs/decisions.md skal have en CLI-post for de valgte nøgle- og regionregler, når de er truffet. Ingen eksisterende post dækker CLI-nøglering eller adgangssætning; en søgning efter vault, adgangssætning og CLI i docs/decisions.md gav ingen træffere om lageret.
- Desktop-filer ændres ikke. desktop/core/store.cjs:22-37, desktop/core/connections.cjs:96 og :151-156 samt desktop/core/key-window.cjs:174 læses kun.

**Risici:**
- Vault er samme objekt som safeStorage til Workbench (cli/app.cjs:20). Store.encryptionAvailable kalder isEncryptionAvailable (desktop/core/store.cjs:33). Hvis isEncryptionAvailable bliver true før oplåsning, kaster encryptString (cli/storage.cjs:29). Grænsefladen skal være præcis.
- unlock kaldes fra cli/connections.cjs:7 og :39, cli/aura.cjs:61 og cli/app.cjs:116. Ændres semantikken, skal alle fire kald stadig virke.
- Eksisterende brugere har nøgler i vault.json og settings.json krypteret med adgangssætningen. Uden migration kan de ikke læses uden adgangssætningen. Beslutning 4.
- Desktop-nøgler er krypteret under navnet i desktop/core/app-identity.cjs:10-21 (Aura Safe Storage eller det ældre navn). CLI'en kører uden Electron og kan ikke læse dem, og desktop kan ikke læse CLI-nøgler.
- Prøver må ikke skrive i det rigtige systemnøglering på udviklerens maskine. Adapteren skal injiceres i prøver.
- Ingen nøgleringsmekanisme findes i cli/ eller desktop/core i dag. Søgningen efter keytar, secret-tool, security find-generic-password, add-generic-password, CredRead, libsecret og keychain gav kun dokumentation (cli/README.md:56 og cli/MACOS.md:3). Native afhængigheder kræver prebuilt-binaries og en hævet CLI-version. Systemkald til security eller secret-tool er et valg under beslutning 1.
- Regionlinjen må først vises, når normalize har valideret nøglen (desktop/core/connections.cjs:155). Ellers vises en region for en nøgle, der afvises. cortiEndpoint kaster allerede for ukendte miljøer (:93).
- CLI-versionen skal hæves, når desktop/core ændres (docs/hackathon-aarsager.md:369). Udgivelse kræver brugerens ja under beslutning 9, som er beslutning 13 i docs/hackathon-aarsager.md:441. scripts/cli-release-contract.cjs:9-12 er citeret i årsagsdokumentet og er ikke læst i denne rettelse.
- Sikkerhed: nøglen må ikke optræde i logs, fejlbeskeder eller i ui.line. ui.protect bruges allerede (cli/connections.cjs:38).

**Bevidst uden for trinnet:**
- Låse og processer: SIGHUP, SIGKILL og efterladte motorer (cli/aura.cjs:89 og :102; cli/storage.cjs:64-82). Hører til nr. 11 i årsagsdokumentet, men ikke til dette trin.
- Dubletter ved fejlet login: cli/connections.cjs:40-41 gemmer før modellisten hentes. Rettes ikke her.
- Ctrl+C under netkald, plugin-ENOENT, pakkeprøven og udgivelsen af CLI-versionen.
- Rensning af nøgler (trin 10): den fælles cleanKey i desktop/core/connections.cjs:110-140 ændres ikke her.
- Desktop-appen: desktop/core/* og desktop/main.cjs ændres ikke. Desktop-prøverne skal bare fortsat bestå.
- Login for andre udbydere end Corti og ændringer i udbyderlisten (cli/connections.cjs:18-22).

### 12. komplai Run: status

**Mål:** Udgivet må først stå, når en kontrol har set den nye version svare på adressen. Indtil da skal kortet vise, at komplai har modtaget versionen, og at Aura kontrollerer adressen. Nuværende adfærd: READY sættes af Aura ud fra komplais aktive version (komplai-publish.cjs:135 og :181), ikke ud fra adressen; share-view.js:50 viser titlen Udgivet for READY uden kontrol; share-view.js:54 giver grøn tone, når udbyderstatus er checked, også når adressen ikke kan nås. En probe i scratchpad gav titlen Udgivet, grøn tone og verifikationen Startsiden kunne ikke nås samtidig. Hvem der kontrollerer adressen og med hvilket interval er ikke afgjort (beslutning 1 og 2).

**Kontrol:** holdt ikke ved sidste kontrol: Holder: false. Fejl: maal skriver som fakta at Aura kontrollerer adressen og at Udgivet må først stå, selv om beslutning 1 (kontrolkilde) og beslutning 3 (ordvalget) er åbne. Det skal flyttes til beslutningerKraevet eller markeres som venter på beslutning 1 og 3. Proeven om titlen Udgivet afhænger a

**Afhængigheder:**
- Venter på beslutning 1 (kontrolkilde) og beslutning 2 (interval og synlighed) for, hvilken prøve af timeren og hvilket kald der skal skrives.
- Venter på beslutning 3 for ordvalget Udgivet mod Upload modtaget i share-view.js:50 og deployment-setup.js:13. Beslutningen Udgiv i docs/decisions.md:54 dækker ordet for handlingen, ikke statusordet Udgivet.
- Venter på beslutning 4 for, hvilke kontrolfelter der kræves før grøn tone; de findes i share-view.js:25 (matched, different, built, too-large, unreadable).
- Komplais kontrolplads er begrænset (hackathon-aarsager.md:385-387, målt lokalt mod komplais kode, ikke i drift), så intervallet afhænger af beslutning 2.
- Ingen bindende regel i docs/decisions.md om intervallet eller statusordet for komplai Run; docs/decisions.md:158 gælder forhåndsvisningens kontrol, ikke udgivelsesstatus.

**Prøver (ingen er kørt endnu):**
- Eksisterende prøve share-view.test.cjs:20-27 (READY fra upload giver titlen Udgivet og neutral tone) skal opdateres bevidst; den er kørt i dag og 10 af 10 er grønne, og den fejler ikke før rettelsen, fordi den låser den nuværende adfærd.
- Eksisterende prøve komplai-publish.test.cjs:74 (deploy giver state READY direkte) skal opdateres bevidst; den er kørt i dag og 9 af 9 er grønne.
- Ny prøve, ikke i repoet: READY uden adressekontrol må ikke vise titlen Udgivet. Fejler i dag: set ved scratch-probe, som gav title Udgivet. Prøven skal skrives ind i repoet før rettelsen.
- Ny prøve, ikke i repoet: READY med provider checked og site unreachable må ikke give positiv tone. Fejler i dag: set ved scratch-probe, som gav tone positive og verifikationen Startsiden kunne ikke nås.
- Ny prøve for Deployments.check i desktop/tests/deployments.test.cjs: adressen svarer ikke, så må status ikke ende som bekræftet udgivet. Ikke kørt.
- Timer-prøve for deployment-setup.js:328 (30 sekunder, synlighed og Deling). Ikke kørt; det er ikke undersøgt, om desktop/tests/deployment-setup.test.cjs dækker den.

**Filer (citater ikke fuldt verificeret):**
- desktop/core/komplai-publish.cjs:135 sætter state READY, når komplais overblik viser den aktive version; desktop/core/komplai-publish.cjs:181 sætter READY i status, når aktiv version matcher
- desktop/core/deployments.cjs:138 er start på check; desktop/core/deployments.cjs:157-162 henter adressen kun når state er READY og url findes, og ændrer ikke state
- desktop/ui/share-view.js:50 giver READY titlen Udgivet og UPLOADED titlen Upload modtaget; desktop/ui/share-view.js:54 giver positiv tone, når provider status er checked
- desktop/ui/deployment-setup.js:13 mapper READY til Udgivet; desktop/ui/deployment-setup.js:287 viser knappen kun når deling er slået til; desktop/ui/deployment-setup.js:328 kontrollerer hvert 30. sekund, betinget af trackingRoot, ikke skjult dokument, synligt workspace, sharingOn og automatisk tracking eller gemt sidste udgivelse
- desktop/ui/index.html:313 har knappen deployment-tracking-refresh
- desktop/tests/share-view.test.cjs:20-27 er eksisterende prøve der skal opdateres bevidst; desktop/tests/komplai-publish.test.cjs:74 er eksisterende prøve der skal opdateres bevidst
- Scratchpad-probe: /private/tmp/claude-501/-Users-bjornskalkam-GitHub-os-harness/ca377faa-d8ab-4e98-a620-4c00381c65d9/scratchpad/udgivet-probe.cjs med output i udgivet-probe.out

**Risici:**
- Hyppig adressekontrol belaster komplais enkelte kontrolplads, hvis flere åbne projekter kører timeren samtidig (hackathon-aarsager.md:385).
- Kontrollen henter kun startsiden, så grøn tone kan vises, mens resten af appen fejler; share-view.js verification skelner allerede startside fra resten, men kortet skal tydeligt skelne det samme.
- En ændring af receiptSummary og checks kan bryde de eksisterende prøver share-view.test.cjs:20-27 og komplai-publish.test.cjs:74; de skal opdateres bevidst, ikke udelades.
- Hvis kontrollen flyttes til hovedprocessen, ændres kald mod komplai; det er ikke i koden i dag og er ikke valgt.

**Bevidst uden for trinnet:**
- Promte og GitHub Pages hører til trin 8 og er ikke med her.
- Forslaget i hackathon-aarsager.md:401 om kun at hente appens adresse i hovedprocessen er ikke i koden og er ikke valgt; det hører under beslutning 1.
- Oversættelse af komplais fejlkoder busy, not_found og transfer_limit (hackathon-aarsager.md:402) er et eget forslag og er ikke taget med her.
- Ændringer i komplais egen kode og drift er uden for denne specifikation.

### 13. Ende-til-ende-prøve for godkendelseskort

**Mål:** En ny prøve kører den rigtige Electron-app og OpenCode mod en kontrolleret lokal model og fejler, hvis et fast, typisk byggeforløb giver flere godkendelseskort end en grænse, som brugeren fastsætter. Grænsens tal venter på beslutning 1, og tællerens element venter på beslutning 2. Prøven skal køres mod nuværende kode og fejle først; det er ikke gjort endnu.

**Kontrol:** holdt ikke ved sidste kontrol: Skeptisk gennemgang af det rettede resultat for trin 13 mod commit 8ed23c9 på main; ingen filer ændret og ingen Git-handlinger udført. Holder er false. Fejl 1: filer-feltet siger at standardlabelen Tillad én gang ikke bruges til filændringer i projektet; det er forkert, fordi desktop/ui/approvals.js

**Afhængigheder:**
- Trin 3 (approvals-policy.cjs læser metadata.parentDir og filepath) er ikke bevist nødvendig for grænsen før prøven er kørt. Produktkoden læser filepath, filePath og toolInput (approvals-policy.cjs:48); parentDir findes ikke i produktkoden, kun i desktop/tests/opencode-contract.test.cjs:68-81. Hvilke filændringer der i dag får 'Denne handling', er ikke målt; approvals-policy.cjs:185 giver 'Filændring: ...', når mål findes.
- Trin 4 (AI'en holdes i projektet, .aura/tmp som TMPDIR) påvirker kun kort for skrivning til temp-mapper. Det er planlagt i docs/plan-hackathon-aarsager.md og ikke bygget; effekten er ikke målt.
- Trin 6 (kommandosandkassen lagt om, Godkend alt på ny model) påvirker kommandoer. decisions.md:387 siger kun, at kommandoer uden for projektet spørger hver gang. Hvilke kommandoer i projektmappen der må køre uden kort, venter på beslutning 8.
- Prøven må gerne skrives før trin 3, 4 og 6, og skal være rød før dem. Den venter på beslutning 1 og 2 og bruger ui-test-helpers.cjs, som findes.

**Prøver (ingen er kørt endnu):**
- Kortgrænse for et fast byggeforløb (verify-approval-cards.cjs, ny). Påstand: forløbet giver højst N godkendelseskort, hvor N er grænsen fra beslutning 1, og tællingen sker på elementet fra beslutning 2. Status: ikke kørt; prøven er ikke set fejle. Forventet rød i nuværende kode, fordi approvals-policy.cjs:145 kun giver standardlabel 'Denne handling' og persistable false, men det er ikke målt.
- Læsning og søgning i projektmappen (verify-approval-cards.cjs, ny). Påstand: et forløb med read, glob og list inden for projektmappen giver 0 godkendelseskort. Status: ikke kørt. read er allow via read-map i engine.cjs:52, som bruges i :66 og :70; glob og list er allow i :66 og :70. grep er ask både i Samtale/Planlæg (engine.cjs:66) og i Byg (engine.cjs:70). Hvis grep skal give 0 kort, kræver det beslutning 4, og prøven er ikke lovet grøn af trin 3, 4 og 6.
- Tællervagt (verify-approval-cards.cjs, ny). Påstand: et forløb med præcis K kendte godkendelser, fx 3 filændringer uden for projektet, tæller K, og et forløb uden godkendelser tæller 0. Status: ikke kørt; forventet grøn, hvis tælleren er korrekt. Vagten skal også vises at fejle: en tæller, der kun ser #approvals og ikke Aktivitet, skal give forkert tal på et kendt forløb. Vagten kan først skrives, når beslutning 2 er truffet.

**Filer (citater ikke fuldt verificeret):**
- NY desktop/scripts/verify-approval-cards.cjs (forslag, navnet kan ændres; findes ikke i dag). Electron via playwright _electron.launch med --user-data-dir i temp-mappe som i desktop/scripts/verify-approvals.cjs:63. Projekt med Git i temp-mappe som i verify-approvals.cjs:15-19 (git-indpakning i bin) og projektoprettelse i :66-67.
- Kontrolleret model: HTTP-server på 127.0.0.1 med /v1/models og SSE-svar som i verify-approvals.cjs:23-51. Manuskriptet er fast pr. brugerbesked i stedet for tekstmatch som i :28-42. Manuskriptet skrives ind i prøven, fordi målingen 26 trin og 28 kort ikke ligger i repoet.
- Tælling med MutationObserver på det element, beslutning 2 vælger: kortene i #approvals eller Aktivitet-posterne .activity-entry.kind-approval (selector som i verify-approvals.cjs:136). Skærmbilleder til scratchpad med capture-mønsteret fra verify-approvals.cjs:54.
- Projektfilændringer godkendes i manuskriptet med 'Tillad for denne opgave', som ligger bag 'Flere valg' (approvals.js:147). approve(page, 'Tillad for denne opgave') i ui-test-helpers.cjs:152-158 klikker Flere valg, når knappen ikke er synlig. Det følger decisions.md:383 og :385-387. Standardlabelen 'Tillad én gang' bruges ikke til filændringer i projektet.
- desktop/package.json: ny script-linje efter test:approvals (package.json:64), fx test:approval-cards. Ingen ændring i core/, ui/ eller eksisterende prøver i dette trin.
- Genbrug uden ændring: desktop/scripts/ui-test-helpers.cjs:152 (approve), :165 (resultOption) og forbidGitWrites/assertNoGitWrites i eksporten på :187. addConnection, taskOptions og selectMode bruges i verify-approvals.cjs:68, :70 og :71.

**Risici:**
- Scenariet er konstrueret og ikke reproducerbart fra repoet. Målingen 26 trin, 28 kort og 13 kort med 'Denne handling' ligger hverken i repoet eller i scratchpad/spec; kun docs/plan-hackathon-aarsager.md citerer den. Tallet må ikke bruges som bevis, før prøven er kørt.
- Tælling på DOM-tekst er skrøbelig. Teksten 'Denne handling' findes ikke i desktop/ui. Kortets titel kommer fra explanation() (approvals.js:27 og :94). Labelen går via p.policy.label i approvals.js:137 og som parameter label i approval-view.js:57-61. Tæl derfor ikke på teksten.
- verify-approvals.cjs er ikke kørt. Den bruger 'Tillad én gang' (verify-approvals.cjs:93, findes i approvals.js:123). Det skal afklares, før den nye prøve sammenlignes med den.
- Fake-modellen styrer kun Auras politik pr. værktøjskald, ikke modellens kvalitet. Prøven er ikke bevis for, hvor ofte Corti eller Claude spørger.
- Electron-kørsel er tung og afhænger af byggede runtime-filer under desktop/.runtime. Den må ikke køres i CI; AGENTS.md under GitHub Actions og forbrug tillader kun manuel start.
- dce68ea er commit for 0.6.0-beta.1 (klargør Aura v0.6.0-beta.1). Der står motorreglerne på andre linjer end i 0.7.0-beta.1 (tag v0.7.0-beta.1), så målingen og citaterne fra 0.7 må ikke blandes.

**Bevidst uden for trinnet:**
- Rettelser i approvals-policy.cjs, engine.cjs, command-sandbox.cjs eller chat-session.cjs. De hører til trin 3, 4 og 6.
- Ændring af verify-approvals.cjs eller ui-test-helpers.cjs. De genbruges kun.
- Ændring af labelteksten 'Denne handling' i approvals-policy.cjs:145 eller tekster i ui/approvals.js. Det er ikke nødvendigt for trinets påstand.
- Valgtællingen på selve kortet (højst tre til fire synlige valg, AGENTS.md og DESIGN.md). Den kontrol er en separat skærmprøve med measure:screens.
- Kontraktprøven for godkendelsernes former (trin 3) og måling af godkendelsestider.
- Windows, CLI, npm-cache og udgivelse. Ingen af dem indgår i prøven.
- Oprettelse eller ændring af workflows i .github. Der ændres ingen CI-opsætning.
- Afgørelse af beslutning 1 til 8. Prøven og specifikationen afgør ikke tallene.


## Status 2. november 2026

Det her er den faktiske status. Hvert trin er bygget med prøver, der fejlede først, og prøvesættet er grønt efter hvert trin (789 af 789 ved seneste kørsel). Ingen af trinene er verificeret i Electron med en rigtig OpenCode-motor endnu.

| Trin | Status | Hvad er gjort | Hvad mangler |
|---|---|---|---|
| 1 #58 | bygget | Cherry-pick med Partheds forfatter bevaret; konflikten i engine.cjs løst | Den rigtige Electron-prøve test:recovery |
| 2 #56 | bygget | Fælles liste over beskyttede stier overtaget | Redigering af references/ er nu blokeret; accepteret |
| 3 godkendelser | bygget | Mappeadgang læser filepath og mønsteret <mappe>/*; kontraktprøve del 2 over alle 55 optagne forespørgsler | Tre skrivninger til en ny mappe er undtaget og hører til trin 4 |
| 4 AI-filer | bygget | .aura/tmp i projektet; TEMP/TMP/TMPDIR; nægtelse af skrivning uden for projektet i Byg uden kort; korttitler skriv/se; udeladt fra ændringer og kopier | Ende-til-ende-prøve mod rigtig motor |
| 5 udbyderfejl | bygget | 408, 429 og 5xx videresendes til OpenCode med Retry-After; 401-404 er endelige | OpenCode genforsøger rigtigt; 409 er en risiko, der skal måles |
| 6 sandkasse | bygget | Husket kommando tænder ikke sandkassen; «Godkend alt i denne samtale» under Flere valg; stabil sandkasse; motoren genstartes kun ved behov; CLT må læses | Knappen er ikke set i Electron; netadgang uændret |
| 7 forhåndsvisning | delvist | Resultatet af kontrollen går til modellen som data ved næste besked | AI'en kan ikke selv starte forhåndsvisningen; samtykke huskes ikke; serverstatus til modellen mangler |
| 8 netlister | bygget | Standardlisten for nye projekter: Tailwind, webskrifter og billeder fra https; eksisterende projekter ændres ikke | Ikke set i Electron |
| 9 prompt | bygget | AGENTS.md gentages ikke, når den er identisk med grundreglerne | Størrelse ikke målt før og efter |
| 10 nøgler | delvist | Fejlbesked for adresser der ikke findes (ENOTFOUND) | Den fælles rensning findes allerede; token=-præfikser og regionsrækkefølge er ikke bygget |
| 11 CLI | ikke bygget | | Nøglering er en separat udgivelsesstrøm; ikke besluttet at bygge i beta-2 |
| 12 komplai | ikke bygget | | Intervallet og hvem der kontrollerer adressen er din beslutning |
| 13 ende-til-ende | ikke bygget | | Kortgrænsen på fem pr. opgave og samlingen af resterende kort; prøven mod rigtig motor |

**Åbne beslutninger, der er din:** komplais adressekontrol og interval (trin 12). Alt andet er valgt og ligger i docs/decisions.md under «Beslutninger for 0.8.0-beta.2».

**Før beta-2 kan udgives:** trin 7 og 13 skal være bygget, trin 12 besluttet af dig, og hele løbet skal køres i Electron mod en rigtig OpenCode-motor. Udgivelsen kræver derefter en ny version, pakning, signering, notarisation og to Actions-kørsler, som du godkender selv.

## Status 3. november 2026, korrigeret efter gennemgangen

Tabellen fra 2. november gav indtryk af, at trin var færdige, som kun var delvist bygget, og to trin var forkerte (se `teststatus.md`). Denne tabel er målt mod retningspunkterne i `hackathon-aarsager.md`, ikke mod trinnene. **Ingen af de tretten årsager er lukket.** Alt er kun set som enhedsprøve, kørt mod den rigtige motor med en falsk model, eller (godkendelser, planlægning, samtale) i Electron. Intet er kørt med en rigtig model eller udgivet.

| # | Årsag | Bygget | Mangler |
|---|---|---|---|
| 1 | Spørger om alt | Projektmappen er grænsen for nye projekter: 0 kort for en typisk opgave på politikniveau (7 uden). Gentagelsesvagt og søgning er uændret | Søgning med beskyttelse; gentagelsesvagten besvares automatisk; «Før du sender» pr. udbyder; CLI og Windows; måling med en rigtig model |
| 2 | Ud af projektmappen | `.aura/tmp` med `.gitignore`, TMPDIR via `shell.env`, skrivevagt i motoren, mappefix for OpenCodes former, korttitler, link-kontrol | Oprydning efter opgaver; AI'en må ikke læse motorens data; projektdata nøglet på id; flytning af tool-output |
| 3 | Planer | Planen bevares (nye beskeder, fejl, Stop); tolerant genkendelse; markører kun i Samtale; «Ret med AI» i Byg | Egne agenter til Samtale og Planlæg; kort regelsæt for Byg uden plan; «Byg nu»-knap; to etiketter for Byg og valg ved skrivefeltet (PR #53) |
| 4 | Motoren glemmer | Én motor og én session tjener Samtale, Planlæg og Byg med agent pr. besked (bevist mod den rigtige OpenCode: samme proces og session, kun Byg kan skrive); identiteten er forbindelse, model, regler, skills og sandkasse; historik følger med ved modelskift | Egne agentnavne, så OpenCodes «Plan Mode»-påmindelse ikke indsættes; start ved åbning af projektet |
| 5 | Udbyderfejl | 408, 429 og 5xx videresendes til OpenCode; Retry-After højst 120 s | Vagt pr. opgave med «Vent»/«Stop»; forklaring ved langsom motorstart; udbyderens fejltekst bag «Se detaljer»; 409-risikoen er ikke målt |
| 6 | Forhåndsvisning | Værktøjet `aura_preview` med samtykke, der huskes; klar ud fra serverens egen adresse; «Ret med AI» sender i Byg | Opstartsfil i projektet; «Ret med AI» med maskeret log til serverfejl; CDN-diagnosen til AI'en; dialogen med 3 til 6 klik |
| 7 | Bygger i blinde | Resultatet af kontrollen går til modellen som data; værn bevaret i prompten | Designskill med skala og tokens; startskabeloner; højere grænser for ukendte modeller |
| 8 | Prompten | `AGENTS.md` gentages ikke, når den er en kopi af grundreglerne | Opgavens id står stadig tidligt i prompten (cache); planen flere gange; snævrere skills |
| 9 | Sandkasse | En husket kommando tænder ikke sandkassen; «Godkend alt i denne samtale»; Command Line Tools læses; HOME uden for projektet; ingen compile-cache | Regelnøglen med input; localhost i sandkassen; original kommando i historik; Windows |
| 10 | Nøgler | Fejlbesked for adresser, der ikke findes | `token=`-præfiks; kontrol før gem; region i navnet; Azure-adresse |
| 11 | CLI | Intet | Alt (nøglering, region, SIGHUP, låse, Ctrl+C, version) |
| 12 | komplai | Kortet er ikke positivt, når adressen ikke svarer eller giver en fejlside; «travlt» bevarer tidligere kvittering | Ventetilstand og overvågning (hvem og hvor tit er brugerens afgørelse); komplais øvrige fejlkoder i alle stier |
| 13 | Ende til ende | Kortgrænse på politikniveau med optagne forespørgsler; Electron-prøverne for godkendelser, planer og samtale grønne | Ende-til-ende med en rigtig model; pakkeprøve mod tarballen; «Godkend alt»-knappen og de nye standarder i appen |

**Taget ind:** PR #58 og #56 (forfatter bevaret) og Dependabot #59 (`node-forge` 1.4.2, `undici` 7.30.1). **Ikke taget ind:** #53 (arbejdsflow ved skrivefeltet, konfliktfri mod main, men bryder reglen om højst tre til fire valg på spørgsmålskortet), #54, #55 og #57, samt Dependabot #11 og #52 (OpenCode 1.19.x).
