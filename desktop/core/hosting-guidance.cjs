// Integrationskrav kontrolleret 20. oktober 2026. Kundens aftale og opsætning vurderes særskilt.
const checkedAt = '2026-10-20';
const options = [
  {
    id: 'vercel', name: 'Vercel', integrated: true,
    summary: 'Amerikansk leverandør. Global levering af frontend; backendens region vælges i projektet.',
    scope: 'Aura forbinder til et eksisterende Vercel-projekts GitHub-integration og viser dets udgivelsesstatus. Vercel bygger de versioner, du pusher.',
    data: 'En EU-region for funktioner omfatter ikke automatisk CDN, logs, support og andre tjenester. Kontrollér projektets databehandleraftale, underleverandører og adgangsbeskyttelse.',
    steps: ['Installér Vercel CLI, og vælg Log ind i browseren under Vercel i Aura.', 'Vælg team og et projekt med GitHub-forbindelse. Hvis forbindelsen mangler, åbner guiden Vercels importforløb, hvor du vælger repository og byggeopsætning.', 'Gennemgå og gem forbindelsen i projektet. Commit og push selv med dit Git-værktøj. Vercel bygger efter sine Git-regler; et push til produktionsbranchen kan opdatere den offentlige app. Kontrollér status og adgang bagefter.'],
    links: { guide: 'https://vercel.com/docs/git/vercel-for-github', data: 'https://vercel.com/legal/dpa', region: 'https://vercel.com/docs/regions' }
  },
  {
    id: 'azure', name: 'Azure Static Web Apps', integrated: true,
    summary: 'Microsoft. Frontend leveres globalt; en EU-region til API’et er ikke det samme som udelukkende EU-behandling.',
    scope: 'Aura kan udgive en frontend og eventuelt et færdigbygget Node.js Functions-API til et eksisterende testmiljø.',
    data: 'Kontrollér Microsofts databehandleraftale, abonnementets konfiguration, logs og eventuelle tilknyttede tjenester. Et testmiljø er ikke automatisk adgangsbeskyttet.',
    steps: ['Installér Azure CLI og SWA CLI. Vælg Log ind i browseren under Azure i Aura, og log ind med din Microsoft-konto.', 'Vælg dit abonnement og en eksisterende Static Web App fra listerne. Hvis der ingen app er, åbner guiden Azure-portalen. Aftal region og adgang med den ansvarlige.', 'Gennemgå opsætningen, og gem den i projektet. Gem derefter en version og udgiv til harness-test. Det erstatter tidligere indhold i dette testmiljø.'],
    links: { guide: 'https://learn.microsoft.com/en-us/azure/static-web-apps/getting-started', data: 'https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA', region: 'https://learn.microsoft.com/en-us/azure/static-web-apps/faq' }
  },
  {
    id: 'cloudflare', name: 'Cloudflare Pages', integrated: true,
    summary: 'Amerikansk leverandør. Statiske sider distribueres på et globalt netværk.',
    scope: 'Aura starter et gennemgået manuelt GitHub-workflow, som udgiver færdige frontendfiler til dit eksisterende Cloudflare Pages-projekt.',
    data: 'EU-behandling er ikke garanteret af Pages-navnet eller en gratis konto. Gennemgå databehandleraftale, besøgslogs og adgang til siden.',
    steps: ['Forbind GitHub i Aura, og vælg repository, branch og mappe med den færdige hjemmeside. Vælg eller opret selv et Pages-projekt hos Cloudflare; angiv kontoens ID og projektnavn.', 'Gem et Cloudflare-token med Account → Cloudflare Pages → Edit for den valgte konto som CLOUDFLARE_API_TOKEN i GitHubs Actions secrets. Projektets produktionsbranch skal matche valget. Automatiske Cloudflare-udgivelser skal være slået fra.', 'Gennemgå og gem opsætningen i projektet, og commit og push selv. Kontrollér opsætningen igen. Udgiv starter én GitHub-kørsel for den gennemgåede version; den kontrollerer filer og destination før upload.'],
    links: { guide: 'https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/', data: 'https://www.cloudflare.com/cloudflare-customer-dpa/' }
  },
  {
    id: 'netlify', name: 'Netlify Drop', integrated: false,
    summary: 'Amerikansk leverandør. Til udgivelse af færdigbyggede sider på et globalt netværk.',
    scope: 'Manuel upload hos Netlify. Byg React/Astro først; en Python-backend følger ikke med en mappe med frontendfiler.',
    data: 'Kontrollér adgangsbeskyttelse og kontoens databehandleraftale. Netlify Drop er ikke en garanti for behandling alene i EU.',
    steps: ['Byg siden lokalt, og find outputmappen med index.html. Fjern hemmeligheder og private data fra de offentlige filer.', 'Log ind på den konto, der skal eje siden, og brug Netlifys manuelle upload.', 'Upload outputmappen, og åbn det nye link. Kontrollér hvem der kan se siden, og hvordan næste version uploades.'],
    links: { guide: 'https://docs.netlify.com/deploy/create-deploys/', data: 'https://www.netlify.com/trust-center/' }
  },
  {
    id: 'github-pages', name: 'GitHub Pages', integrated: true,
    summary: 'GitHub / Microsoft. Til statiske hjemmesider; ingen Python- eller Node-backend.',
    scope: 'Aura gennemgår og starter et manuelt GitHub-workflow for den gemte frontend. Der køres ingen projektkommandoer eller backend.',
    data: 'Et privat repository gør ikke nødvendigvis Pages-siden privat. EU-behandling er ikke verificeret her. Gennemgå den aftale og de adgangsmuligheder, der gælder for jeres konto.',
    steps: ['Forbind GitHub i Aura, og vælg repository, branch og mappe med den færdige hjemmeside. Vælg GitHub Actions som kilde under Settings → Pages.', 'Gennemgå og gem opsætningen i projektet. Commit og push selv med dit Git-værktøj. Det manuelle workflow skal også findes på repositoryets standardbranch.', 'Kontrollér opsætningen igen, gennemgå versionen og vælg Udgiv. Det starter én GitHub-kørsel. Afprøv den viste adresse, billeder og navigation, også hvis siden ligger under /repository-navn/.'],
    links: { guide: 'https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages', data: 'https://github.com/customer-terms/github-data-protection-agreement' }
  },
  {
    id: 'komplai', name: 'komplai Run', integrated: true,
    summary: 'Færdige hjemmesider på komplai.run. Kræver komplai-konto.',
    scope: 'Aura udgiver færdige filer (en mappe med index.html) direkte efter login med komplai. Der kræves ingen CLI. Ved en ny app vælger du adresse og adgang. En eksisterende apps adgang ændres i komplai.',
    data: 'Filerne gemmes i organisationens appmiljø hos komplai (Hetzner, Tyskland). Appen kører i den besøgendes browser; serverkode køres ikke. Adgang er enten organisationens medlemmer efter login med komplai eller alle med linket.',
    steps: ['Log ind med komplai i Udgiv, og forbind organisationen.', 'Vælg en ny app med navn, adresse og adgang, eller en af dine eksisterende apps. Eksisterende adgang bevares og kan ændres i komplai.', 'Gennemgå versionen, og udgiv. Ældre versioner, tilbagerulning og sletning håndteres i komplai under Run.'],
    links: { guide: 'https://komplai.dk/publish' }
  },
  {
    id: 'promte', name: 'Promte Apps', integrated: true,
    summary: 'Apps i jeres Promte-arbejdsområde, fx på kodning.promte.dk. Kræver konto, betalt aftale og administratoradgang.',
    scope: 'Aura logger ind gennem Promte i browseren og uploader en gennemgået React-kildepakke til en app, du vælger eller opretter. Der kræves ingen CLI. Promte bygger og gennemgår den efter sin faste byggeopsætning. Den valgte Promte-installation skal understøtte kildekodeupload.',
    data: 'Aftal databehandling, AI-modtagere, adgang og drift med Promte og jeres administrator. Produktets sikkerhedsbeskrivelse er ikke en godkendelse af den app, I bygger.',
    steps: ['Vælg organisationens Promte-adresse i Aura, fx https://kodning.promte.dk. Log ind i browseren, og godkend Aura.', 'Vælg en af dine apps, eller opret en ny. Følg Promte-skillens byggeregler, og gem koden som en version.', 'Gennemgå filerne og de udeladte bygge- og værktøjsfiler. Udgiv til Promtes bygning og gennemgang. Følg den konkrete versions status, og afprøv appen i Promte med den tilsigtede bruger.'],
    links: { guide: 'https://app.promte.dk/docs/admin/udvikl-apps-med-kodeagenter', data: 'https://docs.promte.com/GDPR-hosting-og-databehandling-1a79a6ea8b0a80e2bc04f4e2b41bab42' }
  }
];
function catalog() { return options.map(option => ({ ...option, checkedAt })).sort((a, b) => a.name.localeCompare(b.name, 'da')); }
function link(id, kind) {
  const option = options.find(item => item.id === id);
  if (!option || !['guide', 'data', 'region'].includes(kind) || !option.links[kind]) throw Error('Denne hostingvejledning findes ikke.');
  return option.links[kind];
}
function guidance(enabled) {
  const entry = enabled ? 'Auras knap Udgiv står øverst i projektet og åbner valget mellem Udgiv fra Aura og Se udgivelsesvejledning. Ingen udbyder anbefales eller vælges på forhånd. Den findes; bed ikke brugeren undersøge, om appen har en Udgiv-knap.' : 'Udgivelse er slået fra. Brugeren kan slå den til med Udgiv → Slå udgivelse til eller under Indstillinger → Funktioner. Forklar gerne mulighederne, men udgiv ikke.';
  // De generelle værn gælder altid, også når Udgiv er slået fra. Udbyderdetaljerne sendes kun, når Udgiv er slået til;
  // ellers er de bare vægt i hver besked.
  const guards = 'Afklar frontend, backend, database, AI-modtagere og adgang før valg. Almindelige Python/Node-servere kan ikke udgives som statiske filer. Sikkerhedskopi til GitHub udgiver ikke i sig selv et applink; et repository med tilsluttet hosting kan dog udløse udgivelse ved push.\nOplys ikke, at hosting er gratis eller udelukkende i EU uden at kontrollere de aktuelle vilkår og den konkrete opsætning. Region, leverandørens hjemland, CDN, logs og databehandleraftale er forskellige forhold. Brugeren godkender upload, adgang og omkostninger; du må ikke udgive fra agentens kommandoværktøj.';
  if (!enabled) return `${entry}\n${guards}`;
  return `${entry}\nIntegrerede udgivelsesveje, alfabetisk: Azure Static Web Apps, Cloudflare Pages, GitHub Pages, komplai Run, Promte Apps og Vercel. Netlify Drop har vejledning, men ingen uploadintegration.\nAzure bruger browserlogin gennem Azure CLI og viser abonnementer og eksisterende Static Web Apps; SWA CLI udgiver efter gennemgang til harness-test. komplai Run kræver komplai-konto. Promte Apps kræver konto og betalt aftale. komplai modtager færdige frontendfiler. Promte modtager kildekode gennem den officielle app-upload-kontrakt og kræver administratoradgang til app-arbejdsområdet.\nCloudflare Pages og GitHub Pages bruger manuelle GitHub-workflows. Aura kan efter særskilt gennemgang skrive opsætningen lokalt. Brugeren committer og pusher selv. Før Udgiv skal workflow og gemt Git-version matche GitHub; Udgiv starter én konkret kørsel. Cloudflares token gemmes i GitHubs Actions secrets, aldrig i projektet. Vercel bruger projektets eksisterende Git-integration, hvor push kan udgive automatisk, og Aura viser status. Aura kan også efter gennemgang uploade den gemte version som én testversion (preview) til et eksisterende Vercel-projekt; det udgiver aldrig til produktion.\n${guards}`;
}
module.exports = { catalog, link, guidance };
