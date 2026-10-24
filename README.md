<p align="center">
  <img src="docs/images/aura-icon.png" width="88" alt="Aura">
</p>

# Aura Harness

Aura Harness hjælper dig med at bygge applikationer med AI og holde styr på opgaven, koden og afprøvningen. Brug desktopappen **Aura**, arbejd i terminalen, eller læg de fælles instruktioner i det kodeværktøj, du allerede arbejder med.

Projektet tager udgangspunkt i kommunernes behov og henvender sig til udviklere, IT-medarbejdere og teknisk interesserede kolleger, der vil bygge, forstå og gennemgå deres egne løsninger.

[Kom i gang](#kom-i-gang) · [Brug dit eget kodeværktøj](#brug-dit-eget-kodeværktøj) · [Betastatus](https://github.com/ai-alliancen-org/ai-harness/blob/main/docs/beta.md) · [Bidrag](https://github.com/ai-alliancen-org/ai-harness/blob/main/CONTRIBUTING.md)

![Auras arbejdsområde med samtale, projektoversigt og et lokalt eksempel med tre mødelokaler i forhåndsvisningen.](docs/images/aura-arbejdsomraade.png)

*Arbejdsområdet i Aura. Eksempelprojektet er åbnet lokalt og bruger opdigtede mødelokaler. Skærmbilledet viser forhåndsvisningen, ikke resultatet af en live-modelkørsel.*

> **Udviklingsbeta.** Appen er under afprøvning. Brug opdigtede data og et separat testprojekt. Læs [betastatus og kendte begrænsninger](https://github.com/ai-alliancen-org/ai-harness/blob/main/docs/beta.md), før du installerer.

## Vælg, hvordan du vil arbejde

| | Aura-appen | Dit eget kodeværktøj |
|---|---|---|
| **Du får** | Samtale, plan, kodeændringer, forhåndsvisning og versioner i samme arbejdsområde. | Fælles grundregler og skills til arbejdet fra idé til drift. |
| **Du vælger selv** | AI-forbindelse, model, projekt og funktioner. | Kodeværktøj, model og hvilke skills der installeres. |
| **Kom i gang** | Start appen, og vælg **Byg i Aura-appen**. | Vælg **Brug Aura Harness i mit kodeværktøj**, eller installér fra kommandolinjen. |

![Auras første skærm med valget mellem at bygge i appen og bruge Aura Harness i sit eget kodeværktøj.](docs/images/aura-velkomst.png)

*Begge indgange kan åbnes igen fra appens sidepanel.*

## Byg i Aura

Beskriv, hvad du vil lave, og arbejd videre med AI’en i et lokalt projekt. Samtalen står ved siden af arbejdsfladen, hvor du kan se resultatet og gennemgå det arbejde, der ligger bag.

- **Afklar og planlæg.** Beskriv brugerne, opgaven og de vigtigste krav. Gennemgå AI’ens forslag, før du beder den bygge.
- **Følg ændringerne.** Gennemgå filændringer og de handlinger, der kræver din godkendelse. Fanerne Plan, Ændringer, Kode og Aktivitet samler detaljerne.
- **Se og afprøv resultatet.** Brug forhåndsvisningen til at prøve løsningen i forskellige skærmstørrelser. Understøttede webprojekter kan startes gennem appen.
- **Gem og fortryd.** Brug lokale Git-versioner til at følge arbejdet og gennemgå en tidligere version, før du gendanner den.

Projektfilerne ligger på din computer. Du kan åbne dem i en anden editor og fortsætte arbejdet dér. AI-modellen vælges separat og kan køre hos en udbyder eller på en modelserver, du har adgang til.

### Vælg den hjælp, du har brug for

Under **Indstillinger → Funktioner** vælger du blandt andet planlægning, versioner, design, kodekvalitet og hjælp til sikkerhed og data. Valgene kan gælde alle projekter eller kun det aktuelle. Integrationer som Adresser og CVR vælges til særskilt.

![Dialogen Funktioner med valg af planlægning, versioner, design, sikkerhed, kodekvalitet og integrationer.](docs/images/aura-funktioner.png)

*Funktionerne styrer, hvilke arbejdsgange og instruktioner Aura stiller til rådighed. De er ikke en sikkerheds- eller myndighedsgodkendelse.*

## Brug Aura i terminalen

Aura CLI giver adgang til samme kodeagent, regler og modelforbindelser fra terminalen. Du kan planlægge, gennemgå filændringer, se preview i browseren og genoptage samtalen. Git-versioner, projektkommandoer og testudgivelser kræver din godkendelse.

CLI'en kræver Node 22.12 eller nyere, npm og Git. Hent pakken og vejledningen til Windows, Linux eller macOS på [terminalsiden](https://ai-alliancen-org.github.io/ai-harness/terminal.html). Download kræver ingen kloning af repositoryet. Platformsafprøvningen fremgår af [teststatus](docs/teststatus.md).

[Windows: PowerShell og CMD](cli/WINDOWS.md) · [Linux](cli/LINUX.md) · [macOS](cli/MACOS.md) · [Kommandoer og nøglelager](cli/README.md). [CLI-beta 0.2.0-beta.6](https://github.com/ai-alliancen-org/ai-harness/releases/tag/cli-v0.2.0-beta.6) er offentliggjort.

## Brug dit eget kodeværktøj

Aura Harness kan også bruges uden desktopappen. Grundreglerne og de 12 skills er læsbare tekstfiler, som kodeagenten kan bruge til afgrænsning, arkitektur, design, kodning, afprøvning, data og drift.

Der er pakker til blandt andet Claude Code, Codex, OpenCode, Cursor, GitHub Copilot, Gemini CLI, Mistral Vibe og Zed. Lovable får en tekst til platformens egne felter. Se [kataloget og de enkelte skills](https://github.com/ai-alliancen-org/ai-harness/blob/main/profiles/SKILLS.md).

![Auras værktøjsvalg med Claude Code, GitHub Copilot, Codex og Cursor samt adgang til de øvrige værktøjer.](docs/images/aura-kodevaerktoej.png)

*Appen viser, hvilke filer og afsnit der ændres, før du installerer. Egne regler bevares, og lokalt ændrede filer springes over ved opdatering.*

Fra repositoryets rod kan du også installere i et andet projekt:

```bash
node scripts/harness.cjs install --tools codex --project ../mit-projekt
```

Skillsene giver instruktioner til agenten. De indeholder ikke scripts eller værktøjstilladelser. Indlæsningen er afprøvet i Claude Code og OpenCode med en kontrolleret modelserver; de øvrige værktøjer følger deres dokumentation. Det viser ikke, hvor godt en bestemt model følger instruktionerne.

## Kom i gang

### Prøv appen

Når du har en Aura-installation, kan du vælge **Prøv et eksempel** ved opstart. Det indbyggede eksempel bruger faste svar og kræver hverken en AI-konto eller en API-nøgle.

![Det indbyggede eksempel med en besked om bibliotekets aktiviteter og den tilhørende forhåndsvisning.](docs/images/aura-eksempel.png)

*Et lokalt eksempel, der viser samspillet mellem besked og forhåndsvisning. Der foretages ingen modelkald.*

[Hent Aura til Mac eller Windows](https://ai-alliancen-org.github.io/ai-harness/desktop.html) uden GitHub-login. Downloadsiden viser den seneste offentliggjorte beta og dens udgivelsesnoter. Mac-pakkerne er signerede og notariserede; Windows-pakken er usigneret. Se [platformsafprøvning](docs/teststatus.md) for den konkrete version.

### Start fra kildekoden

Kræver adgang til repositoryet, Git, Node.js 22.12 eller nyere og npm.

```bash
git clone https://github.com/ai-alliancen-org/ai-harness.git
cd ai-harness/desktop
npm ci
npm run runtime:prepare
npm start
```

`runtime:prepare` henter og kontrollerer de versioner af de medfølgende værktøjer, som projektet har låst. Vælg derefter din AI-forbindelse i appen, eller fortsæt uden AI for at se dig omkring. Adgang og eventuel betaling til model- og hostingtjenester håndteres særskilt.

Se [installation, opsætning og lokale testkommandoer](https://github.com/ai-alliancen-org/ai-harness/blob/main/desktop/README.md).

## Teknologi, data og betastatus

Aura er en Electron-app til Mac og Windows med OpenCode som lokal kodeagent. Vi bruger en fast version gennem en adapter; AI-modellen er et separat valg. Grundregler og skills kommer fra det samme bibliotek, uanset om du bruger Aura eller dit eget kodeværktøj.

Datagennemgangen skelner mellem modelkatalogets oplysninger og observationer fra gennemførte værktøjsforløb. Se [modelstøtte, konkrete observationer og deres begrænsninger](docs/contributions/f09.md).

Lokale projektfiler betyder ikke, at al databehandling er lokal. En ekstern model eller hostingtjeneste kan modtage kode og data. Den konkrete brug skal derfor vurderes ud fra de valgte tjenester, adgangsforhold og organisationens krav.

Appen har endnu ikke fælles organisationslogin, en isoleret sandbox for hele agenten eller et revisionsspor med verificerede godkendere. Et komplet forløb fra download til drift er heller ikke afprøvet på en almindelig testers egen computer. Instruktionerne erstatter ikke en vurdering af sikkerhed, persondata eller drift.

[Læs det tekniske grundlag](https://github.com/ai-alliancen-org/ai-harness/blob/main/docs/teknisk-grundlag.md) og [retningen for det fælles Aura Harness](https://github.com/ai-alliancen-org/ai-harness/blob/main/docs/harness-grundlag.md).

## Find rundt og bidrag

| Mappe | Indhold |
|---|---|
| `desktop/` | Aura-appen, agentadapteren og lokale prøver. |
| `profiles/` | Grundregler, skills og kataloget over kodeværktøjer. |
| `site/` | Webguiden og pakker til de understøttede værktøjer. |
| `scripts/` | Installation og bygning af instruktionspakker. |
| `docs/` | Betastatus, afprøvning, teknisk grundlag og vejledninger. |

Bidrag med fejlrapporter, erfaringer fra afprøvning, forbedrede instruktioner eller kode. Beskriv, hvad du forsøgte, hvad du forventede, og hvad der skete. Se [bidragsvejledningen](https://github.com/ai-alliancen-org/ai-harness/blob/main/CONTRIBUTING.md), eller [opret en issue](https://github.com/ai-alliancen-org/ai-harness/issues). Sikkerhedsproblemer skal [rapporteres privat](https://github.com/ai-alliancen-org/ai-harness/blob/main/SECURITY.md).

Koden er licenseret under [EUPL-1.2](https://github.com/ai-alliancen-org/ai-harness/blob/main/LICENSE).

*Skærmbillederne er taget i Aura 0.2.0-beta.5 på macOS den 11. oktober 2026 med isolerede appdata og opdigtede eksempler.*
