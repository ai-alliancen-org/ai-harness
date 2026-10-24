const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Workbench}=require('../core/workbench.cjs');
for(const scenario of ['completed','no-tool','tool-error','no-answer','engine-error','stopped'])test('automatic support observation: '+scenario,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-support-event-')),project=path.join(root,'project');await fs.mkdir(project);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bench=new Workbench({directory:path.join(root,'state'),profiles:path.resolve(__dirname,'../../profiles'),safeStorage:{},emit(){},engineFactory:()=>({active:true,session:{id:'synthetic'},start:async()=>{},messages:async()=>[],send:async()=>{},abort:async()=>{},close:async()=>{}})});t.after(()=>bench.close());await bench.activate({root:project,name:'Syntetisk prøve'});
 bench.selection=async()=>({connection:{id:'fixture',kind:'compatible',baseURL:'http://127.0.0.1:1/v1'},model:{id:'fixture',capabilities:{tools:true}}});
 const d=await bench.prepare({mode:'chat'});await bench.send({text:'Læs projektet',fingerprint:d.fingerprint});const chat=bench.chat;
 chat.event({type:'message.updated',properties:{info:{id:'reply',role:'assistant'}}});
 if(scenario!=='no-answer')chat.event({type:'message.part.updated',properties:{part:{id:'answer',type:'text',messageID:'reply',text:'Projektet er gennemgået.'}}});
 if(scenario!=='no-tool')chat.event({type:'message.part.updated',properties:{part:{id:'tool',type:'tool',messageID:'reply',tool:'read',state:{status:scenario==='tool-error'?'error':'completed',input:{filePath:'index.html'},output:'synthetic contents'}}}});
 if(scenario==='stopped')await bench.stop();else{chat.event({type:scenario==='engine-error'?'engine.error':'session.idle',message:scenario==='engine-error'?'Synthetic error':undefined});await chat.finishing;}
 assert.equal(bench.supportEvidence?.length||0,scenario==='completed'?1:0);const next=await bench.prepare({mode:'chat'});
 assert.equal(next.modelSupport.measurements.length,scenario==='completed'?1:0);
 if(scenario==='completed'){assert.equal(next.modelSupport.measurements[0].environment,'controlled');assert.ok(!JSON.stringify(bench.supportEvidence).includes('synthetic contents'));}
});
