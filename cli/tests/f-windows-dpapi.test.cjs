// Fund 44 på en rigtig Windows-maskine. De andre prøver af Windows-nøglen bruger et falsk powershell.exe og ser kun
// scriptets tekst. Her går en opdigtet nøgle gennem DPAPI og den rigtige powershell.exe (Windows PowerShell 5.1) i en
// midlertidig mappe. På macOS og Linux springes prøverne over; Windows-nøglen er kun afprøvet, når de har bestået på Windows.
// Prøverne rører hverken Credential Manager, registreringsdatabasen, gruppepolitik eller hændelseslogge.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { windows } = require('../keychain.cjs');

const skip = process.platform !== 'win32' && 'Kræver Windows og powershell.exe. Ikke kørt på denne platform.';
const KEY = 'sk-ant-opdigtet-proeve-0123456789 æøå "x" $y';
const BASE64 = Buffer.from(KEY, 'utf8').toString('base64');
const SERVICE = 'Aura CLI abcdef123456';
// Scripts fra før rettelsen (1cfa7a6). De bruges kun som modprøve med den opdigtede nøgle: filformatet skal være det samme i
// begge retninger, og den gamle læsning skal kunne ses i et transskript, ellers kan transskriptprøven ikke skelne noget.
const OLD_PROTECT = "$ErrorActionPreference='Stop'; $t=[Console]::In.ReadToEnd().Trim(); $b=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)); ConvertTo-SecureString -String $b -AsPlainText -Force | ConvertFrom-SecureString";
const OLD_UNPROTECT = "$ErrorActionPreference='Stop'; $t=[Console]::In.ReadToEnd().Trim(); $s=ConvertTo-SecureString -String $t; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { $x=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($x))";

function powershell(script, input) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-dpapi-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
// Samme filnavn, som backenden bruger.
const keyFile = (directory, account) => path.join(directory, 'keys', `${SERVICE.replace(/[^A-Za-z0-9._-]/g, '_')}.${account}.dpapi`);
// Transskriptets tegnsæt afhænger af PowerShell-versionen; søg i både UTF-8 og UTF-16.
const contains = (bytes, text) => bytes.includes(Buffer.from(text, 'utf8')) || bytes.includes(Buffer.from(text, 'utf16le'));
// Kører et script uændret, men inde i et PowerShell-transskript, som når organisationen slår transskription til. Markøren
// skrives gennem værten og viser, at transskriptet fanger værtens output. Den sættes sammen under kørslen, så den ikke står
// ordret i kommandolinjen, som transskriptets hoved gengiver. Den fjernes fra stdout igen, før backenden læser svaret.
function transcribed(transcript, marker) {
  const quoted = transcript.replace(/'/g, "''"), half = Math.floor(marker.length / 2);
  return (command, args, options = {}) => {
    const script = args[args.length - 1];
    const result = powershell(`Start-Transcript -LiteralPath '${quoted}' -Append | Out-Null; Write-Host ('${marker.slice(0, half)}' + '${marker.slice(half)}'); ${script}; Stop-Transcript | Out-Null`, options.input);
    return { ...result, stdout: result.stdout.split(marker).join('') };
  };
}

test('fund 44 (Windows): DPAPI gemmer, læser og sletter nøglen gennem den rigtige powershell.exe', { skip }, async t => {
  const directory = await temporary(t), backend = windows({ directory }), account = randomUUID();
  backend.set(SERVICE, account, KEY);
  const stored = await fs.readFile(keyFile(directory, account), 'utf8');
  // Samme form som ConvertFrom-SecureString: hex med små bogstaver af en DPAPI-klat, der begynder med version 1 og DPAPI's
  // udbyder-GUID {df9d8cd0-1501-11d1-8c7a-00c04fc297eb}.
  assert.match(stored, /^01000000d08c9ddf0115d1118c7a00c04fc297eb[0-9a-f]+\n$/);
  assert.ok(!stored.includes(Buffer.from(KEY, 'utf16le').toString('hex')) && !stored.includes(Buffer.from(KEY, 'utf8').toString('hex')), 'nøglen står ukrypteret i filen');
  assert.equal(backend.get(SERVICE, account), KEY);
  assert.equal(backend.delete(SERVICE, account), true);
  assert.equal(backend.get(SERVICE, account), null);
});

test('fund 44 (Windows): filformatet er det samme som ConvertFrom-SecureString og ConvertTo-SecureString i begge retninger', { skip }, async t => {
  const directory = await temporary(t), backend = windows({ directory });
  const fresh = randomUUID();
  backend.set(SERVICE, fresh, KEY);
  const read = powershell(OLD_UNPROTECT, await fs.readFile(keyFile(directory, fresh), 'utf8'));
  assert.equal(read.status, 0, read.stderr);
  assert.equal(Buffer.from(read.stdout.trim(), 'base64').toString('utf8'), KEY, 'ConvertTo-SecureString læser en ny fil');
  const written = powershell(OLD_PROTECT, BASE64);
  assert.equal(written.status, 0, written.stderr);
  const legacy = randomUUID();
  await fs.writeFile(keyFile(directory, legacy), written.stdout.replace(/\s+/g, '') + '\n');
  assert.equal(backend.get(SERVICE, legacy), KEY, 'Aura læser en fil fra ConvertFrom-SecureString');
});

test('fund 44 (Windows): hverken nøglen eller dens base64 kommer i et PowerShell-transskript, som den gamle læsning gjorde', { skip }, async t => {
  const directory = await temporary(t), marker = `aura-transskript-${randomUUID()}`;
  const transcript = path.join(directory, 'ny.txt'), account = randomUUID();
  const backend = windows({ directory, runner: transcribed(transcript, marker) });
  backend.set(SERVICE, account, KEY);
  assert.equal(backend.get(SERVICE, account), KEY);
  const written = await fs.readFile(transcript);
  assert.ok(contains(written, marker), 'transskriptet fanger ikke engang værtens output, så prøven beviser intet');
  assert.ok(!contains(written, KEY), 'nøglen står i transskriptet');
  assert.ok(!contains(written, BASE64), 'nøglens base64 står i transskriptet');
  // Modprøve: den gamle læsning sendte base64 af nøglen gennem værten. Det skal kunne ses i et transskript.
  const control = path.join(directory, 'gammel.txt');
  const old = transcribed(control, marker)('powershell.exe', [OLD_UNPROTECT], { input: await fs.readFile(keyFile(directory, account), 'utf8') });
  assert.equal(old.status, 0, old.stderr);
  assert.ok(contains(await fs.readFile(control), BASE64), 'den gamle læsning står ikke i transskriptet, så prøven kan ikke skelne');
});
