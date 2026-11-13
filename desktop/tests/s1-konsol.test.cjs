// Konsolteksten fra projektets processer renses også af det fælles modul core/secrets.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanOutput, appendOutput } = require('../core/dev-server.cjs');

const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const lang = 'Zk9v3Qm1Xp7Lr2Ty8Uw5Nb4Hc6Jd0Ae9S';

test('Authorization-hoved med Bearer, KEY med lang værdi og JWT skjules helt i konsolteksten', () => {
  const tekst = cleanOutput(`Authorization: Bearer ${lang}\nSTRIPE_KEY=${lang}\nfik token ${jwt}\nalmindelig linje`);
  assert.doesNotMatch(tekst, new RegExp(lang)); assert.doesNotMatch(tekst, /eyJhbGci|SflKxw/);
  assert.match(tekst, /almindelig linje/);
});

test('eksisterende rensning bevares, og en harmløs linje står uændret', () => {
  assert.match(cleanOutput('password=hemmeligt1'), /\[skjult\]/);
  assert.doesNotMatch(cleanOutput('https://bruger:kode@vaert.dk/x'), /kode@/);
  assert.equal(cleanOutput('Local: http://localhost:5173/'), 'Local: http://localhost:5173/');
});

test('en meget lang bid renses kun for sin sidste del, og loggen holder sig inden for grænsen', () => {
  const stor = 'a'.repeat(500_000) + ` Authorization: Bearer ${lang}`;
  const log = appendOutput('', stor);
  assert.ok(log.length <= 16000); assert.doesNotMatch(log, new RegExp(lang));
  assert.equal(appendOutput('x', 'y'), 'xy');
});
