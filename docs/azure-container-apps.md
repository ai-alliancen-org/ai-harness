# Azure Container Apps i Aura

Aura har en særskilt **Azure Container Apps**-mulighed i **Udgiv → Andre udbydere**.
Den bygger projektets gemte Dockerfile i Azure Container Registry (ACR) og udgiver
det færdige image til en eksisterende Container App. Det kan bruges til både en
webside og en app med sin egen HTTP-backend.

## Opsætning i Azure

Første version bruger eksisterende ressourcer. Opret en særskilt demo- eller
testapp med:

- Én container, ingen init-containere og revisionstilstanden **Single**.
- Ekstern HTTP-adgang, en `azurecontainerapps.io`-adresse og en målport, der matcher
  appens server. Aura ændrer ikke port, adgang, skalering eller miljøvariabler.
- Én ACR i samme abonnement. Forbind appen til registry med managed identity og
  den nødvendige pull-adgang. Registry-adgangskoder understøttes ikke i dette flow.
- Et Azure CLI-login, som kan læse app og registry, køre ACR builds, læse image-
  metadata og opdatere Container App'en.

Installér Azure CLI og udvidelsen med `az extension add --name containerapp`.
Log ind på det ønskede Azure-abonnement. Aura kan også starte browserlogin.
SWA CLI og en lokal Docker-daemon er ikke nødvendige for denne udgivelsesform.

ACR skal tillade ARM audience tokens til managed identity. Microsoft beskriver
forbindelsen og pull-rollen i [vejledningen om managed identity](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).
Bygningen bruger [ACR quick build](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest#az-acr-build).

## Udgiv fra Aura

1. Vælg **Byg**, og skriv **Gør projektet klar til Azure Container Apps**.
   Auras indbyggede vejledning beskriver Dockerfile, server, port, sundhedstjek
   og tilpasning til projektets eksisterende teknologi for AI'en.
2. Gem en version i Aura. Byggemappen skal kun indeholde materiale, der må sendes
   til Azure. Uploaden bruger Git-versionen og Auras almindelige fil- og
   hemmelighedskontrol. Grænsen er 2.000 filer, 2 MB pr. fil og 20 MB samlet.
3. Vælg **Azure Container Apps**, abonnement og den særskilte app.
4. Vælg byggemappen, normalt `.`, og Dockerfile-stien inde i den mappe,
   normalt `Dockerfile`.
5. Gennemgå version, filer, destination og build. **Byg og udgiv container**
   erstatter appens aktive version på dens eksisterende adresse.
6. Kontrollér kvitteringen. Aura matcher revisionen med det præcise image-digest
   og bekræfter først udgivelsen, når Azure melder den aktive revision klar.

Under udgivelsen viser Aura det aktuelle trin og tiden siden start: kontrol af
versionen, containerbygning, aktivering og gemning af kvitteringen. Trinnene
følger de faktiske kald; tiden er ikke et estimat for, hvornår Azure er færdig.
**Kontrollér status og startside** viser straks en spinner og **Kontrollerer …**.
Resultatet bliver stående som **Ja, startsiden svarer**, en forklaring om at
appen ikke er klar endnu, et fejlsvar eller et krav om adgang. Et svar fra
startsiden beviser ikke, at appens øvrige funktioner virker.

Mangler Dockerfile i den gemte byggemappe, viser Udgiv **Gør klar med AI**.
Knappen lægger et forslag i samtalens skrivefelt i **Byg**, med den valgte
byggemappe, Dockerfile-sti og Azure-appens målport, når den kan læses. Gennemgå
forslaget, og tryk **Send**. En eksisterende kladde bevares. Gem en version efter
AI'ens ændringer, og gennemgå udgivelsen igen.

ACR bygger et Linux/amd64-image med netadgang. Dockerfile kan hente pakker og køre
buildkommandoer. Den nye kode bruger appens eksisterende runtime-værdier og
managed identity. Disse værdier sendes ikke som build-argumenter. For shell-
startscripts er `RUN chmod +x ...` i Dockerfile en mulighed på tværs af platforme.

Aura kontrollerer destinationen igen efter bygningen. Hvis indstillingerne er
ændret, stopper opdateringen og kræver en ny gennemgang. En ukendt opdateringsstatus
bevarer kvitteringen, så udfaldet kan kontrolleres uden automatisk genudgivelse.
Bygninger og drift følger Azure-kontoens priser og begrænsninger.

## Mødelokalefinder som container

Kopiér `scripts/azure-container-demo/Dockerfile` og `server.cjs` til roden af
projektet med den genererede `public/`-mappe. Gem de to filer som en ny version,
og udgiv med byggemappen `.`. Eksemplet bruger en Node-server uden ekstra
afhængigheder, kører som brugeren `node` og lytter på port 8080. `/healthz`
returnerer en enkel status. Azure OpenAI-nøglen indgår ikke i containeren.

Et lokalt Linux/amd64-build af eksemplet bestod. Den kørende container svarede med samme
startside som Git-versionen, gav HTTP 200 fra `/healthz`, kørte som UID 1000 og
afviste POST og stiudbrud. Prøvecontaineren blev stoppet bagefter.

## Gennemført liveprøve 19. november 2026

Mødelokalefinderen blev bygget og udgivet fra Aura til en særskilt
Container App i et ikke-produktionsabonnement. Appen hentede sit image fra ACR
med en brugeradministreret identitet med `AcrPull`. Azure meldte buildet
gennemført og revisionen klar. Den aktive revision brugte det forventede image.
Startsiden, CSS og JavaScript svarede med HTTP 200 og matchede den gemte
Git-version byte for byte. `/healthz` svarede med HTTP 200 og `status: ok`.
Chrome viste alle seks lokaler, og søgning og kapacitetsfilter gav de
forventede resultater.

## Kontrolleret lokalt

19. november 2026 bestod den samlede desktopprøvepakke med 1.598 tests. Efter den
sidste ændring af de unikke build-tags bestod 18 målrettede tests. Den eksisterende
Electron-prøve af udgivelsesvalg bestod også med alle syv udbydere og uden
layoutoverløb på de kontrollerede skærme. De nye prøver dækker valg af udbyder,
abonnement og app, gemt Dockerfile, gennemgang, ACR-build, image-digest,
destinationsændringer, fejlede builds, ukendt uploadstatus og den præcise aktive
revision. Azure-svar i de automatiske udgivelsesprøver er kontrollerede testsvar;
den særskilte liveprøve ovenfor verificerer desuden det faktiske Azure-build,
udgivelsen fra Aura og den offentlige app i Chrome.

20. november 2026 blev den korte klargøringsanmodning og **Gør klar med AI**
tilføjet. Den samlede desktopprøvepakke bestod med 1.604 tests. Forslaget blev
kontrolleret gennem den faktiske IPC-fejlhåndtering og udgivelses-UI, inklusive
valgt mappe, målport og manuel Send. Lokale strømfejl reproducerede et falsk
netfejlkort efter modtagerens afslutning og et manglende genforsøg efter tidlige
HTTP-headers. Rettelserne bestod; den rigtige agentmotor gennemførte også
automatisk genforsøg mod en lokal syntetisk modelserver.
