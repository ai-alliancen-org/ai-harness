// En adresse, der ikke findes, får sin egen besked. Den må ikke ligne en server, der er nede, for brugeren skal
// rette adressen, ikke netværket (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { networkFailure } = require('../core/connections.cjs');

test('en adresse der ikke kan slås op får en besked om stavningen', () => {
  const fejl = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND hostet.invalid'), { code: 'ENOTFOUND' }) });
  const result = networkFailure(fejl);
  assert.match(result.message, /slås op|stavning|adresse/i);
  assert.doesNotMatch(result.message, /Serveren svarer ikke/);
});

test('en server der svarer ikke får stadig besked om netværk og port', () => {
  const fejl = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) });
  assert.match(networkFailure(fejl).message, /Serveren svarer ikke/);
});
