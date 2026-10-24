// SPDX-License-Identifier: EUPL-1.2
// Real OpenCode startup + abrupt owner exit. No model request or credential.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn, execFileSync } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function verify() {
  if (process.platform === 'win32') return { skipped:true, reason:'POSIX guardian; Windows retains its existing owner process.' };
  const sourceArg = process.argv.find(arg => arg.startsWith('--source='));
  const desktop = sourceArg ? path.resolve(sourceArg.slice('--source='.length), 'desktop') : path.resolve(__dirname, '..');
  const expectedOrphan = process.argv.includes('--expect-orphan');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-owner-proof-')));
  let controller, owned = [];
  try {
    const project = path.join(root, 'project'), marker = path.join(root, 'ready.json'), script = path.join(root, 'owner.cjs');
    await fs.mkdir(project);
    // JSON encoding keeps paths data even when their names contain quotes.
    const code = `const fs=require('node:fs/promises');
const {OpenCodeEngine,VERSION}=require(${JSON.stringify(path.join(desktop,'core/engine.cjs'))});
const c=require(${JSON.stringify(path.join(desktop,'core/connections.cjs'))});
const model={id:'synthetic',name:'Synthetic model'};
const engine=new OpenCodeEngine({root:${JSON.stringify(project)},directory:${JSON.stringify(path.join(root,'runtime'))},provider:c.engineProvider(c.normalize({kind:'compatible',name:'Local test',baseURL:'http://127.0.0.1:19431/v1'}),model,'http://127.0.0.1:19431/v1','synthetic'),model,mode:'chat'});
engine.start().then(()=>fs.writeFile(${JSON.stringify(marker)},JSON.stringify({pid:engine.child.pid,version:VERSION,session:!!engine.session?.id}))).catch(()=>process.exit(2));`;
    await fs.writeFile(script, code);
    controller = spawn(process.execPath, [script], { stdio:'ignore' });
    let ready;
    for (let i=0; i<3000; i++) {
      try { ready = JSON.parse(await fs.readFile(marker, 'utf8')); break; }
      catch { if (controller.exitCode !== null) throw new Error('The controlled OpenCode owner failed to start.'); await pause(50); }
    }
    assert.ok(ready?.session, 'The actual OpenCode session and effective config must be ready.');
    owned = [ready.pid];
    if (!expectedOrphan) {
      const rows = execFileSync('ps', ['-axo','pid=,ppid='], { encoding:'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
      const child = rows.find(([,parent]) => parent === ready.pid);
      assert.ok(child, 'The guardian must own the actual OpenCode child.');
      owned.push(child[0]);
    }
    const exited = once(controller, 'exit'); controller.kill('SIGKILL'); await exited; controller = null;
    for (let i=0; i<100 && owned.some(alive); i++) await pause(30);
    const survivors = owned.filter(alive).length;
    assert.equal(survivors, expectedOrphan ? 1 : 0, 'Unexpected surviving owned engine processes.');
    return { platform:process.platform, architecture:process.arch, engineVersion:ready.version, actualSessionCreated:true, ownedProcesses:owned.length, survivorsAfterOwnerSIGKILL:survivors, modelRequests:0, credentialsUsed:false };
  } finally {
    if (controller && controller.exitCode === null && controller.signalCode === null) controller.kill('SIGKILL');
    // Only PIDs created and observed by this isolated fixture are considered.
    for (const pid of owned) if (alive(pid)) process.kill(pid, 'SIGKILL');
    await fs.rm(root, { recursive:true, force:true });
  }
}
verify().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
