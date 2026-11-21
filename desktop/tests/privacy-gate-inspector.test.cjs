// SPDX-License-Identifier: EUPL-1.2
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composePolicy, inspectRequest, PrivacyGate } = require('../core/privacy/index.cjs');
const { findSensitive } = require('../core/privacy/inspector.cjs');
const policy = composePolicy({ organization: { enabled: true, version: 'synthetic-inspection-v1' } });
const body = content => JSON.stringify({ messages: [{ role: 'user', content }] });
const denied = error => error.code === 'PRIVACY_LOCAL_REQUIRED';

test('decoded prose does not confuse JSON escaping with an actual credential', () => {
  for (const content of ['password: \n\nThe field is optional.', 'Example configuration password: ab\ncd']) {
    const packet = body(content);
    assert.ok(findSensitive(packet).some(value => value.kind === 'secret'));
    assert.equal(inspectRequest(packet, policy).hasSecrets, false);
  }
});

test('host privacy-worker paths do not look like opaque media but retain secrets and source provenance', () => {
  const root = '/private/var/folders/bt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/T/aura-native-privacy-AbCdEf/profile';
  const worker = root + '/privacy/workers/' + 'a'.repeat(64) + '/single-workers/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  for (const suffix of ['/workspace', '/workspace. Use only this directory.', '/engine/tmp/opencode', '/workspace/public/index.html']) {
    const path = worker + suffix, packet = body('Work in ' + path);
    const configured = composePolicy({ project: { enabled: true, version: 'runtime-path', protectedSources: [{ path, classification: 'strict' }] } });
    assert.equal(inspectRequest(packet, configured).body, packet);
    assert.equal(inspectRequest(packet, configured).visibleSources[0].classification, 'strict');
  }
  const secret = 'sk-proj-' + 'synthetic'.repeat(4);
  const checked = inspectRequest(body(worker + '/workspace/' + secret), policy);
  assert.equal(checked.hasSecrets, true); assert.doesNotMatch(checked.body, new RegExp(secret));
  assert.throws(() => inspectRequest(body(worker + '/workspace/' + 'A'.repeat(100)), policy), denied);
  const encoded = Buffer.from('person@example.invalid').toString('base64');
  assert.throws(() => inspectRequest(body(worker + '/workspace/' + encoded), policy), denied);
});

test('numeric leaves and original rounded or underflowed wire lexemes are inspected', () => {
  for (const packet of [
    '{"metadata":{"value":1010151234}}', '{"messages":[{"content":[1010151234]}]}',
    '{"tools":[{"arguments":{"value":1010151234}}]}', '{"metadata":{"value":1.010151234e9}}',
  ]) assert.throws(() => inspectRequest(packet, policy), denied);
  const protectedPolicy = composePolicy({ project: { enabled: true, version: 'numeric', protectedValues: [{ value: '123456789123', kind: 'protected' }] } });
  for (const value of ['0.000000000000123456789123456789', '1.23456789123456789123456789123', '0.123456789123e-999', '123456789123e-300']) {
    assert.throws(() => inspectRequest('{"metadata":{"value":' + value + '}}', protectedPolicy), denied);
  }
  for (const value of ['1e400', '9007199254740993', '-9007199254740993']) {
    assert.throws(() => inspectRequest('{"metadata":{"value":' + value + '}}', policy), error => denied(error) && error.details.reason === 'uninspectable_number');
  }
  const packet = '{ "metadata": { "limit": 128000, "temperature": 0.5, "offset": -3, "enabled": true, "empty": null } }';
  assert.equal(inspectRequest(packet, policy).body, packet);
});

test('duplicate JSON members cannot conceal private original wire content', () => {
  for (const packet of [
    '{"metadata":{"note":"person@example.invalid"},"metadata":{"note":"Public"}}',
    '{"messages":[{"content":"person@example.invalid","content":"Public"}]}',
    '{"metadata":{"note":"person@example.invalid","n\\u006fte":"Public"}}',
  ]) assert.throws(() => inspectRequest(packet, policy), error => denied(error) && error.details.reason === 'ambiguous_json_member');
  const separateObjects = '{ "messages": [{"content":"Public", "metadata":{"count":1}}, {"content":"Public", "metadata":{"count":2}}] }';
  assert.equal(inspectRequest(separateObjects, policy).body, separateObjects);
});

test('stricter exact protected rules are not swallowed by a permitted larger finding', () => {
  for (const [content, value, permissions] of [
    ['hidden@example.invalid', 'hidden', { allowPersonalData: true }],
    ['password=protected-synthetic-value', 'synthetic', { allowSecrets: true }],
    ['Hidden Person', 'Person', { allowPersonalData: true }],
  ]) {
    const configured = composePolicy({ project: { enabled: true, version: 'nested-protection', ...permissions,
      protectedValues: [{ value, kind: 'protected' }, ...(content === 'Hidden Person' ? [{ value: content, kind: 'person' }] : [])] } });
    const checked = inspectRequest(body(content), configured);
    assert.equal(checked.changed, true);
    assert.equal(checked.body.includes(value), false);
    assert.ok(checked.findings.some(item => item.kind === 'protected'));
  }
});

test('overlapping redaction intervals are combined without shifted offsets or exposed fragments', () => {
  const configured = composePolicy({ project: { enabled: true, version: 'overlap', protectedValues: [
    { value: 'ALPHA BETA', kind: 'person' }, { value: 'BETA GAMMA', kind: 'protected' },
  ] } });
  const checked = inspectRequest(body('Before ALPHA BETA GAMMA after.'), configured);
  assert.equal(JSON.parse(checked.body).messages[0].content, 'Before PROTECTED_1 after.');
});

test('nested encodings never make personal data or configured protection safe to send', () => {
  const base64 = text => Buffer.from(text).toString('base64');
  const hex = text => Buffer.from(text).toString('hex');
  const percent = text => [...text].map(char => '%' + char.charCodeAt(0).toString(16)).join('');
  for (const original of ['a@b.dk', '0101001234', 'PRIVATE_CANARY']) {
    const configured = composePolicy({ project: { enabled: true, version: 'nested-encoding', protectedValues: [{ value: 'PRIVATE_CANARY', kind: 'protected' }] } });
    for (const encoded of [base64(base64(original)), base64(hex(original)), hex(base64(original)), percent(base64(original)), base64(percent(original))]) {
      assert.throws(() => inspectRequest(body(encoded), configured), denied);
    }
  }
});

test('literal percentage and Python format notation do not hide actual percent-encoded secrets', () => {
  const configured = composePolicy({ project: { enabled: true, version: 'percent-code', defaultClass: 'public' } });
  for (const value of ["return '#%02x%02x%02x' % values", "width: 100%; color: %23ffffff", 'A literal percent % and a UTF-8 name %C3%A6']) assert.doesNotThrow(() => inspectRequest(body(value), configured));
  for (const value of ['100% and alice%40example.invalid', "'#%02x' % values; alice%2540example.invalid", '100% and %C3%28']) assert.throws(() => inspectRequest(body(value), configured), denied);
});

test('exact built-in public reference paths are not opaque; suffixes, unknown URLs and source labels remain inspected', async () => {
  const reference = 'https://digst.dk/kunstig-intelligens/guides-til-brug-af-kunstig-intelligens/guide-offentlige-myndigheder/';
  for (const value of [reference, 'Read (' + reference + ').', JSON.stringify({ content: reference + '\nNext paragraph.' })]) assert.equal(inspectRequest(body(value), policy).changed, false);
  for (const value of [reference + '?token=unknown', reference + '/extra', reference.replace('digst.dk', 'other.invalid'), reference + Buffer.from('alice@example.invalid').toString('base64')]) assert.throws(() => inspectRequest(body(value), policy), denied);
  assert.throws(() => inspectRequest(JSON.stringify({ input: [{ type: 'input_image', image_url: reference }] }), policy), denied);
  const encoded = Buffer.from('alice@example.invalid').toString('base64');
  assert.throws(() => inspectRequest(body(reference + ' ' + encoded), policy), denied);
  const checked = inspectRequest(body(reference + ' Contact alice@example.invalid.'), policy);
  assert.equal(checked.changed, true); assert.doesNotMatch(checked.body, /alice@example/);
  const source = 'kunstig-intelligens/guides-til-brug-af-kunstig-intelligens', layers = { organization: { enabled: true, version: 'public-reference-source', allowedDestinationIds: ['cloud'], defaultClass: 'public', protectedSources: [{ path: source, classification: 'strict' }] } };
  assert.equal(inspectRequest(body(reference), composePolicy(layers)).visibleSources.length, 1);
  let sent = 0;
  const gate = new PrivacyGate({ getPolicy: () => layers, resolveDestination: () => ({ id: 'cloud', locality: 'cloud', model: 'synthetic', endpoint: 'https://synthetic.invalid' }) });
  await assert.rejects(gate.executeAction({ scope: {}, destinationRef: 'cloud', purpose: 'test', contextPartition: 'external', revision: 1, body: body(reference), assertCurrent: () => true, transport: () => { sent++; } }), denied);
  assert.equal(sent, 0);
});

test('the shipped skill references are inspectable without suppressing their actual sensitivity findings', async () => {
  const library = await require('../core/library.cjs').loadLibrary(require('node:path').resolve(__dirname, '../../profiles'));
  let count = 0;
  for (const skill of library.skills) for (const file of skill.files) {
    const checked = inspectRequest(body(JSON.stringify({ path: '.aura-skills/' + skill.name + '/' + file.path, content: file.content })), policy);
    if (skill.name === 'harness-integration-adresser' && file.path === 'references/datafordeleren.md') assert.equal(checked.hasSecrets, true, 'the literal apiKey example is still detected, never globally exempted');
    count++;
  }
  assert(count > 0, 'the current main library must supply actual skill files');
});

test('encoded and normalized protected source paths remain additive strict provenance', async () => {
  const sourcePath = 'private/cases.csv';
  const raw = { organization: { enabled: true, version: 'path-protection', allowedDestinationIds: ['cloud'], defaultClass: 'public', protectedSources: [{ path: sourcePath, classification: 'strict' }] } };
  const configured = composePolicy(raw); let sent = 0;
  const gate = new PrivacyGate({ getPolicy: () => raw, resolveDestination: () => ({ id: 'cloud', locality: 'cloud', model: 'synthetic', endpoint: 'https://synthetic.invalid' }) });
  for (const text of ['private%2Fcases.csv', 'private%252Fcases.csv', Buffer.from(sourcePath).toString('base64'), Buffer.from(sourcePath).toString('hex'), 'ｐｒｉｖａｔｅ/ｃａｓｅｓ.csv', 'PRIVATE/CASES.CSV', Buffer.from(Buffer.from(sourcePath).toString('base64')).toString('base64')]) {
    const packet = body('Use this source: ' + text);
    assert.equal(inspectRequest(packet, configured).visibleSources.length, 1);
    await assert.rejects(gate.executeAction({ scope: { root: '/synthetic' }, destinationRef: 'cloud', purpose: 'test', contextPartition: 'external', revision: 1, body: packet, assertCurrent: () => true, transport: () => { sent++; } }), denied);
  }
  assert.equal(sent, 0);
});

test('omitted upper-level permissions remain a ceiling rather than lower-level grants', () => {
  const composed = composePolicy({ organization: { enabled: true, version: 'organization' }, project: {
    version: 'project', allowedDestinationIds: ['cloud'], maxClass: 'confidential', defaultClass: 'public',
    allowPersonalData: true, allowSecrets: true, allowConfidentialRelease: true,
  } });
  assert.equal(composed.allowedDestinationIds, null);
  assert.equal(composed.maxClass, 'internal');
  assert.equal(composed.defaultClass, 'internal');
  assert.equal(composed.allowPersonalData, false);
  assert.equal(composed.allowSecrets, false);
  assert.equal(composed.allowConfidentialRelease, false);
  const standalone = composePolicy({ project: { enabled: true, version: 'project-only', allowedDestinationIds: ['cloud'], maxClass: 'confidential', defaultClass: 'public', allowPersonalData: true } });
  assert.deepEqual(standalone.allowedDestinationIds, ['cloud']);
  assert.equal(standalone.maxClass, 'confidential');
  assert.equal(standalone.defaultClass, 'public');
  assert.equal(standalone.allowPersonalData, true);
});

test('invalid revision identities cannot authorize external work', async () => {
  let sent = 0;
  const gate = new PrivacyGate({ getPolicy: () => ({ project: { enabled: true, version: 'test', allowedDestinationIds: ['cloud'] } }), resolveDestination: () => ({ id: 'cloud', locality: 'cloud', model: 'synthetic', endpoint: 'https://synthetic.invalid' }) });
  for (const revision of [NaN, Infinity, -1, 0.5, '', 'a'.repeat(301), null]) {
    await assert.rejects(gate.executeAction({ scope: {}, destinationRef: 'cloud', purpose: 'test', contextPartition: 'external', revision, body: body('Public task.'), assertCurrent: () => true, transport: () => { sent++; } }), { code: 'PRIVACY_CONTROL_FAILED' });
  }
  assert.equal(sent, 0);
});
