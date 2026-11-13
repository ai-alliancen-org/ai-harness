// Fund 23 (beta 3): main.cjs giver aiPreview startStatic med, så et statisk projekt vises med det samme, og AI'en får adressen,
// også når en samtale i baggrunden lige har skrevet public/index.html. Prøven kører main.cjs' egen tekst mod de rigtige moduler.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const desktop = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(desktop, 'main.cjs'), 'utf8');
const cut = (from, to) => { const start = source.indexOf(from), end = source.indexOf(to, start + from.length); if (start < 0 || end < 0) throw Error(`main.cjs mangler: ${from}`); return source.slice(start, end); };

test('fund 23: aura_preview start i et statisk projekt viser siden med det samme og giver AI’en adressen', async () => {
  const root = '/projekt', events = [];
  const ctx = { root, key: 'projekt', owner: { project: { root }, store: { project: async () => ({}) } }, preview: null, externalPreview: null,
    devServer: { state: 'idle', snapshot() { return { state: 'idle', url: null, message: '', output: '' }; }, async status() { return { project: { kind: 'static', supported: false, installed: true, fingerprint: 'f', diagnostics: [] } }; }, async prepare() { throw Error('må ikke kaldes'); } } };
  const spaces = new Map([[root, ctx]]);
  const body = [cut('async function startStatic(root) {', "handle('preview:revision'"), cut('const aiPreview = async', '\n')].join('\n') + '\nreturn aiPreview;';
  const aiPreview = new Function('require', 'spaces', 'spaceFor', 'ownerFor', 'selectSpace', 'openProject', 'previewSession', 'sendEvent', body)(
    name => require(path.join(desktop, name)), spaces, value => spaces.get(value), () => ctx.owner, async () => {}, async () => ({ staticPreview: true }), require(path.join(desktop, 'core/preview-session.cjs')), event => events.push(event));
  const answer = await aiPreview(root, 'start');
  assert.deepEqual([answer.state, answer.url], ['running', 'aura-preview://projekt/']);
  assert.ok(events.some(event => event.type === 'preview.ready' && event.url === 'aura-preview://projekt/'), 'brugerfladen får besked om siden');
});
