// T:test-chat-feedback: de generelle værn i hostingvejledningen sendes altid; kun udbyderdetaljerne kræver, at Udgiv
// er slået til. R#34: Vercel-teksten nævner begge veje, som Udgiv faktisk tilbyder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guidance } = require('../core/hosting-guidance.cjs');
const { appRules } = require('../core/project-guidance.cjs');

const guards = [
  /Afklar frontend, backend, database, AI-modtagere og adgang før valg/,
  /Almindelige Python\/Node-servere kan ikke udgives som statiske filer/,
  /Sikkerhedskopi til GitHub udgiver ikke i sig selv et applink/,
  /Oplys ikke, at hosting er gratis eller udelukkende i EU/,
  /Region, leverandørens hjemland, CDN, logs og databehandleraftale er forskellige forhold/,
  /du må ikke udgive fra agentens kommandoværktøj/
];

test('de generelle værn sendes, også når Udgiv er slået fra', () => {
  for (const enabled of [false, true]) for (const guard of guards) assert.match(guidance(enabled), guard, `Udgiv ${enabled ? 'til' : 'fra'}: ${guard}`);
  for (const guard of guards) assert.match(appRules({ deling: false }), guard, `appreglerne uden Udgiv: ${guard}`);
});

test('udbyderdetaljerne sendes kun, når Udgiv er slået til', () => {
  assert.doesNotMatch(guidance(false), /Integrerede udgivelsesveje|Netlify Drop har vejledning|Cloudflare|Promte|Vercel|Azure|GitHub Pages/);
  assert.match(guidance(true), /Integrerede udgivelsesveje, alfabetisk: Azure Static Web Apps, Cloudflare Pages, GitHub Pages, komplai Run, Promte Apps og Vercel/);
});

test('Vercel-vejledningen nævner både Git-integrationen og én testversion fra Aura', () => {
  const on = guidance(true);
  assert.doesNotMatch(on, /starter ikke en manuel Vercel-upload/);
  assert.match(on, /Vercel bruger projektets eksisterende Git-integration/);
  assert.match(on, /én testversion/);
  assert.match(on, /aldrig til produktion/);
});
