const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ContextUsage, explicitWindow } = require('../core/context-usage.cjs');
const binding = { connectionID: 'chosen', modelID: 'vendor/model', routeID: 'exact', engineID: 'opencode', sessionID: 'session-one', model: { limits: { context: 1000 } } };
const finish = (input, read = 0, write = 0) => ({ type: 'step-finish', tokens: { input, cache: { read, write } } });
test('context usage uses only latest actual step input plus cache counts, never cumulative usage or output', () => {
  const usage = new ContextUsage({ now: () => 123 }); usage.bind(binding);
  assert.equal(usage.snapshot().inputTokens, null);
  let state = usage.observe(finish(100, 20, 10), binding); assert.equal(state.inputTokens, 130); assert.equal(state.percentage, 13); assert.equal(state.at, 123);
  state = usage.observe({ ...finish(20), cost: 5, totalTokens: 50000, tokens: { input: 20, output: 9000, cache: { read: 0, write: 0 } } }, binding);
  assert.equal(state.inputTokens, 20); assert.equal(state.percentage, 2); assert.equal(state.cost, undefined); assert.equal(state.reliability, 'last-request');
  usage.observe({ type: 'text', tokens: { input: 999 } }, binding); assert.equal(usage.snapshot().inputTokens, 20);
});
test('unknown catalog window, missing cache, unsafe counts and fallbacks never invent a percentage', () => {
  for (const model of [{}, { contextWindow: 1000 }, { limits: { context: '1000' } }, { limits: { context: 0 } }, { limits: { context: Infinity } }]) {
    const usage = new ContextUsage(); usage.bind({ ...binding, model }); const state = usage.observe(finish(100), binding);
    assert.equal(explicitWindow(model), null); assert.equal(state.windowTokens, null); assert.equal(state.percentage, null);
  }
  const usage = new ContextUsage(); usage.bind(binding);
  for (const part of [{ type: 'step-finish', tokens: { input: 20 } }, finish(-1), finish(Number.MAX_SAFE_INTEGER, 1), finish(NaN)]) {
    const state = usage.observe(part, binding); assert.equal(state.inputTokens, null); assert.equal(state.percentage, null); assert.equal(state.reason, 'unknown-input');
  }
});
test('model, route, engine, session changes and restart invalidate the last measurement', () => {
  const usage = new ContextUsage(); usage.bind(binding); usage.observe(finish(100), binding);
  for (const field of ['connectionID', 'modelID', 'routeID', 'engineID', 'sessionID']) {
    const changed = { ...binding, [field]: 'changed' }; assert.equal(usage.snapshot(changed).measurement, null);
    usage.bind(changed); assert.equal(usage.snapshot().percentage, null);
    usage.observe(finish(500), binding); assert.equal(usage.snapshot().inputTokens, null);
    usage.bind(binding); usage.observe(finish(100), binding);
  }
  const restarted = new ContextUsage(); restarted.bind(binding); assert.equal(restarted.snapshot().measurement, null); assert.equal(new ContextUsage().snapshot().reason, 'unmeasured');
});
