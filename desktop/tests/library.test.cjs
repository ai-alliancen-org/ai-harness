const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadLibrary, validateSkillText } = require('../core/library.cjs');
const { layoutFor } = require('../core/adapters.cjs');
const installer = require('../core/installer.cjs');
const profiles = path.join(__dirname, '..', '..', 'profiles');

async function temp(t, prefix) { const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); t.after(() => fs.rm(root, { recursive: true, force: true })); return fs.realpath(root); }
const skill = { name: 'harness-a', title: 'A', summary: 'Gør A.', faq: { hvad: 'a', hvornaar: 'b', resultat: 'c', ikke: 'd' }, sources: [] };
const tool = { id: 'codex', name: 'Codex', vendor: 'OpenAI', category: 'agent', status: 'dokumenteret', summary: 's', verification: 'v', caveat: 'c', sources: [{ title: 'Kilde', url: 'https://example.org' }], rules: { file: 'AGENTS.md', mode: 'blok' }, skills: { dirs: ['.agents/skills'] } };
async function fixture(t, change = {}) {
  const parent = await temp(t, 'harness-bibliotek-'), root = path.join(parent, 'profiles');
  await fs.mkdir(root);
  await fs.copyFile(path.join(profiles, '../LICENSE'), path.join(parent, 'LICENSE'));
  const catalog = { schemaVersion: 2, version: '0.2.0', checkedAt: '2026-09-29', controlWord: 'PRØVE-02', skillDirs: ['.agents/skills', '.claude/skills'], neutralSkillDir: '.agents/skills', featuredTools: ['codex'], categories: [{ id: 'alt', title: 'Alt', summary: 'Alle skills.', skills: ['harness-a'] }], features: [{ id: 'alt', title: 'Alt', summary: 'Alle skills.', skills: ['harness-a'] }], questions: [{ q: 'Spørgsmål?', a: 'Svar.' }], skills: [skill], tools: [tool], ...change.catalog };
  await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify(catalog));
  await fs.writeFile(path.join(root, 'grundregler.md'), change.rules ?? 'Version: 0.2.0\nKontrolord: PRØVE-02\n');
  await fs.writeFile(path.join(root, 'gitignore.txt'), '.env\n');
  await fs.mkdir(path.join(root, 'skills', 'harness-a', 'references'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills', 'harness-a', 'SKILL.md'), change.skill ?? '---\nname: harness-a\ndescription: Gør A, når opgaven kræver det.\n---\n# A\nLæs references/detaljer.md ved behov.\n');
  await fs.writeFile(path.join(root, 'skills', 'harness-a', 'references', 'detaljer.md'), 'Detaljer.\n');
  for (const [file, content] of Object.entries(change.files || {})) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  return root;
}

test('det rigtige bibliotek er gyldigt, og hvert værktøj kan installeres og fjernes igen', async t => {
  const library = await loadLibrary(profiles);
  assert.equal(library.skills.length, 17);
  assert.ok(library.tools.length >= 20, `${library.tools.length} værktøjer`);
  assert.ok(library.rules.includes(library.controlWord));
  for (const item of library.tools.filter(entry => entry.rules)) {
    const root = await temp(t, `harness-${item.id}-`);
    const layout = layoutFor(library, [item.id]);
    const settings = { version: library.version, tools: layout.tools };
    const plan = await installer.plan(root, layout.entries, settings);
    assert.ok(plan.operations.every(op => op.action === 'opret'), item.id);
    await installer.apply(root, layout.entries, settings, plan.token);
    for (const dir of layout.dirs) assert.ok((await fs.readFile(path.join(root, dir, 'harness-sikkerhedsgennemgang', 'SKILL.md'), 'utf8')).includes('name: harness-sikkerhedsgennemgang'), `${item.id} ${dir}`);
    const removal = await installer.planRemoval(root);
    await installer.remove(root, removal.token);
    assert.deepEqual(await fs.readdir(root), [], item.id);
  }
});

test('et samlet valg af alle værktøjer giver én installation uden modstridende filer', async t => {
  const library = await loadLibrary(profiles);
  const ids = library.tools.filter(item => item.rules).map(item => item.id);
  const layout = layoutFor(library, ids);
  const root = await temp(t, 'harness-alle-');
  const settings = { version: library.version, tools: layout.tools };
  const plan = await installer.plan(root, layout.entries, settings);
  await installer.apply(root, layout.entries, settings, plan.token);
  assert.ok(layout.dirs.includes('.agents/skills') && layout.dirs.includes('.claude/skills'));
  assert.equal(new Set(layout.entries.map(entry => entry.path)).size, layout.entries.length);
});

test('Komplai Run vælges til særskilt og installeres med hele referencen til hvert kodeværktøj', async t => {
  const library = await loadLibrary(profiles), name = 'harness-integration-komplai-run';
  const skill = library.skills.find(item => item.name === name);
  assert.deepEqual(skill.files.map(file => file.path).sort(), ['SKILL.md', 'references/run.md']);
  for (const tool of library.tools.filter(item => item.rules)) {
    assert.ok(!layoutFor(library, [tool.id]).skills.includes(name), `${tool.id}: ikke med som standard`);
    const layout = layoutFor(library, [tool.id], { skills: [name] });
    assert.deepEqual(layout.skills, [name]);
    const root = await temp(t, `harness-run-${tool.id}-`);
    const settings = { version: library.version, tools: layout.tools, skills: layout.skills };
    const plan = await installer.plan(root, layout.entries, settings);
    await installer.apply(root, layout.entries, settings, plan.token);
    for (const dir of layout.dirs) for (const file of skill.files) {
      assert.equal(await fs.readFile(path.join(root, dir, name, file.path), 'utf8'), file.content, `${tool.id}: ${file.path}`);
    }
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.harness/installation.json'), 'utf8'));
    assert.deepEqual(manifest.skills, [name]);
    const again = await installer.plan(root, layout.entries, settings);
    assert.ok(again.operations.every(operation => operation.action === 'uaendret'), tool.id);
    const removal = await installer.planRemoval(root);
    await installer.remove(root, removal.token);
    assert.deepEqual(await fs.readdir(root), [], tool.id);
  }
});

test('det rigtige bibliotek kan indlæses og installeres med Windows-linjeskift', async t => {
  const source = await loadLibrary(profiles);
  const parent = await temp(t, 'harness-windows-linjer-'), copy = path.join(parent, 'profiles');
  await fs.copyFile(path.join(profiles, '../LICENSE'), path.join(parent, 'LICENSE'));
  await fs.cp(profiles, copy, { recursive: true });
  for (const skill of source.skills) for (const file of skill.files) {
    await fs.writeFile(path.join(copy, 'skills', skill.name, file.path), file.content.replace(/\r?\n/g, '\r\n'));
  }
  const library = await loadLibrary(copy);
  assert.deepEqual(library.skills.map(skill => skill.description), source.skills.map(skill => skill.description));
  const root = await temp(t, 'harness-windows-installation-');
  const layout = layoutFor(library, ['codex']);
  const settings = { version: library.version, tools: layout.tools };
  const plan = await installer.plan(root, layout.entries, settings);
  await installer.apply(root, layout.entries, settings, plan.token);
  const name = 'harness-ide-og-afgraensning';
  const installed = await fs.readFile(path.join(root, '.agents/skills', name, 'SKILL.md'), 'utf8');
  assert.equal(installed, await fs.readFile(path.join(copy, 'skills', name, 'SKILL.md'), 'utf8'), 'Installation bevarer filens faktiske indhold');
  assert.equal(validateSkillText(name, installed).fields.name, name);
  assert.throws(() => validateSkillText(name, installed.replace('description:', 'ukendt-felt:')), /ikke tilladt/, 'Windows-linjeskift lemper ikke feltkontrollen');
});

test('skillsene overholder Agent Skills-formatet og indeholder ingen scripts', async () => {
  const library = await loadLibrary(profiles);
  for (const item of library.skills) {
    assert.match(item.name, /^harness-[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(item.description.length <= 1024 && item.description.length >= 80, item.name);
    assert.ok(item.files.every(file => /^(SKILL\.md|references\/[a-z0-9-]+\.md)$/.test(file.path)), item.name);
    const body = item.files.find(file => file.path === 'SKILL.md').content;
    assert.ok(body.split('\n').length < 300, item.name);
    assert.doesNotMatch(body, /disable-model-invocation|allowed-tools/, item.name);
  }
});

test('afviser ugyldige skills, værktøjer og uoverensstemmelser', async t => {
  await loadLibrary(await fixture(t));
  const rejects = async (change, pattern) => assert.rejects(loadLibrary(await fixture(t, change)), pattern);
  await rejects({ skill: '---\nname: harness-b\ndescription: Forkert navn.\n---\n# B\nreferences/detaljer.md\n' }, /samme som mappens navn/);
  await rejects({ skill: '---\nname: harness-a\ndescription: Gør A.\ndisable-model-invocation: true\n---\n# A\nreferences/detaljer.md\n' }, /ikke tilladt i biblioteket/);
  await rejects({ skill: '---\nname: harness-a\ndescription: Bemærk: kolon giver ugyldig YAML.\n---\n# A\nreferences/detaljer.md\n' }, /YAML-tegn|": "/);
  await rejects({ skill: '---\nname: harness-a\ndescription: Gør A.\n---\n# A\nIngen henvisning.\n' }, /bruges ikke fra SKILL\.md/);
  await rejects({ files: { 'skills/harness-a/scripts/kør.sh': 'echo hej' } }, /ugyldig post|ikke tilladt/);
  await rejects({ files: { 'skills/harness-b/SKILL.md': '---\nname: harness-b\ndescription: B.\n---\n' } }, /står ikke i kataloget/);
  await rejects({ rules: 'Version: 0.1.0\nPRØVE-02\n' }, /samme version og kontrolord/);
  await rejects({ catalog: { skills: [{ ...skill, name: 'Harness-A' }] } }, /små bogstaver/);
  await rejects({ catalog: { tools: [{ ...tool, skills: { dirs: ['.ukendt/skills'] } }] } }, /kendte mapper/);
  await rejects({ catalog: { tools: [{ ...tool, rules: { file: '../AGENTS.md', mode: 'blok' } }] } }, /fil og form/);
  await rejects({ catalog: { tools: [{ ...tool, category: 'web', status: 'dokumenteret', rules: undefined, skills: null }] } }, /status manuel/);
  await rejects({ catalog: { tools: [tool, tool] } }, /flere gange/);
  await rejects({ catalog: { featuredTools: ['codex', 'codex'] } }, /fremhæve ét til fire/);
  await rejects({ catalog: { featuredTools: ['ukendt'] } }, /fremhæve ét til fire/);
  await rejects({ catalog: { categories: [] } }, /inddele skills i kategorier/);
  await rejects({ skill: '---\nname: harness-a\ndescription: Gør A, når opgaven kræver det.\n---\n# A\nLæs references/detaljer.md, og brug `harness-ukendt`, hvis den er installeret.\n' }, /ukendt skill/);
  await rejects({ skill: '---\nname: harness-a\ndescription: Gør A, når opgaven kræver det.\n---\n# A\nLæs references/detaljer.md, og brug `harness-a`.\n' }, /tåle, at skillen er fravalgt/);
  await rejects({ catalog: { categories: [{ id: 'a', title: 'A', summary: 'A.', skills: ['harness-a'] }, { id: 'b', title: 'B', summary: 'B.', skills: ['harness-a'] }] } }, /præcis én kategori/);
  await rejects({ catalog: { features: undefined } }, /appens funktioner/);
  await rejects({ catalog: { features: [{ id: 'a', title: 'A', summary: 'A.', skills: ['harness-a'] }, { id: 'b', title: 'B', summary: 'B.', skills: ['harness-a'] }] } }, /præcis én funktion/);
  await rejects({ catalog: { features: [{ id: 'a', title: 'A', summary: 'A.', skills: [] }] } }, /mangler id, titel/);
  await rejects({ catalog: { features: [{ id: 'a', title: 'A', summary: 'A.', requires: ['ukendt'], skills: ['harness-a'] }] } }, /ukendt funktion/);
  await rejects({ catalog: { features: [{ id: 'a', title: 'A', summary: 'A.', default: 'nej', skills: ['harness-a'] }] } }, /ugyldig standard/);
  await rejects({ catalog: { features: [{ id: 'a', title: 'A', summary: 'A.', group: 'ukendt', skills: ['harness-a'] }] } }, /ukendt gruppe/);
  await rejects({ catalog: { features: [{ id: 'a', title: 'A', summary: 'A.', group: 'integrationer', default: false, skills: ['harness-a'] }] } }, /kun der/);
});

// En integration er sin egen funktion med kilder, ejer, adgang og dataflow. En mangel afvises.
test('integrationer skal beskrive system, ejer, adgang og dataflow og stå for sig', async t => {
  const integration = { system: 'Testregister', owner: 'Testejer', maintainer: 'Aura Harness', access: 'Ingen bruger', data: 'Offentlige data', dataFlow: 'Fra browseren til testregistret', cost: 'Gratis', itRoute: false, sensitive: false, checkedAt: '2026-09-30' };
  const entry = { ...skill, name: 'harness-integration-test', integration, sources: [{ title: 'Kilde', url: 'https://example.org' }] };
  const file = '---\nname: harness-integration-test\ndescription: Henter testdata, når opgaven kræver det.\n---\n# Test\nIngen referencer.\n';
  const base = { skills: [skill, entry], categories: [{ id: 'alt', title: 'Alt', summary: 'Alle skills.', skills: ['harness-a', 'harness-integration-test'] }], features: [{ id: 'alt', title: 'Alt', summary: 'Alt.', skills: ['harness-a'] }, { id: 'integration-test', group: 'integrationer', title: 'Test', summary: 'Testdata.', default: false, skills: ['harness-integration-test'] }] };
  const valid = await fixture(t, { catalog: base, files: { 'skills/harness-integration-test/SKILL.md': file } });
  const library = await loadLibrary(valid);
  assert.equal(library.skills.find(item => item.name === 'harness-integration-test').integration.owner, 'Testejer');
  assert.deepEqual(layoutFor(library, ['codex']).skills, ['harness-a'], 'integrationer er ikke valgt som standard');
  const rejectsWith = async (change, pattern) => assert.rejects(loadLibrary(await fixture(t, { catalog: { ...base, ...change }, files: { 'skills/harness-integration-test/SKILL.md': file } })), pattern);
  await rejectsWith({ skills: [skill, { ...entry, integration: { ...integration, dataFlow: '' } }] }, /dataFlow mangler/);
  await rejectsWith({ skills: [skill, { ...entry, integration: { ...integration, itRoute: 'nej' } }] }, /sandt eller falsk/);
  await rejectsWith({ skills: [skill, { ...entry, sources: [] }] }, /mindst én kilde/);
  await rejectsWith({ skills: [skill, { ...entry, integration: undefined }] }, /skal beskrive system/);
  await rejectsWith({ features: [base.features[0], { ...base.features[1], default: true }] }, /slået fra som standard/);
  await rejectsWith({ features: [{ ...base.features[0], skills: ['harness-a', 'harness-integration-test'] }] }, /kun der/);
});

test('funktionerne i appen dækker hele biblioteket og bygger kun på kendte funktioner', async () => {
  const library = await loadLibrary(profiles);
  assert.deepEqual(library.features.filter(feature => !feature.group).map(feature => feature.id), ['versioner', 'planlaegning', 'design', 'sikkerhed', 'kvalitet', 'deling']);
  assert.deepEqual(library.features.filter(feature => feature.group === 'integrationer').map(feature => feature.id), ['integration-adresser', 'integration-cvr', 'integration-promte', 'integration-komplai-run']);
  assert.deepEqual(library.features.flatMap(feature => feature.skills).sort(), library.skills.map(skill => skill.name).sort());
  assert.deepEqual(library.features.find(feature => feature.id === 'deling').requires, ['versioner'], 'Udgiv og sikkerhedskopi udgiver fra en gemt version');
  assert.deepEqual(library.features.filter(feature => !feature.group && feature.default === false).map(feature => feature.id), ['deling'], 'Udgiv er ikke med i den anbefalede pakke, så længe den kræver udviklerværktøjer');
});

// Integrationsskills holder nøgler på en server og nævner de regler, der gælder for systemet.
test('integrationsskills holder nøgler på serveren og nævner systemets regler', async () => {
  const library = await loadLibrary(profiles);
  const text = name => library.skills.find(item => item.name === name).files.map(file => file.content).join('\n');
  for (const skill of library.skills.filter(item => item.integration)) {
    assert.match(text(skill.name), /\.env/, `${skill.name}: nøgler i .env`);
    assert.match(text(skill.name), /server/, `${skill.name}: nøgler bruges fra en server`);
    assert.ok(skill.integration.checkedAt <= new Date().toISOString().slice(0, 10), `${skill.name}: kontroldatoen ligger ikke i fremtiden`);
  }
  assert.match(text('harness-integration-adresser'), /Brug ikke DAWA/);
  assert.match(text('harness-integration-adresser'), /EPSG:25832/);
  for (const rule of [/§ 17/, /reklamebeskyttede/, /CPR-numre må aldrig/, /opdigtede virksomheder/]) assert.match(text('harness-integration-cvr'), rule);
  for (const rule of [/PromteAppProvider/, /devDependencies/, /Kør dem kun, når brugeren har sagt ja/, /Bed aldrig brugeren indsætte et token/, /Udgiv → Promte Apps/, /Kør ikke upload-kommandoer fra Aura/, /Aura svarer som Promte/]) assert.match(text('harness-integration-promte'), rule);
});
