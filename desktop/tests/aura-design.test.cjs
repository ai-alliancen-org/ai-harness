const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { loadLibrary } = require('../core/library.cjs');
const { Features } = require('../core/features.cjs');
const { Skills } = require('../core/skills.cjs');
const { Store } = require('../core/store.cjs');
const { permissions, writeSkills } = require('../core/engine.cjs');
const { layoutFor } = require('../core/adapters.cjs');
const installer = require('../core/installer.cjs');

const profiles = path.join(__dirname, '../../profiles');
const name = 'harness-aura-design';
const sourceRevision = '88ef16cf3f8916911f5f26cb5a334dbdf332d1f5';
const designSkills = [name, 'harness-design-og-tilgaengelighed'];
async function temp(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-design-skill-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t) {
  const root = await temp(t), library = await loadLibrary(profiles);
  const store = new Store(path.join(root, 'profile'));
  const features = new Features(store, async () => library);
  return { root, library, store, features, skills: new Skills(async () => library, store, features) };
}

test('Aura-design følger det eksisterende designvalg globalt og pr. projekt', async t => {
  const { root, library, features, skills } = await fixture(t);
  assert.deepEqual(library.features.filter(feature => feature.skills.includes(name)).map(feature => feature.id), ['design']);
  assert.deepEqual(library.categories.filter(category => category.skills.includes(name)).map(category => category.id), ['planlaegning']);
  const first = path.join(root, 'project-a'), second = path.join(root, 'project-b');
  const selected = async project => (await skills.context(project)).skills.map(skill => skill.name);
  const defaults = await features.get();
  assert.equal(defaults.effective.design, true);
  for (const skill of designSkills) assert.ok((await selected(first)).includes(skill), `${skill} er med som standard`);
  await features.save(null, { scope: 'alle', values: { design: false } });
  for (const project of [first, second]) for (const skill of designSkills) assert.ok(!(await selected(project)).includes(skill), `${skill} følger globalt fravalg`);
  await features.save(first, { scope: 'projekt', values: { design: true } });
  for (const skill of designSkills) {
    assert.ok((await selected(first)).includes(skill), `${skill} følger projektets tilvalg`);
    assert.ok(!(await selected(second)).includes(skill), `${skill} ændrer ikke andre projekter`);
  }
  await features.save(first, { scope: 'projekt', values: { design: null } });
  for (const skill of designSkills) assert.ok(!(await selected(first)).includes(skill), `${skill} kan vende tilbage til standarden`);
  await features.save(null, { scope: 'alle', values: { design: true } });
  await features.save(first, { scope: 'projekt', values: { design: false } });
  for (const skill of designSkills) {
    assert.ok(!(await selected(first)).includes(skill), `${skill} følger projektets fravalg`);
    assert.ok((await selected(second)).includes(skill), `${skill} bliver i det andet projekt`);
  }
  const current = (await features.get(first)).effective;
  for (const [id, value] of Object.entries(defaults.effective)) if (id !== 'design') assert.equal(current[id], value, `${id} er uændret`);
});

test('alle Aura-design-referencer når motoren som passive Markdown-filer og fjernes ved fravalg', async t => {
  const { root, skills, features } = await fixture(t);
  const project = path.join(root, 'project'), directory = path.join(root, 'engine');
  const context = await skills.context(project), selected = context.skills.find(skill => skill.name === name);
  assert.ok(selected);
  const references = selected.files.filter(file => file.path !== 'SKILL.md').map(file => file.path);
  for (const required of ['references/brand-discovery.md', 'references/app-patterns.md', 'references/token-generator.md', 'references/provenance.md']) {
    assert.ok(references.includes(required), `${required} er med som en gennemgået reference`);
  }
  assert.equal(new Set(selected.files.map(file => file.path)).size, selected.files.length);

  await writeSkills(directory, context.skills);
  const skillRoot = path.join(directory, 'config/skills', name);
  assert.deepEqual((await fs.readdir(skillRoot)).sort(), ['SKILL.md', 'references']);
  assert.deepEqual((await fs.readdir(path.join(skillRoot, 'references'))).sort(), selected.files.filter(file => file.path !== 'SKILL.md').map(file => path.basename(file.path)).sort());
  for (const file of selected.files) {
    assert.match(file.path, /^(SKILL\.md|references\/[a-z0-9-]+\.md)$/);
    const target = path.join(skillRoot, file.path), actual = await fs.readFile(target, 'utf8');
    assert.ok(file.path === 'SKILL.md' ? actual.startsWith(file.content) : actual === file.content, file.path);
    if (process.platform !== 'win32') assert.equal((await fs.stat(target)).mode & 0o111, 0, `${file.path} er ikke eksekverbar`);
    if (file.path !== 'SKILL.md') assert.ok((await fs.readFile(path.join(skillRoot, 'SKILL.md'), 'utf8')).includes(target), `${file.path} er tilgængelig via præcis referencesti`);
  }
  assert.deepEqual((await fs.readdir(directory)).sort(), ['config'], 'indlæsning starter ingen generator eller test og opretter intet projekt');
  await features.save(project, { scope: 'projekt', values: { design: false } });
  await writeSkills(directory, (await skills.context(project)).skills);
  await assert.rejects(fs.stat(skillRoot), { code: 'ENOENT' }, 'en tidligere indlæst skill bliver ikke liggende efter fravalg');
});

test('designmetodens indhold giver ingen nye værktøjstilladelser i den eksisterende motor', async t => {
  const { root, skills } = await fixture(t);
  const context = await skills.context(root), selected = context.skills.find(skill => skill.name === name);
  const directory = path.join(root, 'engine'), names = context.skills.map(skill => skill.name);
  for (const mode of ['free', 'build', 'plan', 'chat']) {
    const before = permissions(root, [], mode, { directory, names: names.filter(id => id !== name) });
    const after = permissions(root, [], mode, { directory, names });
    const { skill: beforeSkills, ...beforePolicy } = before, { skill: afterSkills, ...afterPolicy } = after;
    assert.deepEqual(afterPolicy, beforePolicy, `${mode}: kun den aktive skill-liste ændres`);
    assert.equal(beforeSkills[name], undefined);
    assert.equal(afterSkills[name], 'allow');
    assert.equal(afterSkills['*'], 'deny');
    assert.equal(after.external_directory['*'], 'ask');
    assert.equal(after.read['*.env'], 'deny');
    assert.equal(after.read['*.key'], 'deny');
    if (['free', 'build'].includes(mode)) assert.equal(after.bash, 'ask');
    else { assert.equal(after['*'], 'deny'); assert.equal(after.bash, undefined); }
  }

});

test('Aura-design eksporteres og installeres med alle referencer uden at erstatte projektets egne filer', async t => {
  const { root, library } = await fixture(t);
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Projektets egne regler\nBevar mig.\n');
  await fs.writeFile(path.join(root, 'app.js'), 'export const unchanged = true;\n');
  const selected = library.skills.find(skill => skill.name === name);
  const layout = layoutFor(library, ['codex'], { skills: [name] });
  assert.deepEqual(layout.skills, [name]);
  assert.deepEqual(layout.entries.filter(entry => entry.path.startsWith('.agents/skills/')).map(entry => entry.path).sort(), selected.files.map(file => `.agents/skills/${name}/${file.path}`).sort());
  const settings = { version: library.version, tools: layout.tools, skills: layout.skills };
  const plan = await installer.plan(root, layout.entries, settings);
  assert.equal(plan.conflicts.length, 0);
  await installer.apply(root, layout.entries, settings, plan.token);
  for (const file of selected.files) assert.equal(await fs.readFile(path.join(root, '.agents/skills', name, file.path), 'utf8'), file.content, file.path);
  assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Projektets egne regler\nBevar mig.\n'));
  const removal = await installer.planRemoval(root);
  await installer.remove(root, removal.token);
  assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Projektets egne regler\nBevar mig.\n');
  assert.equal(await fs.readFile(path.join(root, 'app.js'), 'utf8'), 'export const unchanged = true;\n');
  assert.deepEqual((await fs.readdir(root)).sort(), ['AGENTS.md', 'app.js'], 'install/fjern efterlader kun brugerens eksisterende filer');
});

const python = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 10000 });
const pythonAvailable = !python.error && python.status === 0;
async function tokenGenerator(t) {
  const root = await temp(t), library = await loadLibrary(profiles);
  const reference = library.skills.find(skill => skill.name === name).files.find(file => file.path === 'references/token-generator.md');
  const blocks = [...reference.content.matchAll(/^```python\r?\n([\s\S]*?)^```\s*$/gm)];
  assert.equal(blocks.length, 1, 'referencefilen har præcis én entydig Python-kildeblok');
  const script = path.join(root, 'make_tokens.py');
  await fs.writeFile(script, blocks[0][1], { mode: 0o600 });
  return { root, script };
}
function runGenerator(script, args) {
  const result = spawnSync('python3', [script, ...args], {
    cwd: path.dirname(script), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function contrast(foreground, background) {
  const luminance = hex => {
    assert.match(hex, /^#[a-f\d]{6}$/i);
    const components = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2];
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('token-generatorens kopierede kode måler faktiske lys/mørke farver inkl. danger og hover', { skip: !pythonAvailable && 'Python 3 er et valgfrit projektværktøj og er ikke installeret på denne testmaskine' }, async t => {
  const { root, script } = await tokenGenerator(t);
  const scenarios = [
    ['kommune', '#004d52', '#9d3732', '#191919', '#f7f5f3'],
    ['light', '#ffffdd', '#fffa00', '#222222', '#ffffff'],
    ['dark', '#111111', '#fc00ff', '#101010', '#eeeeee']
  ];
  const requiredPairs = [
    'text-on-primary / primary', 'text-on-primary-hover / primary-hover',
    'text-on-accent / accent', 'text-on-accent-hover / accent-hover',
    'text-on-danger / danger', 'text-on-danger-hover / danger-hover', 'text-on-band / band'
  ];
  for (const [slug, primary, accent, ink, paper] of scenarios) {
    const output = path.join(root, slug);
    const result = runGenerator(script, ['--name', slug, '--primary', primary, '--accent', accent, '--ink', ink, '--paper', paper, '--band', '#009ce2', '--font-sans', 'Source Sans 3', '--font-display', 'K2D', '--font-mono', 'JetBrains Mono', '--radius', '4,8,16', '--out', output]);
    assert.equal(result.status, 0, `${slug}: ${result.stderr || result.stdout}`);
    assert.deepEqual((await fs.readdir(output)).sort(), ['tokens.css', 'tokens.json']);
    const tokens = JSON.parse(await fs.readFile(path.join(output, 'tokens.json'), 'utf8'));
    assert.equal(tokens.schema_version, 1);
    assert.deepEqual(tokens.source, { repository: 'Parthee-Vijaya/skills_claude', revision: sourceRevision }, 'genererede tokens henviser til den gennemgåede kilderevision');
    assert.equal(tokens.coverage, 'listed-token-pairs-only', 'kvitteringen kalder ikke farvepar for fuld WCAG-test');
    assert.equal(tokens.name, slug);
    assert.deepEqual(tokens.radius, [4, 8, 16]);
    assert.deepEqual(tokens.fonts, { sans: 'Source Sans 3', display: 'K2D', mono: 'JetBrains Mono' });
    const css = await fs.readFile(path.join(output, 'tokens.css'), 'utf8');
    const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const cssThemes = Object.fromEntries(['light', 'dark'].map(theme => {
      const selector = theme === 'dark' ? ':root[data-theme="dark"]' : ':root';
      const block = blocks.find(match => match[1].trim() === selector);
      assert.ok(block, `${theme}: det faktiske CSS-tema findes`);
      const values = Object.fromEntries([...block[2].matchAll(/--([a-z0-9-]+)\s*:\s*(#[a-f\d]{6})\s*;/gi)].map(match => [match[1], match[2].toLowerCase()]));
      return [theme, values];
    }));
    for (const theme of ['light', 'dark']) {
      for (const pair of requiredPairs) {
        const measurement = tokens.contrast.find(row => row.theme === theme && row.pair === pair);
        assert.ok(measurement, `${slug}/${theme}/${pair} er faktisk målt`);
        assert.equal(measurement.need, 4.5);
        const [foreground, background] = pair.split(' / ');
        assert.equal(measurement.foreground.toLowerCase(), cssThemes[theme][foreground], `${pair}: foreground svarer til CSS`);
        assert.equal(measurement.background.toLowerCase(), cssThemes[theme][background], `${pair}: background svarer til CSS`);
        assert.equal(tokens[theme][foreground].toLowerCase(), cssThemes[theme][foreground]);
        assert.equal(tokens[theme][background].toLowerCase(), cssThemes[theme][background]);
        const measured = contrast(cssThemes[theme][foreground], cssThemes[theme][background]);
        assert.ok(measured >= 4.5, `${slug}/${theme}/${pair}: ${measured} >= 4.5`);
        assert.ok(Math.abs(measured - measurement.ratio) < 0.000001, `${pair}: den rapporterede kontrast kan eftermåles`);
        assert.equal(measurement.pass, true);
      }
    }
  }
});

test('token-generatoren afviser CSS-injektion, ugyldig hex og ugyldige radier før den skriver', { skip: !pythonAvailable && 'Python 3 er et valgfrit projektværktøj og er ikke installeret på denne testmaskine' }, async t => {
  const { root, script } = await tokenGenerator(t);
  const attempts = [
    ['--name', 'x; color:red'], ['--name', '../outside'], ['--name', 'a'.repeat(65)],
    ['--font-sans', 'Arial; color:red'], ['--font-display', 'x";background:url(https://example.invalid)'],
    ['--font-mono', 'mono\nbody'], ['--font-sans', 'a'.repeat(81)],
    ['--primary', 'red'], ['--accent', '#12345'], ['--ink', '#gggggg'],
    ['--paper', '#fff; color:red'], ['--band', '#12345678'],
    ['--radius', '4,8'], ['--radius', '4,8,16,32'], ['--radius=-1,8,16'],
    ['--radius', '4,8,129'], ['--radius', '4,8,1.5'], ['--radius', '4,8,calc(1px)']
  ];
  for (const [index, args] of attempts.entries()) {
    const output = path.join(root, `invalid-${index}`);
    const result = runGenerator(script, ['--primary', '#004d52', '--accent', '#9d3732', '--ink', '#191919', '--paper', '#f7f5f3', '--name', 'valid-name', '--out', output, ...args]);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr || result.stdout}`);
    await assert.rejects(fs.stat(output), { code: 'ENOENT' }, `${args.join(' ')} må ikke oprette output før validering`);
  }
  assert.deepEqual(await fs.readdir(root), ['make_tokens.py'], 'ingen sideeffekter fra afviste input');
});


test('de valgfrie app- og arbejdsrumslayouts bruger faktisk definerede genererede CSS-tokens', { skip: !pythonAvailable && 'Python 3 er et valgfrit projektværktøj og er ikke installeret på denne testmaskine' }, async t => {
  const { root, script } = await tokenGenerator(t), output = path.join(root, 'layout');
  const result = runGenerator(script, ['--primary', '#004d52', '--accent', '#9d3732', '--ink', '#191919', '--paper', '#f7f5f3', '--name', 'layout', '--out', output]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const tokens = await fs.readFile(path.join(output, 'tokens.css'), 'utf8');
  const definitions = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(match => match[1]));
  const library = await loadLibrary(profiles), skill = library.skills.find(item => item.name === name);
  for (const reference of ['references/starter-css.md', 'references/starter-design-css.md']) {
    const content = skill.files.find(file => file.path === reference).content;
    const blocks = [...content.matchAll(/^```css\r?\n([\s\S]*?)^```\s*$/gm)];
    assert.equal(blocks.length, 1, `${reference}: én entydig CSS-kildeblok`);
    const code = blocks[0][1];
    for (const match of code.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      assert.ok(definitions.has(match[1]), `${reference}: ${match[1]} findes i den faktiske tokens.css`);
    }
  }
  assert.ok(definitions.has('--t-3xl'), 'den store typografi er del af den genererede kontrakt');
});
