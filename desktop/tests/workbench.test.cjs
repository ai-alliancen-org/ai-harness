const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Workbench } = require('../core/workbench.cjs');
const { Store } = require('../core/store.cjs');
const { Skills } = require('../core/skills.cjs');
const { startGateway } = require('../core/gateway.cjs');
const { endpoint, disclosure } = require('../core/connections.cjs');
const profiles = path.join(__dirname, '../../profiles');
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-state-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('nøglelager afviser manglende kryptering; offentlige forbindelser udelader hemmeligheder', async t => {
 const store = new Store(await temp(t), { isEncryptionAvailable: () => false });
 assert.throws(() => store.encrypt('hemmelig'), /ikke tilgængelig/);
 assert.deepEqual(store.publicConnection({ id:'1', secret:'cipher' }), { id:'1', hasKey:true });
 await Promise.all([store.saveProject('/projekt-a', {selection:'a'}), store.saveProject('/projekt-b', {selection:'b'})]);
 assert.equal((await store.project('/projekt-a')).selection, 'a');
 assert.equal((await store.project('/projekt-b')).selection, 'b');
});
test('instruktioner kan tilpasses og gendannes pr. projekt uden at ændre biblioteket', async t => {
 const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {} });
 const original = (await bench.skills.list('/a')).find(s => s.id === 'harness-git-og-samarbejde');
 assert.equal(original.title, 'Git og samarbejde'); assert.equal(original.enabled, true);
 await bench.skills.save('/a', { id: original.id, content: original.content + '\nEkstra prøvekrav.' });
 assert.ok((await bench.skills.context('/a')).skills.find(s => s.name === original.id).files[0].content.includes('Ekstra prøvekrav.'));
 assert.equal((await bench.skills.list('/b')).find(s => s.id === original.id).content, original.content, 'andre projekter bruger den fælles version');
 await assert.rejects(bench.skills.save('/a', { id: original.id, content: 'Uden YAML-felt' }), /YAML-felt/);
 await assert.rejects(bench.skills.save('/a', { id: original.id, content: original.content.replace('name: harness-git-og-samarbejde', 'name: noget-andet') }), /samme som mappens navn/);
 await assert.rejects(bench.skills.save('/a', { id: 'git-og-versioner', content: 'x' }), /ugyldige/, 'appens gamle skills findes ikke længere');
 await bench.skills.save('/a', { id: original.id, content: original.content, reset: true });
 assert.equal((await bench.skills.list('/a')).find(s => s.id === original.id).customized, false);
 // Grundreglerne gælder altid. En tilpasning fra en tidligere version med YAML-felt vises uden feltet.
 await bench.store.saveProject('/a', { skills: { 'faelles-grundregler': { content: '---\nname: faelles-grundregler\ndescription: Gammel.\n---\n\nEgne regler.', enabled: false } } });
 const rules = (await bench.skills.list('/a'))[0];
 assert.equal(rules.content, 'Egne regler.'); assert.equal(rules.enabled, true);
 assert.equal((await bench.skills.context('/a')).rules, 'Egne regler.');
 // En slået fra funktion fjerner dens skills fra det, AI’en kan hente.
 await bench.features.save('/a', { scope: 'projekt', values: { versioner: false } });
 const context = await bench.skills.context('/a');
 assert.ok(!context.skills.some(s => ['harness-git-og-samarbejde', 'harness-udgivelse-og-gendannelse'].includes(s.name)));
 assert.equal(context.skills.length, 9); assert.equal(context.features.deling, false);
 assert.equal((await bench.skills.context('/b')).skills.length, 10, 'deling er ikke med i den anbefalede pakke');
 assert.deepEqual(context.skills.find(s => s.name === 'harness-design-og-tilgaengelighed').files.map(f => f.path).sort(), ['SKILL.md', 'references/designmetode.md', 'references/moenstre-og-tilstande.md', 'references/tilgaengelighed.md'], 'referencer følger med skillen');
});
test('gendannelsens markør fjerner gamle planer, også når historikskrivning fejler',async t=>{
 const bench=new Workbench({directory:await temp(t),profiles,emit:()=>{},safeStorage:{}});const project={root:bench.store.root,name:'Prøve'};await bench.activate(project);
 const id=bench.chat.id;
 await bench.history.updateChat(project.root,id,data=>{data.plan={id:'gammel',text:'Byg den gamle fil'};data.draft='Bevar kladden';});await bench.activate(project);
 const update=bench.history.updateChat.bind(bench.history);bench.history.updateChat=async()=>{throw Error('Syntetisk diskfejl');};
 await bench.invalidatePlan('gendannelse-1');assert.equal(bench.chat.plan,null);assert.equal(bench.workspace.plan,null);assert.equal(bench.workspace.draft,'Bevar kladden');assert.match(bench.chat.historyWarning,/kunne ikke/);
 bench.history.updateChat=update;await bench.activate(project);assert.equal(bench.chat.plan.id,'gammel');await bench.invalidatePlan('gendannelse-1');assert.equal(bench.chat.plan,null);assert.equal((await bench.history.readChat(project.root,id)).plan,null);
 await bench.history.updateChat(project.root,id,data=>{data.plan={id:'ny',text:'Ny plan for gendannede filer'};});await bench.activate(project);await bench.invalidatePlan('gendannelse-1');assert.equal(bench.chat.plan.id,'ny');
 // En anden samtale nulstilles, når den åbnes efter gendannelsen, og kun én gang.
 const other=(await bench.history.createChat(project.root)).id;await bench.history.updateChat(project.root,other,data=>{data.plan={id:'anden',text:'Anden plan'};data.messages=[{id:'u',role:'user',text:'Anden samtale'}];});
 await bench.openChat(other);assert.equal(bench.chat.plan,null);assert.equal(bench.chat.lastPlan.id,'anden');
 await bench.close();
});
test('stop under motoropstart sender aldrig prompten', async t => {
 let entered, release, calls=0; const reached = new Promise(r=>entered=r); const blocked = new Promise(r=>release=r);
 const bench = new Workbench({ directory:await temp(t), profiles, emit:()=>{}, safeStorage:{}, engineFactory:()=>({ active:false, start:async()=>{entered();await blocked;}, send:async()=>calls++, abort:async()=>{}, close:async()=>{} }) });
 await bench.activate({root:await temp(t),name:'Prøve'}); const chat = bench.chat;
 chat.prepared = { root:chat.root, disclosure:{fingerprint:'test'}, connection:{kind:'compatible',name:'Prøve',baseURL:'http://127.0.0.1:1/v1'}, model:{id:'test'}, references:[], context:{ rules:'', skills:[], titles:[], features:{ versioner:true } } };
 const pending = bench.send({text:'Må ikke sendes',fingerprint:'test'});
 const rejection = assert.rejects(pending, /stoppet/);
 await reached; await bench.stop(); release(); await rejection;
 assert.equal(calls,0); assert.equal(bench.running,false); assert.equal(bench.busyRoot(chat.root),false,'samtalen slipper projektet efter stop');
 await bench.close();
});
test('Stop under lagring efter afsendelse afslutter opgaven og genopliver ikke arbejdet', async t => {
 const events = []; let entered, release;
 const reached = new Promise(r => entered = r), blocked = new Promise(r => release = r);
 const bench = new Workbench({ directory: await temp(t), profiles, emit: event => events.push(event), safeStorage: {}, engineFactory: () => ({ active: true, start: async () => {}, send: async () => {}, abort: async () => {}, close: async () => {} }) });
 await bench.activate({ root: await temp(t), name: 'Prøve' }); const chat = bench.chat;
 chat.prepared = { mode: 'free', root: chat.root, disclosure: { fingerprint: 'test', consentKey: 'test' }, connection: { kind: 'compatible', name: 'Prøve', baseURL: 'http://127.0.0.1:1/v1' }, model: { id: 'test' }, references: [], context: { rules: '', skills: [], titles: [], features: {} } };
 const consent = require('../core/model-consent.cjs'), remember = consent.remember;
 t.mock.method(consent, 'remember', async (...args) => { entered(); await blocked; return remember(...args); });
 const pending = bench.send({ text: 'Stop under lagring', fingerprint: 'test' }), rejected = assert.rejects(pending, /stoppet/);
 await reached; await assert.rejects(bench.send({ text: 'Dobbeltklik', fingerprint: 'test' }), /allerede en opgave/);
 await bench.stop(); release(); await rejected;
 assert.equal(bench.running, false); assert.equal(bench.busyRoot(chat.root), false);
 assert.equal((await bench.history.readChat(chat.project.root, chat.id)).status, 'stopped');
 assert.equal(events.filter(event => event.type === 'run.status').at(-1).status, 'stopped');
 assert.equal(events.some(event => event.type === 'run.status' && event.status === 'working'), false);
 await bench.close();
});
test('gateway kræver nøgle, fastholder model og OpenRouter-udbyder uden fallback', async t => {
 const received=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received.push({headers:req.headers,body:JSON.parse(raw)});res.setHeader('content-type','application/json');res.end('{}');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const gateway=await startGateway({kind:'openrouter',baseURL:`http://127.0.0.1:${upstream.address().port}/v1`},{id:'test:free',price:{prompt:'0',completion:'0'}},'prøvenøgle',{id:'valgt',price:{prompt:'0',completion:'0'}});
 t.after(async()=>{await gateway.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
 assert.equal((await fetch(gateway.url+'/chat/completions',{method:'POST',body:'{}'})).status,401);
 const send=body=>fetch(gateway.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${gateway.token}`,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send({model:'test:free',provider:{allow_fallbacks:true},models:['anden']})).status,200);
 assert.deepEqual(received[0].body.provider,{only:['valgt'],allow_fallbacks:false,max_price:{prompt:0,completion:0,request:0,image:0}});
 assert.equal(received[0].body.models,undefined);
 assert.equal(received[0].headers.authorization,'Bearer prøvenøgle');
 await send({model:'anden'}); assert.equal(received.length,1);
 assert.equal((await send({model:'test:free'})).status,409); assert.equal(received.length,1);
});
test('serveradresser og ukendte vilkår er tydelige', () => {
 for(const value of ['file:///tmp/a','https://user:password@example.com','https://example.com/?key=secret']) assert.throws(()=>endpoint(value));
 const data=disclosure({kind:'compatible',name:'Egen server',baseURL:'http://spark:8000/v1'},{id:'qwen'});
 assert.match(data.region,/Ukendt/);assert.match(data.price,/Ukendt/);assert.match(data.security,/HTTP uden TLS/);
});

test('planlægning lukker skrive-, shell- og ukendte værktøjer, men bevarer læsebeskyttelsen', () => {
 const { permissions } = require('../core/engine.cjs');
 const policy = permissions('/projekt', [], 'plan');
 assert.equal(policy['*'], 'deny');
 for (const tool of ['write', 'edit', 'bash', 'task', 'skill', 'apply_patch']) assert.equal(policy[tool] || policy['*'], 'deny');
 assert.equal(policy.read['*.env'], 'deny');
 assert.equal(policy.read['references/*'], 'deny');
 assert.equal(policy.webfetch, 'ask');
 assert.deepEqual(policy.external_directory, { '*': 'ask' });
});

test('svar på planlægningsspørgsmål følger med i afklaringen, og afvist stop ændrer ikke status', async t => {
 const bench = new Workbench({directory:await temp(t), profiles, emit:()=>{}, safeStorage:{}});
 await bench.activate({root:await temp(t),name:'Prøve'}); const chat = bench.chat;
 chat.runMode='plan'; chat.planConversation=[]; chat.engine={request:async()=>true,close:async()=>{}}; chat.running=true;
 chat.event({type:'question.asked',properties:{id:'spørgsmål',questions:[{question:'Hvem bruger siden?',header:'Brugere',options:[]}]}});
 await bench.question({id:'spørgsmål',answers:[['Kun interne brugere']]});
 assert.match(chat.planConversation[0],/Kun interne brugere/);
 chat.runStopped=false; chat.plan={id:'bevar'}; chat.finishing=Promise.resolve();
 await assert.rejects(bench.stop(),/Afslutningen/);
 assert.equal(chat.runStopped,false); assert.equal(chat.plan.id,'bevar');
 chat.finishing=null; chat.running=false; await bench.close();
});

test('planlægning vælger plan-agenten og beholder de samme eksplicitte tilladelser', async () => {
  const { OpenCodeEngine, engineConfig, permissions } = require('../core/engine.cjs');
  for (const mode of ['plan', 'build', 'free']) {
    const engine = new OpenCodeEngine({ root: '/tmp/testprojekt', mode, model: { id: 'test' } });
    engine.active = true; engine.session = { id: 'testsession' };
    let sent;
    engine.request = async (url, method, body) => { sent = body; };
    await engine.send('Prøve', 'Regler');
    assert.equal(sent.agent, mode === 'plan' ? 'plan' : 'build');
    const permission = permissions('/tmp/testprojekt', [], mode);
    const config = engineConfig({}, { id: 'test' }, permission);
    assert.deepEqual(config.agent.plan.permission, permission);
  }
});


test('planen bruger kun sidste agentsvar; tidligere arbejdsnoter bevares som kontekst', () => {
 const { planningReply } = require('../core/workbench.cjs');
 const roles = new Map([['u', 'user'], ['a1', 'assistant'], ['a2', 'assistant']]);
 const parts = new Map([
  ['p1', {messageID:'a1', text:'Jeg undersøger filerne.'}],
  ['pu', {messageID:'u', text:'Brugerens besked'}],
  ['p2', {messageID:'a2', text:'Det bygger vi'}],
  ['p3', {messageID:'a2', text:'En side med lokale eksempeldata.'}]
 ]);
 assert.deepEqual(planningReply(roles, parts), {text:'Det bygger vi\nEn side med lokale eksempeldata.', context:'Jeg undersøger filerne.\nDet bygger vi\nEn side med lokale eksempeldata.'});
 roles.set('a3','assistant');
 assert.equal(planningReply(roles, parts).text, '', 'Et sidste svar uden tekst må ikke genbruge en tidligere arbejdsnote som plan');
 assert.equal(planningReply(new Map(),new Map()).text,'');
});

test('streamet tekst bevares ved stop, mens arbejdsnoter og tilladelser udelades', async t => {
 const directory=await temp(t), root=path.join(directory,'projekt'); await fs.mkdir(root);
 const bench=new Workbench({directory:path.join(directory,'data'),profiles,emit:()=>{},safeStorage:{}});
 await bench.activate({root,name:'Prøve'});
 const chat=bench.chat;
 chat.runUser={id:'u',role:'user',text:'Min besked'}; chat.runMode='plan'; chat.running=true;
 chat.event({type:'message.updated',properties:{info:{id:'a',role:'assistant'}}});
 chat.event({type:'message.part.updated',properties:{part:{id:'t',messageID:'a',type:'text',text:'Svar'}}});
 chat.event({type:'message.part.delta',properties:{partID:'t',field:'text',delta:' som streames'}});
 chat.event({type:'message.part.updated',properties:{part:{id:'r',messageID:'a',type:'reasoning',text:'Intern note'}}});
 chat.event({type:'permission.asked',properties:{id:'approval',permission:'edit'}});
 await bench.stop(); await bench.close();
 const reopened=await bench.activate({root,name:'Prøve'});
 assert.equal(reopened.workspace.status,'stopped'); assert.equal(reopened.workspace.plan,null);
 assert.equal(reopened.workspace.messages[1].text,'Svar som streames');
 assert.doesNotMatch(JSON.stringify(reopened.workspace), /Intern note|approval/);
 await bench.close();
});

test('Tillad for denne opgave gælder kun filer i projektmappen og kun indtil opgaven slutter', async t => {
 const all = [], replies = [], root = await temp(t);
 // Sidepanelets samlede opdateringer kommer med forsinkelse og er ikke en del af denne prøve.
 const emitted = { at: index => all.filter(event => event.type !== 'chats.updated').at(index) };
 const bench = new Workbench({ directory: await temp(t), profiles, emit: event => all.push(event), safeStorage: {} });
 await bench.activate({ root, name: 'Prøve' }); const chat = bench.chat;
 chat.running = true; chat.runMode = 'free'; chat.historyWarning = 'Ingen historik i denne prøve.';
 chat.engine = { pending: new Map(), reply: async (id, allow) => { replies.push([id, allow]); }, close: async () => {} };
 const ask = (id, permission, metadata = {}) => { const properties = { id, permission, metadata, patterns: [] }; chat.engine.pending.set(id, properties); return chat.event({ type: 'permission.asked', properties }); };
 const settle = () => new Promise(resolve => setImmediate(resolve));
 await ask('1', 'edit', { filepath: path.join(root, 'public/index.html') });
 assert.equal(emitted.at(-1).properties.id, '1'); assert.deepEqual(replies, []);
 // Kun en filændring i projektet kan tillades for hele opgaven.
 await ask('2', 'bash', { command: 'ls' });
 await assert.rejects(bench.reply({ id: '2', allow: true, scope: 'task' }), /projektmappen/);
 assert.equal(chat.allowProjectEdits, false);
 await bench.reply({ id: '1', allow: true, scope: 'task' });
 await ask('3', 'edit', { filepath: path.join(root, 'public/styles.css') });
 assert.deepEqual(replies, [['1', true], ['3', true]]);
 assert.equal(emitted.at(-1).type, 'permission.auto'); assert.equal(emitted.at(-1).file, 'public/styles.css'); assert.equal(emitted.at(-1).chat, chat.id); assert.equal(emitted.at(-1).root, root); assert.equal(emitted.at(-1).source, 'task');
 // Uden for projektet, Git-historik, hemmeligheder, kommandoer og web spørger stadig.
 for (const [id, permission, metadata] of [['4', 'edit', { filepath: path.join(path.dirname(root), 'andet', 'fil.txt') }], ['5', 'edit', { filepath: path.join(root, '.git', 'config') }], ['6', 'edit', { filepath: path.join(root, '.env.local') }], ['7', 'edit', { filepath: path.join(root, 'noegler', 'server.pem') }], ['8', 'edit', { filepath: 'public/relativ.html' }], ['9', 'bash', { command: 'rm -rf public' }], ['10', 'webfetch']]) {
  await ask(id, permission, metadata);
  assert.equal(emitted.at(-1).properties?.id, id, `handling ${id} skal vises for brugeren`);
 }
 assert.equal(replies.length, 2);
 // Når opgaven er slut, gælder tilladelsen ikke længere.
 chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.equal(chat.allowProjectEdits, false);
 chat.running = true;
 await ask('11', 'edit', { filepath: path.join(root, 'public/index.html') });
 assert.equal(emitted.at(-1).properties?.id, '11'); assert.equal(replies.length, 2);
 chat.running = false; await bench.close();
});


test('forbruget tælles pr. modelkald og prissættes med ræsonnement som output', async t => {
 const emitted = [];
 const bench = new Workbench({ directory: await temp(t), profiles, emit: event => emitted.push(event), safeStorage: {} });
 const root = await temp(t); await bench.activate({ root, name: 'Prøve' });
 const chat = bench.chat;
 assert.deepEqual(chat.currentUsage(), { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0, unpriced: 0 });
 chat.runSteps = new Map(); chat.runPrice = require('../core/connections.cjs').priceFor({ kind: 'anthropic' }, { id: 'claude-opus-5-5' });
 const step = (id, tokens) => bench.chat.event({ type: 'message.part.updated', properties: { part: { id, type: 'step-finish', tokens } } });
 step('a', { input: 1000, output: 200, reasoning: 100, cache: { read: 10000, write: 2000 } });
 step('a', { input: 1000, output: 200, reasoning: 100, cache: { read: 10000, write: 2000 } });
 step('b', { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } });
 const usage = chat.currentUsage();
 assert.equal(usage.calls, 2, 'samme modelkald tælles kun én gang');
 assert.equal(usage.input, 1500); assert.equal(usage.output, 300); assert.equal(usage.reasoning, 100);
 // Opus 5.5: 4 USD ind, 20 USD ud, 0,2 USD fra cache og 5 USD til cache pr. million tokens.
 assert.ok(Math.abs(usage.cost - (1500 * 4 + 400 * 20 + 10000 * 0.2 + 2000 * 5) / 1e6) < 1e-12);
 assert.equal(emitted.filter(e => e.type === 'usage').length, 2);
 // Forbruget gemmes med samtalen og er nulstillet i en ny samtale.
 chat.runUser = { id: 'u', role: 'user', text: 'Første opgave' };
 chat.running = true; await chat.saveHistory('idle'); chat.running = false;
 await bench.activate({ root, name: 'Prøve' });
 assert.equal(bench.chat.currentUsage().calls, 2);
 // Forbruget hører til samtalen: en ny samtale starter fra nul, og den gamle beholder sit.
 await bench.newConversation();
 assert.notEqual(bench.chat.id, chat.id); assert.equal(bench.chat.currentUsage().calls, 0);
 bench.chat.runSteps = new Map(); bench.chat.runPrice = null; step('c', { input: 10, output: 5 });
 assert.equal(bench.chat.currentUsage().unpriced, 1);
 await bench.openChat(chat.id); assert.equal(bench.chat.currentUsage().calls, 2);
 await bench.close();
});

test('en Corti-forbindelse beholder miljø og nøgle, når den redigeres uden ny nøgle', async t => {
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`krypteret:${text}`), decryptString: data => data.toString().slice('krypteret:'.length) };
  const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage });
  const key = Buffer.from('fr:password:testklient:testbruger:hemmelighed').toString('base64');
  const first = (await bench.saveConnection({ kind: 'corti', name: 'Corti', apiKey: key })).connections[0];
  assert.equal(first.baseURL, 'https://ai.fr.corti.app/v1');
  const renamed = (await bench.saveConnection({ id: first.id, kind: 'corti', name: 'Corti i Frankrig' })).connections[0];
  assert.equal(renamed.baseURL, 'https://ai.fr.corti.app/v1', 'miljøet fra nøglen bevares');
  assert.equal(renamed.hasKey, true, 'nøglen bevares, fordi adressen er den samme');
  assert.equal(bench.store.decrypt((await bench.store.read()).connections[0]), key);
});

// En falsk motor og et færdigt "Før du sender", så samtalernes regler kan prøves uden en rigtig AI.
function fakeSend(bench, engines) {
 bench.engineFactory = options => { const engine = { options, active: false, resumed: Boolean(options.resume), session: { id: options.resume || `ses-${engines.length + 1}` }, pending: new Map(), sent: [], start: async () => { engine.active = true; }, send: async text => { engine.sent.push(text); }, request: async () => true, reply: async () => {}, abort: async () => {}, close: async () => { engine.active = false; } }; engines.push(engine); return engine; };
 return async (chat, text, fingerprint = 'regler-1', extra = {}) => {
  chat.prepared = { mode: 'free', root: chat.root, connection: { id: 'c', kind: 'compatible', name: 'Prøve', baseURL: 'http://127.0.0.1:1/v1' }, model: { id: 'test' }, route: null, references: [], fileRefs: [], view: null, autoCheckpoint: false, startup: null,
   disclosure: { fingerprint, consentKey: 'samtykke', modelName: 'test', provider: 'Prøve' }, context: { rules: '', skills: [], titles: [], features: { versioner: false }, integrations: [] } };
  return bench.send({ chat: chat.id, text, fingerprint, ...extra });
 };
}

test('samtaler i samme projekt: samtidige opgaver i separate mapper, og godkendelser, spørgsmål og hændelser går til den rigtige samtale', async t => {
 const all = [], engines = [], root = await temp(t);
 const bench = new Workbench({ directory: await temp(t), profiles, emit: event => all.push(event), safeStorage: {} });
 const send = fakeSend(bench, engines);
 await bench.activate({ root, name: 'Prøve' }); const first = bench.chat;
 await send(first, 'Byg en forside');
 assert.equal(first.running, true); assert.equal(bench.busyRoot(root), true);
 // En ny samtale kan åbnes og skrives i, mens den første arbejder.
 await bench.newChat(); const second = bench.chat;
 assert.notEqual(second.id, first.id); assert.equal(first.running, true, 'den første samtale arbejder videre i baggrunden');
 await bench.saveDraft({ chat: second.id, text: 'Næste idé', mode: 'plan' });
 await send(second, 'Lav en kontaktside');
 assert.equal(second.running, true); assert.equal(engines.length, 2);
 assert.notEqual(second.root, root); assert.ok(second.copy);
 assert.equal(engines[0].active, true, 'den første motor fortsætter under kopiens opgave');
 await assert.rejects(bench.textEdit({ chat: second.id, id: 'x' }), /Vent/);
 await assert.rejects(bench.deleteChat({ id: first.id }, async () => {}), /Stop opgaven/);
 // Godkendelser og spørgsmål fra den første samtales motor besvares der, også når en anden samtale er åben.
 engines[0].pending.set('p1', { permission: 'bash', metadata: {} });
 await first.event({ type: 'permission.asked', properties: { id: 'p1', permission: 'bash', metadata: {}, patterns: [] } });
 assert.equal(all.findLast(event => event.type === 'permission.asked').chat, first.id, 'hændelsen bærer samtalens id');
 assert.equal(first.waiting, true);
 const replies = []; engines[0].reply = async (...args) => replies.push(args);
 await bench.reply({ id: 'p1', allow: true });
 assert.deepEqual(replies, [['p1', true, '']]);
 assert.equal(first.activityList().find(entry => entry.id === 'approval-p1').status, 'allowed'); assert.equal(second.activityList().some(e => e.id === 'approval-p1'), false);
 first.event({ type: 'question.asked', properties: { id: 'q1', questions: [{ question: 'Farve?', header: 'Farve', options: [] }] } });
 const asked = []; engines[0].request = async (...args) => { asked.push(args); return true; };
 await bench.question({ id: 'q1', answers: [['Blå']] });
 assert.equal(asked[0][0], '/question/q1/reply');
 // Sidepanelet får samtalernes status samlet.
 await new Promise(resolve => setTimeout(resolve, 150));
 const listed = all.findLast(event => event.type === 'chats.updated');
 assert.equal(listed.active, second.id);
 assert.deepEqual(listed.chats.map(chat => [chat.title, chat.running]), [['Lav en kontaktside', true], ['Byg en forside', true]]);
 // Når den første er færdig, kan den anden arbejde, og den første slettes ikke ved en fejl.
 first.event({ type: 'session.idle' }); await bench.finishing;
 assert.equal(first.running, false); assert.equal(bench.busyRoot(root), false);
 assert.equal(second.running, true); assert.equal(engines[0].active, true);
 assert.equal(bench.busyRoot(second.root), true);
 second.event({ type: 'session.idle' }); await bench.finishing;
 // Omdøb og slet.
 await bench.renameChat({ id: first.id, title: 'Forsiden' });
 assert.equal((await bench.chatList()).find(chat => chat.id === first.id).title, 'Forsiden');
 const trashed = [];
 const state = await bench.deleteChat({ id: second.id }, async file => { trashed.push(file); await fs.rm(file); });
 assert.equal(trashed.length, 1); assert.equal(state.chat, first.id, 'den nyeste tilbageværende samtale åbnes');
 assert.deepEqual((await bench.chatList()).map(chat => chat.id), [first.id]);
 await bench.close();
});

test('en samtale fortsætter sin AI-session, når forbindelse, model og regler er de samme', async t => {
 const engines = [], root = await temp(t), directory = await temp(t);
 const bench = new Workbench({ directory, profiles, emit: () => {}, safeStorage: {} });
 const send = fakeSend(bench, engines);
 await bench.activate({ root, name: 'Prøve' });
 await send(bench.chat, 'Første besked'); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.equal(engines[0].options.resume, null);
 assert.deepEqual((await bench.history.readChat(root, bench.chat.id)).opencode, { session: 'ses-1', fingerprint: 'regler-1' });
 // Appen lukkes og åbnes igen: samme regler fortsætter sessionen, andre regler starter en ny.
 await bench.close(); await bench.activate({ root, name: 'Prøve' });
 await send(bench.chat, 'Anden besked'); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.equal(engines[1].options.resume, 'ses-1');
 assert.equal(bench.chat.activityList().some(entry => entry.title === 'AI-sessionen fortsætter'), true);
 await bench.close(); await bench.activate({ root, name: 'Prøve' });
 await send(bench.chat, 'Tredje besked', 'regler-2'); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.equal(engines[2].options.resume, null);
 assert.equal(bench.chat.activityList().some(entry => entry.title === 'Ny AI-session'), true);
 await bench.close();
});

test('motoren fortsætter en kendt session og opretter en ny, når den gamle ikke findes', async () => {
 const { OpenCodeEngine } = require('../core/engine.cjs');
 const calls = [];
 const engine = (resume, known) => Object.assign(new OpenCodeEngine({ root: '/tmp/x', resume }), { request: async (url, method) => { calls.push([url, method || 'GET']); if (url === '/session' && method === 'POST') return { id: 'ny' }; if (url === `/session/${known}`) return { id: known }; throw new Error('404'); } });
 const kept = engine('ses_gammel', 'ses_gammel'); assert.equal((await kept.openSession()).id, 'ses_gammel'); assert.equal(kept.resumed, true);
 const gone = engine('ses_borte', 'andet'); assert.equal((await gone.openSession()).id, 'ny'); assert.equal(gone.resumed, false);
 const unsafe = engine('../../config', 'x'); assert.equal((await unsafe.openSession()).id, 'ny');
 assert.deepEqual(calls, [['/session/ses_gammel', 'GET'], ['/session/ses_borte', 'GET'], ['/session', 'POST'], ['/session', 'POST']], 'en usikker id sendes aldrig til motoren');
});

test('Ændringer og Aktivitet bevares pr. samtale, når projektet genåbnes, fx efter en gendannelse', async t => {
 const root = await temp(t);
 const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {} });
 await bench.activate({ root, name: 'Prøve' }); const first = bench.chat.id;
 const task = bench.recordEdit({ kind: 'direct', label: 'Min rettelse', files: [{ file: 'a.txt', before: 'a', after: 'b' }], title: 'Du rettede en tekst' });
 // Som ved en gendannelse: projektet lukkes, der logges, og projektet åbnes igen.
 await bench.close();
 bench.log({ kind: 'restore', title: 'Filerne er sat tilbage', status: 'completed' });
 await bench.activate({ root, name: 'Prøve' });
 assert.equal(bench.chat.id, first);
 assert.equal(bench.findTask(task.id)?.label, 'Min rettelse');
 assert.deepEqual(bench.activityList().map(entry => entry.title), ['Du rettede en tekst', 'Filerne er sat tilbage']);
 assert.equal((await bench.changeOverview()).tasks.length, 1);
 // En ny samtale har sine egne, tomme Ændringer; den første har stadig sine.
 bench.chat.data.draft = 'x'; await bench.saveDraft({ text: 'Kladde', mode: 'plan' });
 await bench.newChat(); assert.notEqual(bench.chat.id, first); assert.equal(bench.activityList().length, 0);
 await bench.openChat(first); assert.equal(bench.activityList().length, 2);
 await bench.close();
});

test('Stop venter på versionen, når abort samtidig sender idle, og frigiver ikke mappen for tidligt', async t => {
 const root = await temp(t), events = [];
 await fs.writeFile(path.join(root, 'a.txt'), 'før\n');
 const bench = new Workbench({ directory: await temp(t), profiles, emit: event => events.push(event), safeStorage: {} });
 await bench.activate({ root, name: 'Prøve' }); const chat = bench.chat;
 chat.running = true; chat.runMode = 'free'; chat.runBefore = await require('../core/changes.cjs').capture(root);
 bench.checkpointOwner = chat; bench.claims.set(root, chat);
 chat.engine = { abort: async () => chat.event({ type: 'session.idle' }), close: async () => {} };
 let release, entered, finishes = 0;
 const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; });
 bench.checkpoints.finish = async () => { finishes++; entered(); await gate; };
 const stopped = bench.stop(); await waiting; await new Promise(resolve => setImmediate(resolve));
 try {
  assert.equal(bench.busyRoot(root), true, 'en anden opgave eller indfletning kan ikke overtage mappen under versionsgemningen');
  assert.equal(events.some(event => event.type === 'run.status' && event.status === 'stopped'), false);
 } finally { release(); await stopped; }
 assert.equal(finishes, 1, 'abort og idle må ikke afslutte versionen hver for sig');
 assert.equal(bench.busyRoot(root), false);
 assert.equal(events.filter(event => event.type === 'run.review').length, 1);
 assert.equal(events.filter(event => event.type === 'run.status' && event.status === 'stopped').length, 1);
 await bench.close();
});


test('et forsinket modelkatalog kan ikke genoplive en redigeret forbindelse eller erstatte en nyere kontrol', async t => {
 const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {} });
 const waiting = [];
 const server = http.createServer((req, res) => waiting.push(res));
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(() => { server.closeAllConnections(); server.close(); });
 const connection = (await bench.saveConnection({ kind: 'compatible', name: 'Før', baseURL: `http://127.0.0.1:${server.address().port}/v1` })).connections[0];
 const until = async count => { for (let n = 0; waiting.length < count && n < 100; n++) await new Promise(r => setTimeout(r, 10)); assert.equal(waiting.length, count); };
 const answer = (index, id) => waiting[index].end(JSON.stringify({ data: [{ id }] }));
 const old = bench.models(connection.id); const oldRejected = assert.rejects(old, /ændret eller kontrolleret igen/);
 await until(1); await bench.saveConnection({ ...connection, name: 'Efter' }); answer(0, 'gammel'); await oldRejected;
 assert.equal(bench.catalogs.has(connection.id), false);
 const slow = bench.models(connection.id), slowRejected = assert.rejects(slow, /ændret eller kontrolleret igen/); await until(2);
 const latest = bench.models(connection.id); await until(3); answer(2, 'ny'); await latest; answer(1, 'forældet'); await slowRejected;
 assert.equal(bench.catalogs.get(connection.id)[0].id, 'ny');
 const failed = bench.models(connection.id), failure = assert.rejects(failed, /afviste/); await until(4);
 waiting[3].writeHead(401); waiting[3].end('{}'); await failure; assert.equal(bench.catalogs.has(connection.id), false);
});

test('Gør samtalen kortere sammenfatter samtalen, før beskeden sendes, og springer en tom samtale over', async t => {
 const engines = [], root = await temp(t);
 const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {} });
 const send = fakeSend(bench, engines);
 await bench.activate({ root, name: 'Prøve' });
 await send(bench.chat, 'Første besked'); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 const engine = engines[0], calls = [];
 engine.messages = async () => [{ id: 'm1' }, { id: 'm2' }];
 engine.summarize = async () => {
  calls.push('sammenfat');
  bench.chat.event({ type: 'message.updated', properties: { info: { id: 'summary', role: 'assistant' } } });
  bench.chat.event({ type: 'message.part.updated', properties: { part: { id: 'summary-text', messageID: 'summary', type: 'text', text: 'Kun internt resumé' } } });
  bench.chat.event({ type: 'message.part.updated', properties: { part: { id: 'summary-step', type: 'step-finish', reason: 'stop', tokens: { input: 10, output: 2 } } } });
  bench.chat.event({ type: 'session.idle' });
  assert.equal(bench.chat.running, true); assert.equal(bench.chat.finishing, null); assert.ok(bench.chat.task);
  return true;
 };
 const plain = engine.send; engine.send = async text => { calls.push('send'); return plain(text); };
 await send(bench.chat, 'Prøv igen', 'regler-1', { compact: true }); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.deepEqual(calls, ['sammenfat', 'send'], 'samtalen gøres kortere før beskeden');
 assert.equal(bench.chat.activityList().some(entry => entry.title === 'Samtalen er gjort kortere'), true);
 assert.equal(bench.chat.currentUsage().input, 10); assert.equal(bench.chat.currentUsage().output, 2);
 assert.equal(bench.chat.data.messages.some(item => item.text === 'Kun internt resumé'), false);
 // Uden ønsket, eller uden noget at sammenfatte, sendes beskeden direkte.
 calls.length = 0; await send(bench.chat, 'Næste', 'regler-1'); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.deepEqual(calls, ['send']);
 calls.length = 0; engine.messages = async () => []; await send(bench.chat, 'Tom', 'regler-1', { compact: true }); bench.chat.event({ type: 'session.idle' }); await bench.finishing;
 assert.deepEqual(calls, ['send']);
 await bench.close();
});

test('modelkatalogets indsatsniveauer kommer fra samme regel som afsendelsen', async t => {
 const connection = { id: 'test', kind: 'compatible', name: 'Prøve', baseURL: 'http://127.0.0.1:1/v1' };
 const connections = require('../core/connections.cjs');
 const original = connections.listModels;
 t.after(() => { connections.listModels = original; });
 connections.listModels = async () => [{ id: 'reported', name: 'Rapporteret', capabilities: { effort: ['minimal', 'high', 'ultra', 'BAD!', 4] } }, { id: 'unknown', name: 'Ukendt' }];
 const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {} });
 t.after(() => bench.close()); bench.connection = async () => connection;
 const models = await bench.models(connection.id);
 assert.deepEqual(models[0].effortLevels, ['minimal', 'high', 'ultra']);
 assert.deepEqual(models[1].effortLevels, []);
 assert.deepEqual(models[0].effortLevels, connections.effortLevels(connection, models[0]));
 assert.equal(bench.catalogs.get(connection.id)[0], models[0]);
});
