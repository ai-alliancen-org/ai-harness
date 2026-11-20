#!/usr/bin/env node
// Demo tooling. Azure credentials are used in memory only, never printed or saved.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const localSwa = path.join(root, '.cache/azure-demo-tools/node_modules/.bin/swa');
const env = { ...process.env, HARNESS_AZ_PATH: process.env.HARNESS_AZ_PATH || '/opt/homebrew/bin/az' };
if (process.platform !== 'darwin' && !process.env.HARNESS_AZ_PATH) env.HARNESS_AZ_PATH = 'az';
env.HARNESS_SWA_PATH = process.env.HARNESS_SWA_PATH || (fs.existsSync(localSwa) ? localSwa : 'swa');
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, env, encoding: 'utf8', timeout: 60000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr?.trim() || `${file} exited with ${result.status}`);
  return result.stdout;
}
function demoTarget(section, fields) {
  const file = path.join(root, '.cache/azure-demo-config.json');
  if (!fs.existsSync(file)) throw Error('Create .cache/azure-demo-config.json with your demo targets. See docs/azure-video-demo.md.');
  const target = JSON.parse(fs.readFileSync(file, 'utf8'))?.[section];
  for (const field of fields) {
    if (typeof target?.[field] !== 'string' || !target[field].trim() || target[field].trim().startsWith('-')) {
      throw Error(`Set ${section}.${field} in .cache/azure-demo-config.json.`);
    }
  }
  return Object.fromEntries(fields.map(field => [field, target[field].trim()]));
}
async function main() {
  const action = process.argv[2] || 'check';
  if (!['check', 'start', 'verify-ai', 'verify-hosting'].includes(action)) throw Error('Usage: node scripts/azure-demo.cjs [check|start|verify-ai|verify-hosting]');
  if (action === 'verify-hosting') {
    // The configured app must be a dedicated demo target. This replaces its test environment.
    const config = { ...demoTarget('staticWebApp', ['subscription', 'group', 'project']), frontend: '.' };
    process.env.HARNESS_AZ_PATH = env.HARNESS_AZ_PATH;
    process.env.HARNESS_SWA_PATH = env.HARNESS_SWA_PATH;
    const { AzureDeployment } = require('../desktop/core/deployment-providers.cjs');
    const provider = new AzureDeployment();
    const target = await provider.inspect(config);
    const marker = `aura-connectivity-${require('node:crypto').randomUUID()}`;
    const content = Buffer.from(`<!doctype html><html lang="da"><meta charset="utf-8"><title>Aura · hostingtest</title><h1>Aura → Azure</h1><p>Forbindelsestest. Demoappen bygges senere i Aura.</p><p>${marker}</p></html>`);
    const receipt = { config, target, startedAt: new Date().toISOString(), state: 'SUBMITTING', marker };
    const receiptFile = path.join(root, '.cache/azure-demo-hosting-receipt.json');
    fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
    const save = () => fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
    save();
    console.log('Uploading a synthetic connectivity page through Aura’s Azure adapter.');
    try { Object.assign(receipt, await provider.deploy(config, { files: [{ file: 'index.html', data: content }] })); }
    catch (error) { receipt.state = 'UNKNOWN'; save(); throw error; }
    save();
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      Object.assign(receipt, await provider.status(config, receipt)); save();
      if (receipt.state === 'READY' && receipt.url) {
        const response = await fetch(receipt.url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!response.ok || !(await response.text()).includes(marker)) throw Error('Published page did not match the uploaded connectivity marker.');
        console.log(JSON.stringify({ status: 'ready', url: receipt.url, resource: target.id,
          environment: receipt.id, sku: target.settings.sku, contentVerified: true,
          note: 'Synthetic hosting test only; this is not an AI-generated demo app.' }, null, 2));
        return;
      }
      console.log(`Waiting for Azure: ${receipt.state}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw Error('Azure is still processing the upload. Inspect the saved receipt and Azure status before retrying.');
  }
  if (action === 'verify-ai') {
    const { subscription, group, resource, deployment } = demoTarget('openai', ['subscription', 'group', 'resource', 'deployment']);
    const scope = ['--subscription', subscription, '--resource-group', group, '--name', resource, '--only-show-errors', '--output', 'json'];
    const endpoint = JSON.parse(run(env.HARNESS_AZ_PATH, ['cognitiveservices', 'account', 'show', ...scope, '--query', 'properties.endpoint']));
    const { normalize } = require('../desktop/core/connections.cjs');
    const { baseURL } = normalize({ kind: 'azure', name: 'Azure demo', baseURL: endpoint, deployment });
    const key = JSON.parse(run(env.HARNESS_AZ_PATH, ['cognitiveservices', 'account', 'keys', 'list', ...scope])).key1;
    if (!key) throw Error('Azure returned no API key.');
    const response = await fetch(`${baseURL}/responses`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'api-key': key },
      body: JSON.stringify({ model: deployment, store: false, max_output_tokens: 128,
        input: 'Call aura_demo_ready with status set to ready. This is a synthetic connectivity test.',
        tools: [{ type: 'function', name: 'aura_demo_ready', description: 'Confirm demo connectivity.',
          strict: true, parameters: { type: 'object', properties: { status: { type: 'string', enum: ['ready'] } }, required: ['status'], additionalProperties: false } }],
        tool_choice: { type: 'function', name: 'aura_demo_ready' } })
    });
    // Do not echo remote error bodies or credentials.
    if (!response.ok) throw Error(`Azure OpenAI connectivity test failed: HTTP ${response.status}.`);
    const result = await response.json();
    const call = result.output?.find(item => item.type === 'function_call' && item.name === 'aura_demo_ready');
    if (!call || JSON.parse(call.arguments).status !== 'ready') throw Error('Azure replied without the expected tool call.');
    console.log(JSON.stringify({ status: 'ready', endpoint, deployment, protocol: 'Responses',
      toolCalling: true, usage: result.usage, credentials: 'used in memory only; not saved or printed' }, null, 2));
    return;
  }
  console.log(`Node ${process.version}`);
  const azure = JSON.parse(run(env.HARNESS_AZ_PATH, ['version', '--output', 'json']));
  console.log(`Azure CLI ${azure['azure-cli']}`);
  console.log(`SWA CLI ${run(env.HARNESS_SWA_PATH, ['--version']).trim()}`);
  if (action === 'check') {
    const accounts = JSON.parse(run(env.HARNESS_AZ_PATH, ['account', 'list', '--only-show-errors', '--output', 'json']));
    console.table(accounts.map(a => ({ subscription: a.name, subscriptionId: a.id, tenantId: a.tenantId, enabled: a.state === 'Enabled' })));
    console.log('Cached accounts only. Confirm live access to your tenant, AI deployment and dedicated Static Web App before recording.');
    return;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require(path.join(root, 'desktop/node_modules/electron'));
  const result = spawnSync(electron, [path.join(root, 'desktop')], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
