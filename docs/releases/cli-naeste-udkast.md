# Udkast: næste udgivelse af Aura CLI

**Udkast. Gælder ikke den udgivne CLI 0.2.0-beta.6.** De gældende vejledninger (`cli/MACOS.md`, `cli/WINDOWS.md`, `cli/LINUX.md`, `cli/README.md`) og `docs/releases/cli-beta.md` beskriver 0.2.0-beta.6: adgangssætningslageret og OpenCode 1.18.33. Koden på denne gren er nyere. Teksterne her skal ind i de gældende filer i samme commit som versionsløftet til næste CLI-udgivelse, ikke før. Versionsnummeret er brugerens valg. Så længe udkastet findes, afviser `npm run test:cli` og udgivelseskontrollen en anden version i `package.json` end den udgivne, som står ovenfor (`draftProblem` i `scripts/cli-release-contract.cjs`); en lokal prøvepakke med `--local` kan stadig bygges.

## Det ændres for brugeren

- API-nøgler gemmes i computerens nøglering: macOS Nøglering, DPAPI gennem PowerShell på Windows og en nøgletjeneste gennem `secret-tool` (libsecret) på Linux. Adgangssætningen bruges kun som reserve, når nøgleringen ikke kan bruges, og CLI'en siger det.
- Nøgler fra 0.2.0-beta.6 ligger i adgangssætningslageret. Første gang en sådan forbindelse bruges, beder CLI'en om den gamle adgangssætning og flytter alle gamle nøgler til nøgleringen. Når de er flyttet, bruges adgangssætningen ikke mere; ved en forkert adgangssætning flyttes intet, og CLI'en spørger igen næste gang. `aura login` tilbyder også at flytte dem med valgene **Flyt nu (anbefalet)** og **Ikke nu**. Har man glemt adgangssætningen, fjernes de gamle forbindelser med `aura logout`.
- OpenCode-motoren er 1.19.5.
- Komplai er ikke et AI-valg i terminalen. En gammel Komplai-forbindelse kan kun fjernes med `aura logout`. Kan dens nøgle ikke læses, fjernes den efter et ja kun fra Aura, og adgangen kan tilbagekaldes i Komplai.
- **AI på min computer** gemmer Ollamas egen adresse, også når den er skrevet med `/v1`.
- Ctrl+C under login og modelvalg stopper selve netkaldet, så terminalen ikke venter på tidsgrænsen.
- En lås fra en Aura, der blev afbrudt, overtages automatisk, når processen ikke findes mere, eller når dens nummer nu bruges af et andet program. `aura unlock` viser procesnummeret.

## Tjekliste ved udgivelsen

1. Brugeren vælger versionsnummeret. `package.json` og `package-lock.json` får samme version.
2. Ret filnavnet `aura-harness-VERSION.tgz` i de tre platformsguider. Pakningen afviser gamle filnavne.
3. Ret OpenCode-versionen i de tre platformsguider til den, `package.json` låser (i dag 1.19.5). En udgivelsespakning afviser guider med en anden version (`guideProblem` i `scripts/cli-release-contract.cjs`); en lokal prøve med `--local` kontrollerer kun filnavnet.
4. Erstat afsnittene nedenfor. Linjenumrene passer til de gældende guider, som de står nu.
5. Erstat `docs/releases/cli-beta.md` med noterne nederst, og skriv afprøvningen efter de prøver, der faktisk er kørt.
6. Byg og afprøv pakken som beskrevet i `docs/udgivelse-cli.md`, også flytningen af et lager fra 0.2.0-beta.6.
7. Afprøv nøglen på en rigtig Windows-maskine, før Windows kaldes afprøvet. Kør `npm run test:cli` i en kloning dér: de tre prøver «fund 44 (Windows)» i `cli/tests/f-windows-dpapi.test.cjs` skal bestå og må ikke være sprunget over. Slå derefter PowerShell-modullogning for alle moduler og transskription til på en prøvemaskine, kør `aura login`, og send en besked. Nøglen må hverken stå i hændelse 4103 og 4104 under Microsoft-Windows-PowerShell/Operational eller i transskriptet.
8. Slet dette udkast i samme commit.

## cli/MACOS.md

Linje 3, sidste sætning:

> CLI'en gemmer API-nøgler i macOS Nøglering under sit eget navn og deler dem ikke med desktopappen.

Linje 25, OpenCode-versionen:

> npm henter den fastlåste OpenCode-motor. `doctor` skal finde Node, Git og OpenCode 1.19.5. Stop ved fejl. Vejledningen kræver hverken global installation eller `sudo`. Slå ikke Gatekeeper eller arbejdspladsens kontroller fra for at få pakken til at starte. Terminalpakken er ikke den signerede og notariserede desktopinstallation.

Linje 34:

> Opret et nyt projekt med opdigtede data. Tilslut en AI, du har adgang til, og gennemgå data og pris. Nøglen indtastes skjult. CLI'en skriver, at nøgler gemmes i macOS Nøglering; der spørges ikke om en adgangssætning. Kan nøgleringen ikke bruges, fx i en SSH-session, skriver CLI'en det og beder dig i stedet vælge en adgangssætning.

Linje 42:

> Kontrollér model, historik og filer, skjult indtastning, at der ikke spørges om en adgangssætning, og mapper med mellemrum. Har du brugt 0.2.0-beta.6 med samme `AURA_HOME`, spørges der om den gamle adgangssætning, når nøglerne flyttes til nøgleringen, og ikke igen, når de er flyttet; notér, hvad der skete. Brug kun én Aura-proces med samme datalager ad gangen. Prøven kræver ingen udgivelse eller push til GitHub.

## cli/WINDOWS.md

Linje 33:

> `doctor` skal finde Node, Git og OpenCode 1.19.5. Stop ved fejl, og send fejlteksten. Brug ikke en anden tilfældig Aura-pakke som erstatning. Kommandoen `aura.cmd` undgår PowerShells eventuelle blokering af npm-genererede `.ps1`-filer.

Linje 46:

> Ved valg af AI kan du bruge en forbindelse, du allerede har adgang til. API-nøgler indtastes skjult, aldrig som del af kommandoen. CLI'en krypterer dem med Windows' DPAPI, så kun din Windows-konto kan åbne dem, og skriver det i terminalen. Blokerer arbejdspladsen PowerShell, skriver CLI'en det og beder dig i stedet vælge en adgangssætning. Brug ikke rigtige borgerdata i prøven.

Linje 54, punkt 5:

> 5. Skriv `/exit`. Start igen med `aura.cmd resume` som nedenfor. Kontrollér samtale, plan, modelvalg og filer. Der må ikke blive spurgt om en adgangssætning. Har du brugt 0.2.0-beta.6 med samme `AURA_HOME`, spørges der om den gamle adgangssætning, når nøglerne flyttes, og ikke igen, når de er flyttet. Data må ikke slettes, heller ikke ved en forkert adgangssætning.

Linje 89, feltet i rapporten:

> Nøglen gemt uden adgangssætning, og CLI'ens besked om DPAPI:

Linje 96, sætningen om nøglering:

> CLI'en bruger DPAPI gennem PowerShell til sine egne nøgler og læser ikke desktopappens. De krypterede nøgler ligger i datamappen under `keys`.

## cli/LINUX.md

Linje 25: `OpenCode 1.18.33` bliver `OpenCode 1.19.5`.

Linje 36, de to sidste sætninger:

> API-nøglen indtastes skjult. Den gemmes i computerens nøgletjeneste gennem `secret-tool` (libsecret), fx GNOME Nøglering eller KWallet. Mangler `secret-tool` eller en kørende nøgletjeneste, skriver CLI'en det og beder dig i stedet vælge en adgangssætning til Auras eget krypterede lager.

Linje 42, punkt 5:

> 5. Afslut med `/exit`, og genåbn med kommandoen nedenfor. Kontroller historik, modelvalg og filer. Med nøgletjeneste spørges der ikke om en adgangssætning. Uden nøgletjeneste bruges adgangssætningen; en forkert adgangssætning må ikke slette data.

Linje 52:

> Du kan bruge CLI'en i en interaktiv SSH-terminal med en API-nøgle eller en lokal AI. Nøglen indtastes skjult. Over SSH kører der sjældent en nøgletjeneste; så skriver CLI'en det og gemmer nøglen i Auras eget lager, krypteret med en adgangssætning, du vælger.

## cli/README.md

Linje 54 erstattes af tre afsnit:

> Terminalversionen gemmer API-nøgler i **computerens nøglering**: macOS Nøglering, DPAPI gennem PowerShell på Windows og en nøgletjeneste gennem `secret-tool` (libsecret) på Linux. Nøgler indtastes skjult og skal ikke skrives i kommandoer, miljøfiler eller shellhistorik. Hver datamappe (`AURA_HOME`) har sine egne poster.
>
> Kan nøgleringen ikke bruges, fx over SSH eller uden nøgletjeneste, skriver CLI'en det og bruger i stedet **et separat lager krypteret med AES-256-GCM**, med nøgle afledt af en adgangssætning gennem scrypt. Adgangssætningen gemmes ikke og kan ikke gendannes. Ved forkert adgangssætning bevares lageret. `AURA_KEYCHAIN=off` vælger altid dette lager, fx i automatiske prøver.
>
> Nøgler fra 0.2.0-beta.6 ligger i adgangssætningslageret. Første gang en sådan forbindelse bruges, beder CLI'en om adgangssætningen og flytter alle gamle nøgler til nøgleringen. Når de er flyttet, bruges adgangssætningen ikke mere. `aura login` tilbyder også at flytte dem. Har du glemt adgangssætningen, kan de gamle forbindelser fjernes med `aura logout`; en gammel Komplai-browserforbindelse fjernes da kun fra Aura, og adgangen kan tilbagekaldes i Komplai.

Linje 56, sidste sætning:

> CLI'en læser ikke desktopappens nøgler og kræver ikke Electron. Uden nøgletjeneste bruger den adgangssætningslageret.

Linje 64, sidste sætning:

> Nøgler i nøgleringen kan læses af programmer, der kører som din bruger, mens du er logget ind. Adgangssætningslageret beskytter kun nøglerne, mens det er låst.

Linje 96, første to sætninger:

> På Windows køres samme brugerforløb i både CMD og PowerShell. Kontrollér stier med mellemrum, skjult nøgleindtastning, Ctrl+C, at nøglen gemmes uden adgangssætning, flytning af nøgler fra 0.2.0-beta.6 og modelvalg. På Linux prøves både en grafisk session med nøgletjeneste og en terminal uden, hvor adgangssætningen bruges.

## Nye udgivelsesnoter til docs/releases/cli-beta.md

> Aura CLI er terminaludgaven til udviklingsmaskiner med Node 22.12 eller nyere, npm og Git. Samme npm-pakke bruges på Windows, Linux og macOS; npm henter den versionslåste OpenCode-motor (1.19.5) til din platform. Pakken indeholder hverken AI-model, kreditter eller Electron-appen.
>
> Hent npm-pakken og `SHA256SUMS.txt` fra denne udgivelse. Kontrollér filen, og følg `WINDOWS.md`, `LINUX.md` eller `MACOS.md`. `CLI-RELEASE.json` angiver version og kildecommit. Installationen kræver ingen kloning af repositoryet, global npm-installation eller ændring af PowerShells scriptpolitik.
>
> **Afprøvning:** Skriv, hvad der faktisk er kørt, og på hvilke platforme. En platform er uprøvet, indtil guiden er kørt på en rigtig målmaskine. Udgivelseskontrollen kontrollerer arkiv, kildekode og kontrolsummer; den erstatter ikke installationsprøverne.
>
> **Nøgler:** API-nøgler gemmes i computerens nøglering: macOS Nøglering, DPAPI på Windows og libsecret på Linux. Kan nøgleringen ikke bruges, skriver CLI'en det og bruger et lager krypteret med en adgangssætning, du vælger. Nøgler fra 0.2.0-beta.6 flyttes til nøgleringen, når du indtaster den gamle adgangssætning; når de er flyttet, bruges den ikke mere. Nøgler i nøgleringen kan læses af programmer, der kører som din bruger.
>
> **AI-forbindelser:** `aura login` har to indgange: en adgangsnøgle og AI på din computer (Ollama). Claude, Mistral, Corti og Alexandra står som ligeværdige valg, og øvrige udbydere ligger under Vælg en anden. Komplai er ikke længere et AI-valg i terminalen; en gammel Komplai-forbindelse kan kun fjernes med `aura logout`.
>
> Brug et separat projekt med opdigtede data. Agentens kommandoer kører med din brugers rettigheder. Installation af projektpakker, Git-gemning og testudgivelse kræver handlinger i CLI'en; pakken starter ingen GitHub Actions. Der er ingen automatisk opdatering.
>
> [Installation og platformsguides](https://ai-alliancen-org.github.io/ai-harness/terminal.html) · [Fejlrapporter](https://github.com/ai-alliancen-org/ai-harness/issues/new/choose) · [Privat rapportering af sikkerhedsfejl](https://github.com/ai-alliancen-org/ai-harness/blob/main/SECURITY.md)
