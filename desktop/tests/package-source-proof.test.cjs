const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { sourceProof, verify } = require('../scripts/package-source-proof.cjs');
async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'aura-package-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const desktop=path.join(root,'desktop');await fs.mkdir(desktop);await fs.writeFile(path.join(desktop,'main.cjs'),'// Synthetic source\n');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}});
 git('init','--quiet');git('add','desktop/main.cjs');git('-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic product source');
 return {root,desktop,git};
}
test('source proof binds exact committed product bytes and accepts later documentation-only commits',async t=>{
 const f=await fixture(t),proof=await sourceProof(f.desktop,['main.cjs']);assert.equal((await verify(f.desktop,proof)).files,1);
 await fs.writeFile(path.join(f.root,'README.md'),'Synthetic documentation');f.git('add','README.md');f.git('-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic documentation');
 assert.notEqual(f.git('rev-parse','HEAD').trim(),proof.sourceCommit);assert.equal((await verify(f.desktop,proof)).sourceCommit,proof.sourceCommit);
});
test('uncommitted product bytes cannot be stamped as committed release source',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.desktop,'main.cjs'),'// Modified\n');await assert.rejects(sourceProof(f.desktop,['main.cjs']),/Commit produktændringen/);
});
test('source proof rejects changed bytes, invalid commit, path traversal and a rewritten digest',async t=>{
 const f=await fixture(t),proof=await sourceProof(f.desktop,['main.cjs']);
 for(const next of [{...proof,sourceCommit:'bad'}, {...proof,files:{'desktop/../secret':'0'.repeat(64)}}, {...proof,files:{'desktop/main.cjs':'0'.repeat(64)}}])await assert.rejects(verify(f.desktop,next));
 await fs.writeFile(path.join(f.desktop,'main.cjs'),'// Changed after packaging\n');await assert.rejects(verify(f.desktop,proof),/matcher ikke/);
});
