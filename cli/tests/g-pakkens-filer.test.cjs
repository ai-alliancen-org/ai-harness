// CLI-pakken skal indeholde alle de filer, terminalen indlæser (skeptikerens fund efter reparationen af G1 og G2). core/chat-session.cjs
// kræver ui/approval-view.js, men pakken tog kun ui/conversation-mode.js og ui/plan-view.js med, så den udgivne CLI ikke kunne indlæse
// workbench og chat-session. Fra repoet ses det ikke, fordi filen findes på disken. Prøven spørger npm, hvilke filer pakken får
// (npm pack --dry-run, uden net), og følger hver relativ require og import fra pakkens indgang (bin) gennem de filer, den rammer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { allowedSource } = require('../../scripts/cli-release-contract.cjs');
const repo = path.join(__dirname, '..', '..');

// npm, som hører til den Node, der kører prøven.
function npmCli() {
  const bin = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath, path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const file = candidates.find(candidate => candidate && /npm-cli\.js$/.test(candidate) && fs.existsSync(candidate));
  if (!file) throw new Error('npm blev ikke fundet ved siden af den Node, der kører prøven.');
  return file;
}
function packedFiles() {
  const output = execFileSync(process.execPath, [npmCli(), 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return new Set(JSON.parse(output)[0].files.map(file => file.path.split(path.sep).join('/')));
}
// Relative stier i require('…'), import … from '…' og import('…') med en fast tekst. Kommentarer fjernes ikke; en sti i en kommentar
// skal også findes, ellers er kommentaren forkert.
function relativeSpecifiers(source) {
  const found = new Set();
  for (const pattern of [/require\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g, /\bfrom\s+(['"])(\.{1,2}\/[^'"]+)\1/g, /\bimport\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.add(match[2]);
  }
  return [...found];
}
function resolve(from, specifier) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  for (const candidate of [target, target + '.cjs', target + '.js', target + '.mjs', target + '.json']) if (fs.existsSync(path.join(repo, candidate)) && fs.statSync(path.join(repo, candidate)).isFile()) return candidate;
  return target;
}
// Alle filer, terminalen kan nå fra indgangen.
function reachable(entry) {
  const seen = new Map([[entry, null]]), queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (!/\.(cjs|js|mjs)$/.test(file)) continue;
    const source = fs.readFileSync(path.join(repo, file), 'utf8');
    for (const specifier of relativeSpecifiers(source)) {
      const target = resolve(file, specifier);
      if (!seen.has(target)) { seen.set(target, file); queue.push(target); }
    }
  }
  return seen;
}

test('alle filer, terminalen indlæser, kommer med i npm-pakken og er tilladt i udgivelseskontrakten', () => {
  const packed = packedFiles(), pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const entry = pkg.bin.aura.replace(/^\.\//, '');
  assert.ok(packed.has(entry), 'indgangen er med i pakken');
  const files = reachable(entry);
  // Forudsætningen: prøven når de filer, hvor fejlen sad.
  for (const file of ['desktop/core/workbench.cjs', 'desktop/core/chat-session.cjs']) assert.ok(files.has(file), `${file} nås fra ${entry}`);
  const missing = [...files].filter(([file]) => !packed.has(file)).map(([file, from]) => `${file} (kræves af ${from})`);
  assert.deepEqual(missing, [], 'filer, pakken mangler');
  const refused = [...files.keys()].filter(file => !allowedSource(file));
  assert.deepEqual(refused, [], 'filer, udgivelseskontrakten ikke tillader i arkivet');
});
