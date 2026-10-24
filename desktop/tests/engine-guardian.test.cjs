const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const guardian = path.resolve(__dirname, '../core/engine-guardian.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
test('actual SIGKILL of the owner closes its private IPC and stops the guardian-owned process', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-guardian-'));
  const marker = path.join(directory, 'child.json');
  const fixture = path.join(directory, 'fixture.cjs');
  await fs.writeFile(fixture, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
  const controller = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');const p=spawn(process.execPath,[${JSON.stringify(guardian)},process.execPath,${JSON.stringify(fixture)}],{stdio:['ignore','ignore','ignore','ipc']});p.on('exit',()=>process.exit());`], { stdio: 'ignore' });
  let childPID;
  t.after(async () => { if (alive(controller.pid)) controller.kill('SIGKILL'); if (childPID && alive(childPID)) process.kill(childPID, 'SIGKILL'); await fs.rm(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 100; ++i) { try { childPID = JSON.parse(await fs.readFile(marker, 'utf8')).pid; break; } catch { await pause(30); } }
  assert.ok(childPID && alive(childPID)); controller.kill('SIGKILL');
  for (let i = 0; i < 100 && alive(childPID); ++i) await pause(30);
  assert.equal(alive(childPID), false, 'The actual owned engine process must not survive its owner');
});

test('unexpected engine SIGKILL retires its owned command group while the IPC owner stays alive', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-guardian-group-'));
  const marker = path.join(directory, 'group.json'), engine = path.join(directory, 'engine.cjs'), command = path.join(directory, 'command.cjs');
  // The descendant keeps the engine's detached process group and ignores TERM.
  // No app, OpenCode binary, credential or external process is used by this fixture.
  await fs.writeFile(command, `process.on('SIGTERM',()=>{});process.send({ready:true,pid:process.pid});setInterval(()=>{},1000);`);
  await fs.writeFile(engine, `const {spawn}=require('node:child_process');const p=spawn(process.execPath,[${JSON.stringify(command)}],{stdio:['ignore','ignore','ignore','ipc']});p.once('message',m=>{if(m.ready)require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({engine:process.pid,command:m.pid}));});setInterval(()=>{},1000);`);
  const ownedGuardian = spawn(process.execPath, [guardian, process.execPath, engine], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let group;
  t.after(async () => {
    if (ownedGuardian.exitCode === null && ownedGuardian.signalCode === null) ownedGuardian.kill('SIGTERM');
    if (group?.engine) { try { process.kill(-group.engine, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (let i=0;i<100;i++) { try { group=JSON.parse(await fs.readFile(marker,'utf8')); break; } catch { await pause(30); } }
  assert.ok(group?.engine && group?.command && alive(group.engine) && alive(group.command));
  assert.equal(ownedGuardian.connected,true,'The owning test process retains the actual private IPC connection');
  const exited = new Promise(resolve=>ownedGuardian.once('exit',(code,signal)=>resolve({code,signal})));
  process.kill(group.engine,'SIGKILL');
  await exited;
  for (let i=0;i<100 && alive(group.command);i++) await pause(30);
  assert.equal(alive(group.command),false,'An owned shell descendant must not survive unexpected engine exit');
  assert.equal(alive(process.pid),true,'The owner must not be terminated by group cleanup');
});

test('normal guardian shutdown preserves unrelated processes and does not leak Electron Node mode into the engine', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-guardian-normal-'));
  const marker = path.join(directory, 'engine.json'), fixture = path.join(directory, 'engine.cjs');
  await fs.writeFile(fixture, `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,electronNodeMode:process.env.ELECTRON_RUN_AS_NODE??null}));setInterval(()=>{},1000);`);
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const ownedGuardian = spawn(process.execPath, [guardian, process.execPath, fixture], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let engine;
  t.after(async () => {
    if (ownedGuardian.exitCode === null && ownedGuardian.signalCode === null) ownedGuardian.kill('SIGTERM');
    if (engine?.pid) { try { process.kill(-engine.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (sentinel.exitCode === null && sentinel.signalCode === null) { const stopped = new Promise(resolve => sentinel.once('exit', resolve)); sentinel.kill('SIGTERM'); await stopped; }
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (let i=0;i<100;i++) { try { engine=JSON.parse(await fs.readFile(marker,'utf8')); break; } catch { await pause(30); } }
  assert.ok(engine?.pid && alive(engine.pid) && alive(sentinel.pid));
  assert.equal(engine.electronNodeMode,null,'The real engine and its shell commands must not inherit Electron Node mode');
  const closed = new Promise(resolve => ownedGuardian.once('exit', resolve));
  ownedGuardian.kill('SIGTERM'); await closed;
  for (let i=0;i<100 && alive(engine.pid);i++) await pause(30);
  assert.equal(alive(engine.pid),false,'Normal owner shutdown must retire the engine');
  assert.equal(alive(sentinel.pid),true,'A separately owned process must remain alive');
});
