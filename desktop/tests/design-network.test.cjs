// Nye projekter får designets netlister som standard: Tailwind, webskrifter og billeder fra https (beslutning for beta 2).
// Eksisterende projekters lister ændres ikke. Skemaet https: tillades kun for billeder og medier, aldrig for kode eller stilarter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DESIGN_PREVIEW_NETWORK, normalizeRuntimeConfig } = require('../core/project-runtime.cjs');
const { policyFor, allowedRequest } = require('../core/preview-policy.cjs');

test('nye projekter får Tailwind og webskrifter som standard', () => {
  assert.ok(DESIGN_PREVIEW_NETWORK, 'DESIGN_PREVIEW_NETWORK skal være eksporteret');
  assert.deepEqual(DESIGN_PREVIEW_NETWORK.scripts, ['https://cdn.tailwindcss.com']);
  assert.deepEqual(DESIGN_PREVIEW_NETWORK.styles, ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
});

test('eksterne billeder er ikke tilladt som standard, men kræver brugerens samtykke pr. adresse (brugerens valg 5. november)', () => {
  assert.deepEqual(DESIGN_PREVIEW_NETWORK.images, []);
});

test('https: accepteres kun for billeder, aldrig for kode eller stilarter', () => {
  assert.deepEqual(normalizeRuntimeConfig({ network: { images: ['https:'] } }).network.images, ['https:']);
  assert.throws(() => normalizeRuntimeConfig({ network: { scripts: ['https:'] } }));
  assert.throws(() => normalizeRuntimeConfig({ network: { styles: ['https:'] } }));
});

test('et nyt projekt med standarden kan hente Tailwind, og et tilfældigt script fra internettet kan ikke', () => {
  const projekt = policyFor({ origin: 'aura-preview://nyt/', network: DESIGN_PREVIEW_NETWORK });
  assert.equal(allowedRequest({ url: 'https://cdn.tailwindcss.com/3.4.0', resourceType: 'script' }, projekt), true);
  assert.equal(allowedRequest({ url: 'https://billeder.example.com/a.png', resourceType: 'image' }, projekt), false, 'et eksternt billede kræver samtykke');
  assert.equal(allowedRequest({ url: 'https://ondt.example.com/x.js', resourceType: 'script' }, projekt), false);
  for (const url of ['https://cdn.tailwindcss.com.evil.example/x.js', 'https://evil.example/https://cdn.tailwindcss.com', 'https://cdn.tailwindcss.com@evil.example/x.js']) {
    assert.equal(allowedRequest({ url, resourceType: 'script' }, projekt), false, url);
  }
});

test('et eksisterende projekt uden standarden får ikke Tailwind af sig selv', () => {
  const eksisterende = policyFor({ origin: 'aura-preview://gammelt/', network: {} });
  assert.equal(allowedRequest({ url: 'https://cdn.tailwindcss.com/3.4.0', resourceType: 'script' }, eksisterende), false);
});

test('den statiske forhåndsvisning tillader unsafe-eval, så Vue og Alpine fra en CDN, brugeren har tilladt, virker, uden at åbne for andre kilder (beta 3)', () => {
  const { contentSecurityPolicy } = require('../core/preview-policy.cjs');
  const csp = contentSecurityPolicy({ origin: 'aura-preview://p/', network: DESIGN_PREVIEW_NETWORK, static: true });
  const script = csp.split(';').find(part => part.trim().startsWith('script-src'));
  assert.match(script, /'unsafe-eval'/); assert.match(script, /https:\/\/cdn\.tailwindcss\.com/); assert.doesNotMatch(script, /cdn\.jsdelivr\.net/, 'kun den faste liste er tilladt'); assert.doesNotMatch(script, /\bhttps:(\s|$)/, 'ingen jokertegn for hele internettet');
});
