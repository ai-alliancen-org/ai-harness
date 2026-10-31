// Et gættet kontekstvindue må aldrig blive nævner i en procent, brugeren ser. Oplyser hverken kataloget eller
// tabellen vinduet, bruger modelLimits et forsigtigt reservetal på 32768 til motorens komprimering. Det tal er
// besluttet (docs/decisions.md: "Ukendte modeller beholder 32.768 og 4.096"), men det er en grænse til motoren,
// ikke en målt oplysning. Statuslinjen skal derfor sige "Grænsen er ikke oplyst" i stedet for at regne en procent.
// Prøven dækker både tallet, hele kæden frem til teksten og leddet i chat-session, som ingen anden prøve ser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contextLimit } = require('../core/connections.cjs');
const { ContextUsage } = require('../core/context-usage.cjs');
const display = require('../ui/context-display.js');

test('et gættet kontekstvindue bliver ikke en grænse', () => {
  assert.equal(contextLimit({ kind: 'ollama' }, { id: 'qwen3:8b' }), null, 'Ollama oplyser ikke sit vindue');
  assert.equal(contextLimit({ kind: 'compatible' }, { id: 'test-model' }), null, 'en ukendt selvhostet model heller ikke');
  assert.equal(contextLimit({ kind: 'azure', deployment: 'min-chat' }, { id: 'min-chat' }), null, 'en udrulning med eget navn rammer ikke tabellen');
  // Et oplyst vindue giver stadig en grænse, og over 200.000 er det Auras egen komprimeringsgrænse.
  assert.equal(contextLimit({ kind: 'anthropic' }, { id: 'claude-haiku-4-5' }), 200000, 'tabellen oplyser vinduet');
  assert.equal(contextLimit({ kind: 'compatible' }, { id: 'test-model', limits: { context: 8192 } }), 8192, 'kataloget oplyser vinduet');
});

test('uden et oplyst vindue viser statuslinjen ingen procent', () => {
  const valgt = { connectionID: 'lokal', modelID: 'test-model', routeID: '' };
  const usage = new ContextUsage({ now: () => 1 });
  usage.bind({ ...valgt, engineID: 'opencode@1.18.33', sessionID: 'session-1', limit: contextLimit({ kind: 'compatible' }, { id: 'test-model' }) });
  const snapshot = usage.observe({ type: 'step-finish', tokens: { input: 9000, cache: { read: 18000, write: 1000 } } });
  assert.equal(snapshot.reason, 'unknown-limit', 'grænsen er ukendt, ikke umålt');
  const text = display.describe(snapshot, valgt);
  assert.match(text.detail, /28\.000 tokens kontekst/, 'det målte tal står stadig');
  assert.match(text.detail, /Grænsen er ikke oplyst for denne model/);
  assert.ok(!text.detail.includes('%'), 'ingen procent af et reservetal: ' + text.detail);
  assert.equal(text.warning, '', 'ingen advarsel regnet af et gæt');
});

test('med et oplyst vindue står procenten og advarslen som før', () => {
  const valgt = { connectionID: 'sky', modelID: 'claude-haiku-4-5', routeID: '' };
  const usage = new ContextUsage({ now: () => 1 });
  usage.bind({ ...valgt, engineID: 'opencode@1.18.33', sessionID: 'session-1', limit: contextLimit({ kind: 'anthropic' }, { id: 'claude-haiku-4-5' }) });
  const snapshot = usage.observe({ type: 'step-finish', tokens: { input: 170000, cache: { read: 0, write: 0 } } });
  const text = display.describe(snapshot, valgt);
  assert.match(text.detail, /170\.000 af 200\.000 tokens kontekst, altså 85 %/);
  assert.match(text.warning, /85 % af grænsen på 200\.000 tokens/);
});

// Leddet selv: ingen anden prøve indlæser chat-session, så uden denne kan linjen rulles tilbage, uden at noget fyrer.
test('samtalen binder kontekstmålingen til den oplyste grænse', () => {
  const kilde = fs.readFileSync(path.join(__dirname, '../core/chat-session.cjs'), 'utf8');
  assert.match(kilde, /contextUsage\.bind\(\{[^}]*limit: connections\.contextLimit\(prepared\.connection, prepared\.model\)/,
    'chat-session skal sende connections.contextLimit som grænse, ikke modelLimits reservetal');
});
