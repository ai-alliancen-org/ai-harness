// SPDX-License-Identifier: EUPL-1.2
// A local build receipt, not a replacement for platform signature verification.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
const { createHash } = require('node:crypto');
const { inventory } = require('./runtime-integrity.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receiptPath = target => path.join(__dirname, '..', '.runtime', `signed-runtime-${target}.json`);
async function record(resources, target, input, verifySignature = file => run('/usr/bin/codesign', ['--verify', '--strict', file])) {
  const output = await inventory(path.join(resources, 'runtime'));
  assert.deepEqual(Object.keys(output.entries), Object.keys(input.entries), 'Signering må ikke tilføje eller fjerne runtimefiler');
  for (const [name, before] of Object.entries(input.entries)) {
    const after = output.entries[name];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    assert(before.type === 'file' && after.type === 'file' && before.executable === after.executable, 'Signering må kun ændre signerede filbytes');
    const file = path.join(resources, 'runtime', name), handle = await fs.open(file, 'r');
    const magic = Buffer.alloc(4); try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
    assert(['cffaedfe','cefaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic.toString('hex')), 'Kun Mach-O-filer må ændres under macOS-signering');
    await verifySignature(file);
  }
  const proof = await fs.readFile(path.join(resources, 'source-proof.json'));
  const receipt = { schemaVersion: 1, target, inputSha256: input.sha256, sourceProofSha256: hash(proof), payloads: output };
  await fs.mkdir(path.dirname(receiptPath(target)), { recursive: true });
  await fs.writeFile(receiptPath(target), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
async function expected(resources, target, input) {
  let value; try { value = JSON.parse(await fs.readFile(receiptPath(target), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assert.equal(value.schemaVersion, 1); assert.equal(value.target, target);
  assert.equal(value.inputSha256, input.sha256, 'Signeringsbeviset tilhører en anden runtime');
  assert.equal(value.sourceProofSha256, hash(await fs.readFile(path.join(resources, 'source-proof.json'))), 'Signeringsbeviset tilhører andre kildefiler');
  return value.payloads;
}
module.exports = { record, expected, receiptPath };
