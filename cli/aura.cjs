#!/usr/bin/env node
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Terminal } = require('./terminal.cjs');
const { createKeychain } = require('./keychain.cjs');
const { Vault, dataDirectory, privateDirectory, lock, unlockStale, isLegacy } = require('./storage.cjs');
const { configure, doctor } = require('./runtime.cjs');
const { Application } = require('./app.cjs');
const { login } = require('./connections.cjs');
const { init } = require('./actions.cjs');
const version = require('../package.json').version;
const HELP = `Aura ${version} · kodearbejde i terminalen

aura                         Åbn samtalen i den aktuelle mappe
aura chat [mappe]             Åbn et eksisterende projekt uden filændringer
aura init [overmappe]         Opret et nyt projekt efter gennemgang
aura resume                  Vælg et tidligere åbnet projekt
aura login [udbyder]          Forbind din AI, fx mistral eller ollama
aura logout                  Fjern en forbindelse efter gennemgang
aura doctor                  Kontrollér Node, Git og OpenCode uden modelkald
aura preview [mappe]         Start preview; hold terminalen åben
aura save [mappe]            Gennemgå og gem en lokal Git-version
aura deploy [mappe]          Gennemgå en testudgivelse til Vercel eller Azure
aura skills <kommando>       Installér regelsæt i dit eget kodeværktøj
aura unlock                  Fjern en gammel proceslås efter kontrol
aura --help                  Vis hjælpen
aura --version               Vis versionen

Alle projekthandlinger kan også bruge --project "sti med mellemrum".
I samtalen: /help, /plan, /build, /work, /model, /diff, /preview og /exit.
Ingen automatisk commit, push, installation eller betaling ved opstart.
API-nøgler indtastes skjult, aldrig som kommandolinjeargumenter, og gemmes i computerens nøglering.
En adgangssætning bruges kun, hvis nøgleringen ikke kan bruges.
`;
function parse(args) {
  if (args[0] === 'skills') return { command: 'skills', args: args.slice(1) };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { command: 'help' };
  if (args.length === 1 && args[0] === '--version') return { command: 'version' };
  const commands = ['chat', 'init', 'resume', 'login', 'logout', 'doctor', 'preview', 'save', 'deploy', 'unlock'];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'chat';
  if (!commands.includes(command)) throw new Error('Ukendt kommando. Brug aura --help.');
  let project, positional;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--project' && !project && args[0] && !args[0].startsWith('-')) project = args.shift();
    else if (!arg.startsWith('-') && positional === undefined) positional = arg;
    else throw new Error('Ukendte eller gentagne argumenter. Brug aura --help.');
  }
  if (['doctor', 'unlock', 'resume', 'logout'].includes(command) && (project || positional)) throw new Error('Denne kommando tager ingen ekstra argumenter.');
  if (command === 'login' && project) throw new Error('Login tager et udbydernavn, ikke en projektmappe.');
  if (project && positional) throw new Error('Angiv kun én projektmappe.');
  return { command, project: project || (command !== 'login' ? positional : undefined), provider: command === 'login' ? positional : undefined };
}
// AURA_KEYCHAIN=off springer nøgleringen over, så automatiske prøver aldrig rører brugerens rigtige nøglering.
function chooseKeychain(env, directory) { return env.AURA_KEYCHAIN === 'off' ? null : createKeychain({ directory }); }
// Adgangen kan kun tilbagekaldes, når nøglen kan læses. En browserforbindelse fra 0.2.0-beta.6 ligger i adgangssætningslageret;
// i nøgleringstilstand flyttes den først til nøgleringen sammen med de andre gamle nøgler (fund 43). Returnerer den værdi,
// forbindelsen har bagefter, så nøgleringens post kan slettes med den.
async function readableSecret(app, id) {
  await app.vault.unlock(app.ui);
  if (isLegacy((await app.bench.connection(id)).secret)) await app.vault.migrate(app.bench.store, app.ui);
  const connection = await app.bench.connection(id);
  app.bench.store.decrypt(connection);
  return connection.secret;
}
async function logout(app) {
  const { ui, vault } = app;
  const connections = (await app.bench.store.read()).connections;
  if (!connections.length) { ui.line('Ingen gemte forbindelser.'); return; }
  const id = await ui.choose('Hvilken forbindelse skal fjernes?', connections.map(c => ({ label: c.kind === 'komplai' ? `${c.name} · udgået AI-forbindelse` : c.name, value: c.id })));
  const connection = connections.find(c => c.id === id);
  const revoke = connection?.kind === 'komplai' && connection.account?.authMethod !== 'token';
  const question = revoke ? 'Fjern forbindelsen og tilbagekald denne loginadgang hos Komplai?' : connection?.kind === 'komplai' ? 'Fjern tokenet fra Aura? Det virker fortsat andre steder og kan tilbagekaldes i Komplai.' : 'Fjern forbindelsen?';
  if (!id || !await ui.confirm(question)) return;
  let secret = connection.secret, removed = false;
  if (revoke) {
    try { secret = await readableSecret(app, id); }
    catch (error) {
      if (error?.code === 'CANCELLED') throw error;
      // Uden adgangssætningen kan nøglen aldrig læses igen. Forbindelsen må stadig kunne fjernes, ellers kan brugeren ikke
      // komme af med den; adgangen hos Komplai er så ikke tilbagekaldt og kan tilbagekaldes dér.
      ui.line(`Nøglen kan ikke læses, så Aura kan ikke tilbagekalde adgangen hos Komplai. ${error.message}`);
      if (!await ui.confirm('Fjern forbindelsen fra Aura alligevel? Adgangen kan stadig tilbagekaldes i Komplai.')) return;
      // En flytning kan have lagt nøglen i nøgleringen, før læsningen fejlede. Posten slettes med den værdi, forbindelsen har nu.
      secret = (await app.bench.store.read()).connections.find(c => c.id === id)?.secret ?? secret;
      await app.bench.store.update(state => { state.connections = state.connections.filter(c => c.id !== id); });
      await app.bench.invalidateConnection(id);
      ui.line('Forbindelsen er fjernet fra Aura. Adgangen hos Komplai er ikke tilbagekaldt; det kan gøres i Komplai.');
      removed = true;
    }
  }
  // Kunne adgangen hos komplai ikke tilbagekaldes (fx uden net), er forbindelsen fjernet alligevel, og kernen siger det i removalNotice (Q:D2-3).
  if (!removed) { const result = await app.bench.removeConnection(id); ui.line(result?.removalNotice || 'Forbindelsen er fjernet.'); }
  // Nøglen må ikke blive liggende i nøgleringen uden en forbindelse, der bruger den, heller ikke efter udvejen ovenfor (N:F-1).
  try { if (vault.forget(secret)) ui.line('Nøglen er også slettet fra computerens nøglering.'); }
  catch (error) { ui.line(`Nøglen ligger stadig i computerens nøglering og kunne ikke slettes automatisk. ${error.message}`); }
}
async function main(argv = process.argv.slice(2), ui = new Terminal()) {
  const options = parse([...argv]);
  if (options.command === 'help') { ui.line(HELP); return; }
  if (options.command === 'version') { ui.line(version); return; }
  if (options.command === 'skills') {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'harness.cjs'), ...options.args], { stdio: 'inherit', shell: false });
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); return;
  }
  configure();
  if (options.command === 'doctor') { const result = await doctor(ui); if (!result.nodeOK || !result.engineOK || !result.gitOK) process.exitCode = 1; return; }
  if (!ui.input.isTTY || !ui.output.isTTY) throw new Error('Åbn Aura i en interaktiv terminal. Piped input kan ikke godkende modelkald eller filændringer.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 12) throw new Error('Aura kræver Node 22.12 eller nyere.');
  const directory = await privateDirectory(dataDirectory());
  if (options.command === 'unlock') { await unlockStale(directory, ui); return; }
  const release = await lock(directory), vault = new Vault(directory, { keychain: chooseKeychain(process.env, directory) });
  const app = new Application({ directory, vault, ui });
  let terminating = false;
  const interrupt = () => {
    ui.interrupt();
    if (app.serverWaiting) app.dev.stop().catch(error => ui.line(error.message));
    app.stop().catch(error => ui.line(error.message));
  };
  const terminate = () => { terminating = true; app.closing = true; ui.ended = true; interrupt(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate); process.on('SIGHUP', terminate);
  try {
    if (options.command === 'login') { await login(app, options.provider); return; }
    if (options.command === 'logout') { await logout(app); return; }
    if (options.command === 'init') { if (!await init(app, path.resolve(options.project || '.'))) return; }
    else if (options.command === 'resume') {
      const recent = await app.bench.history.recent();
      const folder = await ui.choose('Hvilket projekt vil du fortsætte i?', recent.map(p => ({ label: `${p.name} · ${p.root}`, value: p.root })));
      if (!folder) return; await app.open(folder);
    } else await app.open(options.project || '.');
    if (['preview', 'save', 'deploy'].includes(options.command)) await app.command('/' + options.command);
    if (!terminating) await app.chat();
  } finally {
    try { await app.close(); } finally { release(); process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); process.off('SIGHUP', terminate); }
  }
}
if (require.main === module) {
  const ui = new Terminal();
  main(process.argv.slice(2), ui).catch(error => { ui.line(error.code === 'CANCELLED' ? 'Afbrudt.' : `Aura: ${error.message}`); process.exitCode = error.code === 'CANCELLED' ? 130 : 1; });
}
module.exports = { main, parse, HELP, logout, chooseKeychain };
