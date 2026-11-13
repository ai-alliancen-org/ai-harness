// Beslutning (d), 10. november 2026: en sætning i et felt som password, secret eller api_key er en tekst til læseren, ikke en
// hemmelighed. Fx password: "Adgangskoden er forkert" eller error = { password: 'The password is required' } spærrer ikke
// Gem version, automatiske versioner eller Udgiv. En længere adgangsfrase uden små ord og alt med tal og tegn, der ligner et
// rigtigt kodeord, spærrer stadig.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { secretContent } = require('../core/git.cjs');
const { blockingSecret } = require('../core/secrets.cjs');

const sentences = {
  'dansk fejltekst': 'const fejl = { password: "Adgangskoden er forkert" };',
  'dansk kravtekst': "errors.password = 'Adgangskoden skal være mindst otte tegn';",
  'engelsk fejltekst': "const errors = { password: 'The password is required' };",
  'engelsk hemmelighed': 'secret: "The secret is stored on the server"',
  'API-nøgle i vejledning': 'api_key = "The API key is missing from your account"',
  'apiKey i JSON': '{ "apiKey": "Nøglen er ugyldig, prøv igen" }',
  'overskrift med tegnsætning': 'const message = { password: "Adgangskoden er forkert!" };',
  'spørgsmål': 'const hint = { secret: "Hvad er din hemmelighed?" };',
  'to ord med lille ord': 'const t = { password: "Ikke gyldig adgangskode" };',
  'med bindestreg og apostrof': "const t = { password: \"It's not the e-mail password\" };",
  'access_token i vejledning': 'access_token: "Der er ikke noget token endnu"'
};
// Rigtige værdier, som stadig spærrer.
const secrets = {
  'adgangsfrase uden små ord': 'const password = "correct horse battery staple";',
  'lang adgangsfrase på dansk uden små ord': 'password = "blomst lampe skyfri tredive havn";',
  'kodeord med tal og tegn': 'const password = "Min-kode-er-S3cr3t!";',
  'sætning med tal': 'const secret = "the password is hunter2 for sure";',
  'sætning med tegn': 'const secret = "the pa$$word is here today";',
  'ord med bindestreger, ét ord': 'const password = "correct-horse-battery-staple-extra";',
  'kodeord i store bogstaver': 'const password = "CORRECTHORSEBATTERYSTAPLE";',
  'navngiven nøgle': 'const api_key = "kun-syntetisk-testhemmelighed";',
  'navngivet kodeord': 'const password = "hemmelig-værdi-123";',
  'session-hemmelighed': 'app.use(session({ secret: "my_session_secret_8f3k2Lq" }));',
  'tilfældig streng med små ord i': 'const api_key = "is3Kd9Lq2Xv7Pn4Rt8Wm";',
  'sætning og rigtig nøgle i samme fil': 'const fejl = { password: "Adgangskoden er forkert" };\nconst token = "ghp_' + 'a1B2'.repeat(9) + '";',
  'sætning og kodeord i samme fil': 'const fejl = { password: "Adgangskoden er forkert" };\nconst password = "min-rigtige-kode-9981";'
};

test('en sætning i et kodeords- eller nøglefelt spærrer ikke', () => {
  for (const [name, text] of Object.entries(sentences)) {
    assert.equal(blockingSecret(text), '', name);
    assert.equal(secretContent(text), false, name);
  }
});

test('rigtige værdier og adgangsfraser uden små ord spærrer stadig', () => {
  for (const [name, text] of Object.entries(secrets)) assert.equal(secretContent(text), true, name);
});

test('en sætning skal være hele ord: et lille ord midt i en værdi er ikke nok', () => {
  assert.equal(secretContent('const password = "ersomething-is-hidden"'), true);
  assert.equal(secretContent('const password = "theisofficial"'), true);
  assert.equal(secretContent('const password = "xxxxxxx er xxxxxxx1"'), true, 'ord med tal er ikke en sætning');
});

test('sætningsundtagelsen er lineær i store filer', () => {
  for (const unit of ['password = "Adgangskoden er forkert', 'password: "the is a', 'secret = "er er er er er er', 'api_key = "ord ord ord']) {
    const big = (unit + ' ').repeat(Math.ceil(2 * 1024 * 1024 / (unit.length + 1)));
    const start = process.hrtime.bigint(); secretContent(big);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 1000, `${unit}: ${ms.toFixed(0)} ms`);
  }
  const line = 'password = "' + 'Adgangskoden er forkert '.repeat(80000) + '"';
  const start = process.hrtime.bigint(); secretContent(line);
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 1000, 'en enkelt lang sætning');
});
