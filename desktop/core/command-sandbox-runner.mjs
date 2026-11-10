// Betroet, separat proces pr. kommando: SRTs globale indstillinger deles aldrig mellem projekter.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
const contains = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
let child, own;
try {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Teknisk isolation af kommandoer understøttes ikke på denne platform.');
  if (process.argv[2] === '--check') {
    const result = await SandboxManager.checkDependenciesAsync();
    if (process.platform === 'darwin') await fs.access('/usr/bin/sandbox-exec');
    process.stdout.write(JSON.stringify(result));
  } else {
    const policy = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    const input = JSON.parse(Buffer.from(process.argv[3], 'base64url').toString());
    if (policy.version !== 1 || typeof input.command !== 'string' || input.command.length > 200000) throw new Error('Ugyldig isoleret kommando.');
    const cwd = await fs.realpath(input.cwd);
    if (![policy.workspaceRoot, policy.scratchRoot].some(root => contains(root, cwd))) throw new Error('Arbejdsområdet er ændret. Kommandoen blev afvist.');
    // Ingen modelnøgler, motorindstillinger, proxyadgang eller brugerens shellopsætning arves.
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, policy.env);
    process.chdir(cwd);
    // SRT lægger sine proxy-sockets i os.tmpdir() under initialize. Et unix-socketnavn må højst være 104 byte på macOS og 108 på Linux,
    // og Node afkorter et længere navn uden fejl. Opgavens TMPDIR (.aura/tmp/tmp i projektet) kan være lang, fx i en OneDrive-mappe, og
    // så fejler hver kommando med EADDRINUSE. Runneren får derfor sin egen korte, private mappe (0700) til dem og fjerner den bagefter.
    // Kommandoen får stadig opgavens TMPDIR, både i miljøet herunder og gennem export i kommandoen. Mappens navn har processens id,
    // så den kan kendes fra andre kommandoers mapper.
    own = await fs.mkdtemp(`/tmp/aura-srt-${process.pid}-`);
    process.env.TMPDIR = process.env.TMP = process.env.TEMP = own;
    // På Linux lægger SRT også broerne til proxyen (claude-http-*.sock) her og binder dem ind i sandkassen, før filsystemet lægges på.
    // denyRead ['/'] giver en tom tmpfs over /tmp, så socat i sandkassen ikke kan nå broen, og kommandoen mister nettet. Mappen kan derfor
    // læses i sandkassen på Linux. Den rummer kun SRT's egne sockets; macOS bruger porte og behøver den ikke.
    const config = process.platform === 'linux' ? { ...policy.config, filesystem: { ...policy.config.filesystem, allowRead: [...policy.config.filesystem.allowRead, { path: own, literal: true }] } } : policy.config;
    await SandboxManager.initialize(config, undefined, false);
    Object.assign(process.env, { TMPDIR: policy.env.TMPDIR, TMP: policy.env.TMP, TEMP: policy.env.TEMP });
    if (!SandboxManager.isSandboxingEnabled()) throw new Error('Kommandobeskyttelsen er ikke aktiv.');
    // SRT sætter normalt en fælles TMPDIR. Den overskrives inden brugerens kommando og er ikke skrivbar i vores profil.
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    // Node/npm må ikke behøve DNS-opslag af localhost for at nå den lokale proxy. Selve værtsnavnene
    // udenfor isolationen opløses fortsat af SRT, efter den præcise domæneliste er kontrolleret.
    const proxies = 'for aura_proxy_name in HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; do aura_proxy_value="${!aura_proxy_name}"; case "$aura_proxy_value" in *localhost:*) aura_proxy_value="${aura_proxy_value%localhost:*}127.0.0.1:${aura_proxy_value##*:}";; esac; export "$aura_proxy_name=$aura_proxy_value"; done; unset aura_proxy_name aura_proxy_value; ';
    const command = `export TMPDIR=${quote(policy.env.TMPDIR)} TMP=${quote(policy.env.TMP)} TEMP=${quote(policy.env.TEMP)}; ${proxies}${input.command}`;
    const wrapped = await SandboxManager.wrapWithSandboxArgv(command, '/bin/bash', undefined, undefined, cwd);
    child = spawn(wrapped.argv[0], wrapped.argv.slice(1), { cwd, env: wrapped.env, stdio: 'inherit', detached: true });
    const stopChildren = signal => { if (child?.pid) try { process.kill(-child.pid, signal); } catch {} };
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stopChildren(signal));
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    stopChildren('SIGKILL');
    if (process.exitCode) process.stderr.write('\nKommandoen fejlede under teknisk isolation. Adgang er afgrænset til projektet, opgavens midlertidige mappe og de aftalte pakkeregistre.\n');
  }
} catch (error) { process.stderr.write('Kommandoen blev ikke kørt uden beskyttelse: ' + error.message + '\n'); process.exitCode = 1; }
finally { await SandboxManager.reset(); if (own) await fs.rm(own, { recursive: true, force: true }).catch(() => {}); }
