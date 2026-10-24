// SPDX-License-Identifier: EUPL-1.2
// Provenance for reproducible local package checks, not an authenticated signature.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
async function sourceProof(root, names) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const files = {};
  for (const name of [...new Set(names)].sort()) {
    const file = path.resolve(root, name);
    const gitPath = path.relative(path.dirname(root), file).split(path.sep).join('/');
    if (!gitPath || gitPath.startsWith('../') || path.isAbsolute(gitPath)) throw Error('Ukendt kildefil i pakkebeviset.');
    const current = await fs.readFile(file);
    const committed = execFileSync('git', ['show', `${sourceCommit}:${gitPath}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    if (!current.equals(committed)) throw Error('Commit produktændringen før pakning: ' + gitPath);
    files[gitPath] = hash(current);
  }
  return { schemaVersion: 1, sourceCommit, files };
}
async function create(root, output) {
  const { files } = require('./verify-package-source.cjs');
  const names = ['package.json', 'package-lock.json', 'runtime-lock.json', 'main.cjs', 'preload.cjs', ...await files(path.join(root, 'core'), 'core/'), ...await files(path.join(root, 'ui'), 'ui/'), '../LICENSE', '../profiles/catalog.json', '../profiles/grundregler.md', '../profiles/gitignore.txt', ...await files(path.join(root, '../profiles/skills'), '../profiles/skills/')];
  const proof = await sourceProof(root, names);
  await fs.writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  return proof;
}
async function verify(root, proof) {
  if (proof?.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(proof.sourceCommit) || !proof.files || !Object.keys(proof.files).length) throw Error('Pakkens kildebevis mangler eller er ugyldigt.');
  for (const [name, expected] of Object.entries(proof.files)) {
    if (!/^(desktop|profiles)\//.test(name) && name !== 'LICENSE' || name.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Ugyldig kildepost i pakkebeviset.');
    const committed = execFileSync('git', ['show', `${proof.sourceCommit}:${name}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    if (hash(committed) !== expected || hash(await fs.readFile(path.resolve(root, '..', name))) !== expected) throw Error('Pakkens kildebevis matcher ikke commit og arbejdsmappe: ' + name);
  }
  return { sourceCommit: proof.sourceCommit, files: Object.keys(proof.files).length };
}
module.exports = { sourceProof, create, verify };
