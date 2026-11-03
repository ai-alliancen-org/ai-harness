const { test } = require('node:test');
const assert = require('node:assert/strict');
const { progress, workState } = require('../ui/chat-display.js');
test('status skelner mellem svar, tavshed og brugerens godkendelse uden at opfinde tokens', () => {
  const v = { runStartedAt: 1000, lastSignalAt: 1000, receivedChars: 0, waitingFor: [] };
  assert.match(progress(v, 1100).text, /Venter på svar/);
  assert.deepEqual(progress(v, 17000), { quiet: true, stalled: false, text: 'Ingen nye signaler i 16 s. Du kan vente eller stoppe.' });
  v.lastSignalAt = 17000; v.receivedChars = 200;
  assert.deepEqual(progress(v, 18000), { quiet: false, stalled: false, text: '200 tegn modtaget' });
  v.waitingFor = [{}];
  assert.deepEqual(progress(v, 80000), { quiet: false, stalled: false, text: '' });
});

test('lyskanten drejer under arbejde, står stille uden signaler og forsvinder, når der ventes på brugeren', () => {
  const v = { running: true, runStartedAt: 1000, lastSignalAt: 1000, receivedChars: 0, waitingFor: [] };
  assert.equal(workState(v, 2000), 'working');
  assert.equal(workState(v, 17000), 'quiet', '15 sekunder uden signaler');
  v.lastSignalAt = 17000; assert.equal(workState(v, 18000), 'working', 'et nyt signal sætter den i gang igen');
  v.waitingFor = [{}]; assert.equal(workState(v, 80000), 'waiting');
  v.running = false; assert.equal(workState(v, 80000), 'idle');
});

test('efter 60 sekunders tavshed er opgaven gået i stå: teksten forklarer, og Stop og prøv igen tilbydes (årsag 5)', () => {
  const display = require('../ui/chat-display.js');
  const view = { running: true, runStartedAt: 0, lastSignalAt: 0, waitingFor: [], receivedChars: 0, modelProgress: null };
  const stille = display.progress(view, 20_000);
  assert.equal(stille.quiet, true); assert.equal(stille.stalled, false);
  const gaaetISsaa = display.progress(view, 75_000);
  assert.equal(gaaetISsaa.stalled, true); assert.match(gaaetISsaa.text, /udbyderen kan have travlt/i); assert.match(gaaetISsaa.text, /stop og prøv igen/i);
  assert.equal(display.progress({ ...view, waitingFor: [{ title: 'x' }] }, 75_000).stalled, false, 'venter på brugeren er ikke et stop');
});
