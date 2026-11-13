const { test } = require('node:test'); const assert = require('node:assert/strict');
const view = require('../ui/share-view.js');
const base = { id: 'v1', state: 'READY', url: 'https://blomst.komplai.run/', config: { provider: 'komplai' }, target: {} };
const checked = site => ({ provider: { status: 'checked' }, site, content: { status: 'matched' } });
test('uden adressekontrol står Kontrollér først og Udgiv en ny version er ikke med', () => {
 const a = view.mainActions(base); assert.equal(a[0], 'check'); assert.ok(!a.includes('new'));
});
test('adresse der ikke svarer eller giver 404 gør ikke Udgiv en ny version til valg', () => {
 for (const site of [{ status: 'unreachable' }, { status: 'answered', http: 404 }, { status: 'answered', http: 502 }]) { const a = view.mainActions({ ...base, checks: checked(site) }); assert.equal(a[0], 'check'); assert.ok(!a.includes('new')); }
});
test('afvigende indhold og ventende version holder Kontrollér i hovedrækken', () => {
 let a = view.mainActions({ ...base, checks: { provider: { status: 'checked' }, site: { status: 'answered', http: 200 }, content: { status: 'different' } } }); assert.equal(a[0], 'check'); assert.ok(!a.includes('new'));
 a = view.mainActions({ ...base, state: 'BUILDING', checks: { provider: { status: 'checked' }, site: { status: 'skipped' }, content: { status: 'skipped' } } }); assert.deepEqual(a, ['check']);
});
test('kontrolleret og klar app: Åbn appen er hovedknap, Udgiv en ny version ligger ved siden af', () => {
 assert.deepEqual(view.mainActions({ ...base, checks: checked({ status: 'answered', http: 200 }) }), ['open', 'new']);
});
test('problem og manglende kvittering viser udbyderens oversigt, og Kontrollér følger med når der er et id', () => {
 assert.deepEqual(view.mainActions({ ...base, state: 'ERROR' }), ['portal', 'check']);
 assert.deepEqual(view.mainActions({ ...base, id: undefined }), ['portal']);
});
