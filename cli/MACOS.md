# Afprøv Aura CLI på macOS

Terminalversionen kræver Node 22.12 eller nyere, npm og Git. Den er afprøvet på Apple Silicon med en lokal, kontrolleret modelserver; den aktuelle CLI er endnu ikke afprøvet på Intel-Mac. Platformens arkitektur følger den Node-proces, du kører. CLI'en bruger sit eget krypterede nøglelager og deler ikke desktopappens Keychain.

## Hent og installer

Åbn [terminalsiden](https://ai-alliancen-org.github.io/ai-harness/terminal.html). Når en CLI-beta er offentliggjort, henter du npm-pakken og `SHA256SUMS.txt` fra samme udgivelse. Læg begge filer i en ny mappe, fx `~/Downloads/aura-cli`. Pak ikke `.tgz` ud.

```sh
cd "$HOME/Downloads/aura-cli"
node --version
npm --version
git --version
shasum -a 256 aura-harness-0.2.0-beta.6.tgz
cat SHA256SUMS.txt
```

Brug udgivelsens filnavn, hvis versionen er en anden. Kontrolsummen skal matche både listen og terminalsiden. Stop ved forskel. Kildecommit og filoversigt står i udgivelsens `CLI-RELEASE.json`.

```sh
npm install --include=optional --ignore-scripts --no-audit --no-fund --no-save ./aura-harness-0.2.0-beta.6.tgz
./node_modules/.bin/aura doctor
```

npm henter den fastlåste OpenCode-motor. `doctor` skal finde Node, Git og OpenCode 1.18.33. Stop ved fejl. Vejledningen kræver hverken global installation eller `sudo`. Slå ikke Gatekeeper eller arbejdspladsens kontroller fra for at få pakken til at starte. Terminalpakken er ikke den signerede og notariserede desktopinstallation.

## Første prøve

```sh
export AURA_HOME="$HOME/Library/Application Support/AuraCLI-MacTest"
./node_modules/.bin/aura init "$HOME/Documents"
```

Opret et nyt projekt med opdigtede data. Tilslut en AI, du har adgang til, og gennemgå data og pris. Nøgle og adgangssætning indtastes skjult.

Gennemgå en plan, vælg `/build`, godkend en faktisk filændring og åbn `/preview`. Afvis derefter en ændring, og kontroller `/diff`. Prøv Ctrl+C under en opgave og start en ny. Afslut med `/exit` og genåbn:

```sh
./node_modules/.bin/aura resume
```

Kontrollér model, historik og filer, skjult indtastning, forkert adgangssætning og mapper med mellemrum. Brug kun én Aura-proces med samme datalager ad gangen. Prøven kræver ingen udgivelse eller push til GitHub.

## Opdatering og tilbagemelding

Afslut Aura og tag en privat sikkerhedskopi af projekter og datalager. Installer den nye version i en ny mappe og brug samme `AURA_HOME`. Bevar den gamle installation, indtil den nye er afprøvet. Tilbagerulning af programmet kan kræve en tidligere sikkerhedskopi af data.

[Opret en fejlrapport](https://github.com/ai-alliancen-org/ai-harness/issues/new/choose) med macOS-version, arkitektur, Node/npm/Git-version, CLI-version, kildecommit, SHA-256 og de trin, der fejlede. Del ikke nøgler eller private projektdata. Brug [den private kanal](https://github.com/ai-alliancen-org/ai-harness/blob/main/SECURITY.md) ved sikkerhedsfejl. At slette installationen sletter ikke projektmapperne eller tilbagekalder nøgler hos en udbyder.
