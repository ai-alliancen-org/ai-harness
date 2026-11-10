// Computerens nøglering til terminalens API-nøgler, uden nyt native modul.
// macOS: security (Nøglering). Windows: DPAPI via PowerShell. Linux: secret-tool (libsecret).
// En nøgle står aldrig i et kommandolinjeargument (ps viser dem). Den sendes på stdin, og kun som base64, så ingen tegn kan
// forveksles med kommandosyntaks. Navne (tjeneste og konto) er faste, kontrollerede tegn og er ikke hemmelige.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

class KeychainError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const NAME = /^[A-Za-z0-9 ._-]{1,80}$/;
const ACCOUNT = /^[A-Za-z0-9._-]{1,80}$/;
function checkNames(service, account) {
  if (!NAME.test(service) || !ACCOUNT.test(account)) throw new KeychainError('INVALID', 'Ugyldigt navn til nøgleringen.');
}
const encode = value => Buffer.from(value, 'utf8').toString('base64');
const decode = value => Buffer.from(value.trim(), 'base64').toString('utf8');
function run(command, args, { input, timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}
// Windows PowerShell 5.1 skriver fejl og fremdrift som CLIXML («#< CLIXML» og XML), når standardfejl er omdirigeret. Så læses
// kun fejlposterne (<S S="Error">) ud; fremdrift som «Preparing modules for first use» udelades, og XML-tegn og _x000D_ afkodes.
function clixmlErrors(text) {
  if (!/^\s*#< CLIXML/.test(text)) return text;
  const entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  return [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(match => match[1]
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, name) => entities[name])).join('\n');
}
// PowerShells egen fejltekst til detaljerne, så en Windows-tester kan se årsagen, fx Constrained Language Mode (RN:F-3).
// Nøglen går gennem stdin og indgår hverken i scriptet eller dets fejltekst. Teksten renses alligevel for styretegn og
// lange base64- eller hex-værdier og afkortes. Andre værktøjers rå tekst vises ikke.
function powershellDetails(result) {
  const text = clixmlErrors(String(result.stderr || '')).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[A-Za-z0-9+/=_-]{40,}/g, '••••').replace(/\s+/g, ' ').trim();
  if (!text) return `PowerShell svarede: afsluttede med kode ${result.status} uden fejltekst.`;
  return `PowerShell svarede: ${text.length > 400 ? text.slice(0, 400) + ' …' : text}`;
}
function failure(tool, result, hint) {
  const error = classify(tool, result, hint);
  if (tool === 'PowerShell' && !result.error) error.details = powershellDetails(result);
  return error;
}
function classify(tool, result, hint) {
  if (result.error?.code === 'ENOENT') return new KeychainError('UNAVAILABLE', `${tool} findes ikke på denne computer.${hint ? ' ' + hint : ''}`);
  if (result.error?.code === 'ETIMEDOUT') return new KeychainError('LOCKED', 'Nøgleringen svarede ikke i tide. Den er måske låst og venter på dig.');
  if (result.error) return new KeychainError('UNAVAILABLE', `${tool} kunne ikke startes.`);
  const text = result.stderr;
  if (/-25308|interaction is not allowed|locked|unlock/i.test(text)) return new KeychainError('LOCKED', 'Nøgleringen er låst. Lås den op, og prøv igen.');
  if (/-128|-25293|cancel|denied|dismiss|not correct/i.test(text)) return new KeychainError('DENIED', 'Nøgleringen afviste adgangen.');
  if (/autolaunch|DBus|D-Bus|org\.freedesktop\.secrets|no such interface|bus/i.test(text)) return new KeychainError('UNAVAILABLE', `Ingen nøgletjeneste kører.${hint ? ' ' + hint : ''}`);
  return new KeychainError('DENIED', 'Nøgleringen kunne ikke bruges.');
}

function macos({ runner = run } = {}) {
  const missing = result => result.status === 44 || /could not be found|-25300/i.test(result.stderr);
  return {
    name: 'macOS Nøglering',
    set(service, account, secret) {
      checkNames(service, account);
      // security -i læser kommandoen fra stdin, så nøglen ikke står i argv. -U overskriver en eksisterende post.
      const line = `add-generic-password -U -s "${service}" -a "${account}" -l "${service}" -w "${encode(secret)}"\n`;
      const result = runner('security', ['-i'], { input: line });
      if (result.error || result.status !== 0 || /security: |SecKeychain|error/i.test(result.stderr)) throw failure('security', result);
    },
    get(service, account) {
      checkNames(service, account);
      const result = runner('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
      if (missing(result)) return null;
      if (result.error || result.status !== 0) throw failure('security', result);
      return decode(result.stdout);
    },
    delete(service, account) {
      checkNames(service, account);
      const result = runner('security', ['delete-generic-password', '-s', service, '-a', account]);
      if (missing(result)) return false;
      if (result.error || result.status !== 0) throw failure('security', result);
      return true;
    }
  };
}

function linux({ runner = run } = {}) {
  const hint = 'Installér libsecret-tools (secret-tool), og start en nøgletjeneste som GNOME Nøglering eller KWallet.';
  const attributes = (service, account) => ['service', service, 'account', account];
  return {
    name: 'computerens nøgletjeneste (libsecret)',
    set(service, account, secret) {
      checkNames(service, account);
      const result = runner('secret-tool', ['store', `--label=${service}`, ...attributes(service, account)], { input: encode(secret) });
      if (result.error || result.status !== 0) throw failure('secret-tool', result, hint);
    },
    get(service, account) {
      checkNames(service, account);
      const result = runner('secret-tool', ['lookup', ...attributes(service, account)]);
      if (result.error) throw failure('secret-tool', result, hint);
      if (result.status === 1 && !result.stderr.trim() && !result.stdout) return null;
      if (result.status !== 0) throw failure('secret-tool', result, hint);
      return decode(result.stdout);
    },
    delete(service, account) {
      checkNames(service, account);
      const result = runner('secret-tool', ['clear', ...attributes(service, account)]);
      if (result.error || (result.status !== 0 && result.stderr.trim())) throw failure('secret-tool', result, hint);
      return true;
    }
  };
}

// Windows har ingen kommandolinje til Credential Manager, der kan læse en post tilbage. DPAPI gør det samme arbejde for den
// aktuelle Windows-bruger: PowerShell krypterer nøglen, og den krypterede tekst ligger i en fil i datamappen. Uden for din
// Windows-konto kan filen ikke åbnes. Nøglen går gennem stdin.
// Nøglen må hverken stå i en cmdlet-parameter eller komme ud som pipeline-output. PowerShells modullogning (hændelse 4103)
// skriver parameterværdier ordret, og transskription skriver alt, der går gennem værten. Derfor kaldes DPAPI direkte gennem
// .NET, og svaret skrives med [Console]::Out uden om værten (fund 44). Filformatet er det samme som ConvertFrom-SecureString
// uden -Key: hex af DPAPI (CurrentUser) over nøglen i UTF-16LE. Nøgler gemt før rettelsen kan derfor stadig læses.
const PROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$t=[Console]::In.ReadToEnd().Trim()',
  '$u=[Text.Encoding]::Unicode.GetBytes([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)))',
  '$p=[Security.Cryptography.ProtectedData]::Protect($u,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Array]::Clear($u,0,$u.Length)',
  "[Console]::Out.Write([BitConverter]::ToString($p).Replace('-','').ToLowerInvariant())",
  '[Console]::Out.Flush()'
].join('; ');
const UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$h=[Console]::In.ReadToEnd().Trim()',
  "if($h -notmatch '^(?:[0-9a-fA-F]{2})+$'){throw 'invalid key file'}",
  '$d=[byte[]]::new([int]($h.Length/2))',
  'for($i=0;$i -lt $d.Length;$i++){$d[$i]=[Convert]::ToByte($h.Substring($i*2,2),16)}',
  '$u=[Security.Cryptography.ProtectedData]::Unprotect($d,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Text.Encoding]::Unicode.GetString($u)))',
  '[Array]::Clear($u,0,$u.Length)',
  '[Console]::Out.Write($b)',
  '[Console]::Out.Flush()'
].join('; ');
function windows({ runner = run, directory, fsModule = fs } = {}) {
  const powershell = (script, input) => runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input });
  // Tjenestenavnet indeholder datamappens hash; filen får det som præfiks, så to datamapper aldrig deler fil.
  const file = (service, account) => path.join(directory, 'keys', `${service.replace(/[^A-Za-z0-9._-]/g, '_')}.${account}.dpapi`);
  return {
    name: 'Windows (DPAPI, knyttet til din Windows-konto)',
    set(service, account, secret) {
      checkNames(service, account);
      const result = powershell(PROTECT, encode(secret));
      if (result.error || result.status !== 0 || !result.stdout.trim()) throw failure('PowerShell', result);
      const target = file(service, account), temporary = `${target}.${randomUUID()}.tmp`;
      fsModule.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fsModule.writeFileSync(temporary, result.stdout.trim() + '\n', { mode: 0o600 });
      fsModule.renameSync(temporary, target);
    },
    get(service, account) {
      checkNames(service, account);
      let blob; try { blob = fsModule.readFileSync(file(service, account), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw new KeychainError('DENIED', 'Nøglefilen kunne ikke læses.'); }
      const result = powershell(UNPROTECT, blob);
      if (result.error || result.status !== 0 || !result.stdout.trim()) throw failure('PowerShell', result);
      return decode(result.stdout);
    },
    delete(service, account) {
      checkNames(service, account);
      try { fsModule.unlinkSync(file(service, account)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw new KeychainError('DENIED', 'Nøglefilen kunne ikke slettes.'); }
    }
  };
}

function createKeychain({ platform = process.platform, directory, runner } = {}) {
  const options = runner ? { runner } : {};
  if (platform === 'darwin') return macos(options);
  if (platform === 'win32') { if (!directory) throw new Error('Windows kræver datamappen til nøglefilerne.'); return windows({ ...options, directory }); }
  return linux(options);
}
// Navnet identificerer datamappen, så to datamapper (AURA_HOME) aldrig deler eller overskriver hinandens poster.
function serviceName(root) {
  return `Aura CLI ${createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12)}`;
}
module.exports = { createKeychain, serviceName, KeychainError, macos, linux, windows };
