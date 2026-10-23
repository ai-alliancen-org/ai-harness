const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute the actual navigation function with a live-transcript fixture. UI
// editors are deliberately outside this fixture and must never be reinitialized.
const app=fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8'),start=app.indexOf('window.openStoredMessage = async result =>'),end=app.indexOf('// Forbindelser bliver gemt',start),code=app.slice(start,end);
function fixture(running=false){
 const project={id:'a'.repeat(64),root:'/synthetic/project'},chat='11111111-1111-1111-1111-111111111111',messages=[{id:'persisted-message',role:'assistant',text:'Stored answer'}],actions=[];
 const owner={id:chat,running,log:{children:[],replaceChildren(){this.children=[];},querySelectorAll(){return[];}},parts:new Map(),assistantText:new Map(),pendingMarkdown:new Set()};
 const context={window:{chats:{projects:()=>[project],openChat:async()=>{actions.push('select chat');}}},current:{root:project.root},view:owner,anyRunning:()=>false,saveChatDraft:async required=>{assert.equal(required,true);actions.push('save draft');},call:async method=>{assert.equal(method,'chatOpen');return{workspace:{messages}};},fillChat:()=>{throw Error('Do not reinitialize plan/brief editors');},appendMessage:(text,role,v)=>{assert.equal(v,owner);const element={dataset:{},classList:{add(){}},scrollIntoView(){},focus(){}};v.log.children.push(element);return element;}};
 vm.runInNewContext(code,context);return{context,owner,actions,result:{project:project.id,chat,message:'persisted-message'}};
}
test('opening a newly persisted same-chat message reloads only transcript, preserving editor state',async()=>{
 const f=fixture();const target=await f.context.window.openStoredMessage(f.result);assert.equal(target.dataset.messageId,'persisted-message');assert.equal(f.owner.log.children.length,1);assert.deepEqual(f.actions,['save draft','select chat']);assert.equal(f.owner.followChat,false);
});
test('a missing message never rebuilds the transcript of a running task',async()=>{
 const f=fixture(true);await assert.rejects(f.context.window.openStoredMessage(f.result),/arbejder stadig/);assert.equal(f.owner.log.children.length,0);
});
