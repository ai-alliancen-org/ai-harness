const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Store}=require('../core/store.cjs');
const {WorkspaceHistory}=require('../core/workspace-history.cjs');
const {searchHistory}=require('../core/history-search.cjs');
test('full-text local search finds an exact old message with project/chat filters and pagination, without writing history',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aura-search-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=new Store(path.join(dir,'state'),{}),history=new WorkspaceHistory(store),root=path.join(dir,'project');await fs.mkdir(root);await history.open({root,name:'Synthetic project'});
 const chat=await history.createChat(root,{fresh:true});await history.updateChat(root,chat.id,c=>{c.title='A title without the term';c.renamed=true;c.messages=Array.from({length:50},(_,i)=>({id:`message-${i}`,role:i%2?'assistant':'user',text:`Chosen colour ${i} for project` }));});
 const before=await fs.readFile(history.chatFile(root,chat.id));
 const first=await searchHistory(history,{query:'COLOUR',limit:3});assert.equal(first.results.length,3);assert.equal(first.nextOffset,3);assert.equal(first.results[0].message,'message-0');assert.equal(first.localOnly,true);assert.equal(JSON.stringify(first).includes(root),false);
 const next=await searchHistory(history,{query:'colour',project:store.projectKey(root),chat:chat.id,offset:3,limit:3});assert.equal(next.results[0].message,'message-3');
 assert.equal((await searchHistory(history,{query:'nothing here'})).results.length,0);
 assert.deepEqual(await fs.readFile(history.chatFile(root,chat.id)),before);
 await assert.rejects(searchHistory(history,{query:'x',root:'/etc'}),/lokale/);await assert.rejects(searchHistory(history,{query:'x',limit:100000}),/ugyldig/);
});
test('search skips symlinked, corrupt and oversized local records without changing them',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-search-bounds-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'state'),{}),history=new WorkspaceHistory(store),root=path.join(dir,'project');await fs.mkdir(root);const project=await history.open({root,name:'Synthetic'}),id=project.active;
 await history.updateChat(root,id,c=>{c.messages=[{id:'m',role:'user',text:'needle'}];});
 const file=history.chatFile(root,id),original=await fs.readFile(file),outside=path.join(dir,'outside.json');await fs.writeFile(outside,original);await fs.unlink(file);await fs.symlink(outside,file);
 assert.equal((await searchHistory(history,{query:'needle'})).results.length,0);assert.deepEqual(await fs.readFile(outside),original);await fs.unlink(file);await fs.writeFile(file,'{corrupt');assert.equal((await searchHistory(history,{query:'needle'})).skipped,1);
 await fs.writeFile(file,Buffer.alloc(8*1024*1024+1));const large=await searchHistory(history,{query:'needle'});assert.equal(large.results.length,0);assert.equal(large.truncated,true);
 await fs.writeFile(file,original);const folder=history.folder(root),moved=path.join(dir,'moved');await fs.rename(folder,moved);await fs.symlink(moved,folder);assert.equal((await searchHistory(history,{query:'needle'})).results.length,0);
});
test('search never migrates legacy history and does not call mutating history helpers',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-search-legacy-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'state'),{}),history=new WorkspaceHistory(store),root=path.join(dir,'project');await fs.mkdir(root);await history.open({root,name:'Legacy'});const old=JSON.stringify({version:1,draft:'keep',messages:[{role:'user',text:'needle'}],planConversation:[]});await fs.writeFile(history.file(root),old);history.chats=()=>{throw Error('Search must not migrate history');};const result=await searchHistory(history,{query:'needle'});assert.equal(result.results.length,0);assert.equal(result.skipped,1);assert.equal(await fs.readFile(history.file(root),'utf8'),old);
});
test('project and conversation scope exclude other projects and unknown identifiers',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-search-scope-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'state'),{}),history=new WorkspaceHistory(store),ids=[];
 for(const n of [1,2]){const root=path.join(dir,'project'+n);await fs.mkdir(root);const p=await history.open({root,name:'Project '+n});await history.updateChat(root,p.active,c=>{c.messages=[{id:'m'+n,role:'user',text:'fælles søgeord'}];});ids.push({root,id:p.active});}
 assert.equal((await searchHistory(history,{query:'FÆLLES'})).results.length,2);const scoped=await searchHistory(history,{query:'søgeord',project:store.projectKey(ids[0].root),chat:ids[0].id});assert.deepEqual(scoped.results.map(r=>r.message),['m1']);assert.equal((await searchHistory(history,{query:'søgeord',project:'0'.repeat(64)})).results.length,0);
});
test('corrupt JSON still consumes the total read budget',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-search-budget-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'state'),{}),history=new WorkspaceHistory(store),root=path.join(dir,'project');await fs.mkdir(root);await history.open({root,name:'Synthetic'});
 const entries=Array.from({length:6},()=>({id:require('node:crypto').randomUUID(),title:'Corrupt',updatedAt:new Date().toISOString()}));await history.updateProject(root,p=>{p.chats=entries;});for(const entry of entries)await fs.writeFile(history.chatFile(root,entry.id),Buffer.alloc(8*1024*1024));
 const open=fs.open;let bytes=0;fs.open=async(...args)=>{const fd=await open(...args);return {stat:()=>fd.stat(),read:async(...values)=>{const result=await fd.read(...values);bytes+=result.bytesRead;return result;},close:()=>fd.close()};};
 try{const result=await searchHistory(history,{query:'anything'});assert.equal(result.results.length,0);assert.equal(result.skipped,6);assert.ok(bytes>0&&bytes<=32*1024*1024,`Read ${bytes} bytes`);}finally{fs.open=open;}
});
