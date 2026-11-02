// Kommandosandkassen tændes af projektets «Byg og kontrollér automatisk» eller af «Godkend alt i denne samtale».
// En husket kommando tænder den ikke for projektets øvrige opgaver (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commandIsolationFor } = require('../core/chat-session.cjs');

const understøttet = { available: true };
const ikkeUnderstøttet = { available: false };

test('en husket kommando tænder ikke sandkassen for projektets øvrige opgaver', () => {
  // Projektet har en husket bash-regel, men ingen automatisk kørsel og ingen «Godkend alt».
  assert.equal(commandIsolationFor({ support: understøttet, autoCommandsSnapshot: false, approveAll: false }), false);
});

test('sandkassen tændes af projektets automatiske kørsel', () => {
  assert.equal(commandIsolationFor({ support: understøttet, autoCommandsSnapshot: true, approveAll: false }), true);
});

test('sandkassen tændes af «Godkend alt i denne samtale»', () => {
  assert.equal(commandIsolationFor({ support: understøttet, autoCommandsSnapshot: false, approveAll: true }), true);
});

test('uden understøttet sandkasse tændes den aldrig, også ikke af «Godkend alt»', () => {
  assert.equal(commandIsolationFor({ support: ikkeUnderstøttet, autoCommandsSnapshot: true, approveAll: true }), false);
});
