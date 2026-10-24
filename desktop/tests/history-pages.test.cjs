const test = require('node:test'), assert = require('node:assert/strict');
const { takePrevious, PAGE_SIZE } = require('../ui/history-pages.js');
test('pages exhaust retained records in order without duplication or changing the stored transcript', () => {
  const messages = Array.from({length:200}, (_,id) => Object.freeze({id,role:id%2?'assistant':'user',text:`Stored message ${id}`}));
  Object.freeze(messages); const original=JSON.stringify(messages); let remaining=messages, restored=[];
  while (remaining.length) { const page=takePrevious(remaining); assert.ok(page.recent.length<=PAGE_SIZE); assert.ok(page.older.length<remaining.length); restored=[...page.recent,...restored]; remaining=page.older; }
  assert.deepEqual(restored,messages); assert.equal(new Set(restored.map(m=>m.id)).size,200); assert.equal(JSON.stringify(messages),original);
});
test('long Unicode records are kept intact and per-page rendering is bounded', () => {
  const messages=Array.from({length:12}, (_,id)=>({id,text:'🟢'.repeat(10000)}));
  const page=takePrevious(messages); assert.equal(page.recent.length,3); assert.equal(page.older.length,9); assert.equal(page.recent[0].text,messages[9].text);
  const oversized=takePrevious([{text:'x'.repeat(70000)}]); assert.equal(oversized.recent.length,1,'always make progress even for a legacy oversized record');
});
test('empty and short histories need no loader, and input validation never mutates drafts or plan records', () => {
  assert.deepEqual(takePrevious([]),{older:[],recent:[]});
  const state={messages:[{role:'user',text:'Only message'}],draft:'Keep this',plan:{id:'approved'},approvals:['permission']};
  const before=structuredClone(state); assert.equal(takePrevious(state.messages).older.length,0); assert.deepEqual(state,before);
  assert.throws(()=>takePrevious(null),TypeError);
});
