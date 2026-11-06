#!/usr/bin/env node
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Terminal } = require('./terminal.cjs');
const { createKeychain } = require('./keychain.cjs');
const { Vault, dataDirectory, privateDirectory, lock, unlockStale } = require('./storage.cjs');
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
async function logout(app) {
  const { ui, vault } = app;
  const connections = (await app.bench.store.read()).connections;
  if (!connections.length) { ui.line('Ingen gemte forbindelser.'); return; }
  const id = await ui.choose('Hvilken forbindelse skal fjernes?', connections.map(c => ({ label: c.kind === 'komplai' ? `${c.name} · udgået AI-forbindelse` : c.name, value: c.id })));
  const connection = connections.find(c => c.id === id);
  const revoke = connection?.kind === 'komplai' && connection.account?.authMethod !== 'token';
  const question = revoke ? 'Fjern forbindelsen og tilbagekald denne loginadgang hos Komplai?' : connection?.kind === 'komplai' ? 'Fjern tokenet fra Aura? Det virker fortsat andre steder og kan tilbagekaldes i Komplai.' : 'Fjern forbindelsen?';
  if (id && await ui.confirm(question)) {
    if (revoke) await vault.unlock(ui);
    await app.bench.removeConnection(id); ui.line('Forbindelsen er fjernet.');
    // Nøglen må ikke blive liggende i nøgleringen uden en forbindelse, der bruger den.
    try { if (vault.forget(connection.secret)) ui.line('Nøglen er også slettet fra computerens nøglering.'); }
    catch (error) { ui.line(`Nøglen ligger stadig i computerens nøglering og kunne ikke slettes automatisk. ${error.message}`); }
  }
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
