// T:test-workspace: i en smal arbejdsflade og ved større tekst står de seks faner på én linje og ruller sidelæns (beslutningen fra
// 3. november). Den valgte fane skal altid kunne ses (DESIGN.md: fanerne må aldrig forsvinde), også når Aura selv vælger den, fx med
// Se Aktivitet eller en filhenvisning, og når fladen bliver smallere. Prøven kører den rigtige ui/workspace.js med en fanestribe,
// der er lagt ud som ved 980 × 720 (300 px synligt og 421 px faner).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspaceUI } = require('./c1-dom.cjs');

test('en fane, Aura vælger uden fokus, rulles helt frem i striben', () => {
  const view = workspaceUI();
  assert.equal(view.visible('activity'), false, 'udgangspunktet: Aktivitet står uden for den synlige del');
  view.workspace.show('activity');
  assert.equal(view.workspace.active, 'activity');
  assert.equal(view.visible('activity'), true, 'Aktivitet står helt synligt efter Se Aktivitet');
  view.workspace.show('preview');
  assert.equal(view.visible('preview'), true, 'Forhåndsvisning står helt synligt igen');
  view.workspace.show('code');
  assert.equal(view.visible('code'), true, 'Kode står helt synligt efter en filhenvisning');
});

test('den valgte fane holdes synlig, når fladen bliver smallere, fx ved zoom eller en bredere samtale', () => {
  const view = workspaceUI();
  view.workspace.show('code');
  assert.equal(view.observers.some(observer => observer.target === view.strip), true, 'Aura holder øje med fanestribens bredde');
  view.resize(200);
  assert.equal(view.visible('code'), true, 'Kode står stadig helt synligt ved 200 px');
  view.resize(320);
  assert.equal(view.visible('code'), true);
});

test('en fane, der allerede kan ses, flytter ikke striben, og en skjult fane rulles der ikke efter', () => {
  const view = workspaceUI();
  view.workspace.show('plan');
  assert.equal(view.strip.scrollLeft, 0, 'Plan står allerede synligt');
  view.$('#tab-plan').hidden = true;
  view.workspace.show('activity'); const before = view.strip.scrollLeft;
  view.workspace.show('plan');
  assert.equal(view.strip.scrollLeft, before, 'en skjult fane flytter ikke striben');
});
