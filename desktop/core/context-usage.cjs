// SPDX-License-Identifier: EUPL-1.2
// Latest observed request input only. Never infer context from conversation totals.
const FIELDS = ['connectionID', 'modelID', 'routeID', 'engineID', 'sessionID'];
function bindingOf(value) {
  if (!value || typeof value !== 'object' || typeof value.modelID !== 'string' || !value.modelID || typeof value.sessionID !== 'string' || !value.sessionID) return null;
  const result = {};
  for (const key of FIELDS) { const item = value[key] ?? ''; if (typeof item !== 'string' || item.length > 300 || /[\x00-\x1f\x7f]/.test(item)) return null; result[key] = item; }
  return result;
}
const same = (left, right) => Boolean(left && right && FIELDS.every(key => left[key] === right[key]));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function explicitWindow(model) { const value = model?.limits?.context; return Number.isSafeInteger(value) && value > 0 ? value : null; }
class ContextUsage {
  constructor({ now = Date.now } = {}) { this.now = now; this.binding = null; this.window = null; this.latest = null; this.reason = 'unmeasured'; }
  bind(value) {
    const binding = bindingOf(value);
    if (!same(binding, this.binding)) { this.latest = null; this.reason = this.binding ? 'binding-changed' : 'unmeasured'; }
    this.binding = binding; this.window = explicitWindow(value?.model);
    return this.snapshot();
  }
  observe(part, binding = this.binding) {
    if (part?.type !== 'step-finish' || !this.binding || !same(bindingOf(binding), this.binding)) return this.snapshot();
    const tokens = part.tokens || {}, input = count(tokens.input), cacheRead = count(tokens.cache?.read ?? tokens.cacheRead), cacheWrite = count(tokens.cache?.write ?? tokens.cacheWrite);
    const total = input !== null && cacheRead !== null && cacheWrite !== null ? input + cacheRead + cacheWrite : null;
    const totalInput = Number.isSafeInteger(total) ? total : null;
    this.latest = { input, cacheRead, cacheWrite, totalInput, at: this.now() };
    this.reason = totalInput === null ? 'unknown-input' : this.window === null ? 'unknown-window' : null;
    return this.snapshot();
  }
  snapshot(binding = this.binding) {
    const valid = same(bindingOf(binding), this.binding), measurement = valid && this.latest ? { ...this.latest } : null;
    const inputTokens = measurement?.totalInput ?? null, windowTokens = valid ? this.window : null;
    const percentage = inputTokens !== null && windowTokens !== null ? inputTokens / windowTokens * 100 : null;
    return { source: 'engine-step-finish', reliability: 'last-request', known: inputTokens !== null, inputTokens, windowTokens, percentage: Number.isFinite(percentage) ? percentage : null, at: measurement?.at ?? null, measurement, binding: valid && this.binding ? { ...this.binding } : null, reason: !valid ? (this.binding ? 'binding-changed' : 'unmeasured') : this.reason };
  }
}
module.exports = { ContextUsage, explicitWindow, bindingOf };
