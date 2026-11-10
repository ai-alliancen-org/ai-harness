// Skeptikerens fund efter G1 og G2: efter Q:B1-2 får en ny AI-session altid de seneste beskeder, og en fortsat session får aldrig en kopi.
// /context spurgte alligevel «Medsend en kopi af de seneste beskeder, når en ny AI-session starter …?», og svaret ændrede intet. Nu
// forklarer /context, hvad der sker, uden at stille et spørgsmål, og terminalen sender intet tilvalg med.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('../terminal.cjs');
const { Vault, privateDirectory } = require('../storage.cjs');
const { Application } = require('../app.cjs');

class UI {
  constructor() { this.output = ''; this.asked = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question) { this.asked.push(question); return 'ja'; }
  async confirm(question) { return await this.ask(question) === 'ja'; }
  async choose(question) { return this.ask(question); }
  interrupt() {}
}

test('/context forklarer, hvad der sker med tidligere beskeder, uden at stille et spørgsmål uden virkning', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-context-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const ui = new UI(), app = new Application({ directory: state, vault: new Vault(state), ui });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  await app.command('/context');
  assert.deepEqual(ui.asked, [], 'intet spørgsmål');
  assert.match(ui.output, /Når en ny AI-session starter, fx efter modelskift, følger de seneste beskeder med som kontekst\./);
  assert.match(ui.output, /Fortsætter samme AI-session, har AI’en allerede samtalen, og der sendes ingen ekstra kopi\./);
  assert.equal(Object.hasOwn(app, 'includeHistory'), false, 'terminalen har intet tilvalg at sende');
});
