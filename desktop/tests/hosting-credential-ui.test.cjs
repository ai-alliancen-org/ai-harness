// Execute the production UI module; only DOM and IPC boundaries are synthetic.
// These regressions exercise form lifetime, without credentials or network use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/hosting.js'), 'utf8');
function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}
function fixture({ cancelResponse, entryResponse } = {}) {
  const nodes = new Map(), calls = [], cancelStarted = deferred(), entryStarted = deferred();
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      open: false, hidden: false, disabled: false, checked: false, textContent: '', value: '', listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      replaceChildren() {}, scrollIntoView() {}, focus() {}
    });
    return nodes.get(selector);
  };
  let cancelCount = 0;
  const harness = {
    hostingCancel() {
      calls.push({ method: 'cancel' }); cancelStarted.resolve();
      return ++cancelCount === 1 && cancelResponse ? cancelResponse.promise : Promise.resolve({ ok: true, value: true });
    },
    credentialEntry(value) {
      calls.push({ method: 'entry', value }); entryStarted.resolve();
      return entryResponse ? entryResponse.promise : Promise.resolve({ ok: true, value: { canceled: true } });
    },
    hostingToken(value) {
      calls.push({ method: 'token', value });
      return Promise.resolve({ ok: true, value: {} });
    }
  };
  vm.runInNewContext(source, { document: { querySelector: element }, window: { harness, ShareView: {} }, clearTimeout, setTimeout }, { filename: 'hosting.js' });
  element('#hosting-dialog').open = true;
  return {
    calls, cancelStarted: cancelStarted.promise, entryStarted: entryStarted.promise,
    submit() { element('#hosting-token-form').onsubmit({ preventDefault() {} }); },
    close() { element('#hosting-dialog').open = false; element('#hosting-dialog').listeners.get('close')(); },
    async settled() {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(element('#hosting-body').disabled, false, 'The completed operation must release the form busy state');
      assert.equal(element('#hosting-feedback').textContent, '', 'Cancellation must not become a hidden operation error');
    }
  };
}

test('closing the GitHub form during delayed Cancel IPC cannot open a secure entry afterward', async () => {
  const cancelResponse = deferred(), f = fixture({ cancelResponse });
  f.submit(); await f.cancelStarted;
  assert.equal(f.calls.filter(call => call.method === 'entry').length, 0);
  f.close(); cancelResponse.resolve({ ok: true, value: true }); await f.settled();
  assert.equal(f.calls.filter(call => call.method === 'entry').length, 0, 'A stale submit must not open a key window after the form closes');
  assert.equal(f.calls.filter(call => call.method === 'token').length, 0);
});

test('closing the GitHub form before a credential response arrives cannot send its opaque receipt', async () => {
  const entryResponse = deferred(), f = fixture({ entryResponse });
  f.submit(); await f.entryStarted;
  assert.equal(f.calls.filter(call => call.method === 'entry').length, 1);
  f.close(); entryResponse.resolve({ ok: true, value: { canceled: false, keyReceipt: 'synthetic-opaque-receipt-only' } }); await f.settled();
  assert.equal(f.calls.filter(call => call.method === 'token').length, 0, 'A response from the closed form must not request account verification or token storage');
});
