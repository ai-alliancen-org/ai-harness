# F34: lokale designsignaler før en afgrænset rettelse

**Udkast.** Modulet i dette bidrag er testbart, men er ikke tilsluttet Auras preview, agentloop eller brugerflade. Det ændrer ikke nye projekter eller aktiverer design for brugere, der har fravalgt det.

## Problem og afgrænsning

En model kan skrive en font i CSS uden at indlæse den, gentage store dekorative gradientflader eller udelade sidens hovedoverskrift. En instruktion om flot design viser ikke, om dette faktisk skete i browseren.

`desktop/core/rendered-design.cjs` måler tre afgrænsede tegn i det renderede dokument: mulig fontfallback, mindst tre ens dekorative gradientpaneler og manglende synlig hovedoverskrift. Kort, tabeller, gradienter og simple sider er ikke i sig selv fejl. Kontrollen er **ikke en æstetisk bedømmelse**, en tilgængelighedstest eller et bevis for fungerende brugerforløb.

Målefunktionen returnerer kun afgrænsede tal og booleans. Sidetekst, CSS-fontnavne, adresser og vilkårlige fejlbeskeder følger ikke med. En modelinstruktion kan kun dannes ud fra faste observationskoder. Både mobil- og desktopmålingen skal foreligge; ufuldstændige målinger udløser ingen rettelsesinstruktion.

## Tilpasning til main

Originalens beslutning om den valgfrie `harness-design-og-tilgaengelighed` bevares. Der oprettes ingen konkurrerende designskill, fast palette eller ny modelrute. Modellen vælger fortsat design gennem de aktive skills og projektets `docs/design.md`.

Forslag til næste integration:

1. Kør målingen i en isoleret preview-session, på en kontrolleret kopi af projektet. Bevar eksisterende netværksregler. Både statiske apps og framework-preview skal håndteres særskilt.
2. Bind resultatet til projekt, opgave og filrevision. Kassér en måling, hvis filer ændres, brugeren trykker Stop, eller en ny opgave starter. Sidens scripts må ikke selv attestere rapporten.
3. Lad den eksisterende designskill gennemgå højst tre fund. Gennemfør højst én afgrænset rettelsesrunde og mål de samme visninger igen. Plan, godkendelser og brugerens designvalg gælder fortsat.
4. Hold funktionsprøver og visuel vurdering adskilt. Screenshots må kun sendes efter den eksisterende gennemgang af data/modtager og dokumenteret billedstøtte. Uden billedadgang står resultatet som ikke visuelt vurderet.
5. Afprøv med samme opgave, model, budget og foruddefinerede funktionsprøver før/efter. Rapportér pris og tid fra faktiske kald; ingen kvalitetsscore udledes alene af færre signaler.

Princippet om et repræsentativt forløb efterfulgt af se–ret–se kan tilpasses fra [Unparalleled](https://unparalleled.pages.dev/), men dette bidrag kopierer ingen komponenter, kataloger eller tredjepartskode. En eventuel skillreference og dens kilde-/licensnotice aftales særskilt, så main beholder én designmetode og pakkerne kan genereres korrekt.

## Det mangler før aktivering

- Previewadapter, afbrydelse, revisionsbinding og begrænset levetid for browseren.
- Integration med eksisterende opgavestatus, budget, plan- og værktøjsgodkendelser.
- En aftalt visning af målingens begrænsninger; intet nyt UI er med her.
- Rigtig modelprøve og kalibrering mod menneskers vurdering, inklusive legitime gradienter og atypisk semantik.
- Windows-afprøvning og dækning af framework-apps, fontfejl og meget store dokumenter.

Ingen automatisk afsendelse, rettelse, modelskift eller påstand om bedre design aktiveres ved at flette dette udkast. F34 kan vurderes direkte på main og kræver ikke F32, F33, F35, R07 eller R08.

## Afprøvning og tilbagerulning

`node --test desktop/tests/rendered-design.test.cjs` kontrollerer dataminimering, falske positiver, ufuldstændige målinger og indsprøjtning af instruktioner i rapportdata. Browserprøver og resultater fremgår særskilt af PR-beskrivelsen; tests med DOM-fixtures er ikke en model- eller brugerprøve.

Der er ingen nye afhængigheder. Da modulet endnu ikke importeres af produktet, kan bidraget trækkes tilbage uden at ændre projekter, skills, data eller godkendelser.
