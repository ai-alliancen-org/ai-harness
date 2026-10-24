// The native picker boundary is injected; discovery and selected reads use real
// files created solely for these tests. No account, user data or UI is involved.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {installChatMaterials,METHODS}=require('../core/chat-materials-ipc.cjs');
const {materialText}=require('../core/chat-materials.cjs');
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-folder-ipc-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const project={root},chat={id:'folder-chat',project,root,generation:0},handlers=new Map(),calls=[];let picker=async()=>({canceled:true}),selected=true;
 const bench={project,chatID:chat.id,chats:new Map([[chat.id,chat]]),chatFor(id){return this.chats.get(id);},busyRoot(){return false;}};
 installChatMaterials({getWorkbench:()=>bench,isSelected:()=>selected,register(channel,fn){handlers.set(Object.keys(METHODS).find(key=>METHODS[key]===channel),fn);},dialog:{showOpenDialog:options=>{calls.push(options);return picker(options);}},exclusive:fn=>fn()});
 return{root,chat,bench,calls,pick:fn=>picker=fn,deselect:()=>selected=false,call:(method,input={})=>handlers.get(method)({chat:chat.id,...input})};
}
test('folder IPC discloses only explicitly previewed files and never authorizes its directory as tool context',async t=>{
 const f=await fixture(t),folder=path.join(f.root,'reference');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'chosen.md'),'Selected ordinary text.');await fs.writeFile(path.join(folder,'other.md'),'Unselected ordinary text.');
 f.pick(async()=>({canceled:false,filePaths:[folder]}));const offered=await f.call('chatMaterialsChooseFolder');
 assert.deepEqual(f.calls[0].properties,['openDirectory','dontAddToRecent']);assert.equal(Object.hasOwn(f.calls[0],'filters'),false);assert.deepEqual(offered.selected,[]);assert.ok(offered.candidates.every(file=>!Object.hasOwn(file,'text')));assert.equal(JSON.stringify(offered).includes(f.root),false);
 const chosen=offered.candidates.find(file=>file.name==='chosen.md');const review=await f.call('chatMaterialsPreview',{scope:offered.scope,revision:offered.revision,ids:[chosen.id]});
 const attached=await f.call('chatMaterialsAttach',{scope:review.scope,revision:review.revision,token:review.token});
 const snapshot=await f.bench.chatMaterials.resolveSelection(f.chat,{scope:attached.scope,revision:attached.revision});
 assert.equal(snapshot.files.length,1);assert.equal(snapshot.files[0].text,'Selected ordinary text.');assert.equal(JSON.stringify(snapshot).includes(f.root),false);assert.equal(materialText(snapshot).includes('Unselected ordinary text.'),false);assert.match(materialText(snapshot),/ingen adgang til kildemapper/);
 assert.equal(await fs.readFile(path.join(folder,'chosen.md'),'utf8'),'Selected ordinary text.');assert.equal(await fs.readFile(path.join(folder,'other.md'),'utf8'),'Unselected ordinary text.');
});
test('folder IPC rejects renderer-supplied paths, multiple native roots and delayed results for a deselected project',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.call('chatMaterialsChooseFolder',{path:f.root}),/ingen filstier/);assert.equal(f.calls.length,0);
 f.pick(async()=>({canceled:false,filePaths:[f.root,f.root]}));await assert.rejects(f.call('chatMaterialsChooseFolder'),/én konkret/);
 let release;f.pick(()=>new Promise(resolve=>release=resolve));const pending=f.call('chatMaterialsChooseFolder');f.deselect();release({canceled:false,filePaths:[path.join(f.root,'never-read')]});
 await assert.rejects(pending,/Samtalen er skiftet/);assert.deepEqual(f.bench.chatMaterials.state(f.chat).candidates,[]);assert.deepEqual(f.bench.chatMaterials.state(f.chat).selected,[]);
});
