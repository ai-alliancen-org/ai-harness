// SPDX-License-Identifier: EUPL-1.2
// Real filesystem reads and snapshots on newly owned synthetic fixtures only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ChatMaterials, LIMITS, materialText } = require('../core/chat-materials.cjs');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aura-chat-materials-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project={root:path.join(root,'project')}, chat={id:'chat-one',project,generation:0}, events=[], service=new ChatMaterials({onChange:value=>events.push(value)});
  await fs.mkdir(project.root); const write=async(name,text)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);return file;};
  const attach=async(file)=>{const offer=await service.offerFiles(chat,[file]);const preview=await service.preview(chat,{...ref(offer),ids:[offer.candidates[0].id]});return service.attach(chat,{...ref(preview),token:preview.token});};
  return{root,project,chat,events,service,write,attach};
}
const ref=value=>({scope:value.scope,revision:value.revision});
test('folder discovery is bounded metadata and excludes hidden/generated/secret/symlink entries before any selected content read',async t=>{
  const f=await fixture(t);await f.write('folder/good.md','selected text');await f.write('folder/secret.txt','api_key = "'+'x'.repeat(30)+'"');await f.write('folder/.env','protected');await f.write('folder/node_modules/pkg/source.js','generated');await fs.symlink(path.join(f.root,'folder/good.md'),path.join(f.root,'folder/alias.md'));
  const state=await f.service.offerFolder(f.chat,path.join(f.root,'folder'));assert.deepEqual(state.candidates.map(item=>item.name).sort(),['good.md','secret.txt']);assert.ok(state.candidates.every(item=>!Object.hasOwn(item,'text')));
  const good=state.candidates.find(item=>item.name==='good.md'),secret=state.candidates.find(item=>item.name==='secret.txt');const preview=await f.service.preview(f.chat,{...ref(state),ids:[good.id]});assert.equal(preview.files.length,1);assert.equal(preview.files[0].folder,'folder');await assert.rejects(f.service.preview(f.chat,{...ref(state),ids:[secret.id]}),/nøgle eller adgangskode/);
  await Promise.all(Array.from({length:120},(_,i)=>f.write(`many/file-${i}.txt`,'x')));const bounded=await f.service.offerFolder(f.chat,path.join(f.root,'many'));assert.ok(bounded.candidates.length<=LIMITS.candidates);assert.equal(bounded.truncated,true);
});
test('disk and home folder selections are rejected without discovering or reading their contents',async t=>{
  const f=await fixture(t);let reads=0;f.service.read=async()=>{reads++;throw new Error('Content must not be read.');};
  for(const folder of [path.parse(f.root).root,await fs.realpath(os.homedir())])await assert.rejects(f.service.offerFolder(f.chat,folder),/ikke hele hjemmet eller disken/);
  assert.equal(reads,0);assert.deepEqual(f.service.state(f.chat).candidates,[]);assert.deepEqual(f.service.state(f.chat).selected,[]);
});
test('discovery stops below its depth boundary and marks omitted descendants without implicit attachment',async t=>{
  const f=await fixture(t);const allowed=Array.from({length:LIMITS.depth},(_,i)=>`level-${i}`).join('/');
  await f.write(`folder/${allowed}/included.md`,'Selected depth.');await f.write(`folder/${allowed}/deeper/omitted.md`,'Unselected deeper text.');
  let reads=0;const original=f.service.read.bind(f.service);f.service.read=async(...args)=>{reads++;return original(...args);};
  const state=await f.service.offerFolder(f.chat,path.join(f.root,'folder'));
  assert.deepEqual(state.candidates.map(file=>file.name),[`${allowed}/included.md`]);assert.equal(state.truncated,true);assert.equal(reads,0);assert.deepEqual(state.selected,[]);
});
test('replacement of a discovered folder with a symlink cannot reuse its earlier file handles',async t=>{
  const f=await fixture(t);await f.write('folder/source.md','Original selected source.');await f.write('replacement/source.md','Unapproved replacement.');
  const state=await f.service.offerFolder(f.chat,path.join(f.root,'folder'));
  await fs.rename(path.join(f.root,'folder'),path.join(f.root,'original-folder'));await fs.symlink(path.join(f.root,'replacement'),path.join(f.root,'folder'));
  await assert.rejects(f.service.preview(f.chat,{...ref(state),ids:[state.candidates[0].id]}),/Symbolske links|ændret/);
  assert.deepEqual(f.service.state(f.chat).selected,[]);assert.equal(await fs.readFile(path.join(f.root,'original-folder/source.md'),'utf8'),'Original selected source.');
});
