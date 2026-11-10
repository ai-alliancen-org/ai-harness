# Afprøv Aura CLI på Windows

Dette er terminalversionen til en udviklingsmaskine. Den konkrete CLI-pakke er endnu ikke afprøvet på Windows. Vejledningen installerer i din egen mappe og ændrer ikke PowerShells scriptpolitik. Arbejdspladsens regler kan stadig forhindre installation.

Du skal have Node 22.12 eller nyere, npm og Git installeret efter arbejdspladsens regler. Pakken henter en fastlåst Windows-udgave af OpenCode fra npm. Den installerer ikke Docker eller projektets afhængigheder.

## 1. Hent og kontroller filen

Åbn [Auras terminalside](https://ai-alliancen-org.github.io/ai-harness/terminal.html). Når en CLI-beta er offentliggjort, henter du npm-pakken og `SHA256SUMS.txt` fra **samme udgivelse**. Opret mappen `Downloads\aura-cli`, og læg begge filer dér. Pak ikke `.tgz`-filen ud. Der er ingen CLI-download, før udgivelsen er publiceret.

Åbn PowerShell i mappen. Kommandoerne nedenfor gælder `0.2.0-beta.6`; brug filnavnet fra den konkrete udgivelse, hvis versionen er en anden.

```powershell
Set-Location "$HOME\Downloads\aura-cli"
node --version
npm.cmd --version
git --version
Get-FileHash .\aura-harness-0.2.0-beta.6.tgz -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Kontrolsummen skal være identisk med linjen for npm-pakken og den, der vises på terminalsiden. Stop ved forskel. `CLI-RELEASE.json` på udgivelsen angiver version, kildecommit og filernes kontrolsummer. Lokale prøver er markeret som ikke udgivelsesklare. En kontrolsum viser filens identitet, ikke at koden er sikker eller afprøvet på Windows.

## 2. Installer lokalt

Bliv i den udpakkede mappe:

```powershell
npm.cmd install --include=optional --ignore-scripts --no-audit --no-fund --no-save .\aura-harness-0.2.0-beta.6.tgz
.\node_modules\.bin\aura.cmd doctor
```

`doctor` skal finde Node, Git og OpenCode 1.18.33. Stop ved fejl, og send fejlteksten. Brug ikke en anden tilfældig Aura-pakke som erstatning. Kommandoen `aura.cmd` undgår PowerShells eventuelle blokering af npm-genererede `.ps1`-filer.

## 3. Første projekt i PowerShell

Brug et særskilt datalager til prøven:

```powershell
$env:AURA_HOME = "$env:LOCALAPPDATA\AuraCLI-WindowsTest"
.\node_modules\.bin\aura.cmd init "$HOME\Documents"
```

Kald projektet `Aura Windows prøve`, og beskriv en kalender med opdigtede aktiviteter. Bekræft placeringen. Der oprettes en ny undermappe. Notér stien, hvis du senere vil åbne den direkte.

Ved valg af AI kan du bruge en forbindelse, du allerede har adgang til. API-nøgler og adgangssætningen til Auras lager indtastes skjult, aldrig som del af kommandoen. Brug ikke rigtige borgerdata i prøven.

Gennemfør følgende og notér resultatet af hvert punkt:

1. Beskriv kalenderen. Gennemgå model, modtagere, vilkår og pris før afsendelse. Kontrollér, at planlægningen ikke ændrer filer.
2. Skriv `/build`, gennemgå planen, og godkend en filændring. Skriv `/preview`, og åbn den lokale adresse i browseren. Kontrollér kalenderen.
3. Bed om en ændring, og afvis den. Kontrollér via `/diff` og preview, at den afviste ændring ikke blev skrevet.
4. Start en ny opgave, og tryk Ctrl+C, mens den arbejder. Start derefter en ny opgave. Allerede udførte ændringer bevares ved stop.
5. Skriv `/exit`. Start igen med `aura.cmd resume` som nedenfor. Åbn lageret med samme adgangssætning, og kontroller samtale, plan, modelvalg og filer. Prøv også forkert adgangssætning; data må ikke slettes.

```powershell
.\node_modules\.bin\aura.cmd resume
```

Versioner kan afprøves med `/save` og `/versions` i dette syntetiske projekt. Gennemgå filerne, før du gemmer. Det opretter lokale Git-commits, men sender intet til GitHub. Undlad `/deploy` i denne platformsprøve.

## 4. Gentag i CMD

Luk Aura i PowerShell før denne prøve. Åbn CMD og brug samme installation og datalager:

```bat
cd /d "%USERPROFILE%\Downloads\aura-cli"
set "AURA_HOME=%LOCALAPPDATA%\AuraCLI-WindowsTest"
node_modules\.bin\aura.cmd doctor
node_modules\.bin\aura.cmd resume
```

Kontrollér skjult indtastning, æ/ø/å, mapper med mellemrum, kodeændring, afvisning, Ctrl+C, preview og genåbning. Kun én CLI må bruge samme datalager ad gangen. Afslut med `/exit`.

Hvis du kun bruger CMD, kan du også installere dér: brug `npm.cmd install --include=optional --ignore-scripts --no-audit --no-fund --no-save aura-harness-0.2.0-beta.6.tgz`. Filens kontrolsum kan vises med `certutil -hashfile aura-harness-0.2.0-beta.6.tgz SHA256`.

## 5. Send resultaterne

Udfyld i almindelig tekst. Send ikke adgangssætninger, tokens eller samtaler med private data:

```text
Windows-version og arkitektur:
CLI-version og kildecommit fra CLI-RELEASE.json:
Node-, npm- og Git-version:
SHA-256 for npm-pakken:
Installation og doctor:
PowerShell: login / plan / byg / afvis / stop / preview / genåbn:
CMD: login / plan / byg / afvis / stop / preview / genåbn:
Forkert adgangssætning bevarer lageret:
Danske tegn og mapper med mellemrum:
Eventuel fejltekst og trin til at fremkalde fejlen:
```

Ved opdatering: afslut Aura, hent den nye pakke i en ny installationsmappe, kontroller kontrolsummen og installer dér. Brug samme `AURA_HOME` for at genåbne dine samtaler. Bevar den gamle installation, indtil den nye er afprøvet. Tag en privat sikkerhedskopi af projekter og datalager før opdatering; en ældre version kan ikke forventes at læse et nyere dataformat.

Ved oprydning er installation, datalager og projekter adskilte. Bevar projektmappen og datalageret, hvis du vil fortsætte. At slette installationen tilbagekalder ikke nøgler hos en udbyder. Den pakkede CLI kræver ingen Windows-nøglering; Electron-appens DPAPI skal afprøves særskilt. [Opret en fejlrapport](https://github.com/ai-alliancen-org/ai-harness/issues/new/choose), eller følg [den private sikkerhedskanal](https://github.com/ai-alliancen-org/ai-harness/blob/main/SECURITY.md).
