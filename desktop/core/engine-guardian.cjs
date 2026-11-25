// Vagtproces for OpenCode på macOS og Linux. En privat IPC-forbindelse binder motorens procesgruppe til Aura eller
// CLI'en, så motoren også stopper, når ejeren forsvinder brat, fx ved SIGKILL, hvor Aura ikke kan nå at rydde op.
// Kun motorens egen procesgruppe er omfattet. Kommandoer, som OpenCode starter i egne grupper, er ikke. Efter forslag i #31.
const { spawn } = require('node:child_process');
const path = require('node:path');
const executable = process.argv[2], args = process.argv.slice(3);
if (process.platform === 'win32' || !process.connected || !executable || !(path.isAbsolute(executable) || /^opencode$/.test(executable))) process.exit(1);
// Motorens hemmeligheder kommer gennem IPC-forbindelsen, ikke gennem vagtprocessens eget miljø, så ps eww og /proc/<pid>/environ
// ikke kan vise dem her (engine-secrets.cjs). Kun disse navne tages imod, og uden adgangskoden startes motoren ikke: en OpenCode uden
// adgangskode svarer alle programmer på computeren. Listen er den samme som KEYS i engine-secrets.cjs; vagtprocessen pakkes ud af
// app.asar for sig selv og kan ikke indlæse modulet.
const SECRET_KEYS = ['OPENCODE_SERVER_PASSWORD', 'AURA_GATEWAY_TOKEN', 'AURA_PREVIEW_TOKEN'];
let child, closing = false, timer;
function signal(name) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') process.exitCode = 1; }
}
function close() {
  if (closing) return; closing = true;
  // Forsvinder ejeren, før motoren er startet, er der intet at stoppe.
  if (!child) process.exit(0);
  signal('SIGTERM'); timer = setTimeout(() => signal('SIGKILL'), 2000);
}
process.on('disconnect', close); process.on('SIGTERM', close); process.on('SIGINT', close); process.on('SIGHUP', close);
// En lukket forbindelse til ejeren må aldrig få vagtprocessen til at gå ned uden at stoppe motoren.
process.on('error', close);
process.stdout.on('error', close); process.stderr.on('error', close);
function start(secrets) {
  const environment = { ...process.env, ...secrets };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, args, { cwd: process.cwd(), env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  // Ejeren får motorens PID, så den selv kan stoppe gruppen, hvis vagtprocessen forsvinder.
  if (child.pid) process.send?.({ type: 'engine', pid: child.pid }, error => { if (error) close(); });
  child.once('error', () => { clearTimeout(timer); process.exit(1); });
  child.once('exit', (code, signalName) => {
    // Stopper motoren uventet, ryddes resten af dens procesgruppe også.
    signal('SIGKILL');
    clearTimeout(timer);
    process.exit(Number.isInteger(code) ? code : signalName ? 1 : 0);
  });
}
const waiting = setTimeout(() => process.exit(1), 60000);
process.once('message', message => {
  clearTimeout(waiting);
  const secrets = message?.type === 'secrets' && message.env && typeof message.env === 'object' && !Array.isArray(message.env) ? message.env : null;
  const valid = secrets && Object.entries(secrets).every(([key, value]) => SECRET_KEYS.includes(key) && typeof value === 'string' && value) && secrets.OPENCODE_SERVER_PASSWORD;
  if (!valid || closing) process.exit(1);
  start(Object.fromEntries(SECRET_KEYS.filter(key => secrets[key]).map(key => [key, secrets[key]])));
});
