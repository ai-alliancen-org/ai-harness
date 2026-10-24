const path = require('node:path');

// Node kører brugerens gennemgåede projektkode og skal kunne indlæse projektets
// native npm-pakker. Tilladelsen gælder kun Node, aldrig Electron eller renderere.
function signingOptions(options) {
  const node = path.join(options.app, 'Contents', 'Resources', 'runtime', 'node', 'bin', 'node');
  const previous = options.optionsForFile || (() => ({}));
  return { ...options, optionsForFile(file) {
    const selected = previous(file);
    return path.resolve(file) === node ? { ...selected, entitlements: path.resolve(__dirname, '../packaging/entitlements.node.mac.plist') } : selected;
  } };
}
async function sign(options) {
  const fs = require('node:fs/promises');
  const resources = path.join(options.app, 'Contents', 'Resources');
  const manifest = JSON.parse(await fs.readFile(path.join(resources, 'runtime', 'manifest.json'), 'utf8'));
  const prepared = JSON.parse(await fs.readFile(path.join(__dirname, '..', '.runtime', manifest.target, 'manifest.json'), 'utf8'));
  await require('./runtime-integrity.cjs').verifyRuntime(path.join(resources, 'runtime'), manifest, prepared, require('../runtime-lock.json'), manifest.target);
  await require('app-builder-lib/out/codeSign/macCodeSign').sign(signingOptions(options));
  // The outer bundle is already sealed: keep the final exact-byte receipt in the
  // trusted build directory, never mutate signed Resources or learn it on verify.
  await require('./signed-runtime-proof.cjs').record(resources, manifest.target, prepared.payloads);
}
module.exports = { sign, signingOptions };
