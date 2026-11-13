// Fund 6: img-src https: må ikke nå loopback eller private adresser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { policyFor, allowedRequest } = require('../core/preview-policy.cjs');

const policy = policyFor({ origin: 'http://127.0.0.1:5173', network: { images: ['https:'] } });
const billede = url => allowedRequest({ url, resourceType: 'image' }, policy);

test('et offentligt billede over https tillades stadig', () => {
  for (const url of ['https://images.example.com/a.png', 'https://8.8.8.8/a.png', 'https://172.32.0.1/a.png', 'https://[2606:4700::1111]/a.png']) assert.equal(billede(url), true, url);
});

test('loopback og private adresser lukkes for billeder', () => {
  for (const url of ['https://localhost/a.png', 'https://localhost./a.png', 'https://app.localhost/a.png', 'https://127.0.0.1/a.png', 'https://127.5.6.7:8443/a.png', 'https://[::1]/a.png',
    'https://10.0.0.5/a.png', 'https://172.16.0.1/a.png', 'https://172.31.255.1/a.png', 'https://192.168.1.10/a.png', 'https://169.254.169.254/latest', 'https://0.0.0.0/a.png',
    'https://[::ffff:127.0.0.1]/a.png', 'https://[::ffff:c0a8:0101]/a.png', 'https://[fd12:3456::1]/a.png', 'https://[fe80::1]/a.png', 'https://2130706433/a.png'])
    assert.equal(billede(url), false, url);
});

test('mediefiler følger samme regel', () => {
  assert.equal(allowedRequest({ url: 'https://192.168.0.2/v.mp4', resourceType: 'media' }, policy), false);
  assert.equal(allowedRequest({ url: 'https://cdn.example.com/v.mp4', resourceType: 'media' }, policy), true);
});
