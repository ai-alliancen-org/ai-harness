// SPDX-License-Identifier: EUPL-1.2
// A private IPC pipe ties the actual engine process group to its Aura owner.
// Closing the pipe also handles SIGKILL, where Aura cannot run cleanup handlers.
const { spawn } = require('node:child_process');
const path = require('node:path');
const executable = process.argv[2], args = process.argv.slice(3);
if (process.platform === 'win32' || !process.connected || !executable || !(path.isAbsolute(executable) || /^opencode(?:\.exe)?$/.test(executable))) process.exit(1);
let child, closing = false, timer;
function signal(signal) {
  if (!child?.pid) return;
  try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') process.exitCode = 1; }
}
function close() {
  if (closing) return; closing = true;
  signal('SIGTERM'); timer = setTimeout(() => signal('SIGKILL'), 2000);
}
process.on('disconnect', close); process.on('SIGTERM', close); process.on('SIGINT', close);
process.stdout.on('error', close); process.stderr.on('error', close);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
child = spawn(executable, args, { cwd: process.cwd(), env: environment, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.once('error', () => { clearTimeout(timer); process.exit(1); });
child.once('exit', (code, signalName) => {
  // An unexpected engine exit must also retire its already-owned command group.
  signal('SIGKILL');
  clearTimeout(timer);
  process.exit(Number.isInteger(code) ? code : signalName ? 1 : 0);
});
if (process.platform === 'win32' || !process.connected) close();
