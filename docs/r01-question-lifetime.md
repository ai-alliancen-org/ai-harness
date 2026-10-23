# R01: Et spørgsmål kan kun besvares i den opgave, der stillede det

Når Aura har stillet et spørgsmål, kan opgaven nå at blive stoppet, afsluttet eller erstattet af en ny opgave, før svaret når frem. Tidligere sendte svarfunktionen alligevel svaret til agentmotoren. To hurtige klik kunne også sende samme svar to gange, fordi spørgsmålet først blev fjernet efter motorens kvittering. Et sent svar kunne derefter blive skrevet ind i afklaringen eller projektbriefen.

Rettelsen binder spørgsmålet til den konkrete samtales kørsel, motor og modelsession. Aura kontrollerer bindingen både før afsendelse og efter motorens kvittering. Et spørgsmål låses synkront, mens svaret sendes, så et dobbeltklik kun giver ét netkald. Stop, afslutning, en ny opgave og lukning udløber de gamle spørgsmål. Gentagne spørgehændelser kan heller ikke genåbne et besvaret eller afvist spørgsmål i samme kørsel.

Et fejlet netkald bruger ikke automatisk spørgsmålet op: brugeren kan prøve igen, hvis den samme opgave stadig venter på det samme spørgsmål. Hvis motoren i mellemtiden har besvaret eller afvist spørgsmålet, eller opgaven er stoppet, er der ingen genåbning. Rettelsen ændrer ikke agentmotorens timeout eller netværksprotokol og lover ikke præcis én behandling hos motoren ved et tvetydigt netudfald.

## Før og efter

| Situation | Før | Efter |
|---|---|---|
| Et gammelt spørgsmål besvares efter Stop | Svaret kunne blive sendt og skrevet ind i afklaringen. | Svaret afvises som ikke længere aktuelt. |
| To klik, før motoren svarer | Begge kald kunne blive sendt. | Kun det første kald sendes. |
| Motor eller modelsession skifter under afsendelsen | Den sene kvittering kunne gemme det gamle svar. | Svaret skrives ikke ind i den nye kørsels brief eller afklaring. |
| Et netkald fejler, mens spørgsmålet stadig venter | Brugeren kunne forsøge igen. | Nyt forsøg er fortsat muligt, efter at bindingen er kontrolleret igen. |
| Brugeren vælger Spring over | Motoren vælger selv; intet svar føjes til briefen. | Samme adfærd, med samme kontrol af spørgsmålets levetid. |

Brugerflade, navigation og spørgsmålskort ændres ikke. Projektets plan, værktøjsgodkendelser, opgavegodkendelser og afvisningsforløb bevarer deres eksisterende regler. Der er ingen nye afhængigheder, rettigheder eller eksterne tjenester.

## Afprøvning

Rettelsen er sammenlignet med originalens commit `dce68ea74a199ca214ab535a16ff22765d8ee8de` på macOS med Node.js 22.23.3. Regressionstestene bruger den rigtige `ChatSession` med kontrollerede, syntetiske motorsvar. De udfører ikke modelinferens og kræver ingen konto eller nøgle.

- De første 12 regressionstests blev kørt direkte mod den uændrede original: 2 bestod, 10 fejlede.
- Hele den endelige samling på 16 tests blev derefter kørt mod originalens kilde via en isoleret testindlæser: 2 bestod, 14 fejlede.
- Efter rettelsen består alle 16 tests. De dækker blandt andet dobbeltklik, gentagne hændelser, Stop under afsendelse, ny kørsel, ændret motor eller session, afslutning, lukning, motorens afvisning, nyt forsøg efter transportfejl og mislykket briefgemning.
- Den fokuserede samling med spørgsmål, planer, workbench, godkendelsespolitik, motoropstart og komprimering består: 74/74.
- Hele desktop-samlingen: 530/532 består. De to fejl er de eksisterende baselinefejl i `desktop/tests/approvals.test.cjs` ved linje 47 og 74, henholdsvis en manglende godkendelsesregistrering og et manglende hændelsesobjekt. Der er ingen nye fejl i den kvalificerede fuldkørsel.
- CLI-samlingen består: 26/26.

To eksisterende tests får alene en mere realistisk opsætning: et spørgsmål kommer fra en aktiv opgave og skal være registreret, før det besvares. Deres oprindelige kontroller af planlægning og afvist Stop bevares.

Kør de nye tests fra repository-roden:

```sh
node --test desktop/tests/question-lifetime.test.cjs
```

Se de endelige suite-resultater og afgrænsninger i [den maskinlæsbare validering](r01-question-lifetime-validation.json). GitHub Actions, Windows, rigtig AI, installationspakker og nye skærmbilleder indgår ikke i denne afprøvning. Der er ingen visuel ændring at vise i en før-/efterskærmoptagelse.
