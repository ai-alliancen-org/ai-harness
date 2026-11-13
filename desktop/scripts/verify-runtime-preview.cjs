// Kører produktets main og sessionspolitik. Ingen erstatning af webRequest eller modelkald.
// Angiv en eksisterende React/Babel-HTML og en mappe med allerede installeret esbuild/React.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const [source, packages, plainSource] = process.argv.slice(2);
  if (!source || !packages) throw Error('Angiv den eksisterende React-HTML og mappen med lokale testpakker.');
  const requirePackages = createRequire(path.join(path.resolve(packages), 'package.json'));
  const esbuild = requirePackages('esbuild');
  const original = await fs.readFile(source, 'utf8'), jsx = original.match(/<script\s+type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!jsx) throw Error('Prøven kræver den oprindelige React/Babel-side.');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-runtime-preview-')));
  const project = path.join(root, 'Moedelokaler'), other = path.join(root, 'Andet projekt');
  await fs.mkdir(path.join(project, 'public'), { recursive: true }); await fs.mkdir(path.join(other, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), original);
  try { await fs.copyFile(path.join(path.dirname(source), 'styles.css'), path.join(project, 'public/styles.css')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(path.join(other, 'public/index.html'), plainSource ? await fs.readFile(plainSource) : '<!doctype html><h1>Et andet projekt</h1>');
  const bundled = await esbuild.build({ stdin: { contents: `import React from 'react'; import * as ReactDOM from 'react-dom/client'; window.React=React; window.ReactDOM=ReactDOM;\n${jsx}`, loader: 'jsx', resolveDir: path.resolve(packages) }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  let app, currentWindow; const messages = [];
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const window = currentWindow = await app.firstWindow(); window.on('pageerror', error => messages.push(error.message)); window.on('console', event => { if (event.type() === 'error') messages.push(event.text().slice(0, 300)); }); await helpers.forbidGitWrites(app); await helpers.skipIntroduction(window); return window;
  };
  try {
    let window = await launch();
    await helpers.openExistingProject(app, window, project);
    const frame = async () => { const url = await window.locator('#preview').getAttribute('src'); return window.frames().find(item => item.url() === url); };
    await window.frameLocator('#preview').locator('.fallback').waitFor();
    assert.match(await window.frameLocator('#preview').locator('.fallback').textContent(), /React fra internettet/);
    const broken = await window.evaluate(() => window.harness.previewRuntime());
    assert.equal(broken.ok, true); assert.ok(broken.value.project.diagnostics.some(item => item.origin === 'https://unpkg.com'));
    await window.click('#preview-problem'); await window.locator('#server-diagnostics button').click();
    assert.match(await window.locator('#prompt').inputValue(), /lokale pakker/);
    assert.equal(await window.locator('#prompt').evaluate(element => element === document.activeElement), true);
    await window.locator('#prompt').fill('');
    const origin = (await frame()).url();
    // Kun prøvens kopi får den tilsvarende lokale React-bygning. Brugerens filer røres ikke.
    // Parse prøvens HTML i den allerede isolerede preview-ramme. DOM-operationer fjerner hele elementer,
    // også når attributter indeholder > eller sluttag har attributter; dette er en testkonvertering, ikke en HTML-sanitizer.
    const repaired = await (await frame()).evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      for (const script of parsed.querySelectorAll('script[src]')) {
        if (/^(?:https?:)?\/\//i.test(script.getAttribute('src').trim())) script.remove();
      }
      const babel = parsed.querySelectorAll('script[type="text/babel"]');
      if (babel.length !== 1) throw Error('Prøven kræver præcis ét React/Babel-script.');
      const local = parsed.createElement('script'); local.setAttribute('src', 'app.js'); babel[0].replaceWith(local);
      return '<!doctype html>\n' + parsed.documentElement.outerHTML;
    }, original);
    await fs.writeFile(path.join(project, 'public/app.js'), bundled.outputFiles[0].contents); await fs.writeFile(path.join(project, 'public/index.html'), repaired);
    await window.evaluate(() => { const frame = document.querySelector('#preview'); frame.src = frame.src; });
    await window.frameLocator('#preview').getByRole('heading', { name: 'Mødelokaler i dag' }).waitFor();
    await window.frameLocator('#preview').locator('.slot:not([disabled])').first().click();
    await window.frameLocator('#preview').getByLabel('Dit navn').fill('Prøveperson');
    await window.frameLocator('#preview').getByRole('button', { name: 'Book lokale', exact: true }).click();
    await window.frameLocator('#preview').getByRole('status').filter({ hasText: 'Prøveperson har booket' }).waitFor();
    const stored = await (await frame()).evaluate(() => localStorage.getItem('moedelokaler-bookings-v1')); assert.match(stored, /Prøveperson/);
    await (await frame()).evaluate(() => localStorage.setItem('aura-isolation-test', 'kun-projekt-a'));
    await helpers.openExistingProject(app, window, other);
    await window.waitForFunction(() => document.querySelector('#preview').src.startsWith('aura-preview://'));
    await window.frameLocator('#preview').locator('h1').first().waitFor();
    assert.notEqual((await frame()).url(), origin);
    assert.equal(await (await frame()).evaluate(() => localStorage.getItem('aura-isolation-test')), null);
    await (await frame()).evaluate(() => localStorage.setItem('aura-isolation-test', 'kun-projekt-b'));
    const cross = await (await frame()).evaluate(async url => { try { await fetch(url); return 'åben'; } catch { return 'blokeret'; } }, origin); assert.equal(cross, 'blokeret');
    await helpers.assertNoGitWrites(app); await app.close(); app = null;
    window = await launch(); await helpers.openExistingProject(app, window, project);
    await window.frameLocator('#preview').getByRole('heading', { name: 'Mødelokaler i dag' }).waitFor();
    assert.equal((await frame()).url(), origin);
    assert.equal(await (await frame()).evaluate(() => localStorage.getItem('moedelokaler-bookings-v1')), stored);
    assert.equal(await (await frame()).evaluate(() => localStorage.getItem('aura-isolation-test')), 'kun-projekt-a');
    assert.equal(await fs.readFile(source, 'utf8'), original);
    await helpers.assertNoGitWrites(app);
    console.log(JSON.stringify({ status: 'bestået', root, checks: ['original React-CDN-fejl', 'konkret diagnose og kladde uden afsendelse', 'lokal React-bygning', 'booking gennem brugerfladen', 'storage efter genstart', 'adskilt origin og netadgang mellem projekter'], limitations: ['kildeapp, ikke installationspakke', 'React-bygning i isoleret testkopi', 'ingen modelkald, udgivelse eller eksterne API-kald'] }, null, 2));
  } catch (error) { console.error(JSON.stringify({ root, messages, frames: currentWindow?.frames().map(frame => frame.url()), preview: await currentWindow?.locator('#preview').evaluate(frame => ({ src: frame.src, sandbox: frame.sandbox.value })).catch(() => null) })); throw error; }
  finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
