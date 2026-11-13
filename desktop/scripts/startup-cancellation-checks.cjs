// Fælles, kontrollerede startupforløb for den fokuserede prøve og den fulde samtidighedsprøve.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const helpers = require('./ui-test-helpers.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function verifyStartupCancellation({ app, page, project, root, requests, newChat, call, checks }) {
  // Motoren holdes før den kan annoncere en adresse eller oprette en session. Et hurtigt klik alene kunne før lande
  // både før send-IPC og efter motorstart, så prøven målte ikke nødvendigvis Stop under den faktiske opstart.
  const barrierRoot = path.join(root, 'startup-barrier'); await fs.mkdir(barrierRoot);
  const wrapper = path.join(barrierRoot, 'opencode'), enteredFile = path.join(barrierRoot, 'entered.json'), armedFile = path.join(barrierRoot, 'armed');
  const startupRelease = path.join(barrierRoot, 'released');
  await fs.writeFile(path.join(barrierRoot, 'engine.json'), JSON.stringify({ executable: await require('../core/engine.cjs').findExecutable() }));
  await fs.writeFile(wrapper, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const directory = __dirname, { executable } = JSON.parse(fs.readFileSync(path.join(directory, 'engine.json'), 'utf8'));
const args = process.argv.slice(2);
async function main() {
  if (args[0] !== '--version' && fs.existsSync(path.join(directory, 'armed'))) {
    fs.writeFileSync(path.join(directory, 'entered.json'), JSON.stringify({ pid: process.pid, phase: 'before-listen' }));
    while (!fs.existsSync(path.join(directory, 'released'))) await new Promise(resolve => setTimeout(resolve, 10));
  }
  const child = spawn(executable, args, { stdio: 'inherit' });
  child.once('error', error => { console.error(error.message); process.exit(1); });
  child.once('exit', (code, signal) => process.exit(Number.isInteger(code) ? code : signal ? 1 : 0));
}
main().catch(error => { console.error(error.message); process.exit(1); });
`, { mode: 0o755 });
  const previousEngine = await app.evaluate((_electron, file) => { const previous = process.env.HARNESS_OPENCODE_PATH; process.env.HARNESS_OPENCODE_PATH = file; return previous ?? null; }, wrapper);
  try {
    await fs.writeFile(armedFile, 'armed');
    // Stop kan også komme før send-IPC: kladden er skrevet, men dens kvittering holdes tilbage.
    // Hold kun ACK'en efter den rigtige skrivning, så historikkens kø og rækkefølge er uændrede.
    await newChat(); await helpers.selectMode(page, 'free');
    const draftText = 'Stop før afsendelse. draft-startup-probe';
    const draftChat = await page.locator('#project-list .chat-row[aria-current="true"]').getAttribute('data-chat');
    await page.fill('#prompt', draftText);
    await call('saveDraft', { root: project, chat: draftChat, text: draftText, mode: 'free' });
    await app.evaluate((_electron, input) => {
      const { createRequire } = process.getBuiltinModule('module'), require = createRequire(input.modulePath);
      const { Workbench } = require(input.modulePath), saveDraft = Workbench.prototype.saveDraft, send = Workbench.prototype.send, stop = Workbench.prototype.stop;
      const probe = globalThis.startupDraftProbe = { root: input.root, chat: input.chat, armed: true, entered: false, acknowledged: false, sendCalls: 0, stopCalls: 0 };
      const owns = (bench, value) => bench.project?.root === probe.root && (value?.chat || bench.chatID) === probe.chat;
      Workbench.prototype.saveDraft = async function(value) {
        const result = await saveDraft.call(this, value);
        if (probe.armed && owns(this, value) && value.text === '') {
          probe.armed = false; probe.entered = true;
          await new Promise(resolve => { probe.release = resolve; });
          probe.acknowledged = true;
        }
        return result;
      };
      Workbench.prototype.send = function(value) { if (owns(this, value)) probe.sendCalls++; return send.call(this, value); };
      Workbench.prototype.stop = function(value) { if (owns(this, value)) probe.stopCalls++; return stop.call(this, value); };
      probe.restore = () => { probe.release?.(); Workbench.prototype.saveDraft = saveDraft; Workbench.prototype.send = send; Workbench.prototype.stop = stop; };
    }, { modulePath: path.resolve(__dirname, '../core/workbench.cjs'), root: project, chat: draftChat });
    await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    let draftEntered = false;
    for (let n = 0; n < 500; n++) { draftEntered = await app.evaluate(() => globalThis.startupDraftProbe.entered); if (draftEntered) break; await wait(10); }
    assert.equal(draftEntered, true, 'den skrevne kladdes kvittering skal være holdt før send-IPC');
    const draftStoppedAt = Date.now();
    await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('#send:not([disabled])').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#run-status').textContent(), 'Stoppet'); assert.equal(await page.locator('#prompt').inputValue(), draftText);
    const draftModelCalls = () => requests.filter(body => body.tools?.length && JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content).includes(draftText)).length;
    let draftProbe = await app.evaluate(() => ({ sendCalls: globalThis.startupDraftProbe.sendCalls, stopCalls: globalThis.startupDraftProbe.stopCalls, acknowledged: globalThis.startupDraftProbe.acknowledged }));
    assert.deepEqual(draftProbe, { sendCalls: 0, stopCalls: 0, acknowledged: false });
    assert.equal(draftModelCalls(), 0); await assert.rejects(fs.access(enteredFile));
    await app.evaluate(() => globalThis.startupDraftProbe.release());
    // Et nyt roundtrip kommer efter den frigivne ACK; den gamle fortsættelse må stadig ikke sende.
    await call('activityList');
    draftProbe = await app.evaluate(() => ({ sendCalls: globalThis.startupDraftProbe.sendCalls, stopCalls: globalThis.startupDraftProbe.stopCalls, acknowledged: globalThis.startupDraftProbe.acknowledged }));
    assert.deepEqual(draftProbe, { sendCalls: 0, stopCalls: 0, acknowledged: true });
    assert.equal(draftModelCalls(), 0); await assert.rejects(fs.access(enteredFile));
    assert.equal(await page.locator('#run-status').textContent(), 'Stoppet'); assert.equal(await page.locator('#prompt').inputValue(), draftText);
    await fs.writeFile(path.join(root, 'draft-startup-cancel.json'), JSON.stringify({ cancellationMs: Date.now() - draftStoppedAt, ...draftProbe, modelCalls: draftModelCalls(), engineStarted: false }, null, 2));
    await app.evaluate(() => { globalThis.startupDraftProbe.restore(); delete globalThis.startupDraftProbe; });
    checks.push('Stop før send-IPC frigiver skrivefeltet, bevarer kladden og sender intet, heller ikke når kladdekvitteringen kommer senere');
    const startupText = 'Stop under opstart. hold-a';
    const startupCalls = () => requests.filter(body => body.tools?.length && JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content).includes(startupText));
    await newChat(); await helpers.selectMode(page, 'free'); await page.fill('#prompt', startupText); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    let entered;
    for (let n = 0; n < 1000; n++) { entered = await fs.readFile(enteredFile, 'utf8').then(JSON.parse).catch(() => null); if (entered) break; await wait(10); }
    assert.equal(entered?.phase, 'before-listen', 'den rigtige motorproces skal være holdt før sin serveradresse');
    assert.equal(startupCalls().length, 0, 'beskeden er ikke sendt til modelserveren');
    const cancelledAt = Date.now();
    await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 5000 });
    const cancellationMs = Date.now() - cancelledAt;
    const alive = () => { try { process.kill(entered.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
    for (let n = 0; n < 500 && alive(); n++) await wait(10);
    assert.equal(alive(), false, 'den stoppede motorproces skal være afsluttet');
    await fs.writeFile(startupRelease, 'released'); await fs.rm(armedFile);
    await wait(1000);
    assert.equal(await page.locator('#run-status').textContent(), 'Stoppet');
    assert.equal(await page.locator('#prompt').inputValue(), startupText);
    assert.equal(await page.locator('#send').isEnabled(), true);
    assert.equal(startupCalls().length, 0, 'heller ikke et sent signal fra opstarten sender den stoppede besked');
    await fs.writeFile(path.join(root, 'startup-cancel.json'), JSON.stringify({ phase: entered.phase, cancellationMs, engineExited: true, modelCalls: startupCalls().length }, null, 2));
    checks.push('Stop i en kontrolleret motoropstart afslutter processen, sender intet og bliver ved med at være Stoppet');
    await page.fill('#prompt', 'Fortsæt efter Stop. resume-after-startup-stop'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 });
    assert.equal(await page.locator('#run-status').textContent(), 'Klar');
    assert.equal(requests.filter(body => body.tools?.length && JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content).includes('resume-after-startup-stop')).length, 1);
    assert.equal(startupCalls().length, 0);
    checks.push('samme samtale kan starte og afslutte en ny opgave efter Stop under opstart');
  } finally {
    await fs.writeFile(startupRelease, 'released').catch(() => {});
    await app.evaluate((_electron, previous) => {
      globalThis.startupDraftProbe?.restore?.(); delete globalThis.startupDraftProbe;
      if (previous === null) delete process.env.HARNESS_OPENCODE_PATH; else process.env.HARNESS_OPENCODE_PATH = previous;
    }, previousEngine).catch(() => {});
  }
};
