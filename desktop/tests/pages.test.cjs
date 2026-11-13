const {test}=require('node:test');
const assert=require('node:assert/strict');
const {render,build}=require('../../scripts/build-pages.cjs');
const {assertPublicPages}=require('../../scripts/pages-access.cjs');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const meta={full_name:'ai-alliancen-org/ai-harness',private:true};
const name='AI-Harness-0.2.0-beta.1-mac-arm64.dmg';
const release={tag_name:'v0.2.0-beta.1',published_at:'2026-09-25T12:00:00Z',draft:false,prerelease:true,assets:[{name,size:1234,state:'uploaded',browser_download_url:`https://github.com/${meta.full_name}/releases/download/v0.2.0-beta.1/${name}`,digest:'sha256:'+'a'.repeat(64)}]};
// Udgivelser fra før navneskiftet hedder AI-Harness-…, nye hedder Aura-…; begge vises.
test('Pages viser installationsfiler med det nye og det tidligere navn',()=>{const aura='Aura-0.2.0-beta.4-mac-arm64.dmg';const html=render([{...release,tag_name:'v0.2.0-beta.4',assets:[{...release.assets[0],name:aura,browser_download_url:`https://github.com/${meta.full_name}/releases/download/v0.2.0-beta.4/${aura}`}]}],meta);assert.match(html,/Hent Mac · Apple-chip/);assert.match(html,/Aura-0\.2\.0-beta\.4-mac-arm64\.dmg/);assert.match(render([release],meta),/AI-Harness-0\.2\.0-beta\.1/);});
test('Pages viser adgangskrav og ingen opdigtede downloads',()=>{assert.match(render([],meta),/kræver login/);assert.doesNotMatch(render([],meta),/Hent Mac/);assert.doesNotMatch(render([{...release,draft:true}],meta),/Hent Mac/);});
test('Pages springer tomme udgivelser over og skjuler forkerte versioner, ZIP-apps og filer uden kontrolsum',()=>{
 const empty={...release,tag_name:'v0.2.0-beta.6',published_at:'2026-10-13T12:00:00Z',assets:[]};
 assert.match(render([empty,release],meta),/v0\.2\.0-beta\.1/);
 for(const asset of [{...release.assets[0],digest:null},{...release.assets[0],size:0},{...release.assets[0],name:name.replace('.dmg','.zip')},{...release.assets[0],name:name.replace('beta.1','beta.6')}])assert.doesNotMatch(render([{...release,assets:[asset]}],meta),/Hent Mac/);
});
test('Pages bruger faktiske releasefiler og afviser fremmede links',()=>{const html=render([release],meta);assert.match(html,/Hent Mac · Apple-chip/);assert.match(html,/SHA-256/);assert.throws(()=>render([{...release,assets:[{...release.assets[0],browser_download_url:'https://example.org/fil'}]}],meta),/matcher ikke/);assert.doesNotMatch(render([{...release,assets:[{name:'.env',state:'uploaded'}]}],meta),/\.env/);});
test('Pages bevarer instruktionspakker og bygger tom tilstand fra rigtige skabeloner',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harness-pages-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await build([],meta,dir);assert.match(await fs.readFile(path.join(dir,'index.html'),'utf8'),/Installationsfilerne klargøres/);assert.match(await fs.readFile(path.join(dir,'pakker.html'),'utf8'),/Claude/);const catalog=JSON.parse(await fs.readFile(path.join(dir,'catalog.json'),'utf8'));await fs.access(path.join(dir,catalog.tools.find(tool=>tool.id==='codex').archive));await fs.access(path.join(dir,'skills.html'));assert.match(JSON.stringify(catalog),/harness-sikkerhedsgennemgang/);assert.ok(!(await fs.readdir(dir)).some(f=>f.endsWith('.dmg')));});

test('Offentlig beta viser betastatus og faktiske downloads uden privat adgangstekst', async t => {
  const publicMeta = { ...meta, private: false, visibility: 'public' };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-pages-public-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await build([release], publicMeta, dir);
  const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /UDVIKLINGSBETA/);
  assert.match(html, /EUPL-1\.2/);
  assert.match(html, /docs\/beta\.md/);
  assert.match(html, /SECURITY\.md/);
  assert.match(html, /Hent Mac/);
  assert.doesNotMatch(html, /kræver login|privat(e| )repository|licens og vedligeholdelsesansvar skal/);
  assert.doesNotMatch(render([], publicMeta), /kræver login|Hent Mac/);
});

test('Pages afviser privat, ukendt eller forkert repository før offentlig udgivelse', () => {
  const pages = { public: true, build_type: 'workflow' };
  const publicMeta = { ...meta, private: false, visibility: 'public' };
  assert.doesNotThrow(() => assertPublicPages(publicMeta, pages));
  for (const repository of [meta, {}, null, { ...publicMeta, private: 'false' }, { ...publicMeta, visibility: 'private' }, { ...publicMeta, full_name: 'other/repo' }]) {
    assert.throws(() => assertPublicPages(repository, pages), /repositoryet skal være offentligt/);
  }
});

test('Pages afviser manglende adgangsoplysninger og automatisk branch-bygning', () => {
  const publicMeta = { ...meta, private: false, visibility: 'public' };
  for (const pages of [null, {}, { public: false, build_type: 'workflow' }, { public: 'true', build_type: 'workflow' }, { public: true, build_type: 'legacy' }, { public: true }]) {
    assert.throws(() => assertPublicPages(publicMeta, pages), /Pages skal være offentlig/);
  }
});

test('Pages inkluderer kun de anvendte README-billeder og bevarer originalerne', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-pages-images-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await build([], meta, dir);
  const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
  const referenced = [...html.matchAll(/<img\b[^>]*\bsrc="images\/([^"/]+)"/g)].map(match => match[1]);
  assert.ok(referenced.length > 0);
  assert.deepEqual((await fs.readdir(path.join(dir, 'images'))).sort(), [...new Set(referenced)].sort());
  for (const name of referenced) {
    assert.deepEqual(await fs.readFile(path.join(dir, 'images', name)), await fs.readFile(path.join(__dirname, '../../docs/images', name)));
  }
  await assert.rejects(fs.access(path.join(dir, 'docs')));
  await assert.rejects(fs.access(path.join(dir, 'images/aura-velkomst.png')));
});
