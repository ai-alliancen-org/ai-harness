const {test}=require('node:test');
const assert=require('node:assert/strict');
const {select,serialize}=require('../core/network-report.cjs');
const now=Date.parse('2026-10-26T19:00:00Z');
const snapshot={scope:'aura-only',startedAt:'2026-10-26T18:00:00Z',dropped:4,coverage:[{category:'subprocess',status:'not-covered',note:'Ikke registreret'}],limits:['Ingen fuld computerlog'],records:[
  {startedAt:'2026-10-26T17:59:00Z',category:'model',status:'completed',host:'old.example',httpStatus:200},
  {startedAt:'2026-10-26T18:58:00Z',category:'model',status:'failed',host:'api.example',httpStatus:429,firstBodyMs:null},
  {startedAt:'2026-10-26T18:59:00Z',category:'catalog',status:'completed',host:'api.example',httpStatus:200}
]};
test('report filters select only the requested time, category and result without changing journal',()=>{
  const result=select(snapshot,{period:'5m',category:'model',status:'failed'},now);
  assert.equal(result.records.length,1);assert.equal(result.records[0].httpStatus,429);
  assert.equal(select(snapshot,{period:'session'},now).records.length,2);
  assert.equal(select(snapshot,{period:'all'},now).records.length,3);
  assert.equal(snapshot.records.length,3);
});
test('export ignores renderer record injection and includes coverage in JSON and CSV',()=>{
  const report=select(snapshot,{period:'all',records:[{host:'injected'}]},now);
  const json=serialize(report,'json'), csv=serialize(report,'csv');
  assert.equal(json.includes('injected'),false);assert.equal(csv.includes('injected'),false);
  assert.match(csv,/Ingen fuld computerlog/);assert.match(csv,/Ikke registreret/);
  assert.equal(JSON.parse(json).records[1].firstBodyMs,null);assert.match(csv,/Ikke målt/);
  assert.throws(()=>serialize(report,'html'));
});
test('CSV protects spreadsheet cells and retains limits even without matching records',()=>{
  const injection={...snapshot,records:[{host:'=HYPERLINK("https://example.org")',purpose:'+SUM(1,2)',method:'POST'}]};
  const csv=serialize(injection,'csv');assert.match(csv,/'=HYPERLINK/);assert.match(csv,/'\+SUM/);
  const empty=serialize({...snapshot,records:[]},'csv');assert.match(empty,/Ingen fuld computerlog/);assert.match(empty,/aura-only/);
});
