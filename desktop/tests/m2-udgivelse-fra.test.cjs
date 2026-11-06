const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guidance } = require('../core/hosting-guidance.cjs');
const { appRules } = require('../core/project-guidance.cjs');
// Årsag 8b: udgivelsesdetaljer sendes kun, når Udgiv er slået til.
test('med Udgiv slået fra sendes ingen udbyderdetaljer', () => {
  const off = guidance(false);
  assert.doesNotMatch(off, /Cloudflare|Promte|Vercel|Azure|GitHub Pages|Netlify/);
  assert.ok(off.length < 400, `kort afsnit, ikke ${off.length} tegn`);
  assert.match(off, /Udgivelse er slået fra/);
  assert.match(off, /Indstillinger → Funktioner/);
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
  assert.ok(on.length - off.length > 1500);
});
