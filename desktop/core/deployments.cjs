const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { deploymentArtifact } = require('./deployment-artifact.cjs');
const { komplaiSource, buildSaved } = require('./komplai-build.cjs');
const { VercelDeployment, AzureDeployment, publicURL } = require('./deployment-providers.cjs');
const { KomplaiDeployment, validLabel, refusedFiles } = require('./komplai-publish.cjs');
const { PromteDeployment, promteConfiguration, preparePromteArtifact, validatePromteArtifact } = require('./provider-promte.cjs');
const { GitHubPagesDeployment, CloudflarePagesDeployment, pagesConfiguration, validatePagesArtifact, siteURL, fetchSite } = require('./pages-publishing.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const { defaultName } = require('./history.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function relative(value) { if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.startsWith('/')||value.split('/').some(p=>p==='..')||path.posix.normalize(value)!==value) throw Error('Angiv en relativ mappe uden ..'); return value; }
// komplai Run: én app pr. projekt, valgt eller ny. Synlighed vælges hver gang og har ingen standard.
function komplaiConfiguration(input) {
  if(!['public','private'].includes(input.visibility)) throw Error('Vælg, hvem der kan åbne appen.');
  const c={provider:'komplai',mode:'static',directory:relative(input.directory||'public'),visibility:input.visibility,frontend:'.',api:''};
  // En lokal bygning sker kun, når brugeren har valgt den. Uden valget udgives færdige filer som hidtil.
  if(input.build===true) c.build=true;
  if(input.appId) { if(typeof input.appId!=='string'||!UUID.test(input.appId)) throw Error('Vælg en af dine apps hos komplai.'); c.appId=input.appId; return c; }
  const name=typeof input.name==='string'?input.name.trim():'';
  if(!name||name.length>100|| /[\x00-\x1f]/.test(name)) throw Error('Giv appen et navn på højst 100 tegn.');
  c.name=name;
  // komplai kræver, at en ny offentlig app bekræftes med dens navn.
  if(c.visibility==='public') { if(typeof input.confirmPublic!=='string'||input.confirmPublic.trim()!==name) throw Error('Skriv appens navn præcis for at bekræfte, at appen bliver offentlig.'); c.confirmPublic=name; }
  if(input.slug!==undefined) { if(input.slug!==''&&!validLabel(input.slug)) throw Error('Adressen kan ikke bruges. Brug 3 til 40 små bogstaver, tal og bindestreger. Ord som admin og www er reserveret.'); c.slug=input.slug; }
  return c;
}
function configuration(input) {
  if(input?.provider==='komplai') return komplaiConfiguration(input);
  if(input?.provider==='promte') return promteConfiguration(input);
  if(['github-pages','cloudflare'].includes(input?.provider)) return pagesConfiguration(input);
  if(!input||!['vercel','azure'].includes(input.provider)||!['static','source','functions'].includes(input.mode)) throw Error('Vælg en understøttet udbyder og projekttype.');
  if(input.provider==='azure'&&input.mode==='source'||input.provider==='vercel'&&input.mode==='functions') throw Error('Projekttypen understøttes ikke af denne adapter.');
  const c={provider:input.provider,mode:input.mode,directory:relative(input.directory||'public')};
  for(const key of ['scope','project','subscription','group']) { const value=input[key]||''; if(typeof value!=='string'||value.length>200|| /[\x00-\x1f]/.test(value)) throw Error('Ugyldigt destinationsvalg.'); c[key]=value; }
  c.frontend=input.mode==='functions'?relative(input.frontend||'.'):'.'; c.api=input.mode==='functions'?relative(input.api||'api'):'';
  return c;
}
function validateArtifact(c,a) {
  if(c.provider==='promte') return validatePromteArtifact(a);
  if(['github-pages','cloudflare'].includes(c.provider)) return validatePagesArtifact(a);
  const names=a.files.map(f=>f.file), prefix=c.provider==='azure'&&c.frontend!=='.'?c.frontend+'/':'';
  if(c.mode!=='source'&&!names.includes(prefix+'index.html')) throw Error('Den gemte frontendmappe mangler index.html. Byg og gem den rigtige version først.');
  if(c.mode==='static'&&names.some(f=>f==='package.json'||f==='vercel.json'||f==='swa-cli.config.json'||f.startsWith('api/')||f.startsWith('.github/'))) throw Error('Mappen indeholder server- eller buildkonfiguration. Vælg kildekode/Functions, eller vælg den færdigbyggede frontendmappe.');
  if(c.mode==='source') {
    const pkg=a.files.find(f=>f.file==='package.json');
    if(!pkg) throw Error('Kildekode kræver package.json i den valgte mappe.');
    try { JSON.parse(pkg.data); } catch { throw Error('package.json kan ikke læses.'); }
    if(!names.some(f=>['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb'].includes(f))) throw Error('Gem en lockfil sammen med kildekoden, så afhængighederne kan genskabes.');
    const vc=a.files.find(f=>f.file==='vercel.json');
    if(vc) { let parsed; try { parsed=JSON.parse(vc.data); } catch { throw Error('vercel.json kan ikke læses.'); } if(parsed.alias||parsed.env||parsed.build?.env) throw Error('Flyt aliases og hemmelige miljøværdier ud af vercel.json. Testudgivelsen ændrer ikke produktionsadresser.'); }
  }
  if(c.provider==='azure'&&names.some(f=>f==='swa-cli.config.json'||f.startsWith('.github/'))) throw Error('Azure-pakken må ikke indeholde en separat SWA CLI- eller workflowkonfiguration. Vælg en mappe med de færdige filer.');
  if(c.mode==='functions' && (c.frontend==='.' || c.api==='.' || c.api===c.frontend || c.api.startsWith(c.frontend+'/') || c.frontend.startsWith(c.api+'/'))) throw Error('Frontend og Functions skal ligge i forskellige mapper.');
  if(c.mode==='functions'&&!names.includes(c.api+'/host.json')) throw Error('Functions-mappen mangler host.json. API’et skal være færdigbygget og selvstændigt; appen kører ingen lokal npm-installation.');
}
class Deployments {
  constructor(store,{providers,github,fetcher,artifact=deploymentArtifact,builder=buildSaved}={}) { this.store=store; this.providers=providers||{komplai:new KomplaiDeployment(store),vercel:new VercelDeployment(),azure:new AzureDeployment(),promte:new PromteDeployment({store}), 'github-pages':new GitHubPagesDeployment(github), cloudflare:new CloudflarePagesDeployment(github)}; this.fetcher=fetcher||((...args)=>fetch(...args));this.pagesFetcher=fetcher||fetchSite;this.artifact=artifact;this.builder=builder;this.builds=new Map();this.reviews=new Map(); }
  async state(root) { const p=await this.store.project(root); return {config:p.deploymentConfig||null,preference:p.startup?.hosting||'',last:p.deploymentLast||null}; }
  /** Hvad komplai-udgivelsen bruger: projektets gemte opsætning, ellers en gemt byggemappe, en bygning eller public. */
  async source(root) {
    const saved=(await this.store.project(root)).deploymentConfig;
    if(saved?.provider==='komplai'&&saved.directory) return {directory:saved.directory,build:saved.build===true,saved:true};
    return komplaiSource(root);
  }
  async material(root,config) {
    if(config.provider==='komplai'&&config.build) {
      // Den byggede app hører til præcis den gemte version. Gennemgang og upload bruger samme bygning.
      const source=await this.artifact(root,'.'), cached=this.builds.get(root);
      if(cached?.head===source.head&&cached.sourceHash===source.hash) return cached.artifact;
      const artifact=await this.builder(source);
      validateArtifact(config,artifact); this.builds.set(root,{head:source.head,sourceHash:source.hash,artifact});
      return artifact;
    }
    // Git-status, private filer og hemmeligheder kontrolleres før udbyderens filudvalg.
    const source=await this.artifact(root,config.directory);
    const artifact=config.provider==='promte'?preparePromteArtifact(source):source;
    validateArtifact(config,artifact);
    return artifact;
  }
  async review(root,input) {
    const config=configuration(input), artifact=await this.material(root,config);
    if(config.build) config.directory=artifact.directory;
    if(config.provider==='komplai') { const refused=refusedFiles(artifact.files); if(refused.length) throw Error(`komplai Run kan ikke modtage ${refused.length===1?'denne fil':'disse filer'}: ${refused.slice(0,5).join(', ')}${refused.length>5?' …':''}. Filnavne må kun have a-z, tal, bindestreg og punktum, og filtypen skal være en webside, et billede, en skrifttype eller lignende.`); }
    const target=await this.providers[config.provider].inspect(config,artifact);
    const token=randomUUID(); this.reviews.clear(); this.reviews.set(token,{root,config,head:artifact.head,hash:artifact.hash,targetHash:hash(target),expires:Date.now()+300000});
    const project = await this.store.project(root);
    const version = { name: project.versionNames?.[artifact.head] || defaultName(artifact.version?.name || 'Gemt version'), at: artifact.version?.at || null };
    this.reviews.get(token).version = version;
    await this.store.saveProject(root,{deploymentConfig:config});
    const komplai=config.provider==='komplai';
    const pages=['github-pages','cloudflare'].includes(config.provider);
    return {token,config,target,version,head:artifact.head,hash:artifact.hash,bytes:artifact.bytes,files:artifact.files.map(f=>f.file),excludedFiles:artifact.excludedFiles||[],built:artifact.built||null,environment:komplai?'komplai.run':config.provider==='azure'?'harness-test':pages?'production':config.provider==='promte'?'arbejdsområde':'preview',cost:komplai?'Forbruget følger organisationens aftale med komplai.':config.provider==='promte'?'Kræver en betalt aftale med Promte. Forbruget følger organisationens aftale.':'Forbrug og eventuelle omkostninger følger din hostingkonto. Appen har ingen verificeret pris eller automatisk udgiftsgrænse.',build:artifact.built?`Aura byggede appen på din computer fra den gemte version med ${artifact.built.install} og ${artifact.built.script}, uden pakkernes installationsscripts. Kun de færdige filer uploades.`:pages?'Starter én GitHub Actions-kørsel, som kontrollerer version og filer før udgivelse. Ingen automatisk udgivelse ved nye ændringer.':config.mode==='source'?'Udbyderen bygger kildekoden. Kontrollér afhængigheder og miljøværdier før udgivelsen.':'Færdige filer uploades. Der køres ingen projektkommando lokalt.',material:target.materialNote||(komplai&&artifact.built?'De viste filer er bygget fra denne Git-version og sendes til organisationens appmiljø hos komplai. Hemmelighedskontrollen er heuristisk og finder ikke alt.':komplai?'De viste filer fra denne Git-version sendes til organisationens appmiljø hos komplai. Hemmelighedskontrollen er heuristisk og finder ikke alt.':'De viste filer fra denne Git-version sendes til hostingudbyderen. Hemmelighedskontrollen er heuristisk og finder ikke alt.')};
  }
  async settings(root) {
    const {config}=await this.state(root);
    if(!config) throw Error('Gennemgå en destination først.');
    return (await this.providers[config.provider].inspect(config)).portal;
  }
  async deploy(root,token) {
    const r=this.reviews.get(token);this.reviews.delete(token);
    if(!r||r.root!==root||r.expires<Date.now()) throw Error('Gennemgå udgivelsen igen.');
    const a=await this.material(root,r.config), provider=this.providers[r.config.provider], target=await provider.inspect(r.config,a);
    if(a.head!==r.head||a.hash!==r.hash||hash(target)!==r.targetHash) throw Error('Version eller destination har ændret sig. Gennemgå udgivelsen igen.');
    const receipt={config:r.config,target,version:r.version,head:a.head,hash:a.hash,startedAt:new Date().toISOString(),state:'SUBMITTING',id:null,url:null,checks:null,indexHash:r.config.mode!=='source'?a.files.find(f=>f.file===(r.config.provider==='azure'&&r.config.frontend!=='.'?r.config.frontend+'/':'')+'index.html')?.sha256:null};
    const before=(await this.store.project(root)).deploymentLast, trackingBefore=(await this.store.project(root)).deploymentTrackingSource;
    await this.store.saveProject(root,{deploymentLast:receipt,deploymentTrackingSource:'manual'});
    // En ny komplai-app gemmes straks, så et nyt forsøg opdaterer den samme app i stedet for at oprette endnu en.
    const onCreated=async appId=>{ receipt.appId=appId; await this.store.saveProject(root,{deploymentConfig:{...r.config,appId,name:undefined,slug:undefined},deploymentLast:receipt}); };
    const onUploaded=async result=>{ Object.assign(receipt,result); await this.store.saveProject(root,{deploymentLast:receipt}); };
    try { Object.assign(receipt,await provider.deploy(r.config,a,target,{onCreated,onUploaded})); }
    catch(error) {
      // Udbyderen sagde tydeligt, at intet er uploadet (fx komplai med travlt). Så er der ingen uvis upload, og den tidligere kvittering bevares.
      if(!receipt.id&&error?.notUploaded===true){ await this.store.saveProject(root,{deploymentLast:before,deploymentTrackingSource:trackingBefore}); throw Error(error.message); }
      if(receipt.id) {
        if(r.config.provider==='promte'&&receipt.state==='PREPARED') receipt.verification='Versionen er oprettet hos Promte, men upload er ikke bekræftet. Kontrollér versionen i Promte før et nyt forsøg.';
        else if(r.config.provider==='promte'&&receipt.state==='UPLOADED') receipt.verification='Promte har modtaget filerne, men den videre behandling er ikke bekræftet. Kontrollér versionen i Promte.';
        else if(r.config.provider==='komplai'&&receipt.state==='UPLOADED') receipt.verification='Filerne er modtaget hos komplai. Den efterfølgende status kunne ikke hentes. Kontrollér status før en ny upload.';
        else if(['github-pages','cloudflare'].includes(r.config.provider)&&receipt.state==='SUBMITTING') receipt.verification='Starten af GitHub-kørslen er ikke bekræftet. Kontrollér status før et nyt forsøg.';
        else receipt.verification='Handlingen er registreret, men resultatet er ikke bekræftet. Kontrollér status hos udbyderen, før du prøver igen.';
      }
      else if(before?.id&&before.state==='READY'&&(!receipt.appId||receipt.appId===before.appId)&&before.config?.provider===r.config.provider) {
        // Den sidste kvittering for en side, der er live, overskrives aldrig med UNKNOWN. Kun en note om det uklare forsøg tilføjes.
        await this.store.saveProject(root,{deploymentLast:{...before,verification:'Et nyt forsøg blev ikke bekræftet. Den tidligere udgivelse står uændret. Kontrollér udbyderens oversigt før et nyt forsøg.'},deploymentTrackingSource:trackingBefore});
        throw Error('Udgivelsen blev ikke bekræftet. Kontrollér udbyderens oversigt før et nyt forsøg. Dit lokale projekt er bevaret.');
      }
      else { receipt.state='UNKNOWN'; await this.store.saveProject(root,{deploymentLast:receipt}); throw Error('Udgivelsen blev ikke bekræftet. Kontrollér udbyderens oversigt før et nyt forsøg. Dit lokale projekt er bevaret.'); }
    }
    await this.store.saveProject(root,{deploymentLast:receipt});
    // komplai: en upload er ikke en udgivelse, før brugeren selv har trykket Kontrollér. Aura henter aldrig adressen af sig selv.
    return receipt;
  }
  async saveCheck(root,expected,receipt) {
    const apply=project=>{
      if(!project.deploymentLast||hash(project.deploymentLast)!==expected) return false;
      project.deploymentLast=structuredClone(receipt); return true;
    };
    // Sammenligning og skrivning sker i samme kø som uploadens kvitteringer.
    if(this.store.update&&this.store.projectKey) return this.store.update(state=>{
      const project=state.projects[this.store.projectKey(root)];
      return project?apply(project):false;
    });
    // Små, injicerede testlagre kan nøjes med den eksisterende project-kontrakt.
    const project=await this.store.project(root);
    if(!apply({...project})) return false;
    await this.store.saveProject(root,{deploymentLast:structuredClone(receipt)}); return true;
  }
  async check(root) {
    let receipt=(await this.store.project(root)).deploymentLast;
    if(!receipt?.id) throw Error('Der er ingen kendt udgivelse at kontrollere. Se udbyderens oversigt ved ukendt uploadresultat.');
    let expected=hash(receipt);
    const save=async()=>{if(!await this.saveCheck(root,expected,receipt))return false;expected=hash(receipt);return true;};
    const latest=async()=>{const current=(await this.store.project(root)).deploymentLast;if(!current)throw Error('Udgivelsen er ændret. Kontrollér igen.');return current;};
    const at = new Date().toISOString();
    // En ny kontrol erstatter den gamle evidens, også når den fejler.
    receipt = { ...receipt, checkedAt: at, checks: { id: randomUUID(), at, provider: { status: 'unknown' }, site: { status: 'skipped' }, content: { status: 'skipped' } }, verification: 'Udbyderens status kunne ikke kontrolleres. Se oversigten hos udbyderen.' };
    if(!await save()) return latest();
    try {
      const result = await this.providers[receipt.config.provider].status(receipt.config, receipt);
      Object.assign(receipt, result);
      receipt.checks.provider = { status: 'checked', state: receipt.state, ...(receipt.config.provider === 'komplai' && ['public','private'].includes(result.visibility) ? { visibility: result.visibility } : {}) };
      receipt.verification = 'Udbyderens status er kontrolleret; siden er endnu ikke verificeret.';
    } catch {
      if(!await save()) return latest();
      return receipt;
    }
    if (receipt.state === 'READY' && receipt.url) {
      try {
        if(['github-pages','cloudflare'].includes(receipt.config.provider)) siteURL(receipt.url);
        else publicURL(receipt.url, { vercel: '.vercel.app', azure: '.azurestaticapps.net', komplai: '.komplai.run' }[receipt.config.provider]);
        const request=['github-pages','cloudflare'].includes(receipt.config.provider)?this.pagesFetcher:this.fetcher;
        const response = await request(receipt.url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(15000) });
        receipt.checks.site = { status: 'answered', http: response.status };
        if (!response.ok) await response.body?.cancel();
        if ((response.status === 401 || response.status === 403) && receipt.config.provider === 'komplai' && receipt.checks.provider.visibility === 'private') receipt.verification = 'Appen kræver login med komplai. Åbn linket og log ind for at se den.';
        else if (response.status === 401 || response.status === 403) receipt.verification = 'Siden kræver adgang. Åbn linket med din konto og gennemgå appen.';
        else if (response.status >= 300 && response.status < 400) receipt.verification = 'Siden viderestiller. Åbn linket og kontrollér adgang og indhold.';
        else if (!response.ok) receipt.verification = `Siden svarede med HTTP ${response.status}.`;
        else if (receipt.indexHash) {
          const reader = response.body.getReader(); let total = 0; const chunks = [];
          for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 2 * 1024 * 1024) { await reader.cancel(); receipt.checks.content = { status: 'too-large' }; throw Error(); } chunks.push(value); }
          const matches = createHash('sha256').update(Buffer.concat(chunks)).digest('hex') === receipt.indexHash;
          receipt.checks.content = { status: matches ? 'matched' : 'different' };
          receipt.verification = matches ? 'Startsiden svarer og matcher den godkendte fil. Øvrige brugerrejser skal gennemgås.' : 'Siden svarer, men indholdet matcher ikke den godkendte startside. Kontrollér udgivelsen.';
        } else { await response.body?.cancel(); receipt.checks.content = { status: 'built' }; receipt.verification = 'Siden svarer med HTTP 200–299. Backend, login og øvrige brugerrejser skal stadig gennemgås.'; }
      } catch {
        if (receipt.checks.site.status !== 'answered') receipt.checks.site = { status: 'unreachable' };
        else if (receipt.checks.content.status !== 'too-large') receipt.checks.content = { status: 'unreadable' };
        receipt.verification = 'Testadressen kunne ikke verificeres. Åbn linket og kontrollér udgivelsen.';
      }
    }
    if(!await save()) return latest();return receipt;
  }
}
module.exports={Deployments,configuration,validateArtifact};
