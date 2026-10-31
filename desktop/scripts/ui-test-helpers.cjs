async function skipIntroduction(page) {
  page.setDefaultTimeout(20000);
  // firstWindow kan returnere, før Electron har indlæst appens dokument.
  await page.locator('#create').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('#create').disabled && !document.querySelector('#new').disabled);
  if (await page.locator('#welcome-dialog').evaluate(el => el.open)) await page.click('#welcome-skip');
}
// Appen åbner det seneste projekt igen ved start. Prøver, der skal bruge startsiden, går til Nyt projekt først.
async function toOnboarding(page) {
  await page.waitForFunction(() => !document.querySelector('#new').disabled);
  if (await page.locator('#workspace').isVisible()) { await page.click('#new'); await page.waitForSelector('#onboarding:not([hidden])'); }
}
async function menuClick(page, selector) {
  const toggles = {
    '#support-button': '#settings-toggle', '#connections-button': '#settings-toggle', '#features-button': '#settings-toggle',
    '#git-button': '#project-menu-toggle', '#publish-button': '#project-menu-toggle',
    '#attach-preview': '#preview-options'
  };
  // Instruktionerne i et projekt ligger under Indstillinger › Funktioner › Avanceret.
  if (selector === '#skills-button') {
    if (!await page.locator('#features-dialog').evaluate(el => el.open)) await menuClick(page, '#features-button');
    if (!await page.locator('#features-advanced').evaluate(el => el.open)) await page.click('#features-advanced > summary');
    await page.click(selector); return;
  }
  if (!await page.locator(selector).isVisible()) await page.click(toggles[selector]);
  await page.click(selector);
  if (selector === '#attach-preview' && !await page.locator('#server-manual').evaluate(el => el.open)) await page.click('#server-manual > summary');
}
async function taskOptions(page) {
  if (!await page.locator('#task-dialog').evaluate(el => el.open)) {
    await page.click('#model-chip');
    if (await page.locator('#composer-model-menu').isVisible()) await page.getByRole('button', { name: 'Alle modeller og forbindelser', exact: true }).click();
  }
  if (!await page.locator('#model-options').evaluate(el => el.open)) await page.click('#model-summary');
}
async function closeTaskOptions(page) {
  if (await page.locator('#task-dialog').evaluate(el => el.open)) await page.click('[data-close="task-dialog"]');
}
async function selectMode(page, mode) {
  await taskOptions(page);
  if (!await page.locator('#task-dialog .workflow').evaluate(el => el.open)) await page.click('#task-dialog .workflow > summary');
  await page.selectOption('#work-mode', mode); await closeTaskOptions(page);
}
async function previewOptions(page) {
  if (!await page.locator('#preview-menu').evaluate(el => el.matches(':popover-open'))) await page.click('#preview-options');
}
// Projektskærmens valgfrie sektioner ligger bag Flere valg.
async function projectOptions(page) { if (!await page.locator('#project-options').evaluate(el => el.open)) await page.click('#project-options > summary'); }
// Nye projekter lægges som standard i Dokumenter/Aura. Testene bruger deres egen midlertidige mappe.
async function isolateDocuments(app, folder) { await app.evaluate(({ app }, folder) => app.setPath('documents', folder), folder); }
// Vælg en anden placering til nye projekter gennem appens link, med en udfyldt mappedialog.
async function chooseLocation(app, page, folder) {
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await page.click('#choose-location');
  await page.waitForFunction(folder => document.querySelector('#project-location').title === folder, await require('node:fs/promises').realpath(folder));
}
// Åbn prøvens eksisterende filer gennem brugerfladen. Opret projekt-knappen gemmer
// automatisk en Git-version og må derfor ikke bruges i prøver uden Git-skrivninger.
async function openExistingProject(app, page, folder) {
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await page.click('#open');
  await page.waitForSelector('#workspace:not([hidden])');
  await page.waitForFunction(folder => document.querySelector('#project-path').textContent === folder, await require('node:fs/promises').realpath(folder));
}
// Releaseprøverne må ikke gemme versioner, heller ikke via appens baggrundsarbejde.
// Klassen bruges af de allerede oprettede Workbench-instanser; blokeringen ligger
// derfor før de child_process-kald, som modulerne indlæste ved appstart.
async function forbidGitWrites(app) {
  await app.evaluate(({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { GitVersions } = require('./core/git.cjs');
    const blocked = [];
    for (const method of ['initialize', 'startProject', 'saveAll', 'setIdentity', 'commit']) {
      GitVersions.prototype[method] = async () => { blocked.push(method); throw Error('Releaseprøven tillader ingen Git-skrivninger.'); };
    }
    const { Publishing } = require('./core/publishing.cjs');
    for (const method of ['attach', 'push']) Publishing.prototype[method] = async () => { blocked.push(method); throw Error('Releaseprøven tillader ingen Git-publicering.'); };
    globalThis.releaseGitWrites = blocked;
  });
  // Bevis, at den relevante grænse afviser commit, uden at starte Git.
  const fires = await app.evaluate(async ({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    try { await new (require('./core/git.cjs').GitVersions)().commit('', {}); }
    catch (error) {
      if (globalThis.releaseGitWrites.pop() === 'commit' && /ingen Git-skrivninger/.test(error.message)) return true;
    }
    return false;
  });
  if (!fires) throw Error('Releaseprøvens Git-vagt blev ikke aktiveret.');
}
async function assertNoGitWrites(app) {
  const blocked = await app.evaluate(() => globalThis.releaseGitWrites);
  if (!Array.isArray(blocked) || blocked.length) throw Error('Appen forsøgte en Git-skrivning under releaseprøven: ' + JSON.stringify(blocked));
}
// Udgivelse er ikke med i den anbefalede pakke. Prøver af Udgiv og Sikkerhedskopi slår den til og genindlæser siden.
async function enableSharing(page) {
  const result = await page.evaluate(() => window.harness.featuresSave({ scope: 'alle', values: { deling: true } }));
  if (!result.ok) throw new Error(result.error);
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#create').disabled && !document.querySelector('#new').disabled);
}
// Den guidede opsætning åbnes fra Indstillinger › AI-forbindelser › Tilføj forbindelse.
async function openSetup(page) {
  await menuClick(page, '#connections-button');
  // Dialogen glider ind; klikket venter, til den står stille.
  await page.waitForFunction(() => { const dialog = document.querySelector('#connections-dialog'); return dialog.open && !dialog.getAnimations().some(animation => animation.playState === 'running'); });
  await page.click('#connection-add'); await page.waitForSelector('#setup:not([hidden])');
}
// Nøgler indtastes kun i nøglevinduet, som har sin egen side og sin egen session. Prøverne finder den som en ny side
// i app.windows(); Playwright melder først et lukket vindue et øjeblik efter, så en brugt side tælles ikke med igen.
const KEY_PAGE = 'aura-noegle://vindue/index.html';
const usedKeyPages = new WeakMap();
async function keyWindow(app) {
  if (!app) throw new Error('Nøglevinduet kræver electronApp, fordi det er et vindue for sig.');
  if (!usedKeyPages.has(app)) usedKeyPages.set(app, new Set());
  const used = usedKeyPages.get(app);
  for (let round = 0; round < 300; round++) {
    const page = app.windows().find(candidate => !candidate.isClosed() && !used.has(candidate) && candidate.url() === KEY_PAGE);
    if (page) { used.add(page); await page.locator('#key-value').waitFor(); return page; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Nøglevinduet kom ikke frem.');
}
// Indtaster en nøgle i nøglevinduet. button vælger Kontrollér og gem, Gem alligevel, Annuller eller 'escape'.
// Siden gives tilbage, så prøven kan læse fejlteksten; ved Annuller og Escape er vinduet lukket igen.
async function enterCredential(app, value, { button = '#key-submit' } = {}) {
  const page = await keyWindow(app);
  if (value !== undefined) await page.fill('#key-value', value);
  // Annuller og Escape lukker vinduet med det samme, så Playwrights eget kald afbrydes. Det er meningen.
  if (button === 'escape') { await page.keyboard.press('Escape').catch(() => {}); return page; }
  await page.click(button).catch(error => { if (!/closed/.test(String(error))) throw error; });
  return page;
}
// En forbindelse tilføjes ad samme vej som en bruger: Tilføj forbindelse › Jeg har en adgangsnøgle › udbyderens kort.
// Svarer serveren med modeller, fortsætter prøven med forbindelsen; ellers vælger den senere. En nøgle kræver app.
async function addConnection(page, { kind = 'compatible', name, baseURL, apiKey, app } = {}) {
  await openSetup(page); await page.click('#setup-add-provider'); await chooseProviderCard(page, kind);
  if ((name !== undefined || baseURL !== undefined) && !await page.locator('#connection-advanced').evaluate(el => el.open)) await page.click('#connection-advanced > summary');
  if (name !== undefined) await page.fill('#connection-name', name);
  if (baseURL !== undefined) await page.fill('#base-url', baseURL);
  if (apiKey) { await page.click('#enter-key'); await enterCredential(app, apiKey); }
  else await page.click('#save-connection');
  await page.waitForFunction(() => document.querySelector('#setup').dataset.step === 'saved' && !/Henter/.test(document.querySelector('#setup-ai').textContent));
  if (await page.isVisible('#setup-continue') && await page.isEnabled('#setup-continue')) await page.click('#setup-continue'); else await page.click('#setup-local');
  await page.waitForSelector('#setup', { state: 'hidden' });
  return (await page.evaluate(() => window.harness.connectionState())).value.connections.at(-1);
}
// Fire udbydere står i første lag. De øvrige ligger bag "Bruger du en anden udbyder? Vælg en anden".
async function chooseProviderCard(page, kind) {
  if (!await page.locator(`#provider-cards [data-kind="${kind}"]`).count()) await page.click('#provider-more');
  await page.click(`[data-kind="${kind}"]`);
}
// Godkendelseskortet viser Tillad én gang, Tillad altid i projektet og Afvis. Tillad for denne opgave og Tillad en
// mappe fremover ligger bag Flere valg, jf. DESIGN.md. Hjælperen venter på kortet, folder Flere valg ud, hvis
// knappen ligger der, og klikker så. scope afgrænser til ét bestemt kort, når der er flere.
async function approve(page, label = 'Tillad én gang', { timeout = 90000, scope } = {}) {
  const box = scope || page.locator('#approvals');
  const button = box.getByRole('button', { name: label, exact: true }).first();
  const more = box.getByRole('button', { name: 'Flere valg', exact: true }).first();
  await box.getByRole('button', { name: 'Afvis', exact: true }).first().waitFor({ timeout });
  if (!await button.isVisible()) await more.click();
  await button.click();
}
// Venter på, at et godkendelseskort er fremme, uden at svare på det.
async function awaitApproval(page, { timeout = 90000, scope } = {}) {
  await (scope || page.locator('#approvals')).getByRole('button', { name: 'Afvis', exact: true }).first().waitFor({ timeout });
}
// Resultatkortets sekundære valg, fx Fortryd opgaven, ligger bag Flere valg. Hjælperen folder ud og giver knappen.
async function resultOption(page, label, { timeout = 90000 } = {}) {
  const box = page.locator('#run-review');
  const button = box.getByRole('button', { name: label, exact: true }).first();
  await box.locator('.review-actions').first().waitFor({ timeout });
  if (!await button.isVisible()) await box.locator('.result-options > summary').first().click();
  await button.waitFor({ timeout: 15000 });
  return button;
}
// Hovedvinduet må ikke have et felt, en nøgle kan skrives i.
async function assertNoKeyFields(page) {
  const found = await page.evaluate(() => [...document.querySelectorAll('input[type=password], #api-key, #hosting-token, #deployment-token')].map(el => el.id || el.type));
  if (found.length) throw new Error(`Hovedvinduet har felter til nøgler: ${found.join(', ')}`);
}
// Før første version viser preview-ruden kun en pladsholder, ikke startsiden. Testen skriver selv en første version
// (startsiden med en ændret etiket, så overskrift og logo bevares) og venter på, at den vises.
async function firstVersion(page, projectDir, title) {
  const fs = require('node:fs/promises'), index = require('node:path').join(projectDir, 'public', 'index.html');
  await page.locator('#preview-empty').filter({ hasText: 'Din app kører her, så snart første version er klar.' }).waitFor();
  if (await page.isVisible('#preview')) throw new Error('Startsiden vises før første version.');
  await fs.writeFile(index, (await fs.readFile(index, 'utf8')).replace('HER BEGYNDER DIN IDÉ', 'FØRSTE VERSION'));
  await page.frameLocator('#preview').locator('h1').filter({ hasText: title }).waitFor({ timeout: 15000 });
}
module.exports = { firstVersion, approve, awaitApproval, resultOption, openSetup, addConnection, chooseProviderCard, keyWindow, enterCredential, assertNoKeyFields, enableSharing, skipIntroduction, toOnboarding, menuClick, taskOptions, closeTaskOptions, selectMode, previewOptions, projectOptions, isolateDocuments, chooseLocation, openExistingProject, forbidGitWrites, assertNoGitWrites };
