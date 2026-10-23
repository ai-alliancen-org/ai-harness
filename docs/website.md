# Vedligeholdelse af hjemmeside og downloads

## Byg pakker og sider lokalt

Brug Node.js 22.23.3, som også er fastlåst til appens bygning. Andre Node-versioner kan komprimere ZIP-filerne forskelligt og dermed give andre kontrolsummer. Bygningen har ingen eksterne afhængigheder, konti eller API-nøgler.

Byg pakkerne, kataloget og de genererede sider fra det fælles bibliotek:

```bash
node scripts/build-packages.cjs
```

Start en lokal webserver fra projektets rodmappe:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory site/dist
```

Åbn http://127.0.0.1:4173. Server kun `site/dist`, aldrig projektets rodmappe med lokale indstillinger og Git-data.

## Indhold og vedligeholdelse

- `profiles/grundregler.md`: fælles danske grundregler med version og kontrolord.
- `profiles/skills/<navn>/SKILL.md`: de 13 skills og integrationerne til agenten. Kun Markdown, ingen scripts, og kun felterne `name` og `description`. Integrationer hedder `harness-integration-<system>` og følger ikke med pakkerne; se [integrationsskills.md](integrationsskills.md).
- `profiles/catalog.json`: skillsenes beskrivelser til mennesker, spørgsmål og svar, kilder, værktøjernes filplaceringer og appens funktioner, hvor hver skill hører til præcis én funktion.
- `profiles/gitignore.txt`: afsnittet til projektets `.gitignore`.
- `desktop/core/library.cjs`, `adapters.cjs` og `installer.cjs`: indlæsning og validering af biblioteket, filplacering pr. værktøj og sikker installation. Appen, `scripts/harness.cjs` og byggescriptet bruger de samme moduler.
- `scripts/build-packages.cjs`: genererer ZIP-pakker, `site/dist/catalog.json`, `skills.html`, `vaerktoejer.html`, de direkte downloads i `index.html` og `profiles/SKILLS.md`. Ret kilden i `profiles/`, og byg igen. Ret ikke de genererede filer.

Nye værktøjer tilføjes i kataloget med regelfil, skillmapper, kontrol, forbehold og officielle kilder. Status `afproevet` kræver en beskrivelse af version, dato og metode i `testedWith`. Downloadpakker må ikke indeholde lokale arbejdsregler, nøgler eller privat materiale.

## Afprøvning

Kør enhedsprøverne og browserprøven lokalt. Browserprøven bygger ud fra gemte GitHub-metadata og kontrollerer de seks indgange på computer- og mobilbredde, begge brugsveje og de lokale links. Den udgiver intet. Aktuelle resultater og afgrænsning står i [gennemgangen før offentliggørelse](offentliggoerelse.md).

```bash
cd desktop
npm test
```

`packages.test.cjs` kontrollerer de faktiske ZIP-filer mod installationens filer, manifestets kontrolsummer, at bygningen er reproducerbar og opdateret, og at alle lokale links i den samlede side findes. `library.test.cjs` installerer og fjerner hvert værktøjs pakke i en tom mappe. Kontrollér også siden i en browser på computer- og mobilbredde. Pakkerne er instruktioner, ikke teknisk håndhævelse. Modeladfærd skal afprøves særskilt med det konkrete værktøj og den konkrete model.

## Downloadside og GitHub Pages

`site/dist/overview.html` er forsiden med projektets formål og de to brugsveje: eget kodeværktøj og Aura-appen. Afsnittet om arbejdsområdet og fold-ud-felterne om funktionsvalg og det lokale eksempel bygger på README’en. Skærmbillederne er fra Aura 0.2.0-beta.5 med opdigtede data; de viser ikke en live-modelkørsel. `scripts/build-pages.cjs` kopierer kun de fire navngivne billeder fra `docs/images/` til Pages-samlingens `images/`. Ret originalerne i `docs/images/`, og afprøv den samlede Pages-bygning, så billedlinks også kontrolleres. `desktop.html` samler downloads med to valg: **App** og **Terminal**. App viser installationsfiler til Mac og Windows; Terminal viser npm-pakken og de tre platformsguides. `terminal.html` sender gamle links til `desktop.html#terminal`. Uden JavaScript vises begge afsnit. `index.html` er kilden til instruktionssiden `pakker.html`. Det faglige grundlag og de foreslåede kontroller ligger i [harness-grundlag.md](harness-grundlag.md) og [projektkontrol.md](projektkontrol.md); de er ikke en erklæring om implementerede funktioner.

Downloadkortene beskriver filen og installationen kort. Afprøvning og kendte begrænsninger findes under **Om betaen** og i udgivelsesnoterne. En platformsstatus må ikke ændres til afprøvet alene for at forkorte teksten. Downloadsiden viser kun offentliggjorte filer fra GitHub, aldrig lokale pakker eller kladder.

`vaerktoejer.html` og `skills.html` genereres fra kataloget. Værktøjsoversigten viser for hvert værktøj, hvor filerne lægges, hvordan indlæsningen kontrolleres, og om placeringen er afprøvet eller følger dokumentationen. `skills.html` er FAQ'en om de skills, der følger med. [Teknisk grundlag](teknisk-grundlag.md) dokumenterer den faktiske OpenCode-arkitektur, Pi som kandidat og mulighederne for en senere webudgave. Brug den samlede Pages-bygning nedenfor, når navigationen mellem forside, værktøjsoversigt og pakker skal afprøves.

`scripts/build-pages.cjs` bygger forsiden fra faktiske GitHub Releases. Instruktionspakkerne bevares som `pakker.html`. Den vælger den seneste publicerede udgivelse med gyldige installationsfiler. Hver fil skal have samme version som tagget, en positiv filstørrelse, GitHubs SHA-256 og en downloadadresse i dette repository. Kladders filer, ZIP-apps og ukendte filtyper udelades. En nyere udgivelse uden installationsfiler skjuler ikke den tidligere beta. Kontrolsum og filnavn ligger under **Se detaljer**. Notarisation udledes ikke af filnavnet; installationsstatus skal dokumenteres i udgivelsesnoterne.

[Udgivelsesvejledningen](udgivelse.md) beskriver pakning, kontrol, releasekladde og den separate manuelle offentliggørelse. Workflowet `.github/workflows/desktop-release.yml` bygger ikke pakker og starter ikke Pages automatisk.

Workflowet `.github/workflows/pages.yml` kan kun startes manuelt. Det blev deaktiveret 10. oktober for at spare Actions-minutter og er genaktiveret til den godkendte Pages-udgivelse 11. oktober. Den aktuelle workflowtilstand skal kontrolleres på GitHub. Ingen push eller release må starte en bygning. Genaktivering og hver konkret kørsel kræver brugerens udtrykkelige tilladelse; en anmodning om installationsfiler er ikke tilladelse til at bruge Actions. Workflowet uploader kun den genererede statiske mappe, aldrig installationsfiler, tokens eller repositoryroden. Det opretter ingen releases, tags eller commits.

### Klargøring til offentlig beta

**Status 11. oktober 2026:** Repositoryet er offentligt, og Pages bruger GitHub Actions som kilde med HTTPS aktiveret. Første side er udgivet på <https://ai-alliancen-org.github.io/ai-harness/> fra `b3155ff` i workflowkørsel `38136175009`. Workflowet er aktivt og kan stadig kun startes manuelt. [Gennemgangen før offentliggørelse](offentliggoerelse.md) dokumenterer kontrollen før skiftet til offentlig adgang.

Den lokale kontrol af udgivelseskommandoen fandt, at GitHub CLI ikke kan kombinere `--slurp` med `--jq`. Workflowet sender nu de indsamlede sider til `jq 'add'` som en separat kommando. Den rettede kommando er afprøvet mod repositoryets faktiske releasedata. Rettelsen er på `main` og blev anvendt ved første udgivelse.

Workflowet kræver en manuel start på `main` med bekræftelsen `offentlig_udgivelse`. Feltet er som udgangspunkt slået fra. Det kontrollerer friske API-svar før bygning, før upload og før udgivelse:

- Repositoryet skal være `ai-alliancen-org/ai-harness` med `private: false` og `visibility: public`.
- Pages skal oplyse `public: true` og `build_type: workflow`. Branch-baseret automatisk Pages-bygning accepteres ikke.
- En manglende Pages-opsætning, ukendt adgang eller API-fejl stopper kørslen. Workflowet opretter ikke selv Pages og gør ikke repositoryet offentligt.

`scripts/pages-access.cjs` indeholder den fælles kontrol. Den kan også køres lokalt mod gemte API-svar. Vedligeholderen skal særskilt godkende skiftet til offentlig adgang, opsætningen af Pages med GitHub Actions som kilde samt genaktivering og den konkrete manuelle kørsel. Vælg ikke “Deploy from a branch”, da det kan starte bygninger ved push.

Kun hjemmesiden og tekstpakkerne uploades som Pages-indhold. Installationsfiler hentes via faktiske GitHub Releases; de kopieres ikke til Pages. Et offentligt repository har også offentlige publicerede Releases og offentlig historik. Private testfiler skal derfor ikke lægges i en publiceret Release her.

**Status 15. oktober 2026:** [Desktopbeta 0.2.0-beta.6](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.2.0-beta.6) er offentliggjort. [Pages-kørsel 38701021359](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38701021359) på commit `26a214a` har udgivet den fælles downloadside med tre installationsknapper og terminalpakken. Siden er gennemgået i browseren, og alle installationsfiler er hentet uden login med matchende kontrolsummer. Se [betastatus](beta.md) og [teststatus](teststatus.md). Fremtidige udgivelser kræver fortsat gennemgåede pakker og udtrykkelig tilladelse til hver kørsel.

### Se den samlede forside lokalt

Læs metadata med den eksisterende GitHub CLI-adgang. Disse kommandoer ændrer ikke repositoryet eller dets synlighed:

```bash
mkdir -p .cache
gh api repos/ai-alliancen-org/ai-harness/releases > .cache/pages-releases.json
gh api repos/ai-alliancen-org/ai-harness --jq '{full_name, private, visibility}' > .cache/pages-repository.json
node scripts/build-pages.cjs .cache/pages-releases.json .cache/pages-repository.json
python3 -m http.server 4184 --bind 127.0.0.1 --directory .cache/pages
```

Åbn http://127.0.0.1:4184/. Bygningen samler forsiden, webguiden og installationssiden, så de interne links kan afprøves. Tjek store og små vinduer, tastaturnavigation og begge brugsveje. De to JSON-filer og den byggede mappe er lokale, ignorerede filer.

### Gentag browserkontrollen

Fra `desktop/`, med Google Chrome installeret:

```bash
npm run test:demo-web -- ../.cache/pages-releases.json ../.cache/pages-repository.json
```

Kontrollér også billederne fra prøven. Et simuleret `private: false` i en lokal kopi af metadata kan bruges til at afprøve den offentlige visning; det er ikke dokumentation for repositoryets faktiske adgang. Den sidste kontrol før upload skal altid bruge friske svar fra GitHub.

GitHub ændres først efter vedligeholderens gennemgang, commit og push samt særskilt godkendelse af offentliggørelsen og den konkrete kørsel.
