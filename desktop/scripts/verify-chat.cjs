const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { run } = require('../core/git.cjs');
(async () => {
 const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'harness-chat-')));
 const project = path.join(root,'projekt'); await fs.mkdir(path.join(project,'public'),{recursive:true});
 await fs.writeFile(path.join(project,'public/index.html'),'<h1>Før chatten</h1>');
 await fs.writeFile(path.join(project,'AGENTS.md'),'# Projektregler\nDESKTOP-PROJEKTREGEL: Bevar projektets eksisterende konventioner.\n');
 const bin=path.join(root,'bin'); await fs.mkdir(bin);
 const realGit=require('node:child_process').execFileSync('/usr/bin/which',['git'],{encoding:'utf8'}).trim();
 const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
 await fs.writeFile(path.join(bin,'git'),'#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '+quote(realGit)+' "$@"\n',{mode:0o755});
 const opencode=process.env.HARNESS_OPENCODE_PATH || path.join(os.homedir(),'.opencode/bin/opencode');
 let rejectInference=false; const requests=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/preview'){res.setHeader('content-type','text/html');return res.end('<h1>Eksisterende udviklingsserver</h1>');}
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'test-model',name:'Kontrolleret testmodel'}]}));}
  if(rejectInference){res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'Testadgang afvist',type:'authentication_error'}}));}
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw); requests.push(body);
  const planning=JSON.stringify(body.messages).includes('PLANLÆGNING:');
  const tool=!planning && body.tools?.length&&!body.messages.some(m=>m.role==='tool')?{id:'chat_write',type:'function',function:{name:'write',arguments:JSON.stringify({filePath:path.join(project,'public/index.html'),content:'<h1>Bygget fra desktopchatten</h1>'})}}:null;
  res.setHeader('content-type','text/event-stream');
  const chunk={id:'test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,...tool}]}:{role:'assistant',content:planning?'Forslag: En startside.\n## Det bygger vi\nEn overskuelig startside i public/index.html.\n## Sådan skal det se ud\nEn tydelig overskrift.\n## Teknik og data\nHTML med lokale eksempeldata.\n## Det skal du prøve\nPrøv overskriften og mobilvisningen.':'Ændringen er behandlet.'},finish_reason:null}]};
  res.write('data: '+JSON.stringify(chunk)+'\n\n');
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let app;
 try {
  app=await electron.launch({executablePath:process.env.HARNESS_TEST_PACKAGE || require('electron'),args:[...(process.env.HARNESS_TEST_PACKAGE ? [] : [path.join(__dirname,'..')]),'--user-data-dir='+path.join(root,'appdata')],env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,HARNESS_OPENCODE_PATH:opencode,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await app.firstWindow(); await require('./ui-test-helpers.cjs').skipIntroduction(page); await page.waitForSelector('#onboarding'); await page.waitForFunction(() => !document.querySelector('#new').disabled); await require('./ui-test-helpers.cjs').openSetup(page); await page.click('#setup-local'); await page.waitForSelector('#create-form');
  await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});},project);
  await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
  await require('./ui-test-helpers.cjs').menuClick(page, '#git-button'); await page.click('#git-init');
  await page.waitForFunction(()=>document.querySelector('#git-init').hidden && !document.querySelector('#git-init').disabled);
  await run(project,['config','--local','user.name','Testbruger']); await run(project,['config','--local','user.email','test@example.invalid']);
  const hooks=path.join(root,'hooks'); await fs.mkdir(hooks); await run(project,['config','--local','core.hooksPath',hooks]); await run(project,['config','--local','commit.gpgsign','false']);
  await page.click('#tab-preview'); await require('./ui-test-helpers.cjs').menuClick(page, '#git-button');
  // Gem version med ét klik: opsummeringen er i almindeligt dansk, og filerne vælges kun under Avanceret.
  await page.locator('#git-summary').filter({hasText:'2 ændringer er ikke gemt endnu.'}).waitFor();
  assert.equal(await page.isChecked('#git-auto'),false); assert.equal(await page.locator('#git-files input').isVisible(),false);
  await page.fill('#git-note','Opret testprojekt'); await page.click('#git-save-all');
  await page.locator('#git-feedback').filter({hasText:'er gemt lokalt'}).waitFor(); await page.locator('#git-summary').filter({hasText:'Alt er gemt.'}).waitFor();
  assert.equal((await run(project,['rev-list','--count','HEAD'])).toString().trim(),'1');
  if (!process.env.HARNESS_TEST_PACKAGE) { await page.check('#git-auto'); await page.locator('#git-feedback').filter({hasText:'slået til'}).waitFor(); }
  await page.click('#tab-preview');
  console.log('Git-opstart og checkpoint-tilvalg bestået');
  const key='syntetisk-noegle-kun-til-test';
  await require('./ui-test-helpers.cjs').addConnection(page,{name:'Lokal testmodel',baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKey:key});
  assert.equal(await page.locator('#connection-form input[type=password]').count(), 0);
  const stateResult=await page.evaluate(()=>window.harness.connectionState());
  assert.equal(stateResult.value.connections[0].hasKey,true);
  assert.equal(JSON.stringify(stateResult).includes(key),false);
  const userData=await app.evaluate(({app})=>app.getPath('userData'));
  const stored=await fs.readFile(path.join(userData,'harness/settings.json'),'utf8');assert.equal(stored.includes(key),false);
  const encrypted=JSON.parse(stored).connections[0].secret;
  assert.equal(await app.evaluate(({safeStorage},encrypted)=>safeStorage.decryptString(Buffer.from(encrypted,'base64')),encrypted),key);
  await require('./ui-test-helpers.cjs').taskOptions(page); await page.selectOption('#connection-select',stateResult.value.connections[0].id);
  await page.waitForFunction(()=>document.querySelector('#model-select').options.length===2);
  await page.locator('#model-shortlist button').first().click();
  assert.equal(await page.inputValue('#model-select'),'test-model');
  // Et klik på et modelkort vælger modellen og lukker dialogen.
  assert.equal(await page.locator('#task-dialog').evaluate(el=>el.open),false);
  await page.locator('#idea-options').evaluate(el => el.open = true);
  await page.selectOption('#idea-platform',{label:'Browser'});
  await page.selectOption('#idea-data',{label:'Ja, flere brugere med fælles data'});
  await page.locator('#idea-options details').evaluate(el => el.open = true);
  await page.selectOption('#idea-ui',{label:'React og TypeScript'});
  await page.selectOption('#idea-design',{label:'Tailwind CSS med shadcn/ui'});
  await page.selectOption('#idea-backend',{label:'Serverless-funktioner'});
  // Med en kladde i skrivefeltet er der kun én måde at starte på, så kladden kan ikke overskrives.
  await page.fill('#prompt','Min eksisterende kladde'); assert.equal(await page.isVisible('#start-idea'),false);
  assert.equal(await page.inputValue('#prompt'),'Min eksisterende kladde');
  await page.screenshot({path:path.join(root,'projektvalg.png'),animations:'disabled'});
  await page.fill('#prompt',''); await page.click('#start-idea');
  // Ønskerne kommer i projektbriefen under Plan, som følger med beskeden; selve beskeden er idéen.
  await page.locator('#message').filter({hasText:'Dine ønsker står i projektbriefen under Plan.'}).waitFor();
  assert.doesNotMatch(await page.inputValue('#prompt'),/React og TypeScript/);
  const brief=(await page.evaluate(()=>window.harness.connectionState())).value.brief.items.map(item=>`${item.label}: ${item.value}`).join('\n');
  assert.match(brief,/Brugerflade: React og TypeScript/); assert.match(brief,/Designværktøjer: Tailwind CSS med shadcn/); assert.match(brief,/Backend: Serverless-funktioner/);
  assert.equal(await page.inputValue('#work-mode'),'chat');
  await require('./ui-test-helpers.cjs').selectMode(page, 'plan');
  assert.equal(requests.length,0);
  const idea='En oversigt over tre fiktive mødelokaler, hvor jeg kan finde plads til et møde.';await page.fill('#prompt',idea);
  await page.click('#send');
  await page.waitForSelector('#data-dialog[open]');
  assert.equal(await page.isVisible('#data-history-text'),true);
  assert.match(await page.locator('#data-history-text').textContent(),/tidligere beskeder og værktøjsresultater/);
  assert.doesNotMatch(await page.locator('#data-lead').textContent(),/planen/,'før første plan findes, må resuméet ikke påstå, at den sendes');
  assert.match(await page.locator('#data-details').textContent(),/Ukendt/); assert.equal(await page.isVisible('#data-warning'),true);
  assert.match(await page.locator('#data-details').textContent(), /Projektets egne regler, der sendes[\s\S]*DESKTOP-PROJEKTREGEL/);
  await page.locator('#data-details').evaluate(el => { el.closest('details').open = true; el.querySelector('details').open = true; });
  await page.screenshot({path:path.join(root,'projektregler.png'),animations:'disabled'});
  await page.click('#accept-send');
  await page.waitForSelector('#plan-card:not([hidden])',{timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('#build-plan').disabled);
  assert.equal(await fs.readFile(path.join(project,'public/index.html'),'utf8'),'<h1>Før chatten</h1>');
  assert.equal((await run(project,['rev-list','--count','HEAD'])).toString().trim(),'1');
  assert.ok(requests.some(r=>JSON.stringify(r.messages).includes('Tailwind CSS med shadcn/ui')));
  assert.ok(requests.some(r=>JSON.stringify(r.messages).includes('DESKTOP-PROJEKTREGEL')), 'projektreglerne når modelserveren');
  assert.ok(requests.some(r=>JSON.stringify(r.messages).includes(idea)),'den faktisk indtastede idé skal nå planlægningen');
  assert.equal(await page.isVisible('#agent-activity'),false);
  await page.click('#revise-plan');
  assert.equal(await page.inputValue('#work-mode'),'plan');
  assert.equal(await page.inputValue('#prompt'),'Ret forslaget: ');
  await page.fill('#prompt','Medtag en mobilvisning.');await page.click('#send');
  await page.locator('#messages .user').filter({hasText:'Medtag en mobilvisning.'}).waitFor();
  await page.waitForSelector('#plan-card:not([hidden])',{timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('#build-plan').disabled);
  assert.equal(await page.isVisible('#plan-text'),false);
  await page.click('#plan-open');
  assert.match(await page.locator('#plan-text').textContent(),/Forslag:/);
  await page.click('#tab-preview');
  await app.evaluate(({BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://'));
    for (const event of [
      {type:'message.updated',properties:{info:{id:'reasoning-test',role:'assistant'}}},
      {type:'message.part.updated',properties:{part:{id:'reasoning-part',messageID:'reasoning-test',type:'reasoning',text:''}}},
      {type:'message.part.delta',properties:{partID:'reasoning-part',messageID:'reasoning-test',field:'text',delta:'Intern arbejdsnote må ikke vises som svar.'}},
      {type:'message.part.updated',properties:{part:{id:'visible-part',messageID:'reasoning-test',type:'text',text:'Kontrolleret tekst'}}},
      {type:'message.part.delta',properties:{partID:'visible-part',messageID:'reasoning-test',field:'text',delta:' med streaming.'}}
    ]) win.webContents.send('harness:event', event);
  });
  await page.locator('#messages .assistant').filter({hasText:'Kontrolleret tekst med streaming.'}).waitFor();
  assert.doesNotMatch(await page.locator('#messages').textContent(),/Intern arbejdsnote/);
  await page.locator('#plan-card').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,'plan.png'),animations:'disabled'});
  await page.click('#build-plan');
  // Samme modtager og vilkår som ved planen: resuméet vises ikke igen ved bygning.
  await page.locator('#approvals button').filter({hasText:'Tillad for denne opgave'}).waitFor({timeout:60000});
  assert.equal(await page.locator('#data-dialog').evaluate(el=>el.open),false);
  assert.equal(await fs.readFile(path.join(project,'public/index.html'),'utf8'),'<h1>Før chatten</h1>');
  console.log('Forbindelse og datagennemgang bestået');
  assert.match(await page.locator('#agent-activity').textContent(),/Venter på dig: Må AI’en ændre filer i projektet\?/);
  assert.equal(await page.locator('#approvals .action-target').textContent(),'public/index.html');
  await page.locator('#approvals button').filter({hasText:'Tillad for denne opgave'}).click();
  await page.frameLocator('#preview').locator('h1').filter({hasText:'Bygget fra desktopchatten'}).waitFor({timeout:30000});
  await page.locator('#run-status').filter({hasText:'Klar'}).waitFor({timeout:30000});
  if (process.env.HARNESS_TEST_PACKAGE) {
    assert.equal((await run(project,['rev-list','--count','HEAD'])).toString().trim(),'1');
    await page.locator('#run-review button').filter({hasText:'Gem version'}).click();
    await page.locator('#git-quick').waitFor(); await page.fill('#git-note','Gem agentens prøveændring'); await page.click('#git-save-all');
    await page.locator('#git-feedback').filter({hasText:'er gemt lokalt'}).waitFor();
    // En tidligere gemning kan have samme feedbacktekst. Vent på den nye gemnings faktiske filstatus.
    await page.waitForFunction(()=>document.querySelector('#git-summary').textContent==='Alt er gemt.' && !document.querySelector('#git-save-all').disabled);
    await page.click('#tab-preview');
  }
  assert.equal((await run(project,['rev-list','--count','HEAD'])).toString().trim(),'2');
  assert.match(await page.locator('#run-review').textContent(),/AI’en kørte ingen kommandoer, så ingen tests er kørt/);
  await page.locator('#run-review .check-ok').filter({hasText:'Forhåndsvisning: siden blev vist uden fejl i konsollen.'}).waitFor({timeout:30000});
  assert.match((await run(project,['show','HEAD:public/index.html'])).toString(),/Bygget fra desktopchatten/);
  assert.equal((await run(project,['status','--porcelain'])).toString(),'');
  // Med automatiske versioner tilbyder kortet at fortryde opgaven; ellers at gemme den.
  if (process.env.HARNESS_TEST_PACKAGE) await page.locator('#run-review button').filter({hasText:'Gem version'}).click();
  else { await page.locator('#run-review button').filter({hasText:'Fortryd opgaven'}).waitFor(); assert.match((await run(project,['log','-1','--format=%s'])).toString().trim(),/^AI-opgave: Byg første udkast efter den plan, jeg har gennemgået\. Afslut med konkrete ting …$/); await require('./ui-test-helpers.cjs').menuClick(page, '#git-button'); }
  await page.waitForFunction(()=>document.querySelectorAll('#git-history li').length===2 && !document.querySelector('#git-auto').disabled); assert.equal(await page.isChecked('#git-auto'),!process.env.HARNESS_TEST_PACKAGE);
  assert.equal(await page.locator('#message.error:visible').count(),0);
  await page.screenshot({path:path.join(root,'versioner.png'),fullPage:true}); await page.click('#tab-preview');
  // Ændringer er en fane ved siden af samtalen: resumé og linje-diff for opgavens fil.
  await page.click('#tab-changes'); await page.click('#changes-view-session'); await page.locator('#changes-files .file-row[data-file="public/index.html"]').waitFor();
  assert.match(await page.locator('#changes-diff-lines').innerText(),/Bygget fra desktopchatten/);
  await page.click('#tab-preview');
  // Sammenhængende forløb på den byggede fil: ret i preview, se diff, fortryd og gennemgå udgivelsen.
  if (!process.env.HARNESS_TEST_PACKAGE) {
    const built = await fs.readFile(path.join(project, 'public/index.html'), 'utf8');
    await page.click('#preview-pick'); await page.frameLocator('#preview').locator('[data-aura-markering]').waitFor({state:'attached'});
    await page.frameLocator('#preview').locator('h1').click();await page.locator('#pick-title').filter({hasText:'Overskrift'}).waitFor();
    await page.click('#pick-edit');await page.fill('#pick-value','En overskrift jeg selv rettede');await page.press('#pick-value','Enter');
    await page.locator('#pick-check.check-ok').filter({hasText:'nye tekst'}).waitFor({timeout:30000});
    assert.match(await fs.readFile(path.join(project,'public/index.html'),'utf8'),/En overskrift jeg selv rettede/);
    await page.click('#pick-diff');await page.locator('#changes-heading').filter({hasText:'1 fil ændret af dig'}).waitFor();await page.locator('#changes-diff-lines').filter({hasText:'En overskrift jeg selv rettede'}).waitFor();assert.match(await page.locator('#changes-diff-lines').innerText(),/En overskrift jeg selv rettede/);
    await page.click('#tab-preview');await page.click('#pick-undo');await page.locator('#pick-check.check-ok').filter({hasText:'oprindelige tekst'}).waitFor({timeout:30000});
    assert.equal(await fs.readFile(path.join(project,'public/index.html'),'utf8'),built);
    await page.click('#preview-pick');
    await require('./ui-test-helpers.cjs').enableSharing(page);
    await app.evaluate(async(_,modulePath)=>{const {VercelDeployment}=process.mainModule.require(modulePath);VercelDeployment.prototype.inspect=async()=>({id:'prj_journey',name:'Samlet forløb',access:'Adgang ikke kontrolleret',region:'Ukendt',environmentKeys:[],portal:'https://vercel.com/test/journey'});VercelDeployment.prototype.deploy=async()=>{throw Error('Forløbsprøven må aldrig uploade');};},path.resolve(__dirname,'../core/deployment-providers.cjs'));
    // Udgiv: Udgiv fra Aura › Vercel › Udgiv én testversion › team › projekt › filer › gennemgang. Prøven trykker aldrig Udgiv.
    const idle=()=>page.waitForFunction(()=>!document.querySelector('#deployment-fields').disabled), next=async()=>{await page.click('#deployment-next');await idle();};
    await page.click('#deploy-button');await idle();await page.click('#deployment-other');
    if(!await page.locator('[data-provider="vercel"]').isVisible()) await page.click('#deployment-more-providers');
    await page.click('[data-provider="vercel"]');await idle();await page.click('#deployment-vercel-once');await idle();
    await page.fill('#deploy-scope','test');await next();await page.fill('#deploy-project','journey');await next();await next();
    await page.waitForSelector('#deployment-review:not([hidden])');assert.match(await page.locator('#deployment-summary').innerText(),/Byg første udkast/);assert.match(await page.locator('#deployment-files').textContent(),/index\.html/);
    await page.click('[data-close="deployment-dialog"]');
    assert.equal((await run(project,['status','--porcelain'])).toString(),'');
    console.log('Samlet idé → plan → bygning → tekstrettelse → diff → fortrydelse → gennemgang i Udgiv bestået på samme projektfil; ingen cloud-upload');
  }
  await require('./ui-test-helpers.cjs').menuClick(page, '#skills-button');await page.selectOption('#skill-select','harness-git-og-samarbejde');
  const original=await page.inputValue('#skill-content');await page.fill('#skill-content',original+'\nTesttilpasning.');await page.click('#skill-save');
  await page.locator('#skill-source').filter({hasText:'Lokal tilpasning'}).waitFor();
  await page.click('#skill-reset');await page.locator('#skill-source').filter({hasText:'Fælles version'}).waitFor();
  assert.equal(await page.inputValue('#skill-content'),original);await page.click('[data-close="skills-dialog"]');await page.click('[data-close="features-dialog"]');
  await page.screenshot({path:path.join(root,'chat.png'),fullPage:true});
  await page.click('#open'); await page.waitForFunction(()=>document.querySelector('#model-select').value==='test-model');
  await require('./ui-test-helpers.cjs').menuClick(page, '#attach-preview'); await page.fill('#preview-url',`http://127.0.0.1:${server.address().port}/preview`); await page.click('#preview-form button[type="submit"]');
  await page.frameLocator('#preview').locator('h1').filter({hasText:'Eksisterende udviklingsserver'}).waitFor();
  await require('./ui-test-helpers.cjs').menuClick(page, '#attach-preview'); await page.click('#static-preview');
  await page.frameLocator('#preview').locator('h1').filter({hasText:'Bygget fra desktopchatten'}).waitFor();
  rejectInference=true; await page.fill('#prompt','Denne besked skal bevares ved afvist modeladgang.'); await page.click('#send');
  // En fejl under opgaven står ét sted: på resultatkortet med Gennemgå AI-forbindelse.
  await page.locator('#run-review h3').filter({hasText:'AI’en afviste din nøgle'}).waitFor({timeout:60000});
  assert.equal(await page.locator('#run-review .review-actions button.primary').textContent(),'Gennemgå AI-forbindelse');
  assert.equal(await page.isVisible('#connection-warning'),false);
  await page.waitForFunction(()=>!document.querySelector('#setup-local').disabled);
  assert.equal(await page.inputValue('#prompt'),'Denne besked skal bevares ved afvist modeladgang.');
  assert.equal((await run(project,['rev-list','--count','HEAD'])).toString().trim(),'2');
  const empty=path.join(root,'tom');await fs.mkdir(empty);
  await app.evaluate(({dialog},empty)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[empty]});},empty);
  await page.click('#open');await page.waitForSelector('#preview-empty:not([hidden])');assert.deepEqual(await fs.readdir(empty),[]);
  assert.equal(await page.inputValue('#idea-ui'),''); assert.equal(await page.isVisible('#agent-activity'),false);
  await page.click('#start-idea'); assert.doesNotMatch(await page.inputValue('#prompt'),/React og TypeScript/);
  console.log(JSON.stringify({status:'bestået',root,checks:['modelkort uden automatisk valg','planlægning, afklaring og eksplicit bygning gennem UI','resultatoversigt uden opdigtede testresultater','afvist modeladgang viser hjælp i arbejdsområdet og bevarer beskeden uden checkpoint','manuel Git-opstart og versionsgemning gennem UI',process.env.HARNESS_TEST_PACKAGE ? 'manuel version efter rigtig OpenCode-filændring i pakket app' : 'automatisk checkpoint efter rigtig OpenCode-filændring','Electron safeStorage uden klartekst i appdata eller renderer','UI-modelvalg og datagennemgang','streaming og godkendelse','rigtig filændring og preview','ændringsoversigt','skill redigering og gendannelse','tom mappe uden filændringer','bevaret modelvalg ved genåbning','tilsluttet udviklingsserver']}));
 } catch (error) { console.error(error); if (app) { try { const page=app.windows().find(w=>w.url().startsWith('harness:')); if(page) { console.error(await page.locator('#messages').textContent({timeout:2000})); console.error(await page.locator('#message').textContent({timeout:2000}).catch(()=>'')); await page.screenshot({path:path.join(root,'fejl.png'),fullPage:true,timeout:3000}); } } catch {} } throw error; } finally {await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
