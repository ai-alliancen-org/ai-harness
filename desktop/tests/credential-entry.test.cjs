const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// These tests exercise the actual main-process module with isolated Electron
// boundaries. They do not claim native Keychain or real-window verification.
const { CredentialReceipts, createCredentialEntry, credentialResourceURL, binding } = require('../core/credential-entry.cjs');
const metadata = () => ({ id: 'fixture-connection', kind: 'compatible', name: 'Synthetic connection', baseURL: 'http://127.0.0.1:19431/v1', deployment: '', protocol: 'responses', clearKey: false });
const key = 'synthetic-test-value-not-a-credential';

function electronFixture({ encrypted = true, loadError, resourceScheme } = {}) {
  const windows = [], handlers = new Map(), owner = {};
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: '' };
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    loadFile(file) { this.file = file; this.webContents.mainFrame.url = pathToFileURL(file).href; return loadError ? Promise.reject(loadError) : Promise.resolve(); }
    loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; return loadError ? Promise.reject(loadError) : Promise.resolve(); }
    show() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  const entry = createCredentialEntry({ BrowserWindow, ipcMain: { handle: (channel, handler) => { assert.equal(handlers.has(channel), false); handlers.set(channel, handler); }, removeHandler: channel => handlers.delete(channel) }, safeStorage: { isEncryptionAvailable: () => encrypted }, parent: () => owner, resourceScheme });
  const current = () => windows.at(-1);
  const invoke = (message, event) => {
    const win = current(), handler = [...handlers.values()].at(-1);
    assert.ok(handler, 'the private IPC handler must still exist');
    return handler(event || { sender: win.webContents, senderFrame: win.webContents.mainFrame }, message);
  };
  return { entry, windows, handlers, owner, current, invoke };
}

test('receipts are opaque, one-use, and expose the value only to their bound main operation', () => {
  const receipts = new CredentialReceipts(), configuration = metadata();
  const receipt = receipts.put('connection', configuration, key);
  assert.match(receipt, /^[a-f0-9]{64}$/); assert.equal(receipt.includes(key), false);
  assert.equal(receipts.consume('connection', { ...configuration }, receipt), key);
  assert.throws(() => receipts.consume('connection', configuration, receipt), /udløbet/);
  assert.throws(() => receipts.consume('connection', configuration, 'forged'), /udløbet/);
});

test('purpose and every editable connection field are bound; a mismatch burns the receipt', () => {
  for (const [field, value] of Object.entries({ id: 'other', kind: 'azure', name: 'Other', baseURL: 'https://example.invalid/v1', deployment: 'other', protocol: 'openai', clearKey: true })) {
    const receipts = new CredentialReceipts(), configuration = metadata(), receipt = receipts.put('connection', configuration, key);
    assert.throws(() => receipts.consume('connection', { ...configuration, [field]: value }, receipt), /oplysningerne er ændret/, field);
    assert.throws(() => receipts.consume('connection', configuration, receipt), /udløbet/, field);
  }
  const receipts = new CredentialReceipts(), receipt = receipts.put('connection', metadata(), key);
  assert.throws(() => receipts.consume('connection', { ...metadata(), kind:'openai' }, receipt), /udløbet/);
});

test('expired receipts cannot be replayed and outstanding credentials are bounded', () => {
  let now = 100; const receipts = new CredentialReceipts({ now: () => now, lifetime: 20 });
  const oldest = receipts.put('connection', metadata(), key);
  for (let i = 0; i < 4; i++) receipts.put('connection', metadata(), `${key}-${i}`);
  assert.equal(receipts.entries.size, 4);
  assert.throws(() => receipts.consume('connection', metadata(), oldest), /udløbet/);
  const expires = receipts.put('connection', metadata(), key); now += 20;
  assert.throws(() => receipts.consume('connection', metadata(), expires), /udløbet/);
  assert.equal(receipts.entries.size, 0);
});

test('invalid key values and raw credentials in metadata are rejected before issuing receipts', () => {
  const receipts = new CredentialReceipts();
  for (const value of ['', null, 42, 'a\nb', 'a\rb', 'a\0b', 'a'.repeat(4097)]) assert.throws(() => receipts.put('connection', metadata(), value), /ugyldig/);
  for (const name of ['apiKey', 'token', 'secret']) assert.throws(() => binding('connection', { ...metadata(), [name]: key }), /sikre nøglevindue/);
  assert.throws(() => binding('unknown', {}), /Ukendt/); assert.equal(receipts.entries.size, 0);
});

test('the native entry is sandboxed, modal, navigation-restricted, and returns only an opaque receipt', async () => {
  const f = electronFixture(), configuration = metadata(), pending = f.entry.request({ purpose: 'connection', configuration }), win = f.current();
  assert.equal(win.options.parent, f.owner); assert.equal(win.options.modal, true);
  assert.equal(win.options.webPreferences.sandbox, true); assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false); assert.equal(win.options.webPreferences.devTools, false);
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  const context = f.invoke({ action: 'context' });
  assert.equal(context.name, configuration.name); assert.equal(context.endpoint, configuration.baseURL);
  assert.equal(JSON.stringify(context).includes(key), false);
  let blocked = false; win.webContents.emit('will-navigate', { preventDefault: () => { blocked = true; } }, 'https://example.invalid/'); assert.equal(blocked, true);
  win.emit('ready-to-show'); assert.equal(win.shown, true);
  assert.deepEqual(f.invoke({ action: 'submit', value: key }), { ok: true });
  const result = await pending;
  assert.deepEqual(Object.keys(result).sort(), ['canceled', 'keyReceipt']); assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(f.entry.connection({ ...configuration, keyReceipt: result.keyReceipt }).apiKey, key);
  assert.throws(() => f.entry.connection({ ...configuration, keyReceipt: result.keyReceipt }), /udløbet/);
  assert.equal(f.handlers.size, 0); assert.equal(win.destroyed, true);
});

test('forged sender, subframe, wrong origin and malformed actions cannot mint or consume a receipt', async () => {
  const f = electronFixture(), pending = f.entry.request({ configuration: metadata() }), win = f.current();
  for (const event of [{ sender: {}, senderFrame: win.webContents.mainFrame }, { sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } }]) assert.throws(() => f.invoke({ action: 'submit', value: key }, event), /forkert vindue/);
  assert.throws(() => f.invoke({ action: 'context' }, { sender: {}, senderFrame: win.webContents.mainFrame }), /forkert vindue/);
  const original = win.webContents.mainFrame.url; win.webContents.mainFrame.url = 'https://example.invalid';
  assert.throws(() => f.invoke({ action: 'submit', value: key }), /forkert vindue/); win.webContents.mainFrame.url = original;
  assert.throws(() => f.invoke({ action: 'other', value: key }), /Ukendt/);
  assert.throws(() => f.invoke({ action: 'submit', value: '' }), /ugyldig/);
  assert.equal(f.handlers.size, 1); f.invoke({ action: 'cancel' }); assert.deepEqual(await pending, { canceled: true });
});

test('cancel, window close, shutdown and failed load clean up pending IPC without a credential', async () => {
  for (const cancel of [f => f.invoke({ action: 'cancel' }), f => f.current().destroy(), f => f.entry.close()]) {
    const f = electronFixture(), pending = f.entry.request({ configuration: metadata() }); cancel(f);
    assert.deepEqual(await pending, { canceled: true }); assert.equal(f.handlers.size, 0); assert.equal(f.current().destroyed, true);
  }
  const f = electronFixture({ loadError: new Error('synthetic load failure') });
  await assert.rejects(f.entry.request({ configuration: metadata() }), /kunne ikke åbnes/); assert.equal(f.handlers.size, 0); assert.equal(f.current().destroyed, true);
});

test('unavailable safe storage and concurrent entry fail closed; shutdown revokes outstanding receipts', async () => {
  const unavailable = electronFixture({ encrypted: false }); await assert.rejects(unavailable.entry.request({ configuration: metadata() }), /nøglebeskyttelse/); assert.equal(unavailable.windows.length, 0);
  const f = electronFixture(), pending = f.entry.request({ configuration: metadata() });
  await assert.rejects(f.entry.request({ configuration: metadata() }), /Afslut/); assert.equal(f.windows.length, 1);
  f.invoke({ action: 'submit', value: key }); const result = await pending; f.entry.close();
  assert.throws(() => f.entry.connection({ ...metadata(), keyReceipt: result.keyReceipt }), /udløbet/);
  await assert.rejects(f.entry.request({ configuration: metadata() }), /Afslut/);
});

test('a crashed secure renderer cancels its pending operation and permits a fresh entry', async () => {
  const f = electronFixture(), pending = f.entry.request({ configuration: metadata() });
  f.current().webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  const outcome = await Promise.race([pending.then(value => ({ settled: true, value })), new Promise(resolve => setImmediate(() => resolve({ settled: false })))]);
  assert.equal(outcome.settled, true, 'a dead secure renderer must not leave the parent RPC and busy state pending');
  assert.deepEqual(outcome.value, { canceled: true }); assert.equal(f.handlers.size, 0);
  const retry = f.entry.request({ configuration: metadata() }); f.invoke({ action: 'cancel' });
  assert.deepEqual(await retry, { canceled: true }); f.entry.close();
});

test('connection updates without a new key preserve metadata while raw-key bypasses are rejected', () => {
  const f = electronFixture(); assert.deepEqual(f.entry.connection(metadata()), metadata());
  for (const field of ['apiKey', 'secret', 'token']) assert.throws(() => f.entry.connection({ ...metadata(), [field]: key }), /sikre nøglevindue/);
});

test('GitHub PAT entry has a fixed recipient, one-use purpose-bound receipt and rejects every raw-token bypass', async () => {
  const f = electronFixture(), pending = f.entry.request({ purpose: 'github', configuration: {} });
  assert.deepEqual(f.invoke({ action: 'context' }), { name: 'GitHub', endpoint: 'https://api.github.com', kind: 'github', label: 'GitHub-token' });
  f.invoke({ action: 'submit', value: key }); const result = await pending;
  assert.equal(JSON.stringify(result).includes(key), false); assert.equal(f.entry.github({ keyReceipt: result.keyReceipt }), key);
  assert.throws(() => f.entry.github({ keyReceipt: result.keyReceipt }), /udløbet/);
  for (const input of [key, null, [], {}, { token: key }, { keyReceipt: 'forged', apiKey: key }, { keyReceipt: 'forged', endpoint: 'https://example.invalid' }]) assert.throws(() => f.entry.github(input), /sikre nøglevindue/);
  for (const configuration of [{ baseURL: 'https://example.invalid' }, { repository: 'other/repo' }, { id: 'other' }]) await assert.rejects(f.entry.request({ purpose: 'github', configuration }), /faste GitHub/);
  const connectionPending = f.entry.request({ configuration: metadata() }); f.invoke({ action: 'submit', value: key }); const connection = await connectionPending;
  assert.throws(() => f.entry.github({ keyReceipt: connection.keyReceipt }), /udløbet/);
  const githubPending = f.entry.request({ purpose: 'github' }); f.invoke({ action: 'submit', value: key }); const github = await githubPending;
  assert.throws(() => f.entry.connection({ ...metadata(), keyReceipt: github.keyReceipt }), /udløbet/);
  assert.throws(() => f.entry.github({ keyReceipt: github.keyReceipt }), /udløbet/);
});

test('GitHub cancellation closes only its own pending modal and revokes only GitHub receipts', async () => {
  const f = electronFixture(), pending = f.entry.request({ purpose: 'github' }); f.entry.cancelGithub(); assert.deepEqual(await pending, { canceled: true }); assert.equal(f.handlers.size, 0);
  const first = f.entry.request({ purpose: 'github' }); f.invoke({ action: 'submit', value: key }); const github = await first;
  const second = f.entry.request({ configuration: metadata() }); f.invoke({ action: 'submit', value: key }); const connection = await second;
  f.entry.cancelGithub(); assert.throws(() => f.entry.github({ keyReceipt: github.keyReceipt }), /udløbet/);
  assert.equal(f.entry.connection({ ...metadata(), keyReceipt: connection.keyReceipt }).apiKey, key);
  const third = f.entry.request({ configuration: metadata() }); f.entry.cancelGithub(); assert.equal(f.current().destroyed, false); f.invoke({ action: 'cancel' }); assert.deepEqual(await third, { canceled: true });
});


test('a changed GitHub account/login generation cannot reuse an earlier receipt', async () => {
 const f=electronFixture(),pending=f.entry.request({purpose:'github',configuration:{generation:7}});
 f.invoke({action:'submit',value:key});const result=await pending;
 assert.throws(()=>f.entry.github({keyReceipt:result.keyReceipt},8),/udløbet/);
 assert.throws(()=>f.entry.github({keyReceipt:result.keyReceipt},7),/udløbet/);
});

test('ordinary main-window teardown revokes pending and issued keys but permits entry after macOS reopen', async () => {
 const f=electronFixture(),first=f.entry.request({configuration:metadata()});f.invoke({action:'submit',value:key});const receipt=await first;
 const pending=f.entry.request({configuration:metadata()});f.entry.revoke();assert.deepEqual(await pending,{canceled:true});
 assert.throws(()=>f.entry.connection({...metadata(),keyReceipt:receipt.keyReceipt}),/udløbet/);
 const reopened=f.entry.request({configuration:metadata()});f.invoke({action:'cancel'});assert.deepEqual(await reopened,{canceled:true});
});

test('PAT entry retires a real in-flight OAuth account save before binding its own receipt', async () => {
 const {GitHub}=require('../core/github.cjs'),{requestGithubCredential}=require('../core/github-credential.cjs');
 const stored={hosting:{github:{login:'original-user',secret:'synthetic-existing'}}};let now=1000,releaseUser,accountWrites=0;
 const store={async read(){return stored;},encrypt(value){return value;},async update(action){action(stored);accountWrites++;}};
 const response=data=>({ok:true,status:200,async json(){return data;}});
 const github=new GitHub(store,{clientID:'synthetic-client',now:()=>now,fetcher:async url=>{
  if(url==='https://github.com/login/device/code')return response({device_code:'synthetic-device',user_code:'SYNTHETIC',verification_uri:'https://github.com/login/device',expires_in:300,interval:5});
  if(url==='https://github.com/login/oauth/access_token')return response({access_token:'synthetic-oauth-token'});
  assert.equal(url,'https://api.github.com/user');return new Promise(resolve=>{releaseUser=()=>resolve(response({login:'different-user'}));});
 }});
 const login=await github.startLogin();now+=5000;
 const poll=github.poll(login.id),failedPoll=assert.rejects(poll,/annulleret/);
 for(let i=0;i<10&&!releaseUser;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof releaseUser,'function','The actual OAuth save must have reached its asynchronous account lookup');
 const previousGeneration=github.generation,f=electronFixture();
 const entry=requestGithubCredential(github,f.entry,{purpose:'github'});
 assert.ok(github.generation>previousGeneration);assert.equal(github.pending,null);
 f.invoke({action:'submit',value:key});const receipt=await entry;
 releaseUser();await failedPoll;
 assert.equal(stored.hosting.github.login,'original-user');assert.equal(accountWrites,0);
 assert.equal(f.entry.github({keyReceipt:receipt.keyReceipt},github.generation),key);
 f.entry.close();
});
