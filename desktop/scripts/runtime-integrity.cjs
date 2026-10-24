// SPDX-License-Identifier: EUPL-1.2
// Build evidence for locked runtime payloads. This is not a signing authority.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const assert = require('node:assert/strict');
const hash = value => createHash('sha256').update(value).digest('hex');
async function inventory(root) {
  const entries = new Map();
  async function visit(relative = '') {
    const directory = path.join(root, relative);
    for (const name of (await fs.readdir(directory)).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      if (key === 'manifest.json') continue;
      const file = path.join(root, key), before = await fs.lstat(file, { bigint: true });
      if (before.isSymbolicLink()) {
        const target = await fs.readlink(file), resolved = path.resolve(path.dirname(file), target);
        if (path.isAbsolute(target) || !resolved.startsWith(path.resolve(root) + path.sep)) throw Error('Runtime-link forlader pakken: ' + key);
        // Resolve the whole chain, including ancestor links; dangling links fail.
        const real = await fs.realpath(file);
        if (!real.startsWith(await fs.realpath(root) + path.sep)) throw Error('Runtime-link forlader pakken: ' + key);
        entries.set(key, { type: 'link', target });
      } else if (before.isDirectory()) await visit(key);
      else if (before.isFile()) {
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(file)) digest.update(chunk);
        const after = await fs.lstat(file, { bigint: true });
        if (['dev','ino','size','mtimeNs','ctimeNs'].some(field => before[field] !== after[field])) throw Error('Runtime-filen ændrede sig under kontrol: ' + key);
        entries.set(key, { type: 'file', bytes: Number(before.size), sha256: digest.digest('hex'), executable: Boolean(before.mode & 0o111n) });
      } else throw Error('Ukendt runtime-filtype: ' + key);
    }
  }
  await visit();
  const payloads = Object.fromEntries(entries);
  return { schemaVersion: 1, entries: payloads, sha256: hash(JSON.stringify(payloads)) };
}
async function verifyRuntime(root, manifest, expected, lock, target, finalPayloads = null) {
  assert.equal(manifest.target, target, 'Forkert runtime-platform');
  assert.deepEqual(manifest.archives, lock.targets[target], 'Runtime-arkiver afviger fra låsefilen');
  assert.deepEqual(manifest.sources, lock.sources || [], 'Runtime-kildearkiver afviger fra låsefilen');
  assert.deepEqual(manifest.versions, { opencode: lock.opencode, git: lock.git, node: lock.node }, 'Runtime-versioner afviger fra låsefilen');
  assert.equal(expected.payloads?.schemaVersion, 1, 'Forbered runtime igen med den aktuelle runtime:prepare');
  assert.deepEqual(manifest.payloads, expected.payloads, 'Pakkens runtimebevis afviger fra den forberedte runtime');
  const actual = await inventory(root);
  assert.deepEqual(actual, finalPayloads || expected.payloads, 'Runtime-payload er ændret, ufuldstændig eller indeholder ekstra filer');
  return { files: Object.keys(actual.entries).length, sha256: actual.sha256 };
}
module.exports = { inventory, verifyRuntime };
