// Actual Workbench, disclosure, filesystem and consent path. The engine process
// is replaced at its boundary; this is not native engine or account acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {Workbench}=require('../core/workbench.cjs');const {ChatMaterials}=require('../core/chat-materials.cjs');
const ref=value=>({scope:value.scope,revision:value.revision});
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-materials-session-'))),project=path.join(root,'project');await fs.mkdir(project);await fs.writeFile(path.join(project,'index.html'),'<!doctype html><title>Synthetic</title>');const file=path.join(root,'outside-reference.txt');await fs.writeFile(file,'External synthetic reference.');
 const server=http.createServer((req,res)=>{if(req.url!=='/v1/models'){res.writeHead(404).end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'model-a'}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const engines=[];let beforeStart=null;
 const bench=new Workbench({directory:path.join(root,'data'),profiles:path.resolve(__dirname,'../../profiles'),safeStorage:{},emit(){},engineFactory:options=>{const engine={options,active:false,resumed:Boolean(options.resume),session:{id:options.resume||'synthetic-session'},pending:new Map(),sent:[],async start(){await beforeStart?.();this.active=true;},async send(text,system){this.sent.push({text,system});},async abort(){},async close(){this.active=false;}};engines.push(engine);return engine;}});
 t.after(async()=>{await bench.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});await bench.activate({root:project,name:'Synthetic',purpose:'Synthetic material context',assets:[]});bench.chatMaterials=new ChatMaterials();
 const connection=(await bench.saveConnection({kind:'compatible',name:'Synthetic local route',baseURL:`http://127.0.0.1:${server.address().port}/v1`})).connections[0];
 async function attach(){const offer=await bench.chatMaterials.offerFiles(bench.chat,[file]),review=await bench.chatMaterials.preview(bench.chat,{...ref(offer),ids:[offer.candidates[0].id]});return bench.chatMaterials.attach(bench.chat,{...ref(review),token:review.token});}
 const prepare=extra=>bench.prepare({connectionID:connection.id,modelID:'model-a',mode:'chat',...extra});
 const finish=async()=>{bench.chat.event({type:'session.idle'});await bench.chat.finishing;};
 return{root,project,file,bench,engines,attach,prepare,finish,setBeforeStart(fn){beforeStart=fn;}};
}
test('reviewed source text is disclosed and sent verbatim as data while outside paths never enter engine tool references',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});assert.equal(data.chatMaterials.files[0].text,'External synthetic reference.');assert.equal(JSON.stringify(data.chatMaterials).includes(f.root),false);
 await f.bench.send({text:'Use the reviewed context.',fingerprint:data.fingerprint});const engine=f.engines[0];assert.match(engine.sent[0].text,/External synthetic reference/);assert.match(engine.sent[0].text,/ingen adgang til kildemapper/);assert.deepEqual(engine.options.references,[]);assert.equal(engine.options.root,f.project);assert.equal(await fs.readFile(f.file,'utf8'),'External synthetic reference.');await f.finish();
 const removed=await f.bench.chatMaterials.remove(f.bench.chat,{...ref(f.bench.chatMaterials.state(f.bench.chat)),id:selected.selected[0].id});assert.equal(removed.selected.length,0);const next=await f.prepare();assert.equal(next.chatMaterials,undefined);assert.equal(next.fingerprint,data.sessionFingerprint,'text snapshots must not become lasting tool grants or discard the conversation');
});
test('changed source after actual prepare refuses send before any engine is constructed',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});await fs.writeFile(f.file,'Changed since disclosure.');await assert.rejects(f.bench.send({text:'Send.',fingerprint:data.fingerprint}),/ændret eller utilgængelig/);assert.equal(f.engines.length,0);assert.equal(f.bench.chat.running,false);
});
test('source change during real startup is rechecked immediately before engine.send and cannot dispatch old reviewed text',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});f.setBeforeStart(()=>fs.writeFile(f.file,'Changed while starting.'));await assert.rejects(f.bench.send({text:'Send.',fingerprint:data.fingerprint}),/ændret eller utilgængelig/);assert.equal(f.engines.length,1);assert.equal(f.engines[0].sent.length,0);assert.equal(f.bench.chat.running,false);
});
test('selection mutation after disclosure invalidates the prepared record and cannot reuse its fingerprint',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});await f.bench.chatMaterials.remove(f.bench.chat,{...ref(selected),id:selected.selected[0].id});assert.equal(f.bench.chat.prepared,null);await assert.rejects(f.bench.send({text:'Send.',fingerprint:data.fingerprint}),/aktuelle dataoplysninger/);assert.equal(f.engines.length,0);
});
test('attachment dispatch consent is one-use even when the same source and recipient remain unchanged',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});
 await f.bench.send({text:'First reviewed dispatch.',fingerprint:data.fingerprint});await f.finish();
 assert.equal(f.bench.chat.prepared.used,true);
 await assert.rejects(f.bench.send({text:'A second dispatch without another review.',fingerprint:data.fingerprint}),/aktuelle dataoplysninger/);
 assert.equal(f.engines.reduce((total,engine)=>total+engine.sent.length,0),1);
 const next=await f.prepare({chatMaterials:ref(selected)});
 assert.notEqual(next.fingerprint,data.fingerprint);assert.equal(next.accepted,false);
 await f.bench.send({text:'A newly reviewed dispatch.',fingerprint:next.fingerprint});await f.finish();
 assert.equal(f.engines.reduce((total,engine)=>total+engine.sent.length,0),2);
});
test('reviewed attachments survive real copy allocation when another conversation owns the project',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});
 f.bench.claims.set(f.project,{id:'synthetic-other-owner'});
 await f.bench.send({text:'Use the reviewed context in this conversation copy.',fingerprint:data.fingerprint});
 assert.ok(f.bench.chat.copy);assert.notEqual(f.bench.chat.root,f.project);
 assert.equal(f.bench.chat.prepared.root,f.bench.chat.copy.root);assert.equal(f.bench.chat.prepared.used,true);
 assert.equal(f.engines[0].options.root,f.bench.chat.copy.root);
 assert.match(f.engines[0].sent[0].text,/External synthetic reference\./);
 assert.deepEqual(f.engines[0].options.references,[]);
 await f.finish();
 await assert.rejects(f.bench.send({text:'Replay.',fingerprint:data.fingerprint}),/aktuelle dataoplysninger/);
 assert.equal(f.engines[0].sent.length,1);
});
test('a connection change during startup still invalidates the next dispatch without losing the current prepared owner',async t=>{
 const f=await fixture(t),selected=await f.attach(),data=await f.prepare({chatMaterials:ref(selected)});
 const connectionID=f.bench.chat.prepared.connection.id;
 f.setBeforeStart(()=>f.bench.connectionChanged(connectionID));
 await f.bench.send({text:'Use the already reviewed destination.',fingerprint:data.fingerprint});await f.finish();
 assert.equal(f.bench.chat.preparedInvalidated,true);assert.equal(f.bench.chat.prepared.used,true);
 assert.equal(f.engines[0].sent.length,1);
 await assert.rejects(f.bench.send({text:'Replay after connection change.',fingerprint:data.fingerprint}),/aktuelle dataoplysninger/);
 const fresh=await f.prepare({chatMaterials:ref(selected)});
 assert.equal(f.bench.chat.preparedInvalidated,false);assert.notEqual(fresh.fingerprint,data.fingerprint);assert.equal(fresh.accepted,false);
});
