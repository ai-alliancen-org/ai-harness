const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { repository, versionPattern, assetURL } = require('./release-contract.cjs');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function names(version) {
  if (!versionPattern.test(version)) throw new Error('Ugyldig CLI-version.');
  return [`aura-harness-${version}.tgz`, 'WINDOWS.md', 'LINUX.md', 'MACOS.md', 'CLI-RELEASE.json', 'SHA256SUMS.txt'];
}
// Den OpenCode-version, npm-pakken låser. Alle motorpakkerne skal have samme version.
function lockedOpenCode(pkg) {
  const versions = [...new Set(Object.entries(pkg?.optionalDependencies || {}).filter(([name]) => /^opencode-/.test(name)).map(([, version]) => version))];
  if (versions.length !== 1 || !/^\d+\.\d+\.\d+$/.test(versions[0])) throw new Error('Motorpakkerne i package.json skal have præcis samme OpenCode-version.');
  return versions[0];
}
// Platformsguiderne følger med udgivelsen ordret. Filnavnet skal være pakkens, og guiden skal nævne den OpenCode-version,
// pakken låser, og ingen anden; ellers melder doctor noget andet end vejledningen (fund 52). opencode er null for en lokal
// prøve, som må bygges, før guiderne er skrevet om til næste udgivelse. Returnerer en forklaring eller null.
function guideProblem(name, text, { tarball, opencode = null }) {
  const packages = text.match(/aura-harness-\d+\.\d+\.\d+(?:-beta\.\d+)?\.tgz/g) || [];
  if (!packages.length || packages.some(p => p !== tarball)) return `Opdatér filnavnet i cli/${name} til ${tarball}, så webguide og pakke stemmer overens.`;
  if (opencode === null) return null;
  const versions = [...text.matchAll(/OpenCode (\d+\.\d+\.\d+)/g)].map(match => match[1]);
  if (!versions.length || versions.some(version => version !== opencode)) return `cli/${name} skal nævne OpenCode ${opencode}, som pakken låser, så doctor og vejledningen siger det samme.`;
  return null;
}
// Teksterne til næste CLI-udgivelse ligger i et udkast, indtil versionen løftes. Udkastet nævner den udgivne version, som
// guiderne og udgivelsesnoterne stadig beskriver. Er package.json løftet, mens udkastet findes, ville udgivelsen sende tekster
// om den forrige CLI med ud, fx adgangssætningslageret i stedet for nøgleringen (fund 45). text er udkastets indhold, eller
// null når det ikke findes. Returnerer en forklaring eller null.
const draftFile = 'docs/releases/cli-naeste-udkast.md';
function draftProblem(text, version) {
  if (text === null || text === undefined) return null;
  const base = /Gælder ikke den udgivne CLI (\d+\.\d+\.\d+(?:-beta\.\d+)?)\./.exec(text)?.[1];
  if (!base) return `${draftFile} skal nævne den udgivne CLI, det bygger på («Gælder ikke den udgivne CLI VERSION.»), så udgivelseskontrollen kan se, om versionen er løftet.`;
  if (base === version) return null;
  return `Versionen er ${version}, men ${draftFile} findes stadig. Teksterne dér beskriver CLI'en efter ${base}: flyt dem ind i de tre platformsguider, cli/README.md og docs/releases/cli-beta.md, og slet udkastet i samme commit.`;
}
function allowedSource(name) {
  return /^(LICENSE|README\.md|package\.json|npm-shrinkwrap\.json|cli\/[\w-]+\.(cjs|md)|desktop\/core\/[\w-]+\.(?:cjs|mjs)|desktop\/ui\/(?:approval-view|conversation-mode|plan-view)\.js|desktop\/runtime-lock\.json|scripts\/harness\.cjs)$/.test(name)
    || /^profiles\/[a-zA-Z0-9_/-]+\.(md|json|txt)$/.test(name);
}
// Læs de faktiske npm-arkivfiler uden at udpakke eller udføre dem.
function unpack(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }), files = new Map();
  const string = b => b.toString('utf8').replace(/\0.*$/s, '');
  let end = false;
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every(b => b === 0)) { end = tar.subarray(at).every(b => b === 0); break; }
    const number = b => { const s = string(b).trim(); if (!/^[0-7]+$/.test(s)) throw new Error('Ugyldig tar-værdi.'); return parseInt(s, 8); };
    const check = [...header].reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0);
    if (check !== number(header.subarray(148, 156))) throw new Error('Arkivets header er ændret.');
    const prefix = string(header.subarray(345, 500));
    const name = (prefix ? prefix + '/' : '') + string(header.subarray(0, 100));
    const relative = name.replace(/^package\//, '');
    const size = number(header.subarray(124, 136));
    if (!name.startsWith('package/') || relative.split('/').some(p => !p || p === '.' || p === '..') || !allowedSource(relative)
      || ![0, 48].includes(header[156]) || files.has(relative) || at + 512 + size > tar.length) throw new Error(`Uventet fil i CLI-pakken: ${name}`);
    files.set(relative, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  if (!end || !files.has('cli/aura.cjs') || !files.has('package.json')) throw new Error('CLI-arkivet er ufuldstændigt.');
  return files;
}
function releaseFiles(release, { draft = false } = {}) {
  const match = /^cli-v(.+)$/.exec(release?.tag_name || '');
  if (!match || !versionPattern.test(match[1]) || !Array.isArray(release.assets)) return [];
  const expected = names(match[1]);
  if (release.assets.length !== expected.length || new Set(release.assets.map(a => a.name)).size !== expected.length) return [];
  // GitHub giver kladders filer et midlertidigt untagged-link. Offentlige links
  // skal stadig matche det præcise versionstag; Pages bruger aldrig denne undtagelse.
  const draftTag = draft && release.draft === true
    ? release.assets[0]?.browser_download_url?.match(/\/releases\/download\/(untagged-[a-f0-9]{1,64})\//)?.[1] : null;
  for (const a of release.assets) {
    if (!expected.includes(a.name) || a.state !== 'uploaded' || !Number.isSafeInteger(a.size) || a.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(a.digest || '')) return [];
    if (a.browser_download_url !== assetURL(release.tag_name, a.name)
      && (!draftTag || a.browser_download_url !== assetURL(draftTag, a.name))) throw new Error('CLI-downloadadressen matcher ikke repository og version.');
  }
  return expected.map(name => release.assets.find(a => a.name === name));
}
function validateRelease(release, files, version) {
  if (!release?.draft || !release.prerelease || !release.body?.trim() || release.tag_name !== `cli-v${version}`) throw new Error('CLI-udgivelsen skal være en kladde med betamarkering, noter og korrekt tag.');
  const assets = releaseFiles(release, { draft: true });
  if (!assets.length) throw new Error('CLI-udgivelsen mangler filer eller kontrolsummer.');
  for (const a of assets) {
    const bytes = files.get(a.name);
    if (!bytes || a.size !== bytes.length || a.digest !== `sha256:${sha256(bytes)}`) throw new Error(`CLI-filens SHA-256 eller størrelse stemmer ikke: ${a.name}`);
  }
}
module.exports = { repository, names, sha256, allowedSource, unpack, releaseFiles, validateRelease, lockedOpenCode, guideProblem, draftFile, draftProblem };
