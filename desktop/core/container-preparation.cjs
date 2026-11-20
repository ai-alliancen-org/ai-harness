// Appens egen vejledning: brugeren behøver kun at bede om Azure Container Apps.
const guidance = `KLARGØRING TIL AZURE CONTAINER APPS:
Når brugeren beder om at gøre projektet klar til Azure Container Apps, skal du selv finde og tilføje de nødvendige containerfiler. Undersøg den eksisterende app først, og bevar dens teknologi, indhold og funktioner. Tilføj en Dockerfile i den valgte byggemappe; COPY-stier skal være inden for byggemappen. Brug projektets eksisterende build, lockfil og server, hvis de findes. Omskriv ikke en fungerende app til en anden teknologi.
Serveren skal lytte på 0.0.0.0 og respektere PORT. Brug den oplyste Azure-målport; for en ny enkel demo uden anden port bruges 8080. Tilføj et /healthz-endpoint med JSON-status, og kør containeren som en bruger uden root-adgang. EXPOSE skal passe til serverens port. Hemmeligheder tilhører runtime-miljøet i Azure, aldrig Dockerfile, build-argumenter eller browserkode.
For en enkel HTML/CSS/JavaScript-app i public/ er standardløsningen server.cjs med Nodes indbyggede HTTP-server og en Dockerfile med Node 24 Alpine, uden ekstra npm-afhængigheder. Bevar public/index.html til Auras statiske forhåndsvisning. Tilpas løsningen til et eksisterende framework i stedet for at påtvinge det dette eksempel.
Klargøring er kun lokale filændringer og relevante kontroller efter de normale godkendelser. I Samtale og Planlæg beskriver du løsningen; filændringer kræver Byg. Opret ikke Azure-ressourcer, ændr ikke adgang, og udgiv ikke fra kommandoværktøjet. Når filerne er klar, kan brugeren gemme en version og vælge Udgiv.`;

function preparationDraft(config, port) {
  const dockerfile = config.directory === '.' ? config.dockerfile : `${config.directory}/${config.dockerfile}`;
  return `Gør projektet klar til Azure Container Apps.\n\nUdgivelsen bruger byggemappen ${JSON.stringify(config.directory)} og Dockerfile ${JSON.stringify(dockerfile)}.${Number.isInteger(port) && port > 0 && port <= 65535 ? ` Azure-appens eksisterende målport er ${port}; serveren skal passe til den og respektere PORT.` : ''}\n\nBevar appens indhold, funktioner og teknologi. Tilføj de manglende containerfiler, og kontrollér resultatet. Opret ikke Azure-ressourcer, og udgiv ikke. Fortæl mig, når jeg kan gemme en version og fortsætte med Udgiv.`;
}
module.exports = { guidance, preparationDraft };
