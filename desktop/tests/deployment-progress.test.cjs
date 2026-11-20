const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mount } = require('./d2-dom.cjs');
const view = require('../ui/share-view.js');

const base = { id: 'revision', state: 'UPLOADED', config: { provider: 'azure-containers', mode: 'container', directory: '.', project: 'demo' }, target: { name: 'Demo', host: 'demo.azurecontainerapps.io' }, head: 'a'.repeat(40), hash: 'hash', version: { name: 'Demo' } };
const checked = (site, state = 'READY', content = 'built') => ({ ...base, state, url: 'https://demo.azurecontainerapps.io', checks: { at: new Date().toISOString(), provider: { status: 'checked' }, site, content: { status: content } } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(t) {
  let last = base, listener, now = 100000, timerID = 0;
  const timers = new Map(), calls = [];
  const handlers = {
    deploymentState: async () => ({ last, config: last.config }), deploymentGuides: async () => [],
    deploymentCheck: async () => last,
    deploymentReview: async () => ({ ...base, token: 'review-1', files: ['Dockerfile'], bytes: 42 }),
    deploymentSend: async () => { last = { ...base, startedAt: '2026-11-20T13:00:00Z' }; return last; }
  };
  const harness = new Proxy({ onEvent: callback => { listener = callback; } }, { get: (target, name) => target[name] || (handlers[name] && (async input => {
    calls.push({ name, input });
    try { return { ok: true, value: await handlers[name](input) }; } catch (error) { return { ok: false, error: error.message }; }
  })) });
  class ClockDate extends Date { static now() { return now; } }
  const d = mount(harness, { clock: { Date: ClockDate, setInterval: fn => { timers.set(++timerID, fn); return timerID; }, clearInterval: id => timers.delete(id) } });
  t.after(() => d.close());
  return { d, handlers, calls, timers, emit: value => listener({ type: 'deployment-progress', root: '/projekt', chat: 'samtale', ...value }), advance: ms => { now += ms; for (const fn of timers.values()) fn(); } };
}

test('live check immediately replaces the old result, ticks elapsed time, and shows a visible success', async t => {
  const f = fixture(t), { d } = f, pending = deferred(); await d.open();
  f.handlers.deploymentCheck = () => pending.promise;
  const request = d.$('deployment-check').onclick();
  assert.equal(d.$('deployment-progress').hidden, false);
  assert.equal(d.$('deployment-verification').dataset.tone, 'pending');
  assert.match(d.$('deployment-verification').textContent, /Kontrollerer, om siden svarer/);
  assert.equal(d.$('deployment-check').textContent, 'Kontrollerer …');
  assert.equal(d.$('deployment-check').disabled, true);
  f.advance(65000); assert.equal(d.$('deployment-progress-time').textContent, '1:05');
  const key = f.calls.at(-1).input.requestId;
  f.emit({ operation: 'check', key, stage: 'site', root: '/andet-projekt' });
  assert.match(d.$('deployment-progress-step').textContent, /Trin 1 af 2/);
  f.emit({ operation: 'check', key, stage: 'site' });
  assert.match(d.$('deployment-progress-step').textContent, /Trin 2 af 2/);
  pending.resolve(checked({ status: 'answered', http: 200 })); await request;
  assert.equal(d.$('deployment-progress').hidden, true); assert.equal(f.timers.size, 0);
  assert.equal(d.$('deployment-verification').hidden, false);
  assert.equal(d.$('deployment-verification').dataset.tone, 'positive');
  assert.equal(d.$('deployment-verification h4').textContent, 'Ja, startsiden svarer');
});

test('a failed check clears pending UI and allows another check; closing ignores late results and events', async t => {
  const f = fixture(t), { d } = f; await d.open();
  f.handlers.deploymentCheck = async () => { throw Error('offline'); };
  await d.$('deployment-check').onclick();
  assert.equal(d.$('deployment-verification').dataset.tone, 'warning');
  assert.equal(d.$('deployment-verification h4').textContent, 'Siden er ikke bekræftet');
  assert.equal(d.$('deployment-check').disabled, false); assert.equal(f.timers.size, 0);
  const pending = deferred(); f.handlers.deploymentCheck = () => pending.promise;
  const request = d.$('deployment-check').onclick(), key = f.calls.at(-1).input.requestId;
  d.close(); assert.equal(f.timers.size, 0);
  await d.open(); const before = d.$('deployment-verification h4').textContent;
  f.emit({ operation: 'check', key, stage: 'site' });
  pending.resolve(checked({ status: 'answered', http: 200 })); await request;
  assert.equal(d.$('deployment-verification h4').textContent, before);
  assert.equal(d.$('deployment-progress').hidden, true);
});

test('container publishing follows actual stages, ignores stale events, and prevents duplicate uploads', async t => {
  const f = fixture(t), { d } = f; await d.open();
  await d.setup().busy(d.setup().prepareReview);
  const pending = deferred(); f.handlers.deploymentSend = () => pending.promise;
  const request = d.$('deployment-send').onclick();
  assert.match(d.$('deployment-progress-step').textContent, /Trin 1 af 4/);
  f.emit({ operation: 'send', key: 'old-review', stage: 'activate' });
  assert.match(d.$('deployment-progress-step').textContent, /Trin 1 af 4/);
  f.emit({ operation: 'send', key: 'review-1', stage: 'build' });
  assert.match(d.$('deployment-progress-label').textContent, /Byg container/);
  f.emit({ operation: 'send', key: 'review-1', stage: 'activate' });
  assert.equal(d.$('deployment-progress-stages').children[1].dataset.state, 'done');
  f.emit({ operation: 'send', key: 'review-1', stage: 'verify' });
  assert.match(d.$('deployment-progress-step').textContent, /Trin 3 af 4/);
  await d.$('deployment-send').onclick();
  assert.equal(f.calls.filter(call => call.name === 'deploymentSend').length, 1);
  pending.resolve(base); await request;
  assert.equal(f.timers.size, 0); assert.equal(d.$('deployment-progress').hidden, true);
});

test('container live-check outcomes are explicit for HTTP success, errors, waiting, and access requirements', () => {
  for (const [site, state, text, tone] of [
    [{ status: 'answered', http: 200 }, 'READY', 'Ja, startsiden svarer', 'positive'],
    [{ status: 'answered', http: 503 }, 'READY', 'Nej, startsiden svarer med en fejl', 'warning'],
    [{ status: 'unreachable' }, 'READY', 'Nej, startsiden kunne ikke nås', 'warning'],
    [{ status: 'skipped' }, 'AWAITING_UPDATE', 'Appen er ikke klar endnu', 'neutral'],
    [{ status: 'answered', http: 403 }, 'READY', 'Startsiden kræver adgang', 'neutral'],
    [{ status: 'answered', http: 302 }, 'READY', 'Siden viderestiller', 'neutral']
  ]) {
    const summary = view.receiptSummary(checked(site, state, site.http === 200 ? 'built' : 'skipped')).verification;
    assert.notEqual(summary.hidden, true); assert.equal(summary.title, text); assert.equal(summary.tone, tone);
  }
});
