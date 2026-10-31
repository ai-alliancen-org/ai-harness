// Nøglevinduet kan svare, efter brugeren har lukket dialogen i Sikkerhedskopi. Så må intet skrives i den lukkede
// dialog. Prøven kører den faktiske ui/hosting.js i en lille DOM og fastholder, at nøglevinduet FAKTISK blev kaldt,
// før dialogen lukkes: uden den påstand ville prøven også bestå, hvis keyGithub aldrig blev nået, og så målte den
// den forkerte gren. Attrappen opretter et element for enhver selector og kan derfor ikke se, om knappen findes i
// brugerfladen. Derfor kontrolleres de id'er, vagten hviler på, direkte i index.html.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const kilde = fs.readFileSync(path.join(__dirname, '../ui/hosting.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const ro = () => new Promise(klar => setImmediate(klar));

class El {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.hidden = false; this.text = ''; this.value = ''; }
  get textContent() { return this.text; }
  set textContent(value) { this.text = value; }
  replaceChildren(...items) { this.children = items; }
  append(...items) { this.children.push(...items); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  showModal() { this.open = true; }
  close() { this.open = false; for (const fn of this.listeners.close || []) fn(); }
  focus() {} scrollIntoView() {}
}

function miljoe(harness) {
  const elementer = new Map();
  const find = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  const document = { querySelector: find, createElement: tag => new El(tag) };
  const context = { document, setTimeout, clearTimeout, Option: function Option() {} };
  context.window = { harness, ShareView: { scope: () => '', version: () => '', time: () => '' } };
  vm.createContext(context);
  vm.runInContext(kilde, context);
  return find;
}

// Åbner dialogen og venter, til den første hostingState er færdig.
async function aaben(find) { find('#publish-button').onclick(); await ro(); }

function attrap() {
  const tal = { state: 0, noegle: 0 };
  let afgoer = null;
  const harness = {
    hostingState: async () => { tal.state++; return { ok: true, value: { connected: true, login: 'testbruger', publication: {}, context: {} } }; },
    hostingCancel: async () => ({ ok: true, value: null }),
    keyGithub: () => { tal.noegle++; return new Promise(klar => { afgoer = klar; }); },
  };
  return { harness, tal, svar: value => afgoer({ ok: true, value }) };
}

test('et sent svar fra nøglevinduet skriver ikke i en lukket dialog', async () => {
  const { harness, tal, svar } = attrap();
  const find = miljoe(harness);
  await aaben(find);
  assert.equal(tal.state, 1, 'dialogen hentede status ved åbning');

  find('#hosting-key').onclick();
  for (let forsoeg = 0; forsoeg < 20 && !tal.noegle; forsoeg++) await ro();
  // Uden denne påstand kunne prøven bestå, fordi nøglevinduet aldrig blev åbnet.
  assert.equal(tal.noegle, 1, 'nøglevinduet blev faktisk kaldt, før dialogen lukkes');

  find('#hosting-dialog').close();
  svar({ login: 'testbruger' });
  await ro(); await ro();

  assert.equal(find('#hosting-feedback').textContent, '', 'ingen kvittering i en lukket dialog');
  assert.equal(tal.state, 1, 'ingen ny statushentning efter lukningen');
  assert.equal(find('#hosting-body').disabled, true, 'det lukkede felt genaktiveres ikke');
});

test('med dialogen åben skriver nøglevinduets svar stadig kvitteringen', async () => {
  const { harness, tal, svar } = attrap();
  const find = miljoe(harness);
  await aaben(find);

  find('#hosting-key').onclick();
  for (let forsoeg = 0; forsoeg < 20 && !tal.noegle; forsoeg++) await ro();
  svar({ login: 'testbruger' });
  await ro(); await ro();

  assert.equal(find('#hosting-feedback').textContent, 'Konto kontrolleret og adgang gemt krypteret.');
  assert.equal(tal.state, 2, 'statussen hentes igen, så kontoen vises opdateret');
  assert.equal(find('#hosting-body').disabled, false);
});

test('de id-er, lukningsvagten hviler på, findes i brugerfladen', () => {
  for (const id of ['hosting-dialog', 'hosting-key', 'hosting-feedback', 'hosting-body', 'publish-button']) {
    assert.ok(markup.includes(`id="${id}"`), `${id} mangler i ui/index.html`);
  }
});
