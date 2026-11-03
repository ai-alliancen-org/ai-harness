// Fanen Overblik i Electron: et projekt med teknologier, en AI-leverandør, en skrifttypetjeneste, hosting og en hemmelighed. Ingen
// modelkald og ingen Git-skrivninger. Skærmbilledet gemmes, så skærmen kan ses, før den kaldes færdig (AGENTS.md).
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-overblik-')));
  const documents = path.join(root, 'Dokumenter'); await fs.mkdir(documents);
  let app, page; const errors = [];
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.isolateDocuments(app, documents); await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    await page.fill('#purpose', 'En lokalebooking.'); await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
    const project = path.join(documents, 'Aura', (await fs.readdir(path.join(documents, 'Aura')))[0]);
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'lokaler', dependencies: { react: '18', openai: '4' }, devDependencies: { vite: '5', tailwindcss: '3' } }));
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await fs.writeFile(path.join(project, 'src', 'ai.js'), 'fetch("https://api.openai.com/v1/chat/completions", { headers: { Authorization: process.env.OPENAI_API_KEY } });\n');
    await fs.writeFile(path.join(project, 'public', 'index.html'), '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><h1>Lokaler</h1>');
    await fs.writeFile(path.join(project, 'vercel.json'), '{}');
    await page.click('#tab-overview');
    await page.locator('#overview-body .overview-lead').waitFor({ timeout: 20000 });
    const text = await page.locator('#overview-body').innerText();
    assert.match(text, /React/); assert.match(text, /OpenAI/); assert.match(text, /USA/); assert.match(text, /Vercel/); assert.match(text, /Google Fonts/);
    assert.equal(await page.locator('#overview-body svg').count(), 1, 'diagrammet vises');
    await page.locator('#overview-body summary', { hasText: 'Se detaljer' }).click();
    assert.match(await page.locator('#overview-body').innerText(), /OPENAI_API_KEY/);
    assert.doesNotMatch(await page.locator('#overview-body').innerText(), /sk-[A-Za-z0-9]{10}/);
    const shot = path.join(root, 'overblik.png'); await page.screenshot({ path: shot, fullPage: false });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', skærmbillede: shot, tekst: text.slice(0, 400) }, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
