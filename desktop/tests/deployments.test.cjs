const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {Deployments,configuration,validateArtifact}=require('../core/deployments.cjs');
const {VercelDeployment,AzureDeployment,publicURL}=require('../core/deployment-providers.cjs');
const data=Buffer.from('<h1>Testversion</h1>');
const artifact={head:'a'.repeat(40),hash:'fingeraftryk',bytes:data.length,files:[{file:'index.html',data,sha256:createHash('sha256').update(data).digest('hex')}]};
const config={provider:'vercel',mode:'static',directory:'public',scope:'testteam',project:'testprojekt'};
function fixture(){let state={},uploads=0;const store={project:async()=>state,saveProject:async(root,patch)=>Object.assign(state,patch)};const provider={inspect:async()=>({id:'projekt',name:'Test',settings:{}}),deploy:async()=>{uploads++;return {id:'dpl_test',state:'QUEUED'};},status:async()=>({state:'READY',url:'https://test.vercel.app'})};return {deployments:new Deployments(store,{artifact:async()=>artifact,providers:{vercel:provider},fetcher:async()=>new Response(data)}),provider,state,uploads:()=>uploads};}
test('engangsgennemgang og verificering af godkendt indhold',async()=>{const f=fixture(),r=await f.deployments.review('/test',config);assert.equal(f.uploads(),0);await f.deployments.deploy('/test',r.token);await assert.rejects(f.deployments.deploy('/test',r.token),/igen/);assert.equal(f.uploads(),1);assert.match((await f.deployments.check('/test')).verification,/matcher/);});
test('ændret version, destination, udløb eller andet projekt stopper upload',async()=>{for(const change of ['version','destination','udløb','projekt']){const f=fixture(),r=await f.deployments.review('/test',config);if(change==='version')f.deployments.artifact=async()=>({...artifact,head:'ny'});if(change==='destination')f.provider.inspect=async()=>({id:'andet'});if(change==='udløb')f.deployments.reviews.get(r.token).expires=0;await assert.rejects(f.deployments.deploy(change==='projekt'?'/andet':'/test',r.token),/igen/);assert.equal(f.uploads(),0);}});
test('ukendt upload gentages ikke; login og forkert indhold vises tydeligt',async()=>{const f=fixture();f.provider.deploy=async()=>{throw Error('hemmelig leverandørfejl');};const r=await f.deployments.review('/test',config);await assert.rejects(f.deployments.deploy('/test',r.token),/ikke bekræftet/);assert.equal(f.state.deploymentLast.state,'UNKNOWN');assert.equal(JSON.stringify(f.state).includes('hemmelig'),false);await assert.rejects(f.deployments.check('/test'),/ingen kendt/);f.state.deploymentLast.id='dpl_test';f.deployments.fetcher=async()=>new Response('Login',{status:401});assert.match((await f.deployments.check('/test')).verification,/kræver adgang/);f.deployments.fetcher=async()=>new Response('Anden side');assert.match((await f.deployments.check('/test')).verification,/matcher ikke/);});
test('projekttype og færdigbyggede filer valideres',()=>{assert.throws(()=>configuration({...config,provider:'azure',mode:'source'}),/ikke/);assert.throws(()=>configuration({...config,directory:'../privat'}),/relativ/);const files=names=>({files:names.map(file=>({file,data:Buffer.from('{}')}))});assert.throws(()=>validateArtifact(config,files(['index.html','package.json'])),/buildkonfiguration/);assert.throws(()=>validateArtifact({...config,mode:'source'},files(['package.json'])),/lockfil/);validateArtifact({...config,mode:'source'},files(['package.json','package-lock.json']));assert.throws(()=>validateArtifact({...config,provider:'azure',mode:'functions',frontend:'public',api:'api'},files(['public/index.html'])),/host.json/);});
test('Vercel bruger preview uden projektændringer og afviser skjulte buildindstillinger',async()=>{const calls=[];const provider=new VercelDeployment(async(exe,args,options)=>{calls.push({args,options});return JSON.stringify({id:'dpl_test',url:'test.vercel.app'});});await provider.deploy(config,artifact,{id:'prj_test',name:'test'});const body=JSON.parse(calls[0].options.input);assert.equal(body.target,undefined);for(const key of ['projectSettings','alias','gitSource'])assert.equal(body[key],undefined);assert.equal(Buffer.from(body.files[0].data,'base64').toString(),data.toString());const configured=new VercelDeployment(async(exe,args)=>JSON.stringify(args[1].startsWith('/v6/')?{deployments:[{target:'production',state:'READY'}]}:{id:'p',name:'test',buildCommand:'npm run build'}));await assert.rejects(configured.inspect(config),/buildindstillinger/);for(const url of ['https://example.org','https://test.vercel.app.evil.org','https://user:pass@test.vercel.app','https://test.vercel.app/path'])assert.throws(()=>publicURL(url,'.vercel.app'));});
test('Azure uploader snapshot og holder nøglen ude af argumenter og kvittering',async()=>{let temporary,sawUpload=false;const provider=new AzureDeployment(async(exe,args,options)=>{if(args.includes('secrets'))return JSON.stringify({properties:{apiKey:'syntetisk-nøgle'}});assert.equal(args[0],'deploy');assert.equal(args[args.indexOf('--env')+1],'harness-test');assert.ok(args.includes('--no-use-keychain'));assert.equal(args.join(' ').includes('syntetisk-nøgle'),false);assert.equal(options.extra.SWA_CLI_DEPLOYMENT_TOKEN,'syntetisk-nøgle');temporary=options.cwd;assert.equal(await fs.readFile(args[1]+'/index.html','utf8'),data.toString());sawUpload=true;return '';});const result=await provider.deploy({project:'test',subscription:'sub',group:'group',frontend:'.'},artifact);assert.ok(sawUpload);assert.equal(JSON.stringify(result).includes('nøgle'),false);await assert.rejects(fs.stat(temporary),{code:'ENOENT'});});

test('Vercel uden startversion afvises inden nogen upload',async()=>{let calls=0;const provider=new VercelDeployment(async()=>{calls++;return JSON.stringify({id:'p',name:'test',targets:{}});});await assert.rejects(provider.inspect(config),/første udgivelse/);assert.equal(calls,2);});
test('Azure accepterer ikke en gammel testudgivelse som resultatet af ny upload',async()=>{
 let lastUpdatedOn='2026-09-23T10:00:00Z';
 const provider=new AzureDeployment(async()=>JSON.stringify([{buildId:'harness-test',status:'Ready',hostname:'test.azurestaticapps.net',lastUpdatedOn}]));
 const c={project:'test',subscription:'sub',group:'group'},receipt={startedAt:'2026-09-24T10:00:00Z'};
 assert.equal((await provider.status(c,receipt)).state,'AWAITING_UPDATE');lastUpdatedOn='2026-09-24T10:01:00Z';assert.equal((await provider.status(c,receipt)).state,'READY');
});
test('Azure finder SWAs faktiske miljønavn efter fjernet bindestreg og bruger testadressen',async()=>{
 const observed=[
  {buildId:'default',name:'default',status:'WaitingForDeployment',hostname:'yellow-bush-08813f903.4.azurestaticapps.net',lastUpdatedOn:'2026-10-23T00:02:19.408277+00:00'},
  {buildId:'harnesstest',name:'harnesstest',status:'Ready',hostname:'yellow-bush-08813f903-harnesstest.westeurope.4.azurestaticapps.net',lastUpdatedOn:'2026-10-23T00:12:45.915833+00:00'},
 ];
 const provider=new AzureDeployment(async()=>JSON.stringify(observed));
 const c={project:'test',subscription:'sub',group:'group'},receipt={startedAt:'2026-10-23T00:12:00Z'};
 assert.deepEqual(await provider.status(c,receipt),{state:'READY',url:'https://yellow-bush-08813f903-harnesstest.westeurope.4.azurestaticapps.net'});
 assert.equal((await provider.status(c,{startedAt:'2026-10-23T00:13:00Z'})).state,'AWAITING_UPDATE');
 observed[1].buildId='other'; observed[1].name='other';
 assert.equal((await provider.status(c,receipt)).state,'AWAITING_UPDATE','Et andet miljø må ikke blive kvittering for vores upload');
});

test('hver kontrol erstatter gammel evidens; fejl og adgang lover ikke en fungerende app', async () => {
 const f=fixture(),r=await f.deployments.review('/test',config);await f.deployments.deploy('/test',r.token);
 let checked=await f.deployments.check('/test');assert.equal(checked.checks.content.status,'matched');
 f.provider.status=async()=>{throw Error('privat token i fejl');};checked=await f.deployments.check('/test');
 assert.equal(checked.checks.provider.status,'unknown');assert.equal(checked.checks.content.status,'skipped');assert.equal(JSON.stringify(checked).includes('privat token'),false);
 f.provider.status=async()=>({state:'BUILDING'});checked=await f.deployments.check('/test');assert.equal(checked.checks.site.status,'skipped');
 f.provider.status=async()=>({state:'READY',url:'https://test.vercel.app'});
 for(const status of [401,403,302,500]){f.deployments.fetcher=async(_url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);return new Response('Privat side',{status});};checked=await f.deployments.check('/test');assert.equal(checked.checks.site.http,status);assert.equal(checked.checks.content.status,'skipped');assert.ok(!JSON.stringify(checked).includes('Privat side'));}
 f.deployments.fetcher=async()=>{throw Error('netværksfejl');};checked=await f.deployments.check('/test');assert.equal(checked.checks.site.status,'unreachable');assert.equal(f.uploads(),1);
});
test('indholdskontrollen skelner filmatch, bygget kildekode og for stort svar', async()=>{
 const f=fixture(),r=await f.deployments.review('/test',config);await f.deployments.deploy('/test',r.token);
 f.deployments.fetcher=async()=>new Response('Anden side');assert.equal((await f.deployments.check('/test')).checks.content.status,'different');
 f.deployments.fetcher=async()=>new Response('x'.repeat(2*1024*1024+1));assert.equal((await f.deployments.check('/test')).checks.content.status,'too-large');
 f.state.deploymentLast.indexHash=null;f.deployments.fetcher=async()=>new Response('Bygget hos udbyderen');assert.equal((await f.deployments.check('/test')).checks.content.status,'built');
});
test('versionens navn følger godkendelsen og ændrer ikke uploadens indhold', async()=>{
 const f=fixture();f.state.versionNames={[artifact.head]:'Klar til tester'};
 const r=await f.deployments.review('/test',config);assert.equal(r.version.name,'Klar til tester');f.state.versionNames[artifact.head]='Et nyt lokalt navn';
 const receipt=await f.deployments.deploy('/test',r.token);assert.equal(receipt.version.name,'Klar til tester');assert.equal(receipt.head,artifact.head);assert.equal(receipt.hash,artifact.hash);
});

test('udgivelse uden en gemt version siger, hvad der mangler', async t => {
  const { deploymentArtifact } = require('../core/deployment-artifact.cjs');
  const root = await require('node:fs/promises').mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'aura-uden-version-'));
  t.after(() => require('node:fs/promises').rm(root, { recursive: true, force: true }));
  await assert.rejects(deploymentArtifact(root, 'public'), /Gem en version af appen, før du udgiver/);
});

test('et "travlt"-svar fra udbyderen, hvor intet er uploadet, giver en klar besked og efterlader ingen kvittering om ukendt upload', async () => {
  const f = fixture(); const previous = { state: 'READY', id: 'tidligere' }; f.state.deploymentLast = previous;
  f.provider.deploy = async () => { throw Object.assign(Error('komplai har travlt lige nu. Intet er uploadet, så det er sikkert at prøve igen om lidt.'), { notUploaded: true }); };
  const r = await f.deployments.review('/test', config);
  await assert.rejects(f.deployments.deploy('/test', r.token), /travlt[\s\S]*sikkert at prøve igen/);
  assert.deepEqual(f.state.deploymentLast, previous, 'den tidligere kvittering er bevaret');
});

test('en upload, hvor udfaldet er uvist, giver stadig en kvittering om ukendt upload', async () => {
  const f = fixture(); f.provider.deploy = async () => { throw Error('netværksfejl'); };
  const r = await f.deployments.review('/test', config);
  await assert.rejects(f.deployments.deploy('/test', r.token), /ikke bekræftet/);
  assert.equal(f.state.deploymentLast.state, 'UNKNOWN');
});
