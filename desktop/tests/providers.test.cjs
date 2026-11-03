const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {normalize,listModels,disclosure,engineProvider}=require('../core/connections.cjs');
const {startGateway}=require('../core/gateway.cjs');
test('Large 4 bruger Mistrals adapter, kataloggrænser og listepris uden en permanent lanceringsrabat', () => {
 const {modelLimits,priceFor}=require('../core/connections.cjs');
 const connection=normalize({kind:'mistral',name:'Min Mistral'});
 for(const id of ['mistral-large-4','mistral-large-4-0']) {
  const model={id,name:'Mistral Large 4'};
  assert.equal(engineProvider(connection,model,'http://127.0.0.1:1/v1','midlertidig').npm,'@ai-sdk/mistral');
  assert.deepEqual(modelLimits(connection,model),{context:1000000,output:32000,input:200000});
  // Kataloget har forrang op til Auras højeste svarloft på 128.000, og samtalen komprimeres ved 200.000.
  assert.deepEqual(modelLimits(connection,{...model,limits:{context:524288,output:262144}}),{context:524288,output:128000,input:200000});
  assert.deepEqual(priceFor(connection,model),{input:1.36,output:4.18,cacheRead:0.14,cacheWrite:1.36});
  const data=disclosure(connection,model);
  assert.match(data.price,/kontrolleret 2026-10-07/);
  assert.match(data.price,/lanceringsrabat er ikke trukket fra/);
  assert.match(data.price,/https:\/\/docs.mistral.ai\/inference\/pricing/);
  assert.equal(data.checkedAt,'2026-09-29','prisopslaget må ikke foregive et nyt opslag af datavilkårene');
  assert.match(data.priceShort,/normal listepris/);
 }
 assert.equal(priceFor(connection,{id:'mistral-large-latest'}),null,'et flytbart alias får ikke automatisk Large 3-prisen');
 assert.equal(priceFor(connection,{id:'mistral-large-4-1'}),null,'en ukendt fremtidig version får ingen opdigtet pris');
 const priced={id:'mistral-large-4',price:{prompt:'0.00000068',completion:'0.00000209',input_cache_read:'0.00000007'}};
 for(const [field,value] of Object.entries({input:0.68,output:2.09,cacheRead:0.07,cacheWrite:0.68})) assert.ok(Math.abs(priceFor(connection,priced)[field]-value)<1e-10,field);
 assert.notEqual(disclosure(connection,priced).fingerprint,disclosure(connection,{id:priced.id}).fingerprint);
 assert.equal(engineProvider({kind:'compatible'}, {id:'mistral-large-4'}, 'http://127.0.0.1:1/v1','t').npm,'@ai-sdk/openai-compatible','egne servere beholder deres valgte protokol');
});
test('Corti, Mistral og Alexandra fastholder destination; ukendte udbydere afvises',()=>{
 for(const [kind,host] of [['corti','ai.eu.corti.app'],['mistral','api.mistral.ai'],['alexandra','inference.alexandra.dk']]) {
  const c=normalize({kind,name:kind,baseURL:'https://example.invalid'});assert.equal(new URL(c.baseURL).hostname,host);
  assert.match(disclosure(c,{id:'test'}).price,/Ukendt/);
  assert.equal(engineProvider(c,{id:'test'},'http://127.0.0.1:1/v1','midlertidig').options.apiKey,'midlertidig');
 }
 assert.throws(()=>normalize({kind:'promte',name:'Promte',baseURL:'https://example.invalid'}),/understøttet/);
});
for(const kind of ['corti','mistral','alexandra']) test(`${kind}: katalog, streaming, værktøjskald og fejl gennem rigtig HTTP-gateway`,async t=>{
 const received=[];let fail=false;
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-noegle');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'kode',capabilities:{completion_chat:true,function_calling:true}},{id:'embedding',capabilities:{completion_chat:false}}]}));
  let raw='';for await(const chunk of req)raw+=chunk;received.push(JSON.parse(raw));
  if(fail){res.writeHead(401);return res.end('hemmelig leverandørfejl');}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'tool1',type:'function',function:{name:'read',arguments:'{}'}}]}}]})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c={kind,name:kind,baseURL:`http://127.0.0.1:${server.address().port}/v1`};
 const gateway=await startGateway(c,{id:'kode'},'test-noegle');
 t.after(async()=>{await gateway.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 await assert.rejects(listModels(c,''),/API-nøgle/);
 const models=await listModels(c,'test-noegle');assert.equal(models.length,1);assert.equal(models[0].capabilities.tools,true);
 const send=()=>fetch(gateway.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${gateway.token}`},body:JSON.stringify({model:'kode',stream:true,messages:[{role:'user',content:'Læs filen'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object'}}}]})});
 const response=await send();assert.match(await response.text(),/tool_calls/);assert.equal(received[0].tools[0].function.name,'read');
 fail=true;const rejected=await send();assert.equal(rejected.status,401);assert.doesNotMatch(await rejected.text(),/hemmelig/);assert.equal(received.length,2);
});
test('kendte modeller får deres dokumenterede tokengrænser; ukendte beholder de forsigtige', () => {
 const { modelLimits } = require('../core/connections.cjs');
 // Claude 5-familien: 1M kontekst og 128.000 pr. svar ifølge Anthropic. Samtalen komprimeres ved 200.000.
 assert.deepEqual(modelLimits({ kind: 'anthropic' }, { id: 'claude-sonnet-5-5' }), { context: 1000000, output: 128000, input: 200000 });
 assert.deepEqual(modelLimits({ kind: 'anthropic' }, { id: 'claude-haiku-4-5' }), { context: 200000, output: 64000 });
 assert.deepEqual(modelLimits({ kind: 'anthropic' }, { id: 'claude-opus-4-1' }), { context: 200000, output: 32000 });
 assert.deepEqual(modelLimits({ kind: 'anthropic' }, { id: 'claude-3-haiku-20240307' }), { context: 200000, output: 4096 });
 assert.deepEqual(modelLimits({ kind: 'openai' }, { id: 'gpt-5.5' }), { context: 400000, output: 128000, input: 200000 });
 // En lokal Ollama-model må bruge halvdelen af sin kontekst; tænkende qwen3-modeller kunne ellers stoppe ved 4.096.
 assert.deepEqual(modelLimits({ kind: 'ollama' }, { id: 'qwen3:8b' }), { context: 32768, output: 16384 });
 // En ukendt tænkende model får plads til både tanker og svar; en ukendt model uden tænkning får et højere loft end før.
 assert.deepEqual(modelLimits({ kind: 'compatible' }, { id: 'ukendt', capabilities: { reasoning: true } }), { context: 32768, output: 16384 });
 assert.deepEqual(modelLimits({ kind: 'compatible' }, { id: 'ukendt', limits: { context: 200000 }, capabilities: { reasoning: true } }), { context: 200000, output: 32000 });
 // En ukendt model uden tænkning får 16.384 på en egen server og 8.192 andre steder (beta 3); 4.096 skar store filer af.
 assert.deepEqual(modelLimits({ kind: 'compatible' }, { id: 'ukendt' }), { context: 32768, output: 16384 });
 // Kataloget har forrang, men et svar kan aldrig fylde mere end halvdelen af konteksten.
 assert.deepEqual(modelLimits({ kind: 'compatible' }, { id: 'lille', limits: { context: 8192, output: 8192 } }), { context: 8192, output: 4096 });
 assert.equal(engineProvider({ kind: 'anthropic', name: 'a' }, { id: 'claude-opus-5-5' }, 'http://127.0.0.1:1/v1', 't').models['claude-opus-5-5'].limit.output, 128000);
});
test('gatewayen lader en langsom strøm køre færdig, men stopper stilstand', async t => {
 let stall = false;
 const server = http.createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  // Fem bidder med 150 ms mellemrum: samlet længere end grænsen for stilstand, men aldrig stille så længe.
  for (let i = 0; i < 5; i++) { res.write(`data: {"del":${i}}\n\n`); await new Promise(r => setTimeout(r, 150)); if (stall && i === 1) await new Promise(r => setTimeout(r, 1000)); }
  res.end('data: [DONE]\n\n');
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const failures = [];
 const gateway = await startGateway({ kind: 'compatible', name: 'Prøve', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'kode' }, '', null, message => failures.push(message), { idleLimit: 400 });
 t.after(async () => { await gateway.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
 const send = () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'kode', stream: true, messages: [] }) });
 const text = await (await send()).text();
 assert.match(text, /"del":4/); assert.match(text, /\[DONE\]/); assert.deepEqual(failures, []);
 stall = true;
 await assert.rejects((await send()).text());
 assert.match(failures[0], /svarede ikke i 1 s, så forbindelsen blev afbrudt/);
});
test('Zens vilkår vises for hver model', () => {
 const zen = { kind: 'zen', name: 'Zen', baseURL: 'https://opencode.ai/zen/v1' };
 assert.match(disclosure(zen, { id: 'longcat-2.5-preview-free' }).trainingShort, /bruges ikke til træning/);
 assert.match(disclosure(zen, { id: 'muse-spark-1.3-contributor-free' }).trainingShort, /Metas modeller/);
 assert.match(disclosure(zen, { id: 'big-pickle' }).trainingShort, /forbedre modellen/);
 assert.equal(disclosure(zen, { id: 'claude-sonnet-5-5' }).regionShort, 'USA');
});

test('Corti-forbindelsen bruger adressen fra nøglens miljø og aldrig USA', () => {
  // Opdigtede nøgler i samme form som Cortis: miljøet står først, derefter resten, alt i base64.
  const key = environment => Buffer.from(`${environment}:password:testklient:testbruger:hemmelighed`).toString('base64');
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: key('fr') }).baseURL, 'https://ai.fr.corti.app/v1');
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: key('eu') }).baseURL, 'https://ai.eu.corti.app/v1');
  // KL-hackathonens projekter ligger i EU-S (Sovereign); nøglen begynder med "eu-s:".
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: key('eu-s') }).baseURL, 'https://ai.eu-s.corti.app/v1');
  assert.throws(() => normalize({ kind: 'corti', name: 'Corti', apiKey: key('us-x') }), /endnu ikke bruger/);
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: 'en-nøgle-i-et-andet-format' }).baseURL, 'https://ai.eu.corti.app/v1');
  assert.equal(normalize({ kind: 'corti', name: 'Corti' }).baseURL, 'https://ai.eu.corti.app/v1');
  assert.throws(() => normalize({ kind: 'corti', name: 'Corti', apiKey: key('us') }), /amerikanske miljø/);
  assert.throws(() => normalize({ kind: 'corti', name: 'Corti', apiKey: key('dk') }), /endnu ikke bruger/);
  // Behandlingsstedet i "Før du sender" følger adressen og har Cortis kilde.
  const france = disclosure({ kind: 'corti', name: 'Corti', baseURL: 'https://ai.fr.corti.app/v1' }, { id: 'corti-s1' });
  assert.match(france.regionShort, /Scaleway i Paris/);
  assert.equal(france.source, 'https://docs.corti.ai/authentication/environments_tenants');
  assert.match(france.recipients, /ai\.fr\.corti\.app/);
  assert.doesNotMatch(disclosure({ kind: 'corti', name: 'Corti', baseURL: 'https://ai.eu.corti.app/v1' }, { id: 'corti-s1' }).regionShort, /Paris/);
  const sovereign = disclosure({ kind: 'corti', name: 'Corti', baseURL: 'https://ai.eu-s.corti.app/v1' }, { id: 'corti-s1' });
  assert.match(sovereign.regionShort, /EU-S \(Sovereign\), hos Scaleway i Frankrig/);
  assert.match(sovereign.recipients, /ai\.eu-s\.corti\.app/);
});

test('Alexandra: DKK-priser, dokumenterede grænser og danske vilkår', () => {
  const { modelLimits, priceFor } = require('../core/connections.cjs');
  const connection = normalize({ kind: 'alexandra', name: 'Min Alexandra' });
  assert.equal(engineProvider(connection, { id: 'glm-5.3-flash' }, 'http://127.0.0.1:1/v1', 'midlertidig').npm, '@ai-sdk/openai-compatible');
  // Modelkortet oplyser kontekstvinduerne; svargrænsen er platformens eget tal fra vejledningen til kodeagenter.
  assert.deepEqual(modelLimits(connection, { id: 'glm-5.3-flash' }), { context: 1048576, output: 16384, input: 200000 });
  assert.deepEqual(modelLimits(connection, { id: 'qwen3.8-flash-next' }), { context: 262144, output: 16384, input: 200000 });
  assert.deepEqual(priceFor(connection, { id: 'glm-5.3-flash' }), { currency: 'DKK', input: 6, output: 30, cacheRead: 3, cacheWrite: 6 });
  assert.deepEqual(priceFor(connection, { id: 'qwen3.8-flash-next' }), { currency: 'DKK', input: 1, output: 5, cacheRead: 0.2, cacheWrite: 1 });
  assert.equal(priceFor(connection, { id: 'ukendt-model' }), null, 'en ukendt model får ingen opdigtet pris');
  const data = disclosure(connection, { id: 'glm-5.3-flash' });
  assert.match(data.price, /6 DKK pr\. million tokens, du sender, og 30 DKK pr\. million tokens i svar/);
  assert.match(data.price, /DKK/);
  assert.match(data.priceShort, /DKK ind og 30 DKK ud/);
  assert.match(data.price, /kontrolleret 2026-10-21/);
  assert.match(data.price, /platform\.alexandra\.dk\/platform-ui\/docs\/models/);
  assert.equal(data.checkedAt, '2026-10-21');
  assert.match(data.regionShort, /Danmark/);
  assert.match(data.retention, /slettes, når modellen er færdig med at svare/);
  assert.match(data.trainingShort, /ikke til træning/);
  assert.match(data.recipients, /inference\.alexandra\.dk/);
  // Et katalogsvar med pris har forrang og skal beholde sin valuta.
  const priced = { id: 'glm-5.3-flash', price: { currency: 'DKK', prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000015' } };
  assert.deepEqual(priceFor(connection, priced), { currency: 'DKK', input: 3, output: 15, cacheRead: 1.5, cacheWrite: 3 });
});

test('når Corti afviser nøglen, siger beskeden hvilken adresse appen prøvede', async t => {
  const { requestJSON } = require('../core/connections.cjs');
  const server = require('node:http').createServer((req, res) => { res.statusCode = 401; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  await assert.rejects(requestJSON(`http://127.0.0.1:${server.address().port}/v1/models`, { key: 'afvist', kind: 'corti' }), /Corti afviste nøglen på adressen i EU\. Brug en nøgle fra Corti Models/);
  await assert.rejects(requestJSON(`http://127.0.0.1:${server.address().port}/v1/models`, { key: 'afvist', kind: 'mistral' }), /Serveren afviste adgangen/);
});

test('corti-s1 får plads til tanker og svar, og kun de indsatsniveauer, Corti selv oplyser', () => {
  const { modelLimits, effortLevels, reasons } = require('../core/connections.cjs');
  const corti = { kind: 'corti' };
  // Cortis katalog: 1M kontekst, tænkning og indsatsniveauerne low, high og max, men intet svarloft.
  const s1 = { id: 'corti-s1', limits: { context: 1048576, output: null }, capabilities: { reasoning: true, effort: ['low', 'high', 'max'] } };
  assert.deepEqual(modelLimits(corti, s1), { context: 1048576, output: 128000, input: 200000 });
  assert.equal(reasons(corti, s1), true);
  assert.deepEqual(effortLevels(corti, s1), ['low', 'high', 'max']);
  assert.deepEqual(effortLevels(corti, { id: 'corti-s1-instant', capabilities: { reasoning: false, effort: [] } }), []);
  // Claude-modeller tager imod indsatsen low; ældre modeller uden indsats får ingen.
  assert.ok(effortLevels({ kind: 'anthropic' }, { id: 'claude-opus-5-5' }).includes('low'));
  assert.deepEqual(effortLevels({ kind: 'anthropic' }, { id: 'claude-haiku-4-5' }), []);
  assert.deepEqual(effortLevels({ kind: 'mistral' }, { id: 'mistral-large-4' }), []);
});
test('OpenCode får Auras højeste svarloft, så modellens egen grænse bestemmer', () => {
  const { isolatedEnv } = require('../core/engine.cjs');
  const { OUTPUT_CEILING } = require('../core/connections.cjs');
  assert.equal(isolatedEnv(require('node:os').tmpdir(), {}, 'adgangskode').OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, String(OUTPUT_CEILING));
  assert.equal(OUTPUT_CEILING, 128000);
});
test('gatewayen sender kun en indsats, når brugeren har valgt den, og som hver udbyder forventer', async t => {
  const received = [];
  const server = require('node:http').createServer(async (req, res) => { let raw = ''; for await (const c of req) raw += c; received.push({ url: req.url, body: JSON.parse(raw) }); res.setHeader('content-type', 'application/json'); res.end('{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (connection, model, effort, path) => {
    const gateway = await startGateway(connection, model, 'nøgle', null, () => {}, { effort });
    t.after(() => gateway.close());
    await fetch(gateway.url.replace(/\/v1$/, '') + path, { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token, 'content-type': 'application/json' }, body: JSON.stringify({ model: model.id, messages: [] }) });
    return received.at(-1).body;
  };
  const corti = { kind: 'corti', name: 'Corti', baseURL: base, id: 'c' };
  assert.equal((await send(corti, { id: 'corti-s1' }, null, '/v1/chat/completions')).reasoning_effort, undefined, 'ingen indsats uden brugerens valg');
  assert.equal((await send(corti, { id: 'corti-s1' }, 'low', '/v1/chat/completions')).reasoning_effort, 'low');
  const anthropic = { kind: 'anthropic', name: 'Claude', baseURL: base, id: 'a' };
  assert.deepEqual((await send(anthropic, { id: 'claude-opus-5-5' }, 'low', '/v1/messages')).output_config, { effort: 'low' });
});
