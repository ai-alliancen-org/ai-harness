// Kortsamlingen i terminalen (brugerens beslutning 10. november 2026, «Byg samlingen»): «Efter fem kort i én opgave spørger Aura én gang,
// om resten af opgaven må fortsætte i projektmappen.» Kernen sætter policy.collect på det kort, spørgsmålet hører til (ChatSession). Appen
// viste det, men terminalen spurgte kun «Tillad denne handling én gang?» og så bort fra policy.collect (skeptikerens fund efter G1 og G2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('../terminal.cjs');
const { Vault, privateDirectory } = require('../storage.cjs');
const { Application } = require('../app.cjs');

class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; this.asked = []; this.choices = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question) { this.asked.push(question); assert.ok(this.answers.length, 'Prøven mangler et svar: ' + question); return this.answers.shift(); }
  async confirm(question) { return await this.ask(question) === 'ja'; }
  async choose(question, items) { this.choices.push(items.map(item => item.label)); return this.ask(question); }
  interrupt() {}
}
async function fixture(t, answers) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-kortsamling-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const ui = new UI(answers), app = new Application({ directory: state, vault: new Vault(state), ui });
  const replies = []; app.bench.reply = async input => { replies.push(input); };
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { app, ui, replies };
}
const request = collect => ({ id: 'per-6', permission: 'edit', workspaceRoot: '/projekt', toolInput: { tool: 'write' }, patterns: ['index.html'], metadata: {}, policy: { kind: 'edit', label: 'Filændring: index.html', ...(collect ? { collect } : {}) } });

test('på kortet med spørgsmålet spørger terminalen, om resten af opgaven må fortsætte i projektmappen, og et ja svarer med collect', async t => {
  const { app, ui, replies } = await fixture(t, ['collect']);
  await app.permission(request({ commands: true, search: true }));
  assert.match(ui.asked[0], /Må resten af opgaven fortsætte i projektmappen\?/);
  assert.deepEqual(ui.choices[0], ['Ja, resten af opgaven', 'Nej, spørg hver gang']);
  assert.match(ui.output, /ændre filer i projektet, søge i projektets filer og køre kommandoer isoleret i projektet/);
  assert.match(ui.output, /Spørger stadig: Beskyttede filer, mapper uden for projektet, nettet og udgivelse\./);
  assert.deepEqual(replies, [{ id: 'per-6', allow: true, scope: 'collect' }]);
});

test('et nej spørger om handlingen alene som før', async t => {
  const { app, ui, replies } = await fixture(t, ['each', 'ja']);
  await app.permission(request({ commands: false, search: false }));
  assert.equal(ui.asked[1], 'Tillad denne handling én gang?');
  assert.deepEqual(replies, [{ id: 'per-6', allow: true }]);
});

test('uden spørgsmålet spørger terminalen kun om handlingen', async t => {
  const { app, ui, replies } = await fixture(t, ['nej']);
  await app.permission(request(null));
  assert.deepEqual(ui.asked, ['Tillad denne handling én gang?']);
  assert.deepEqual(replies, [{ id: 'per-6', allow: false }]);
});
