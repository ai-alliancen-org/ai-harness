const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Workbench } = require('../core/workbench.cjs');
const { openProject } = require('../core/projects.cjs');
const { startPreview } = require('../core/preview.cjs');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-live-'));
  const project = path.join(root, 'projekt'); await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><html lang="da"><body><h1>Start</h1></body></html>');
  const events = []; let preview;
  const bench = new Workbench({ directory: path.join(root, 'state'), profiles: path.join(__dirname, '..', '..', 'profiles'), safeStorage: { isEncryptionAvailable: () => false }, emit: event => {
    events.push(event);
    if (event.type === 'permission.asked') {
      const p = event.properties;
      const allow = p.permission === 'edit' && p.patterns.every(file => file === 'public/index.html' || file === path.join(project, 'public/index.html'));
      bench.reply({ id: p.id, allow }).catch(() => {});
      console.log(JSON.stringify({ permission: p.permission, paths: p.patterns, allowed: allow }));
    }
    if (event.type === 'run.status') console.log(JSON.stringify(event));
  }});
  try {
    await bench.activate(await openProject(project));
    const saved = await bench.saveConnection({ kind: 'zen', name: 'Zen offentlig gratisprøve', baseURL: '', apiKey: '' });
    const info = await bench.prepare({ connectionID: saved.connections[0].id, modelID: 'big-pickle', references: [] });
    console.log(JSON.stringify({ destination: info.endpoint, model: info.model, data: 'Kun syntetisk startside og offentlige Aura Harness-regler', root }));
    await bench.send({ text: 'Dette er en afgrænset integrationstest med syntetiske data. Læs public/index.html og skift kun h1-teksten fra Start til Lokal agenttest bestået. Brug read og edit eller write direkte. Kør ingen shellkommandoer, brug ikke Git, hent ingen websider, læs ingen andre projektfiler. Svar kort, når ændringen er skrevet.', fingerprint: info.fingerprint, contextBinding: info.contextBinding });
    const deadline = Date.now() + 180000;
    while (bench.running && Date.now() < deadline) await new Promise(r => setTimeout(r, 300));
    if (bench.running) { await bench.stop(); throw new Error('Modelprøven overskred testens timeout.'); }
    const errors = events.filter(event => ['session.error', 'engine.error'].includes(event.type));
    if (errors.length) throw new Error(JSON.stringify(errors));
    assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Lokal agenttest bestået/);
    preview = await startPreview(project); assert.match(await (await fetch(preview.url)).text(), /Lokal agenttest bestået/);
    console.log(JSON.stringify({ status: 'bestået', provider: 'OpenCode Zen', model: 'big-pickle', root, evidence: 'Rigtigt eksternt modelkald → OpenCode-værktøj → godkendt filændring → HTTP-forhåndsvisning' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await bench.close(); await preview?.close(); }
})();
