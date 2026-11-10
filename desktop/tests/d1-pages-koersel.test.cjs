// Spor D, runde 2 (Q:D1-1): «Åbn kørslen på GitHub» på en Pages-kvittering med fejl åbner kørslen (receipt.workflowURL) gennem
// handleren deployment:open i main.cjs. Handleren skæres ud af main.cjs' egen kildetekst og køres mod attrapper for kernen og
// shell. Prøven fejler, indtil patchen til main.cjs fra spor D er lagt ind (kind 'workflow').
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
function handler(last) {
  const start = source.indexOf("handle('deployment:open'"), end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'main.cjs har handleren deployment:open');
  const opened = [], handlers = {};
  const deps = {
    handle: (channel, fn) => { handlers[channel] = fn; }, shell: { openExternal: async url => { opened.push(url); } },
    deployments: { state: async () => ({ last }), settings: async () => 'https://github.com/kommune/budget/settings/pages', providers: {} },
    requireProject: () => '/projekt', require: name => require(name.startsWith('./') ? path.join(__dirname, '..', name) : name)
  };
  new Function(...Object.keys(deps), source.slice(start, end + 4))(...Object.values(deps));
  return { open: kind => handlers['deployment:open'](kind), opened };
}
const config = { provider: 'github-pages', repository: 'kommune/budget', branch: 'main', directory: 'public' };
const receipt = (extra = {}) => ({ id: '00000000-0000-4000-8000-000000000042', state: 'ERROR', url: null, runId: 42, workflowURL: 'https://github.com/kommune/budget/actions/runs/42', config, target: { portal: 'https://github.com/kommune/budget/settings/pages' }, ...extra });

test('Q:D1-1: deployment:open med workflow åbner kørslen på GitHub for en Pages-kvittering', async () => {
  const h = handler(receipt());
  await h.open('workflow');
  assert.deepEqual(h.opened, ['https://github.com/kommune/budget/actions/runs/42']);
  await h.open('portal'); assert.equal(h.opened.at(-1), 'https://github.com/kommune/budget/settings/pages', 'udbyderens oversigt virker som før');
});

test('Q:D1-1: en kørsel i et andet repository eller uden kørselsnummer åbnes ikke', async () => {
  for (const extra of [{ workflowURL: 'https://github.com/andre/repo/actions/runs/42' }, { workflowURL: 'https://evil.example/actions/runs/42' }, { runId: null }, { workflowURL: 'https://github.com/kommune/budget/actions/workflows/aura-github-pages.yml' }]) {
    const h = handler(receipt(extra));
    await assert.rejects(h.open('workflow'), /Intet link tilgængeligt/, JSON.stringify(extra));
    assert.deepEqual(h.opened, []);
  }
});
