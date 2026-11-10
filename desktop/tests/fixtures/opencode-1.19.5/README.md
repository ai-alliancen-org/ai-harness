# OpenCode 1.19.5: optagede tilladelsesforespørgsler

Her ligger rigtige `permission.asked`-forespørgsler fra OpenCode 1.19.5, den version Aura starter (`VERSION` i `core/engine.cjs`). De er optaget 5. november 2026 med `scripts/record-opencode-contract.cjs`, en falsk model på 127.0.0.1 og ingen nøgler. `tests/opencode-contract.test.cjs` bruger dem. Formatet, sættene og pladsholderne er de samme som i `../opencode-1.18.33/README.md`, som stadig ligger der og beskriver de 13 målte fakta for 1.18.33.

Optaget på macOS arm64, Aura `d0c3fca` med ucommittede ændringer (feltet `aura`). `politik/sandkasse.json` er optaget igen 9. november 2026 på Aura `1cfa7a6` med ucommittede ændringer, efter rettelsen af runnerens socketmappe (se nedenfor). Forløbene `byg-git-soeg` og `byg-uden-git-soeg` er optaget igen 10. november 2026 på Aura `1cfa7a6` med ucommittede ændringer, efter rettelsen af søgevagten (se nedenfor). Binæren er hentet af `npm run runtime:prepare` og kontrolleret mod `integrity` i `runtime-lock.json`.

## Hvad der adskiller sættet fra 1.18.33

Sættet har 113 forløbsoptagelser mod 156, fordi 1.18.33-sættet er optaget på Aura `d816a9e`, før skrivevagten og de beskyttede stier fandtes. Det er målt, at forskellen er Auras og ikke motorens: den samme optager på den samme Aura-kode, men med 1.18.33-binæren, gav de samme filer, de samme former, de samme rækkefølger og de samme værktøjssvar som 1.19.5. Den eneste forskel var en tom linje sidst i ét grep-svar (`byg-git-soeg__grep-uden-sti`), som kommer af Auras søgevagts fjernelse af `.env`-blokken og af søgerækkefølgen. Kørslen med 1.18.33 ligger ikke i repoet.

Konkret er der ændret, fordi Aura svarer, før OpenCode spørger:

- **Skrivninger uden for projektet** (`write-ude-*`, `edit-ude-absolut`, `patch-tilfoej-ude-*`, `patch-to-filer`, `write-original-projekt`, `write-uden-for-repo`, `write-soeskende-i-repo`) stoppes af Auras skrivevagt med beskeden "Skriv ikke uden for projektmappen". De har ingen forespørgsel i sættet (`file: null` i `INDEX.json`). 48 filer er væk af den grund.
- **`cat ~/.ssh/id_rsa` i `politik/uden-sandkasse.json`** afvises af en regel i Auras konfiguration, før OpenCode spørger. `skal/config-shell.json` har stadig mappeforespørgslen for samme kommando.
- **Opgavens arbejdsmappe** ligger i projektet (`.aura/tmp/<opgave>`), ikke i `STORE/scratch`. `write-scratch` giver derfor kun en filændring og ingen mappeforespørgsel. Pladsholderen `SCRATCH` er rettet i `INDEX.json` og i optageren.
- **Værktøjets tilstand ved spørgsmålet** er `running` med udfyldt input for bash, grep og apply_patch. I 1.18.33-sættet var den `pending` med tomt input. Samme Aura med 1.18.33 gav også `running`, så Aura må ikke bygge på, at inputtet er tomt.
- **`grep-hemmelighed`** returnerer nu "No files found", fordi søgevagten fjerner `.env`.
- **En godkendt søgning uden for projektet** (`grep-sti-ude`, `grep-sti-ude-relativ`) og **i motorens gemte output** (`grep-tool-output`) giver resultater. Indtil 10. november 2026 gav de "No files found", fordi søgevagten skjulte alt uden for projektet, også efter et ja (fund 3 i gennemgangen af beta 3). Forespørgslernes form, rækkefølge og Auras afgørelser er uændrede ved genoptagelsen. Kun id'er, portnumre, optagerens proces-id i `bash-redirect-tmp` og rækkefølgen af de to fund i `byg-git-soeg__grep-uden-sti` er anderledes. Optag med appens egen Node og npm forrest i `PATH` og uden `--arbejde` i en mappe med et UUID i stien: npm skjuler UUID'er i sine fejl, så stien ellers ikke kan genkendes.
- **`plan-git`** ender i `idle` med en `doom_loop`-forespørgsel (trin 3c, `doom_loop: 'ask'` i Planlæg og Samtale), ikke i `session.error`.

## Hvad der er målt igen på 1.19.5, og hvad der ikke er

Målt igen og uændret (påstande i kontrakttestens del 1, alle bestået): formerne for mappeadgang fra fil-, søge- og læseværktøjer og fra kommandoer (fakta 6), mønstrene for filændring med og uden Git og samtalekopi (6), søgning før mappe (7), læsning og `glob` kun mappe (7), kommandoer med delte mønstre og præfikser (3, 6), webfetch, gentagelsesvagt, skill og huskeliste (6), omdirigeringer opdages ikke og `~` er motorens HOME i `skal` (4, 5), skal i `config.shell` ændrer ikke forespørgslerne (3), HEADs sandkasse (9, se herunder), gentagelsesvagten og kaskaden ved afvisning med og uden `continue_loop_on_deny` (1, 2), links i projektet (11), mønsterregler (12) og mapper og skills (13).

Sandkassen: optagelsen fra 5. november havde de rigtige forespørgsler, men alle fire isolerede kommandoer fejlede med `listen EADDRINUSE`, fordi kommandobeskyttelsens proxy-socket lå i opgavens lange TMPDIR, og navnet blev afkortet ved 104 byte. Kontrakttesten tjekkede kun formen og bestod alligevel. Runneren lægger nu sine sockets i en kort, privat mappe under /tmp, og sættet er optaget igen: forespørgslerne er de samme, og kommandoerne kører (`ls -la`, `git status`, `HEJ`), mens `cd .. && ls` nægtes af sandkassen. Testen påstår nu også udfaldet.

Ikke målt igen, fordi Aura svarer først. Kun 1.18.33-sættet viser dem, og kildekoden til `write` og `edit` har ingen ændringer mellem versionerne:

- At en filændring uden for projektet først spørger om mappen og så om filen (fakta 7).
- At et projekt inde i en Git-rod spørger om mappen ved en skrivning uden for roden, og at en skrivning i en søskendemappe har mønsteret `andet-projekt/fil.txt` (fakta 8).
- At `cat ~/.ssh/id_rsa` i politiksættet giver mappen `APPDATA/runtime/noegle/home/.ssh` (fakta 4, delvist; `skal` viser den samme form).

Kun macOS arm64 er optaget.

## Sådan optages der igen

Se `../opencode-1.18.33/README.md`. Optageren er rettet til den nuværende ChatSession: `bench.prepare` får beskeden med, og `bench.send` får `contextBinding` fra gennemgangen. Uden det afviste ChatSession afsendelsen med "Gennemgå den aktuelle kontekst før afsendelse".
