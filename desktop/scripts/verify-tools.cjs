// Afprøver "Brug Aura Harness i mit kodeværktøj" i Electron med et rigtigt Git-projekt og rigtige filer.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-vaerktoejer-')); let app; const errors = [];
  const project = path.join(root, 'mit projekt æøå');
  const own = '# Vores regler\n\nBrug tabulatorer.\n';
  try {
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'AGENTS.md'), own);
    await fs.writeFile(path.join(project, '.gitignore'), '.claude/\n');
    const git = args => execFileSync('git', args, { cwd: project, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
    git(['init', '-q']); git(['add', 'AGENTS.md', '.gitignore']); git(['commit', '-q', '-m', 'start']);
    const bundle = process.env.HARNESS_TEST_PACKAGE ? path.resolve(process.env.HARNESS_TEST_PACKAGE) : null;
    app = await electron.launch({ executablePath: bundle ? (bundle.endsWith('.app') ? path.join(bundle, 'Contents/MacOS', path.basename(bundle, '.app')) : bundle) : require('electron'), args: [...(bundle ? [] : [path.join(__dirname, '..')]), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ dialog }, folder) => { global.modelRequests = 0; global.fetch = async () => { global.modelRequests++; throw Error('Ingen netværkskald i dette forløb'); }; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.waitForFunction(() => !document.querySelector('#welcome-build').disabled);
    assert.equal(await page.isVisible('#welcome-path'), true);
    await page.screenshot({ path: path.join(root, '01-foerstevalg.png'), animations: 'disabled' });
    await page.click('#path-tools');
    await page.waitForSelector('#tools-dialog[open]');
    assert.equal(await page.locator('#welcome-dialog').evaluate(el => el.open), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('harness.introduction.v1')), 'tools');

    // Første lag: ét spørgsmål, fire kort og et link til resten.
    await page.waitForSelector('#tools-featured .tools-card');
    assert.equal(await page.locator('#tools-featured .tools-card').count(), 4);
    assert.deepEqual(await page.locator('#tools-featured .tools-card strong').allTextContents(), ['Claude Code', 'GitHub Copilot', 'Codex', 'Cursor']);
    assert.equal(await page.isVisible('#tools-list'), false, 'resten af værktøjerne er skjult i første lag');
    assert.match(await page.textContent('#tools-included-summary'), /Grundregler og 12 skills/);
    await page.screenshot({ path: path.join(root, '02-vaelg-vaerktoej.png'), animations: 'disabled' });
    await page.click('#tools-more');
    assert.ok(await page.locator('#tools-list .tools-row').count() >= 19);
    await page.fill('#tools-search', 'zed');
    assert.equal(await page.locator('#tools-list .tools-row').count(), 1);
    await page.fill('#tools-search', 'lovable');
    assert.equal(await page.getByRole('button', { name: 'Kopiér tekst' }).count(), 1);
    await page.fill('#tools-search', '');
    await page.click('#tools-included-summary');
    assert.equal(await page.locator('#tools-skills details').count(), 16);
    await page.locator('#tools-skills details summary').first().click();
    assert.match(await page.locator('#tools-skills details').first().textContent(), /Hvad gør den ikke\?/);
    await page.locator('#tools-skills details summary').first().click();
    const securityInfo = page.locator('#tools-skills details').filter({ has: page.locator('summary strong', { hasText: /^Sikkerhedsgennemgang$/ }) });
    await securityInfo.locator('summary').click();
    await securityInfo.screenshot({ path: path.join(root, '02b-sikkerhedsskill.png'), animations: 'disabled' });
    await securityInfo.locator('summary').click();

    // Et klik på et kort fører videre til mappevalget og derefter til et resumé i almindeligt dansk.
    await page.click('#tools-featured [data-tool="claude-code"]');
    await page.waitForSelector('#tools-step-folder:not([hidden])');
    assert.match(await page.textContent('#tools-folder-lead'), /Claude Code/);
    await page.click('#tools-folder');
    await page.waitForSelector('#tools-step-review:not([hidden])');
    assert.match(await page.textContent('#tools-review-summary'), /mit projekt æøå, når du installerer til Claude Code/);
    const plan = await page.locator('#tools-plan li').allTextContents();
    assert.ok(plan.includes('Grundreglerne tilføjes nederst i AGENTS.md. Dine egne regler bevares.'), plan.join(' | '));
    assert.ok(plan.includes('CLAUDE.md oprettes med en henvisning til AGENTS.md.'), plan.join(' | '));
    assert.ok(plan.includes('12 skills lægges i .claude/skills.'), plan.join(' | '));
    // Antallet udledes af profiles/ (SKILL.md og references/*.md i grundskillsene), ikke af core/library.cjs, så en fejl i indlæseren stadig
    // fanges, og en ny reference ikke gør prøven forældet. De to designreferencer fra a15245f (decisions.md, 25. oktober) gav 22 i stedet for 20.
    const profileRoot = path.join(__dirname, '../../profiles');
    const catalog = JSON.parse(await fs.readFile(path.join(profileRoot, 'catalog.json'), 'utf8'));
    let baseFiles = 0;
    for (const skill of catalog.skills.filter(skill => !skill.integration)) baseFiles += 1 + (await fs.readdir(path.join(profileRoot, 'skills', skill.name, 'references')).catch(() => [])).filter(file => file.endsWith('.md')).length;
    assert.match(await page.textContent('#tools-notes'), new RegExp(`\\.gitignore udelader \\.claude/skills/ \\(${baseFiles} filer\\)`));
    assert.equal(await page.isVisible('#tools-operations'), false, 'filerne står bag Se de præcise ændringer');
    assert.equal(await page.textContent('#tools-install'), 'Installer');
    assert.equal(await page.textContent('#tools-skills-status'), 'Skills: 12 af 12 valgt');
    await page.screenshot({ path: path.join(root, '03-gennemgang.png'), animations: 'disabled', fullPage: true });

    // Udvælgelse som i en cookie-dialog: en hel kategori og en enkelt skill fravælges.
    await page.click('#tools-customize');
    await page.waitForSelector('#tools-step-skills:not([hidden])');
    assert.equal(await page.locator('#tools-categories .skill-category').count(), 5);
    assert.equal(await page.isChecked('#tools-categories input[data-skill="harness-integration-adresser"]'), false, 'integrationer er ikke valgt på forhånd');
    assert.match(await page.textContent('#tools-skill-total'), /^12 af 12 skills valgt\./);
    assert.equal(await page.isChecked('.skill-locked input'), true);
    assert.equal(await page.isDisabled('.skill-locked input'), true, 'grundreglerne kan ikke fravælges');
    await page.uncheck('#tools-categories input[data-category="drift"]');
    const kode = page.locator('.skill-category', { has: page.locator('input[data-category="kode"]') });
    await kode.getByRole('button', { name: 'Vis skills' }).click();
    await page.uncheck('#tools-categories input[data-skill="harness-git-og-samarbejde"]');
    assert.equal(await page.locator('input[data-category="kode"]').evaluate(el => el.indeterminate), true);
    assert.equal(await kode.locator('.skill-count').textContent(), '2 af 3');
    assert.match(await page.textContent('#tools-skill-total'), /^9 af 12 skills valgt\./);
    // En integration vælges til for sig og tælles ikke som en fravalgt skill.
    const integrationer = page.locator('.skill-category', { has: page.locator('input[data-category="integrationer"]') });
    await integrationer.getByRole('button', { name: 'Vis skills' }).click();
    await page.check('#tools-categories input[data-skill="harness-integration-adresser"]');
    assert.equal(await integrationer.locator('.skill-count').textContent(), '1 af 4');
    assert.match(await page.textContent('#tools-skill-total'), /^9 af 12 skills valgt og 1 integration\./);
    await page.click('#tools-skills-all');
    assert.equal(await page.isChecked('#tools-categories input[data-skill="harness-integration-cvr"]'), false, 'Vælg alle skills vælger ikke integrationer');
    assert.match(await page.textContent('#tools-skill-total'), /^12 af 12 skills valgt og 1 integration\./);
    await page.uncheck('#tools-categories input[data-category="drift"]');
    await page.uncheck('#tools-categories input[data-skill="harness-git-og-samarbejde"]');
    await page.screenshot({ path: path.join(root, '03b-vaelg-skills.png'), animations: 'disabled', fullPage: true });
    await page.click('#tools-skills-save');
    await page.waitForSelector('#tools-step-review:not([hidden])');
    assert.equal(await page.textContent('#tools-skills-status'), 'Skills: 9 af 12 valgt · fravalgt: Git og samarbejde, Udgivelse og gendannelse, Overdragelse og drift · integrationer: Adresser');
    assert.ok((await page.locator('#tools-plan li').allTextContents()).includes('10 skills lægges i .claude/skills.'));
    assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), own, 'intet skrives før installationen');

    await page.click('#tools-install');
    await page.waitForSelector('#tools-step-done:not([hidden])');
    assert.equal(await page.textContent('#tools-done-title'), 'Claude Code kan nu bruge Aura Harness');
    assert.match(await page.textContent('#tools-prompt-intro'), /Åbn mit projekt æøå i Claude Code/);
    await page.screenshot({ path: path.join(root, '04-installeret.png'), animations: 'disabled', fullPage: true });
    const agents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(agents.startsWith(own.trimEnd()));
    assert.match(agents, /<!-- aura-harness:start -->[\s\S]*FÆLLES-GRUNDLAG-02[\s\S]*<!-- aura-harness:slut -->/);
    assert.match(await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8'), /\n@AGENTS\.md\n/);
    assert.equal((await fs.readdir(path.join(project, '.claude/skills'))).filter(name => name.startsWith('harness-')).length, 10);
    assert.doesNotMatch(agents, /harness-git-og-samarbejde/);
    assert.match(agents, /harness-integration-adresser/);
    await fs.access(path.join(project, '.claude/skills/harness-integration-adresser/references/adressevaelger.md'));
    // Den nye reference skal følge med helt ud i brugerens projekt, uden tab af indhold.
    const agentReference = 'skills/harness-sikkerhedsgennemgang/references/agentadgang.md';
    assert.equal(await fs.readFile(path.join(project, '.claude', agentReference), 'utf8'), await fs.readFile(path.join(__dirname, '../../profiles', agentReference), 'utf8'));
    // Det samme for designmetoden fra #23, som beslutningen lagde i designskillen som to nye referencer.
    for (const name of ['designmetode.md', 'moenstre-og-tilstande.md']) {
      const designReference = `skills/harness-design-og-tilgaengelighed/references/${name}`;
      assert.equal(await fs.readFile(path.join(project, '.claude', designReference), 'utf8'), await fs.readFile(path.join(__dirname, '../../profiles', designReference), 'utf8'));
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(project, '.harness/installation.json'), 'utf8')).skills.length, 10);
    assert.match(await fs.readFile(path.join(project, '.harness/LAES-MIG.md'), 'utf8'), /9 af 12 skills til arbejdet fra idé til drift samt integrationen Adresser\.[\s\S]*Integrationer, der kan vælges til i Aura-appen: CVR, Promte, Komplai Run\./);

    // Et værktøj mere tilføjes til installationen i stedet for at erstatte den.
    await page.click('#tools-done');
    await page.click('#tools-button');
    await page.waitForSelector('#tools-step-choose:not([hidden])');
    await page.click('#tools-featured [data-tool="codex"]');
    await page.click('#tools-folder');
    await page.waitForSelector('#tools-step-review:not([hidden])');
    assert.match(await page.textContent('#tools-review-summary'), /allerede installeret til Claude Code .* Codex tilføjes/);
    assert.equal(await page.textContent('#tools-skills-status'), 'Skills: 9 af 12 valgt · fravalgt: Git og samarbejde, Udgivelse og gendannelse, Overdragelse og drift · integrationer: Adresser', 'udvalget huskes fra installationen');
    assert.ok((await page.locator('#tools-plan li').allTextContents()).includes('10 skills lægges i .agents/skills.'));
    await page.click('#tools-install');
    await page.waitForSelector('#tools-step-done:not([hidden])');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, '.harness/installation.json'), 'utf8')).tools, ['claude-code', 'codex']);
    await fs.access(path.join(project, '.claude/skills/harness-kodestil/SKILL.md'));

    await page.click('#tools-done'); await page.click('#tools-button');
    await page.click('#tools-featured [data-tool="codex"]'); await page.click('#tools-folder');
    await page.waitForSelector('#tools-step-review:not([hidden])');
    assert.match(await page.textContent('#tools-review-summary'), /Intet ændres/);
    assert.equal(await page.textContent('#tools-install'), 'Registrér installationen');

    // En fil, brugeren har ændret, røres ikke; knappen siger det.
    const changed = path.join(project, '.agents/skills/harness-kodestil/SKILL.md');
    await fs.appendFile(changed, '\nVores egen regel om navngivning.\n');
    await page.click('#tools-back'); await page.click('#tools-folder');
    await page.locator('#tools-notes').filter({ hasText: '1 fil er ændret af dig' }).waitFor();
    assert.equal(await page.textContent('#tools-install'), 'Installer resten');
    await page.screenshot({ path: path.join(root, '05-aendret-fil.png'), animations: 'disabled', fullPage: true });
    await page.click('#tools-install');
    await page.waitForSelector('#tools-step-done:not([hidden])');
    assert.match(await page.textContent('#tools-done-summary'), /ikke rørt/);
    assert.match(await fs.readFile(changed, 'utf8'), /Vores egen regel/);

    await page.click('#tools-removal');
    await page.waitForSelector('#tools-step-remove:not([hidden])');
    await page.click('#tools-remove');
    await page.waitForSelector('#tools-step-done:not([hidden])');
    assert.equal(await page.textContent('#tools-done-title'), 'Aura Harness er fjernet');
    assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), own);
    await assert.rejects(fs.access(path.join(project, 'CLAUDE.md')));
    await assert.rejects(fs.access(path.join(project, '.harness')));
    await assert.rejects(fs.access(path.join(project, '.claude')));
    assert.match(await fs.readFile(changed, 'utf8'), /Vores egen regel/, 'ændrede filer bevares ved fjernelse');
    assert.equal(git(['status', '--porcelain', '--', 'AGENTS.md', '.gitignore']).toString(), '');
    assert.equal(await app.evaluate(() => global.modelRequests), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: ['førstevalg fører til værktøjsforløbet', 'fire kort i første lag og resten bag Et andet værktøj med søgning', '12 skills og 4 integrationer med FAQ og tekst til webplatforme', 'et klik fører videre', 'skills vælges i kategorier eller enkeltvis med låste grundregler, integrationer vælges til for sig, og udvalget huskes', 'resumé i almindeligt dansk med filerne bag Se de præcise ændringer', 'intet skrives før gennemgang', 'eget AGENTS.md bevares med afsnit og import i CLAUDE.md', 'advarsel om .gitignore, der udelader skills', 'et værktøj mere tilføjes til installationen', 'gentagelse uden ændringer', 'Installer resten ved en fil, brugeren har ændret', 'fjernelse gendanner projektets egne filer og bevarer ændret skill', 'ingen netværks- eller modelkald'] }, null, 2));
  } finally { await app?.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
