// Nye projekter får designets netlister som standard: Tailwind, webskrifter og billeder fra https (beslutning for beta 2).
// Eksisterende projekters lister ændres ikke. Skemaet https: tillades kun for billeder og medier, aldrig for kode eller stilarter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DESIGN_PREVIEW_NETWORK, normalizeRuntimeConfig } = require('../core/project-runtime.cjs');
const { policyFor, allowedRequest } = require('../core/preview-policy.cjs');

test('nye projekter får Tailwind og webskrifter som standard', () => {
  assert.ok(DESIGN_PREVIEW_NETWORK, 'DESIGN_PREVIEW_NETWORK skal være eksporteret');
  assert.ok(DESIGN_PREVIEW_NETWORK.scripts.includes('https://cdn.tailwindcss.com'));
  assert.ok(DESIGN_PREVIEW_NETWORK.styles.includes('https://fonts.googleapis.com'));
  assert.ok(DESIGN_PREVIEW_NETWORK.styles.includes('https://fonts.gstatic.com'));
});

test('billeder fra https er tilladt som standard', () => {
  assert.ok(DESIGN_PREVIEW_NETWORK.images.includes('https:'));
});

test('https: accepteres kun for billeder, aldrig for kode eller stilarter', () => {
  assert.deepEqual(normalizeRuntimeConfig({ network: { images: ['https:'] } }).network.images, ['https:']);
  assert.throws(() => normalizeRuntimeConfig({ network: { scripts: ['https:'] } }));
  assert.throws(() => normalizeRuntimeConfig({ network: { styles: ['https:'] } }));
});

test('et nyt projekt med standarden kan hente Tailwind, og et tilfældigt script fra internettet kan ikke', () => {
  const projekt = policyFor({ origin: 'aura-preview://nyt/', network: DESIGN_PREVIEW_NETWORK });
  assert.equal(allowedRequest({ url: 'https://cdn.tailwindcss.com/3.4.0', resourceType: 'script' }, projekt), true);
  assert.equal(allowedRequest({ url: 'https://billeder.example.com/a.png', resourceType: 'image' }, projekt), true);
  assert.equal(allowedRequest({ url: 'https://ondt.example.com/x.js', resourceType: 'script' }, projekt), false);
});

test('et eksisterende projekt uden standarden får ikke Tailwind af sig selv', () => {
  const eksisterende = policyFor({ origin: 'aura-preview://gammelt/', network: {} });
  assert.equal(allowedRequest({ url: 'https://cdn.tailwindcss.com/3.4.0', resourceType: 'script' }, eksisterende), false);
});

test('den statiske forhåndsvisning tillader unsafe-eval, så Vue og Alpine fra en godkendt CDN virker, uden at åbne for andre kilder (beta 3)', () => {
  const { contentSecurityPolicy } = require('../core/preview-policy.cjs');
  const csp = contentSecurityPolicy({ origin: 'aura-preview://p/', network: DESIGN_PREVIEW_NETWORK, static: true });
  const script = csp.split(';').find(part => part.trim().startsWith('script-src'));
  assert.match(script, /'unsafe-eval'/); assert.match(script, /https:\/\/cdn\.jsdelivr\.net/); assert.doesNotMatch(script, /\bhttps:(\s|$)/, 'ingen jokertegn for hele internettet');
});
