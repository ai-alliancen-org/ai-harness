# Teststatus før invitation

Senest kontrolleret 31. oktober 2026. Afsnittene er daterede, så tidligere begrænsninger kan læses i deres sammenhæng. Dette er status for den aktuelle arbejdsmappe, ikke en erklæring om, at alle installationsfiler eller modeller er klar. Særskilt godkendte Git-handlinger, udgivelser og GitHub-kørsler fremgår af de enkelte afsnit.

[Gennemgangen før offentlig beta](offentliggoerelse.md) samler historik- og logkontrol samt de lokale prøver af README, hjemmeside og udgivelseskontrol. Den offentliggør ikke appen og ændrer ikke installationsstatus nedenfor.

## Offentlig desktopbeta 0.7.0-beta.1 · 31. oktober 2026

**Udgivet og observeret.** [Aura 0.7.0-beta.1](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.7.0-beta.1) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Letvægtstagget `v0.7.0-beta.1` peger på commit `fb6b0f0`, som kun ændrer udgivelsesnoter oven på `9091f2a`, pakkerne er bygget fra. Udgivelsen indeholder de fem programfiler, `release.json` og `SHA256SUMS.txt`.

**Signering og notarisation.** Begge Mac-apps er signerede med Developer ID Application: mekbas IVS (2UX98897JW) med sikker tidsstempling og Hardened Runtime. Forløbet fulgte vejledningens fire trin, altså **seks indsendelser til Apple**, ikke fire: først de to første DMG'er, så stapling af billetten på hver `.app`, så ompakning med `--prepackaged`, og til sidst de fire endelige filer. Alle seks blev godkendt.

Stablingen er det trin, der er let at springe over, og målingen viser hvorfor. Før: `spctl` svarede `rejected · source=Unnotarized Developer ID` på selve appen, selv om DMG'en var godkendt. Efter: `accepted · source=Notarized Developer ID`, og `syspolicy_check distribution` meldte "App passed all pre-distribution checks and is ready for distribution." Billetten blev kontrolleret igen i de ompakkede filer ved at udpakke ZIP'erne og køre `stapler validate` på appen indeni, ikke på diskbilledet.

**Kontrolleret efter offentliggørelsen, uden login:**
- Downloadsiden svarer HTTP 200 og viser 0.7.0-beta.1 med tre installationsfiler.
- Alle tre links peger på adresser med det rigtige versionstag, ikke på GitHubs midlertidige `untagged-…`.
- Alle tre installationsfiler er hentet og deres SHA-256 stemmer med `SHA256SUMS.txt`.
- Opdateringsfeedet er live for alle tre platforme: `updates/beta/darwin-arm64/beta-mac.yml`, `updates/beta/darwin-x64/beta-mac.yml` og `updates/beta/win32-x64/beta.yml`, alle med version 0.7.0-beta.1.

**Godkendte GitHub-kørsler.** Brugeren gav udtrykkelig tilladelse til de to konkrete kørsler. *Offentliggør gennemgået desktopbeta* (kørsel 41205068082) kontrollerede tag, version, offentlig adgang, kladdens indhold, størrelser, SHA-256, SHA-512 og Mac-kvitteringer og hentede de faktiske filer, før den offentliggjorde. *Udgiv downloadside* byggede og udgav siden med opdateringsfeeds.

**Ikke gjort:** installation og opdatering er ikke afprøvet på en anden computer end byggemaskinen. `test:package` er kun kørt på arm64-pakken. Windows-installationsfilen er usigneret og indholdskontrolleret mod den byggede app.

## Forhåndsvisningskontrollen genoprettet, to fejl i opsætningen og en oprydning i godkendelsesprøven · 31. oktober 2026

### Forhåndsvisningskontrollen var væk, mens beslutningen stod der

`docs/decisions.md` har siden 6. oktober krævet: "efter en opgave genindlæser Aura siden og siger, om den blev vist, og om den skrev fejl i konsollen." Det holdt op med at ske den 23. oktober. `5ffe905` lagde resultatkortet om og slettede samtidig `runPreviewCheck` i `ui/app.js`. Alt det andet blev stående: handleren `preview:check` i `main.cjs:740`, som selv skriver posten i Aktivitet, kanalen i `preload.cjs:95`, visningen i `ui/workspace.js` og beslutningen i loggen. Kun udløseren manglede, så der aldrig kom en post at læse.

**Rettelsen** er derfor lille: `checkPreview` er tilbage i `ui/app.js`, nu med én kontrol pr. opgave (`v.checkedTask`) i stedet for én pr. gentegning af kortet. Kontrollen hører fortsat til Aktivitet, som `5ffe905` besluttede; resultatkortet kvitterer kun for ændringerne.

**Ny vagt mod klassen:** `desktop/tests/preload-channels.test.cjs` kræver, at hver af de 144 IPC-kanaler i `preload.cjs` har en kalder i `ui/`. Den måler brugen, ikke erklæringen. `tests/key-window.test.cjs:398` kontrollerer til sammenligning, at tre kanaler ER erklæret i både main og preload, og kunne derfor ikke fange det her. Vagten fyrer på HEAD og navngiver `previewCheck`. Den afslørede desuden en femte død kanal, `keyCancel` (`main.cjs:627`), som står på undtagelseslisten med en skreven begrundelse, så listen ikke kan vokse i stilhed.

### verify-approvals var ikke en forældet påstand, men fire

Prøven havde stået rød siden 23. oktober og var afskrevet som forældet, blandt andet af mig i afsnittet nedenfor. Fordi den fejlede på den allerførste påstand, kunne ingen se, at der lå tre mere bagved. Alle fire kom af samme `5ffe905`:

| Påstand | Ændringen | Skrevet om til |
|---|---|---|
| `h3` "Prøv resultatet i forhåndsvisningen" og `.check-list` | Kontroller flyttet til Aktivitet | `.result-receipt` på kortet, kontrollerne i Aktivitet |
| Direkte klik på "Afvis med en besked" | Lagt bag "Flere valg" | `helpers.approve` med `scope` |
| "Du afviste, at AI'en må køre en kommando: …" | Kvitteringen forkortet | Kort kvittering **og** Aktivitet med kommando og besked |
| "Fortryd det, den nåede" | Hedder "Fortryd opgaven", bag "Flere valg" | `helpers.resultOption` |

De resterende ti tekstpåstande blev kontrolleret mod appens kilde frem for én kørsel ad gangen; ni fandtes stadig.

### To fejl i opsætningen

**Fortsæt-knappen døde af en fremmed samtales fejl.** Fejlgrenen i `ui/app.js` ryddede fire ting under ét, for enhver samtales fejl, uanset hvilken forbindelse der fejlede. De har hver sin rigtige betingelse og er nu delt op: `acceptedFingerprint` ubetinget, `pendingSend` efter den valgte forbindelse eller den åbne samtale, `verifiedConnection` kun når det er den kontrollerede, der fejlede, og `++setupGeneration` kun på trinnet "saved" for opsætningens egen forbindelse. Uden opdelingen knækker `stillGuided` i `connectionSaved`, og den guidede opsætning når aldrig til "saved": brugeren får "Nøglen er kontrolleret og gemt krypteret." og ingen Fortsæt-knap.

**Kontrollér adgang svarede aldrig fra Opsætning.** `!setupActive` blev til `$('#connections-dialog').open`. Beskyttelsen var ægte: lukkes dialogen undervejs, flytter `#connection-feedback` med formularen ind i opsætningen, og kontrolbeskeden ville lande midt i dens eget forløb. Men den var for bred, fordi `#setup-manage` åbner dialogen uden at rydde `setupActive`. `git log -L` viser, at linjen kom ind i `e75a1b6` samtidig med, at svaret blev asynkront.

**Vagt:** `desktop/tests/setup-error-scope.test.cjs`, 7 prøver, hvoraf **4 fejler på HEAD**. De tre, der består begge veje, er modværnene: at attrappen overhovedet kan nå trinnet "saved", at beskyttelsen stadig virker, når den kontrollerede forbindelse fejler, og at en igangværende kontrol ikke sættes grøn bagefter.

### Forhåndsvisningen afgjorde sin kontekst ud fra det forrige dokument

`npm run test:chat` havde stået rød siden 23. oktober. Årsagen er fundet og målt i den rigtige app, ikke læst: `core/preview-session.cjs` afgjorde en anmodnings kontekst ud fra iframens **forrige** dokument. Tilkobler man sin egen udviklingsserver, står `frame.url` stadig på den statiske `aura-preview`-side, som `preview:attach` netop har afregistreret. Opslaget gav `null`, anmodningen blev annulleret i `onBeforeRequest`, og grenen, der ville have virket, blev aldrig nået.

Brugeren så en tom ramme, statusteksten "Tilsluttet lokal server" og ingen fejlbesked. Målt: `net::ERR_BLOCKED_BY_CLIENT` på `subFrame`, mens `preview.diagnostic` var tom. Fejlen kom med `5ffe905`; `git blame` giver det commit på hele `context()`.

**Rettelsen er ikke den oplagte.** Det første forslag indsatte en ny gren før frame-URL-grenen. En skeptiker målte i rigtig Electron, at den åbner et hul: svarer den tilkoblede server `302` til en anden adresse, melder Electron `initiatorOrigin: harness://app` for omdirigeringens hop, og projekt A's server kunne dermed lægge et andet projekts lokale tjeneste i forhåndsvisningen med en almindelig `Location`-header. Det er præcis det, kommentaren i filen lover aldrig må ske. Den valgte form lader i stedet en kendt frame-origin vinde og fjerner `|| details.referrer`, så kun forælderens URL kan afgøre en rammenavigation. Den er fail-closed.

**Vagt:** en ny prøve i `desktop/tests/project-runtime.test.cjs` med fire sager. Den fyrer både på HEAD ("tilkoblingen skal kunne vises") og på det forkastede forslag ("en omdirigering må ikke skifte arbejdsområde").

**Ikke rettet, og værd at tage stilling til:** blokeringen er stadig tavs, når konteksten ikke findes, altså netop i denne fejlklasse, fordi `preview-session.cjs` kun diagnosticerer, når der ER en kontekst. `#preview-status` siger desuden "Tilsluttet lokal server", så snart `src` er sat, uden at nogen har set rammen indlæse. Og `installSession` tager allerede en `resolveFrame`-krog, som `main.cjs` aldrig sender; knyttes den på, behøver ingen gren at tro på måladressen.

### Tre pakker bygget fra commit bc7bc35

Versionen er bumpet til 0.7.0-beta.1 i `desktop/package.json`, låsefilens to rodfelter og `packaging/update-notice.json`; de fire felter er kontrolleret ens. `npm ci` kørte rent, og pakningen accepterede kildetræet, altså er alle produktfiler committet.

| Platform | Kildekontrol | `runtime-lock.json` i app.asar | Runtimefiler |
|---|---|---|---|
| darwin-arm64 | består | ja, byte for byte lig kilden | 5222 |
| darwin-x64 | består | ja, byte for byte lig kilden | 5222 |
| win32-x64 | består | ja, byte for byte lig kilden | 2425 |

Alle tre peger på commit `bc7bc35` med 193 filer i kildebeviset, 142 appfiler byte-sammenlignet fra arkivet og 34 profilfiler. Alle er usignerede (`signedReceipt: false`).

**Det er beviset for pakningsrettelsen fra 29. oktober.** Arkivets rodposter er nu `/node_modules /core /main.cjs /package.json /preload.cjs /runtime-lock.json /ui`. I 0.6.0-beta.1 manglede den sidste, mens `core/chat-session.cjs` krævede den. Det er første gang filen faktisk er bygget ind, og det kunne ikke afprøves tidligere, fordi pakning kræver et committet kildetræ.

`npm run test:package` består på den pakkede arm64-app: pakket app, isolerede brugerdata, begrænset PATH, medfølgende OpenCode, Git, Node og npm, faktiske filer fra pakkens projektfunktion og profiler, rigtig forhåndsvisning, og en eksisterende mappe uden Git åbnes uden at røre historikken.

**Kun `darwin-arm64` havde sit runtimebevis på forhånd.** De to andre manifester manglede `payloads.schemaVersion`, og `electron-builder.cjs` stopper pakningen på netop det. De er forberedt igen med `runtime:prepare`, som kun rydder `.runtime/<mål>` og derfor ikke rørte den runtime, prøverne kører på.

`node scripts/release-site.cjs` er kørt på de fem samlede filer og meldte "5 faktiske installationsfiler med kontrolsummer. Ingen upload." Alle fem står med `notarized: false`, hvilket er det rigtige svar for usignerede pakker: scriptet tæller kun en kvittering med status Accepted, et indsendelses-id, en kontroldato og samme SHA-256 som filen.

`node scripts/verify-download.cjs` består på den lokale downloadside: Aura-logo, favicon og touch-ikon matcher originalen, alle installationslinks virker, alle tre installationsfiler er hentet gennem en browser, og filnavne, størrelser og SHA-256 stemmer med mappens `release.json`. Både desktop- og mobilvisningen er kontrolleret. Intet er publiceret.

**Ikke gjort:** signering og notarisation, og derfor heller ikke den fornyede kildekontrol, de signerede pakker kræver. `test:package` er kun kørt på arm64. Windows-pakken er bygget på Mac og er fortsat uprøvet på Windows. Ingen GitHub Actions-kørsel er startet. Installationsfilerne ligger under `desktop/release/`, som er ignoreret i Git.

### Hvor det står

**Enhedstestet:** 717 af 717 prøver består med Node 22.23.3. De nye er `preload-channels` (3), `setup-error-scope` (7) og en sag i `project-runtime`.

**Afprøvet på konkret materiale:** **alle tre tidligere røde Electron-suiter består nu.** `npm run test:approvals` med alle otte checkpoints, heriblandt `Siden blev vist · 1 fejl i siden: Kunne ikke hente lokalerne` i Aktivitet, som er beviset for, at forhåndsvisningskontrollen kører igen i den rigtige app. `npm run test:planning` består uændret. `npm run test:chat` består efter rettelsen af kontekstopslaget.

**Målt af agenter, ikke gentaget af mig:** `.open`-rettelsen til Kontrollér adgang er målt i den rigtige Electron-app af to uafhængige agenter, som også viste, at en ren sletning af `!setupActive` ville skrive kontrolbeskeden ind i `#setup-provider-body`. Jeg har ikke selv gentaget den måling; ingen Electron-suite rører `#connection-test`.

**Ikke verificeret:** Fortsæt-rettelsen er ikke set i den rigtige app, kun i prøvens DOM. De øvrige Electron-suiter er ikke kørt igen i denne omgang.

**Forbehold om maskinen:** alle kørsler denne dag skete med belastningstal mellem 126 og 464 på 10 kerner, fra Xcode-kompileringer og andre processer uden for dette projekt. `test:approvals` bestod ved 464, så dens resultat er ikke et heldigt tidsvindue.

### Rettelser til tidligere påstande i dette dokument

- **Afsnittet 29. oktober skrev om de tre røde suiter:** "Alle tre fejl er tidsudløb … og alle tre venter på, at AI-agenten leverer noget." Det var forkert for mindst to af dem. `test:approvals` ventede på en `h3`, der var fjernet seks dage før; agenten havde leveret. `test:planning` består nu uændret. Playwright rapporterer en manglende vælger som et tidsudløb, og jeg læste det som et agentproblem.
- **Samme afsnit kaldte `test:approvals` forældet.** Den var det kun delvist. Den fangede også, at forhåndsvisningskontrollen var forsvundet, og stod rød i otte dage med den besked.
- **Omlægningen af resultatkortet var dokumenteret.** Afsnittet 27. oktober (`Prøvegrundlaget ryddet`) beskriver den som bevidst og nævner hjælperne `approve`, `awaitApproval` og `resultOption`. `verify-approvals.cjs` blev bare ikke taget med i den oprydning.

## Tre fejl fra gennemgangen: lukningsvagt, dobbelt lyskant og gættet kontekstvindue · 29. oktober 2026

Tre af de ni huller uden en beslutning bag sig er lukket. Hver diagnose blev efterprøvet af to skeptikere med hver sin linse, og begge fandt reelle fejl i de første forslag; rettelserne nedenfor er de korrigerede.

### #33: et svar fra nøglevinduet skrev i en lukket dialog

**Fejlen.** `desktop/ui/hosting.js` havde ingen lukningsvagt. Lukkede brugeren Sikkerhedskopi-dialogen, mens nøglevinduet stod åbent, blev kvitteringen "Konto kontrolleret og adgang gemt krypteret." og en frisk statushentning alligevel skrevet i et vindue, der ikke var synligt, og det låste felt blev genaktiveret. Tokenet gik ikke tabt; `main.cjs` gemmer det uafhængigt af dialogen.

**Rettelsen.** Mønsteret fandtes i forvejen i søstermodulet `ui/deployment.js`, som kalder samme IPC-kanal: et tællenummer, der øges ved åbning og ved lukning, og et `assertCurrent`, der kasserer et svar fra en lukket dialog. `hosting.js` bruger nu præcis det, også i `poll`s fejlgren.

**Adfærdsændring, du skal kende.** Lukkes dialogen i det korte øjeblik, før `cancelLogin` er afgjort, åbnes nøglevinduet slet ikke. Før åbnede det efter lukningen.

**Enhedstestet:** ny `desktop/tests/hosting-dialog.test.cjs`, 3 prøver. Den kører den faktiske `ui/hosting.js` i en lille DOM og fastholder, at nøglevinduet FAKTISK blev kaldt, før dialogen lukkes. Uden den påstand bestod prøven, uden at det sene svar nogensinde opstod, altså af den forkerte grund; det var skeptikerens fund. Kørt mod HEAD fejler den med netop den rigtige tekst.

**Afprøvet på konkret materiale:** `npm run test:key-window` og `npm run test:hosting` består. Det normale forløb med dialogen åben skriver stadig kvitteringen og viser "testbruger" i `#hosting-status`.

**Ikke verificeret:** at en bruger i praksis kan nå at lukke dialogen. Nøglevinduet er `modal: true`, men oprettes med `show: false`, så hovedvinduet er aktivt i et kort interval. Intervallet er ikke målt. I prøvelaget er fejlen uafhængig af timing.

### #18: to konkurrerende lyskanter om skrivefeltet

**Fejlen.** `.composer.is-working` i `ui/styles.css` lagde en anden, pulserende kant om skrivefeltet ved siden af metalkanten, og `ui/app.js` tændte den på `running`. Metalkanten slukker i tilstanden `waiting`, som `DESIGN.md` foreskriver, men klassen blev stående, så feltet pulserede videre, netop mens godkendelseskortet skulle stå alene.

**Rettelsen.** Reglen og togglen er væk. `@keyframes composer-working` bliver stående, fordi forhåndsvisningens mærke bruger den. Der er ikke tilføjet CSS for `waiting` eller `idle`: at de ingen kant har, er det besluttede.

**Enhedstestet:** ny `desktop/tests/composer-edge.test.cjs`, 3 prøver. Den måler reglen og ikke navnet: enhver regel på selve skrivefeltet med en animation fanges. Mit første forslag låste fraværet af en bestemt selektor; skeptikeren viste, at det både gav falsk rød på en korrekt eksplicit `waiting`-regel og kunne omgås med en omdøbt dublet. Den nye vagt er afprøvet mod begge: den fejler på HEAD og på `#chat-form.is-arbejder`.

**Afprøvet på konkret materiale:** målt i rigtig Electron med det rigtige stilark. Tilstanden sættes direkte, så det måler CSS'en og ikke en AI-opgave.

| Tilstand | Ringens opacity | Animation på selve feltet, HEAD | Efter rettelsen |
|---|---|---|---|
| idle | 0 | none | none |
| working | 1 (drejer) | none | none |
| quiet | 0,55 (står stille) | none | none |
| waiting | 0 | none | none |
| waiting med den gamle klasse | 0 | **composer-working** | none |

Sidste række er fejlen: ringen er væk, som beslutningen kræver, mens feltet selv pulserer videre.

**Ikke verificeret:** kanten er ikke set under en rigtig AI-opgave. `npm run test:preview-edit` kan ikke nå dertil; den stopper tidligere på playwright 1.64's ændrede tastaturhåndtering.

### #21: en procent regnet mod et gættet kontekstvindue

**Fejlen.** Oplyste hverken kataloget eller tabellen modellens kontekstvindue, brugte `modelLimits` et reservetal på 32.768, og statuslinjen viste "28.000 af 32.768 tokens kontekst, altså 85,4 %" uden at sige, at nævneren var gættet. Advarslen "Gør den kortere" stod som synlig tekst i første lag. Det rammer Ollama altid, selvhostede OpenAI-kompatible servere næsten altid og Azure-udrulninger med eget navn, altså den almindelige vej for lokale modeller.

Den ærlige tekst fandtes allerede: `context-usage.cjs` sætter `unknown-limit`, når grænsen mangler, og `context-display.js` har sætningen "Grænsen er ikke oplyst for denne model". Men `limit` var aldrig falsy, så den gren kunne ikke nås fra appen. Det var en vagt, der ikke kunne fyre.

**Rettelsen.** `connections.cjs` har nu `documentedContext` som eneste kilde til, hvad "oplyst" betyder, og en `contextLimit`, der giver `null`, når vinduet ikke er oplyst. `chat-session.cjs` sender den i stedet for reservetallet. Reservetallet bliver stående til motorens komprimering, som `docs/decisions.md` besluttede.

**Funktion, der bevidst forsvinder:** advarslen nær grænsen vises ikke længere for modeller uden oplyst vindue, fordi den var regnet af et gæt. Det er skrevet ind i beslutningsloggen.

**Enhedstestet:** ny `desktop/tests/context-limit.test.cjs`, 4 prøver. Den dækker tallet, hele kæden frem til teksten og leddet i `chat-session`, som ingen anden prøve ser. Skeptikeren viste, at mit første forslag kun afprøvede hjælpefunktionen: rulles linjen i `chat-session` tilbage, mens funktionen bliver stående, fejlede intet. Den nye vagt er afprøvet mod netop den halve tilbagerulning og fejler på den.

**Afprøvet på konkret materiale:** `npm run test:chat-feedback` består med den nye påstand. Prøvens model oplyser ikke sit vindue, så detaljerne i den rigtige brugerflade viser nu "Seneste modelkald brugte 20 tokens kontekst. Grænsen er ikke oplyst for denne model." med en rigtig måling. Advarslen nær grænsen afprøves fortsat med syntetiske tal mod 200.000.

### Samlet

**Enhedstestet:** 706 af 706 prøver består med Node 22.23.3. De ti nye er de tre vagter.

**Afprøvet på konkret materiale:** `test:key-window`, `test:hosting` og `test:chat-feedback` består i Electron, og skrivefeltets kant er målt i den rigtige app.

**Ikke kørt:** ingen pakning, og ingen af de tre røde suiter fra 29. oktober er forsøgt igen.

**Nyt fund, ikke rettet:** den samme manglende lukningsvagt findes i `desktop/ui/app.js` omkring `keyConnection` og `connectionSaved`, altså den oftere brugte vej til nøglevinduet for AI-nøgler. Den stod ikke i gennemgangens fjorten huller og er ikke rørt.

## Pakningshul i forslag 39: låsefilen fulgte ikke med i app.asar · 29. oktober 2026

Gennemgangen af de 27 overtagne bidrag fandt, at forslag #39's påstand om `runtime-lock.json` i `app.asar` ikke var indfriet. Hullet var alvorligere end meldt: det ville have stoppet den næste pakkede app ved indlæsningen.

**Fejlen.** `desktop/core/chat-session.cjs:14` læser motorversionen med `require('../runtime-lock.json')`. Kravet kom ind med commit `67b4bc5`, overtagelsen af #21 den 27. oktober. Fillisten i `desktop/electron-builder.cjs` er en eksplicit liste, og `runtime-lock.json` stod ikke i den, så filen var ikke i `app.asar`. `desktop/core/workbench.cjs` indlæser `chat-session.cjs`, så fejlen ville ramme ved indlæsningen og ikke først ved brug.

**Ingen udgivet pakke er ramt.** Pakkerne i `desktop/release` er bygget 26. oktober, og kravet kom 27. Kontrolleret i den signerede 0.6.0-beta.1: arkivets rodposter er `/node_modules /core /main.cjs /package.json /preload.cjs /ui`, altså uden låsefilen, men dens `chat-session.cjs` krævede den heller ikke endnu. v0.7.0-beta.1 ville have været den første ramte bygning.

**Rettelsen.** `runtime-lock.json` står nu i fillisten og i navnelisten i `desktop/scripts/verify-package-source.cjs`, så pakkens kopi sammenlignes byte for byte mod arbejdsmappen og kontrolleres som committet fil. Kommentaren i `desktop/core/engine.cjs:9`, der påstod at filen ikke kommer med i den pakkede app, er rettet. Kildebeviset dækkede filen i forvejen.

**Vagten, og at den fyrer.** `desktop/tests/packaging.test.cjs` har en ny prøve, der læser fillisten fra `electron-builder.cjs` og går alle skrevne relative `require` i `main.cjs`, `preload.cjs` og `core/` igennem. Prøven blev skrevet og kørt før rettelsen og fejlede med netop den rigtige linje: `core/chat-session.cjs kræver ../runtime-lock.json, og runtime-lock.json pakkes ikke`. Afgrænsning: kun krav med en skrevet relativ sti, ikke beregnede. `desktop/ui` er kontrolleret særskilt og importerer intet uden for `ui/`.

**Enhedstestet:** 696 af 696 prøver består med Node 22.23.3, den nye vagt indbefattet.

**Afprøvet på konkret materiale:** appkoden fra arbejdsmappen er lagt i to mapper med præcis den gamle og den nye filliste og indlæst med rigtig Node. Den gamle fejler med `MODULE_NOT_FOUND: Cannot find module '../runtime-lock.json'`, den nye indlæser `core/chat-session.cjs` uden fejl. At et bart filnavn i fillisten lander i arkivets rod, hvor `require('../runtime-lock.json')` fra `core/` søger, er bekræftet i den rigtige signerede 0.6.0-beta.1-pakke, hvor `main.cjs`, `preload.cjs` og `package.json` alle ligger der.

**Ikke kørt:** ingen ny pakning med `electron-builder`. Pakning kræver et committet kildetræ, og ændringerne er ikke committet. Et arkiv med låsefilen i er derfor ikke bygget og set endnu. Det bør gøres, før v0.7.0-beta.1 udgives.

## Afhængigheder: Electron 44.9.1 og tre mindre opdateringer · 29. oktober 2026

Dependabot #15 (sikkerhed) og #51 (mindre opdateringer) er overtaget i `desktop/package.json`. Ingen pakker er lagt til eller fjernet; låsefilen ændrede 68 linjer, alle versionsnumre.

- `electron` 44.4.4 → **44.9.1**. Retter GHSA-jr5w-w6x2-84p9 (kompromitterede eMudhra-mellemcertifikater). 44.9.0 retter desuden, at vinduer åbnet fra links ikke brugte åbnerens session og `webPreferences` — det rører nøglevinduets isolation direkte.
- `electron-builder` 26.16.1 → 26.18.0, `playwright` 1.63.0 → 1.64.1, `electron-updater` 6.8.9 → 6.8.11.
- **`@opencode-ai/plugin` er bevidst ikke opdateret.** #51 ville sætte den til 1.19.4, men `desktop/core/engine.cjs` holder 1.18.33 som konstant og afviser motoren ved uoverensstemmelse. Den låste OpenCode-binær og de otte `opencode-*`-pakker i roden står samme sted. Plugin'et løftes sammen med #11.

**Enhedstestet:** 695 af 695 prøver består med de nye afhængigheder (Node 22.23.3).

**Afprøvet på konkret materiale:** fire Electron-suiter består på Electron 44.9.1 og playwright 1.64.1 — `test:desktop`, `test:key-window`, `test:updates` og `test:materials`. Nøglevinduet er altså stadig isoleret efter Electron-opdateringen, og opdateringskontrollen henter og afviser stadig på SHA-512.

**Ikke verificeret, og hvorfor:** `test:chat`, `test:planning` og `test:approvals` fejler. De er kørt igen med de **gamle** afhængigheder (Electron 44.4.4, playwright 1.63.0) og fejler dér på samme måde, så opdateringen er ikke årsagen. Alle tre fejl er tidsudløb, ikke forkerte værdier, og alle tre venter på, at AI-agenten leverer noget. Appen viser "Aura kunne ikke starte AI'en" eller "Ingen nye signaler i 90 s". Kontrolleret undervejs: OpenCode-binæren svarer `1.18.33` og starter på 6,1 s mod motorens budget på 30 s; `findExecutable` og `writePluginRuntime` gennemføres; brugerens globale `~/.config/opencode/opencode.jsonc` når ikke ind, fordi `isolatedEnv` sætter `HOME`, `XDG_CONFIG_HOME` og `OPENCODE_CONFIG_CONTENT` selv; `npm ci` kørte uden fejl, og `@anthropic-ai/sandbox-runtime` er komplet. Årsagen er ikke fundet. Maskinen var samtidig stærkt belastet (10 kerner, belastningstal 176 faldende til 23 under kørslerne, fra en samtidig Codex-session og 73 zombieprocesser under Pioneers `FwUpdateManagerd`), men suiterne fejlede også ved belastningstal 23, så belastning forklarer det ikke alene.

**Ikke kørt:** `test:package` og pakning med `electron-builder` 26.18.0. Pakning kræver committet kildekode og er ikke afprøvet på denne opdatering. Installationsfiler til andre platforme er fortsat uprøvede.

**Metodefejl rettet undervejs:** første kørsel rapporterede alle syv suiter som bestået. Kørslen var skrevet som `npm run test:X | tail -20` inde i en `if`, så `if` målte `tail`, der altid lykkes. Guarden kunne ikke fejle. Den er skrevet om til at gemme `$?` fra `npm run` direkte, og den nye form er afprøvet mod en kommando, der fejler, før resultaterne ovenfor blev brugt.

## Offentlig desktopbeta 0.5.0-beta.3 · 23. oktober 2026

**Udgivet og observeret:** [Aura 0.5.0-beta.3](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.5.0-beta.3) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Letvægtstagget `v0.5.0-beta.3` peger på brugerens commit `4a265745e40dfe98c4ce267e69f5d88b3dea479a` (`klargør Aura v0.5.0-beta.3 med Promte før login, robust notarisering og opdaterede prøver`), som også var `main`, da workflowet startede. Udgivelsen er oprettet af bjornSkalkam.

- **Før upload:**
  - Alle tre pakker består `verify-package-source.cjs` mod commit `4a26574`: 105 appfiler, 32 profilfiler og de fastlåste værktøjer.
  - Windows-installationsfilens indhold er identisk med `win-unpacked` (2534 filer, samme SHA-256).
  - `test:package` består for den pakkede Apple Silicon-app.
- **Apple:**
  - Seks indsendelser blev sendt én ad gangen over wi-fi med den nye `notarize.cjs`. Alle blev godkendt uden netudfald eller gentagelse: første DMG arm64 `47b4c016…` og Intel `8c17a1c4…`, derefter endelig arm64-DMG `d3aaf0e0…`, arm64-ZIP `4e6a1b0b…`, Intel-DMG `14ff8e27…` og Intel-ZIP `a978ad68…`.
  - Slutkontrollen bekræfter signaturer, billetter på appen, distributionskontrol, kvitteringer og samme app i DMG og ZIP (5540 filer) for begge Mac-typer.
  - Intel-slutkontrollen fejlede første gang. Kontrollen sammenligner med arbejdsmappen, og den havde allerede ændringer til næste version. Begge slutkontroller er derfor kørt igen mod en ren kopi af `4a26574` og består. Pakkerne var uændrede.
- **Installation:** Den notariserede arm64-DMG er installeret i Programmer på en Mac med en eksisterende datamappe. Gatekeeper godkender den som "Notarized Developer ID", og appen startede med det eksisterende projekt og den gemte forbindelse.
- **Kladde og offentliggørelse:**
  - Kladden fik præcis de syv filer fra `desktop/release/0.5.0-beta.3/downloads/`, alle med status `uploaded` og samme størrelse som de lokale filer.
  - Kun de to godkendte kørsler er startet: [Offentliggør gennemgået desktopbeta 39863366719](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39863366719) og [Udgiv downloadside 39863559002](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39863559002). Begge er gennemført.
- **Efter offentliggørelse:**
  - Downloadsiden viser v0.5.0-beta.3.
  - Opdateringsfeeds for darwin-arm64, darwin-x64 og win32-x64 viser 0.5.0-beta.3 med `critical: false`.
  - Alle fem filer er hentet uden login. SHA-256 matcher `SHA256SUMS.txt`, feedenes SHA-512 matcher de hentede filer, og den hentede arm64-DMG består `stapler validate`.
- **Kendt begrænsning fundet efter udgivelsen:** Forhåndsvisningen af `public/` henter intet fra internettet. AI'en får det ikke at vide og kan derfor skrive en side, der henter React fra et CDN. Siden viser så kun sin egen reservetekst. Det rettes i 0.6.0-beta.1.
- **Ikke afprøvet:** Opdatering fra 0.5.0-beta.2 gennem appens opdateringsfunktion, Windows-installation, fysisk Intel-Mac og installation på en separat, ren computer.

## Kandidat til 0.5.0-beta.3 · kildekode · 22. oktober 2026

Arbejdsmappens kode kørt fra kilden med Auras egen Node 22. Ikke en pakket app; pakker, Apple-notarisering og platformsprøver er hverken bygget eller kørt.

- **Samlet kørsel:** 401 enhedsprøver og 45 Electron-forløb består efter hinanden. Udeladt er prøverne mod rigtige tjenester (`verify-live-*`) og prøverne, der kræver byggede pakker eller en udgivelsesmappe (`verify-package`, `verify-package-source`, `verify-download`, `verify-upgrade`, `verify-demo-web` og `verify-generated-preview`).
- **De otte ældre prøver** `agent`, `chat-feedback`, `chat`, `desktop`, `planning`, `recovery`, `resume` og `versions` er tilpasset Samtale som standard, planens fire afsnit og Udgiv-forløbet. De består.
- **Svarloft:**
  - `verify-output-limit` med en lokal Corti-lignende server: OpenCode sender `max_tokens` 128.000, der sendes ingen indsats uden brugerens valg, og en ukendt indsats afvises. Fejlkortet viser tre valg, lav indsats sendes som `reasoning_effort`, og samtalen sammenfattes før genforsøget.
  - Mod rigtigt materiale: ét almindeligt kald gennem Aura til corti-s1 med KL-hackathonens EU-S-nøgle. Alle tre modelkald fik `max_tokens` 128.000 uden indsats, og svaret var rigtigt.
  - Lav indsats er ikke afprøvet gennem appen mod Corti. Corti tog imod `reasoning_effort: "low"` i et direkte kald samme dag.
- **Projektlisten:** `verify-project-list` med 14 projekter: de 12 seneste først, **Vis alle 14 projekter**, paletten, åbning af det ældste og genstart. Prøven fejler med den gamle grænse på 12.
- **Promte før login:**
  - `verify-promte-ready`: forklaringen og de to valg vises før login, og intet Promte-login røres. **Gør projektet klar** slår integrationen til for projektet alene og lægger beskeden i Planlæg uden at sende den. En egen kladde bevares, og en Promte-app går direkte til login. Prøven fejler uden kontrollen.
  - Kontrollen er kørt på en kopi af et rigtigt Aura-projekt og fanger det. Gennemgangens fejltekst er nu den samme forklaring med den tekniske årsag til sidst.
  - Omlægningen af et projekt til en Promte-app og en rigtig upload til kodning.promte.dk er ikke afprøvet.
- **Notarisering:** `notarize.cjs` gemmer Apples indsendelses-id, før der ventes, genoptager efter netudfald og sender ikke den samme fil igen uden `--send-igen`. Enhedstestet med en falsk `xcrun` i 15 tests. Ikke kørt mod Apple endnu.

## Offentlig desktopbeta 0.5.0-beta.2 · 22. oktober 2026

**Udgivet og observeret:** [Aura 0.5.0-beta.2](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.5.0-beta.2) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Letvægtstagget `v0.5.0-beta.2` peger på brugerens commit `ec939fee572d816222775a58f2ec50bb2b98e8ad` (`klargør Aura v0.5.0-beta.2 med Udgiv, Alexandra, Corti EU-S og React til komplai Run`), som også var `main`, da workflowet startede. Udgivelsen er oprettet af bjornSkalkam.

- **Før upload:**
  - Alle tre pakker består `verify-package-source.cjs` mod commit `ec939fe`: 105 appfiler, 32 profilfiler og de fastlåste værktøjer.
  - Windows-installationsfilens payload er identisk med `win-unpacked` (2534 filer, samme SHA-256).
  - `test:package` består for den pakkede Apple Silicon-app.
- **Apple:**
  - De første DMG'er (`2c5b8908…` og `62f7699a…`) blev godkendt, mens netværket faldt ud under ventetiden. Godkendelserne blev hentet med indsendelsernes id. Apples SHA-256 matchede de lokale filer, så de blev ikke sendt igen.
  - De fire endelige uploads blev først afbrudt over en iPhone-hotspot, og Apple modtog dem aldrig. På wi-fi blev de sendt igen og godkendt: arm64-ZIP `70e0f26e…`, arm64-DMG `e29ba39d…`, Intel-ZIP `df9296ff…` og Intel-DMG `dcbcba01…`.
  - Alle har de samme to advarsler som 0.5.0-beta.1: en tom test-zip i Git's kildearkiver.
  - Slutkontrollen bekræfter signaturer, billetter på appen, distributionskontrol, kvitteringer og samme app i DMG og ZIP (5540 filer) for begge Mac-typer.
- **Opdatering:** Den offentliggjorte 0.5.0-beta.1 opdaterede sig selv til den notariserede beta.2-ZIP med Squirrel.Mac. Projektfiler, forbindelse, krypteret testnøgle, design og kladde er bevaret, og ingen model blev kaldt automatisk. Automatisk genstart er ikke afprøvet.
- **Kladde og offentliggørelse:**
  - Kladden `420974119` fik præcis de syv filer fra `desktop/release/0.5.0-beta.2/downloads/`, alle med status `uploaded` og samme størrelse og SHA-256 som de lokale filer.
  - Kun de to godkendte kørsler er startet: [Offentliggør gennemgået desktopbeta 39818270165](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39818270165) og [Udgiv downloadside 39818421341](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39818421341). Begge er gennemført.
- **Efter offentliggørelse:**
  - Downloadsiden linker til de tre installationsfiler for v0.5.0-beta.2.
  - Opdateringsfeeds for darwin-arm64, darwin-x64 og win32-x64 viser 0.5.0-beta.2 med `critical: false`.
  - Alle fem filer er hentet uden login. SHA-256 matcher `SHA256SUMS.txt`, feedenes SHA-512 matcher de hentede filer, og den hentede arm64-DMG består `stapler validate`.
- **Ikke afprøvet:** Windows-installation og -opdatering, fysisk Intel-Mac og installation på en separat, ren computer.

## Kandidat til 0.5.0-beta.2 · rigtige tjenester · 22. oktober 2026

Arbejdsmappens kode kørt fra kilden i Electron med isolerede appdata og brugerens egne logins. Ikke en pakket app; pakker og platformsprøver står i kandidatens næste afsnit, når de er bygget.

- **Ollama lokalt:** Ollama 0.40.8 installeret med Homebrew, modellerne qwen3:4b og qwen3:8b. Aura fandt Ollama under **AI på din computer**. Samtale svarede, og begge modeller ændrede filer med godkendte værktøjskald. qwen3 følger ikke Auras planformat: Planlæg gav et spørgsmål eller en tom afslutning efter tænkning, som Aura viste som "AI'en stoppede uden et resultat". Med qwen3's egen `/no_think` skrev qwen3:8b appens filer.
- **Corti EU-S med KL-hackathonens nøgle:** Brugeren indtastede selv nøglen. Før rettelsen ville Aura have sendt en `eu-s:`-nøgle til EU-adressen. Efter rettelsen hentede forbindelsen modellerne fra `ai.eu-s.corti.app`. **Før du sender** viste "EU-S (Sovereign), hos Scaleway i Frankrig". Samtale (34 s), Planlæg med de fire afsnit (30 s) og Byg med to godkendte filændringer lykkedes med corti-s1.
- **komplai Run i prod:**
  - Login med PKCE og forbindelse til organisationen "Komplai" lykkedes.
  - Ny privat app "Find et mødelokale" blev oprettet og udgivet. Statuskontrollen viste "Bekræftet af komplai Run" og "Kun organisationen", og adressen svarer 403 uden login.
  - Brugeren så appen efter login.
  - To nye versioner er udgivet til samme app: Corti-versionen og en React-app med Vite, som Aura byggede lokalt. Den lokale bygning hentede pakker fra npm, byggede med `vite build` på 5,6 s og uploadede `index.html` og én JavaScript-fil.
  - **Vælg en mappe i stedet** førte tilbage til den gamle vej uden upload.
  - Callback-siden efter login er set i Electron med den rigtige sikkerhedspolitik i lyst og mørkt tema.
- **Promte:** Login med bjas@kalundborg.dk på `promte.kalundborg.dk` lykkedes. Installationen har ingen appliste og melder `uploadMode: built`, så Aura udgiver ikke dertil. Den viser nu en klar besked om begge forhold. Upload til `kodning.promte.dk` er ikke afprøvet af os; Christian Vingborg kørte forløbet dér 21. oktober (PR 12).
- **Ikke afprøvet:** pakkede apps, Windows, Intel-Mac og lokal bygning bag en kommunes netværk med blokeret npm.

## Offentlig desktopbeta 0.5.0-beta.1 · 22. oktober 2026

**Udgivet og observeret:** [Aura 0.5.0-beta.1](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.5.0-beta.1) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Tagget `v0.5.0-beta.1` peger på brugerens commit `f9f5e04eaa6bf22de8ad745f9c6f60032d86f5a6` (`klargør Aura v0.5.0-beta.1 med Promte fra PR 12`), som også var `main`, da kørslerne startede. Udgivelsen indeholder PR 12 og rettelserne fra gennemgangen.

- **Før upload:** Alle tre pakker består `verify-package-source.cjs` mod det taggede commit: 101 appfiler, 32 profilfiler og de fastlåste værktøjer. Mac-apps er kontrolleret udpakket fra de endelige ZIP-filer og Windows fra `win-unpacked`, hvis indhold matcher installationsfilens payload. Kontrollen er gentaget efter brugerens commit med ren arbejdsmappe.
- **Kladde og offentliggørelse:** Kladden `420101646` fik præcis de syv filer fra `desktop/release/0.5.0-beta.1/r2-downloads/`, alle med status `uploaded` og samme størrelse og SHA-256 som de lokale filer. Kun de to godkendte kørsler er startet: [Offentliggør gennemgået desktopbeta 39684143118](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39684143118) og [Udgiv downloadside 39684274484](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39684274484). Begge bestod. Tagget udløste ingen andre kørsler; kun CodeQL kørte på den forudgående push, hvilket er den godkendte undtagelse.
- **Offentlig download:** Downloadsiden viser v0.5.0-beta.1 med knapper til Mac · Apple-chip, Mac · Intel og Windows · x64. Alle fem programfiler samt `SHA256SUMS.txt` og `release.json` er hentet fra de offentlige adresser uden token eller cookies; alle fem SHA-256 matcher, og `release.json` og `SHA256SUMS.txt` er identiske med de lokalt kontrollerede. Beta-opdateringsfeeds for `darwin-arm64`, `darwin-x64` og `win32-x64` svarer HTTP 200 og peger på de rigtige filer med samme størrelse og SHA-512 som de offentligt hentede filer. De er ikke markeret kritiske. Den stabile kanal har fortsat ingen feed.
- **Den offentlige fil er den notariserede:** Begge offentligt hentede DMG-filer består `stapler validate`; selve diskbilledet er ikke kodesigneret, som i 0.4. Appen inde i den offentlige `Aura-0.5.0-beta.1-mac-arm64.dmg` består `codesign --verify --deep --strict`, `stapler validate` og `syspolicy_check distribution`, viser `Developer ID Application: mekbas IVS (2UX98897JW)`, og dens `CFBundleShortVersionString` er `0.5.0-beta.1`.
- **Platforme:** Offentlig download er ikke en ny platformsprøve. Windows-installation og -opdatering, SmartScreen, fysisk Intel-hardware, automatisk genstart efter Mac-opdatering og Promte i den pakkede app mod en rigtig Promte-server er fortsat ikke afprøvet; se kandidatafsnittet nedenfor.

PR 12 er flettet, og tagget `v0.5.0-beta.1` er oprettet og pushet, begge på brugerens udtrykkelige godkendelse af netop de handlinger. Releasekladden og de to kørsler er ligeledes godkendt særskilt. Der er ikke oprettet commits, branches eller pull requests herfra, og Git-identiteten er uændret.

## Kandidat til 0.5.0-beta.1 efter PR 12 · 21. oktober 2026

**Klar til brugerens releasegennemgang: skrevet, enhedstestet, afprøvet som pakket Apple Silicon-app og med native opgradering fra 0.4.0-beta.1. Alle tre pakker er bygget igen efter PR 12. De endelige Mac-filer til Apple Silicon og Intel er godkendt af Apple og består slutkontrollen. Windows-installationsfilens indhold samt lokale downloads, hjemmeside og opdateringsfeeds er kontrolleret. Ikke offentliggjort.** Kandidaten bygger på merge commit `a28e368` (PR 12) plus rettelserne nedenfor i arbejdsmappen. Kildekontrollen gentages mod det endelige releasecommit.

- **PR 12 gennemgået og flettet:** Promte-login i Aura uden CLI, appliste og oprettelse af app i Del samt forhåndsvisning med rigtige data gennem en bro i hovedprocessen. Tokens bliver i hovedprocessen og gemmes krypteret; broen tillader kun Promtes app-API og chatkald til den koblede Promte-adresse.
- **Rettelser efter gennemgangen:** Forhåndsvisningen svarer kun en Promte-app, når Promte-integrationen er slået til, og opretter først en app i Promte efter brugerens klik. Del er forudfyldt med `https://app.promte.dk`. Uden koblet app bruger forhåndsvisningen den Promte, brugeren er logget ind på i Aura. Log ud fjerner fortsat kun den lokale adgang.
- **360 enhedsprøver består** på Node 22.23.3: samme udvalg som før plus `promte-preview.test.cjs`. De samme 27 Git-skrivende cases er bevidst udeladt; det er ikke den ufiltrerede testsuite.
- **Electron:** `test:promte-preview`, `test:promte-share` og `test:deployment` består efter rettelserne; `test:tools` bestod på den flettede kode. Promte-prøven kører Auras egen kobling, funktionsvalg og oprettelse med lokale Promte-adaptere og viser, at Aura ikke kontakter Promte, før integrationen er slået til. Promte er ikke kørt i den pakkede app mod en rigtig server her; bidragyderen beskriver kørsler af kernemodulerne mod Promtes testservere.
- **Pakkeindhold:** Kildekontrollen består på Apple Silicon, Intel og Windows: 101 appfiler, 32 profilfiler og de fastlåste OpenCode 1.18.33, Git 2.53.0 og Node 22.23.3. Runtime er genforberedt med kontrol mod låsefilen, og `npm ci` er kørt før pakningen.
- **Pakket Apple Silicon-app:** Signatur og `test:package` består med isolerede brugerdata og begrænset PATH. Medfølgende værktøjer, pakkens projektfunktion, profiler og preview er afprøvet. Skærmen er visuelt gennemgået. Prøven opretter ingen commits.
- **Mac-filer:** Seks nye Apple-indsendelser er Accepted: de to første DMG-filer og de endelige DMG- og ZIP-filer til Apple Silicon og Intel. Slutkontrollen består for begge arkitekturer: signaturer, vedhæftede appbilletter, distributionskontrol, kvitteringer, der matcher filerne, og 5.540 identiske poster i appen i DMG og ZIP. Intel er ikke afprøvet på fysisk hardware.
- **Native opgradering fra 0.4.0-beta.1:** Den signerede 0.4-apps egen opdateringscontroller hentede den nye notariserede ZIP, og Squirrel.Mac installerede den. Projektfiler, forbindelse, krypteret testnøgle, designpakke og kladde er bevaret uden automatisk modelsendelse eller Git-skrivninger. Isolerede brugerdata og kontrolleret manuel genåbning; automatisk genstart er ikke afprøvet.
- **Windows-installationsfil:** Den faktiske NSIS-fil er udpakket. Alle 2.534 payloadfiler og 2.426 runtimefiler matcher byggeoutput og runtime. Filen er 251.526.351 bytes med SHA-256 `c03b4c672a27a1c57aa8a85111e0e6b5f7e43d6fffad6f92a5201a67dfdf60a8`. Opdateringsmetadata matcher størrelse og SHA-512. Installationsfilen er usigneret.
- **Downloads, side og feeds:** Alle tre installationsfiler er hentet gennem den lokale downloadside, og filnavne, størrelser og SHA-256 matcher. Repositoryets releasekontrol består mod en simuleret kladde med de faktiske filer og kvitteringer. Den samlede hjemmeside består med 12 skærmbilleder, 88 lokale links og ingen fejl eller vandret overløb, og alle tre genererede opdateringsfeeds matcher filernes størrelse og SHA-512. Det er lokal kontrol, ikke offentlig HTTP-adgang.

**Releasefiler:** De fem programfiler, `release.json` og `SHA256SUMS.txt` ligger i `desktop/release/0.5.0-beta.1/r2-downloads/`. Kun disse syv filer skal uploades. Kvitteringer og slutkontrol ligger i `r2-final-arm64/` og `r2-final-intel/`, Windows-kontrollen i `r2-windows/installer-check.json`. Filerne i `downloads/` fra kandidaten 20. oktober indeholder ikke PR 12 og udgives ikke.

**Ikke afprøvet på målplatform:** Fysisk Intel-Mac samt Windows-installation, første start, opdatering, afinstallation og SmartScreen. Promte i den pakkede app mod en rigtig Promte-server og nye eksterne Promte-, GitHub Pages- og Cloudflare Pages-udgivelser er ikke afprøvet.

Lokal evidens: logs og rapporter i `/private/tmp/claude-501/-Users-bjornskalkam-GitHub-os-harness/8f624b89-9f41-4c8d-93d3-a9b418bb254c/scratchpad/` (bl.a. `fixed-unit.log`, `fix-promte-preview.log`, `r2-test-package-arm64.log`, `r2-native-upgrade.log`, `r2-download-check.log` og `r2-web/`). Der er ikke oprettet commits, tags, releases eller GitHub Actions-kørsler herfra; PR 12 er flettet efter brugerens godkendelse.

## Kandidat til 0.5.0-beta.1 · 20. oktober 2026

Erstattet af kandidaten efter PR 12 ovenfor.

**Klar til brugerens releasegennemgang: skrevet, enhedstestet og afprøvet som pakket Apple Silicon-app, inklusive native opgradering fra 0.4.0-beta.1. De endelige Mac-filer til både Apple Silicon og Intel er godkendt af Apple og består slutkontrollen. Windows-installationsfilens indhold samt lokale downloads, hjemmeside og opdateringsfeeds er kontrolleret. Ikke offentliggjort.** Kandidaten bygger på brugerens commit `5ab58c0` plus versionsopdatering, Windows-rettelsen og test-/dokumentationsændringerne beskrevet her. Kildekontrollen skal gentages mod det endelige releasecommit.

- **349 enhedsprøver består** på Node 22.23.3 fra den fastlåste runtime. Listen dækker udbydere, login, Del, opdateringer, pakning, releasekontrakt og Pages. 27 cases, der skriver Git-historik eller Git-opsætning, er bevidst udeladt. Ingen Git-mutationer blev udført; dette er ikke en kørsel af den ufiltrerede testsuite.
- **Windows-startfiler:** Azure-, SWA-, Vercel- og Promte-værktøjerne kan starte gennem deres officielle Windows-startfiler uden `cmd.exe`. Otte nye tests kontrollerer bl.a. specialtegn, standardinput, manglende værktøjer og ukendte batchformater. En faktisk npm-genereret wrapper er ført gennem løsningen med en lokal Node-proces på Mac. Det er ikke en afprøvning på Windows.
- **Pakkeindhold:** Kildekontrollen består på Apple Silicon, Intel og Windows: 99 appfiler, 32 profilfiler samt låste versioner af OpenCode 1.18.33, Git 2.53.0 og Node 22.23.3. Alle runtimearkiver er genforberedt med kontrol mod låsefilens checksums.
- **Pakket Apple Silicon-app:** Signaturen og `test:package` består med isolerede brugerdata og begrænset PATH. Medfølgende OpenCode, Git, Node og npm er startet, pakkens projektfunktion og profiler er brugt, og faktiske projektfiler vises i preview. Skærmen er visuelt gennemgået. Prøven opretter ingen commits og dækker derfor ikke automatisk første version eller Gem version.
- **Intel-Mac:** Den signerede apps `codesign --verify --deep --strict` og kildekontrol består. Appen er ikke startet på fysisk Intel-hardware.
- **Windows-installationsfil:** Den faktiske NSIS-fil er udpakket. Alle 2.534 payloadfiler, i alt 811.631.692 bytes, matcher `win-unpacked` i filnavne, størrelse og SHA-256. Alle 2.426 runtimefiler matcher den genforberedte runtime. Filen er 251.519.883 bytes med SHA-256 `fdb7711558778c270d49054df25221bf5adf89cb223f38fd52125d99d10c89f0`. Opdateringsmetadata matcher EXE-filens størrelse og SHA-512. Installationsfilen er usigneret.
- **Opdateringsbrugerflade:** Rigtig Electron og lokal HTTP afprøver download, forkert SHA-512, særskilt Hent og Genstart, blokering under igangværende arbejde og bevaret kladde. Skærmen ved 980 × 720 er visuelt gennemgået. Installationskaldet opsamles i denne prøve; den særskilte native opgraderingsprøve er beskrevet nedenfor.
- **Native opgradering fra 0.4.0-beta.1 til 0.5.0-beta.1:** Den tidligere pakkes egen opdateringscontroller hentede den signerede ZIP, og Squirrel.Mac installerede den. Efter kontrolleret manuel genåbning er projektfiler, forbindelse, krypteret testnøgle, designpakke og kladde bevaret. Der skete ingen automatisk modelsendelse eller Git-skrivninger. Prøven består på Apple Silicon med isolerede brugerdata; automatisk genstart er ikke afprøvet. Skærmbilledet er visuelt gennemgået. Den gamle 0.4-pakke er kontrolleret mod sin Apple-kvittering samt med signatur- og billetkontrol.
- **Hjemmeside:** Den opdaterede skabelon er afprøvet lokalt med faktiske offentlige 0.4-metadata: 12 sideskærmbilleder, 88 lokale links, tastatur, App/Terminal-valg, visning uden JavaScript og ingen rendererfejl eller vandret overløb ved 1280 og 390 pixels. Versionshistorikken omfatter nu også 0.3 og 0.4. Dette er ikke offentlig adgang til 0.5.
- **Endelige downloads og 0.5-side:** Alle tre faktiske installationsfiler er hentet i Chrome fra den lokale downloadside og matcher filnavne, størrelser og SHA-256 i filoversigten. Aura-logo, favicon og touch-ikon matcher originalen. Desktop og mobil er visuelt gennemgået. Den samlede hjemmeside er derudover afprøvet med faktiske lokale 0.5-filer og simulerede kommende releaseoplysninger: 12 skærmbilleder, 88 lokale links, tastatur, App/Terminal og visning uden JavaScript består uden rendererfejl eller vandret overløb. De tre 0.5-downloadlinks og alle tre genererede opdateringsfeeds matcher version, filstørrelse og SHA-512 for de faktiske binære filer. Det er lokal kontrol, ikke offentlig HTTP-adgang til 0.5.

**Mac-filer:** Alle seks godkendte Apple-indsendelser har status Accepted: de to indledende DMG-filer og de endelige DMG-/ZIP-filer til Apple Silicon og Intel. Slutkontrollen består for begge arkitekturer: signaturer, vedhæftede appbilletter, distributionskontrol og match med notariseringskvitteringerne. For hver arkitektur har appen i DMG og ZIP 5.540 identiske poster; kildekontrollen bekræfter 99 appfiler, 32 profilfiler og de fastlåste værktøjer. De fire endelige kvitteringer og begge `final-check.json` ligger i `desktop/release/0.5.0-beta.1/final-arm64/` og `desktop/release/0.5.0-beta.1/final-intel/`. Det er ikke en installationsprøve på fysisk Intel-hardware.

**Afventer:** Brugerens releasecommit, push og tag samt særskilt godkendte Release- og Pages-kørsler og efterfølgende kontrol af de offentlige downloads og feeds. De fem programfiler, `release.json` og `SHA256SUMS.txt` er samlet og kontrolleret i `desktop/release/0.5.0-beta.1/downloads/`. Kun disse syv filer skal uploades; lokale Apple-kvitteringer og downloadsidens hjælpefiler skal ikke med. Kandidaten er ikke offentliggjort.

**Ikke afprøvet på målplatform:** Fysisk Intel-Mac samt Windows-installation, første start, opdatering, afinstallation og SmartScreen. De nye Promte-, GitHub Pages- og Cloudflare Pages-forløb har fortsat den lokale prøvedækning beskrevet nedenfor, ingen ny ekstern udgivelsesprøve.

Lokal evidens: `/tmp/aura-0.5-test-summary.json`, `/tmp/aura-release-unit-tests.log`, `/tmp/aura-0.5-updates-ui.log`, `/tmp/aura-0.5-package-arm64.log`, `/tmp/aura-0.5-native-upgrade.log`, `/tmp/aura-0.5-web-verification.json`, `/tmp/aura-0.5-download-check.json`, `/tmp/aura-0.5-final-preflight.json`, `/tmp/aura-0.5-web-final.json`, `/tmp/aura-0.5-feed-check.json` og `desktop/release/0.5.0-beta.1/windows/installer-check.json`. Der er ikke oprettet commits, tags, releases eller GitHub Actions-kørsler herfra.

## Fælles Del-forløb og flere udgivelsessteder · 20. oktober 2026

**Skrevet og enhedstestet:** Del har seks ligestillede udbydere med logo, kontokrav og tre synlige udbydere ad gangen. Promte Apps, GitHub Pages og Cloudflare Pages er tilsluttet den fælles gennemgang og kvittering. Azure guider gennem browserlogin, abonnement og eksisterende app. Vercel kan følge projektets Git-udgivelser med særskilt produktions- og teststatus. Komplais OAuth-forløb bevares uden særplacering. Fælles status ved Del følger det åbne projekt.

- **74 målrettede enhedstests består:** Loginopsætning, udbyderadaptere, konfigurationsfiler, udgivelsesgennemgang, status, kvittering og hostingvejledning. Prøverne afviser bl.a. ændrede filer efter gennemgang, udskiftede mapper, symlinks, forkert Git-version, ændret udgivelsesdestination, interne netadresser og ukendte udgivelseslinks. Samtidig statuskontrol kan ikke overskrive en nyere kvittering.
- **Versioneret opsætning:** GitHub Pages og Cloudflare Pages får manuelle workflows og projektkonfiguration. Vercels Git-forbindelse kan også gemmes i projektet. Filerne vises før skrivning; brugeren gemmer og sender dem selv med Git. Ingen hemmeligheder gemmes i projektet. Cloudflares token hører til i GitHubs Actions-hemmeligheder.
- **Afprøvet med faktiske projektfiler:** Den nye Electron-prøve består med 47 skærmbilleder uden rendererfejl eller vandret overløb. Den bruger webfiler fra repositoryets gemte version og projektmateriale fra Promte-skillen. Opsætningsfiler skrives i isolerede mapper, og gennemgang, uploadpakning, status og kvittering følger produktets kode. Udbydernes API'er, CLI-login og grænsen til versionsudtrækning er kontrollerede testafhængigheder. Der oprettes ingen commits i prøveprojekterne.
- **Rettelser fra slutgennemgangen:** Tilbage genskaber Azure-abonnement og Vercel-team med det tidligere valg. GitHub-fejl 401/403 åbner genforbindelse uden automatisk at slette eksisterende adgang. Vercels statusklik henter den aktuelle udgivelse, og projektknappen åbner det validerede projekt. Afsluttet kontrol rydder venteteksten. Alle disse forløb er afprøvet i Electron; Pages-fejl og annullering er desuden ført gennem den faktiske kvitteringsvisning i enhedsprøverne.
- **Eksisterende Del-forløb:** Vercel/Azure-prøven består med 21 skærmbilleder, og Komplai-prøven med 36. De dækker bl.a. ændret indhold efter godkendelse, ændret adgang, ukendt og fejlet upload, tastaturbetjening og 980 × 720 ved 150 procent zoom uden vandret overløb.
- **Læsende kontrol mod konti:** Vercels eksisterende teams, projekter og en faktisk Git-udgivelse med status `READY` er hentet. Azure returnerede abonnementerne; appoversigten krævede fornyet Microsoft-login, og SWA CLI manglede på maskinen. Det er adgangs- og kontraktkontrol, ikke en ny udgivelse.

**Ikke udgivet eller observeret i produktion:** De nye Promte-, Pages- og Cloudflare-forløb har endnu ingen ekstern udgivelsesprøve. Browserlogin i de nye appprøver er simuleret; der er ikke gennemført nye login på brugerens vegne. Windows, nye installationspakker og CI/CD er ikke afprøvet i denne milepæl. Promte-kvitteringen åbner arbejdsområdet hos Promte; adapteren gætter ikke en offentlig appadresse.

Lokal evidens: `/tmp/aura-publishing-final-unit-tests.log` samt `aura-udgivelsesvalg-lkGsci`, `aura-del-cloud-YLjc3Y` og `aura-komplai-udgivelse-49t5IW` under `/private/var/folders/q9/914lvw356897pk8pb_29flv00000gn/T/`. Ingen eksterne uploads, Git-skrivninger eller GitHub Actions-kørsler indgår i denne milepæl.

## komplai kun til udgivelse og neutrale udbydervalg · 20. oktober 2026

**Skrevet:** komplai er fjernet fra AI-opsætningen i app og terminal. Tidligere gemte forbindelser kan kun fjernes; kataloger, modelkald og allerede forberedte afsendelser afvises. Et utilgængeligt projektvalg udløser ikke automatisk en anden AI, heller ikke efter sletning af den gamle forbindelse. Run-login, gemt Run-adgang, projekter, kladder, samtaler og historiske priser bevares. De gamle AI-login-/tokenprøver og det særskilte AI-input i releaseworkflowet er fjernet. Manuel udgivelse og kontrollen af installationsfiler er bevaret.

Del begynder med **Udgiv fra Aura** og **Se udgivelsesvejledning**. Direkte udbydere har ens kort i alfabetisk rækkefølge uden forvalg. Aura kontakter ingen udbyder, før brugeren vælger den. En tidligere gemt destination kan genbruges. Vejledningerne har også alfabetisk rækkefølge og et tomt startvalg.

**Enhedstestet:** 58 målrettede tests består: 30 om modeludbydere, gateway, Run-upload og visning; 10 om Run-login og tidligere AI-forbindelser; 16 om terminal, distribution og releasekontrol; to om hostingvejledning. Kontrollen af tidligere AI-afsendelser er prøvet både med en aktiv, genbrugt motor og en ny motor og afviser før dekryptering, historikændring og netkald. Syntaks og diff-kontrol består.

**Afprøvet i appen:** Opsætning og almindelige gemte AI-forbindelser er gennemført i Electron på macOS med isolerede datamapper og lokale katalogservere. Kladder og projektfiler bevares ved fejl og genstart. Terminalens faktiske `aura login komplai` er også kørt i en interaktiv terminal og afvises med forklaringen om at vælge en anden AI.

Del og Run er afprøvet i tre yderligere Electron-forløb med 74 skærmbilleder: 17 for forbindelser og oprydning, 36 for Run-udgivelse og 21 for Vercel/Azure. Run-prøven bruger faktiske webfiler fra repositoryets gemte version og seks lokale uploads gennem Run-tjenestens arkivlæser. Login, genstart, logout, navigation, fejltilstande og visning ved 150 procent zoom består. Første skærm har to hovedvalg; udbyderskærmen har tre ens udbydervalg samt Tilbage og Luk. Ingen udbyder er forvalgt, og disse to trin foretager ingen udbyderkald. Skærmene er visuelt gennemgået uden vandret overløb. OAuth, nøglering og eksterne hostingtjenester bruger kontrollerede lokale svar; dette er ikke en ny produktionsprøve.

Lokal evidens: `harness-setup-224pkv`, `aura-connections-2VjcYV`, `aura-komplai-forbindelser-zdHQNv`, `aura-komplai-udgivelse-K3EfPF` og `aura-del-cloud-9P9vF6` under `/private/var/folders/q9/914lvw356897pk8pb_29flv00000gn/T/`. `aura-del-cloud-9P9vF6/udbyder.png` viser det første udbydervalg uden musemarkering.

**Afgrænsning:** Ingen nye eksterne modelkald, produktionslogin eller uploads er udført. Ingen Windows-installation, nye installationspakker eller offentliggørelse indgår. Systemkort, flere hostingintegrationer og desktop-pakning af brugerprojekter er fortsat produktretning, dokumenteret i [beslutningerne](decisions.md).

En indledende CLI-testkørsel brugte ved en fejl et testfilter, som lod en eksisterende versionsgemningstest oprette commits i sin isolerede, midlertidige prøve. Repositoryets Git-historik blev ikke ændret. Den afsluttende CLI-kørsel brugte en eksplicit positiv testliste uden den prøve. Der er ikke committet eller pushet projektændringer og ikke startet GitHub Actions.

## Offentlig desktopbeta 0.4.0-beta.1 · 18. oktober 2026

**Udgivet og observeret:** [Aura 0.4.0-beta.1](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.4.0-beta.1) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Tagget `v0.4.0-beta.1` peger på brugerens commit `113102939b74a61b28177e06d6ac4f555475449a` (`v0.4.0-beta.1`), som også var `main`, da kørslerne startede.

- **Før upload:** Alle tre pakker består `verify-package-source.cjs` mod det taggede commit: 89 appfiler, 32 profilfiler og de fastlåste værktøjer. Kontrollen er gentaget efter brugerens commit, så den gælder netop den kildeversion, tagget peger på.
- **Kladde og offentliggørelse:** Kladden `416741062` fik præcis de syv filer, alle med status `uploaded` og størrelser, der matcher filoversigten. Kun de to godkendte kørsler er startet: [Offentliggør gennemgået desktopbeta 39171207063](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39171207063) med `komplai_afproevet` slået fra, så Komplai-trinnet blev sprunget over, og [Udgiv downloadside 39171333464](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39171333464). Begge bestod. Tagget udløste ingen andre kørsler; kun CodeQL og Dependabot kørte på den forudgående push, hvilket er den godkendte undtagelse.
- **Offentlig download:** Downloadsiden viser v0.4.0-beta.1 med knapper til Mac · Apple-chip, Mac · Intel og Windows · x64 og nævner ikke længere 0.3.0-beta.1. Alle fem programfiler samt `SHA256SUMS.txt` og `release.json` er hentet fra de offentlige adresser uden token eller cookies; alle fem SHA-256 matcher. Beta-opdateringsfeeds for `darwin-arm64`, `darwin-x64` og `win32-x64` svarer HTTP 200 og peger på de rigtige filer med samme størrelse og SHA-512 som filoversigten.
- **Den offentlige fil er den notariserede:** Appen inde i den offentligt hentede `Aura-0.4.0-beta.1-mac-arm64.dmg` består `stapler validate`, viser `Developer ID Application: mekbas IVS (2UX98897JW)` og `syspolicy_check distribution`, og dens `CFBundleShortVersionString` er `0.4.0-beta.1`.
- **Windows-installationsfilens indhold · 19. oktober 2026:** Den offentliggjorte NSIS-fil er udpakket på Mac med `7zz` 24.09 fra electron-builders cache. Den indeholder `$PLUGINSDIR/app-64.7z` og afinstallationsprogrammet; payloaden har **2.534 filer** på 811.519.338 bytes, og alle filnavne, størrelser og SHA-256 matcher den kontrollerede `win-unpacked`-mappe. Ingen fil findes kun det ene sted. Installationsprogrammet har en tom certifikattabel og er altså usigneret, som udgivelsesnoterne angiver; stubben er PE32, mens `Aura.exe` er PE32+ x86-64. De medfølgende `node.exe` og `git.exe` har deres leverandørers egne Authenticode-signaturer. Dette er indholdskontrol på Mac, ikke installation eller start på Windows.
- **Platforme:** Offentlig download er ikke en ny platformsprøve. Windows-installation og -opdatering, fysisk Intel-hardware, automatisk genåbning efter Mac-opdatering og Komplai som AI-forbindelse er fortsat ikke afprøvet; se kandidatafsnittet nedenfor. Den seneste faktiske Windows-installationsprøve er brugerens prøve af `v0.2.0-beta.6` den 15. oktober 2026; hverken 0.3.0-beta.1 eller denne version er installeret på Windows.

Tagget `v0.4.0-beta.1` er oprettet og pushet på brugerens udtrykkelige anmodning om netop den handling. Der er ikke oprettet commits, branches eller pull requests herfra, og Git-identiteten er uændret.

## Aktuel kandidat til 0.4.0-beta.1 · 18. oktober 2026

**Skrevet, enhedstestet, signeret, notariseret og afprøvet som pakket Apple Silicon-app med faktiske lokale filer. Windows- og Intel-filernes indhold er kontrolleret. Ikke offentliggjort.** Kandidaten bygger på brugerens commit `3775e7f` plus den versionsopdatering og de to testrettelser, der er beskrevet nedenfor. Kildekontrollen skal gentages mod det commit, der senere får tagget.

- **Enhedsprøver:** Desktop-suiten består med 288/288 og CLI-suiten med 25/25 på Node 22.23.3 fra repositoryets fastlåste runtime. Ingen udeladte eller annullerede prøver.
- **Pakker og kilde:** Pakkerne ligger i `desktop/release/0.4.0-beta.1/arm64/`, `intel/` og `windows/`. Alle tre består `verify-package-source.cjs` mod arbejdsmappen: 89 appfiler, 32 profilfiler og de fastlåste værktøjer `opencode 1.18.33`, `git 2.53.0`, `node 22.23.3`. Skill- og webpakkerne er genbygget og er reproducerbare; `site/dist` og `profiles/` var uændrede bagefter.
- **Signering og notarisation:** Begge Mac-apps er signeret med `Developer ID Application: mekbas IVS (2UX98897JW)` og består `codesign --verify --deep --strict`. Apple har godkendt seks indsendelser: de to indledende DMG'er, de to endelige DMG'er og de to endelige ZIP'er. Billetten er vedhæftet begge apps, og appen inde i hver endelig DMG består `stapler validate`, `codesign` og `syspolicy_check distribution` samt kildekontrollen. De endelige filer ligger i `desktop/release/0.4.0-beta.1/downloads/` med `.notarized.json`-kvitteringer, `release.json` og `SHA256SUMS.txt`. Windows-filen er usigneret.
- **Pakket app på Apple Silicon:** `test:package` består med isolerede brugerdata og begrænset PATH. `test:introduction` og `test:tools` består mod den pakkede app: introduktionen, oprettelse af et rigtigt projekt med preview, de medfølgende værktøjer samt valg, installation, gentagelse og fjernelse af skills med 12 grundskills og fire integrationer, herunder Promte og komplai Run. `test:integrations` består mod den faktiske adressetjeneste.
- **Del:** `test:deployment` består fra kildekoden med 21 skærme. Hver skærm har højst fire synlige valg og intet vandret overløb, også ved 980 × 720 og 150 procent zoom. Prøven bruger lokale adaptere; den udgiver ikke til Vercel, Azure eller komplai.
- **Opdatering og databevarelse:** `test:updates` består mod en lokal server med rigtig HTTP-download, afvist SHA-512, kritisk advarsel uden blokering og gemt kladde før genstart. Den native prøve `verify-upgrade.cjs` består fra den staplede 0.3.0-beta.1 til denne version med den notariserede ZIP: Squirrel.Mac installerede arkivet, og projektfiler, forbindelse, krypteret testnøgle, designpakke og kladde var bevaret uden automatisk modelsendelse. Den manuelle udskiftningsprøve uden ZIP består også.
- **Downloadkontrol:** `verify-download.cjs` består lokalt: alle installationslinks, filnavne, størrelser og SHA-256 matcher filoversigten på både computer- og mobilbredde. Intet er uploadet.
- **To rettelser fundet undervejs:** `verify-updates.cjs` tilbød en fast version `0.3.0-beta.2`, som ikke er nyere end denne version, så opdateringsklienten korrekt fandt ingen opdatering og prøven fejlede. Fiksturen udleder nu den tilbudte version af appens egen og forældes ikke ved næste udgivelse. `verify-upgrade.cjs` havde en fast grænse på 180 sekunder for appens lukning; Squirrel brugte længere tid under de samtidige bygninger, og prøven fejlede, selv om ShipIt-loggen viste `Installation completed successfully`. Grænsen kan nu sættes med `HARNESS_INSTALL_TIMEOUT`, og prøven oplyser den faktiske varighed. Ved genkørsel på en rolig maskine lukkede appen efter 83 sekunder.
- **Ikke afprøvet:** Fysisk Intel-hardware, Windows-installation, -opdatering, -afinstallation og SmartScreen, automatisk genåbning efter Mac-opdatering samt en separat, nyinstalleret computer. Komplai som AI-forbindelse er ikke liveafprøvet: modelkald og kreditregistrering mangler en samlet prøve, og `komplai_afproevet` skal derfor være slået fra ved offentliggørelsen. Udgivelse til komplai Run er kun afprøvet fra kildekoden, ikke fra en installationspakke.

Der er ikke oprettet commits, tags, branches, PR'er eller GitHub-kørsler i dette repository fra denne chat.

## Del-guide og rigtig Komplai Run-prøve · 18. oktober 2026

Dette afsnit følger efter brugerens commit `72bd6f8` og opdaterer produktionsgrænsen i afsnittet om Komplai-login nedenfor.

**Udgivet og observeret på Komplai Run:** Brugeren gennemførte Komplais browserlogin og gav den særskilte Run-adgang til sin egen organisation. Den aktuelle Aura-kildekode blev kørt på macOS arm64 med en isoleret datamappe, rigtig kryptering og uændret netværkstransport. Ingen AI-forbindelse eller modelkald indgik. Efter fuld genstart var forbindelse, projekt og udgivelseskvittering bevaret, og en ny statuskontrol lykkedes.

- En offentlig syntetisk HTML-side blev udgivet gennem Auras normale Del-forløb. Den anonyme kontrol gav HTTP 200 og præcis samme SHA-256 som den godkendte fil.
- En separat privat app blev oprettet og udgivet gennem den nye guide. Komplai rapporterede privat adgang, og anonyme kald fik HTTP 403 uden testindholdet. Browseren viste først login; efter **Log ind med komplai** åbnede den den rigtige testside som organisationsmedlem.
- Begge udgivelser brugte det faktiske Git-udtræk fra den eksisterende syntetiske version `07b7121`, der kun indeholder `public/index.html`. Projektet blev kopieret uændret til prøven; der blev ikke oprettet eller ændret commits. Den offentlige og den private testapp er bevaret.
- Prøven blev afsluttet med **Log ud af komplai Run** i appen. Tilbagekaldelsen lykkedes, Aura viste udlogningskvitteringen, og den isolerede datamappe indeholdt derefter ingen gemt Run-adgang.

**Skrevet og gennemgået i den lokale app:** Del stiller ét spørgsmål ad gangen og bevarer valg ved Tilbage. En enkelt organisation kræver ingen rullemenu. App, navn, adresse og adgang er adskilt; **Skift app** går direkte til appvalget. Gennemgang og kvittering har appnavn og adresse øverst, separate oplysninger om udgivelse og adgang samt strukturerede tekniske detaljer. Run-navnet er opdateret i brugerfladen; eksisterende API-identifikatorer er bevaret. Browserens callback lover ikke længere et unødvendigt organisationsvalg eller et fuldført login, før tokenudvekslingen er afsluttet.

**Enhedstestet og afprøvet med faktisk projektmateriale i Electron:** 27 målrettede enhedstests og tre appprøver består. Komplai-/cloudprøverne registrerer 56 skærme uden vandret overløb; første lag har højst fire kontroller. Otte forbindelsesskærme omfatter én organisation, procesgenstart og en ny app uden nyt login eller forvalgt adgang. Udfoldede detaljer, 980 × 720 ved 150 procent zoom, tastaturfokus, synlige handlinger og status uden overlap er kontrolleret. Den aktuelle private produktionskvittering er også åbnet i den nye visning efter genstart.

Konkrete fund fra prøverne er rettet: samme valg efter Tilbage, tilbagevenden til et allerede forbrugt login, manglende vej til cloudopsætning efter en fejl og en statuslinje dækket af handlingsrækken. Azure viser ikke længere produktionsadressen som testadresse. Privat metadata kombineret med faktisk anonym filadgang udløser en tydelig uoverensstemmelse; denne vagt er afprøvet mod en lokal server, der leverer den godkendte fil uden login. Gennemgangens engangsgodkendelse og ukendt upload uden gentagelse er bevaret. Det afsluttende uafhængige review har ingen åbne fund.

**Afgrænsning:** Produktionsprøven dækker enkelt-HTML og den anvendte medlemskonto. ZIP, afbrudt/afvist upload, modstridende adgang og øvrige fejlforløb dækkes af lokale prøver med kontrollerede svar. Der er ingen ny Windows-prøve, test med en særskilt ikke-medlemskonto eller produktionsprøve af en backend. Den nye Aura-brugerflade er ikke pakket eller offentliggjort som en ny beta.

Lokal produktionsevidens ligger i `aura-komplai-produktion-xvhbq0h4` under systemets midlertidige mappe: godkendt materiale, kvitteringer, anonym filkontrol og observationer fra browser og genstart. De afsluttende appprøver ligger i `aura-komplai-udgivelse-O9kkQO`, `aura-del-cloud-Wjw55g` og `aura-komplai-forbindelser-DB8EzD`; logfilerne hedder `/tmp/aura-del-final-*.log`. Adgange og appdata skal ikke committes. Ingen Git-skrivning, GitHub Actions eller Aura-udgivelse er startet i denne milepæl.

## Sikkerhedsopsætning og Promte · 18. oktober 2026

**Aktiveret og observeret på GitHub:** CodeQL analyserer nu JavaScript/TypeScript, Python og Actions. Den [automatiske analyse efter fletningen](https://github.com/ai-alliancen-org/ai-harness/actions/runs/39152400655) består på `aa6714a`; alle tre analyser er afleveret uden analysefejl. To eksisterende JavaScript-fund og to Dependabot-alarmer står fortsat åbne. Se [sikkerhedskontrollen](sikkerhedskontrol.md) for dækning og begrænsninger.

**Skrevet og kontrolleret mod de faktiske manifester:** Dependabots grupper dækker rodens otte OpenCode-platformspakker, desktopafhængigheder og GitHub Actions. YAML-skema, manifest/låsefil-sammenhæng og manuel start for alle fire bygge- og udgivelsesworkflows består. Den nye gruppering er lokal og endnu ikke observeret på GitHub.

[PR #5](https://github.com/ai-alliancen-org/ai-harness/pull/5) er flettet efter to rettelser i Promte-vejledningen: React-hooks kaldes ubetinget, og CLI-konfigurationen bruger samme server som login. Rettelserne er kontrolleret mod de faktiske publicerede Promte-pakker; 18 relevante tests og en lokal installations-/fjernelsesprøve består. Ingen Promte-app er uploadet.

Brugeren godkendte særskilt rettelsescommit `083eeab`, push til PR-branchen, fletningen `aa6714a` og en ren fremrykning af lokal `main`. De nye commitbeskeder har ingen AI-attribution; eksisterende historisk attribution er bevaret. De 22 oprindelige staged filændringer er bevaret byteidentisk gennem fremrykningen. Øvrige lokale ændringer er ikke committet eller pushet herfra. Ingen appbygning eller udgivelse er startet.

## Komplai-login og Run-skill · 18. oktober 2026

**Skrevet og afprøvet som valgfri integration:** Run-skillen og dens reference beskriver færdige statiske filer, særskilt udgivelsesadgang, adgangsvalg, ukendt uploadudfald og kontrol af den faktiske app. Desktopapp, Aura-terminal og andre kodeværktøjer er adskilt. Biblioteket har 16 skills, heraf fire valgfrie integrationer. Run vælges aktivt og følger ikke automatisk med grundpakken. Installation, læsning af referencefilen, fjernelse og motorens tilvalg er afprøvet med faktiske lokale filer.

**Samlet med det samtidige skills-arbejde:** Sidste generering med Node 22.23.3 består, og alle 31 prøver af bibliotek, funktioner, installation og pakker består mod den fælles arbejdsmappe. De kontrollerer alle 23 faktiske ZIP-pakker, reproducerbarhed, kontrolsummer og lokale links. 39 kildefiler var uændrede under bygningen. Sidste generering opdaterede `profiles/SKILLS.md`, `site/dist/catalog.json` og `site/dist/skills.html`; ZIP-filerne var allerede opdateret af skills-arbejdet og forblev byteidentiske. Run-siden med den endelige tekst er set ved 1280 og 390 pixels uden vandret overløb eller sidefejl, og begge instruktionsfiler kan åbnes. Dette er lokal verifikation, ikke en ny offentlig hjemmeside eller apppakke.

**Skrevet, enhedstestet og afprøvet i Electron med kontrollerede API-svar:** Publish-only-login åbner nu organisationsvalget uden at læse manglende AI-datavilkår. Den afgrænsede liveprøves transport tillader den faktiske organisationsrute med `include=publishing`, men afviser andre query-parametre, metoder og udgivelsesadgange. 18 målrettede enhedstests består. Fire appforløb dækker AI alene, Publish alene, begge og eksplicit fravalgt Publish samt afbrydelse, særskilte adgange, krypteret lagring og tilbagekaldelse. Organisationsskærmene er set og har to til fire synlige valg.

**Del-forløbet er afprøvet i Electron med lokale HTTP-kald:** 21 målrettede enhedstests består. Den faktiske adapter sender HTML og ZIP til en lokal modtager, som bruger Run-kildens arkivlæser; den modtagne webside er åbnet og betjent i browseren. Prøven dækker organisationsvalg, afbrydelse, nye private/offentlige apps, eksisterende app, afvist upload, ukendt udfald uden gentagelse og genåbning af kvitteringen. En eksisterende app beholder sin adgang; Aura sender ingen PATCH for at ændre den. Ændret adgang efter gennemgangen stopper upload. Frisk adgang vises med eventuel afvigelse fra uploadvalget, og et bekræftet release-ID bevares, hvis den efterfølgende statuskontrol fejler. De tidligere fejl er reproduceret i de relevante prøver, og en uafhængig kildegennemgang fandt ingen rester i disse tre rettelser.

Del-prøven bruger kontrolleret OAuth/Hub og nøglelager. ZIP-materialet stammer fra eksisterende commit `aa6714a`; artifact-provider er injiceret for at undgå Git-skrivninger. Enkelt-HTML bruger syntetiske versionsmetadata. Prøven er derfor ikke bevis for et nyt Git-udtræk eller et produktionslogin. Samtidige ændringer i Hub kan fortsat påvirke adgang under upload; klienten lover ingen atomisk serverkontrol.

De ændrede Del-skærme er set, også ved 980 × 720 og 150 procent zoom, uden vandret overløb. Den nye adgangsbeslutning har to muligheder; eksisterende apps viser status og ét link til ændring i Hub. Den samlede destinationsformular har fortsat 10–11 synlige kontroller inklusive hjælp og navigation. Den er ikke godkendt som færdig UX efter målet om få valg, og en gennemgang med en person uden teknisk baggrund mangler.

**Afprøvet med det faktiske CLI:** Den offentlige Komplai Publish-pakke 0.1.0 er kørt mod en lokal HTTP-modtager med HTML, CSS, JavaScript og en syntetisk `.env`. ZIP-indholdet er læst med Run-serverens faktiske arkivlæser: webfilerne matcher, og `.env` er udeladt. Dry-run og manglende publiceringsbekræftelse sender intet. En godkendt prøve sender én upload; et ukendt udfald genforsøges ikke automatisk. Det er en lokal kontraktprøve, ikke en udgivelse til Komplai.

**Produktionsgrænse:** Komplais offentlige loginopsætning svarer med den forventede issuer. Rigtigt browserlogin, produktionsadgange, modelkald, udgivelse på komplai.run og Windows er ikke afprøvet i denne milepæl. Lokale testresultater dokumenterer ikke disse forløb. Ingen eksterne modelkald eller uploads er foretaget.

Lokal evidens: `aura-komplai-forbindelser-umAxjz` og `aura-komplai-udgivelse-avVy6z` under systemets midlertidige mappe indeholder rapporter og skærmbilleder. Run-CLI-prøven ligger i `/tmp/aura-run-cli-proof-QnCDPJ`; kontrolscriptet er `/tmp/aura-run-cli-proof.mjs`. Den afsluttende fælles kontrol ligger i `/private/tmp/aura-run-final-build.log`, `/private/tmp/aura-run-final-combined-tests.log` og `/private/tmp/aura-run-final-browser.log`. De to appprøver kan gentages med `node desktop/scripts/verify-komplai-connections.cjs` og `node desktop/scripts/verify-komplai-publish.cjs`; sidstnævnte kræver Komplai-kilden ved siden af repositoryet eller angivet via `AURA_KOMPLAI_PUBLISHER_ROOT`, så den faktiske Run-arkivlæser kan indlæses. Testmaterialet og de syntetiske adgange skal ikke committes.

## Offentlig desktopbeta 0.3.0-beta.1 · 16. oktober 2026

**Udgivet og observeret:** [Aura 0.3.0-beta.1](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.3.0-beta.1) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Tagget `v0.3.0-beta.1` peger på brugerens commit `79aa624f35a57c6ffe299845f67d7b0c0030c34a` (`verificér og dokumentér Aura 0.3.0-beta.1`), som også var `main`, da kørslerne startede. Der er ikke oprettet commits eller ændret Git-identitet herfra.

- **Før upload:** Alle tre pakkers ressourcemapper består `verify-package-source.cjs` mod det taggede commit: 87 appfiler, 28 profilfiler og de fastlåste værktøjsversioner. `app.asar` i begge endelige Mac-ZIP'er er byteidentisk med de kontrollerede apps. SHA-256 for alle fem programfiler matcher `SHA256SUMS.txt`, og `verify-download.cjs` består lokalt.
- **Kladde og offentliggørelse:** Kladden `414834066` fik præcis de syv filer; GitHubs SHA-256 for hver fil matcher filoversigten. Kun de to godkendte kørsler er startet: [Offentliggør gennemgået desktopbeta 38888341744](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38888341744) med `komplai_afproevet` slået fra og [Udgiv downloadside 38888481989](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38888481989). Begge bestod. Tagget udløste ingen andre kørsler.
- **Offentlig download:** Downloadsiden viser v0.3.0-beta.1 med knapper til Mac · Apple-chip, Mac · Intel og Windows · x64. De tre installationsfiler og `SHA256SUMS.txt` er hentet fra de offentlige adresser uden token eller cookies; alle SHA-256 matcher. Beta-opdateringsfeeds for `darwin-arm64`, `darwin-x64` og `win32-x64` peger på de rigtige filer med samme størrelse og SHA-512 som filoversigten.
- **Platforme:** Offentlig download er ikke en ny platformsprøve. Platformsstatus fremgår af kandidatafsnittet nedenfor: Windows-installation og -opdatering, automatisk genåbning efter Mac-opdatering, fysisk Intel-hardware og Komplai er fortsat ikke afprøvet.

## Aktuel kandidat til 0.3.0-beta.1 · 16. oktober 2026

**Skrevet, enhedstestet og afprøvet som pakket Apple Silicon-app samt Intel-app under Rosetta med faktiske lokale filer. Windows-installationsfilens indhold er kontrolleret. Ikke offentliggjort.** Kandidaten bygger på brugerens commit `14ce0c3` med Aura-logoet samt lokale rettelser i test- og downloadforløbet. Dette afsnit opdaterer pakkestatus for de tidligere milepæle nedenfor; det er ikke en erklæring om en færdig udgivelse.

- **264 enhedstests består:** Hele desktop-suiten er kørt med den medfølgende Node og én test ad gangen, inklusive rettelserne til downloadside og logo. Første forsøg blev afbrudt, fordi sandboxen afviste lokale testservere med `listen EPERM`. Genkørslen med adgang til lokale testporte består uden fejl eller udeladte tests. Den første fejl dokumenterer en begrænsning i testmiljøet, ikke en produktfejl.
- **Tre aktuelle pakninger:** Bygningerne i `desktop/release/0.3.0-beta.1/current-arm64/`, `current-intel/` og `current-windows/` er afsluttet uden fejl. Hver pakkes ressourcemappe matcher 87 appfiler, 28 profilfiler og de fastlåste runtime-oplysninger. Begge Mac-apps består `codesign --verify --deep --strict`. For Apple Silicon krævede kontrollen adgang uden sandboxbegrænsningen; den begrænsede kørsel gav et misvisende fejlresultat. Kilde- og signaturkontrol er ikke notarisation eller installation på en anden Mac.
- **Medfølgende værktøjer og projekt:** Den pakkede app er startet med isolerede brugerdata og begrænset PATH. Node/npm, Git og OpenCode, projektoprettelse med profiler, faktisk preview samt oprettelse og gemning af lokale Git-versioner består. Git-prøverne bruger kun et syntetisk testprojekt.
- **Samtale og synligt arbejde i Apple Silicon-pakken:** Samtale som standard, demoens afvisning uden byggekort, frivillig planlægning, husket fravalg, konkret plan før bygning, skjult ræsonnement, kode før filskrivning, løbende opdateret filliste og diff, versionsvisning under arbejde samt Fortryd med gennemgang og kvittering består. Prøven bruger rigtig Electron og OpenCode med en kontrolleret lokal modelserver og dækker også 980 × 720.
- **Introduktion i pakken:** Første start, lokal demonstration, Spring over, genåbning, bevaret kladde, projektoprettelse med preview og guidet fortsættelse uden AI består. Lokal katalogsøgning sender ingen modelopgave. Det er en automatiseret prøve på udviklingsmaskinen, ikke en observation af en ny bruger.
- **Manuel opgradering fra beta.6 på Apple Silicon:** Den gamle app gemte et isoleret projekt, forbindelse, krypteret testnøgle, design og kladde. Efter udskiftning med 0.3.0-beta.1 var de bevaret, projektfilerne uændrede, og ingen modelopgave blev sendt automatisk. Prøven brugte manuel udskiftning af appen, ikke Squirrel.Mac eller installation fra et endeligt diskbillede.
- **Native Mac-installation:** Den særskilte `--installation-only`-prøve består med beta.6 og den endelige signerede ZIP. Squirrel.Mac hentede og installerede 0.3.0-beta.1; den installerede app består signaturkontrol, og `app.asar` er byteidentisk med kandidaten. Efter kontrolleret genåbning var projektfiler, design og kladde bevaret, og ingen modelopgave var sendt. Skærmbilledet er gennemgået. Denne prøve bruger ingen AI-forbindelse eller nøglering; bevarelse af den krypterede testnøgle er kun dækket af den separate manuelle opgraderingsprøve. Automatisk genåbning er ikke afprøvet.
- **Intel under Rosetta:** Introduktionsforløbet og den pakkede grundprøve består med Intel-pakken og x64-Node på denne Apple Silicon-Mac. De medfølgende Node/npm-, Git- og OpenCode-værktøjer, projektoprettelse, faktisk preview og lokale versioner er kontrolleret. OpenCode advarer om manglende AVX-understøttelse under Rosetta; versionskaldet og pakkeprøven består alligevel. Der er ikke kørt en ekstern AI-opgave eller foretaget en prøve på fysisk Intel-hardware. Første introduktionsprøve læste et DOM-element, før det var indlæst. Testscriptet venter nu på `#welcome-build`, før det undersøger knappens tilstand, og genkørslen består. Rettelsen vedrører testens indlæsning, ikke appens adfærd.
- **Windows-installationsfil:** Den aktuelle NSIS-pakke er udpakket og sammenlignet med `current-windows/win-unpacked`. Alle 2.529 relative filnavne, filstørrelser og SHA-256-værdier matcher; det udpakkede indhold fylder 811.397.924 bytes. EXE-filen er 251.456.106 bytes med SHA-256 `5a9f1770d04ae73b301639f94b366a8ea3594cec6929574c5f42a7b8b300b7f3`. Testens egne udpakninger er ryddet op, og alle installationsfiler er bevaret. Dette er indholdskontrol på Mac, ikke installation, start eller opdatering på Windows. Windows-pakken er fortsat usigneret.
- **Endelige Mac-filer:** Appbilletterne er vedhæftet, og de samme signerede apps er pakket i `final-arm64/` og `final-intel/`. Alle fire konkrete filer har Apples Accepted-kvittering bundet til den aktuelle SHA-256. Apps fra både skrivebeskyttet DMG og udpakket ZIP matcher hver 7.023 poster i den afprøvede app, inklusive filbytes, symbolske links, mapper og eksekveringsrettigheder. Kildekontrol, `codesign --verify --deep --strict`, `stapler validate`, `syspolicy_check distribution` og Gatekeeper består for begge arkitekturer. Diskbilledernes egne billetter består også. En negativ prøve fjernede eksekveringsrettigheden på en kopi af den faktiske Node-fil; sammenligningen afviste den, selv om filens SHA-256 var uændret.
- **Faktiske downloads:** `downloads-final/` indeholder de fem kontrollerede programfiler med `release.json` og `SHA256SUMS.txt`. Chrome har hentet begge DMG'er og Windows-EXE gennem den lokale side med identiske filnavne, størrelser og SHA-256. Desktop- og mobilvisning er set; logo, favicon og touch-ikon matcher Aura-originalen. Prøven sletter sine egne browserdownloads efter kontrollen.
- **Lokal udgivelseskontrol:** `check-release.cjs` genberegner SHA-256 og SHA-512 fra alle fem programfiler og godkender størrelser, filoversigt, kontrolsumsliste og de fire Mac-kvitteringer. Tre opdateringsfeeds dannes. Otte negative prøver afviser forkert repository/adgang, downloadadresse, digest, manglende Intel-ZIP, notariseringsstatus, SHA-512 og kontrolsumsliste. GitHub-metadata i denne prøve er udtrykkeligt syntetiske; den dokumenterer ikke en rigtig releasekladde eller offentlig adgang.

Apples endelige indsendelser er `0c2a5762-0288-4014-bbde-f05efc295b78` (Apple Silicon-DMG), `5e8a4090-7d5c-4672-9301-dc37084aaf8f` (Apple Silicon-ZIP), `faa05761-ae6a-4176-abc3-0c2325c279ce` (Intel-DMG) og `995bf4ff-7990-45f7-9e11-2360b89f30ff` (Intel-ZIP), alle Accepted den 15. oktober 2026.

**Udestående ved denne kontrol:** Windows-installation og -opdatering, automatisk genåbning efter Mac-opdatering, prøve på fysisk Intel-hardware, offentlig downloadkontrol og offentliggørelse udestår. Brugeren har den 16. oktober valgt at fortsætte betaudgivelsen uden en ny Windows-installationsprøve. Det ændrer ikke evidensniveauet: Windows-pakkens indhold er kontrolleret, men installationen er ikke afprøvet. Ingen nye eksterne modelprøver er foretaget.

**Forløbet for native Mac-prøven:** Første forsøg blev afbrudt af `ENOSPC` under download ved 43 procent. Næste forsøg hentede hele arkivet, men ventede forgæves på appens afslutning. Squirrel havde klargjort appen og skrevet en installationsanmodning. Tredje forsøg blokerede før opdateringen i macOS' nøglering; en procesprøve viste `SecItemCopyMatching` og dekrypterings-IPC på hovedtråden. Den forældreløse, isolerede testproces blev afsluttet den 16. oktober efter kontrol af programsti og datamappe. Den særskilte installationsprøve uden nøglering består herefter. Hændelsesloggen viser `update-downloaded`, `before-quit` og `will-quit`, og målversionen er observeret efter installation. Årsagen til den tidligere native timeout er ikke fastslået; ingen produktrettelse er udledt af den. Beta.6-brugere skal fortsat installere 0.3.0 manuelt én gang.

**Udgivelsesfiler og byggegrundlag den 16. oktober:** Alle fem programfiler i `downloads-final/` matcher fortsat filstørrelser, SHA-256 og SHA-512 i den kontrollerede filoversigt. Appkoden er uændret siden pakningen. De 50 filer, som de to udgivelsesworkflows bruger, er Git-sporede og matcher det kontrollerede commit; lokale ændringer vedrører testforløb, den lokale downloadgenerator og dokumentation. Dette er en lokal forberedelseskontrol, ikke en GitHub-kørsel eller offentlig downloadprøve.

Lokal evidens: `/private/tmp/aura-release-unit-suite.AyVi4W`, `/private/tmp/aura-beta1-current-package-test.log`, `/private/tmp/aura-beta1-packaged-conversation-progress.log`, `/private/tmp/aura-beta1-current-introduction.log`, `/private/tmp/aura-beta1-manual-upgrade.log`, `/private/tmp/aura-beta1-intel-introduction-final.log`, `/private/tmp/aura-beta1-intel-package.log` og `/private/tmp/aura-beta1-nsis-jz3S0B/rapport.json`. Appprøvernes mapper hedder henholdsvis `harness-package-FziN63`, `aura-conversation-progress-Pm3zPP`, `harness-introduction-hU510n`, `aura-upgrade-GKS6LR`, `harness-introduction-7cuEcQ` og `harness-package-mlKYX9`; de fulde stier står i logfilerne.

Slutkontroller: `/private/tmp/aura-final-mac-no506mg5/rapport.json`, `/private/tmp/aura-final-mac-72kr0h8k/rapport.json`, `/private/tmp/aura-beta1-local-contract.kNHOeI/rapport.json` og `/private/tmp/aura-beta1-final-download.log`. Downloadprøvens skærmbilleder ligger i `harness-download-dWWgpF`; den fulde sti står i loggen. Ingen installationsfiler eller testdata skal committes.

Bestået native installationsprøve: `/private/tmp/aura-beta1-native-installation-only.log` og `aura-upgrade-l3l1HN/rapport.json`. Den fulde teststi står i loggen; `native-events.jsonl` og `opdateret.png` ligger i samme mappe.

Native fejlsøgning: `/private/tmp/aura-beta1-native-upgrade.log`, `/private/tmp/aura-beta1-native-upgrade-retry.log`, `/private/tmp/aura-beta1-native-upgrade-events.log` og `/private/tmp/aura-upgrade-main-sample.txt`. Den gamle beta.6-app mangler opdateringsklienten, så testen indlæser klienten i processen. Den bruger ikke kandidatens `Updates.prepare`-hook og slår automatisk genåbning fra, fordi Squirrel ellers starter uden testens isolerede datamappe. Testen må derfor ikke beskrives som en fuld prøve af kandidatens automatiske genstart.

## Samtale, frivillig plan og synligt arbejde · 15. oktober 2026

**Skrevet, enhedstestet og afprøvet i den rigtige Electron-app med OpenCode, lokale projektfiler og kontrollerede modelsvar. Ikke pakket eller udgivet.** Denne milepæl følger op på Corti-demoen; den dokumenterer brugerforløbet, ikke en forbedring af Cortis svartid.

- **Samtale som standard:** Nye samtaler kan læse projektet, men motoren afviser skrivning og kommandoer. AI'en kan tilbyde Planlæg; brugeren kan også blive i samtalen. Fravalget gemmes og undertrykker senere planforslag i samme samtale. Kun en konkret plan med fire udfyldte afsnit giver et byggekort. Demoens præcise engelske afvisning og efterfølgende anerkendelse er kørt gennem appen uden byggekort eller filændring.
- **Synlig fremdrift:** Modellens forberedelse, svartekst og værktøjsargumenter skelnes. Rå ræsonnement vises ikke. Følg arbejdet viser delopgaver og kode som tekst før filskrivning, mærket som endnu ikke gemt. Parserprøver dækker Chat Completions, Anthropic Messages og Responses, delte UTF-8-tegn, delvise argumenter, ugyldige pakker, store svar, beskyttede stier og mulige nøgler. Kodevisningen ændrer ikke strømmen til agentmotoren.
- **Filer og versioner under arbejde:** Den faktiske filskrivning opdaterer Kode og Ændringer, mens næste modelsvar stadig holdes tilbage i prøven. Historikken kan læses; ændringsknapper er deaktiveret, også når en allerede åben historik møder en ny opgave. De bliver tilgængelige igen bagefter. Projektets status viser korrekt ental og flertal.
- **Fortryd med kvittering:** Den sekundære knap åbner gennemgangen. Prøven bekræfter gendannelsen, sammenligner filen byte for byte og ser den gamle overskrift i det faktiske preview. Kvitteringen får fokus og fortæller, om en ny version er gemt.

**264 enhedstests består.** `test:conversation-progress` består hele Samtale → Planlæg → Byg → livekode → filændring → versioner → Fortryd. `test:chat` består det eksisterende forløb med plan, byggegodkendelse, preview, direkte tekstrettelse, diff, fortrydelse og delingsgennemgang. `test:chat-feedback` består streaming, pause, rulning, bogstavelig HTML og faktisk tokenforbrug. `test:layout` består ved 980 × 720 og 150 procent zoom. De sidste to bruger syntetiske hændelser og en lokal modelserver som beskrevet i deres scripts. Ingen eksterne modelkald er foretaget.

Skærmene er set i appen og som skærmbilleder. Planforslaget har to valg, det konkrete plankort tre, og Fortryd har én gennemgang med én bekræftelse. Den nye appprøve kontrollerer også 980 × 720 uden vandret overløb. En observeret prøve med en ikke-teknisk bruger mangler fortsat.

**Udestående:** Skift af model, udbyder og indsats under en opgave, udbyderoversigten inde i Din AI og det nye open source-forløb er ikke del af denne milepæl. Den nye visning er ikke afprøvet mod eksterne Corti-, Claude- eller OpenAI-tjenester og ikke på Windows. De tidligere byggede 0.3.0-pakker nedenfor indeholder ikke disse kildeændringer og må ikke udgives som den aktuelle app. Endelige pakker, opgraderingsprøver og offentliggørelse udestår. Ingen commit, push eller CI-kørsel er udført.

Lokal evidens: `/private/tmp/aura-conversation-units-final.log`, `/private/tmp/aura-conversation-progress-final.log`, `/private/tmp/aura-chat-new.log`, `/private/tmp/aura-feedback-new.log` og `/private/tmp/aura-layout-new.log`. Appprøvens log angiver mappen med skærmbilleder.

## Opdateringer og 0.3.0-beta.1 · 15. oktober 2026

**Skrevet, enhedstestet og delvist afprøvet med faktiske pakker. Ikke offentliggjort.** Aura søger automatisk efter opdateringer, men downloader og installerer kun efter brugerens valg. Kritiske rettelser giver en vedvarende advarsel uden at blokere arbejdet. Beta.6 skal opgraderes manuelt én gang.

- **256 enhedstests består.** Det omfatter kanalvalg, filadresser, platform, kontrolsummer, fejl, gemt advarsel og genstart under igangværende arbejde. En tidligere ustabil historiktest bruger nu et kontrolleret ur, så rækkefølgen ikke afhænger af to filskrivninger inden for samme millisekund. Produktionsafhængighedernes npm-kontrol fandt ingen advisories.
- **Rigtig Electron og HTTP-download:** Opdateringsdialog, fremdrift, afvisning af forkert SHA-512, ingen automatisk download, vedvarende advarsel, genstartsbeskyttelse og gemt kladde er kørt med en lokal server. Installationskaldet blev opsamlet, og arkivet var syntetisk. Denne prøve dokumenterer ikke native installation.
- **Tre lokale pakninger:** Apple Silicon, Intel og Windows x64 matcher hver 83 appfiler, 28 profilfiler og runtime-låsefilen. Begge Mac-signaturer består den faktiske macOS-kontrol uden sandboxbegrænsning. Windows-installationsfilen er udpakket: alle 2.529 payloadfiler matcher den kontrollerede pakning. Den er fortsat usigneret.
- **Apple Silicon-pakken er startet:** Med isolerede brugerdata og begrænset PATH er medfølgende Node/npm, Git og OpenCode, projektoprettelse, faktisk preview og versionsgemning afprøvet. Det er en prøve på udviklingsmaskinen, ikke på en ny Mac. Den samme lokale pakke er åbnet til brugerens demo.
- **Downloadside:** Tidligere versioner står i en kort, sammenfoldet liste. Siden er afprøvet i Chrome ved desktop- og mobilbredde med faktiske beta.6-udgivelsesoplysninger, seks historikposter, 86 lokale links og uden vandret overløb. 0.3.0 fremstilles ikke som offentliggjort.

**Status ved demopausen og senere kontrol af de gamle filer:** De to indledende Mac-DMG'er blev sendt til Apple. Apple Silicon stod ved demopausen som `In Progress`; en senere læsning af de lokale kvitteringer viser `Accepted` for både Apple Silicon (`199b5719-8a7a-49a6-ab10-cf1ce454c233`, kontrolleret kl. 11.14.52 UTC) og Intel (`f8ed856d-95ee-46cb-917e-83e9debeb9a8`, kl. 11.34.37 UTC) den 15. oktober. Kvitteringerne gælder kun de gamle DMG'er, ikke den aktuelle kildekode eller nye installationsfiler. Der blev ikke foretaget en ny hash- eller billetkontrol ved denne læsning, og de gamle ZIP-filer har ingen notariseringskvitteringer. De gamle pakker afviger fra den aktuelle kildekode og må ikke offentliggøres som den nye app. Ved demopausen var opgraderingsprøven endnu ikke kørt, og skærmtest var sat på pause under Teams-demoen. Den senere manuelle Apple Silicon-opgradering og resterende platformsprøver fremgår af kandidatstatus øverst. Ingen tag, GitHub-upload, commit, push eller GitHub-kørsel blev udført i denne milepæl.

Pakninger: `desktop/release/0.3.0-beta.1/arm64-initial/`, `intel-initial/` og `windows/`. De foreløbige Mac-filer er ikke udgivelsesfiler. Lokal evidens: `/private/tmp/aura-update-units-final.log`, `/private/tmp/aura-update-ui.log`, `/private/tmp/aura-update-web.log`, `/private/tmp/aura-update-package-arm64.log` og `/private/tmp/aura-update-windows-installer.json`. Kildekontrollen skal gentages mod det commit, der senere tagges.

## Installationsprøve på Mac og Windows · 15. oktober 2026

**Afprøvet af brugeren på begge platforme:** Brugeren har installeret `v0.2.0-beta.6` på Mac og Windows og meldt, at installationen fungerede på begge maskiner. Det supplerer de tidligere automatiske pakke- og kildekontroller med en faktisk installationsprøve. Der er ikke oplyst OS-versioner, processorarkitektur eller et detaljeret testresultat for modelkald, nøglelagring og opdatering. Resultatet gælder beta.6, ikke de efterfølgende kildeændringer nedenfor.

## Forbindelser, arbejdsflade og hostingvejledning · 15. oktober 2026

**Skrevet, enhedstestet og kørt i Electron på denne Mac med rigtig OpenCode, faktiske projektfiler og lokale testservere. Ikke udgivet.** Downloaden af beta.6 indeholder fortsat kildeversionen `26a214a`, ikke ændringerne i dette afsnit.

- **Vedhæftninger til én besked · tekst og referencemapper:** Plusmenuen i skrivefeltet har to punkter, Fil fra computeren og Referencemappe. Filen vælges i computerens egen filvælger; brugerfladen kan ikke sende en filsti, og stien forlader aldrig hovedprocessen. En referencemappe giver kun en liste over navne og størrelser, højst 100 filer i tre niveauer, og brugeren vælger selv filerne; ingen hel mappe medsendes, og en mappe giver hverken fil- eller værktøjstilladelser. Indholdet læses gennem den åbne fil med kontrol af identiteten før og efter, så en fil ikke kan byttes undervejs; symbolske links, beskyttede, skjulte og genererede stier, filer uden UTF-8 og filer, der kan indeholde en nøgle, afvises. OneDrive og iCloud under Library er brugerens egne filer, resten af Library er spærret, og Windows-stier oversættes, før de beskyttede mapper kontrolleres. Gennemgangen viser den præcise tekst med kontrolsum, kvitteringen gælder én afsendelse, og et indhold, der ændrer sig bagefter, standser afsendelsen. Før du sender viser teksten i første lag med kontrolsum, revision og bytes bag Se detaljer. Valget gælder én besked og ryddes efter afsendelsen; plan og planafklaring får kun navn og kontrolsum, aldrig filteksten, og en vedhæftning starter ikke en ny AI-session. Enhedstestet (20 prøver i `chat-materials`, `chat-materials-ipc` og `chat-materials-session`). Kørt i Electron mod rigtig OpenCode og en lokal modelserver med `npm run test:materials`. 
- **Vedhæftet PDF:** En PDF læses lokalt som ren tekst med sidetal. Læsningen sker i en egen proces med egen hukommelsesgrænse, en tidsgrænse på 15 sekunder, uden netadgang, uden scripts i dokumentet, uden skrifttyper udefra og uden optegning; højst 100 sider og 128 KB tekst. Der udføres ikke OCR, og en PDF uden tekst, der kan udtrækkes, siger netop det i stedet for at lade som om, den blev læst. Den udtrukne tekst gennemgås som en tekstfil, også for mulige nøgler, og vises side for side, før den sendes. Udtrækket bruger `pdfjs-dist` 6.4.299 (Apache-2.0) efter beslutningen; `@napi-rs/canvas` er ikke taget med, fordi udtrækket virker uden. Pakken lægger `core/pdf-text-worker.cjs` og `pdfjs-dist` uden for arkivet, og kildebeviset dækker dem allerede gennem `core/**`, `package.json` og `package-lock.json`. Enhedstestet (5 prøver i `chat-pdf`) mod den rigtige læser, ikke en attrap. Kørt i Electron med `npm run test:materials`. En pakket app er ikke bygget med ændringen, så PDF-læseren er ikke afprøvet fra en installation.
- **Vedhæftede billeder:** PNG og JPEG kan vedhæftes på samme måde som tekst. Billedet afkodes og skrives om til PNG i hovedprocessen, så kun billedpunkterne sendes videre; EXIF, tekstfelter og placering fra den oprindelige fil følger ikke med. Store billeder skaleres ned til højst 1600 pixels på den lange side, og et billede, der stadig fylder mere end 1 MB, afvises med en forklaring frem for at blive sendt. Gennemgangen og Før du sender viser billedet, præcis som det sendes, med målene og kontrolsummen på det omskrevne billede. Billedet lægges på brugerens egen besked i den form, udbyderen bruger (OpenAI, Responses, Anthropic og Mistral), og beskedteksten indeholder kun billedets navn og mål, ikke billeddata. Oplyser udbyderens katalog ikke, at modellen kan læse billeder, står det i Før du sender, og billedet sendes alligevel; brugeren beslutter selv. Enhedstestet (5 nye prøver i `chat-images` og `chat-materials-session`), blandt andet at kun hele PNG- og JPEG-filer kommer igennem, at animerede billeder afvises, og at et ændret billede standser afsendelsen. Kørt i Electron med `npm run test:materials` mod den rigtige billedomskrivning og den rigtige gateway. Der er ikke udført OCR.
- **Arbejdsstatus ved forhåndsvisningen:** Mens AI'en arbejder, har skrivefeltet en rolig lyskant, og en forhåndsvisning, der vises, får et lille mærke med den aktuelle status, når der bygges. Forhåndsvisningen bliver stående: mærket ligger oven på den, og hverken adressen eller dokumentet røres, så en side med indtastet tekst eller rulleposition ikke sættes tilbage. Mærket er `aria-hidden`, så statusteksten kun læses op ét sted, i Aktivitet, og begge animationer slås fra ved reduceret bevægelse. Kørt i Electron med `npm run test:preview-edit`: mærket og lyskanten kommer under opgaven og forsvinder efter den, adressen er uændret, og et mærke sat i selve iframen står der stadig bagefter. Prøven som helhed er stadig rød på en ældre kontrol længere nede ("forhåndsvisningens nøgle i adressen sendes ikke"); den fejler også med koden fra før både dette og de andre ændringer i dag og er ikke undersøgt endnu. Forslagets sløring af hele forhåndsvisningen med Vis forhåndsvisningen-knap er udeladt efter beslutningen om lyskant og mærke.
- **Bundet appkontekst:** Appens egne instruktioner i systeminstruktionen bygges nu ét sted og vises i Før du sender som fragmenter med hver sin kontrolsum. Gennemgangen er bundet til afsendelsen: beskeden sendes kun med den kontrolsum, brugeren gennemgik, og en ændret besked, ændrede grundregler, en ændret AGENTS.md, et ændret projekt eller en ændret plan afviser afsendelsen i stedet for at sende noget andet. Grundlaget kontrolleres både før opstarten og igen lige før beskeden sendes, og opgaven tælles op før den første asynkrone kontrol, så et Stop undervejs ikke kan starte motoren bagefter. Uden for gennemgangen står de linjer, der først kendes under opstarten — samtalens kopi, den midlertidige mappe og kommandoisolationen — og det siger teksten selv. Enhedstestet (5 prøver, hvoraf 4 fejler mod koden før rettelsen), blandt andet at de gennemgåede fragmenter står ordret og i samme rækkefølge forrest i det, motoren faktisk får. Kørt mod rigtig OpenCode med `npm run test:agent` og `npm run test:library-loading` og i Electron med `npm run test:planning` (11 kontroller) og `npm run test:chat`. CLI: 26 af 26.
- **Kontekstmålingen:** Statuslinjens detaljer under skrivefeltet oplyser nu, hvor meget kontekst det senest afsluttede modelkald brugte, målt mod Auras egen grænse for et kalds input (200.000 tokens, også når modellen har et større vindue). Tallet læses fra motorens egen step-finish og regnes aldrig ud fra samtalens samlede forbrug; mangler ét af tallene, står konteksten som ukendt. Målingen hører til netop den forbindelse, model, rute, motor og modelsession, der blev målt, så et skift ikke viser en fremmed måling. Første lag viser kun en advarsel fra 80 % af grænsen. Beregningen ligger i `core/context-usage.cjs` og teksten i `ui/context-display.js`, enhedstestet (9 prøver). Kørt i Electron med `npm run test:chat-feedback`: detaljerne viste det faktisk målte kald (20 tokens), og advarslen blev vist og forsvandt igen i den rigtige brugerflade med syntetiske tal, fordi prøven ikke kan nå 200.000 tokens. Forslagets eget målerfelt og den synlige kontekstlinje i første lag er udeladt efter beslutningen om, at målingen ligger i detaljerne.
- **Spørgsmålenes levetid:** Et spørgsmål fra AI'en kan kun besvares i den opgave, motor og modelsession, der stillede det. Tidligere kunne et svar nå frem efter Stop, efter afslutningen eller i den næste opgave og blive skrevet ind i afklaringen og projektbriefen, og to hurtige klik kunne sende det samme svar to gange. Svaret låses nu synkront, før netkaldet, og bindingen kontrolleres igen efter motorens kvittering; et fejlet netkald kan prøves igen, så længe netop det spørgsmål stadig venter. Stop, afslutning, ny opgave og lukning udløber de gamle spørgsmål, og kortet fjernes samtidig i brugerfladen, så det ikke står med svarmuligheder, der ville blive afvist. Enhedstestet (17 prøver mod den rigtige `ChatSession`); 15 af dem fejler mod koden før rettelsen. Hele spørgsmålsforløbet er derefter kørt i Electron med `npm run test:planning` (11 kontroller bestået). Spørgsmålsinstruksen for alle arbejdsmåder og skjulningen af resultatkortet er udeladt efter beslutningen.
- **Fælles grundregler:** Før du sender viser under Se alle oplysninger den præcise regeltekst, der sendes, også projektets egen tilpasning. Reglerne bandt allerede afsendelsen gennem fingeraftrykket, men teksten var ikke oplyst. Enhedstestet (1 prøve) og kørt mod rigtig OpenCode med `npm run test:library-loading`: den viste tekst, inklusive en syntetisk projekttilpasning, står ordret i det faktiske modelkald, og en ændret regeltekst kræver stadig en ny gennemgang.
- **Modelstøtte:** Før du sender viser under Se alle oplysninger, hvad udbyderens katalog oplyser om værktøjer og billeder, for modellen og for en valgt rute, med tidspunktet for hvornår kataloget blev læst. Det, udbyderen ikke oplyser, står som "ikke oplyst", aldrig som understøttet. Beregningen ligger i `core/model-support.cjs` og er enhedstestet (4 prøver), blandt andet at intet andet end en boolean tæller som en oplysning, og at der ikke findes et felt til Auras egne iagttagelser. Set i appen mod en lokal testserver. Forslagets målinger af faktiske forløb er udeladt efter beslutningen om, at appens egne observationer ikke vises som prøver.
- **Prøvegrundlaget ryddet 27. oktober 2026:** Enhedstesten står nu på 628 af 628. De to gamle fejl i `tests/approvals.test.cjs` var forældede mod en strengere app: en godkendelse kræver en rigtig ventende anmodning i motoren, og prøven byggede tidligere sine egne poster. Den kontrollerer nu også selve hærdningen. De fleste Electron-prøver målte på brugerflade, som `5ffe905` bevidst ændrede: "Kun denne fil" hedder "Tillad én gang", "Tillad for denne opgave" og "Fortryd opgaven" ligger bag hver sit "Flere valg", kontrolresultater står i Aktivitet i stedet for på resultatkortet, et nyt projekts første idé starter i Byg, resuméet gentages ikke ved interne filhenvisninger eller tilvalgt historik, og forhåndsvisningen serveres gennem `aura-preview://`. Etiketterne ligger nu ét sted i `scripts/ui-test-helpers.cjs` (`approve`, `awaitApproval`, `resultOption`). To fejl lå i koden og ikke i prøverne: en tom kladde talte som en kladde i `ui/app.js`, så arbejdsmåden efter "Beskriv din idé" afhang af, om en forsinket kladdegemning nåede at køre, og `verify-approvals` ventede på "dialogen er åben eller status siger Klar", mens "Klar" allerede stod der før afsendelsen.
- **Statuspanelet i opsætningen:** Panelet til højre viser den valgte udbyder og de tre led uden selv at hente noget. Beregningen ligger i `ui/setup-status.js` og er enhedstestet (6 prøver), blandt andet at grønt kræver en gemt forbindelse, dens egen kontrol og mindst én model, og at en kontrol i gang eller en fejl går forud. Forhåndsvisning ved hover og det grønne efter en rigtig kontrol er kørt i Electron med `npm run test:key-window`. Udeladt fra forslaget: maksimeret vindue, farvede logoer og brandfarver, slogans, de små 8–10 px tekster, fluebenscirklerne og panelet i Din AI.
- **Nøglevinduet:** Nøgler og GitHub-token indtastes i et eget vindue med sin egen session i hukommelsen, eget skema, CSP, blokeret navigation og afsenderkontrol på hver kanal. Enhedstestet (19 prøver) og kørt i Electron mod lokale testservere med `npm run test:key-window`: en afvist nøgle gemmes ikke, udbyderens svar står bag Se detaljer uden nøglen, en renset nøgle kontrolleres én gang og gemmes, kataloget fra kontrollen gælder som kontrollen, Escape og Annuller sender ingenting, en server uden svar giver Gem alligevel, og en AI-nøgle afvises som GitHub-nøgle, før der sendes noget. Hovedvinduet har hverken felt eller kanal til en rå nøgle; `connections:save` afviser `apiKey`, og `hosting:token` findes ikke længere. Ikke afprøvet mod en rigtig udbyder og ikke i en pakket app.
- **Forbindelser:** Fire udbydere vises som ligestillede kort med logo, og de øvrige fem ligger bag "Vælg en anden". Flere navngivne forbindelser til samme udbyder bevares hver for sig. Oversigten kan søges, viser fire forbindelser ad gangen og registrerer tidspunkt og resultat af katalogkontrollen. Ti gemte forbindelser, en afvist nøgle, gentagen kontrol, genstart og gentaget opstartsforløb med bevaret projekt og kladde er afprøvet. En afvist modeladgang fjerner en tidligere grøn status. Katalogadgang beviser ikke, at modellen kan udføre kodearbejde eller har ledig kvote.
- **OpenAI og Azure:** API-nøgler, Azure-ressource/deployment, Responses-streaming, værktøjshistorik, krypteret tænketilstand, filgodkendelse, faktisk filændring, preview, afvisning og Stop består gennem brugerfladen. HTTP 401 giver ingen automatisk gentagelse eller nøgle i fejlteksten. Prøven bruger syntetiske nøgler og en testadapter i stedet for systemets nøglelager. Ingen ekstern OpenAI-/Azure-model eller Azure-abonnement er brugt; Chat Completions-valget er enhedstestet, ikke afprøvet mod Azure.
- **Mappe og design:** Åbning forsøger at læse projektmappen før første prompt. En mappe uden læseret afvises i appen og kan åbnes efter rettelse af rettighederne uden filændring. Nye projekter har ingen valgt brandfarve og ingen Georgia-standard. Genbrug af designpakke, logo og referencer samt genåbning består. Modellens faktiske instruktioner skelner mellem pladsholder og aftalt design og omtaler Python/Node og hostingmuligheder. Det dokumenterer instruktionerne, ikke kvaliteten af en rigtig models teknologivalg.
- **Chat og rulning:** En lokal modelstrøm med en bevidst pause afprøver synlig opstart, aktuel aktivitet, modtagne tegn, manglende nye signaler, Stop og faktisk tokenforbrug. Fire hex-formater giver farveprøver; modelgenereret HTML bliver tekst. Manuel rulning bevares under streaming, og Seneste svar genoptager følgningen. Arbejdsområdet er afgrænset til vinduet; chat og aktivitet ruller indvendigt. Lange svar og 70 aktivitetsposter er prøvet ved 980 × 720 med 100 og 150 procent zoom, rulning uden for panelerne og skift tilbage til en rullende opstartsformular. Den konkrete tomme flade fra testerens skærmbillede kunne ikke genskabes før rettelsen; den endelige adfærd er kontrolleret lokalt.
- **Hosting:** Del-dialogen viser korte leverandør- og regionsoplysninger med opsætning, databehandling og officielle kilder foldet sammen. Vercel og Azure beholder deres eksisterende uploadforløb. Cloudflare Pages, Netlify Drop, GitHub Pages, Komplai Publish og Promte Apps er eksterne vejledninger, ikke nye uploadintegrationer. Alle fem vejledninger, kildeknapper og afvisning af ukendte links er prøvet i Electron. Agentens faktiske systemtekst kender Del-knappen og skelner statisk hosting fra en almindelig Python-/Node-server. Hostingprøven bruger simulerede leverandørsvar; intet er uploadet.
- **Skills:** Runtimepakken får entydige absolutte referenceadresser, og stier kontrolleres mod den faktiske mappe. Rigtig OpenCode kan læse fire skills og deres referencer under en sti i Library/Application Support uden ekstra godkendelse. Hemmelige filer og ikke-valgte private referencer afvises fortsat. Samme grundprøve bestod også før ændringen, så testerens konkrete tilladelsesfejl er ikke bevist rettet.

250 enhedstests består. Electron-prøverne `test:setup`, `test:connections`, `test:openai-azure`, `test:introduction`, `test:preferences`, `test:desktop`, `test:chat-feedback`, `test:layout`, `test:chat`, `test:deployment`, `test:komplai-token` og `test:app-skills` består. Det samlede chatforløb omfatter idé, plan, godkendt filændring, preview, tekstrettelse, diff, fortrydelse og delingsgennemgang på samme projekt. Git bruges kun i isolerede testrepositories.

**Tilbage at afprøve:** Ændringerne er ikke pakket, installeret på testerens Mac eller prøvet på Windows/Linux. macOS’ Dokumenter-dialog og kommandoværktøjernes systemtilladelser er ikke dækket af prøven med filrettigheder. Der er ingen nye eksterne modelkald, hostinguploads eller prøve med en ikke-teknisk bruger. Samtaler, der samarbejder på tværs af modeller, er ikke tilføjet. Ingen commits, push, tags eller GitHub Actions er udført.

Lokal evidens: `/tmp/aura-units-final.log`, `/tmp/aura-connections-new.log`, `/tmp/aura-openai-azure-final.log`, `/tmp/aura-chat-feedback-final.log`, `/tmp/aura-layout-final.log`, `/tmp/aura-chat-final.log`, `/tmp/aura-deployment-final.log` og `/tmp/aura-skills-new.log`. Hver Electron-log angiver sin isolerede prøvemappe med skærmbilleder og eventuelle målinger.

## Offentlig desktopbeta · 15. oktober 2026

**Udgivet og observeret:** [Aura 0.2.0-beta.6](https://github.com/ai-alliancen-org/ai-harness/releases/tag/v0.2.0-beta.6) og [downloadsiden](https://ai-alliancen-org.github.io/ai-harness/desktop.html) er offentligt tilgængelige uden GitHub-login. Tagget `v0.2.0-beta.6` peger på brugerens commit `26a214a30daffad8dce749a3c45020547c72dd7c` (`klargør offentlig desktopbeta`). Der er ikke oprettet commits eller ændret Git-identitet herfra.

- **Faktiske filer:** De tre installationsfiler er sammenlignet med den taggede kildeversion: 67 appfiler, 28 profilfiler og fastlåste værktøjer pr. platform. Derefter er kladdens fem filer hentet via GitHub-ID og kontrolleret før offentliggørelse.
- **De to godkendte kørsler bestod:** [Desktopudgivelse 38700874085](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38700874085) og [Pages 38701021359](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38701021359), begge på `26a214a`. Komplai-liveprøven var ikke et udgivelseskrav, som godkendt. Ingen yderligere kørsler blev startet.
- **Offentlig download:** Begge DMG-filer, Windows-installationsfilen, `release.json` og `SHA256SUMS.txt` er hentet fra de offentlige adresser uden token eller cookies. Alle filstørrelser og SHA-256 matcher de kontrollerede udgivelsesfiler.
- **Den udgivne side:** App- og Terminal-valgene er afprøvet i browseren. Appafsnittet viser beta.6 og de tre rigtige installationslinks; terminalafsnittet viser den særskilte CLI-pakke.
- **Platforme:** De samme Mac-filer er signerede og notariserede med billet på app og diskbillede. Den tidligere dokumenterede prøve på Apple Silicon og under Rosetta gælder disse filer. Windows-installationsfilens indhold er kontrolleret, men den er usigneret og endnu ikke installeret på Windows. Intel-hardware og en anden Mac mangler fortsat. Offentlig download er ikke en ny platforms- eller modelprøve.

Lokal evidens: `/private/tmp/aura-beta-publication.WZxSVT/` indeholder kladde- og udgivelsesmetadata. De fem anonyme downloads og deres kontrolresultat ligger i `/private/tmp/aura-public-downloads-nvlxri/verification.json`. Ingen nye eksterne modelkald eller betalt inferens er udført.

## Klargøring til offentlig desktopbeta · 15. oktober 2026

Vedligeholderen har godkendt, at desktopbetaen udgives uafhængigt af Komplai-prøven. Kontrol af de faktiske installationsfiler, version, kontrolsummer og Mac-kvitteringer er fortsat obligatorisk. Komplai-kontrollen kan vælges til, når rigtigt login, modelkald og kreditregistrering er afprøvet; et fejlsvar stopper da udgivelsen. Udgivelsesnoterne skelner mellem den generelle beta og Komplais manglende liveprøve.

De tre installationsfiler fra `current-20261013/downloads/` er genkontrolleret: SHA-256 matcher filoversigten, og hver platforms pakning matcher 67 appfiler, 28 profilfiler og de fastlåste værktøjsversioner i commit `2bebeb3`. Der er ikke ændret i appkode eller profiler efter pakningen. Den tidligere dokumenterede Mac-afprøvning gælder stadig disse filer; der er ikke udført en ny installation på Windows eller en anden Mac.

26 relevante enhedstests består. Den ændrede udgivelseskontrol er også kørt mod alle tre faktiske installationsfiler med en lokal releasekontrakt: version, bytes, SHA-256 og Mac-kvitteringer består uden kald til en AI-udbyder. Ændret filindhold, privat repository og en fejl i den særskilte Komplai-kontrol afvises fortsat i testene. Dette er endnu ikke en prøve mod en GitHub-desktopkladde eller en udgivelseskørsel hos GitHub.

Tagget `v0.2.0-beta.6`, upload til en releasekladde og én kørsel af hvert af de to udgivelsesworkflows er godkendt. De er endnu ikke udført. Ændringen af Komplai-kravet skal først committes og pushes af brugeren; tagget skal pege på den gennemgåede kildeversion med denne ændring.

## Fælles downloadside og genbyggede desktopfiler · 13. oktober 2026

**Downloadsiden er skrevet, enhedstestet og set i en lokal browser. Alle tre faktiske installationsfiler er hentet gennem siden med matchende filnavne, størrelser og kontrolsummer. Desktopfilerne er bygget og kontrolleret lokalt; de er ikke offentliggjort.** Den offentlige Release indeholder fortsat kun terminalpakken. Ingen Actions-kørsel, tag, upload, commit eller push er udført i denne gennemgang.

- **App og Terminal deler downloadside.** To valg øverst, installationsfiler og platformsguides nedenunder. Gamle terminallinks åbner det tilsvarende afsnit. Afprøvningsstatus ligger under **Om betaen** og i dokumentationen. De seks indgange er kontrolleret ved 1280 og 390 pixels med tastatur, browserens Tilbage-knap, lokale links og visning uden JavaScript.
- **Alle tre desktopfiler er genbygget fra den aktuelle appkode.** De tidligere lokale beta.6-filer var forældede og blev afvist af kildekontrollen. De nye pakker matcher 67 appfiler, 28 profilfiler og de fastlåste værktøjsversioner: Electron 44.4.4, OpenCode 1.18.33, Node 22.23.3 og Git 2.53.0. Instruktionspakke 0.2.1 og Komplai API-token er med. Tidligere installationsfiler er bevaret.
- **Apple Silicon-pakken er kørt.** Grundprøve, plan, streaming, filændring, preview, godkendelser, genåbning, gendannelse og fejlrapport består med isolerede projekter og en kontrolleret lokal model. Intel-pakkens grundprøve og kodeagent består også under Rosetta med plan, streaming, filændring, preview og krypteret nøglelagring. Det er ikke en prøve på en separat Intel-Mac eller med en ekstern model.
- **Opdatering på denne Mac består.** Den ældre lokale beta.6 oprettede et isoleret projekt og en kladde. Den nye beta.6 genåbnede dem med samme appdata, uændret projektfil og Git-HEAD samt fungerende preview. Desuden er appen kopieret fra det endelige diskbillede til en separat mappe med mellemrum. Gatekeeper, medfølgende værktøjer, projektoprettelse, preview og versionsgemning består der. Det er stadig udviklermaskinen, ikke en anden computer eller en Finder-prøve med browserens quarantine-markering.
- **Windows-installeren er udpakket og kontrolleret.** Alle 2.528 filnavne og SHA-256-værdier matcher den kildekontrollerede `win-unpacked`-mappe. Det bekræfter pakkens indhold, ikke installation, nøglelagring eller start på Windows. Pakken er usigneret; den faktiske Windows-prøve mangler.
- **Desktopudgivelsen bruger nu kladdens og filernes ID’er.** Den samme fejl, som standsede CLI-udgivelsen, er rettet i desktopworkflowet. Midlertidige GitHub-adresser accepteres kun til kladder. Rettelsen er enhedstestet; der findes endnu ingen desktopkladde at køre den mod.

Begge Mac-apps er signeret med Developer ID. Appene og de endelige DMG-filer er notariseret og kontrolleret. Appbilletterne er vedhæftet. Begge apps er kontrolleret inde i deres skrivebeskyttede diskbilleder: kildekode, runtime, signatur, Gatekeeper og `syspolicy_check distribution` består. Apples endelige indsendelser er `787d8b93-ec9e-4f8f-ac96-c409e2cfd9d2` (Apple Silicon) og `f71e55ce-9529-46a6-b0c2-4f90bbecec5b` (Intel), begge Accepted. De oprindelige appgodkendelser er `7a614a6f-25d7-44fa-afe5-ee9aa966ad73` og `bfa9a9c7-33b7-4d8c-9216-991d0936ee38`. Ingen indsendelse skal gentages.

Komplais offentlige loginopsætning svarede HTTP 404. En rigtig Komplai-prøve og beslutningen om, hvorvidt desktopbetaen kan udgives med de øvrige forbindelser, udestår. De kendte afhængighedsfund er fortsat til stede; den aktuelle npm-kontrol viser 8 moderate og 1 høj. Begge sikkerhedsmeddelelser angiver stadig ingen rettet version: [http-cache-semantics](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) og [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), genlæst 13. oktober. Det medfølgende npm bruger `shared: false` i sin cachepolitik; det er en observation af konfigurationen, ikke en fuld afhjælpning eller en prøve med private pakkekilder. Se [demogennemgangen](demogennemgang.md).

Udgivelsesfiler: `desktop/release/beta.6/current-20261013/downloads/`. Alle tre endelige filer er hentet gennem den lokale side og matcher filnavn, størrelse og SHA-256 i `release.json`. Den lokale filoversigt består udgivelseskontrakten med Mac-kvitteringer; det er ikke en kontrol mod en rigtig GitHub-desktopkladde. Kontrolrapporter er samlet i `checks/`; `aura-windows-installer-check.json` dokumenterer Windows-indholdet, og `final-download-check.log` dokumenterer den sidste downloadprøve. `download-preview/` er en tidligere prøve før den endelige notarisation og skal ikke udgives. Den samlede enhedsprøve havde 217 beståede prøver og 18 blokeret af sandkassens netværks-/cacheadgang. Alle berørte testfiler blev derefter genkørt med den nødvendige adgang og isoleret npm-cache: 69 prøver bestod. Efter ændringerne til downloads og udgivelse består 25 relevante pakke-, Pages-, CLI- og releaseprøver.

## Første CLI-udgivelseskørsel · 13. oktober 2026

Brugeren godkendte tagget `cli-v0.2.0-beta.6` på commit `6d71813` samt én CLI-kørsel og én efterfølgende Pages-kørsel. Tagget er oprettet og pushet. [CLI-kørsel 38418240100](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38418240100) bestod bygning, CLI-tests og kontrol af pakken mod kildekoden på GitHubs Linux-runner. Det er ikke en fuld installation eller modelprøve på Linux.

Offentliggørelsen stoppede efter upload: workflowet forsøgte at slå kladden op gennem `releases/tags/TAG`, som svarede 404. Kladden havde ID `411802543` og seks filer. CLI-jobbet er ikke genstartet, og ingen filer er slettet eller udskiftet.

**Rettelsen er skrevet, enhedstestet og kørt mod den faktiske GitHub-kladde.** Den henter release og filer via ID og accepterer GitHubs midlertidige kladdeadresser uden at tillade dem på den offentlige downloadside. Alle seks faktiske filer matcher deres kontrolsummer og kildecommit; npm-pakken er byteidentisk med den allerede Mac-afprøvede kandidat. 17 relevante udgivelses- og Pages-tests består. Det gamle linkkrav er også udløst på de faktiske kladdemetadata. Workflowrettelsen er ikke kørt hos GitHub eller committet.

**CLI-betaen og downloadsiden er offentliggjort og observeret.** Brugeren godkendte en engangsundtagelse til direkte offentliggørelse af den kontrollerede kladde. Før API-kaldet blev indhold, fil-ID'er, størrelser og kontrolsummer sammenlignet med den tidligere gennemgang. Release `411802543` blev offentliggjort som beta uden at ændre filer, tag, noter eller commits. [Pages-kørsel 38420229545](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38420229545) på commit `6d71813` bestod. Der er kun startet de to godkendte kørsler: den oprindelige CLI-kørsel og Pages-kørslen.

- [Den offentlige terminalside](https://ai-alliancen-org.github.io/ai-harness/terminal.html) er åbnet i en isoleret browser uden GitHub-login. Downloadknappen henter `aura-harness-0.2.0-beta.6.tgz` fra den rigtige version. Filen er byteidentisk med den kontrollerede Mac-pakke: SHA-256 `e0d09ca1f000034dcf4ca7ebd08cd231d79b77b9c982a1961c801abe8bd94b1d`.
- Alle seks releasefiler er desuden hentet gennem de offentlige adresser uden login. Størrelser, kontrolsummer, kildecommit og arkivindhold består kontrollen. De tre platformsguides åbner den fastlåste version på GitHub.
- Den faktiske side er visuelt gennemgået ved 1280 og 390 pixels. Download, viste kontrolsum og tre platformvalg er kontrolleret. Ingen vandret rulning på mobil eller JavaScript-fejl.
- Windows CMD/PowerShell, Linux og Intel-Mac mangler stadig afprøvning på målmaskinerne. Der er ingen ny prøve af Komplais produktionslogin. Denne udgivelse indeholder terminalpakken, ikke nye desktopinstallationsfiler.

Repositoryets fire workflowfiler har kun manuel start. GitHubs særskilte CodeQL-standardopsætning blev ved læsende kontrol fundet aktiv med automatisk kørsel; den er ikke ændret, og spørgsmålet om at deaktivere den afventer brugerens svar.

Lokal evidens: `/private/tmp/aura-cli-draft-tests.log`, de kontrollerede kladdefiler i `/private/tmp/aura-cli-draft-by-id/`, metadata i `/private/tmp/aura-cli-draft-before-publish.json` og `/private/tmp/aura-cli-published-411802543.json`, offentlig download i `/private/tmp/aura-cli-public-Ur6vq7/` og resultatet i `/private/tmp/aura-cli-public-download-result.json`. Browserbilleder: `/private/tmp/aura-cli-public-desktop.png` og `/private/tmp/aura-cli-public-mobile.png`.

## Terminalpakke, platformsguides og GitHub-distribution · 13. oktober 2026

**Skrevet, enhedstestet og afprøvet med den faktiske lokale CLI-pakke på macOS arm64. Ikke offentliggjort eller afprøvet på Windows/Linux.** [Udgivelsesvejledningen](udgivelse-cli.md) beskriver det særskilte CLI-forløb. Desktopappens udgivelseskrav er bevaret.

- **35 relevante tests består:** CLI, udgivelsesregler og eksisterende Pages-/desktoprelease-kontrol. Nye negative prøver afviser ekstra/manglende filer, forkerte versioner, kladder, fremmede downloadadresser, ændrede hashværdier, symlinks og uventede arkivstier.
- **Den faktiske pakke er installeret separat på Mac.** Alle 93 installerede filer matcher både arkivet og kilderne. `doctor` finder Node 22.23.3, Git 2.50.1 og pakkens egen OpenCode 1.18.33. Terminalprøven gennemfører login, skjult nøgle, krypteret genåbning, plan, filændring, godkendelse, afvisning, preview, diff, stop, historik og en simuleret forbindelsesfejl. Modellen er en kontrolleret lokal server. Ingen betalte kald.
- **Udgivelsesstop er udløst på rigtige pakkefiler.** En beskidt arbejdsmappe, en pakke markeret `publishable: false`, en ændret Windows-vejledning og en ekstra fil afvises. Kilder og arkiv er kontrolleret før og efter pakning. Det er ikke en GitHub-kørsel eller en platformsinstallation på Linux.
- **Terminalsiden er set i browseren** ved 1280 og 390 pixels. Tre platformvalg, foldede detaljer, tastatur og reduceret bevægelse er kontrolleret. Ingen vandret rulning. Både den faktiske tomme releaseoversigt og en lokal visningsprøve med komplette metadata er afprøvet. Browserens download er dirigeret til den faktiske lokale npm-pakke og kontrolleret med SHA-256; det er ikke en offentlig GitHub-download.
- **GitHub er kun læst.** API'et viser ingen Releases og en Pages-adresse på `https://ai-alliancen-org.github.io/ai-harness/`. Alle fire workflows er YAML-kontrolleret og har kun `workflow_dispatch`. Det nye CLI-workflow er ikke kørt hos GitHub. Der er ikke startet CI, oprettet tags, uploadet filer, committet eller pushet.
- **Manglende prøver:** Windows i PowerShell/CMD udføres af brugeren efter [Windows-guiden](../cli/WINDOWS.md). Linux, macOS Intel, en almindelig ny bruger, faktisk offentlig download og Komplais produktionslogin mangler. Docker var ikke startet på denne Mac; der er ikke startet en Linux-maskine eller ændret infrastruktur.

Den lokale kandidat ligger i `dist/cli-distribution-2026-10-13/candidate-1/`. Npm-pakkens SHA-256 er `e0d09ca1f000034dcf4ca7ebd08cd231d79b77b9c982a1961c801abe8bd94b1d`. Den er mærket som en lokal prøve og kan ikke passere offentliggørelseskontrollen. Udgivelsen skal pakkes igen fra det gennemgåede, rene commit.

Lokal evidens: `/private/tmp/aura-distribution-unit.log`, `/private/tmp/aura-distribution-live.log`, browserbillederne `/private/tmp/aura-cli-page-desktop.png` og `/private/tmp/aura-cli-page-mobile.png`. Terminaludskriften ligger i `aura-cli-real-EKPxFX` under macOS' midlertidige mappe.

## Komplai API-token og Windows-prøve · 13. oktober 2026

**Skrevet, enhedstestet og afprøvet i Electron med rigtig OpenCode, faktiske projektfiler og en kontrolleret lokal Komplai-server. Ikke afprøvet mod Komplais produktions-API.** App og CLI har API-token som alternativ til browserlogin. [API-kontrakten](komplai-api-token.md) angiver den nødvendige metadataudvidelse; klienten afviser tilslutning, hvis API'en endnu ikke leverer den.

- **36 relevante enhedstests består.** De omfatter eksisterende PKCE-login, tokenkontrol, CLI-login, krypteret lagring, forkert adgang, manglende rettigheder, udløb, annullering og ændret organisation/kontrakt/vilkår. Fjernelse af et manuelt token kalder ikke serverens tilbagekaldelse; browserlogin beholder den tidligere adfærd.
- **Electron-prøven består.** En forkert nøgle, manglende API-metadata, read-only-adgang og ændret kontrakt bliver afvist gennem brugerfladen. Derefter gennemføres gyldigt token, valg af model, filgodkendelse, faktisk filændring, preview og forbrug i DKK. Tilslutning bruger kun GET-kald og ingen inferens. Tokenet kan fjernes lokalt, også når serveren bagefter afviser det.
- **Brugerfladen er set og målt.** Komplai-området går fra ét valg og 19 ord til to valg og 14 ord. Tokenindtastning har ét felt og to valg; gennemgangen har tre valg inklusive datavilkår. Tallene omfatter forbindelsens indhold, ikke appens navigation. Tastaturfokus, reduceret bevægelse og 980 × 720 er kontrolleret. En person uden teknisk baggrund har endnu ikke afprøvet denne ændring.
- **Nøglebeskyttelse:** Enhedstestene bruger CLI'ens rigtige kryptering. Electron-prøven erstatter systemets nøglebeskyttelse med en syntetisk testadapter og er ikke en Keychain-/DPAPI-prøve. Ingen rigtige tokens eller kreditter er brugt.
- **Windows:** [Vejledningen](../cli/WINDOWS.md) dækker lokal installation, PowerShell og CMD, mapper med mellemrum, skjult indtastning, plan/byg, afvisning, Ctrl+C, preview, genåbning og rapportering. Brugeren udfører platformsprøven; Windows og Linux er fortsat uprøvede for denne CLI.
- **Den konkrete CLI-pakke er installeret og kørt på macOS arm64.** Alle 91 pakkede og installerede filer matcher arbejdsmappen byte for byte. `doctor` finder pakkens OpenCode 1.18.33, Node 22.23.3 og Git. Den installerede CLI har gennemført plan, godkendt ændring, afvisning, Ctrl+C, preview, genåbning af det krypterede lager og en simuleret forbindelsesfejl i en rigtig terminal. Denne terminalprøve bruger en kompatibel lokal modelserver; det nye Komplai-tokenforløb er særskilt enhedstestet i CLI og gennemført i Electron.
- **Installationsfejl fanget:** Den første installation manglede motoren, fordi npm udelod en valgfri afhængighed. Eksplicit installation viste `ENOSPC`. Efter oprydning i vores midlertidige testinstallationer blev pakken installeret på ny med motoren og bestod prøven. Derfor indgår `doctor` som et påkrævet trin i Windows-vejledningen. Det er ikke dokumentation for en fejlfri installation på andre maskiner.

Lokal testpakke: `dist/cli-token-2026-10-13/aura-cli-windows-test.zip`. Den indeholder npm-pakken, Windows-vejledningen, kildefingeraftryk og kontrolsummer. Npm-pakkens SHA-256 er `ea55ca5e48e769be975adefe441cf53dfb89d54b6f2bc9805028dd40ef73cf27`. Der er endnu ingen offentlig download af denne CLI-pakke.

Lokal evidens: `/private/tmp/aura-token-unit-final.log`, `/private/tmp/aura-token-ui.log`, `/private/tmp/aura-token-measure.log` og `/private/tmp/aura-token-packaged-live.log`. Electron-skærmbillederne ligger i `aura-token-ui-bExCL4`, før/efter-målingen i `aura-token-measure-R2FPeD` og terminaludskriften i `aura-cli-real-QNYZFn` under macOS' midlertidige mappe. Ingen commits, push, Actions, publicering eller nye desktopinstallationsfiler er udført i denne milepæl.

## Aura CLI og nøglebeskyttelse på tværs af systemer · 13. oktober 2026

**Skrevet og enhedstestet; terminalforløbet er afprøvet på macOS med rigtig OpenCode og faktiske projektfiler. Ingen offentlig CLI-udgivelse.** CLI'en deler kodeagent, modelforbindelser og skills med desktopappen. Den kan åbne og oprette projekter, planlægge, bygge med godkendelser, vise preview i browseren, genåbne samtaler og gennemgå Git-versioner. Installationsvejledning og platformskontrol står i [CLI-vejledningen](../cli/README.md).

- **Nøglelager:** CLI'en bruger AES-256-GCM med scrypt og en adgangssætning, som indtastes skjult og ikke gemmes. Faktisk kryptering, genåbning, forkert adgangssætning og ændret krypteret indhold er afprøvet. Desktopappen beholder Keychain på macOS, DPAPI på Windows og systemets nøgletjeneste på Linux. En ny kontrol afviser Electrons usikre Linux-fallback `basic_text`; testen udløser afvisningen, selv når Electron melder kryptering tilgængelig.
- **Fælles funktioner:** Tests bruger faktiske mapper med mellemrum, kladder, regler, preview og versionsgemning/gendannelse. Commits oprettes kun i nye isolerede repositories med syntetiske filer. Hostingens gennemgang og afvisning er afprøvet med en simuleret adapter; der er ikke uploadet til Vercel eller Azure.
- **Testresultater:** Den samlede suite har 246 tests. 243 bestod i den sidste samlede kørsel; tre Git-tests blev afbrudt af manglende diskplads. Efter fjernelse af denne prøves genhentelige motorkopi bestod alle syv Git-tests ved genkørsel. De 17 CLI-tests består, herunder afviste nøglelagre, stop under forberedelse og korrekt ændringsantal efter en afvist opgave. Den foregående samlede suite bestod med 245 tests før tilføjelsen af den sidste regressionstest.
- **Pakning:** En lokal npm-pakke indeholder CLI, fælles motorkode og instruktionspakke 0.2.1. Native OpenCode-pakker er låst til 1.18.33 for macOS, Windows og Linux på x64/arm64 samt Linux med musl. Pakkens installerede Mac-variant har bestået `doctor` med Node 22.23.3 og bruger sin egen motorafhængighed. Installation af Codex-regler fra en pakket CLI er afprøvet i et separat projekt.
- **Installeret pakke afprøvet:** En rigtig terminal gennemførte skjult nøgleindtastning, plan, godkendt filændring, HTTP-preview, afvist ændring, diff, Ctrl+C, en ny opgave efter stop, afslutning/genåbning, oplåsning og en simuleret HTTP 401-fejl. Der bruges rigtig OpenCode og en kontrolleret lokal modelserver. Kaldets fælles regler, uændrede filer efter afvisning og fravær af nøgler/adgangssætning i terminaludskriften kontrolleres. En tidligere gentagelse ramte også fuld disk; den endelige installerede pakke bestod hele prøven efter oprydningen. Det er ikke en prøve med en rigtig ekstern AI-model.
- **Begrænsninger:** Windows CMD/PowerShell, Linux, Intel-Mac og Windows arm64 er ikke kørt på målplatformene. Der er ingen ny prøve med en rigtig AI-udbyder, Komplais produktionslogin eller kreditforbrug. Komplai-login deler desktopappens PKCE-forløb og kræver browser-callback på samme maskine; login fra en fjern SSH-maskine er ikke et understøttet device flow. CLI'ens samtalehistorik og projektfiler er ikke krypteret af nøglelageret.

Der er ikke ændret i Komplais repository, publiceret til npm eller startet GitHub Actions, commits, push eller deployment i denne milepæl. Næste platformsprøve skal installere den konkrete CLI-pakke på Windows og Linux og gennemføre login, plan, godkendt/afvist ændring, Ctrl+C, preview og genåbning.

Lokal evidens: `/private/tmp/aura-cli-unit-node22-final.log`, `/private/tmp/aura-cli-git-retry.log` og `/private/tmp/aura-cli-packaged-retry.log`. Den gennemgåede terminaludskrift ligger i prøvemappen `aura-cli-real-RFNPDu` under macOS' midlertidige mappe. Pakken er `/private/tmp/aura-cli-package/candidate-3/aura-harness-0.2.0-beta.6.tgz`, SHA-256 `2aeb89bcb7cce5863bdc02319d94095193e9066a609cd151b7035195ae773b59`. ZIP-pakkernes bytekontrol er kørt med repositoryets Node 22.23.3; Node 26 gav et andet komprimeringsresultat og bruges ikke som grundlag for den kontrol.

## Instruktionspakke 0.2.1: fire sikkerhedstilføjelser · 13. oktober 2026

**Skrevet, enhedstestet og installeret gennem appen i et isoleret projekt. Ikke offentliggjort.** De eksisterende skills er udvidet med kontrol af afhængigheders oprindelse, konkrete adgangsprøver mellem brugere og organisationer, gennemgang af agenters/MCP-værktøjers/hooks' rettigheder samt dokumentation af fund og godkendelser for den faktisk kontrollerede version. Der er fortsat 12 grundlæggende skills og to valgfrie integrationer. Ingen scannere eller eksekverbare scripts er tilføjet.

- **Enhedstestet:** 29 relevante tests består for bibliotek, ZIP-pakker, installation, valgfrie funktioner og skills. De kontrollerer blandt andet referencer, filindhold, manifest og kontrolsummer samt bevarelse af brugerens egne filer. Alle 23 downloadpakker er genereret som version 0.2.1.
- **Kørt i Electron:** Værktøjsforløbet installerer den nye reference `agentadgang.md` med byteidentisk indhold. Eksisterende projektregler bevares; gentagen installation og afinstallation med brugerændringer er afprøvet. Den udvidede sikkerhedsbeskrivelse er åbnet og visuelt gennemgået i appen. Git-commits forekommer kun i prøvens isolerede repository med syntetiske filer.
- **Webguide afprøvet:** Fem sider ved to skærmbredder, 83 lokale links og begge hovedforløb består uden sidefejl, unavngivne betjeninger eller vandret overløb. Det er en lokal prøve, ikke kontrol af en ny offentlig udgivelse.
- **Begrænsning:** Kontrollerne dokumenterer pakkernes indhold og installation, ikke at en rigtig model følger alle instruktionerne eller opdager konkrete sårbarheder. Ingen eksterne modelkald eller sikkerhedsscanning af en brugers projekt er gennemført. Skills er vejledning, ikke teknisk håndhævelse eller GDPR-godkendelse.
- **Installationsfiler skal genbygges:** Arbejdsmappen og de nye webpakker bruger 0.2.1. De allerede byggede beta.6-installationsfiler nedenfor indeholder fortsat 0.2.0 og skal genbygges og kontrolleres før udgivelse. Ingen commits, push, GitHub Actions eller offentliggørelse er foretaget.

Lokal evidens: `/private/tmp/aura-skills-021-unit.log`, `/private/tmp/aura-skills-021-tools.log` og `/private/tmp/aura-skills-021-web.log`. Skærmbilledet af den ændrede sikkerhedsbeskrivelse ligger i prøvemappen `harness-vaerktoejer-pqwoHg/02b-sikkerhedsskill.png` under macOS' midlertidige mappe.

## Beta.6: installationsfiler og udgivelsesvej · 13. oktober 2026

**Bygget og afprøvet lokalt med faktiske installationsfiler. Ikke offentliggjort.** Tre nye filer ligger i `desktop/release/beta.6/downloads/`: Mac med Apple Silicon, Intel-Mac og Windows x64. De indeholder Komplai-integrationen. Tidligere pakker er bevaret. [Udgivelsesvejledningen](udgivelse.md) beskriver de resterende trin; [udgivelsesnoterne](releases/0.2.0-beta.6.md) er en kladde.

- **Skrevet og enhedstestet:** 18 relevante tests består for pakning, downloadoversigt, Pages og udgivelseskontrol. Blandede versioner, manglende eller ekstra filer, ugyldige kontrolsummer, ændret filindhold, manglende Mac-kvitteringer og ufuldstændig Komplai-konfiguration afvises. En mislykket kontrol af blandede versioner bevarer den eksisterende filoversigt.
- **Faktisk pakkeindhold kontrolleret:** 66 kilde-/metadatafiler og 27 profilfiler matcher arbejdsmappekoden i begge monterede Mac-diskbilleder og i Windows-installationsprogrammets udpakkede indhold. Runtime-manifesterne matcher de fastlåste værktøjer: Node 22.23.3, Git 2.53.0 og OpenCode 1.18.33. Kontrollen afviste desuden en faktisk beta.5-app som forkert version. Dette er indholdskontrol, ikke en uafhængig sikkerhedsgennemgang af alle medfølgende programmer.
- **Mac-signering:** Begge apps inde i diskbillederne består den strenge signaturkontrol med Developer ID og Team ID `2UX98897JW`. Beta.6 er endnu ikke notariseret. Ingen filer er indsendt til Apple i denne milepæl. Downloadoversigten viser derfor ikke pakkerne som notariserede, og udgivelseskontrollen afviser den aktuelle filoversigt.
- **Pakket Apple Silicon-app afprøvet:** Oprettelse af projekt, faktisk forhåndsvisning og manuel versionsgemning består med isolerede appdata og de medfølgende værktøjer. Git-commits forekommer kun i prøvens nye repository med syntetiske filer.
- **Byggeforløb i den pakkede app:** Rigtig OpenCode og en kontrolleret lokal modelserver gennemførte plan uden filændring, godkendt kodeændring, fungerende preview med filtrering, mobilvisning, en efterfølgende ændring og gendannelse til de oprindelige filbytes. Første forsøg stoppede med timeout under opsætningen; en gentagelse bestod uden ændring af appkoden. Årsagen til første stop er ikke fastslået. Prøven logger nu fejlkontekst i kontrolleret tilstand. Dette er ikke en rigtig Komplai- eller modelprøve.
- **Downloads afprøvet:** En lokal browser hentede alle tre faktiske installationsfiler og kontrollerede filnavn, størrelse og SHA-256. De ekstra downloadkopier blev slettet efter kontrollen. Den lokale downloadside er afprøvet på både bred og smal skærm.
- **Pages afprøvet:** Fem sider i to skærmbredder, 83 lokale links og begge hovedforløb består uden sidefejl eller vandret overløb. Det er prøvet både med GitHubs faktiske tomme Release-liste og med en lokal prøveudgivelse baseret på de tre filers faktiske metadata. Sidstnævnte er kun en visningsprøve, ikke en offentlig Release. Downloadsidens desktop- og mobilbilleder er gennemgået.
- **Manuel offentliggørelse:** Det nye Release-workflow og de eksisterende bygge-/Pages-workflows har kun manuel start. YAML og kommandosyntaks er kontrolleret lokalt. Udgivelseslogikken er afprøvet med lokale filer; selve workflowet har ikke kørt hos GitHub. Ingen Actions-minutter, tags, Releases, commits, push eller deployment er startet herfra.
- **Eksterne forudsætninger:** GitHub viste fortsat ingen Releases. Et faktisk læsende kald til `https://api.komplai.dk/v1/aura/config` gav HTTP 404, som udløste den nye kontrol og stoppede den. Komplais produktionslogin, modelkald og kreditregnskab er endnu ikke afprøvet. De tidligere kendte afhængighedsfund er ikke rettet af denne pakning og skal vurderes inden offentliggørelse; se [demogennemgangen](demogennemgang.md).

**Mangler før kollegaprøven:** Apple-notarisation af de endelige Mac-filer, rigtig Komplai-prøve, offentlig Release og Pages-download samt installation og opdatering på testernes maskiner. Intel-Mac og Windows er ikke kørt på deres målplatforme i denne milepæl. Windows-filen er usigneret. Appen er ikke observeret hos en ny bruger.

Lokal evidens: `/private/tmp/aura-beta6-unit-final.log`, `/private/tmp/aura-beta6-package.log`, `/private/tmp/aura-beta6-controlled-retry.log`, `/private/tmp/aura-beta6-download.log`, `/private/tmp/aura-beta6-web-final.log` og `/private/tmp/aura-beta6-web-actual.log`. Loggen for første afbrudte byggeprøve er `/private/tmp/aura-beta6-controlled.log`. Installerne, filoversigten og kontrolsummerne ligger i den ignorerede mappe `desktop/release/beta.6/downloads/`.

## Komplai-login og organisationens kreditter · 13. oktober 2026

**Implementeret i Aura og Komplais backend; afprøvet lokalt med faktiske filer og isoleret kreditregnskab. Ikke deployet.** Komplai ligger under **Vælg en anden**. Brugeren logger ind i systembrowseren, vælger organisation og bekræfter brug af dens fælles AI-kreditter. Modeller, kundetakster i DKK og datavilkår kommer fra Komplai. Ingen Scaleway-nøgle indtastes i Aura, og der er ingen automatisk ændring af model eller betalingsform.

- **Enhedstestet:** Auras samlede suite bestod med 217 tests. Efter de sidste rettelser består de 27 relevante Komplai-/workbench-tests, herunder syv direkte Komplai-prøver af PKCE, afbrydelse, nøglelagring, organisationsbinding, vilkår, afregningsvisning, begrænsede svar og logoutfejl. Komplais 57 relevante enhedstests består: kodeprotokol, modelprofiler, kreditregnskab og eksisterende chat.
- **Kørt med rigtig API og database:** Ni integrationsprøver består mod Fastify, PostgreSQL og OpenFGA. De afviser også signerede login-tokens uden udløb eller brugeridentitet samt forkert udsteder, audience og udløbne tokens. Forkert klient og organisation, manglende bekræftelse, dubletter, ændrede priser og fjernet organisationsadgang afvises. Cachetakst, fælles saldo og samtidige reservationer er kontrolleret. Afbrudte svar bevarer en usikker reservation. Logout virker også efter udløb eller fjernet adgang. En bevidst fjernet databasebegrænsning udløser migrationskontrollen; transaktionen rulles bagefter tilbage.
- **Kørt i Electron med rigtig OpenCode:** Browser-callback, organisationsvalg, filgodkendelse, faktisk filændring, preview, afvisning, Stop og logout er gennemført i et isoleret projekt med mellemrum i navnet. Forbrug vises i DKK, og adgangsnøglen findes ikke i brugerfladens tekst. Projektet indeholder kun syntetiske filer. Der er ikke oprettet commits.
- **Set i appen:** Komplai-login og organisationsvalg har hver sit trin. Organisationsformularen har fire synlige betjeninger: valg af organisation, bekræftelse, Afbryd og de foldede datavilkår. Afbryd efter login og efterfølgende nyt login er prøvet i Electron. Kodeændringen er vist i forhåndsvisningen. Der er endnu ingen observation af en ny bruger.
- **Konfiguration kontrolleret:** Typekontrol af Komplais delte API-kode og API-tjeneste er genkørt og består; Hub bestod ved den foregående kontrol. Terraform-konfigurationen består `validate` med den fastlåste Zitadel-provider. En efterfølgende læsende produktionsplan med mål `zitadel_application_oidc.aura` viser én oprettelse af Aura-klienten og ingen andre ressourceændringer. Der er ikke kørt `apply`.
- **Afgrænsning:** Loginudsteder og Scaleway-model er simulerede. Kryptering bruger en testudgave af nøglelageret, ikke den rigtige macOS-nøglering. Windows, pakket app, rigtigt Zitadel-login og konkrete Scaleway-modeller er ikke afprøvet i denne milepæl. Den lokale databaseprøve udelader Index-migrationen, der kræver pgvector, og er ikke en samlet migrationsgodkendelse af Komplai. Der er ingen eksterne modelkald, betalingsforbrug, ændringer af Zitadel, GitHub Actions eller deployment.

**Forbrugsloft og datavisning:** De syv Komplai-enhedstests og fire nye prøver af loftet på 10 kr. består. Beløbsgrænsen er udløst med et kald, som ville overskride loftet; kaldet når ikke transporten. Den samme kontrol er koblet ind i den gennemførte Electron-prøve. Komplai står i det korte resumé; Scaleway, Hetzner, behandlingssteder og fulde priser kan læses i de udvidede oplysninger. De lange prisoplysninger ombrydes nu, og ændrede datavilkår kræver stadig ny godkendelse. Skærmbilledet er gennemgået.

**Almindeligt medlem:** Alle ni integrationsprøver er desuden gennemført med rollen `member`, tildelt Chat-adgang og organisationens aktiverede kodeprofil. Login, filændring og kreditafregning i Electron krævede ikke organisationsadministratorrettigheder. Dette er afprøvet med en syntetisk konto; Sebastians faktiske konto er ikke oprettet eller inviteret herfra.

Evidens: `desktop/tests/komplai.test.cjs`, `desktop/tests/komplai-live-budget.test.cjs`, `desktop/scripts/verify-komplai.cjs` og Komplai-repositoryets `packages/api-access/src/aura-http.integration.test.ts`. Den seneste gennemførte Electron-prøve har screenshots under `/private/var/folders/q9/914lvw356897pk8pb_29flv00000gn/T/aura-komplai-desktop-cxbnC6/`; datavisningen er visuelt gennemgået fra den forudgående prøve i `aura-komplai-desktop-qke3WC/`. Enhedslogs fra de tidligere kontroller ligger i `/private/tmp/aura-komplai-unit.log` og `/private/tmp/aura-komplai-targeted.log`.

Før rigtig brug skal Komplais offentlige Aura-loginapp oprettes, backend udgives og organisationens coding-adgang, modeller og datavilkår aktiveres. Opsætningen står i Komplai-repositoryets `docs/AURA.md`. Pakker fra før beta.6 indeholder ikke denne milepæl; de nye lokale beta.6-filer er beskrevet ovenfor.

### Første kollegaprøve på Mac og Windows

Download skal ske fra GitHub Pages, som linker til installationsfilerne i GitHub Releases. Den læsende kontrol 13. oktober fandt Pages konfigureret på `https://ai-alliancen-org.github.io/ai-harness/`, men ingen Releases. Komplais offentlige `/v1/aura/config` svarede 404. Den rigtige login- og modelprøve er derfor endnu ikke gennemført.

1. Udgiv Komplais Aura-login og API, og kontroller dem med en rigtig konto og den aftalte model. Den særskilte automatiske prøve har et loft på 10 kr.; almindelig appbrug har ikke dette personlige loft.
2. Invitér testeren som almindeligt medlem af Komplai. En e-mailadresse på `komplai.dk` er ikke en adgangstildeling. Kontroller kontoens organisationsmedlemskab og appadgang samt organisationens godkendelse af kodeværktøjer, modeller og kreditter.
3. Byg og kontroller en ny Mac- og Windows-pakke med integrationen, publicér dem på Releases, og opdater Pages gennem den godkendte udgivelsesvej. Test den faktiske download fra en browser uden GitHub-login. Ingen workflow eller publicering startes automatisk.
4. Lad testeren installere, forbinde Komplai, bygge og ændre en side med opdigtede data, lukke appen, fortsætte projektet og logge ud. Kontroller forbruget i Komplais regnskab. Notér appversion, operativsystem og det trin, hvor hjælp var nødvendig; del ingen tokens eller private projektfiler.

Planen er ikke en installationsgodkendelse. Rigtigt OAuth-login, betalt modelkald, Mac-/Windows-installation og observation af testeren mangler fortsat.

## Installationskontrol før invitation · 10. oktober 2026

**Tre lokale installationsfiler til beta.5 er bygget. De er ikke publiceret.** De ligger i `desktop/release/beta.5/downloads/` sammen med en downloadside, `release.json` og kontrolsummer. Windows er usigneret og endnu ikke installationsafprøvet. Intel-Mac kræver fortsat kontrol på en rigtig Intel-Mac. Rigtig modelprøve og testerens downloadadgang mangler også.

- **GitHub-kørsler er stoppet efter brugerens besked om forbrug.** Kørsel [38084418217](https://github.com/ai-alliancen-org/ai-harness/actions/runs/38084418217) på commit `2eedb27` blev afbrudt. Den nåede 210 beståede enhedstests på hver Mac-type og 207 beståede plus tre platformsbestemte overspringninger på Windows, uden testfejl. Apple Silicon nåede også pakket app, gendannelse, kontrolleret byggeforløb og demo; upload fejlede på lagerkvoten. Intel- og Windows-jobbene blev stoppet under pakning. Ingen nye byggearkiver blev gemt.
- **Ingen automatisk CI/CD:** Pages er deaktiveret på GitHub. Begge workflowfiler har nu kun `workflow_dispatch`; en konkret kørsel eller genaktivering kræver brugerens udtrykkelige tilladelse. Der startes ikke en kørsel alene på baggrund af ønsker om installation eller færdiggørelse. Lokale bygninger bruger ingen Actions-minutter.
- **Fire gamle byggearkiver er slettet med brugerens tilladelse.** Alle fire ZIP-filer blev først kontrolleret for størrelse, SHA-256 og indhold. GitHubs artefaktliste var derefter tom. Kopierne ligger nu i `desktop/.cache/actions-archive-2026-10-10/`, med `manifest.json`; de er flyttet fra den tidligere midlertidige mappe. Sletningen frigør lagerplads, ikke allerede brugte minutter.
- **Windows x64 er krydsbygget lokalt.** Den egentlige NSIS-installationsfil er pakket ud og kontrolleret; appen, ASAR og medfølgende Git, Node og OpenCode matcher byggeoutputtet. Alle 91 kontrollerede kilde- og profilfiler matcher repositoryet. OpenCode er 1.18.33, Node 22.23.3 og Git 2.53.0. Det er en filkontrol på Mac, ikke installation, første start eller opdatering på Windows. Filen er usigneret.
- **Apple Silicon-appen er signeret og notariseret.** Apple godkendte den første beta.5-DMG under `a07436f2-1508-4ae0-933f-9106ed8a2f94`. En efterfølgende kontrol fandt, at appen inde i diskbilledet manglede sin egen billet: `syspolicy_check` gav `Notary Ticket Missing`, selv om Gatekeeper accepterede signaturen. Billetten er nu også vedhæftet appen, som er pakket igen uden ændring af appkode eller signatur. Appen inde i den nye DMG består `codesign --verify --deep --strict`, `stapler validate`, Gatekeeper og `syspolicy_check distribution`. Ingen sikkerhedsindstillinger er ændret. Diskbilledet er bevidst ikke separat kodesigneret; en `spctl`-kontrol af diskbilledets primære signatur svarer derfor `no usable signature` og erstatter ikke kontrollerne af appen og notariseringsbilletten.
- **Den nye Apple Silicon-DMG afventer sin egen kvittering:** indsendelse `763936d3-5882-4a06-a9f5-b335c224ebb0`. Appens billet er vedhæftet og kontrolleret; downloadoversigten kalder først selve DMG-filen notariseret, når dens kvittering matcher dens aktuelle SHA-256. Status og filhash er gemt i `desktop/release/beta.5/apple-silicon/notary-*.json`.
- **Intel-Mac er bygget og signeret.** Samme 91 kilde-/profilfiler og fastlåste værktøjer er kontrolleret. `test:package` består under Rosetta med isolerede data, preview og lokal versionsgemning. OpenCode advarer om manglende AVX under emulering. Den efterfølgende kontrollerede byggeprøve blev afbrudt efter manglende fremdrift og endte med `page.click: Timeout 20000ms exceeded`; gendannelse og demo er derfor ikke verificeret i denne lokale Intel-pakke. Prøvens egne appdata blev slettet ved afslutning, og dens resterende testvindue blev lukket. Det er ikke bevis for en fejl på Intel-hardware, men heller ikke en installationsgodkendelse. Apples første indsendelse er `77094b83-93ac-47bb-a50c-a451235988c5`; appens billet og den endelige pakning skal kontrolleres efter Apples svar.
- **Downloadkontrollen prøver nu alle filer.** Alle tre faktiske installationsfiler er hentet i Chrome via lokal HTTP og sammenlignet på navn, størrelse og SHA-256; computer- og mobilvisningen består. En bevidst forkert kontrolsum på Windows-linket giver fejlstatus, også når første link er korrekt. Tekniske filnavne og kontrolsummer ligger under “Se detaljer”, og knapperne angiver Apple-chip, Intel eller Windows. Det er fortsat en lokal side, ikke et eksternt downloadlink.
- **Værktøjskontrollen kan ikke vente ubegrænset.** `test:package` afbryder versionskontrollen af et medfølgende værktøj efter 30 sekunder. Beskyttelsen er udløst med en faktisk proces, der ikke svarede; prøven fejlede med `ETIMEDOUT`. Seks pakkeenhedstests består, og den endelige Apple Silicon-app består den positive `test:package` med tidsgrænsen aktiv. Tidsgrænsen ændrer testværktøjet, ikke appens agentmotor.

Den allerede afprøvede Apple Silicon-app har gennemført `test:package`, `test:live-app --controlled`, `test:recovery` og `test:demo` med rigtig OpenCode, faktiske filer og en kontrolleret lokal model. Den kontrollerede prøve dækker plan, bygning, filtrering, rettelse, byteidentisk fortrydelse, fejl og genåbning. Ingen ekstern modelbetaling eller observation af en ny bruger er gennemført her.

Evidens ligger under `desktop/release/beta.5/`: `windows/inputs.json`, `windows/installer-check.json`, `intel/inputs.json`, Intel-prøvernes logs, `apple-silicon/final-dmg-check.json`, `download-check.log`, `download-negative.log` og `timeout-check.log`. `downloads/release.json` angiver de aktuelle filstørrelser og kontrolsummer. Indsendelser skal følges via deres eksisterende ID'er, ikke sendes igen. Efter stapling skal den ændrede DMG kopieres til downloadmappen, dens kvittering følge med, og filoversigt samt downloadkontrol køres igen.

Der er ingen publiceret Release eller bekræftet adgang fra en testers konto. Installation og opdatering på andre computere, en rigtig modelopgave og feedback fra en ny bruger mangler fortsat. Den tidligere beskrevne afhængighedsbegrænsning gælder stadig; funktionstests og Apple-notarisation er ikke en samlet sikkerhedsgodkendelse.

## Tre konkrete prøver før udsendelse · 8. oktober 2026

**De tre eksterne prøver er ikke alle gennemført.** En ny signeret beta.4 er bygget og kørt på udviklermaskinen; rigtig Corti, notarisation, en anden Mac og testerens egen downloadadgang kræver fortsat den konkrete adgang. Ingen pakke er publiceret, og repositoryets synlighed er uændret.

1. **Corti S1: skrevet og prøvet med kontrollerede svar, afventer nøgle til rigtig model.** `test:live-app` er opdateret til den aktuelle brugerflade og understøtter en konkret pakket app. Prøven opretter et isoleret, fiktivt projekt og gennemfører idé → plan → godkendt bygning → filtrering ved 1/5/9/99 deltagere → AI-rettelse af overskrift → gennemgået Fortryd. Alle medtagne projektfiler skal derefter være byteidentiske med før rettelsen, og filteret prøves igen i preview. Planen må ikke ændre filer. Opstarts-/værktøjsfejl og manglende filændringer giver fejlstatus; ingen succes udledes af alene en afsluttet samtale. Screenshots tages fra det faktiske Electron-vindue. Nøglen indtastes direkte i isoleret Aura, aldrig i chat eller terminal, og prøvens appdata slettes ved afslutning.

   Forløbet består både fra kildekoden og i den signerede pakke med **rigtig OpenCode, faktiske filer og en lokal kontrolleret model**, inklusive mobilbredde. Fem eksplicitte kontrolpunkter består. En særskilt kørsel med bevidst HTTP 401 giver exit 1 og en `run.review` med `status: error`, `failure.kind: key` og nul ændrede filer. Fejlbeskyttelsen er dermed udløst af et faktisk modelsvar. Det er ikke Corti-kvalitet eller en rigtig Corti-opgave. Corti-vinduet er klargjort ved nøgleindtastningen; modelkørslen er ikke gennemført uden brugerens adgang.

2. **Mac: bygget, signeret og kørt lokalt; notarisation og anden Mac afventer.** Kandidaten ligger i `/private/tmp/aura-pilot-signed.gmjWDz/` og er bygget med den dokumenterede identitet `Developer ID Application: mekbas IVS (2UX98897JW)`. `codesign --verify --deep --strict` består med faktisk nøgleringsadgang, og signaturen har TeamIdentifier `2UX98897JW`, hardened runtime, tidsstempel og bundne ressourcer. Gatekeeper-kontrollen afviser den med `Unnotarized Developer ID`: signering er ikke Apple-notarisation. `notarytool history` med den aftalte profil `ai-harness-notary` svarer, at profilen ikke findes. Ingen notarisation er indsendt. Den historiske HTTP 403 nedenfor er ikke denne prøves aktuelle resultat.

   `test:package` består med isolerede appdata og begrænset PATH: medfølgende Node/Git/npm/OpenCode, syntetisk projekt, preview og versionsgemning. Den monterede DMG er kontrolleret skrivebeskyttet: app-ASAR, executable, Info.plist og runtime-manifest matcher den afprøvede app, og den monterede apps signatur består. 103 fulgte byggeinputs matcher den tidligere kandidat; app-ASAR er byteidentisk med den fuldt afprøvede beta.4. Dette er fortsat samme udviklermaskine, ikke installation på en anden Mac uden udviklingsværktøjer. Der er ikke nulstillet nøglering eller omgået Gatekeeper.

3. **Download: faktisk lokal browserdownload består; ekstern testeradgang afventer.** Browseren henter den nye signerede DMG gennem lokal HTTP, og SHA-256 matcher `release.json`; computer- og mobilvisning består. GitHub main peger på `df681eb7b7d23df46b7ad26d39d73396a0b4886f`, repositoryet er privat, og der er nul Releases. Den anonyme releaseadresse svarer HTTP 404. Seneste vellykkede pakkeworkflow er [kørsel 36470547106](https://github.com/ai-alliancen-org/ai-harness/actions/runs/36470547106) fra `b5a83bf548f7d495bd9f32c6110d75bb278b0d43`, ikke det aktuelle commit. En lokal download eller vedligeholderens GitHub-adgang dokumenterer ikke en testpersons adgang. Der mangler en faktisk distributionsadresse og en prøve med testerens egen konto; ingen publicering eller ændring af adgang er foretaget.

**Ny signeret DMG:** `Aura-0.2.0-beta.4-mac-arm64.dmg`, 312.305.482 bytes, SHA-256 `54ddb07db123a29d1c54ee7af1085951afe1097c6a72be7f7a188623d63a905b`. ZIP: 304.401.397 bytes, SHA-256 `f4052c3f723d8405d4a18edff7b18d6973699dfb8b27778810037502f0f50fb3`. Begge er endnu uden notarisation. En senere Apple-billet ændrer DMG-filen og kræver frisk kontrolsum og downloadoversigt. Afhængighedsbegrænsningen fra demogennemgangen gælder også den signerede kandidat: signering afhjælper ikke biblioteket i medfølgende npm.

**Evidens:** `/private/tmp/aura-pilot-live-controlled-2.log`, `/private/tmp/aura-pilot-pack-controlled.log`, `/private/tmp/aura-pilot-pack-rejected.log`, `/private/tmp/aura-pilot-package.log`, `/private/tmp/aura-pilot-download.log` og kandidatens `build.log`, `release.json`, `mounted-test.json`. De kontrollerede forløbsrapporter og vinduesbilleder ligger i `/private/var/folders/q9/914lvw356897pk8pb_29flv00000gn/T/aura-rigtig-model-{34aSBe,fLhgN0,C1XY4R}/resultat/`; sidste mappe er den bevidste fejlprøve. Corti-prøvens log er `/private/tmp/aura-pilot-corti-live.log`; en rapport tæller først som rigtig model-evidens, når hele prøven har afsluttet. Den første kontrollerede kørsel fandt en ventefejl i prøven: en kompatibel forbindelse har ikke automatisk valgt model. Prøven vælger nu eksplicit testmodellen før afsendelse, og den afsluttende kørsel består.

## Demogennemgang og lokal beta.4 · 7. oktober 2026

Den samlede [UI/UX-gennemgang](demogennemgang.md) og det korte [materiale til testpersoner](demo-til-testere.md) er skrevet. Gennemgangen omfatter opstart, AI-adgang, idé, plan, godkendelser, rettelser, fortrydelse, genoptagelse, samtidige samtaler, deling, data, hjælp, hjemmeside og pakning. Første runde er fortsat aftalt til Mac og Corti S1. Brugerobservationen gennemføres som del af piloten; den er endnu ikke udført.

- **Skrevet og kørt i Electron:** Vælg AI og Send uden forbindelse går direkte til guiden, og Vælg senere bevarer kladden. Dialogtitler følger det synlige trin; featurekontakter og automatisk versionsgemning har navne. Escape fra Hjælp giver fokus tilbage til en synlig åbner. Før du sender forklarer den fortsatte sessions tidligere beskeder/værktøjsresultater; tilvalget er en ekstra historikkopi, og en plan påstås ikke sendt, før den findes. Hjælp har en foldet førstegangsvejledning, og app/installationsside følger eksisterende branding. Gem version venter på filgennemgangen.
- **Enhedstestet:** 208/208 består sekventielt med den fastlåste Node 22.23.3. Efter versions-/webændringerne er 12 relevante pakke-, Pages-, feedback- og fejlrapportprøver gentaget og består. Ingen samtidig enheds-/Electron-kørsel.
- **Kørt på faktiske filer:** 25 forskellige integrationsforløb består: 23 Electron-forløb og to motorprøver (`agent` og `app-skills`). De dækker bl.a. konkret idé, plan/bygning, permissions, fejl/Stop, genstart, filhenvisninger, rettelse/diff/fortryd, historie, samtidige kopier, Vite/Astro og de eksisterende delingsadaptere. Historiens og versionernes forløb er gentaget efter den sidste låsning. OpenCode 1.18.33 og udviklingsserverne er rigtige; modelsvar og hosting-API'er er kontrollerede. Ingen betalt model eller ekstern hosting-upload.
- **Målt og visuelt kontrolleret:** de samme 44 tilstande før/efter. Før: 3.214 ord, 264 valg, 50 ⓘ og 22 felter. Sidste eftermåling: 3.247 ord, 265 valg, 50 ⓘ og 22 felter. Klik pr. opgave 5/6/4/2, uændret. Ingen sidefejl. Førmålingen fandt skjult dialogtitel i velkomst/demo samt unavngiven versionskontakt og otte featurekontakter; den afgrænsede efterkontrol finder ingen af disse, dublerede ID'er eller dokument-overløb. Tallene er summer af skærmtilstande, ikke samlet læsebyrde; navne, tidspunkt og status giver små udsving.
- **Førstegangsforløb:** den nye `test:demo` har 41 beståede kontroller i både kildekode og pakket app. Den prøver rigtig oprettelse uden AI, modelguide, bevaret kladde, navne, tastatur, fokus, fejlrapport, 980 × 720, 150 % zoom, reduceret bevægelse og straks-lukning/genåbning med kladde. Send kan faktisk rammes ved den lille visning. Billeder tages fra Electron-vinduet. Tidligere falsk clipping kom fra Playwrights zoom-skærmbillede; det var ikke en konstateret layoutfejl i appen.
- **Pakket app kørt:** en ny `Aura 0.2.0-beta.4` til macOS arm64 er bygget lokalt og kørt med isolerede brugerdata. `test:package` prøver begrænset PATH, de medfølgende Node 22.23.3, Git 2.53.0, OpenCode 1.18.33 og npm, projektoprettelse, faktisk preview, lokal identitet og versionsgemning alene i testprojektet. Et forsinket faktisk `git:review`-IPC-svar beviser, at Gem version er låst, indtil svaret er kommet. Demo, recovery, frameworks, tools og chat består også i den samme pakke. Chat bruger den medfølgende OpenCode og en kontrolleret model til plan, eksplicit bygning, godkendt filændring, preview og manuel versionsgemning. Det udvidede rettelse→deling-forløb køres i kildekodeprøven; den pakkede gren har en smallere afgrænsning.
- **Pakkeindhold og download:** 103 faktiske kilde-/profil-/byggeinputs er registreret med SHA-256; appinputs er fulgt af Git. 64 kodefiler og 27 medfølgende profilfiler er bytekontrolleret mod pakken. De bevarede package.json-felter matcher; electron-builder udelader scripts/devDependencies. Ingen private testfiler, node_modules eller de to advisory-biblioteker i appens ASAR. DMG-integritet består. DMG'en er monteret skrivebeskyttet, og app.asar, executable, Info.plist og runtime-manifest matcher den afprøvede app. Faktisk browserdownload over lokal HTTP matcher release.json ved computer-/mobilvisning. Ingen download fra en publiceret release.
- **Signering:** codesign viser kun executable's ad hoc-signatur uden TeamIdentifier eller bundne ressourcer. Der er ingen Developer ID-signering eller notarisation af kandidaten. Det er ikke en Gatekeeper-installationsprøve eller en afprøvning på en separat ren Mac. Der er ikke indsendt noget til Apple.
- **Website:** fem sider, 10 visninger ved 1280/390 pixels, 79 lokale links med HTTP 200, ingen sidefejl eller vandret overløb. Bygget fra faktiske GitHub-svar. Repository stadig privat, nul releases, Pages HTTP 404 den 7. oktober. Ingen adgang eller synlighed ændret.
- **Afhængighedsstatus:** npm audit viser ni berørte poster, otte moderate/én høj, fra to underliggende advisories uden angivet rettet version. De findes i byggestakkens kæde og er ikke i appens ASAR. En særskilt kontrol af runtime finder dog også `http-cache-semantics 4.2.0` i medfølgende npm; kandidaten indeholder dermed fortsat et bibliotek omfattet af det høje advisory. Faktisk udnyttelse gennem npm er ikke reproduceret, og framework-prøverne bruger offentlige pakker uden registry-nøgler. Ingen dokumenteret fuld afhjælpning eller blind op-/nedgradering; den fulde runtime er ikke sikkerhedsrevideret. Kilder og afgrænsning står i demogennemgangen.
- **Kun skrevet i CI:** pakke-workflowet kører nu enhedstest før pakning og demo-forløbet mod pakken. Ændringerne er ikke kørt på GitHub. Kandidaten er bygget fra den aktuelle arbejdsmappe baseret på `e1dbf96`, ikke fra et nyt CI-commit.
- **Ikke deployet eller observeret med en bruger:** aktuelt Corti S1-forløb med brugerens nøgle, anden Mac, testerens downloadadgang, VoiceOver, Windows/Linux og brugerobservation mangler. Ældre Corti-/signeringsevidens nedenfor godkender ikke denne fil. Før ekstern udsendelse skal konkret model, signeret/notariseret installationsfil og adgang kontrolleres; derefter fuldender pilotens observation milepæl 7.

De første pakkeprøver viste to fejl i testens egne forventninger: `firstVersion` ændrer selv startsiden, og en tidligere versionsgemning kan have samme feedbacktekst. Prøverne kontrollerer nu den faktiske ugemte fil og venter på den nye gemnings afsluttede filstatus. Testens forsinkelse lægges på det rigtige IPC-svar; tidligere forsøg på at importere Node fra Playwrights evalueringskontekst var ikke understøttet. De afsluttende prøver består med uændrede fil- og commitkontroller.

**Lokal evidens:** `/private/tmp/aura-demo-unit.log`, `/private/tmp/aura-demo-targeted-units.log`, `/private/tmp/aura-demo-suite/{resultater,efterkontrol}.json`, `/private/tmp/aura-demo-history-check/resultater.json`, `/private/tmp/aura-demo-{audit-before,after-final}/maalinger.json`, `/private/tmp/aura-demo-pack-suite/resultater.json`, `/private/tmp/aura-demo-package-final.log`, `/private/tmp/aura-demo-pack-chat-final.log`, `/private/tmp/aura-demo-{source,archive,mounted}-final.json`, `/private/tmp/aura-demo-{signature,dmg,download}-final.log` og `/private/tmp/aura-demo-web-after.log` og `/private/tmp/aura-demo-runtime-advisory.json`. Prøveloggene angiver projektmapper, rapporter og skærmbilleder. Pakken og den lokale downloadside ligger i `/private/tmp/aura-demo-beta4-final/` og er ikke publiceret. Git-status skal gennemgås; tre nye prøvescripts og to nye dokumenter skal med i brugerens commit.

**Denne kandidats DMG:** `Aura-0.2.0-beta.4-mac-arm64.dmg`, 313.430.362 bytes, SHA-256 `281ed9120eb1f404a3edc1acecdbcba4f91ffcdfa1dea2fccfd7b2c3f881683e`. ZIP: 307.090.172 bytes, SHA-256 `b90208d708748f3bc280653dc58e3950626e0faea306fb0a0fdb6d0558de2303`. En ny signering, notarisation eller bygning giver en ny fil og kræver ny kontrolsum og relevant pakkeprøve.

## Deling og samlet brugerforløb · 7. oktober 2026

Syvende milepæl i [planen for brugerfladen](ux-plan.md). Den tekniske del er skrevet, enhedstestet og kørt mod faktiske projektfiler i Electron på macOS arm64. **Observationen med en person uden udviklererfaring er ikke gennemført**, så milepælen er endnu ikke fuldt observeret eller afsluttet efter sit oprindelige kriterium. Guiden og en tom notatskabelon findes i [testforløbet](testforloeb.md#milepæl-7-observation-af-det-samlede-forløb).

- **Skrevet:** deling gennem de eksisterende GitHub-, Vercel- og Azure-adaptere viser versionens navn/tid, destination med konto og miljø, adgangens faktiske evidens og mulige omkostninger før afsendelse. Tekniske ID'er, filer og build ligger under Se detaljer. Destination, gennemgang og resultat vises hver for sig; Ret destination bevarer felter og kræver ny godkendelse. Uflettede kopier er synligt udeladt. Ingen ny hosting- eller adgangstjeneste er tilføjet.
- **Enhedstestet:** 208 tests består i den samlede sekventielle slutkørsel med Node 22.23.3 på den aktuelle kode, inklusive de undervejs committede modelændringer. Delingsprøverne dækker engangsgodkendelse, ændret version/destination, beskyttede filer, links, hemmeligheder i tidligere versioner, navne uden omskrivning af Git, kvittering, anonyme HTTP-svar, redirects, for stort indhold, manglende filmatch og nulstilling af gammel evidens ved en mislykket frisk kontrol. Senere UI-justeringer afprøves særskilt i Electron; den rene resumévisnings to prøver er også gentaget efter den sidste tekstjustering.
- **Kørt mod rigtigt materiale:** alle 21 hidtidige Electron-prøver samt Astro-varianten af samtidige samtaler består. De køres sekventielt, adskilt fra enhedsprøverne. Framework-prøven blev afbrudt af `ENOSPC` ved skrivning af et skærmbillede; efter oprydning i prøvernes egne geninstallerbare afhængigheder blev den gentaget og bestod, og de resterende prøver blev gennemført. Kilder, Git-historik, logs og skærmbilleder er bevaret. Oprydningen har ikke berørt brugerprojekter, Docker eller npm-cache.
- **Samlet forløb:** `test:chat` bruger den rigtige OpenCode 1.18.33 og en kontrolleret lokal modelserver. I samme lokale testprojekt indtastes en konkret idé om fiktive mødelokaler i skrivefeltet, og det kontrolleres, at den når planlægningen. På samme projektfil gennemføres ønsker, Før du sender, plan og rettet plan, eksplicit bygning, faktisk filændring og preview, egen tekstrettelse, linje-diff, Fortryd til byteidentisk indhold og delingsgennemgang af den gemte version. Ingen cloud-upload i dette forløb. Fejl, bevaret besked og faktiske frem for opdigtede kontroller afprøves også. Efterkontrollen fandt en ventefejl i den nye test: den læste endnu den tidligere opgaves diff, inden tekstrettelsens diff var indlæst. Testen venter nu på den konkrete rettelse og kontrollerer stadig filens faktiske indhold.
- **GitHub:** `test:hosting` gennemfører kontrolleret Device Flow og GitHub-API, eksplicit privat oprettelse og almindeligt push til en rigtig **lokal** bare Git-server. Serverindhold og synkronisering kontrolleres. UI'et adskiller rapporteret privat synlighed, bekræftet serverversion og testpersonens endnu ikke afprøvede læseadgang. En kontofejl fjerner gammel gennemgang og tillader ny kontrol. Ingen push til github.com.
- **Testudgivelse:** `test:deployment` bruger rigtige filer og gemte versioner med **kontrollerede** Vercel- og Azure-svar. En faktisk ugemt fil udløser afvisning, og ingen upload tælles. Derefter prøves ændret destination, kvittering ved genåbning, påkrævede destinationsfelter med konkret native afvisning før udbyderkald, HTTP 401, frisk statusfejl efter READY, UNKNOWN uden automatisk genforsøg, også med beskeden bevaret ved genåbning og Azure harness-test med HTTP 200 og faktisk hashmatch af testfilen. Resultatet siger fortsat, at testpersonens adgang og øvrige funktioner ikke er afprøvet. Der oprettes ingen ekstern udgivelse.
- **Kopier:** begge `test:concurrent`-varianter kontrollerer gennem IPC fra en rigtig uflettet kopi, at afgrænsningen beskriver kopien, og at version og indholdsfingeraftryk kommer fra hovedprojektets gemte Git-version. Kopiens ændrede frameworkfil indgår ikke; ingen upload foretages. Begge afprøver også rigtige Vite-/Astro-servere og konkrete afvisninger af beskyttede filstier og adgang til den anden servers WebSocket.
- **Visuelt og tastatur:** delingens gennemgang og resultater er set som vinduesbilleder i Electron, også ved 980 × 720 og 150 % zoom. Ret destination bevarer felter, gennemgangen får fokus, Escape returnerer til åbneren, og reduceret bevægelse afprøves. GitHub-resultatets fokus og rulning tager højde for dialogens faste overskrift. Dialogerne kan rulle, uden vandret overløb.
- **Måling:** før/efter omfatter 44 skærme. Før: 3.220 ord, 267 valg, 51 ⓘ og 22 felter. Efter: 3.213 ord, 264 valg, 50 ⓘ og 22 felter. Klik pr. opgave er uændret: 5/6/4/2; ingen sidefejl. Første lag i Del ændres fra 54 ord/5 valg til 56 ord/4 valg; Sikkerhedskopi fra 49 ord/4 valg til 39 ord/2 valg. Delingsgennemgang, resultater, ukendt upload og større tekst måles desuden særskilt af `test:deployment`; de er nye tilstande i målingen og har ikke en registreret numerisk førmåling.
- **Ikke deployet eller observeret med en bruger:** ingen rigtig modelopgave, ekstern GitHub-/Vercel-/Azure-publicering, testpersons adgang, Windows, VoiceOver eller ny installationspakke er afprøvet i denne milepæl. Ældre dateret live- og pakkeevidens nedenfor er ikke en verifikation af disse ændringer. Testernes konkrete model og installations-/adgangsprøver skal gennemføres før invitation; brugerobservationen gennemføres i piloten før en samlet færdigmelding.

Lokal evidens: `/private/tmp/aura-7-unit-final.log`, `/private/tmp/aura-7-validated/{resultater,fortsaettelse,slutkontrol,deployment-final,deployment-chat-final,chat-final}.json` og deres prøvelogs; målingerne i `/private/tmp/aura-7-measure-{before,validated}/maalinger.json`. Prøveloggene angiver de konkrete midlertidige projektmapper og skærmbilleder. Ingen testværktøjer har committet i dette repository; brugerens nye commits er bevaret.

## Mistral Large 4 · 7. oktober 2026

- **Skrevet:** modelkort for `mistral-large-4` og `mistral-large-4-0`, markeret som offentlig prøveversion. Mistral-forbindelser bruger den Mistral-adapter, som allerede følger med OpenCode 1.18.33. Kataloggrænser har forrang; kendte Large 4-id'er får modelkortets kontekst som reserveværdi og Auras loft for svarlængde. Prisoverslaget bruger normal listepris og siger, at lanceringsrabatten ikke er fratrukket. Prisens kilde og kontroldato er adskilt fra datavilkårene. Et flytbart `mistral-large-latest` får ikke længere automatisk den gamle Large 3-pris.
- **Enhedstestet:** 208 tests består i den samlede sekventielle kørsel med den fastlåste Node 22.23.3. De nye prøver kontrollerer begge model-id'er, katalogets forrang for grænser og priser, cachepris, ændret prisgodkendelse og intet opdigtet standardvalg eller pris for ukendte versioner.
- **Kørt mod rigtigt materiale:** `npm run test:mistral` består i Electron på macOS med den rigtige OpenCode, faktiske projektfiler og en kontrolleret lokal server i Mistrals format. Prøven gennemfører plan, datagennemgang, værktøjskald, godkendt filændring og faktisk preview. Tænkeafsnit læses fra streaming, sendes tilbage efter værktøjskald og vises ikke som almindeligt svar. Tokenforbrug og prisoverslag registreres. Den prøver også afvisning, Stop efter et faktisk startet modelkald, nøglefejl uden automatisk genforsøg og genåbning med bevaret modelvalg.
- **Modelvalg kontrolleret i appen:** der vises tre kort, hvor samme prøvekatalog gav to før ændringen. Medium forbliver det hidtidige standardvalg. Med et nyt projekt og et katalog uden Medium forbliver valget tomt, og intet kort kaldes udbyderens standard. Den kontrol blev først ramt af testens egen ventefejl mellem to projektåbninger; prøven venter nu på det konkrete projekts afsluttede indlæsning. Den ændrede tekst siger, at kataloget mangler en pris, så den ikke modsiger listeprisen i datagennemgangen.
- **Visuelt kontrolleret:** skærmbilleder af modelvalget, kode/preview og tilstanden uden standardmodel er set. Modeldialogen er også set ved 980 × 720. Valg med tastaturet og reduceret bevægelse er afprøvet. Der er fortsat højst tre modelkort; model, udbyder og Mistrals standardindsats står under skrivefeltet. Send og pilen bevares på én linje ved lange modelnavne. Niveauet for indsatsen er ikke angivet som verificeret, og prøven kontrollerer, at Aura ikke sender et valg af `reasoning_effort`.
- **Ikke afprøvet:** ingen ekstern Mistral-opgave eller vurdering af modellens kode, dansk eller design. Brugeren valgte kun lokale kontroller. Denne ændring er ikke kørt på Windows eller i en ny installationspakke og er ikke deployet. Den ændrer ikke den resterende syvende UI-milepæl eller kravene før invitation nedenfor.

Prøvens seneste filer og skærmbilleder ligger lokalt i `/private/var/folders/q9/914lvw356897pk8pb_29flv00000gn/T/aura-mistral-D3oN7I`. Kilder og gentagelig kommando står i [desktopvejledningen](../desktop/README.md#mistral-large-4--7-oktober-2026).

## Samtidige opgaver og indfletning · 7. oktober 2026

Anden del (6B) af sjette milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet fra kildekoden på macOS arm64 med Electron 44.4.4 og OpenCode 1.18.33. Git-versionerne i prøverne er oprettet i midlertidige testprojekter.

- **Skrevet:** samtalekopier med eget arbejdsområde, motor, kode, ændringer og preview; indfletning gennem den eksisterende trevejsfletning og gendannelsesjournal. Kopier laves fra de aktuelle filer og bruger filkloner, hvor filsystemet understøtter det. Ingen Git-worktrees eller grene oprettes.
- **Enhedstestet:** 201 tests består i en samlet, sekventiel kørsel med den fastlåste Node 22.23.3. De nye og udvidede prøver bruger faktiske filer og dækker:
  - ugemte filer, udeladelse af `.git` og nøglefiler, kopiens selvstændige indhold og interne pakkelinks, som peger på kopiens egne pakker;
  - indfletning af forskellige linjer, konflikt ved samme linjer, nye og slettede filer og binære billedfiler;
  - afvisning af ændret kildekopi, projektfiler eller journalgrundlag efter gennemgangen, og konkrete beskyttede filstier og symbolske links;
  - automatiske versioner før og efter indfletning i testprojektet, og ingen automatisk version, når funktionen er slået fra;
  - Fortryd, der bevarer senere brugerrettelser, viser konflikt ved samme linjer og registrerer binære ændringer korrekt;
  - Stop under opstart og samtykkegemning, afvisning af dobbelt Send og reservation under afsendelse; et samtidigt idle-signal under abort må ikke frigive mappen eller vise Stoppet, mens versionen stadig gemmes;
  - genåbning, bevarelse af uflettet materiale ved fejl i registrering, papirkurv eller et forsvundet manifest, og oprydning af afsluttede kopier og dokumenterede afbrudte oprettelser.
- **Kørt mod rigtigt materiale i Electron:** `test:concurrent` består med 12 delprøver for både Vite 8.3.1 og Astro 7.3.5. Prøverne bruger rigtige OpenCode-motorer, faktiske projektfiler og en kontrolleret lokal modelserver. Forløbene er:
  1. To motorer venter samtidigt på hver sin godkendelse. Filens omfang er kopien, `.env` er udeladt, og en ukendt samtale samt `.env`, `.git/config` og `../udenfor.txt` afvises gennem appens API.
  2. Kode og preview følger kopien. Indtastede formularværdier bevares ved samtaleskift. Indfletning afvises, mens projektets opgave arbejder.
  3. En tredje samtale arbejder i en anden kopi, mens en færdig kopi flettes ind. Kun projektet og kildekopien skal være ledige; den tredje motor fortsætter.
  4. Indfletning bevarer projektets øvrige linje, medtager en billedfil og rydder den afsluttede kopi.
  5. Fortryd virker uden Git fra resultatkortet og Versioner; en senere brugerrettelse bevares, og billedfilen fjernes og står som slettet under Ændringer. Et ældre resultatkort afvises, når en senere handling har afløst journalen.
  6. Stop rammer den valgte samtale. Ved konflikt viser gennemgangen begge linjer og vælger brugerens linjer som standard.
  7. En uflettet kopi genåbnes efter genstart. Ved 980 × 720 og 150 % zoom er der ingen vandret siderulning. Tastaturet åbner indfletningen, bekræftelsen er synlig, og Escape giver fokus tilbage. Reduceret bevægelse afprøves.
  8. Annulleret sletning bevarer kopien. Bekræftet sletning advarer om tab af uflettede ændringer og fjerner den.
  9. Rettelser fra en kopi, hvor frameworkets server har kørt, flettes ind; kun kopiens server stoppes. Ved 980 × 720 og 150 % zoom kan Send stadig ses og rammes med markøren, også med statusbeskeden synlig.
  10. Automatiske versioner gemmer først en faktisk ugemt brugerrettelse og derefter indfletningen. Begge versioner har billeder. Den flettede versions før/efter-par har samme side og størrelse og findes også under samtalens ændringer. Billederne er set efter kørsel og viser projektet før og det faktisk flettede projekt efter.
  11. Projekt og kopi bruger forskellige serverporte og viser forskelligt faktisk indhold. Sletning stopper kopiens server og bevarer projektets. Browserens `securitypolicyviolation` beviser, at `connect-src` afviser WebSocket til den anden server.
  12. Stop under opstart bliver ved med at vise Stoppet og vises ikke som en fejl.
- **Fundet og rettet under afprøvningen:** Send holdt først en global lås og blokerede et samtaleskift under motoropstart. Pakkeindhold under `node_modules/**/dist` blev udeladt, så Vite ikke kunne starte i kopien. Genåbning kunne overtage startsiden efter brugerens navigation. Indfletningsknappen ventede på uvedkommende kopier. En statusbesked dækkede Send. Beskeder har nu egen plads i skærmen. Fortryd bruger både før- og efterindhold, så senere brugerrettelser bevares, og binære filer vises uden opdigtet linje-diff.
- **Afslutning og fokus:** Stop og agentens idle-hændelse kunne afslutte samme opgave hver for sig og vise Stoppet, mens en version stadig blev gemt. Stop ejer nu afslutningen. En rettelse efter Stop forbliver ugemt frem til indfletningens egen versionsgemning; det er kontrolleret med rigtig OpenCode og Git. En sen filindlæsning ved samtaleskift må heller ikke flytte fokus fra indfletningsknappen. Prøven forsinker rendererens afslutning efter den faktiske indlæsning og kontrollerer brugerens fokus. Tastaturprøven venter på en aktiveret knap, før den sender Enter.
- **Gennemgangens forklaringer:** Det foldede afsnit siger, at kopiens forhåndsvisning afsluttes, og at en kørende projektvisning bevares. Uden automatisk version henviser det til Fortryd på resultatkortet. Mangler enten projektets eller kopiens billede, står det i selve gennemgangen. Prøven tæller de synlige billeder og kræver, at kontrollen af ét billede faktisk er udløst; en første testversion søgte i en forkert beholder og blev afvist af denne slutkontrol.
- **Genstart med manglende kopidata:** Astro-prøven flytter kopiens manifest til side mellem to opstarter. Den rigtige app viser, at kopien ikke kan læses, og bevarer dens faktiske filer. Efter manifestet lægges tilbage, genåbnes kopien og resten af forløbet gennemføres. Et manglende manifest giver ikke i sig selv tilladelse til oprydning.
- **Testværktøjer og installation:** Playwrights fastlåste `waitForFunction` gentager ikke en asynkron betingelse, der returnerer `false`; billedprøven venter derfor på de faktiske IPC-svar i en løkke. En tidligere frameworkinstallation havde en afkortet native pakke og kunne ikke starte Vite. Kun `node_modules` i dokumenterede, afsluttede testmapper blev ryddet; projektfiler, historik, logs og billeder blev bevaret. En ny installation bestod preview-prøvens 13 delprøver med rigtige React/Vite- og Astro-servere.

- **Samlet kørsel:** Alle 21 Electron-prøver samt Astro-varianten består sekventielt. Det omfatter `concurrent`, `preview-edit`, `history`, `versions`, `chats`, `agent`, `approvals`, `chat`, `workspace`, `planning`, `preferences`, `frameworks`, `resume`, `recovery`, `desktop`, `setup`, `introduction`, `features`, `hosting`, `deployment` og `tools`. Delingsprøverne bruger simulerede tjenester og nye lokale Git-repositories; ingen ekstern publicering eller deploy er udført.
  - Efter de sidste tekstændringer er Vite- og Astro-indfletningens 12 delprøver samt historikkens 9 delprøver gentaget og bestået. I begge indfletningsprøver er kontrollen af ét billede uden modstykke faktisk udløst én gang.
- **Målt:** Den faste målesuites 44 skærme går fra 3.198 til 3.222 synlige ord med uændret 267 valg, 51 ⓘ og 22 felter. Klik pr. opgave er uændret: AI-forbindelse 5, idé til udkast 6, tekstrettelse 4 og Fortryd 2. Ingen sidefejl. Førmålingen er kørt på den committede 6A-kildekode; eftermålingen på denne arbejdsmappe.
  - Kopiernes nye tilstande måles desuden særskilt i begge frameworkforløb. Kopikortet har 16 ord og 2 valg; en ren indfletning med en billedfil har 40 ord og 3 valg. Konfliktgennemgangen har 56 ord og 6 kontroller: to linjevalg, bekræftelse, annullering og to afsnit, som kan foldes ud.
  - En indfletning ved 980 × 720 med kun kopiens billede har 35 ord og 3 valg, inklusive den nye forklaring af det manglende projektbillede.
  - Ved 980 × 720 og 150 % zoom er tekst, fokus og bekræftelsen set i billeder direkte fra Electron-vinduet. Statusbeskeden har egen plads, og Send er både synlig og ramt i en faktisk kontrol af elementet under markøren. Versionsbillederne er set som gemte JPEG-filer.
- **Lokal evidens:** Enhedskørsel i `/private/tmp/aura-6b-unit-final.log`; den samlede Electron-kørsel og målingen i `/private/tmp/aura-6b-validated/`; de gentagne forløb efter tekstændringerne i `/private/tmp/aura-6b-review-validated/`; før/efter-tal og skærmbilleder i `/private/tmp/aura-6b-measure-before/` og `/private/tmp/aura-6b-measure-validated/`. Frameworkprøvernes logs angiver mapperne med deres faktiske projektfiler, native skærmbilleder og før/efter-JPEG. De seneste frameworkmaterialer bevares med pakker; installerede pakker fra ældre, afsluttede prøver er ryddet med projektfiler, Git-historik, logs og billeder bevaret. Prøverne kan gentages med kommandoerne i [desktopvejledningen](../desktop/README.md).

**Ikke deployet eller observeret i en udgivelse.** Modelsvarene er kontrollerede; ingen rigtig model eller modelbetaling er brugt. Native dialogers svar er simulerede. Ikke afprøvet med en person uden udviklererfaring, VoiceOver, Windows/Linux, en pakket app eller mange store projekter. Kopier er separate arbejdsmapper; godkendte kommandoer har fortsat brugerens OS-rettigheder. Filer, som ikke kan gennemgås sikkert inden for størrelsesgrænserne, afviser indfletningen og bevarer kopien. En uflettet kopi bruger lokal lagerplads, indtil den flettes eller slettes efter bekræftelse.

## Samtaler, kommandopalet og eksempler · 6. oktober 2026

Første del (6A) af sjette milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet på Mac med OpenCode 1.18.33. Der er ikke committet eller pushet i dette repository.

- **Enhedstestet:** 190 automatiske tests består, når testfilerne køres én ad gangen. De nye og omskrevne dækker:
  - samtalefiler: genåbning af kladde, plan og samtale, afbrudt opgave, adskilte projekter og samtaler, grænsen på 200 beskeder og bevarelse af en beskadiget samtalefil;
  - flytning af en ældre samtale og arkiverede samtaler til samtalefiler, med bevaret brief, gendannelsesmarkør og uændret arkiv;
  - en tom samtale genbruges, en samtale med kladde gør ikke, navne efter første besked eller kladden, omdøbning og sletning gennem papirkurven;
  - redning efter en beskadiget projektfil: filen lægges til side, og samtalerne findes igen;
  - to samtaler i samme projekt: kun én arbejder ad gangen, den anden afvises med samtalens navn, godkendelser og spørgsmål går til den rigtige samtale, og sidepanelet får status samlet;
  - AI-sessionen fortsættes med samme regler og ikke med andre, og motoren sender aldrig en usikker sessions-id videre;
  - Ændringer og Aktivitet bevares pr. samtale, når projektet genåbnes, fx efter en gendannelse.
- **Kørt mod rigtigt materiale i Electron:** `npm run test:chats` bruger den rigtige OpenCode-motor, rigtige projektfiler og en kontrolleret modelserver. Prøven har 10 delprøver:
  1. Eksempler på idéer udfylder idé og navn og skjules, når feltet har tekst.
  2. Paletten viser ikke handlinger fra funktioner, der er slået fra, og giver fokus tilbage efter Escape.
  3. En ny samtale åbnes, mens en anden venter på godkendelse; sidepanelet viser "venter på dig", og Send venter med navnet på den anden samtale.
  4. Paletten finder samtalen ved søgning og skifter med Enter; godkendelsen står i den rigtige samtale.
  5. En samtale arbejder i baggrunden med egen status og eget svar, et andet projekt kan ikke åbnes imens, og "nyt resultat" markeres og forsvinder ved åbning.
  6. Piletaster, Enter og ⌘K virker; genvejen virker også med fokus i forhåndsvisningen (sendt gennem browserens tastaturvej).
  7. Omdøb og slet fra samtalens menu; den slettede samtalefil sendes til papirkurven.
  8. Efter genstart åbnes samme samtale, og AI-sessionen fortsætter: modellen får samtalens tidligere beskeder.
  9. Et projekt fra før samtalerne får sin samtale og sit arkiv som samtaler; arkivfilerne er uændrede.
  10. 980 × 720, 150 % zoom og reduceret bevægelse.
- **Fundet og rettet under afprøvningen:**
  - Efter Stop og Fejl viste status "Klar", fordi status blev skrevet om, når samtalerne blev opdateret. En samtale viser nu sin egen seneste status.
  - En kladde skrevet lige før lukning gik tabt, fordi den hurtige lokale kopi blev gemt under den gamle nøgle uden samtale. En ikke-gemt kladde fra en ældre version flyttes til den første samtale, der åbnes.
  - Ændringer og Aktivitet forsvandt, når projektet blev genåbnet efter en gendannelse; "Filerne er sat tilbage" blev ikke logget. De ligger nu hos arbejdsbænken pr. samtale.
  - Ventelinjen nævnte altid "Ny samtale" og pressede skrivefeltets værktøjslinje sammen; den har nu samtalens navn og sin egen linje.
  - Samtalenavne blev skåret ned til to bogstaver ved siden af status; status står nu under navnet. Projektlisten havde et hul og stod i forkert rækkefølge.
  - Paletten gav fokus tilbage for sent og tog det fra den fane, handlingen flyttede til; uden projekt viste den kun én handling.
  - `Workbench.close()` ryddede samtalerne, så arbejdsbænken ikke kunne bruges videre i samme projekt. Den lukker nu kun motorerne.
- **Kørsler:** Alle 20 Electron-prøver består i én samlet kørsel. `test:resume` og `test:agent` er tilpasset sidepanelet og samtalerne. Hjælpefunktionen til AI-forbindelser venter nu på, at dialogen står stille, før den klikker; et klik under dialogens animation ramte ikke knappen i 1 af 13 forsøg. To fejl i en tidligere samlet kørsel skyldtes, at enhedstestene kørte samtidig.
- **Målt:** 3.197 synlige ord, 267 valg og 51 ⓘ på 44 skærme mod 2.995, 244 og 50 på 41 skærme efter milepæl 5. Klik pr. opgave er uændret, og der er ingen sidefejl.
  - Nye skærme: sidepanelet med projekter og samtaler (44 ord og 13 valg med sidepanelets faste knapper og links, målt med to samtaler), kommandopaletten (34 ord) og eksemplerne på idéer (3 valg bag ét link).
  - "Hvad vil du bygge?" har ét valg mere: linket til eksemplerne.
  - "Fortryd opgaven" siger nu, når Aura ikke har et billede fra før opgaven.

Ikke afprøvet:
- En rigtig model og en person uden teknisk baggrund.
- Skærmlæser (VoiceOver), Windows, Ctrl+K på Windows og Linux og en pakket app.
- Mange samtaler i ét projekt; sidepanelet viser seks og "Vis alle".

Kendte begrænsninger:
- Kun én samtale ad gangen kan arbejde i et projekt. Samtidige opgaver i hver sin kopi kommer i 6B.
- Ændringer og Aktivitet huskes for de otte senest brugte samtaler, så længe appen er åben.
- En samtale, der arbejder, kan ikke slettes, og et andet projekt kan ikke åbnes, før den er færdig.

## Visuel historik · 6. oktober 2026

Femte milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet på Mac med OpenCode 1.18.33. Git-versionerne i prøverne er oprettet i nye midlertidige projekter; der er ikke committet eller pushet i dette repository.

- **Fundet i Electron og brugt:** Et skjult vindue med offscreen-gengivelse kan tage et billede af forhåndsvisningen uden at vise det og uafhængigt af, hvilken fane brugeren ser. Det tog under ét sekund pr. billede. Vinduet har sin egen session uden lagring, og sidens indholdspolitik med sandbox gælder også dér.
- **Enhedstestet:** 182 automatiske tests består, når testfilerne køres én ad gangen. De 6 nye dækker:
  - fletningen: kun ændringen fjernes, brugerens senere rettelser bevares byte for byte med linjeskift, og ændringer af samme linjer er konflikter;
  - versionernes typer og navne og omdøbning, der ikke ændrer Git;
  - Fortryd af en gemt version med en senere version og en ugemt rettelse, en konflikt med brugerens valg, og at den første version ikke kan fortrydes;
  - Fortryd uden Git med kopi, valg ved en slettet fil og afvisning, når filen ændres mellem gennemgang og udførelse;
  - at en versions binære filer ikke vises;
  - billedernes par, binding til en version, før-billede fra samme visning og oprydning efter 80.
- **Kørt mod rigtigt materiale i Electron:** `npm run test:history` bruger den rigtige OpenCode-motor, nye projekter med og uden Git og en kontrolleret modelserver med faste svar. Prøven har 9 delprøver:
  1. Versionen efter en AI-opgave hedder det, brugeren bad om, har type og tid og et billede af forhåndsvisningen.
  2. En version viser billede, filer og linje-diff; omdøbning gemmes i Aura, og Git-beskeden er uændret.
  3. En opgave får billeder før og efter af samme side i samme størrelse, både i versionen og under Denne samtale.
  4. Fortryd opgaven fjerner kun opgavens ændring og bevarer brugerens senere rettelse i samme fil. Rettelsen gemmes først som versionen "Dine ændringer før fortrydelsen".
  5. Ved en konflikt viser gennemgangen begge linjer, dine linjer er valgt som standard, og brugerens valg bruges.
  6. Gå tilbage hertil gemmer først en ugemt ændring som en version og bringer den ældre version tilbage som en ny version.
  7. Billederne ligger i appens data, ikke i projektet; billedvinduets session gemmer intet på disken, og vinduet lukkes igen.
  8. Versioner ved 980 × 720 og 150 % tekst uden vandret rulning; tastaturet åbner en version, og fokus føres tilbage.
  9. Uden Git fortrydes en opgave fra Auras øjebliksbillede med brugerens rettelse bevaret, og fortrydelsen kan selv fortrydes.
- **Fundet og rettet under afprøvningen:**
  - En gendannelse fik samme navn som den version, den gik tilbage til. Den hedder nu "Tilbage til »…«".
  - Fanen Ændringer kunne skifte tilbage fra Versioner, fordi den indlæste samtalens ændringer samtidig.
  - Konfliktvalgene var fuld bredde på grund af appens regel for felter.
  - Electron-prøverne valgte appens vindue som det første vindue. Mens Aura tager et billede, findes billedvinduet også, og en prøve hang i 12 minutter. Prøverne vælger nu appens vindue ud fra adressen.
- **Kørsler:** Alle 19 Electron-prøver består. `test:chat` fejlede først, fordi fanen Ændringer nu husker visningen Versioner; prøven vælger Denne samtale. `test:versions`, `test:recovery`, `test:chat`, `test:hosting` og `test:package` er tilpasset, fordi dialogen Versioner er erstattet af visningen under Ændringer.
- **Målt:** 2.995 synlige ord, 244 valg og 50 ⓘ på 41 skærme mod 2.776, 235 og 49 på 40 skærme efter milepæl 4. Klik pr. opgave er uændret, og der er ingen sidefejl.
  - Gennemgangen før Fortryd opgaven gik fra 36 til 18 ord med samme 3 valg; hvad der ellers berøres, er foldet sammen.
  - Versioner gik fra 50 til 71 ord og fra 6 til 5 valg: navne og typer er længere end de gamle tidspunkter, og hver version er ét valg.
  - Ny skærm: én version med billeder, to veje tilbage og filerne (174 ord inklusive linje-diff'en, 9 valg).
  - Ændringer har 2 valg mere for Denne samtale og Versioner.

Ikke afprøvet:
- En rigtig model og en person uden teknisk baggrund.
- Billeder af en Vite- eller Astro-forhåndsvisning før og efter en opgave; koden er den samme, men det er kun kørt med statisk HTML.
- Fletning af store filer med mange ændringer; algoritmen falder tilbage til at erstatte hele filen, når forskellen er meget stor.
- Skærmlæser (VoiceOver), Windows og en pakket app.

Kendte begrænsninger:
- Efter en gendannelse stoppes en Vite- eller Astro-server, som før denne milepæl. Så tages intet billede efter, før serveren er startet igen.
- Navne og billeder gemmes kun i Aura på denne computer. Flyttes projektet til en anden computer, har versionerne deres oprindelige navne og ingen billeder.

## Rettelser i forhåndsvisningen · 6. oktober 2026

Fjerde milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet på Mac med OpenCode 1.18.33, React 19.3.0, Vite 8.3.1 og Astro 7.3.5. Der er ikke committet eller pushet.

- **Fundet i Electron og brugt:** Hovedprocessen kan køre et script i forhåndsvisningens ramme, også når rammen er sandboxet og kører i sin egen proces, og scriptet kan levere brugerens valg tilbage som data. Scriptet kører i sidens egen verden; Electron tilbyder ingen isoleret verden for en underramme. Sandbox, indholdspolitik og netværksregler er ikke ændret, og siden får ingen preload eller IPC.
- **Enhedstestet:** 176 automatiske tests består, når testfilerne køres én ad gangen. De 10 nye dækker:
  - at sidens tekst findes i koden trods linjeskift, indrykning og HTML-tegnkoder;
  - at kommentarer, scripts, installerede pakker, build-mapper, `.env`, `secrets` og filer med mulige nøgler ikke er med i søgningen;
  - valget af kilde: én forekomst på den viste side, ellers i projektet, ellers i det rette tag, og ellers ingen;
  - hvordan den nye tekst skrives i HTML, JSX, Astro og Markdown, og hvornår Aura overlader den til AI'en;
  - rensning af data fra siden og en mulig nøgle i siden;
  - tekstrettelse, der kun ændrer teksten, og Fortryd byte for byte, også når filen er ændret siden;
  - Fortryd af en AI-opgave uden version: ny fil slettes, slettet fil kommer igen, beskyttede stier og stier uden for projektet afvises;
  - at en fil, Aura kun kunne læse før eller efter en opgave, ikke står som ny eller slettet.
  Køres alle testfiler samtidig, fejler 5 eksisterende tests med tidsgrænser for opstart af Node og motoren, mens computeren var travl (backup og macOS' programkontrol). De består alle, når de køres én ad gangen.
- **Kørt mod rigtigt materiale i Electron:** `npm run test:preview-edit` bruger den rigtige OpenCode-motor, rigtige projektfiler i en midlertidig mappe uden Git og en kontrolleret modelserver med faste svar. React og Astro kører med rigtige pakker og deres egen udviklingsserver. Prøven har 13 delprøver:
  1. Ret i siden er slået fra fra start, og intet er indsat i siden.
  2. Slået til: sandbox og indholdspolitik er uændrede, siden har ingen adgang til Aura, og valgscriptets nøgle kan ikke tælles op.
  3. Sidens knap og link reagerer ikke, mens man vælger. Kortet viser navn, tekst og linjen i koden.
  4. Tekstrettelsen ændrer kun teksten i filen, ses i forhåndsvisningen (efter ca. 0,8 s), står under Ændringer som din og i Aktivitet, og Fortryd giver filen byte for byte tilbage.
  5. Kontrollen siger det, når forhåndsvisningen ikke viser rettelsen; her skriver sidens eget script teksten tilbage.
  6. Flere forekomster, et element med andre elementer og en mulig nøgle i siden rettes ikke direkte; kortet siger hvorfor.
  7. Tastatur: Escape afslutter og fjerner scriptet, Enter slår til, pil ned og Enter vælger, og fokus flytter til kortet.
  8. Efter genindlæsning kan man stadig vælge.
  9. Målrettet AI-ændring: målet står over skrivefeltet, i Før du sender, i beskeden til modellen, i samtalen og på resultatkortet. Den mulige nøgle og den statiske servers nøgle i adressen sendes ikke.
  10. Fortryd opgaven uden version sætter filen tilbage og kan ikke gentages.
  11. 980 × 720 uden vandret rulning; kortet og knappen står i panelet ved 125 % og 150 % tekst; valg virker i den skalerede mobilvisning; reduceret bevægelse slår kortets animation fra.
  12. React med Vite: JSX-teksten rettes i `src/App.tsx` og vises med HMR; Fortryd byte for byte; `Tilmeld {n}` rettes ikke direkte, og Reacts klik kører ikke, mens man vælger.
  13. Astro: overskriften rettes i `src/pages/index.astro` med `&` som HTML-tegnkode; tekst med en variabel rettes ikke direkte.
- **Fundet og rettet under afprøvningen:**
  - Den statiske forhåndsvisning opdagede ikke en rettelse, der kom, før dens første kontrol af filerne var færdig. Kortets kontrol sagde det korrekt. Aura genindlæser nu selv siden efter en rettelse og en fortrydelse.
  - Målingen viste, at resultatkortet efter første udkast kunne sige, at forhåndsvisningen ikke kørte, fordi den statiske server først starter, når den nye side er opdaget. Kontrollen spørger nu efter den nye forhåndsvisning først. Fejlen fandtes før milepælen; i milepæl 3's måling startede forhåndsvisningen tilfældigvis først.
  - Astros udviklerværktøj lægger sine egne elementer i siden. Vælges det, står det som Element og kan kun ændres af AI'en.
- **Kørsler:** Alle 18 Electron-prøver består, også de 17 fra tidligere milepæle. `test:frameworks` fejlede én gang, fordi et skærmbillede i Playwright ikke blev taget inden for 20 sekunder; den bestod ved næste kørsel. Valget i den nedskalerede mobilvisning fejlede først, fordi Playwright regner klik forkert i en skaleret ramme i en anden proces. Prøven klikker nu med musen på det sted, knappen ses, og det virker.
- **Målt:** 2.776 synlige ord, 235 valg og 49 ⓘ på 40 skærme mod 2.651, 218 og 48 på 36 skærme efter milepæl 3. Ingen sidefejl.
  - Fire nye skærme: Ret i siden (38 ord, 4 valg, 1 ⓘ), valgt element (15 ord, 4 valg inkl. luk og filnavnet), ny tekst (13 ord) og rettet med Fortryd (16 ord, 3 valg).
  - Ret en tekst i siden tager 4 klik: Ret i siden, elementet, Ret teksten og Gem.
  - Ændringer og Aktivitet har flere ord og valg, fordi målingens rettelse og fortrydelse står der.
  - Arbejdsområdet og resultatkortet er uændrede. Ret i siden er skjult, indtil der er en side.

Ikke afprøvet:
- En rigtig model, der får et mål fra forhåndsvisningen.
- Vue og Svelte; reglerne for filtyperne er kun enhedstestet.
- Komponenter med egen shadow DOM og sider med meget store DOM-træer.
- Skærmlæser (VoiceOver), Windows, en pakket app og en person uden teknisk baggrund.

Kendte begrænsninger:
- Fortryd for en tekstrettelse står på kortet, indtil man vælger et nyt element. Derefter er Versioner vejen tilbage, når projektet har dem.
- Sidens eget script kan se markeringen og kalde valgscriptet, mens Ret i siden er slået til. Det, siden sender, renses og vises, før noget ændres eller sendes.

## Godkendelser og fejl · 6. oktober 2026

Tredje milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet på Mac med OpenCode 1.18.33. Der er ikke committet eller pushet.

- **Fundet i OpenCode og brugt:** En afvisning med en besked giver AI'en beskeden som rettelse, og opgaven fortsætter. En afvisning uden besked stopper opgaven. En filgodkendelse har ændringen med som diff, og kommandoens afslutningskode ligger i `metadata.exit`. Electron opfanger konsolfejl og HTTP-status fra previewets ramme; det er afprøvet med en bevidst fejl i en side.
- **Enhedstestet:** 166 automatiske tests består, når testfilerne køres én ad gangen. De 5 nye dækker:
  - diff fra OpenCode med linjenumre;
  - kommandogæt og afslutningskoder;
  - fejltyper fra modelserveren for HTTP 401, 402, 403, 404, 429, 400 og 503;
  - afvisning med og uden besked gennem motorens API;
  - at Stop giver et resultatkort med filer og maskeret kommando-output;
  - at godkendelsen får kommandoens mappe og begrundelse med, og at en fejl fra OpenCode får en type.
  En eksisterende prøve fangede, at den nye besked om stilstand sagde "to minutter" uanset grænsen; den beregnes nu.
- **Kørt mod rigtigt materiale i Electron:** `npm run test:approvals` bruger den rigtige OpenCode-motor, et nyt projekt med Git i en midlertidig mappe og en kontrolleret modelserver. Modellens svar er faste testdata; kommandoerne køres rigtigt. Prøven har 8 delprøver:
  1. Filgodkendelsen viser fil, antal linjer, ændringen og omfanget, og statuslinjen siger "Venter på dig" med Vis.
  2. Kommandokortet viser kommando, AI'ens begrundelse og et gæt, uden fremhævet Tillad.
  3. Kontroller viser sidens konsolfejl fra forhåndsvisningen og kommandoens afslutningskode 1 med output.
  4. Afvis med en besked: modellen fik beskeden, og opgaven fortsatte.
  5. Afvis: opgaven stopper, og kortet siger, hvad der blev afvist.
  6. Stop: kortet viser filen, AI'en nåede, og Fortryd det, den nåede, satte den tilbage.
  7. Nøgle, kvote og afbrudt forbindelse får hver sin forklaring og handling på ét kort; der vises ingen rød linje eller advarselsboks ved siden af. Prøv igen virker.
  8. Kortet holder sig inden for samtalen ved 980 × 720.
- **Kørsler:** Alle 17 Electron-prøver bestod. `test:chat` fejlede først på den gamle tekst "Ingen kommandoer kørt"; prøven er rettet og kontrollerer nu også Auras kontrol af siden. Efter en sidste forkortelse af godkendelsens tekster er `test:approvals` og `test:chat` kørt igen og består.
- **Målt:** 2.651 synlige ord, 218 valg og 48 ⓘ på 36 skærme mod 2.582, 217 og 47 efter milepæl 2. Klik pr. opgave er uændret, og der er ingen sidefejl.
  - Godkendelse af filændringer gik fra 43 til 60 ord og fra 5 til 7 valg: Se ændringen og Afvis med en besked er nye.
  - Resultatkortet gik fra 23 til 56 ord og fra 4 til 3 valg; Kontroller er ny.
  - Aktivitet har én række mere for kontrollen.

Ikke afprøvet:
- En rigtig model, der fejler, eller som får en afvisning med besked.
- Godkendelser for hjemmesider og mapper uden for projektet i Electron; de er kun dækket af den samme kode som filer og kommandoer.
- Kontrollen af en framework-server (Vite eller Astro) efter en opgave.
- Skærmlæser (VoiceOver), Windows, en pakket app og en person uden teknisk baggrund.

## Afklaring og plan · 6. oktober 2026

Anden milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet på Mac med OpenCode 1.18.33. Der er ikke committet eller pushet.

- **Fejl fundet og rettet:** AI'en har aldrig kunnet stille spørgsmål med svarmuligheder gennem Aura.
  - OpenCode tilbyder kun spørgeværktøjet til klienterne `app`, `cli` og `desktop` eller med `OPENCODE_ENABLE_QUESTION_TOOL`. Aura melder sig som `harness`.
  - Den tidligere spørgsmålsformular var derfor kun afprøvet med en falsk motor.
  - Prøvet mod den rigtige motor med en kontrolleret modelserver: uden flaget fik modellen glob, grep, read og webfetch under planlægning; med flaget også question.
- **Enhedstestet:** 161 automatiske tests består, når testfilerne køres én ad gangen. De 8 nye dækker:
  - briefen fra idé, ønsker og svar; ugyldige linjer; AI'ens markering "(anbefalet)" kommer ikke med;
  - planens fire afsnit, også med fede eller almindelige overskrifter og en overskrift i en kodeblok;
  - AI'ens anbefalede svar først;
  - brugerens egen plan, Gendan AI'ens version og en plan, der er stoppet;
  - en afbrudt byggeopgave, hvis plan genåbnes som seneste plan og ikke kan bygges;
  - svar og Spring over gennem motorens API;
  - at motoren får spørgeværktøjet.
- **Kørt mod rigtigt materiale i Electron:** `npm run test:planning` bruger den rigtige OpenCode-motor, et nyt projekt med Git i en midlertidig mappe og en kontrolleret modelserver, der kalder question-værktøjet. Modellens svar er faste testdata. Prøven har 11 delprøver:
  1. Idé og ønsker står i briefen; beskeden indeholder kun idéen.
  2. Modellen får spørgeværktøjet og briefen; spørgsmålet tager ikke fokus fra skrivefeltet.
  3. Tre spørgsmål vises ét ad gangen med AI'ens anbefaling først, flere valg, Tilbage, eget svar og tastatur.
  4. Svarene når modellen og briefen. Planen står under Plan i fire afsnit; AI'en skifter ikke fane.
  5. Brugeren retter briefen og planen; planen siger, at briefen er ændret bagefter.
  6. Bygning bruger den rettede plan og brief; planen står som bygget og kan bygges igen.
  7. Bed AI'en rette giver en ny plan fra AI'en.
  8. Efter Stop kan den seneste plan læses, men ikke bygges, og bliver udgangspunkt for en ny plan.
  9. Spring over lader AI'en vælge selv, og opgaven fortsætter til en plan.
  10. Brief og plan genåbnes efter genstart.
  11. Fem faner står på én linje ved 980 × 720.
- **Fundet af prøven og rettet:** Spring over afviste først spørgsmålet. OpenCode stopper så opgaven, og brugeren fik "AI'en stoppede uden et resultat". Nu svarer Spring over, at AI'en skal vælge selv. Planen stod heller ikke som bygget, før brugerfladen fik besked fra hovedprocessen.
- **Kørsler:**
  - Alle 16 Electron-prøver bestod efter ændringerne i hovedprocessen og spørgsmålene. `test:workspace` fejlede først, fordi prøven ventede fire faner; prøven er rettet.
  - Efter de sidste ændringer (neutrale eksempler på startsiden og en rolig animation i den tomme forhåndsvisning) er `test:workspace`, `test:planning`, `test:desktop`, `test:introduction` og `test:chat` kørt igen og består. De øvrige elleve er ikke kørt igen efter disse to ændringer.
  - To kørsler af `test:planning` fejlede undervejs, efter at nogen havde klikket i det synlige prøvevindue: en titel var markeret, og vinduet havde en anden størrelse.
- **Målt:** `npm run measure:screens` giver 2.582 synlige ord, 217 valg og 47 ⓘ på 36 skærme mod 2.425, 206 og 47 på 34 skærme i den committede milepæl 1, målt med samme script. Ingen sidefejl.
  - Nye skærme: Spørgsmål fra AI'en (29 ord, 4 valg) og Plan (92 ord, 6 valg).
  - Plankortet i samtalen gik fra 26 til 20 ord.
  - Fra idé til første udkast tager 6 klik mod 5, fordi målingens model nu stiller et spørgsmål, som skal besvares.
  - Aktivitet og Se alle oplysninger voksede med henholdsvis spørgsmålet og projektbriefen.

Ikke afprøvet:
- En rigtig model, der selv vælger at stille spørgsmål med question-værktøjet og skriver planen under de fire overskrifter. Instruktionerne er skrevet, men kun afprøvet med faste modelsvar.
- Skærmlæser (VoiceOver), Windows, en pakket app og en person uden teknisk baggrund.

## Arbejdsflade med fire faner · 5. oktober 2026

Første milepæl i [planen for brugerfladen](ux-plan.md). Afprøvet på Mac med OpenCode 1.18.33. Der er ikke committet eller pushet.

- **Enhedstestet:** 153 automatiske tests består, når testfilerne køres én ad gangen (`node --test --test-concurrency=1 tests/*.test.cjs`). De 16 nye dækker:
  - linje-diff: linjenumre, kontekst, sammenlægning, nye og slettede filer, CRLF og 200 tilfældige rettelser, der kan genskabes; en fuld omskrivning af 3.000 linjer går ikke i stå;
  - filbeskyttelsen med konkrete input, der afvises: `.env`, `.env.example`, `config/produktion.env`, `references/`, `secrets/`, `.secrets/`, `node_modules/`, `.git/config`, `.npmrc`, `*.pem`, `credentials.json`, `../udenfor.txt`, `public/../.env`, `/etc/passwd`, `C:/Windows/win.ini`, omvendte skråstreger, tomme led, et symbolsk link til en fil og til en mappe uden for projektet, en binær fil, en fil over 1 MB og en fil med en mulig nøgle i indholdet;
  - filhenvisninger: kun tekstfiler og linjer, der findes;
  - tilskrivning: AI'ens fil, en fil ændret af både AI'en og brugeren, en kommando og brugerens egen fil, pr. opgave og for hele samtalen;
  - aktivitet: rigtige værktøjsdele med stier i projektet, maskeret kommando-output, patchfiler og loggens grænse.
- **Kørt mod rigtigt materiale i Electron:** `npm run test:workspace` bruger den rigtige OpenCode-motor, rigtige projektfiler i en ny midlertidig mappe og en kontrolleret lokal modelserver. Modellens svar er altså faste testdata, ikke en rigtig model. Prøven har 16 delprøver:
  1. Forhåndsvisning er udgangspunktet.
  2. Kode viser filerne som skrivebeskyttet tekst; et `<script>` i filen vises som tekst og køres ikke.
  3. Hovedprocessen afviser `.env`, en privat reference, stier uden for projektet og et symbolsk link, både ved læsning og som filhenvisning.
  4. Faneskift med mus og piletaster bevarer previewets formular og rulning og beskedkladden, og fokus er synligt.
  5. Mens AI'en arbejder og venter på en godkendelse, bliver brugeren i Kode, og skrivefeltet beholder fokus.
  6. Aktivitet viser de faktiske værktøjer, godkendelser med ventetid ("Venter på dig · i 2 s" og "Du tillod den · efter …"), kommandoens rigtige output og resultatet.
  7. Ændringer viser resumé, sammenligningsgrundlag og linje-diff. En fil, prøven selv retter, mens AI'en venter, står som "En kommando eller dig", ikke som AI'ens.
  8. Stier i AI'ens svar åbner den rigtige fil og linje.
  9. En filhenvisning står i skrivefeltet og i Før du sender og når modellen som sti og linje.
  10. Stop og en fejl fra modelserveren står i Aktivitet, og beskeden bevares.
  11. En senere rettelse gør AI'ens fil til "AI'en og andre" i Hele samtalen.
  12. Ved 980 × 720 er der ingen vandret rulning, og fanerne står på én linje. Ved 125 % og 150 % tekst bryder fanerne over to linjer, men står inden for vinduet, og Send er synlig. Ved 150 % er sidepanelet foldet sammen og kan foldes ud oven på indholdet og lukkes med Escape.
  13. Sidepanelet kan foldes sammen og ud med bevarede navne, menuen står ved knappen, og valget huskes.
  14. Reduceret bevægelse slår markeringens animation fra, og aktiviteten overlever en genindlæsning af brugerfladen.
- **Kørsler:** I den samlede kørsel bestod de 14 øvrige Electron-prøver (desktop, chat, opsætning, introduktion, genoptagelse, gendannelse, versioner, funktioner, standardvalg, agent, hosting, udgivelse, værktøjer og frameworks). `test:workspace` fejlede én gang i den kørsel: Aktivitet var valgt, hvor prøven ventede Kode. Appen skifter kun fane ved et klik eller med tastaturet, og fejlen er ikke set igen i fire efterfølgende kørsler. Årsagen er ikke fundet; et klik i det synlige prøvevindue er en mulig forklaring. Efter de sidste tekstrettelser er `test:workspace`, `test:chat`, `test:versions` og `test:recovery` kørt igen og består. De øvrige ti er ikke kørt igen efter disse rettelser.
- **Set i appen:** Skærmbilleder af alle fire faner ved 1440 × 940 og 980 × 720 og ved 125 % og 150 % tekst er gennemgået. Ved zoom tages billederne med Electrons egen `capturePage`; Playwrights skærmbillede skærer billedet til, når teksten er forstørret.
- **Målt:** `npm run measure:screens` giver 2.425 synlige ord, 206 valg og 47 ⓘ på 34 skærme mod 1.980, 186 og 48 på 32 skærme før. Klik pr. opgave er uændret: 5, 5 og 2. Ingen sidefejl.
  - Kode (104 ord, 10 valg) og Aktivitet (178 ord, 2 valg) er nye skærme bag deres faner.
  - Ændringer gik fra 11 ord, fordi den gamle dialog var tom efter Fortryd, til 170 ord med resumé og linje-diff for opgaven.
  - Arbejdsområdet fik 3 ord og 3 valg mere: fire faner i stedet for knappen Ændringer.
  - Godkendelsen og resultatkortet har hver ét valg mere, fordi filen er et link.

Ikke afprøvet:
- En rigtig model gennem arbejdsfladen. Der er ikke foretaget rigtige modelkald i denne milepæl.
- Skærmlæser (VoiceOver), Windows, en pakket app og en person uden teknisk baggrund.
- Ændringer og Aktivitet efter en genstart af appen. De gemmes ikke på disken, så fanerne er tomme igen; det er en bevidst begrænsning.

## Afprøvet på Mac

- 78 automatiske tests består. De omfatter rigtige midlertidige Git-repositories, HTTP-servere, filskrivning, afvisninger, hemmelighedsbeskyttelse og gendannelse. Modellerne i disse tests er kontrollerede testdata.
- Den trinvise AI-opsætning er gennemført i Electron: to store valg ved første start, nøgleformular, lokal opdagelse, tomt katalog, forbindelsesfejl, genkontrol, tilbage-navigation og Vælg senere. Tastatur, reduceret bevægelse og vinduet ved 980 × 720 er prøvet. Kladden bevares, og et faktisk projekt åbner i preview. Serverne leverer kontrollerede svar; forløbet er endnu ikke observeret med en kommunal medarbejder uden udviklererfaring.
- OpenCode-forløbet er gennemført med plan, afklaring, godkendt filændring, preview, versionsgemning og kontrolleret modelserver. Samtale, plan og kladde genfindes efter genstart; en afbrudt opgave starter ikke igen af sig selv.
- Gendannelse og fortrydelse er gennemført gennem appens knapper og efter genstart. HEAD, index, private indstillinger og nye filer uden for historikken bevares. Filrettigheder bevares; forældede gennemgange afvises. En fremkaldt skrivefejl kan håndteres med kopien før gendannelsen.
- Forkert nøgle, kvote og en faktisk afbrudt HTTP-strøm er fremkaldt. Hvert kald stopper uden automatisk gentagelse. Stop er prøvet efter et delvist modelsvar. En ny opgave lykkes efter hver fejl og efter Stop.
- En tidligere plan nulstilles efter gendannelse. Markøren kontrolleres ved genåbning, også når samtalefilen ikke kunne opdateres ved første forsøg.
- Fejlrapporten er gennemgået og gemt gennem filvælgeren. Den bruger faste statusfelter og udelader projektindhold, filstier, serveradresser, kontonavne og nøgler. Hjælpeskærmens unødvendige kontakt til nøgleringen er fjernet. Nøglelagring står som ikke kontrolleret; en fejlrapport må ikke udløse et nøgleopslag.

## Corti S1 og blindgyder · 1. oktober 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Med en rigtig model:** Corti S1 er kørt gennem appen med `npm run test:live-app` og brugerens nøgle fra Cortis miljø fr. Nøglen blev indtastet af brugeren i appen.
  - Forbindelse, plan og rettelse virker.
  - Siden "Find et lokale med plads til dit møde" blev bygget med søgefelt og tre lokalekort på godt dansk. Den blev gemt automatisk som version.
  - Hele samtalen kostede ca. 0,11 USD.
  - Første kørsel stoppede uden filer, fordi svaret var begrænset til 4.096 tokens. Det er rettet.
  - I sidste kørsel stoppede bygningen, efter at prøven afviste kommandoen `ls -la`. Appens regler beder nu AI'en bruge sine værktøjer til at se filer, og resultatkortet siger, når brugeren har afvist en handling. Begge dele er afprøvet med en kontrolleret model, ikke med Corti.
- **Enhedstestet:** 137 automatiske tests består. De nye dækker:
  - Corti-adressen ud fra nøglens miljø og afvisning af USA;
  - beskeden, når Corti afviser en nøgle;
  - at miljøet bevares ved redigering;
  - globale Git-filtre;
  - feedback på e-mail;
  - opstartstjekket af AI-motoren;
  - startsidens fingeraftryk.
- **Afprøvet i Electron med en kontrolleret modelserver:**
  - Alle 15 Electron- og motorprøver består, ligesom skill-prøverne i OpenCode og Claude Code.
  - `test:recovery` afprøver feedback-teksten uden kontakt.
  - `test:desktop` og `test:introduction` viser pladsholderen i preview-ruden og den rigtige side, når `index.html` er ændret.
  - `test:features` fandt, at en ⓘ-knap var markeret som åben et øjeblik efter, at boblen var lukket. Det er rettet.
- **Målt:** 1.980 synlige ord på 32 skærme.

Ikke afprøvet:
- **En pakket Aura.app (beta.4) og notarisering:** Apple-aftalen mangler.
- **Feedback-knappen med en rigtig kontakt:** Kontakten i `package.json` er endnu tom.
- **Corti med en nøgle fra EU-miljøet.**
- **En tester uden teknisk baggrund og Windows.**

## Navneskift til Aura · 1. oktober 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Enhedstestet:** 127 automatiske tests består, når testfilerne køres én ad gangen. De nye tests dækker:
  - **En ny installation** hedder Aura i datamappe og nøglering og husker det til næste opstart.
  - **En installation fra før navneskiftet** beholder sin datamappe og navnet "AI Harness" i nøgleringen, så gemte nøgler kan læses. Det gælder også en valgt datamappe med data fra før, som i opdateringsprøven.
  - **Projektmappe:** Nye projekter lægges i Dokumenter › Aura, medmindre Dokumenter › AI Harness findes.
  - **Markører:** Afsnit med de gamle `ai-harness`-markører opdateres til `aura-harness`, også når indholdet er uændret, og de kan fjernes. Nye og gamle markører i samme fil giver en konflikt.
  - **Downloadsider:** Siderne viser installationsfiler med både det nye og det tidligere navn.

  Prøverne af de gamle markører og den gamle nøglering fejler, når understøttelsen af det gamle navn fjernes. Det er afprøvet.
- **Afprøvet i Electron med en kontrolleret modelserver:**
  - Alle 15 Electron- og motorprøver består, ligesom skill-prøverne i OpenCode 1.18.33 og Claude Code.
  - Appen viser Aura i menu, vindue, velkomst og sidepanel.
  - Mappen hedder Dokumenter › Aura, og nye projekter får Git-identiteten `Aura-bruger`.
  - Eget kodeværktøj installerer afsnit mellem `aura-harness`-markørerne.
- **Målt:** `npm run measure:screens` giver 1.968 synlige ord på 32 skærme. Det er 11 færre end før, fordi "AI Harness" mange steder er blevet til "Aura".
- **Pakker:** De 23 pakker hedder `aura-harness-<værktøj>-0.2.0.zip`, og vejledningen i dem nævner de nye markører.
- **Indsats under skrivefeltet:** Linjen viser nu fx "Claude Opus 5.5 · Anthropic · middel indsats" i stedet for "indsats mellem". Det er set i skærmmålingen.

Ikke afprøvet:
- **En pakket Aura.app og en opdatering fra beta.3 (AI Harness.app):** `verify-upgrade` er tilpasset, men kræver to byggede apps.
- **Windows og en pakket app i det hele taget.**
- **Begyndergennemgangen med 27 skærmbilleder:** Scriptet lå i den midlertidige arbejdsmappe og forsvandt ved en genstart af Mac'en. Skærmmålingen dækker de samme skærme med skærmbilleder.

## Integrationsskills · 30. september 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Mod den rigtige tjeneste:** `npm run test:integrations` læser søgeadressen og testopslaget fra Adresser-skillens egen tekst og kalder Klimadatastyrelsens Adressevælger. Kontrollen viser, at:
  - søgningen finder "Rådhuspladsen 1, 1550 København V" med de felter, skillen beskriver;
  - tjenesten kan kaldes fra en browser;
  - opslag med ID giver postnummer og koordinater i EPSG:25832.
- **Enhedstestet:** 121 automatiske tests består, når testfilerne køres én ad gangen. De nye tests dækker:
  - Kataloget: en integration afvises uden system, ejer, adgang, data, dataflow, pris, kontroldato eller kilder, og uden for gruppen integrationer.
  - Integrationsskills holder nøgler på serveren og nævner systemets regler.
  - Pakker, projektets `.harness/LAES-MIG.md` og webguidens tekster tæller integrationer for sig, og pakkerne indeholder ingen integrationer.
  - `scripts/harness.cjs` bevarer et udvalg fra appen, også en valgt integration.
  - Webguidens script bruger kun felter, som kataloget har.
- **Afprøvet mod den rigtige motor:** `npm run test:app-skills` henter den valgte integration og dens reference i OpenCode 1.18.33. Det er gjort med og uden Git og under planlægning.
- **Afprøvet i Electron med en kontrolleret modelserver:**
  - `test:features`: Integrationen slås til for ét projekt. Dens ⓘ viser ejeren, og i næste session får modellen både skillen og appens regel om nøgler. Ved første start vises kun de seks almindelige funktioner.
  - `test:tools`: I eget kodeværktøj vælges integrationen til og installeres med sin reference. Den tælles for sig og huskes ved næste installation. Vælg alle skills vælger ikke integrationer.
  - De øvrige 12 Electron- og motorprøver består også, ligesom skill-prøverne i OpenCode 1.18.33 og Claude Code. Begyndergennemgangen gav 27 skærmbilleder uden sidefejl.
- **Fejl fundet og rettet undervejs:**
  - Webguiden viste "Filerne kunne ikke indlæses" fra 29. september. Kataloget havde to felter ved navn `categories`, så listen over skills fik værktøjernes kategorier. Rettelsen er afprøvet i browseren, og en ny test kontrollerer felterne.
  - Funktioner havde en vandret rullebjælke, når et projekt var åbent. Projektvalgets skjulte radioknapper fik den generelle bredde for input, så dialogen blev 848 px bred i stedet for 698. Nu kontrollerer `test:features`, at dialogen ikke er bredere end sin plads.
  - Flere tekster talte forkert, fx "14 skills", "12 af 14" og "Fravalgt: Adresser, CVR", selvom integrationer ikke er med som standard.
- **Målt:** `npm run measure:screens` giver 1.979 synlige ord, 188 valg og 48 ⓘ på 32 skærme, mod 1.923, 186 og 46 efter Rolige skærme.
  - Funktioner voksede med afsnittet Integrationer: fra 96 til 124 ord og fra 11 til 13 valg.
  - Instruktionerne viser nu også de to integrationer som slået fra, og resuméet i eget kodeværktøj nævner dem.
  - Sikkerhedskopi talte 14 ord mere, fordi GitHub-status denne gang nåede at blive indlæst før målingen. Målingen venter nu på den.

Ikke afprøvet:

- CVR mod den rigtige tjeneste. Det kræver en bruger hos Datafordeleren eller en ansøgning om system-til-system-adgang, og vi opretter ikke konti.
- Datafordeleren. Adresser-skillens afsnit om Datafordeleren bygger på dokumentationen, og et kald kræver en API-nøgle.
- En rigtig model, der selv vælger en integration og bygger med den. Prøverne bruger en kontrolleret modelserver.
- Windows, en pakket app og en person uden teknisk baggrund.

## Rolige skærme · 30. september 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Målt i Electron:** `npm run measure:screens` åbner 32 skærme og dialoger med en kontrolleret model og tæller det, der er synligt i første lag.
  - Synlige ord faldt fra 3.789 til 1.923, 49 % færre.
  - Valg faldt fra 209 til 186, plus 46 ⓘ.
  - Klik pr. opgave er uændret: 5 for at forbinde Claude, 5 fra idé til første udkast og 2 for at fortryde.
  - Der var ingen sidefejl.
  - De største fald er "Se alle oplysninger" fra 1.162 til 250 ord, nøglehjælpen fra 217 til 100 og AI-forbindelser fra 107 til 9.
- **Enhedstestet:** 117 automatiske tests består, når testfilerne køres én ad gangen.
- **Afprøvet i Electron med en kontrolleret modelserver:** Alle 15 Electron- og motorprøver består efter tilpasningen til de nye skærme. Det samme gør begge skill-prøver og begyndergennemgangen med 27 skærmbilleder uden sidefejl.
  - Testene tilføjer nu forbindelser ad samme vej som en bruger: AI-forbindelser › Tilføj forbindelse › Vælg en anden.
  - `test:preferences` afprøver den flade liste og de automatisk huskede valg.
  - `test:features` afprøver, at ⓘ åbner og lukker, både i og uden for en dialog. Kontrollen fandt en fejl, som er rettet: Et nyt klik på samme ⓘ åbnede boblen igen i stedet for at lukke den.
  - Rettelsen kom efter den samlede kørsel og er kun afprøvet med `test:features`. Ingen andre prøver klikker på ⓘ.

Ikke afprøvet:

- En person uden teknisk baggrund, der bruger skærmene. Målingen viser mængden af tekst, ikke om teksten forstås.
- Skærmlæser og tastatur i ⓘ-boblen ud over fokus og Escape.
- Windows og en pakket app.

## Funktioner og fælles skills · 30. september 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Enhedstestet:** 117 automatiske tests består, når testfilerne køres én ad gangen. De nye tests dækker:
  - Kataloget: hver skill hører til præcis én funktion, og Deling bygger på Versioner.
  - Standard for alle projekter: uden et valg er alt slået til, og valget ved første start huskes.
  - Undtagelser pr. projekt: de gemmes kun, når de afviger fra standarden, og kan fjernes igen.
  - Afhængigheder: Deling og Versioner følges ad begge veje.
  - Instruktioner i projektet: de kan tilpasses og gendannes, og en ugyldig SKILL.md afvises. Grundreglerne gælder altid.
  - Skills under en slået fra funktion kommer ikke med.
  - Læse- og skrivereglerne virker med stier i forhold til Git-roden og uden Git. En privat reference afvises, en valgt læses, `.git`, `.env` og `secrets` afvises, og skillmappen kan læses, men ikke ændres.
  - Motorens skillmappe skrives forfra og tager kun gyldige skills.
  - Appens regler følger funktionerne.
- **Afprøvet mod den rigtige motor:** `npm run test:app-skills` kører appens egne tilladelser og skills i OpenCode 1.18.33 med en kontrolleret modelserver. Det er gjort i et projekt med Git, et uden Git og under planlægning, og det viser:
  - Modellen ser præcis de aktive skills og kan hente dem.
  - Skillens referencefil kan læses uden spørgsmål.
  - En ikke valgt privat reference, `.env` og `.git/config` afvises.
  - En valgt reference kan læses.
  - OpenCodes egen skill er skjult, og en skill under en slået fra funktion findes ikke i motoren.
  - Projektets egen AGENTS.md indlæses ikke.

  Med de gamle regler kunne AI’en læse alle private referencer i et projekt med Git. Det viste en prøve af de samme regelformer mod samme motor.
- **Afprøvet i Electron med en kontrolleret modelserver:** `npm run test:features` gennemfører forløbet med rigtig OpenCode, Git og projektfiler:
  1. første start med Vælg selv, hvor Deling og Versioner følges ad
  2. en startside uden design og hostingønske
  3. et projekt med Git fra start, uden Del og Sikkerhedskopi og med direkte arbejde
  4. en opgave, hvor modellen kun ser Git-skillen og får appens regler for de valgte funktioner
  5. en undtagelse for projektet og en ændring for alle projekter; Planlægning skifter arbejdsmåden med det samme
  6. næste opgave i en ny modelsession med de nye skills
  7. et projekt uden versioner, som hverken får Git eller versionsknapper
  8. genstart, hvor valget er husket og spørgsmålet ikke stilles igen

  Introduktionsprøven viser spørgsmålet ved første start med to valg, hvor Hele pakken er anbefalet. Deling og udgivelse er ikke med i Hele pakken. Prøverne af Del og Sikkerhedskopi slår den derfor til først, og begyndergennemgangen gør det gennem panelet Funktioner. `verify-resume` ventede reelt kun 20 sekunder på planen, fordi ventetiden stod på den forkerte plads. Det er rettet. `verify-hosting` er rettet til den nuværende opsætning og består. De øvrige tolv Electron-prøver og skill-prøverne i eget kodeværktøj består også: OpenCode 1.18.33 og 1.17.15 samt Claude Code 2.1.150. `verify-framework-preview` bestod ved anden kørsel. Begyndergennemgangen gav 27 skærmbilleder uden sidefejl.

Målt: Med alle funktioner slået til er systemprompten vokset fra ca. 23.400 til 29.900 tegn pr. modelkald. Det skyldes listen over de 12 skills, som modellen skal kende for at kunne hente dem. Med færre funktioner bliver den kortere. En skills fulde tekst sendes kun, når den hentes.

Ikke afprøvet:

- En rigtig model, der selv vælger og henter en skill. Prøverne bruger en kontrolleret modelserver, der beder om skills i en fast rækkefølge.
- Windows, hvor OpenCode muligvis skriver stier med omvendt skråstreg. Tilladelsesmønstrene er kun afprøvet på Mac.
- En pakket app med ændringerne og en person uden teknisk baggrund.

## Gem, fortryd og kom tilbage · 30. september 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Enhedstestet:** 111 automatiske tests består, når testfilerne køres én ad gangen. De nye tests dækker:
  - Git fra start: branchen `main`, anonym identitet og første version. Hemmeligheder og private referencer kommer ikke med, og eksisterende repositories røres ikke.
  - automatiske versioner: de indeholder præcis opgavens filer, og brugerens ugemte filer bliver ugemte
  - et stop gemmes som "Afbrudt AI-opgave"; en opgave uden ændringer giver ingen version
  - en fil med en mulig nøgle kommer aldrig med; hooks og en ændret historik stopper automatisk gemning
  - Gem version med ét klik og tidspunkter i historikken
- **Afprøvet i Electron med en kontrolleret modelserver:** `npm run test:versions` gennemfører hele forløbet med rigtig OpenCode, Git og projektfiler:
  1. oprettelse med første version og anonym identitet
  2. en AI-opgave, der gemmes automatisk
  3. Fortryd opgaven, som sætter filen tilbage og gemmer "Fortrudt: …"
  4. Versioner med "Alt er gemt" og "i dag"-tidspunkter
  5. Gå tilbage hertil, der gemmer "Gendannet til: …"
  6. en ændring, brugeren selv laver, og som gemmes med Gem version
  7. genstart, hvor projektet, samtalen og forbruget kommer igen

  Desktop-prøven viser, at et projekt lukket med Nyt projekt ikke åbnes igen. De øvrige elleve Electron-prøver og skill-prøverne består også. Begyndergennemgangen gav 25 skærmbilleder uden sidefejl.

Ikke afprøvet:

- En rigtig model gennem appen. Prøven med Mistrals gratis plan (`npm run test:live-app`) venter på en nøgle.
- En pakket app med ændringerne, Windows og en person uden teknisk baggrund.
- Git-signering, der er slået til globalt. Så kan den første version mislykkes. Projektet oprettes stadig, og appen viser en besked.
- `verify-framework-preview` fejler af og til ved Vites genindlæsning og består ved næste kørsel. En særskilt opgave er foreslået.

## Første resultat uden spørgsmål · 29. september 2026

Afprøvet på Mac med OpenCode 1.18.33:

- **Enhedstestet:** 109 automatiske tests består, når testfilerne køres én ad gangen. De nye tests dækker:
  - mappenavne med æ, ø og å, og nummerering ved samme navn
  - tokengrænser for hver model
  - at gatewayen lader en langsom strøm køre færdig og stopper ved stilstand
  - at godkendelse for en hel opgave kun gælder filer i projektmappen og ophører, når opgaven slutter
  - vilkår og priser for hver udbyder og for hver af Zens modeller
  - at appen aldrig anbefaler en model, og udbyderens standardindsats
  - forbrugstælleren: hvert modelkald tælles én gang, ræsonnement afregnes som output, forbruget gemmes med samtalen og nulstilles ved ny samtale
  - at motorens forventede version svarer til låsefilen
- **Afprøvet i Electron med en kontrolleret modelserver:** Alle elleve prøver består med OpenCode 1.18.33: introduktion, opsætning, desktop, standardvalg, chat, genoptagelse, gendannelse, agent, værktøjer, frameworks og udgivelse.
  - Chatprøven viser `public/index.html` i godkendelsen og bruger Tillad for denne opgave. Resuméet før afsendelse vises ikke igen ved bygning.
  - Genoptagelsen viser, at accepterede vilkår huskes efter genstart, og at resuméet vises igen, når den tidligere samtale medsendes.
- **Begyndergennemgang:** Hele forløbet fra velkomst til genstart er gennemgået i appen med en kontrolleret model i Anthropics format og et skærmbillede af hver skærm.
  - Kaldet til modellen har nu `max_tokens=32000`. Før var det 4.096.
  - Efter fem kald viste linjen under skrivefeltet "Claude Opus 5.5 · Anthropic · indsats mellem" og "Denne samtale: 6.000 tokens ind · 1.500 ud · ca. 0,05 USD".
- **Skills i eget kodeværktøj:** Prøverne består med OpenCode 1.18.33 fra `.runtime` og med Claude Code 2.1.150 (`HARNESS_CLAUDE_PATH=~/.local/bin/claude`). Den ældre Claude Code 2.0.56, der ligger først på PATH på denne Mac, kender ikke et af prøvens flag. Prøven fejler derfor med den.

Ikke afprøvet:

- **En rigtig model gennem appen:**
  - Brugeren valgte ikke at betale for en prøve.
  - Zens gratis modeller afviser appen, fordi den melder sig som `harness`.
  - Prøven med Mistrals gratis plan (`npm run test:live-app`) ventede 30 minutter uden nøgle og blev derefter stoppet efter aftale.
- En pakket app med OpenCode 1.18.33, Windows, Intel-Mac og en person uden teknisk baggrund.
- `verify-hosting` fejlede på den committede version, fordi den ledte efter en foldeboks og filvalg, der er flyttet. Den er rettet 30. september 2026 og består. `verify-generated-preview` er en manuel prøve, der kræver en projektmappe.

## Få valg og udvælgelse af skills · 29. september 2026

- **Unit-testet:** 100 automatiske tests består, når testfilerne køres én ad gangen. Nye tests dækker anbefalede modeller pr. udbyder, fremhævede værktøjer, kategorier, installation af et udvalg af skills, fravalg ved næste installation, ingen skills og henvisninger mellem skills.
- **Afprøvet i Electron:** `test:tools` gennemfører fire kort og "Et andet værktøj" med søgning, et resumé i almindeligt dansk, udvælgelse af skills med låste grundregler, en fravalgt kategori og en fravalgt enkelt skill, installation til Claude Code og derefter Codex med det huskede udvalg, en fil ændret af brugeren og fjernelse. `test:setup` og `test:introduction` afprøver de tre udbyderkort og "Vælg en anden". Desktop, standardvalg, chat, resume og recovery består også efter ændringerne.
- **Set i browseren:** webguiden viser de fire mest brugte værktøjer og "Vis alle 24"; et direkte link til et andet værktøj åbner hele listen. Ingen vandret rulning ved 390 pixels.
- **Fundet undervejs:** appens egen protokol udleverede kun navngivne filer, så den nye `model-advice.js` gav tomme modelkort. Chattesten fandt fejlen, og filen er tilføjet.
- **Ikke afprøvet:** at en rigtig model vælger den anbefalede model eller de valgte skills, brugertest med en person uden teknisk baggrund og Windows.

## Harness i eget kodeværktøj · 29. september 2026

Afprøvet på Mac:

- **Unit-testet:** 96 automatiske tests består, når testfilerne køres én ad gangen (`node --test --test-concurrency=1 tests/*.test.cjs`). De nye tests dækker validering af biblioteket, adaptere, installation, opdatering, konflikter, symbolske links, CRLF, fjernelse, installation og fjernelse af hvert af de 23 værktøjers pakker, de faktiske ZIP-filer og at bygningen er reproducerbar.
- **Afprøvet i Electron:** `npm run test:tools` gennemfører førstevalget, valg af værktøjer, et rigtigt Git-projekt med egne regler og en `.gitignore`, der udelader `.claude/`, gennemgang, installation, gentagelse, konflikt ved en ændret skill og fjernelse. Projektets egne filer er uændrede bagefter. Introduktion, desktop, opsætning, agent og chat består også efter ændringerne.
- **Afprøvet i de rigtige værktøjer med en kontrolleret modelserver:** Claude Code 2.1.150 (`npm run test:skills-claude`) og OpenCode 1.17.15 (`npm run test:skills-opencode`) sender grundreglerne, kontrolordet og alle 12 skills til modellen og indlæser en skill, når modellen kalder den. Negative prøver uden importen i `CLAUDE.md` og uden `AGENTS.md` fejler som forventet. OpenCode fandt desuden alle 12 skills med `opencode debug skill` uden modelkald.
- **Hjemmesiden:** den samlede Pages-bygning er set i browseren. Webguide, FAQ, værktøjsoversigt, forside og appens side har ingen vandret rulning ved 390 pixels.

Ikke afprøvet:

- En rigtig models valg af skills. Den selvstændige Claude Code CLI var ikke logget ind, og OpenCodes gratis modeller afviste version 1.17.15 med beskeden om, at gratisadgangen kun kan bruges fra OpenCode. Codex havde ikke brugsadgang i denne omgang.
- De 21 værktøjer, hvis filplacering kun følger dokumentationen, Windows og en pakket app med ændringerne.

Kendt problem, som ikke skyldes ændringerne: tre npm-tests i `dev-server.test.cjs` fejler, når hele testsuiten køres parallelt, også med den uændrede kode fra HEAD. De består, når filerne køres én ad gangen.

## Rigtige gratis modeller

Hver OpenRouter-prøve bruger syntetiske data, et eksplicit modelvalg og en enkelt rute med oplyst nulpris. Betalt fallback er slået fra. Resultaterne nedenfor beskriver de konkrete prøver, ikke modellernes generelle evner.

- **Qwen3.8 27B**, `qwen/qwen3.8-27b:free`, ruten `modelrun/fp4`: gav en plan, men med tydelige danske sprogfejl. Bygningen nåede ikke en færdig filændring inden testens grænse. Kan ikke anbefales ud fra denne prøve.
- **Gemma 4 31B**, `google/gemma-4-31b-it:free`, ruten `google-ai-studio`: afvist med HTTP 429. Ingen kodekvalitet kunne vurderes.
- **Nemotron 3 Super**, `nvidia/nemotron-3-super-120b-a12b:free`, ruten `nvidia`: gav en forståelig plan, men forsøgte derefter `ls -la`, selv om prøveopgaven udtrykkeligt forbød kommandoer. Handlingen blev afvist. Ingen fungerende aktivitetsoversigt blev bygget i denne prøve.
- **Laguna S 2.1**, `poolside/laguna-s-2.1:free`, ruten `poolside/fp4`: afvist med HTTP 429. Ingen kodekvalitet kunne vurderes.
- **North Mini Code**, `cohere/north-mini-code:free`, ruten `cohere`: gav en plan med engelske rester og uklare danske formuleringer. Forsøgte derefter en mappekommando, som denne prøve udtrykkeligt forbød. Kommandoen blev afvist; forløbet nåede ikke et fungerende udkast.

En særskilt North Mini Code-prøve tillod begrænset mappelæsning efter godkendelse. Her skrev modellen faktisk en opgaveliste, som blev vist i preview. Den brugte til sidst filværktøjerne uden en kommando. Prøven bestod dog ikke: feltet fik et andet tilgængeligt navn end det bestilte, så funktionskontrollen stoppede, før den efterfølgende ændring blev afprøvet. Skærmbilledet viser et roligt, læsbart layout, men svaret til brugeren skiftede til engelsk, og teksten “Datalagret i hukommelsen” er ikke godt dansk. Kodegennemgangen fandt desuden brugerinput sat direkte ind i `innerHTML` uden escaping. Det er ikke et tilfredsstillende grundlag for en anbefaling.

Der er endnu ikke grundlag for at anbefale én af disse gratis forbindelser som et stabilt førstevalg til testerne. Katalogadgang og værktøjsunderstøttelse er ikke tilstrækkeligt bevis. Prøverne `rooms`, `tasks` og `activities` omfatter også efterfølgende ændring og mobilvisning, når modellen når frem til et udkast.

Ingen Ollama-tjeneste blev fundet på standardadressen på denne Mac. Den kendte Spark-enhed fremgår af Tailscale, men Tailscale er stoppet på computeren. Ingen netværksopsætning eller modelinstallation er ændret. Der mangler en prøve med en faktisk lokal model.

## Pakker og CI

[GitHub-kørsel 36470547106](https://github.com/ai-alliancen-org/ai-harness/actions/runs/36470547106) afprøvede commit `b5a83bf548f7d495bd9f32c6110d75bb278b0d43` (beta.3). Alle tre platforme bestod:

- **Windows x64, Apple Silicon og Intel-Mac:** Pakning og start af den pakkede app med isolerede brugerdata og begrænset PATH. Medfølgende Git, Node/npm og OpenCode blev kontrolleret. Projektoprettelse, rigtigt preview, Git-identitet og versionsgemning blev gennemført i syntetiske projekter.
- **Gendannelse og fejl på alle tre platforme:** Gendan og fortryd gennem brugerfladen og efter genstart, bevaret HEAD og private filer, forkert nøgle, opbrugt kvote, afbrudt HTTP-strøm, Stop, ny opgave efter fejl og eksport af en fejlrapport. Modelserveren leverede kontrollerede svar; prøven vurderer ikke en rigtig models kode eller sprog.
- **Begrænsning:** Windows-prøven starter `win-unpacked/AI Harness.exe`, ikke NSIS-installationsprogrammet. Installation, opdatering, afinstallation, SmartScreen og arbejdspladsens politik er ikke afprøvet på en almindelig Windows-maskine. CI-pakkerne er usignerede. Den særskilte opstartsprøve med tastatur og reduceret bevægelse er fortsat kun kørt lokalt på Mac.

De tidligere timeout-fejl ved Git-identiteten på Mac blev ikke gentaget. De private byggeartefakter kan hentes af personer med repositoryadgang: [Windows x64](https://github.com/ai-alliancen-org/ai-harness/actions/runs/36470547106/artifacts/10991466192), [Apple Silicon](https://github.com/ai-alliancen-org/ai-harness/actions/runs/36470547106/artifacts/10991790730) og [Intel-Mac](https://github.com/ai-alliancen-org/ai-harness/actions/runs/36470547106/artifacts/10991214935). De er knyttet til denne CI-kørsel og er ikke en publiceret Release.

Beta.3 til Apple Silicon er bygget separat i `desktop/release/beta.3/` med det godkendte mekbas-certifikat. Signaturen består `codesign --verify --deep --strict`. Alle 36 pakkede kildefiler matcher arbejdsmappen byte for byte; byggesystemet fjerner udviklingsscripts og -afhængigheder fra det pakkede manifest.

Den signerede app har bestået:

- Pakkeprøven med begrænset PATH: medfølgende Git, Node/npm og OpenCode, projektoprettelse, preview og versionsgemning i et syntetisk projekt. Git-status er genindlæst, mens identitetsformularen allerede var synlig, uden at indtastningen blev overskrevet.
- Den nye opstartsguide med tastatur, reduceret bevægelse, lille vindue, kontrolleret Ollama-katalog og oprettelse af et faktisk projekt.
- Gendannelse, fortrydelse efter genstart, nøglefejl, kvote, afbrudt HTTP-strøm, Stop og en ny opgave efter hver fejl. Hjælp og eksport af fejlrapport består også, når nøgleringskontrol bevidst afvises i testen.

DMG'en er monteret skrivebeskyttet; appens signatur og identiske `app.asar` er kontrolleret. Filoversigt og SHA-256 ligger sammen med DMG og ZIP. Downloadsiden er genereret lokalt, ikke publiceret.

Opdatering fra den signerede beta.2 til beta.3 er gennemført ved at erstatte appen samme sted i en midlertidig mappe. Projektfiler, forbindelse, syntetisk krypteret nøgle, designpakke og kladde er bevaret. Kladden er skrevet gennem appens skrivefelt. Den nye version sender ikke automatisk til den gemte modelserver. Prøven bruger isolerede brugerdata på udviklingsmaskinen; en separat maskine og Windows-opdatering mangler stadig.

Apple-notarisation er endnu ikke gennemført. Validering af loginprofilen for team `2UX98897JW` blev afvist med HTTP 403: en nødvendig aftale mangler eller er udløbet. Account Holder skal kontrollere medlemskab og ventende aftaler hos Apple. Ingen pakke er indsendt, og der er ingen notariseringskvittering. Signering alene er ikke notarisation.

## Før invitationerne kan sendes

1. Gennemfør et fuldt bygge- og rettelsesforløb med en lokal model og en hosted model, og vurder dansk og design på det faktiske resultat.
2. Gennemfør notarisation og kontrol af den endelige Mac-fil. CI-kørslen for beta.3 er bestået; nye appændringer kræver en ny pakke og kontrol.
3. Afprøv installation og opdatering på en separat testmaskine, herunder arbejdspladsens installationsrettigheder.
4. Observer en person uden udviklererfaring gennem [testforløbet](testforloeb.md), og ret de steder, hvor forklaring er nødvendig.
5. Giv de inviterede adgang til det konkrete downloadlink og en navngiven feedbackkontakt. Repositoryet er fortsat privat; der er ikke oprettet en offentlig download eller ændret synlighed.

## Første milepæl: indlæsning og distribution · 18. oktober 2026

**Skrevet, unit-testet og afprøvet på faktiske lokale pakker og projektfiler på macOS/Apple Silicon. Ikke udgivet.** Denne milepæl indfører eksplicit indlæsning af projektets `AGENTS.md`, særskilte app-/CLI-instruktioner, kontrol af tilpassede skills og referencefiler samt licensmeddelelser og nødvendige kørselsfiler i distributionerne. Detaljer og gentagelige prøver står i [indlæsning og distribution](indlaesning-og-distribution.md).

- **Enhedsprøver:** Den afsluttende fælles desktop-suite består med 281/281 tests, og CLI-suiten består med 25/25. Ingen udeladte eller annullerede tests. Node 22.23.3 er fra repositoryets fastlåste runtime. Den første sandboxkørsel kunne ikke åbne lokale testporte; prøverne blev kørt igen med adgang til 127.0.0.1. En tidlig prøve fandt tegnsætning efter referencehenvisninger og testbiblioteker uden licenstekst; begge forhold er rettet og afprøvet.
- **Faktisk indlæsning:** `test:library-loading` består med rigtig OpenCode 1.18.33 og en kontrolleret lokal modelserver gennem Workbench. Desktop Samtale, desktop Planlæg og CLI Arbejd direkte sender projektregler med kilde og hash. En ændring efter gennemgang afvises før et modelkald; ændrede regler efter en gennemført opgave giver en ny modelsession med det nye indhold. Kun den valgte skill vises, dens faktiske reference læses, og en fravalgt skill afvises. En særskilt test ændrer `AGENTS.md` under motoropstart og beviser, at afsendelsen også stoppes dér.
- **Adgang:** `test:app-skills` består med og uden Git samt i planlægning. Skillreferencer kan læses, valgte private referencer virker, og ikke-valgte private referencer, `.env`, `.git` og fravalgte skills afvises. Denne prøve bruger motoren direkte og undersøger isolation; Workbench-prøven undersøger den eksplicitte indlæsning af projektregler ovenpå.
- **Eksporter:** 23 ZIP-pakker er genereret med licens og oprindelsesmeddelelser. De afsluttende pakkeprøver kontrollerer faktiske filer, kontrolsummer, installation/fjernelse og reproducerbarhed. Den sidste generering blev koordineret med den samtidige Komplai-chat og omfatter dens 16 skills/fire integrationer. Den faktiske OpenCode-ZIP er udpakket i et midlertidigt projekt og kørt i OpenCode 1.18.33: grundregler, skilloversigt, skillindhold og licensfiler består. Andre kodeværktøjers selvstændige indlæsning er ikke nyafprøvet i denne milepæl.
- **Terminal fra kilde og pakke:** Det fulde PTY-forløb består med login, skjult nøgle, krypteret genåbning, plan, bygning, tilladt og afvist filændring, preview, diff, Stop, historik og forbindelsesfejl. Den faktiske modelserver modtager `AGENTS.md` med kilde og CLI-instruktioner frem for desktopknapper. Prøven fandt, at CLI'en overtog desktopstandardens Samtale; CLI'en vælger nu sin dokumenterede Planlæg-standard ved åbning af den historik. Den kontrollerede modelserver afgiver det allerede krævede planformat med fire afsnit.
- **Samlet CLI-prøvepakke:** `/tmp/aura-milepael-pakker.n1bf1L/cli-samlet/aura-harness-0.2.0-beta.6.tgz`, SHA-256 `57b2ee82f27ae3b67bd8b2320f5ac4415e084be161189b88c6599b3873f4a9e4`. Alle 104 arkivfiler er kontrolleret mod kilderne. Manifestet angiver kildecommit `aa6714ad1608972a8260ec6fa3a65cb1933bc2aa` plus lokale ændringer, `dirty: true` og `publishable: false`. Pakken er installeret separat med installationsscripts slået fra og har gennemført det fulde terminalforløb med sin egen OpenCode-motor. Tidligere prøvepakker i samme midlertidige rod er mellemresultater, ikke dette kontrolgrundlag.
- **Electron og Mac-prøveapp:** Det eksisterende chatforløb består fra kilderne og fra den faktiske lokalt pakkede, usignerede Apple Silicon-app. Pakkeprøven bruger rigtig OpenCode, faktiske projektfiler og lokal modelserver og omfatter manuel versionsgemning, plan, filgodkendelse, filændring, browserpreview, skilltilpasning, genåbning og afvist modeladgang. Den udvidede prøve viser projektregler under Se alle oplysninger og kontrollerer, at de når modelserveren. Skærmbilledet `harness-chat-94Cnfm/projektregler.png` i systemets midlertidige mappe er visuelt gennemgået. Der er fortsat kun Send/Annuller som beslutning; kilde og hash ligger i detaljerne.
- **Mac-pakkens kildegrundlag:** `/tmp/aura-milepael-pakker.n1bf1L/desktop-endelig/mac-arm64/Aura.app`. `app.asar` har SHA-256 `a55dbdfc11f595c78009a6285fcf97b21678cd422bf326ce48ecb8ee1a77dbe8`. 121 app-, profil- og licensfiler matcher arbejdsmappen byte for byte; pakkemanifestets navn, version, startfil, produktnavn, licens og runtimeafhængigheder er kontrolleret særskilt, fordi byggesystemet fjerner udviklingsfelter. Ingen kildeforskelle blev fundet. Filkontrolsummerne ligger i `/tmp/aura-milepael-pakker.n1bf1L/mac-kontrolgrundlag.json`. Kildegrundlaget indeholder lokale, ikke committede rettelser; prøven validerer derfor arbejdsmappepakken og kan ikke erklære en fremtidig fjernbygning klar.

**Begrænsninger:** Modelserverne leverer forudbestemte svar og værktøjskald. Prøverne dokumenterer indlæsning, rettigheder, pakning og sammenkobling, ikke en rigtig models selvstændige aktivering af skills eller håndtering af semantiske regelkonflikter. Windows/Linux, fysisk Intel-hardware, betalte modelkald, signering, notarisation og udgivelse er ikke udført her. Der er ikke kørt produktionslogin eller upload som led i denne milepæl. Den samtidige chats Komplai- og sikkerhedsprøver har deres egne afsnit ovenfor.

Evidens: `/tmp/aura-milepael-desktop-final.log`, `/tmp/aura-milepael-cli-final.log`, `/tmp/aura-milepael-loading-final.log`, `/tmp/aura-milepael-app-skills.log`, `/tmp/aura-milepael-export-opencode.log`, `/tmp/aura-milepael-cli-live-new.log`, `/tmp/aura-milepael-cli-samlet-build.log`, `/tmp/aura-milepael-cli-samlet-live.log`, `/tmp/aura-milepael-electron.log`, `/tmp/aura-milepael-packed-electron-rules.log` og `/tmp/aura-milepael-mac-source.log`. Midlertidige filer kan senere blive ryddet af systemet.

Der er ikke oprettet commits, push, branches, tags, PR'er eller GitHub-kørsler i dette repository fra denne chat. Git-versioner i prøverne hører kun til syntetiske, midlertidige projekter. De eksisterende Komplai-ændringer er bevaret, og delte filer og sidste generering er koordineret med den anden chat.
