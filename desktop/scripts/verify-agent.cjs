const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Workbench } = require('../core/workbench.cjs');
const { openProject } = require('../core/projects.cjs');
const { startPreview } = require('../core/preview.cjs');
const rootPath = path.join(__dirname, '..', '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) { for (let i=0;i<300;i++) { if (await check()) return; await pause(100); } throw new Error(`Kontrollen nåede ikke frem til: ${description}`); }
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'harness-agent-'));
 const project = path.join(root,'projekt'); await fs.mkdir(path.join(project,'public'),{recursive:true});
 await fs.writeFile(path.join(project,'public/index.html'),'<h1>Før</h1>');
 let mode='write', permission='allow'; const requests=[], events=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models') {res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'test-model',name:'Kontrolleret testmodel'}]}));}
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);requests.push(body);
  if(mode==='wait') return;
  const isToolRun=Boolean(body.tools?.length);
  const hasResult=body.messages.some(m=>m.role==='tool');
  // En plan tæller kun med alle fire afsnit; ellers bliver svaret i samtalen uden plan.
  const planning=JSON.stringify(body.messages).includes('PLANLÆGNING:');
  const tool=isToolRun&&!hasResult?{id:'call_test',type:'function',function:{name:'write',arguments:JSON.stringify({filePath:path.join(project,'public/index.html'),content:'<h1>Bygget gennem agenten</h1>'})}}:null;
  const content=tool?'Arbejdsnote før værktøjskald.':isToolRun&&planning?'## Det bygger vi\nEn startside med en tydelig overskrift.\n## Sådan skal det se ud\nRolig og enkel.\n## Teknik og data\nHTML i public/index.html.\n## Det skal du prøve\nSe overskriften i forhåndsvisningen.':isToolRun?'Ændringen er behandlet.':'Prøveprojekt';
  if(body.stream){
   res.setHeader('content-type','text/event-stream');
   const chunk={id:'test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:tool?{role:'assistant',content,tool_calls:[{index:0,...tool}]}:{role:'assistant',content},finish_reason:null}]};
   res.write('data: '+JSON.stringify(chunk)+'\n\n');
   res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\n');res.end('data: [DONE]\n\n');
  }else{res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'test',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content,tool_calls:tool?[tool]:undefined},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('test-encrypted:'+s),decryptString:b=>b.toString().replace('test-encrypted:','')};
 const bench=new Workbench({directory:path.join(root,'state'),safeStorage,profiles:path.join(rootPath,'profiles'),emit:event=>{events.push(event);if(event.type==='permission.asked') bench.reply({id:event.properties.id,allow:permission==='allow'}).catch(e=>console.error('REPLY',e.message));}});
 let preview;
 try{
  await bench.activate(await openProject(project));
  const state=await bench.saveConnection({name:'Prøveserver',kind:'compatible',baseURL:`http://127.0.0.1:${server.address().port}/v1`});
  const selection={connectionID:state.connections[0].id,modelID:'test-model',references:[]};
  await assert.rejects(bench.prepare({...selection,mode:'build',planID:'ukendt'}),/seneste plan/);
  const planning=await bench.prepare({...selection,mode:'plan'});
  await bench.send({text:'Planlæg en startside. Prøv også at skrive en fil; det skal afvises.',fingerprint:planning.fingerprint, contextBinding: planning.contextBinding});
  await until(()=>!bench.running,'plan færdig');
  assert.equal(await fs.readFile(path.join(project,'public/index.html'),'utf8'),'<h1>Før</h1>');
  assert.ok(bench.chat.plan?.text, 'Planen skal kunne godkendes');
  assert.doesNotMatch(bench.chat.plan.text,/Arbejdsnote før værktøjskald/);
  assert.match(bench.chat.plan.context,/Arbejdsnote før værktøjskald/);
  const planRequests=requests.filter(r=>r.tools?.length);
  assert.ok(planRequests.length);
  for (const part of planning.appContext.components) assert.ok(planRequests.some(r=>r.messages.some(m=>typeof m.content==='string' && m.content.includes(part.text))), 'Exact reviewed planning fragment: '+part.id);
  assert.ok(planRequests.every(r=>!r.tools.some(t=>['write','edit','bash'].includes(t.function.name))), 'Skrive- og shellværktøjer må ikke udbydes i planlægning');
  assert.ok(planRequests.some(r=>r.messages.some(m=>m.role==='tool')), 'Det fremprovokerede skriveforsøg skal være behandlet');
  const { projectGuidance } = require('../core/project-guidance.cjs');
  assert.equal(planning.projectGuidance, projectGuidance, 'Datagennemgangen skal vise de ekstra projektinstruktioner');
  assert.ok(planRequests.some(r => r.messages.some(m => typeof m.content === 'string' && m.content.includes(projectGuidance))), 'Projektvejledningen skal nå frem til modelserveren under planlægning');
  const planID=bench.chat.plan.id;
  await assert.rejects(bench.prepare({...selection,mode:'build',planID:'forældet'}),/seneste plan/);
  const disclosure=await bench.prepare({...selection,mode:'build',planID});
  await assert.rejects(bench.send({text:'Test',fingerprint:'forkert'}));
  await bench.send({text:'Skriv startsiden som aftalt.',fingerprint:disclosure.fingerprint, contextBinding: disclosure.contextBinding});
  await until(()=>!bench.running,'agenten færdig');
  const errors=events.filter(e=>['session.error','engine.error'].includes(e.type));
  assert.deepEqual(errors,[],JSON.stringify(errors));
  assert.match(await fs.readFile(path.join(project,'public/index.html'),'utf8'),/Bygget gennem agenten/);
  assert.ok(events.some(e=>e.type==='permission.asked'));
  assert.ok(events.some(e=>e.type==='run.review' && e.files?.includes('public/index.html')));
  assert.ok(requests.some(r=>JSON.stringify(r).includes(planID)), 'Den godkendte plan følger med til bygning');
  assert.ok(requests.some(r => r.messages.some(m => typeof m.content === 'string' && m.content.includes(projectGuidance) && m.content.includes(planID))), 'Byggesessionen skal modtage både projektvejledningen og den godkendte plan');
  assert.ok(events.some(e=>e.type==='message.part.updated'));
  // Grundreglerne og appens regler står i systemprompten; skillsene fra biblioteket kan hentes efter behov.
  assert.ok(requests.some(r=>JSON.stringify(r).includes('FÆLLES-GRUNDLAG-02') && JSON.stringify(r).includes('APPENS REGLER')), 'grundregler og appens regler når modellen');
  assert.ok(requests.some(r=>JSON.stringify(r).includes('<name>harness-git-og-samarbejde</name>')), 'bibliotekets skills vises for modellen');
  preview=await startPreview(project);assert.match(await(await fetch(preview.url)).text(),/Bygget gennem agenten/);
  // Uden tilstand er det Samtale, der ikke må skrive. Direkte arbejde vælges eksplicit.
  await bench.close();permission='reject';await fs.writeFile(path.join(project,'public/index.html'),'<h1>Bevar</h1>');
  const declined=await bench.prepare({...selection,mode:'free'});await bench.send({text:'Prøv igen.',fingerprint:declined.fingerprint, contextBinding: declined.contextBinding});await until(()=>!bench.running,'afvist handling');assert.equal(bench.chat.plan,null,'Direkte arbejde ugyldiggør tidligere plan');
  assert.equal(await fs.readFile(path.join(project,'public/index.html'),'utf8'),'<h1>Bevar</h1>');
  await bench.close();mode='wait';const canceled=await bench.prepare({...selection,mode:'free'});await bench.send({text:'Vent på svar.',fingerprint:canceled.fingerprint, contextBinding: canceled.contextBinding});await pause(1000);await bench.stop();assert.equal(bench.running,false);
  console.log(JSON.stringify({status:'bestået',root,checks:['planlægning afviser fremprovokeret skriveforsøg','plan og afklaring følger til bygning','forældet plan afvises','afslutning viser faktiske filændringer','rigtig OpenCode-motor','kontrolleret modelserver','krævet datagennemgang','værktøjskald og godkendelse','rigtig filændring','preview fra disk','afvist ændring bevaret','stop'],model:'Simuleret kompatibel API, ikke en ekstern AI-model'}));
 }catch(error){console.error(error);console.error(JSON.stringify(events.filter(e=>/error|permission/.test(e.type))));process.exitCode=1;}
 finally {await bench.close();await preview?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})();
