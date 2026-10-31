const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {download}=require('../scripts/prepare-runtime.cjs');
const {generate}=require('../scripts/release-site.cjs');
const {execFileSync}=require('node:child_process');
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'harness-package-unit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('checkout med Windows-indstillinger bevarer kildefiler og downloadpakkernes bytes',async t=>{
 const root=await temp(t),source=path.join(root,'kilde'),output=path.join(root,'checkout med mellemrum');
 await fs.mkdir(source);await fs.mkdir(output);
 const repository=path.join(__dirname,'../..');
 const attributes=await fs.readFile(path.join(repository,'.gitattributes'),'utf8');
 await fs.writeFile(path.join(source,'.gitattributes'),attributes+'\nkontrol.txt text eol=crlf\n');
 await fs.writeFile(path.join(source,'kontrol.txt'),'kontrol\n');
 const catalog=JSON.parse(await fs.readFile(path.join(repository,'site/dist/catalog.json'),'utf8'));
 const archive=catalog.tools.find(tool=>tool.id==='codex').archive;
 const files=['profiles/skills/harness-ide-og-afgraensning/SKILL.md','site/dist/catalog.json','site/dist/'+archive];
 for(const file of files){await fs.mkdir(path.dirname(path.join(source,file)),{recursive:true});await fs.copyFile(path.join(repository,file),path.join(source,file));}
 const git=args=>execFileSync('git',['-C',source,'-c','core.autocrlf=true',...args],{stdio:'pipe'});
 git(['init']);git(['add','.']);git(['checkout-index','--all','--prefix='+output.replaceAll('\\','/')+'/']);
 assert.equal(await fs.readFile(path.join(output,'kontrol.txt'),'utf8'),'kontrol\r\n','Prøven fremkalder faktisk Windows-linjeskift');
 for(const file of files)assert.deepEqual(await fs.readFile(path.join(output,file)),await fs.readFile(path.join(repository,file)),file);
});
test('runtime-download afviser forkert kontrolsum og bruger verificeret cache',async t=>{
 const root=await temp(t), file=path.join(root,'runtime.tar.gz'), data=Buffer.from('syntetisk runtime');
 const entry={url:'https://example.invalid/runtime',checksum:createHash('sha256').update(data).digest('hex')};
 const original=global.fetch;let calls=0;t.after(()=>global.fetch=original);
 global.fetch=async()=>{calls++;return new Response('forkert');};
 await assert.rejects(download(entry,file),/Kontrolsum/);await assert.rejects(fs.access(file));
 await fs.writeFile(file,data);await download(entry,file);assert.equal(calls,1);
});
test('downloadside viser kun eksisterende pakker og notarisation med matchende filhash',async t=>{
 const root=await temp(t),name='Aura-0.2.0-beta.4-mac-arm64.dmg';await fs.writeFile(path.join(root,name),'testpakke');await fs.writeFile(path.join(root,'privat.env'),'ikke en download');
 await fs.writeFile(path.join(root,name+'.notarized.json'),JSON.stringify({status:'Accepted',sha256:'forkert'}));
 let files=await generate(root);assert.equal(files.length,1);assert.equal(files[0].notarized,false);
 await fs.writeFile(path.join(root,name+'.notarized.json'),JSON.stringify({status:'Accepted',sha256:files[0].sha256,id:'12345678-1234-1234-1234-123456789abc',checkedAt:'2026-10-13T08:00:00Z'}));
 files=await generate(root);assert.equal(files[0].notarized,true);
 const html=await fs.readFile(path.join(root,'index.html'),'utf8');assert.match(html,/Notariseret af Apple/);assert.ok(!html.includes('privat.env'));
 assert.match(html,/<img[^>]+src="images\/aura-icon\.png"/);
 assert.match(html,/<link rel="icon"[^>]+href="images\/aura-icon\.png"/);
 assert.match(html,/<link rel="apple-touch-icon"[^>]+href="images\/aura-icon\.png"/);
 assert.deepEqual(await fs.readFile(path.join(root,'images/aura-icon.png')),await fs.readFile(path.join(__dirname,'../../docs/images/aura-icon.png')),'Den lokale downloadside bevarer Aura-logoets faktiske bytes');
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'release.json'),'utf8')).version,'0.2.0-beta.4','En ældre pakke må ikke få kildekodens nye versionsnummer');
 await fs.writeFile(path.join(root,'Aura-0.2.0-beta.5-win-x64.exe'),'anden version');
 await assert.rejects(generate(root),/flere appversioner/);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'release.json'),'utf8')).version,'0.2.0-beta.4','Ugyldige input må ikke overskrive den tidligere oversigt');
});
test('Git-opstartsformular udfylder kun manglende lokal identitet',async t=>{
 const {GitVersions,run}=require('../core/git.cjs'),root=await temp(t),git=new GitVersions();
 await git.initialize(root);
 await run(root,['config','--local','user.name','']);await run(root,['config','--local','user.email','']);
 await assert.rejects(git.setIdentity(root,{name:'Test',email:'forkert'}),/gyldig/);
 await git.setIdentity(root,{name:'Testperson',email:'test@example.invalid'});
 assert.equal((await run(root,['config','--local','user.name'])).toString().trim(),'Testperson');
 await assert.rejects(git.setIdentity(root,{name:'Anden',email:'anden@example.invalid'}),/allerede/);
});
test('pakket runtime afviser forkert platform og manglende værktøjer',async t=>{
 const root=await temp(t);await fs.mkdir(path.join(root,'runtime'));const manifest=path.join(root,'runtime/manifest.json');
 const runtime=require('../core/runtime.cjs');await fs.writeFile(manifest,JSON.stringify({target:'ukendt'}));assert.throws(()=>runtime.configure(root),/passer ikke/);
 await fs.writeFile(manifest,JSON.stringify({target:`${process.platform}-${process.arch}`}));assert.throws(()=>runtime.configure(root),/mangler git/);
});
test('motorens forventede version er den låste OpenCode-version', () => {
  assert.equal(require('../core/engine.cjs').VERSION, require('../runtime-lock.json').opencode);
});

// Filer, der startes som egne processer, skal ligge uden for app.asar; ellers kan den pakkede app ikke starte dem.
// verify-package-source læser med asar.extractFile og opdager derfor ikke en manglende post her.
test('filer, der startes som egne processer, pakkes ud af app.asar',()=>{
 const unpack=require('../electron-builder.cjs').asarUnpack;
 for(const file of ['core/engine-guardian.cjs','core/dev-server-runner.cjs','core/command-sandbox-runner.mjs'])assert.ok(unpack.includes(file),file);
});

// Et relativt krav til en fil uden for fillisten virker i udvikling og får den pakkede app til at fejle ved
// indlæsningen. verify-package-source sammenligner kun de filer, den selv lister, og ser derfor ikke et krav,
// der peger ud af pakken. Vagten læser fillisten fra electron-builder.cjs og går appkodens krav igennem.
// Afgrænsning: kun krav med en skrevet relativ sti. Et beregnet require fanges ikke.
test('appkodens relative krav peger kun på filer, der pakkes', async () => {
  const root = path.join(__dirname, '..');
  const patterns = require('../electron-builder.cjs').files;
  const packed = name => patterns.some(p => p.endsWith('/**/*') ? name.startsWith(p.slice(0, -4)) : p === name);
  const listed = await require('../scripts/verify-package-source.cjs').files(path.join(root, 'core'), 'core/');
  const code = ['main.cjs', 'preload.cjs', ...listed.filter(name => /\.(cjs|mjs)$/.test(name))];
  const missing = [];
  for (const file of code) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    for (const [, specifier] of text.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      await fs.access(path.join(root, target));
      if (!packed(target)) missing.push(`${file} kræver ${specifier}, og ${target} pakkes ikke`);
    }
  }
  assert.deepEqual(missing, [], 'Krav, der ikke følger med i den pakkede app:\n' + missing.join('\n'));
});
