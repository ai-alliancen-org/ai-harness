const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guidance } = require('../core/hosting-guidance.cjs');
const { appRules } = require('../core/project-guidance.cjs');
// Årsag 8b: udgivelsesdetaljer sendes kun, når Udgiv er slået til. De generelle værn (statiske filer mod servere,
// gratis/EU-påstande, ingen udgivelse fra kommandoværktøjet) sendes altid; målt til 744 tegn i alt uden Udgiv.
test('med Udgiv slået fra sendes ingen udbyderdetaljer', () => {
  const off = guidance(false);
  assert.doesNotMatch(off, /Cloudflare|Promte|Vercel|Azure|GitHub Pages|Netlify/);
  assert.ok(off.length < 800, `kort afsnit, ikke ${off.length} tegn`);
  assert.match(off, /Udgivelse er slået fra/);
  assert.match(off, /Indstillinger → Funktioner/);
  assert.match(off, /Almindelige Python\/Node-servere kan ikke udgives som statiske filer/);
});
test('med Udgiv slået til sendes udbyderdetaljerne som før', () => {
  const on = guidance(true);
  assert.match(on, /Cloudflare Pages/);
  assert.match(on, /Promte Apps/);
  assert.match(on, /Vercel/);
});
test('appreglerne uden Udgiv er kortere end med Udgiv', () => {
  const off = appRules({ deling: false }), on = appRules({ deling: true });
  assert.doesNotMatch(off, /Cloudflare|Promte|Vercel/);
  // Forskellen er udbyderdetaljerne, målt til 1.275 tegn; værnene står i begge.
  assert.ok(on.length - off.length > 1200, `forskel ${on.length - off.length} tegn`);
});
