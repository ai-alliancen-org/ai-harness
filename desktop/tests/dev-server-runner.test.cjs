const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

// API fixtures isolate Aura's port selection for Vite and Astro.
// The native contribution driver verifies real Vite 5.4.21; Astro is fixture-only.
async function fixture(t, kind) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-preview-port-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const moduleRoot = path.join(root, 'node_modules', kind);
  await fs.mkdir(moduleRoot, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(moduleRoot, 'package.json'), JSON.stringify({ name: kind, type: 'module', exports: './index.mjs' }));
  await fs.writeFile(path.join(moduleRoot, 'index.mjs'), `
    import http from 'node:http';
    const make = options => {
      // Like Vite, zero means the shared framework default, not an OS port.
      const httpServer = http.createServer((req,res)=>res.end('local preview'));
      const listen = () => new Promise((resolve,reject)=>{
        httpServer.once('error',reject);
        httpServer.listen(options.server.port || 5173,options.server.host,resolve);
      });
      const close = () => new Promise(resolve=>httpServer.close(resolve));
      return { httpServer, listen, close, config: {base:'/'} };
    };
    export async function createServer(options) {return make(options);}
    export async function dev(options) {
      const server=make(options); await server.listen();
      return {address:server.httpServer.address(),stop:server.close};
    }
  `);
  return root;
}
async function runner(t, root, kind) {
  const child = spawn(process.execPath, [path.join(__dirname, '../core/dev-server-runner.cjs'), root, kind], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview readiness timed out')), 10000);
    child.once('message', message => { clearTimeout(timer); resolve(message.url); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${stderr}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { child, url };
}
for (const kind of ['vite', 'astro']) test(`${kind}: two Aura workspaces bind independent loopback ports and Stop owns one server`, async t => {
  const first = await runner(t, await fixture(t, kind), kind);
  const second = await runner(t, await fixture(t, kind), kind);
  assert.notEqual(first.url, second.url);
  for (const { url } of [first, second]) {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    assert.equal(await (await fetch(url)).text(), 'local preview');
  }
  const exited = once(second.child, 'exit'); second.child.kill('SIGTERM'); await exited;
  await assert.rejects(fetch(second.url, { signal: AbortSignal.timeout(1000) }));
  assert.equal(await (await fetch(first.url)).text(), 'local preview');
});
