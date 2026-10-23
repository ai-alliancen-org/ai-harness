# R02: Samme modelsession fra Planlæg til Byg

Aura gemmer allerede samtaler, planer og OpenCode-sessioner. Denne rettelse løser et mere afgrænset problem: Når brugeren vælger at bygge en plan, kan Aura starte en ny modelsession, selv om forbindelsen, modellen og projektets regler er uændrede. Den nye session får plan og afklaring som tekst, men mister den oprindelige sessions værktøjs- og læsehistorik.

Rettelsen lader den godkendte byggeopgave fortsætte den samme modelsession. Motorprocessen genstartes stadig med byggeriets aktuelle tilladelsespolitik. At bevare historik giver altså ikke modellen lov til at ændre filer eller køre kommandoer.

## Før og efter

| Situation | Før | Efter |
| --- | --- | --- |
| Planlæg → gennemgå og vælg Byg, samme AI og regler | Den fulde afsendelsesbinding ændres med arbejdsmåde og plan-id. Resume er `null`, og en ny modelsession oprettes. | Motoren genstartes i Byg med samme sessions-id. Planen bevares; fil- og værktøjsgodkendelser kræves som hidtil. |
| Brugeren retter en plan | Nyt plan-id starter en ny modelsession. | Den rettede plan kræver stadig ny, aktuel afsendelsesbinding. Historikken kan fortsætte hos samme AI. |
| Model, konto, rute, referenceadgang eller regler ændres | Den fulde afsendelsesbinding styrer genstart. | Sessionsbindingen afviser også genbrug på tværs af konto-id, motorversion og arbejdsmappe. Ny session starter. |
| Samme valg efter normal lukning og genåbning | En uændret fuld binding kan genoptage sessionen. | En uændret, gemt sessionsbinding kan genoptage sessionen, også hvis næste opgave har en anden arbejdsmåde. |

Der ændres ingen skærmbilleder, knapper eller øvrig brugerflade i R02.

## To forskellige bindinger

- **Afsendelsesbindingen (`fingerprint`)** bevarer de eksisterende oplysninger om den konkrete gennemgang, arbejdsmåde, plan-id og motorpolitik. Kontrollen ved afsendelse er uændret. Et gammelt plan-id eller en ændret `AGENTS.md` kan fortsat ikke bruges til at starte Byg.
- **Sessionsbindingen (`sessionFingerprint`)** afgør alene, om en gemt OpenCode-session må genoptages. Den omfatter konto-id og revision, model, destination og rute, motorversion, arbejdsmappe, referencevalg, grundregler, skills, funktioner og projektinstruktioner. Arbejdsmåde, plan-id og teksten om projektets aktuelle startside gør ikke i sig selv samtalen til en anden session.

Modtagersamtykket forbliver hos den eksisterende model-consent-kode. Planen er stadig opgavedata. Opgavegodkendelser og huskede projektregler håndteres stadig af den eksisterende godkendelsespolitik; en godkendelse for resten af én opgave flyttes ikke til den næste.

## Eksisterende samtaler

`session`, `fingerprint` og et eventuelt `conversation` bevares i samtalefilens `opencode`-objekt. Kun det valgfrie felt `sessionFingerprint` tilføjes; historikformatets version ændres ikke.

En ældre gemt session uden den nye binding kan ikke bevise samme konto og sessionsregler. Den starter derfor én ny modelsession ved første afsendelse efter opdateringen. Lokale beskeder, kladde og plan slettes ikke, og det eksisterende historik-/planoverdragelsesforløb bevares. Efter at den nye binding er gemt, kan en normal genåbning fortsætte den samme session. Rettelsen lover ikke, at enhver ældre sessions interne værktøjshistorik kan overføres sikkert.

## Dokumenteret afprøvning

Udgangspunkt: originalens commit `dce68ea74a199ca214ab535a16ff22765d8ee8de`, med OpenCode låst til `1.18.33`.

Den nye regressionstest blev først kørt mod den urørte kerne. Planlæg → Byg fejlede reproducerbart: forventet resume `session-1`, faktisk `null`. Samme test består efter rettelsen.

| Prøve | Resultat |
| --- | --- |
| Nye regressionsprøver | 16/16 består |
| Fokuseret prøve af sessioner, arbejdsområder, modtagersamtykke, instruktioner og godkendelsespolitik | 76/76 består |
| Hele desktop-testpakken | 530/532 består |
| Hele CLI-testpakken | 26/26 består |

Desktop-pakkens to fejl findes også i den urørte original: `approvals.test.cjs:47` med “Godkendelsen findes ikke længere.” og `approvals.test.cjs:74` med “Cannot read properties of undefined (reading 'properties')”. Originalens resultat er 514/516; R02 tilføjer 16 bestående tests og ingen nye fejl. Hele pakken beskrives derfor ikke som grøn.

Prøverne bruger den rigtige Workbench, forberedelse, historik på disk, planrevisioner og godkendelsespolitik med syntetiske data. Kun motorprocessen erstattes af en kontrolleret testmotor; modelkataloget svarer på loopback. Ruteprøven bruger et kontrolleret rutevalg. Tests modtager ingen produktionsnøgler og foretager ingen betalt modelkørsel.

Der påstås ikke native Electron-e2e, en faktisk models evne til at huske, Windows-afprøvning, GitHub Actions, DMG eller release. Prøverne viser, hvilket sessions-id og hvilken politik den rigtige kerne giver motoren. Referencevalg indgår i bindingen; nyt indholdshash eller Privacy Gate for referencefilers indhold er ikke en del af denne rettelse.

Maskinlæsbar status: [r02-session-continuity-validation.json](r02-session-continuity-validation.json).

Kør lokalt fra repositoryets rod med den understøttede Node-version:

```sh
node --test desktop/tests/session-continuity.test.cjs
node --test --test-concurrency=1 desktop/tests/*.test.cjs
node --test --test-concurrency=1 cli/tests/*.test.cjs
```

Der er ingen nye afhængigheder, integrationer, netværksmodtagere eller rettigheder.
