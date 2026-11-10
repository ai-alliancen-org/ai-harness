// Terminalversionen, anden rettelsesrunde for beta 3: N:B1-7 (/context og en ny AI-session lover ikke en ekstra kopi, der
// ikke sendes) og Q:C2-3 (/preview: rod-absolutte links som href="/om/" og "/style.css" virker). Ingen prøve kalder en
// AI-udbyder eller netværket uden for denne computer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('../terminal.cjs');
const { Vault, privateDirectory } = require('../storage.cjs');
const { Application } = require('../app.cjs');
const { disclose } = require('../connections.cjs');
const actions = require('../actions.cjs');

class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; this.asked = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question) { this.asked.push(question); assert.ok(this.answers.length, 'Prøven mangler et svar: ' + question); return this.answers.shift(); }
  async confirm(question) { return await this.ask(question) === 'ja'; }
  async choose(question) { return this.ask(question); }
  interrupt() {}
}
async function fixture(t, answers = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-u-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const project = path.join(root, 'projekt'); await fs.mkdir(project);
  const ui = new UI(answers), app = new Application({ directory: state, vault: new Vault(state), ui });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, project, ui, app };
}

// N:B1-7
test('N:B1-7: /context lover ikke en ekstra kopi, når samme AI-session fortsætter', async t => {
  const { app, ui } = await fixture(t);
  await app.command('/context');
  assert.doesNotMatch(ui.output, /sendes som ekstra kontekst, også efter modelskift/);
  assert.match(ui.output, /Fortsætter samme AI-session, har AI’en allerede samtalen, og der sendes ingen ekstra kopi\./);
  // Tilvalget ændrede intet efter Q:B1-2 og er fjernet (cli/tests/g-context-uden-tilvalg.test.cjs).
  assert.deepEqual(ui.asked, []);
});

test('N:B1-7: Før du sender siger, hvad der faktisk sker med tidligere samtale', async () => {
  const data = { recipients: 'Egen server · 127.0.0.1', region: 'Lokalt', training: 'Ukendt', retention: 'Ukendt', price: 'Ukendt', material: 'Beskeder', source: 'Ingen', checkedAt: '2026-11-10', security: 'Lokal', localStorage: 'Lokalt' };
  const ui = new UI(['send']);
  assert.equal(await disclose(ui, { ...data, historyText: 'Der sendes ingen ekstra kopi af tidligere samtale, fordi samme AI-session fortsætter og allerede har den.' }), true);
  assert.match(ui.output, /^Tidligere samtale: Der sendes ingen ekstra kopi af tidligere samtale, fordi samme AI-session fortsætter og allerede har den\.$/m);
  const uden = new UI(['send']);
  await disclose(uden, data);
  assert.doesNotMatch(uden.output, /Tidligere samtale/);
});

test('N:B1-7: en ny AI-session siger, om de seneste beskeder følger med, og lover ikke, at /context kan sende dem', async t => {
  const { app, ui, project } = await fixture(t);
  await app.open(project);
  ui.output = '';
  app.bench.chat.engineConversation = 'Bruger: Lav en forside\n\nAI: Her er forsiden.';
  app.event({ type: 'session.new', chat: app.bench.chatID });
  assert.match(ui.output, /^Ny AI-session\. De seneste beskeder fra samtalen følger med som kontekst\.$/m);
  ui.output = ''; app.bench.chat.engineConversation = '';
  app.event({ type: 'session.new', chat: app.bench.chatID });
  assert.match(ui.output, /^Ny AI-session\. Planlægning medtager afklaringen\.$/m);
  assert.doesNotMatch(ui.output, /\/context/);
});

// Q:C2-3: forhåndsvisningens adresse har en nøgle i stien. Et rod-absolut link peger uden om nøglen og gav 404.
async function site(project) {
  await fs.mkdir(path.join(project, 'public', 'om'), { recursive: true });
  await fs.writeFile(path.join(project, 'public', 'index.html'), '<!doctype html><link rel="stylesheet" href="/style.css"><h1>Forside</h1><a href="/om/">Om os</a>');
  await fs.writeFile(path.join(project, 'public', 'style.css'), 'h1 { color: rebeccapurple; }');
  await fs.writeFile(path.join(project, 'public', 'om', 'index.html'), '<!doctype html><h1>Om os</h1>');
}
test('Q:C2-3: /preview viser sidens rod-absolutte links og stylesheet, når siden er åbnet med forhåndsvisningens adresse', async t => {
  const { app, project } = await fixture(t, ['nej']);
  await site(project); await app.open(project);
  await actions.preview(app);
  const first = await fetch(app.preview.url);
  assert.equal(first.status, 200); assert.match(await first.text(), /Forside/);
  const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'browseren får adgang til resten af siden');
  assert.match(first.headers.get('set-cookie'), /HttpOnly/i); assert.match(first.headers.get('set-cookie'), /SameSite=Strict/i);
  const css = await fetch(new URL('/style.css', app.preview.url), { headers: { cookie } });
  assert.equal(css.status, 200); assert.match(await css.text(), /rebeccapurple/);
  const om = await fetch(new URL('/om/', app.preview.url), { headers: { cookie } });
  assert.equal(om.status, 200); assert.match(await om.text(), /Om os/);
  // Mappen uden / til sidst sendes videre til samme adresse med /, så sidens relative links peger ind i mappen.
  const mappe = await fetch(new URL('/om', app.preview.url), { headers: { cookie }, redirect: 'manual' });
  assert.equal(mappe.status, 302); assert.equal(mappe.headers.get('location'), '/om/');
  // Adressen med nøglen i stien virker stadig, også for undersider.
  assert.equal((await fetch(new URL('om/', app.preview.url))).status, 200);
});

test('Q:C2-3: uden nøglen i stien eller en gyldig cookie afvises kaldet stadig', async t => {
  const { app, project } = await fixture(t, ['nej']);
  await site(project); await app.open(project);
  await actions.preview(app);
  const name = (await fetch(app.preview.url)).headers.get('set-cookie')?.split('=')[0] || 'aura-preview';
  for (const headers of [{}, { cookie: `${name}=forkert` }, { cookie: 'andet=1' }]) {
    const response = await fetch(new URL('/style.css', app.preview.url), { headers });
    assert.equal(response.status, 404, JSON.stringify(headers));
    assert.equal(response.headers.get('set-cookie'), null);
  }
});
