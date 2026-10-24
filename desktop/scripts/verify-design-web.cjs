const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Workbench } = require('../core/workbench.cjs');
const { openProject } = require('../core/projects.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'harness-web-')); const project=path.join(root,'projekt');await fs.mkdir(project);
 const results=[]; const permissions=[]; let bench;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'test-model'}]}));}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  const fetched=body.messages.filter(m=>m.role==='tool');
  for(const result of fetched)results.push(JSON.stringify(result.content));
  let url;
  if(body.tools?.length&&fetched.length===0)url='https://design.gentofte.dk/';
  if(body.tools?.length&&fetched.length===1&&JSON.stringify(fetched[0]).includes('designelementer'))url='https://design.gentofte.dk/designelementer/';
  const tool=url?{id:'fetch_'+fetched.length,type:'function',function:{name:'webfetch',arguments:JSON.stringify({url,format:'markdown'})}}:null;
  res.setHeader('content-type','text/event-stream');
  const chunk={id:'web',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,...tool}]}:{role:'assistant',content:'Webkontrol afsluttet.'},finish_reason:null}]};
  res.write('data: '+JSON.stringify(chunk)+'\n\n');res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 bench=new Workbench({directory:path.join(root,'state'),profiles:path.join(__dirname,'../../profiles'),safeStorage:{},emit:e=>{if(e.type==='permission.asked'){permissions.push(e.properties);bench.reply({id:e.properties.id,allow:e.properties.permission==='webfetch'&&e.properties.patterns.every(p=>p.startsWith('https://design.gentofte.dk/'))}).catch(()=>{});}}});
 try{
  await bench.activate(await openProject(project));
  const state=await bench.saveConnection({kind:'compatible',name:'Lokal webtest',baseURL:`http://127.0.0.1:${server.address().port}/v1`});
  const info=await bench.prepare({connectionID:state.connections[0].id,modelID:'test-model',references:[]});
  await bench.send({text:'Læs designguiden og en relevant underside.',fingerprint:info.fingerprint, contextBinding: info.contextBinding});
  const deadline=Date.now()+90000;while(bench.running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.equal(bench.running,false);assert.ok(results.some(r=>r.includes('designelementer')),'Forsiden skal indeholde undersidehenvisninger');
  assert.ok(results.some(r=>r.includes('#2f3234')),'Undersidens faktiske farvedata skal nå værktøjsresultatet');
  assert.ok(permissions.length>=2);assert.deepEqual(await fs.readdir(project),[]);
  console.log(JSON.stringify({status:'bestået',root,checks:['rigtig OpenCode webfetch','godkendt Gentofte-forside','underside fundet i resultat og hentet','faktiske farvedata i værktøjsresultat'],model:'Kontrolleret lokal testmodel; ingen ekstern AI-model'}));
 }finally{await bench.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
