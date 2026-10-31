const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createControlledModelTransport } = require('../core/privacy/transport.cjs');

const body = content => JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content }], stream: true });
function fixture(overrides = {}) {
  const state = { calls: [], reviews: [], audit: [], policy: { project: { enabled: true, version: 'p1', allowedDestinationIds: ['selected'], defaultClass: 'public' } }, destination: { id: 'selected', model: 'fixture', locality: 'cloud', endpoint: 'https://synthetic.invalid/v1/chat/completions', revision: 'c1' } };
  const dispatch = createControlledModelTransport({ getPolicy: () => state.policy, resolveDestination: () => state.destination, readCurrentState: () => ({ policy: state.policy, destination: state.destination }), getAuthorization: () => ({ authorization: 'Bearer SYNTHETIC_TEST_KEY' }), requestApproval: review => { state.reviews.push(review); return 'approve'; }, audit: event => { state.audit.push(event); }, fetchImpl: async (url, init) => { state.calls.push({ url, ...init }); return new Response('ok'); }, ...overrides });
  return { state, action: options => dispatch({ scope: { project: 'synthetic' }, destinationRef: 'selected', body: body('Public demonstration'), purpose: 'test', contextPartition: 'cloud-session', revision: 1, ...options }) };
}

test('adapter dispatches exact approved bytes once; credentials stay out of review and audit', async () => {
  const f = fixture();
  await f.action({ body: body('Contact alice@example.invalid') });
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.calls[0].body, f.state.reviews[0].payload);
  assert.doesNotMatch(f.state.calls[0].body, /alice@example/);
  assert.equal(f.state.calls[0].headers.authorization, 'Bearer SYNTHETIC_TEST_KEY');
  assert.equal(f.state.calls[0].redirect, 'error');
  assert.doesNotMatch(JSON.stringify([f.state.reviews, f.state.audit]), /SYNTHETIC_TEST_KEY/);
});

test('disabled policy, unknown headers, model mismatch and query endpoints do not dispatch', async t => {
  for (const kind of ['disabled', 'header', 'model', 'query']) await t.test(kind, async () => {
    let sends = 0;
    const f = fixture({ fetchImpl: () => { sends++; }, ...(kind === 'header' ? { getAuthorization: () => ({ host: 'other.invalid' }) } : {}) });
    if (kind === 'disabled') f.state.policy.project.enabled = false;
    if (kind === 'query') f.state.destination.endpoint += '?token=synthetic';
    await assert.rejects(f.action(kind === 'model' ? { body: '{"model":"other"}' } : {}));
    assert.equal(sends, 0);
  });
});

test('a recipient change during credential lookup invalidates dispatch', async () => {
  let f;
  f = fixture({ getAuthorization: async () => { f.state.destination.endpoint = 'https://changed.invalid/v1/chat/completions'; return {}; } });
  await assert.rejects(f.action(), { code: 'PRIVACY_STALE' });
  assert.equal(f.state.calls.length, 0);
});

test('the adapter requires a synchronous host-owned current-state reader', async () => {
  assert.throws(() => fixture({ readCurrentState: undefined }), TypeError);
  for (const readCurrentState of [async () => ({}), () => null, () => { throw new Error('SYNTHETIC_TEST_KEY'); }]) {
    const f = fixture({ readCurrentState });
    await assert.rejects(f.action(), error => { assert.doesNotMatch(error.message, /SYNTHETIC_TEST_KEY/); return true; });
    assert.equal(f.state.calls.length, 0);
  }
});

test('a policy mutation during the final async recipient lookup sends zero bytes', async () => {
  let f, resolutions = 0;
  f = fixture({ resolveDestination: async () => {
    resolutions++;
    if (resolutions === 3) { f.state.policy.project.version = 'p2'; f.state.policy.project.allowedDestinationIds = []; }
    return f.state.destination;
  } });
  await assert.rejects(f.action({ assertCurrent: () => true }), { code: 'PRIVACY_STALE' });
  assert.equal(resolutions, 3); assert.equal(f.state.calls.length, 0);
});

test('final current-state check covers policy and recipient even when async resolvers return stale caches', async t => {
  for (const changed of ['policy', 'destination']) await t.test(changed, async () => {
    let f, reads = 0;
    f = fixture({ readCurrentState: (scope, ref) => {
      assert.deepEqual(scope, { project: 'synthetic' }); assert.equal(ref, 'selected'); reads++;
      const current = structuredClone({ policy: f.state.policy, destination: f.state.destination });
      if (reads === 2) {
        if (changed === 'policy') current.policy.project.version = 'p2';
        else current.destination.account = 'different-account';
      }
      return current;
    } });
    await assert.rejects(f.action(), { code: 'PRIVACY_STALE' });
    assert.equal(reads, 2); assert.equal(f.state.calls.length, 0);
  });
});

test('a lifecycle callback cannot mutate policy after the final host snapshot', async () => {
  const f = fixture(); let checks = 0;
  await assert.rejects(f.action({ assertCurrent: () => {
    if (++checks === 2) f.state.policy.project.version = 'p2';
    return true;
  } }), { code: 'PRIVACY_STALE' });
  assert.equal(checks, 2); assert.equal(f.state.calls.length, 0);
});

test('no microtask separates the last host snapshot from the single transport invocation', async () => {
  let f, reads = 0, transportObservedBeforeMutation = false;
  f = fixture({ readCurrentState: () => {
    if (++reads === 2) queueMicrotask(() => {
      transportObservedBeforeMutation = f.state.calls.length === 1;
      f.state.policy.project.version = 'p2';
    });
    return { policy: f.state.policy, destination: f.state.destination };
  } });
  await f.action();
  assert.equal(reads, 2); assert.equal(f.state.calls.length, 1); assert.equal(transportObservedBeforeMutation, true);
});

test('a stale local-choice review does not mint routing authority', async () => {
  const { isLocalChoiceRequest } = require('../core/privacy/index.cjs');
  let f, resolutions = 0;
  f = fixture({ requestApproval: () => 'local', resolveDestination: async () => {
    if (++resolutions === 3) f.state.policy.project.version = 'p2';
    return f.state.destination;
  } });
  await assert.rejects(f.action({ forceApproval: true }), error => {
    assert.equal(error.code, 'PRIVACY_STALE'); assert.equal(isLocalChoiceRequest(error), false); return true;
  });
  assert.equal(f.state.calls.length, 0);
});

test('explicit provider routing is bound to the registered recipient with no fallback', async t => {
  const valid = { only: ['provider-a'], allow_fallbacks: false };
  const f = fixture(); f.state.destination.route = 'provider-a';
  const routedBody = JSON.stringify({ ...JSON.parse(body('Public example')), provider: valid });
  await f.action({ body: routedBody, forceApproval: true });
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].body, routedBody);
  assert.equal(f.state.reviews[0].destination.route, 'provider-a');
  assert.equal(f.state.reviews[0].payload, routedBody);
  for (const [name, provider] of [
    ['missing', undefined], ['mismatch', { ...valid, only: ['provider-b'] }],
    ['fallback enabled', { ...valid, allow_fallbacks: true }], ['fallback unspecified', { only: ['provider-a'] }],
    ['multiple recipients', { ...valid, only: ['provider-a', 'provider-b'] }], ['order instead of only', { order: ['provider-a'], allow_fallbacks: false }],
  ]) await t.test(name, async () => {
    const g = fixture(); g.state.destination.route = 'provider-a';
    await assert.rejects(g.action({ body: JSON.stringify({ ...JSON.parse(body('Public example')), provider }) }), { code: 'PRIVACY_CONTROL_FAILED' });
    assert.equal(g.state.calls.length, 0);
  });
  const unregistered = fixture();
  await assert.rejects(unregistered.action({ body: routedBody }), { code: 'PRIVACY_CONTROL_FAILED' });
  assert.equal(unregistered.state.calls.length, 0);
  for (const alternate of [{ models: ['fixture', 'other'] }, { route: 'fallback' }]) {
    const g = fixture();
    await assert.rejects(g.action({ body: JSON.stringify({ ...JSON.parse(body('Public example')), ...alternate }) }), { code: 'PRIVACY_CONTROL_FAILED' });
    assert.equal(g.state.calls.length, 0);
  }
});

test('a changed rule during approval is revalidated, and Stop sends nothing', async () => {
  let f;
  f = fixture({ requestApproval: () => { f.state.policy.project.version = 'p2'; return 'approve'; } });
  await assert.rejects(f.action({ forceApproval: true }), { code: 'PRIVACY_STALE' });
  assert.equal(f.state.calls.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.action({ signal: controller.signal }), { code: 'PRIVACY_ABORTED' });
});

test('a partial response or transport exception never retries or changes recipient', async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async () => { calls++; throw new Error('SYNTHETIC_TEST_KEY https://private.invalid'); } });
  await assert.rejects(f.action(), error => { assert.equal(error.code, 'PRIVACY_TRANSPORT_FAILED'); assert.doesNotMatch(error.message, /SYNTHETIC_TEST_KEY|private.invalid/); return true; });
  assert.equal(calls, 1);
  const g = fixture({ fetchImpl: async () => { calls++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first')); controller.error(new Error('stream broke')); } })); } });
  const response = await g.action(); await assert.rejects(response.text()); assert.equal(calls, 2);
});

test('real HTTP receiver sees approved bytes, rejects redirect and receives no strict data', async t => {
  const received = []; let redirect = false;
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    received.push({ url: req.url, data });
    if (redirect) { res.writeHead(307, { location: '/unexpected' }); res.end(); }
    else { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"ok":true}\n\n'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const f = fixture({ fetchImpl: fetch });
  f.state.destination.endpoint = `http://127.0.0.1:${server.address().port}/model`;
  await (await f.action({ body: body('Synthetic alice@example.invalid') })).text();
  assert.equal(received[0].data, f.state.reviews[0].payload);
  assert.doesNotMatch(received[0].data, /alice@example/);
  await assert.rejects(f.action({ provenance: [{ classification: 'strict' }] }), { code: 'PRIVACY_LOCAL_REQUIRED' });
  assert.equal(received.length, 1);
  redirect = true;
  await assert.rejects(f.action(), { code: 'PRIVACY_TRANSPORT_FAILED' });
  assert.equal(received.length, 2); assert(received.every(item => item.url === '/model'));
});
