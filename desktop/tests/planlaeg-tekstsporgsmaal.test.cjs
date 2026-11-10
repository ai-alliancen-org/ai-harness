// Q:C2-5 (c): i Planlæg får et svar, der kun stiller brugeren et spørgsmål i almindelig tekst (uden question-værktøjet),
// ikke «Byg videre». README: «Et byggeforslag uden genkendelige afsnit kan få Byg videre ...; et nej eller et åbent spørgsmål
// giver ikke knappen.» Et byggeforslag uden spørgsmål og et svar, der ligner en plan, får stadig knappen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-planlaeg-spoergsmaal-')));
  const engines = [], events = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit: event => events.push(event), engineFactory: options => {
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Planlæg' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  let answers = 0;
  // Én opgave i Planlæg, der slutter med AI'ens svar. Resultatkortets oplysninger kommer fra ChatSession (run.review).
  const svar = async reply => {
    const text = 'Lav en side til vores lokaler.';
    const review = await bench.prepare({ connectionID: connection.id, modelID: 'test', mode: 'plan', text });
    await bench.send({ text, fingerprint: review.fingerprint, contextBinding: review.contextBinding });
    const chat = bench.chat, id = `svar-${++answers}`;
    chat.runRoles.set(id, 'assistant'); chat.runText.set(id, { id, messageID: id, text: reply });
    const before = events.length;
    chat.event({ type: 'session.idle' }); await chat.finishing;
    return events.slice(before).find(event => event.type === 'run.review');
  };
  return { svar };
}

test('et rent tekstspørgsmål i Planlæg giver ikke Byg videre', async t => {
  const f = await fixture(t);
  for (const reply of ['Hvem skal bruge siden?', 'Før jeg laver planen, har jeg brug for at vide lidt mere:\n\n1. Hvem skal bruge siden?\n2. Skal man kunne booke lokalerne?\n\nNår jeg kender svarene, laver jeg planen.']) {
    const review = await f.svar(reply);
    assert.equal(review?.answered, true);
    assert.equal(review?.buildOffer, false, `ingen Byg videre for: ${reply.split('\n')[0]}`);
  }
});

test('et byggeforslag uden spørgsmål og et svar, der ligner en plan, får stadig Byg videre', async t => {
  const f = await fixture(t);
  for (const reply of ['Jeg foreslår en enkel side med en liste over lokalerne og en knap til at booke hvert lokale.', '## Det bygger vi\nEn liste over lokaler.\n## Sådan skal det se ud\nRolig og enkel.\n\nSkal der også være login?']) {
    const review = await f.svar(reply);
    assert.equal(review?.buildOffer, true, `Byg videre for: ${reply.split('\n')[0]}`);
  }
});

// Skeptikerens fund efter G1 og G2: et byggeforslag, der slutter med at spørge, om AI'en må gå i gang, er netop det tilfælde, Byg videre
// er lavet til (README: «Et byggeforslag uden genkendelige afsnit kan få Byg videre»). Et spørgsmål om at bygge er ikke et åbent spørgsmål.
// Stiller svaret også et spørgsmål, brugeren skal svare på, er det stadig åbent.
test('et byggeforslag, der spørger, om AI’en må gå i gang, får Byg videre; et forslag med et åbent spørgsmål gør ikke', async t => {
  const f = await fixture(t);
  for (const reply of [
    'Jeg foreslår en enkel side med en liste over lokalerne og en knap til at booke hvert lokale. Skal jeg gå i gang?',
    'Jeg foreslår en enkel side med en liste over lokalerne.\n\nVil du have, at jeg bygger den nu?',
    'Forslag: en side med lokalerne og en bookingknap.\n\nSkal jeg bygge den?',
    'Jeg laver en liste over lokalerne med en bookingknap. Er det i orden, at jeg går videre med det?'
  ]) {
    const review = await f.svar(reply);
    assert.equal(review?.buildOffer, true, `Byg videre for: ${reply.split('\n').at(-1)}`);
  }
  for (const reply of [
    'Jeg foreslår en side med lokalerne.\n\nHvem skal bruge siden? Skal jeg gå i gang bagefter?',
    'Jeg foreslår en side med lokalerne.\n\nSkal man kunne booke lokalerne?\n\nSkal jeg gå i gang?',
    'Jeg foreslår en side med lokalerne.\n\nHvad skal jeg bygge først, listen eller bookingen?',
    'Jeg foreslår en side med lokalerne. Skal man kunne booke dem? Skal jeg gå i gang?'
  ]) {
    const review = await f.svar(reply);
    assert.equal(review?.buildOffer, false, `ingen Byg videre for: ${reply.replace(/\n+/g, ' ')}`);
  }
});
