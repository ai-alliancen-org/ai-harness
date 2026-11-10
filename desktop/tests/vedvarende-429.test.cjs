// K5: en udbyder, der bliver ved med at svare 429. OpenCode prøver igen (beslutning for beta 2), og skærmen skal kunne vise
// forsøget og ventetiden. Når OpenCode giver op, skal kortet skelne en kort grænse fra en opbrugt konto og give en vej til
// kontoen hos udbyderen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { sessionFailure } = require('../core/chat-session.cjs');
const { failureText, retryText } = require('../ui/approval-view.js');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

async function runningChat(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-429-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const events = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root, name: 'Grænse' }); const chat = bench.chat;
  chat.running = true; chat.runMode = 'build';
  return { chat, events };
}

test('OpenCodes genforsøg vises: forsøg, ventetid og HTTP-status sendes til skærmen og ryddes, når kaldet går videre', async t => {
  const { chat, events } = await runningChat(t);
  const next = Date.now() + 8000;
  chat.event({ type: 'session.status', properties: { sessionID: 's', status: { type: 'retry', attempt: 3, message: 'Modelserveren svarede midlertidigt (HTTP 429). Udbyderens svar: Requests rate limit exceeded', next } } });
  const retry = events.filter(event => event.type === 'model.retry');
  assert.equal(retry.length, 1);
  assert.deepEqual(retry[0].retry, { attempt: 3, next, status: 429, kind: 'limit' });
  assert.equal(retry[0].chat, chat.id, 'hændelsen hører til samtalen');
  // N:B1-3: statuslinjen siger det i almindeligt dansk. Udbyderens egen besked med HTTP-status står i Aktivitet, ét lag længere nede.
  const entry = chat.activityList().find(item => item.title === 'Kaldet til AI’en mislykkedes. Aura prøver igen');
  assert.ok(entry, 'genforsøget står i Aktivitet');
  assert.equal(entry.detail, 'Modelserveren svarede midlertidigt (HTTP 429). Udbyderens svar: Requests rate limit exceeded Forsøg 4.');
  chat.event({ type: 'session.status', properties: { sessionID: 's', status: { type: 'busy' } } });
  chat.event({ type: 'session.status', properties: { sessionID: 's', status: { type: 'busy' } } });
  const after = events.filter(event => event.type === 'model.retry');
  assert.equal(after.length, 2, 'kun ét signal om, at ventetiden er slut');
  assert.equal(after[1].retry, null);
});

test('en 429, hvor udbyderen siger, at kvoten eller kreditten er brugt op, giver kontokortet; en kort grænse giver grænsekortet', () => {
  const said = text => ({ data: { statusCode: 429, message: `Modelserveren svarede midlertidigt (HTTP 429). Udbyderens svar: ${text}` } });
  assert.equal(sessionFailure(said('You exceeded your current quota, please check your plan and billing details.')), 'quota');
  assert.equal(sessionFailure(said('insufficient_quota')), 'quota');
  assert.equal(sessionFailure(said('Requests rate limit exceeded')), 'limit');
  assert.equal(sessionFailure(said('Rate limit reached for gpt-5 on tokens per min (TPM). Please try again in 6s.')), 'limit');
});

// N:B1-6: grænsekortet har højst én linje forklaring i første lag (DESIGN.md, Rolige skærme). Forskellen på en kort grænse og kontoens
// grænse står under Se detaljer (detail).
test('grænsekortet har én linje i første lag, skelner en kort grænse fra kontoens grænse under Se detaljer og har kontoen hos udbyderen som andet valg', () => {
  const limit = failureText('limit');
  assert.equal(limit.action, 'retry', 'Prøv igen er stadig hovedknappen');
  assert.equal(limit.secondary, 'account');
  assert.equal(limit.text, 'Vent lidt, og prøv igen, eller se kontoens grænse hos udbyderen.');
  assert.equal(limit.text.split(/[.!?](?:\s|$)/).filter(Boolean).length, 1, 'én sætning');
  assert.match(limit.detail, /kort tid/); assert.match(limit.detail, /måneden eller planen/); assert.match(limit.detail, /hos udbyderen/);
});

test('statuslinjen siger i almindeligt dansk, hvorfor der ventes, og hvornår der prøves igen', () => {
  const now = 1_000_000;
  // N:B1-3: HTTP-status hører til detaljerne, ikke statuslinjens første lag.
  assert.equal(retryText({ attempt: 2, next: now + 32_000, status: 429, kind: 'limit' }, now), 'Udbyderen afviser lige nu. Aura prøver igen om 32 s (forsøg 3). Du kan vente eller stoppe.');
  assert.equal(retryText({ attempt: 1, next: now + 3_000, status: 503, kind: 'server' }, now), 'Udbyderens server svarer med en fejl. Aura prøver igen om 3 s (forsøg 2). Du kan vente eller stoppe.');
  assert.equal(retryText({ attempt: 4, next: now + 150_000, status: null, kind: 'network' }, now), 'Forbindelsen til udbyderen blev afbrudt. Aura prøver igen om 3 min (forsøg 5). Du kan vente eller stoppe.');
  assert.equal(retryText({ attempt: 1, next: now - 500, status: null, kind: 'model' }, now), 'Udbyderen svarede ikke som ventet. Aura prøver igen nu (forsøg 2). Du kan vente eller stoppe.');
  assert.equal(retryText(null, now), '');
});
