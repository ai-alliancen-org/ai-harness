const { test } = require('node:test');
const assert = require('node:assert/strict');
const { catalog, link } = require('../core/hosting-guidance.cjs');
const { appRules } = require('../core/project-guidance.cjs');

test('hostingvejledninger åbner kun kendte kilder og skelner fra upload', () => {
  const entries = catalog();
  assert.deepEqual(entries.filter(item => item.integrated).map(item => item.id), ['azure-containers', 'azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']);
  assert.deepEqual(entries.filter(item => !item.integrated).map(item => item.id), ['netlify']);
  for (const entry of entries) {
    assert.ok(entry.summary && entry.scope && entry.data && entry.checkedAt);
    for (const kind of Object.keys(entry.links)) assert.equal(new URL(link(entry.id, kind)).protocol, 'https:');
  }
  for (const input of [['vercel', 'constructor'], ['toString', 'guide'], ['vercel', 'https://example.invalid'], ['javascript:alert(1)', 'guide'], ['komplai', 'data']]) {
    assert.throws(() => link(...input), /findes ikke/);
  }
});

test('agentens faktiske appregler beskriver Udgiv og de tilgængelige udgivelsesveje', () => {
  const enabled = appRules({ deling: true });
  assert.match(enabled, /knap Udgiv står øverst/);
  assert.match(enabled, /Azure Container Apps, Azure Static Web Apps, Cloudflare Pages, GitHub Pages, komplai Run, Promte Apps og Vercel/);
  assert.match(enabled, /komplai Run kræver komplai-konto\. Promte Apps kræver konto og betalt aftale/);
  assert.match(enabled, /Netlify Drop har vejledning, men ingen uploadintegration/);
  assert.match(enabled, /Brugeren committer og pusher selv/);
  assert.match(enabled, /Vercel bruger projektets eksisterende Git-integration/);
  assert.match(enabled, /Udgiv starter én konkret kørsel/);
  assert.match(enabled, /Python\/Node-servere kan ikke udgives som statiske filer/);
  const disabled = appRules({ deling: false });
  assert.match(disabled, /Indstillinger → Funktioner/);
  assert.doesNotMatch(disabled, /knap Udgiv står øverst/);
  for (const rules of [enabled, appRules({ deling: false }, { containerPreparation: true })]) {
    assert.match(rules, /KLARGØRING TIL AZURE CONTAINER APPS/);
    assert.match(rules, /Undersøg den eksisterende app først/);
    assert.match(rules, /Dockerfile.*COPY/s);
    assert.match(rules, /0\.0\.0\.0.*PORT.*8080/s);
    assert.match(rules, /\/healthz/);
    assert.match(rules, /server\.cjs.*Node 24 Alpine.*uden ekstra npm-afhængigheder/s);
    assert.match(rules, /filændringer kræver Byg/);
  }
});

test('vejledninger beskriver de faktiske login- og udgivelseskrav uden at anbefale en udbyder', () => {
  const entries = Object.fromEntries(catalog().map(item => [item.id, item]));
  assert.match(entries.azure.steps.join(' '), /Log ind i browseren.*Microsoft-konto.*eksisterende Static Web App/);
  assert.match(entries.vercel.steps.join(' '), /Vercel bygger efter sine Git-regler/);
  assert.match(entries.cloudflare.steps.join(' '), /CLOUDFLARE_API_TOKEN.*Actions secrets/);
  assert.match(entries['github-pages'].steps.join(' '), /standardbranch/);
  assert.match(entries.promte.scope, /React-kildepakke/);
  assert.match(entries.promte.summary, /betalt aftale/);
  assert.match(entries.komplai.summary, /Kræver komplai-konto/);
  assert.doesNotMatch([entries.komplai.summary, ...entries.komplai.steps].join(' '), /betalt|kontakt/i);
  assert.ok(catalog().every(item => !item.recommended && !item.default));
});
