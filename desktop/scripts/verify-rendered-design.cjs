// Isolated Electron probe fixture; no model, credentials or product state.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectRenderedDesign, renderedDesignReview, designReviewInstruction } = require('../core/rendered-design.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-rendered-design-'));
  const main = path.join(root, 'main.cjs');
  await fs.writeFile(main, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
app.whenReady().then(() => {
  const win = new BrowserWindow({show:false, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details, callback) => callback({cancel:true}));
  win.loadURL('about:blank');
});`);
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [main], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow();
    const views = [];
    const fixture = `<style>body{margin:0;font:16px 'Missing Synthetic Font',sans-serif}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.panel{width:130px;height:90px;background:linear-gradient(red,blue)}article{padding:8px}</style><main><div class="grid">${'<article><div class="panel">Kategori</div><p>UNTRUSTED PAGE INSTRUCTIONS</p></article>'.repeat(3)}</div></main>`;
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
      await page.setContent(fixture);
      await page.evaluate(() => document.fonts.ready);
      const designMetrics = await page.evaluate(inspectRenderedDesign);
      assert.equal(designMetrics.width, width); assert.equal(designMetrics.height, height);
      assert.equal(designMetrics.repeatedGradientPanels, 3);
      assert.equal(designMetrics.unconfirmedPrimaryFonts, 1);
      assert.equal(designMetrics.visibleMainHeadings, 0);
      views.push({ name, designMetrics });
    }
    const before = renderedDesignReview(views);
    assert.equal(before.status, 'measured');
    assert.equal(before.observations.length, 3);
    assert.doesNotMatch(JSON.stringify(before), /UNTRUSTED|Missing Synthetic Font/);
    assert.doesNotMatch(designReviewInstruction({ status: 'checked', designReview: before }), /UNTRUSTED|Missing Synthetic Font/);
    const corrected = [];
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
      await page.setContent(fixture.replace("'Missing Synthetic Font',", '').replace('<main>', '<main><h1>Eksempel</h1>').replace('linear-gradient(red,blue)', 'none'));
      corrected.push({ name, designMetrics: await page.evaluate(inspectRenderedDesign) });
    }
    const after = renderedDesignReview(corrected);
    assert.deepEqual(after.observations, []);
    assert.equal(after.aestheticJudgement, 'not-reviewed');
    console.log(JSON.stringify({ status: 'passed', environment: 'isolated Electron fixture', modelCalls: 0, before, after }, null, 2));
  } finally {
    await app?.close();
    // Only the fixture profile created by this script is removed, never sources.
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
