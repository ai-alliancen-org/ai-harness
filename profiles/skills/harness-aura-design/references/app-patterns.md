# App-mønstre til brugerens projekt

## Start med brugerens handling

Byg ét sammenhængende forløb: hvad vil brugeren gøre, hvad skal forstås, hvad sker der bagefter? En app behøver ikke et dashboard. Genbrug projektets eksisterende gode komponenter og godkendte navigation frem for at indføre nye uden behov.

En topbar, valgfri sidebar, `main` og footer kan være et udgangspunkt. Brug `minmax(0, 1fr)` i grids og lad langt indhold ombryde. Små skærme skal bevare adgangen til navigation; skjul ikke en sidebar uden en tilsvarende tilgængelig vej. Skip-link først, korrekt `lang` og én hovedoverskrift pr. visning.

## Fire tilstande

| Tilstand | Vis |
|---|---|
| Indlæser | En rolig besked eller skeleton, som ligner indholdet; `aria-busy` ved relevant kontrol. |
| Tom | Hvad der kommer her og én relevant næste handling. |
| Fejl | Hvad der skete, hvad der er bevaret, og hvad brugeren kan gøre. |
| Data | Både få og mange rækker, lange danske ord og realistiske syntetiske eksempler. |

Knapper beskriver handlingen, fx “Gem ændringer”. Status har tekst/ikon sammen med farve. Fejl må ikke påstå, at en handling er gennemført. Vis forskel på gemt lokalt, sendt og godkendt af en modtager.

## Formularer og dialoger

- Synlig label, hjælpetekst og `aria-describedby` ved behov; fejl i klar tekst og `aria-invalid`.
- Valider ved submit; flyt fokus til første fejl. Fjern rettede fejl ved input/change, så layout ikke springer under et klik.
- Gruppér radiovalg med `fieldset`/`legend`; vælg radioer frem for select ved få korte valg.
- Bevar brugerens indhold ved fejl eller afbrudt afsendelse. Et bevidst reset skal også rydde gamle fejlmarkeringer.
- Dialoger skal have en tilgængelig titel, logisk fokus, tastaturbetjening og en tydelig måde at afbryde på. Test med rigtige handlinger, ikke kun en statisk dialog.

## Data, tal og tabeller

Brug `Intl.NumberFormat` og `Intl.DateTimeFormat` med målgruppens locale; dansk eksempel er `da-DK`. Opfundne navne, numre og sager mærkes “eksempel”. CPR og andre identifikatorer indgår kun, hvis løsningen faktisk må behandle dem; aldrig i URL, fejltekst eller generelle logs.

En bred tabel kan have fokuserbar, navngiven rulningsregion. Overvej kort/definitionslister på små skærme, men bevar relationen mellem label og værdi. Grafer kræver tekstligt alternativ og labels, der ikke afhænger af farve eller hover.

## AI-funktioner

Vis at indhold er AI-genereret og kan være forkert. Dataens faktiske behandlingssted og destination skal bygge på konfiguration, ikke en antagelse om “EU”. Vis ikke beskyttede kildeoplysninger i modelnavne, status, screenshots eller logs.

Skil projektbeskrivelse, plan, filhandling, værktøjstilladelse og konkret datadeling ad. Denne skill kan ikke godkende nogen af dem. Streaming og `aria-live` må ikke overbelaste skærmlæseren; saml status og opdater moderat. En utilgængelig lokal model medfører ingen automatisk deling til cloud.

## Desktop og offline

Følg OS-konventioner for menuer, vinduesknapper og genveje. Tilpas layout til vinduet frem for at beskære det eller kræve én skærmstørrelse. Systemfont er en fallback; egne fonte skal være bundtede med kendt licens. Vis offline-status diskret og bevar lokale kladder. Installer og opdater ikke afhængigheder ved almindelig appstart.

## Målgruppe ændrer krav

Afklar om løsningen er personlig, fælles internt eller borgerrettet. Alle skal kunne bruge den relevante brugerrejse; flere brugere medfører yderligere behov for adgangsstyring, databehandlingsafklaring og driftsansvar. Borgerrettet selvbetjening kan kræve Det Fælles Designsystem, tilgængelighedserklæring og yderligere organisatorisk vurdering. Brug ikke dette som en automatisk juridisk tjekliste eller compliancegodkendelse; verificér faktiske krav for leverancen.
