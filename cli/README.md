# Aura i terminalen

Aura CLI bruger samme kodeagent, modelforbindelser, grundregler og skills som desktopappen. Du skriver opgaver i terminalen, gennemgår handlinger og ser din webapp i browseren. Eksisterende mapper kan åbnes uden et Harness-manifest og uden at ændre filer ved opstart.

CLI'en er til udviklingsmaskiner med **Node 22.12 eller nyere** og **Git**. Koden og de fastlåste motorpakker dækker Linux, macOS og Windows på x64 og arm64. Linux understøtter både glibc og musl. Faktisk afprøvning pr. platform står i [teststatus](../docs/teststatus.md). En platformsvariant i pakken er ikke i sig selv en installationsprøve.

## Hent en udgivet terminalpakke

[Terminalsiden](https://ai-alliancen-org.github.io/ai-harness/terminal.html) viser kun komplette, offentliggjorte CLI-udgivelser. Indtil den første udgivelse er klar, kan du starte fra kildekoden nedenfor. Pakken kan installeres i din egen mappe uden kloning eller global installation. Følg den konkrete platformsvejledning: [Windows](WINDOWS.md), [Linux](LINUX.md) eller [macOS](MACOS.md).

## Installation fra repositoryet

Kør fra repositoryets rod:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node cli/aura.cjs doctor
node cli/aura.cjs chat "/sti/til/mit projekt"
```

På Windows erstattes projektstien med fx `C:\Projekter\Min app`. Både CMD og PowerShell kan køre programmet. Hvis PowerShell blokerer npm-scriptet, brug `npm.cmd` i stedet for `npm`; der er ingen grund til at ændre maskinens scriptpolitik.

Installationen henter den relevante, versionslåste OpenCode-motor som en valgfri npm-afhængighed. Aura ændrer ikke din øvrige OpenCode-opsætning. `doctor` kontrollerer, at motorversionen er præcis den forventede, og forklarer, hvis npm har udeladt den. Du kan også angive en eksisterende motor med `HARNESS_OPENCODE_PATH`. Node, Git, Docker og projektets pakker installeres ikke ved opstart.

Fra andre mapper kan du efter den lokale installation starte den samme kontrollerede installation med dens fulde sti:

```sh
node "/sti/til/aura/cli/aura.cjs" doctor
node "/sti/til/aura/cli/aura.cjs" chat "/sti/til/mit projekt"
```

Det bevarer de afhængigheder, `npm ci` har installeret fra `npm-shrinkwrap.json`. En global installation fra repositoryet er ikke kvalificeret til at bevare sikkerhedsrettelserne. Næste CLI-pakkes låste installationsvej står i [udkastet til næste udgivelse](../docs/releases/cli-naeste-udkast.md). Pakken er ikke publiceret i npm-registret; brug ikke en tilfældig pakke med et lignende navn. Brug heller ikke administratorrettigheder blot for at omgå organisationens installationspolitik.

## Første projekt

`aura init` spørger om navn og idé og viser placeringen, før der oprettes en ny undermappe med startside og grundregler. Der oprettes ingen Git-commit. `aura chat "mappe"` åbner et eksisterende projekt. `aura resume` viser tidligere åbnede projekter.

Beskriv opgaven. Første besked bruger planlægning, som ikke tilbyder skrive- eller shellværktøjer. Vælg AI, hvis du ikke allerede har gjort det. Gennemgå datavilkårene, og send. Når planen er klar, starter `/build` en gennemgang af planen, før agenten får lov til at arbejde. Senere beskeder kan forbedre resultatet; `/plan` starter ny planlægning.

Modellen beder om godkendelse af filændringer, kommandoer og anden adgang efter de fælles tilladelser. Efter fem godkendelser i én opgave spørger terminalen én gang, om resten af opgaven må fortsætte i projektmappen (**Ja, resten af opgaven** eller **Nej, spørg hver gang**). Beskyttede filer, mapper uden for projektet, kommandoer uden sandkasse, nettet og udgivelse spørger stadig. Terminalen har ingen universel `--yes`. Ctrl+C stopper opgaven. Filer, der allerede er ændret, bevares. `/diff` viser ændringer, og `/undo` gennemgår, hvordan den seneste opgave kan fortrydes. Projektkommandoer kører med din brugers rettigheder; dette er ikke en operativsystem-sandbox.

Samtaler, kladder, planer og modelvalg gemmes uden for projektet. `/history` viser beskeder, `/chats` skifter samtale, og `/new` begynder en ny. Uændrede modelindstillinger kan genåbne samme modelsession. Ved modelskift eller ændrede indstillinger vises besked om en ny session, og de seneste beskeder følger med som tekst; `/context` forklarer det. Planlægning og bygning medtager allerede den relevante plan og afklaring. Kun én Aura-terminal ad gangen må bruge samme datamappe. Undgå samtidig redigering fra desktopappen eller en anden agent i samme projekt.

## AI og nøgler

`aura login` viser to indgange: **Jeg har en adgangsnøgle** og **AI på min computer**. API-forløbet viser Claude, Mistral, Corti og Alexandra som ligeværdige valg. Andre forbindelser findes under **Vælg en anden**. Aura vælger ikke en model eller en betalingsform for dig.

Ollama kan findes på standardadressen. En anden Ollama-server eller en kompatibel API kan angives manuelt, også en DGX Spark på en adresse, du har adgang til gennem Tailscale. Aura opsætter ikke Tailscale og ændrer ikke serveren. Et svar fra `/models` beviser hverken kodeevner, kvote eller faktisk behandlingssted.

Komplai bruges kun til udgivelse gennem **Udgiv → komplai Run** i desktopappen. Terminalens AI-valg omfatter ikke Komplai. En tidligere gemt Komplai-forbindelse kan ikke hente modeller eller sende opgaver; vælg selv en anden AI med `/model`. Samtaler og tidligere forbrug bevares.

`aura logout` fjerner en valgt forbindelse. For en gammel Komplai-browserforbindelse tilbagekaldes Auras adgang først; fejler tilbagekaldelsen, bevares forbindelsen til et nyt forsøg. Et manuelt indsat token fjernes kun lokalt og kan tilbagekaldes i Komplai. Run-adgangen i desktopappen berøres ikke.

Terminalversionen bruger **et separat lager krypteret med AES-256-GCM**, med nøgle afledt af din adgangssætning gennem scrypt. Nøgler og adgangssætning indtastes skjult. De skal ikke skrives i kommandoer, miljøfiler eller shellhistorik. Adgangssætningen gemmes ikke og kan ikke gendannes. Ved forkert adgangssætning bevares lageret. Taber du adgangssætningen, må forbindelserne oprettes igen i et nyt lager og gamle nøgler tilbagekaldes hos udbyderne.

Desktopappen bruger fortsat operativsystemets nøglebeskyttelse: Keychain på macOS, DPAPI på Windows og en understøttet nøgletjeneste på Linux. Linux-fallbacken `basic_text` afvises. [Electron beskriver forskellene](https://www.electronjs.org/docs/latest/api/safe-storage). CLI'en læser ikke desktopappens nøgler og kræver hverken Electron eller en grafisk nøgletjeneste.

Datamapperne er som standard:

- macOS: `~/Library/Application Support/AuraCLI`
- Windows: `%LOCALAPPDATA%\AuraCLI`
- Linux: `$XDG_DATA_HOME/aura-cli`, ellers `~/.local/share/aura-cli`

`AURA_HOME` kan angive en anden absolut sti. Brug en privat mappe uden for projektet. Unix-rettigheder begrænses til din bruger; på Windows arves mappens adgangsrettigheder. Samtaler, filer og historik er ikke krypteret af nøglelageret. Beskyttelsen sikrer heller ikke imod kode, der kører med din brugers adgang, mens lageret er åbent.

## Preview, versioner og testudgivelse

- `/preview` viser `public/index.html` gennem en lokal server. Browseren genindlæses efter ændringer. Serveren lukker, når Aura afsluttes.
- `/server` gennemgår installation eller start af understøttede Vite-/Astro-projekter. Installationsscripts kræver et særskilt valg. Status viser fejl og output, og serveren kan stoppes igen. Andre projekttyper kan stadig redigeres; deres udviklingsserver startes i dit normale værktøj.
- `/save` viser Git-status og hver ændret fil, inden du vælger, hvad en lokal commit skal indeholde. Nøglefiler og mulige hemmeligheder udelades. Eksisterende staged ændringer blokerer gemningen. Der tilføjes ingen modelnavne eller medforfattere, og intet pushes.
- `/versions` viser tidligere commits og lader dig gennemgå en gendannelse. Den ændrer arbejdsfiler, ikke Git-historikken. Nuværende filer sikkerhedskopieres i appens datamappe.
- `/deploy` bruger de eksisterende adaptere til Vercel og Azure Static Web Apps. Gennemgangen viser Git-version, filer, destination, adgang og muligt forbrug. Der uploades kun efter bekræftelse. Udbydernes CLI'er og login skal være opsat. Aura opretter ikke en hostingkonto og starter ikke GitHub Actions. Kaldet er en eksplicit testudgivelse, ikke en erstatning for et projekts aftalte CI/CD-forløb.

`/rules` viser og tilpasser projektets fælles regler og skills. `/references` vælger registrerede private referencer aktivt; allerede læst indhold kan stadig være i samtalen. Til installation i et andet kodeværktøj bruges den eksisterende installer:

```sh
aura skills tools
aura skills install --tools codex --project "../mit-projekt"
aura skills status --project "../mit-projekt"
```

## Lokal kontrol og pakning

Læs dette afsnit igen ved hver pakning. Kør fra repositoryets rod:

```sh
npm run test:cli
npm run test:cli-live
npm run package:cli -- /sti/til/ny-pakkemappe --local
```

Enhedstestene omfatter faktiske projektfiler, kryptering, afviste handlinger og Git-versioner i isolerede testrepositories. De ændrer ikke dette projekts Git-historik. Den samlede terminalprøve bruger Python 3's Unix-pty og rigtig OpenCode mod en kontrolleret lokal modelserver. Den bruger ingen eksterne AI-modeller. Python er kun en testafhængighed.

Pakkescriptet kontrollerer arkivets faktiske filer mod kilderne og danner tre platformsguides, `CLI-RELEASE.json` og `SHA256SUMS.txt`. `--local` tillader endnu ikke committede ændringer og markerer pakken som uegnet til offentliggørelse. En release kræver en ren, fulgt kildeversion. Se [udgivelsesforløbet](../docs/udgivelse-cli.md). Kontrollér tarballens indhold og kontrolsum. Installér den i en separat mappe, og afprøv `aura doctor`, oprettelse/åbning, login, plan, kodeændring, afvisning, stop, preview og genåbning. En lokal arbejdsmappeprøve validerer ikke en offentliggjort pakke. Publicering, Git-ændringer og GitHub Actions udføres ikke af disse kommandoer.

På Windows køres samme brugerforløb i både CMD og PowerShell. Kontrollér stier med mellemrum, skjult nøgleindtastning, Ctrl+C, genåbning af nøglelageret og modelvalg. På Linux prøves både en grafisk session og terminal uden nøgletjeneste. Registrér system, arkitektur, Node-version, pakkens kontrolsum og faktiske resultater i teststatus. Platformene skal markeres som uprøvede, indtil kontrollen er udført dér.

Konkrete installations- og testvejledninger findes til [Windows](WINDOWS.md), [Linux](LINUX.md) og [macOS](MACOS.md).
