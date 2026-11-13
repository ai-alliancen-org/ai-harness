// Indsat tekst i forbindelsesfelterne renses, så de almindelige kopieringsfejl ikke afvises med misvisende beskeder (årsag 10).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanKey, normalize } = require('../core/connections.cjs');
const nøgle = 'sk-' + 'a'.repeat(30);

test('header- og variabelnavne foran en nøgle fjernes', () => {
  for (const foran of ['api-key: ', 'x-api-key: ', 'X-API-Key: ', 'token=', 'api_key=', 'apikey = ', 'access_token=']) {
    assert.equal(cleanKey(foran + nøgle, 'openai').key, nøgle, JSON.stringify(foran));
  }
});

test('et tomt nøglefelt er fint for en lokal model, mens selve nøglerensningen afviser et tomt felt', () => {
  // Ollama gemmes som serverens rod; /v1 lægges til af gatewayen (ollama-adresse.test.cjs).
  assert.equal(normalize({ kind: 'ollama', name: 'x', baseURL: 'http://localhost:11434/v1', apiKey: '   ' }).baseURL, 'http://localhost:11434');
  assert.throws(() => cleanKey('   ', 'ollama'), /tomt/);
  assert.throws(() => cleanKey('   ', 'openai'), /tomt/);
});

test('en lokal adresse uden http accepteres, og en fuld Azure-adresse bliver til ressourcens adresse', () => {
  assert.equal(normalize({ kind: 'ollama', name: 'x', baseURL: 'localhost:11434', apiKey: '' }).baseURL, 'http://localhost:11434');
  assert.equal(normalize({ kind: 'ollama', name: 'x', baseURL: '127.0.0.1:11434/v1', apiKey: '' }).baseURL, 'http://127.0.0.1:11434');
  const azure = normalize({ kind: 'azure', name: 'x', deployment: 'gpt4', baseURL: 'https://mit.openai.azure.com/openai/deployments/gpt4/chat/completions?api-version=2024-02-01' });
  assert.equal(azure.baseURL, 'https://mit.openai.azure.com/openai/v1');
  assert.throws(() => normalize({ kind: 'azure', name: 'x', deployment: 'gpt4', baseURL: 'https://mit.openai.azure.com?key=skjult' }), /parametre/, 'en hemmelighed i adressen tages ikke tavst af');
});

test('en adresse med login eller en fremmed vært uden http afvises stadig', () => {
  assert.throws(() => normalize({ kind: 'compatible', name: 'x', baseURL: 'http://bruger:kode@server.dk/v1', apiKey: 'a'.repeat(20) }));
  assert.throws(() => normalize({ kind: 'azure', name: 'x', deployment: 'gpt4', baseURL: 'https://ondt.example.com/openai/v1' }));
});
