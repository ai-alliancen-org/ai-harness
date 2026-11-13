// Skeptikerens fund efter RN:F-3: Windows PowerShell 5.1 skriver fejl og fremdrift som CLIXML («#< CLIXML» og et XML-dokument),
// når dens standardfejl er omdirigeret, fx ved «Forbereder moduler til første brug». Detaljerne (højst 400 tegn) viste så XML-hovedet
// og fremdriftsposten i stedet for selve fejlen, fx Constrained Language Mode. Nu læses fejlposterne ud af CLIXML, og fremdrift
// udelades. Prøven bruger PowerShell 5.1's eget format; den er ikke kørt på Windows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { windows } = require('../keychain.cjs');

const KEY = 'sk-ant-hemmelig-proeve-0123456789';
const noFile = { mkdirSync() {}, writeFileSync() {}, renameSync() {}, readFileSync() { throw Object.assign(new Error('mangler'), { code: 'ENOENT' }); }, unlinkSync() {} };
const fejl = stderr => { try { windows({ runner: () => ({ status: 1, stdout: '', stderr }), directory: os.tmpdir(), fsModule: noFile }).set('Aura CLI abcdef123456', 'konto-1', KEY); } catch (error) { return error; } };

// Fremdriften fra modulindlæsningen kommer først og fylder over 400 tegn; derefter kommer fejlen i to linjer.
const progress = '<Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj>';
const clixml = `#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">${progress}${progress.replace('RefId="0"', 'RefId="1"')}<S S="Error">Cannot invoke method. Method invocation is supported only on core types in this language mode._x000D__x000A_</S><S S="Error">At line:1 char:39_x000D__x000A_</S><S S="Error">+ ... ReadToEnd().Trim(); $u=[Text.Encoding]::Unicode.GetBytes(&lt;...&gt;)_x000D__x000A_</S></Objs>`;

test('fejlteksten i CLIXML står under detaljer uden XML og fremdrift', () => {
  const error = fejl(clixml);
  assert.match(error.details, /^PowerShell svarede: Cannot invoke method\. Method invocation is supported only on core types in this language mode\. At line:1 char:39 \+ \.\.\. ReadToEnd\(\)\.Trim\(\); \$u=\[Text\.Encoding\]::Unicode\.GetBytes\(<\.\.\.>\)$/);
  assert.doesNotMatch(error.details, /CLIXML|<Objs|Preparing modules|_x000D_/);
});

test('CLIXML med kun fremdrift giver afslutningskoden, ikke XML', () => {
  const error = fejl(`#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">${progress}</Objs>`);
  assert.equal(error.details, 'PowerShell svarede: afsluttede med kode 1 uden fejltekst.');
});

test('almindelig fejltekst uden CLIXML er uændret', () => {
  assert.equal(fejl('Ingen adgang\r\n').details, 'PowerShell svarede: Ingen adgang');
});
