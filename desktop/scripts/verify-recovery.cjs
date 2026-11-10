const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { GitVersions, run } = require('../core/git.cjs');
const { skipIntroduction, menuClick, taskOptions, selectMode } = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-recovery-'))), project = path.join(root,'Prøve med mellemrum');
  await fs.mkdir(path.join(project,'public'),{recursive:true}); await fs.writeFile(path.join(project,'.gitignore'),'.env\n');
  const pageFile = path.join(project,'public/index.html'); await fs.writeFile(pageFile,'<h1>Godkendt version</h1>');
  const git = new GitVersions(); await git.initialize(project);
  for (const [key,value] of [['user.name','Testbruger'],['user.email','test@example.invalid'],['commit.gpgsign','false'],['core.hooksPath',path.join(root,'hooks')]]) await run(project,['config','--local',key,value]);
  let review = await git.review(project); const first = await git.commit(project,{token:review.token,files:review.files.map(f=>f.file),message:'Godkendt udgangspunkt'});
  await fs.writeFile(pageFile,'<h1>Anden version</h1>'); review=await git.review(project); const second=await git.commit(project,{token:review.token,files:['public/index.html'],message:'Anden prøveversion'});
  await fs.writeFile(pageFile,'<h1>Ugemt forsøg</h1>'); await fs.writeFile(path.join(project,'.env'),'PRIVATE=kun-lokalt'); await fs.writeFile(path.join(project,'noter.txt'),'Bevar denne fil');
  let mode='ok', requests=0, app, page;
  // En plan tæller kun med alle fire afsnit; ellers bliver svaret i samtalen uden plan.
  const plan='## Det bygger vi\nVi bevarer den eksisterende side og dens lokale data. Næste ændring er en tydelig tilmeldingsknap.\n## Sådan skal det se ud\nKnappen står tydeligt under overskriften.\n## Teknik og data\nVi bruger projektets HTML. Ingen ny konto er nødvendig.\n## Det skal du prøve\nKontrollér knappen på mobil og computer.';
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'recovery-model'}]}));}
    requests++; let raw='';for await(const chunk of req) raw+=chunk;const body=JSON.parse(raw);
    if(mode==='key'||mode==='quota'){res.writeHead(mode==='key'?401:402,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'SKJULT_UDVIDERTEKST'}}));}
    const chunk={id:'recovery-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:mode==='ok'?plan:mode==='wait'?'Delvist svar før brugerens stop.':'Delvist svar før afbrydelsen.'},finish_reason:null}]};
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify(chunk)+'\n\n');
    if(mode==='stream'){setTimeout(()=>res.destroy(),100);return;}
    if(mode==='wait')return;
    res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const launch=async()=>{
    const bundle=process.env.HARNESS_TEST_PACKAGE ? path.resolve(process.env.HARNESS_TEST_PACKAGE) : null;
    app=await electron.launch({executablePath:bundle?(bundle.endsWith('.app')?path.join(bundle,'Contents/MacOS',path.basename(bundle,'.app')):bundle):require('electron'),args:[...(bundle?[]:[path.join(__dirname,'..')]),'--user-data-dir='+path.join(root,'appdata')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
    page=await app.firstWindow();await skipIntroduction(page);
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});},project);await page.click('#open');await page.waitForSelector('#workspace:not([hidden])');
  };
  const send=async text=>{
    await page.fill('#prompt',text);await page.click('#send');
    await page.waitForFunction(()=>document.querySelector('#data-dialog').open||!document.querySelector('#stop').hidden);
    if(await page.locator('#data-dialog').evaluate(el=>el.open))await page.click('#accept-send');
  };
  try {
    // Gendannelsens resultat står i samtalens resultatkort.
    await launch();await menuClick(page,'#git-button');
    const restoreTo=async name=>{await page.locator('#git-history .version-row').filter({hasText:name}).click();await page.click('#version-restore');await page.waitForSelector('#restore-dialog[open]');await page.waitForFunction(()=>!document.querySelector('#restore-confirm').disabled);};
    await restoreTo('Godkendt udgangspunkt');
    await page.click('#restore-dialog > details > summary'); await page.locator('#restore-files').filter({hasText:'Ugemt forsøg'}).waitFor();
    await page.click('[data-close="restore-dialog"]'); assert.match(await fs.readFile(pageFile,'utf8'),/Ugemt/);
    await page.click('#version-restore');await page.waitForFunction(()=>!document.querySelector('#restore-confirm').disabled);await page.click('#restore-confirm');
    await page.locator('#run-review').filter({hasText:'1 fil er sat tilbage'}).waitFor();
    // Gendannelsen skifter ikke fane; brugeren står i Ændringer › Versioner og vælger selv Forhåndsvisning.
    await page.click('#tab-preview');
    await page.frameLocator('#preview').getByRole('heading',{name:'Godkendt version'}).waitFor();
    assert.equal((await git.status(project)).head,second.head); assert.equal(await fs.readFile(path.join(project,'.env'),'utf8'),'PRIVATE=kun-lokalt');
    await page.screenshot({path:path.join(root,'gendannet.png'),animations:'disabled'});
    await app.close();app=null;await launch();await menuClick(page,'#git-button');await page.click('#restore-undo');await page.waitForFunction(()=>!document.querySelector('#restore-confirm').disabled);await page.click('#restore-confirm');
    await page.locator('#run-review').filter({hasText:'er sat tilbage'}).waitFor();
    await page.click('#tab-preview');
    await page.frameLocator('#preview').getByRole('heading',{name:'Ugemt forsøg'}).waitFor();
    assert.equal((await git.status(project)).head,second.head);assert.equal(await fs.readFile(path.join(project,'noter.txt'),'utf8'),'Bevar denne fil');
    await require('./ui-test-helpers.cjs').addConnection(page,{name:'Kontrolleret fejlprøve',baseURL:`http://127.0.0.1:${server.address().port}/v1`});
    const state=await page.evaluate(()=>window.harness.connectionState());await taskOptions(page);await page.selectOption('#connection-select',state.value.connections[0].id);await page.locator('#model-shortlist button').first().click();await selectMode(page,'plan');
    // En færdig plan bevares ved fejl og Stop, indtil en ny plan erstatter den (docs/decisions.md, 3. november 2026). Hvert nyt forsøg giver en ny plan.
    const planID=async()=>(await page.evaluate(()=>window.harness.connectionState())).value.plan?.id||null;
    let lastPlan=null;
    for(const [failure,text] of [['key','prøve med forkert nøgle'],['quota','prøve med opbrugt kvote'],['stream','prøve med afbrudt forbindelse']]){
      mode=failure;await send(text);await page.locator('#run-status').filter({hasText:'Fejl'}).waitFor({timeout:60000});
      assert.equal(await page.inputValue('#prompt'),text);
      assert.equal(await page.isVisible('#plan-card'),Boolean(lastPlan),'Planen fra forrige forsøg står stadig efter fejlen');assert.equal(await planID(),lastPlan);
      assert.equal((await page.locator('#messages').textContent()).includes('SKJULT_UDVIDERTEKST'),false);
      await page.screenshot({path:path.join(root,failure+'.png'),animations:'disabled'});
      mode='ok';await send('Prøv igen efter '+failure);await page.locator('#run-status').filter({hasText:'Klar'}).waitFor({timeout:60000});await page.waitForSelector('#plan-card:not([hidden])');
      const next=await planID();assert.ok(next&&next!==lastPlan,'Et nyt forsøg efter fejlen giver en ny plan');lastPlan=next;
    }
    mode='wait';await send('Bevar denne besked efter stop');await page.locator('#messages .assistant').filter({hasText:'Delvist svar før brugerens stop.'}).waitFor({timeout:60000});await page.click('#stop');await page.locator('#run-status').filter({hasText:'Stoppet'}).waitFor();
    assert.equal(await page.inputValue('#prompt'),'Bevar denne besked efter stop');assert.equal(await page.isVisible('#plan-card'),true,'Planen står stadig efter Stop');assert.equal(await planID(),lastPlan);
    mode='ok';await send('Prøv igen efter stop');await page.locator('#run-status').filter({hasText:'Klar'}).waitFor({timeout:60000});
    assert.ok(![null,lastPlan].includes(await planID()),'Et nyt forsøg efter Stop giver en ny plan');
    assert.equal(requests,8,'Ingen automatisk gentagelse af fejlede kald');
    await page.waitForSelector('#plan-card:not([hidden])');await menuClick(page,'#git-button');await restoreTo('Godkendt udgangspunkt');await page.click('#restore-confirm');await page.locator('#run-review').filter({hasText:'er sat tilbage'}).waitFor();
    assert.equal(await page.isVisible('#plan-card'),false);assert.equal((await page.evaluate(()=>window.harness.connectionState())).value.workspace.plan,null);
    await app.evaluate(({safeStorage})=>{ safeStorage.isEncryptionAvailable=()=>{throw new Error('Hjælp må ikke kontakte nøgleringen');}; });
    await menuClick(page,'#support-button'); await page.getByText('Fejlrapport uden projektindhold',{exact:true}).click(); const report=await page.locator('#support-report').textContent();
    assert.equal(JSON.parse(report).noeglelagring,'ikke kontrolleret');
    for(const privateText of [project,'127.0.0.1','PRIVATE','recovery-model','Prøv igen'])assert.equal(report.includes(privateText),false);
    assert.ok(JSON.parse(report).senesteFejl.length>0);
    const target=path.join(root,'rapport.json');await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);await page.click('#support-save');await page.locator('#support-status').filter({hasText:'gemt'}).waitFor();assert.equal(JSON.parse(await fs.readFile(target)).format,1);
    // Feedback følger kontakten i package.json: navn og adresse vises, og knappen åbner en e-mailkladde. Uden kontakt kun den generelle tekst.
    const person=require('../core/feedback.cjs').contact();
    if(person){
      await app.evaluate(({shell})=>{global.openedFeedback=[];shell.openExternal=async url=>{global.openedFeedback.push(url);};});
      assert.equal(await page.textContent('#support-contact'),`Send feedback til ${person.name}, ${person.email}.`);
      await page.click('#support-feedback');
      let opened=[];for(let i=0;i<50&&!opened.length;i++){opened=await app.evaluate(()=>global.openedFeedback);if(!opened.length)await new Promise(r=>setTimeout(r,100));}
      assert.equal(opened.length,1,'knappen åbner én e-mailkladde');
      const mail=new URL(opened[0]);assert.equal(mail.protocol,'mailto:');assert.equal(mail.pathname,person.email);assert.match(mail.searchParams.get('subject'),/^Feedback om Aura /);
    }else{assert.equal(await page.textContent('#support-contact'),'Send feedback til den, der inviterede dig.');assert.equal(await page.isVisible('#support-feedback'),false);}
    await page.screenshot({path:path.join(root,'feedback.png'),animations:'disabled'});
    console.log(JSON.stringify({status:'bestået',root,requests,checks:['gendan og fortryd gennem UI og genstart','HEAD og private filer bevaret','forkert nøgle og kvote med kladde bevaret','afbrudt HTTP-strøm bliver en fejl','planen bevares ved fejl og stop','ny plan efter hver fejl og stop','fejlrapport gennem filvælger uden projektindhold','feedback til kontakten i package.json'],limitation:'Kontrolleret modelserver; ingen vurdering af en rigtig models svar'}));
  }catch(error){console.error('Testmateriale: '+root);console.error(error.message);await page?.screenshot({path:path.join(root,'fejl.png'),animations:'disabled',timeout:3000}).catch(()=>{});throw error;}
  finally{await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
