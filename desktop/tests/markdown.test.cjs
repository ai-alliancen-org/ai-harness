const {test}=require('node:test'),assert=require('node:assert/strict');
const {render,cells,linkURL}=require('../ui/markdown.js');
const {externalURL}=require('../core/external-links.cjs');
// In-memory DOM boundary: setting textContent creates text, never HTML.
function element(tag='div') {
 const doc={createElement:tag=>make(tag)};
 function make(tag) { return {tagName:tag.toUpperCase(),ownerDocument:doc,children:[],classList:{add(){}},setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},get textContent(){return this.children.map(x=>typeof x==='string'?x:x.textContent).join('');},set textContent(text){this.children=[String(text)];}}; }
 return make(tag);
}
const all=(el,tag)=>[...(el.tagName===tag?[el]:[]),...el.children.filter(c=>typeof c==='object').flatMap(c=>all(c,tag))];
test('tables render safe text and escaped or code pipes; unclosed code remains code while streaming',()=>{
 assert.deepEqual(cells('| A\\|B | `x|y` |'),['A|B','`x|y`']);
 const el=element();render(el,'| Navn | Status |\n| --- | --- |\n| <img src=x onerror=alert(1)> | **Klar** |\n\n```js\nconst x = "<script>";');
 assert.equal(all(el,'TABLE').length,1);assert.equal(all(el,'TH').length,2);assert.equal(all(el,'IMG').length,0);assert.equal(all(el,'SCRIPT').length,0);assert.match(all(el,'TD')[0].textContent,/<img/);assert.match(all(el,'CODE').at(-1).textContent,/const x/);
 render(el,'**Færdig**\n\n- Punkt\n\n```js\nvalue();\n```');assert.equal(all(el,'TABLE').length,0);assert.equal(all(el,'UL').length,1);assert.equal(all(el,'STRONG').length,1);
});
test('copy and external opens only happen on explicit clicks, with exact content',async()=>{
 const el=element(),copies=[],opens=[],source='Læs [vejledning](https://example.org/docs).\n\n```js\nconst x = 1;\n```';render(el,source,{copy:async text=>copies.push(text),openLink:async url=>opens.push(url)});
 assert.deepEqual(copies,[]);assert.deepEqual(opens,[]);const buttons=all(el,'BUTTON');await buttons.find(b=>b.textContent==='Kopiér kode').onclick();await buttons.find(b=>b.textContent==='Kopiér svar').onclick();assert.deepEqual(copies,['const x = 1;',source]);await buttons.find(b=>b.textContent==='vejledning').onclick();assert.deepEqual(opens,['https://example.org/docs']);
});
test('host and renderer reject executable schemes, credentials, controls and unexpected fields',()=>{
 for(const url of ['file:///tmp/x','java'+'script:alert(1)','data:text/html,x','vscode://command/x','https://user:password@example.org','https://example.org/%0aevil','https://example.org/\nevil']){assert.equal(linkURL(url),null);assert.throws(()=>externalURL({url}));}
 assert.equal(externalURL({url:'https://example.org/path?q=1'}),'https://example.org/path?q=1');assert.throws(()=>externalURL({url:'https://example.org',command:'exec'}));
 const el=element();render(el,'[unsafe](file:///tmp/x) <script>alert(1)</script>',{openLink(){throw Error('must not open');}});assert.equal(all(el,'BUTTON').length,0);assert.equal(all(el,'SCRIPT').length,0);
});

test('code copying preserves blank lines and is independent of decorated DOM',async()=>{
 const el=element(),copies=[];render(el,'```txt\n\n  keep\n\n```',{copy:async text=>copies.push(text),decorate:target=>{all(target,'CODE')[0].textContent='decorated text';}});await all(el,'BUTTON').find(b=>b.textContent==='Kopiér kode').onclick();assert.deepEqual(copies,['\n  keep\n']);
});
