import assert from "node:assert/strict";
import test from "node:test";
import {
  PARTY_COLORS,
  addPartyMember,
  normalizePartyRoster,
  normalizePartyName,
  normalizeObservedParty,
  observedPartySlot,
  parsePartyRoster,
  partyColor,
  partyTextColor,
  reconcileObservedParty,
  removePartyMember,
} from "../src/party-core.js";

test("party slots use the fixed RuneScape player color order", () => {
  assert.deepEqual(PARTY_COLORS.map((entry) => entry.color), [
    "#e7502b", "#35b7e8", "#52be4c", "#eed340", "#aaafb2",
  ]);
  assert.equal(partyColor(1), "#e7502b");
  assert.equal(partyColor(5), "#aaafb2");
  assert.equal(partyColor(null, "#123456"), "#123456");
  assert.equal(partyTextColor(4), "#171303");
});

test("members are assigned by join order and a sixth member is rejected", () => {
  let roster = [{ id: "leader", name: "Leader", slot: 1 }];
  for (let number = 2; number <= 5; number += 1) {
    const result = addPartyMember(roster, { id: `player${number}`, name: `Player ${number}` });
    assert.equal(result.full, false);
    assert.equal(result.member.slot, number);
    roster = result.roster;
  }

  const full = addPartyMember(roster, { id: "player6", name: "Player 6" });
  assert.equal(full.full, true);
  assert.equal(full.member, null);
  assert.equal(full.roster.length, 5);
});

test("leaving compacts the visible party positions and their colors", () => {
  const roster = [
    { id: "leader", name: "Leader", slot: 1 },
    { id: "second", name: "Second", slot: 2 },
    { id: "third", name: "Third", slot: 3 },
  ];
  assert.deepEqual(removePartyMember(roster, "second"), [
    { id: "leader", name: "Leader", slot: 1 },
    { id: "third", name: "Third", slot: 2 },
  ]);
  assert.equal(partyColor(removePartyMember(roster, "second")[1].slot), "#35b7e8");
});

test("untrusted roster data is normalized before it reaches the UI", () => {
  const roster = normalizePartyRoster([
    { id: "safe-id", name: "  Name  ", slot: 2 },
    { id: "safe-id", name: "Duplicate", slot: 3 },
    { id: "other", name: "Duplicate slot", slot: 2 },
    { id: "bad id!", name: "Clean id", slot: 1 },
    { id: "out", name: "Out", slot: 6 },
  ]);
  assert.deepEqual(roster, [
    { id: "badid", name: "Clean id", slot: 1 },
    { id: "safe-id", name: "Name", slot: 2 },
  ]);
  assert.deepEqual(parsePartyRoster("not-json"), []);
});

test("OCR party names override join order with conservative fuzzy matching", () => {
  const observed = [
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "s If", occupied: true },
  ];
  assert.equal(normalizePartyName("A_Ninja"), "aninja");
  assert.equal(observedPartySlot(observed, "A_Ninja"), 1);
  assert.equal(observedPartySlot(observed, "sIf"), 2);
  assert.equal(observedPartySlot(observed, "A Nlnja"), 1);
  assert.equal(observedPartySlot(observed, "unknown"), null);
  assert.deepEqual(normalizeObservedParty([
    { slot: 2, name: " s If " },
    { slot: 1, name: "A Ninja" },
    { slot: 2, name: "Duplicate slot" },
    { slot: 6, name: "Outside" },
  ]), [
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "s If", occupied: true },
  ]);
});

test("scanned rows are constrained to known team members and canonical names", () => {
  const scanned = Array.from({ length: 5 }, (_, index) => ({
    slot: index + 1,
    occupied: true,
    name: index === 0 ? "k gpwgggmw-" : `garbage ${index}`,
    pixelCount: 20,
  }));
  assert.deepEqual(reconcileObservedParty(scanned, ["X R P"]), [
    { slot: 1, occupied: true, name: "X R P", pixelCount: 20 },
    { slot: 2, occupied: false, name: "", pixelCount: 20 },
    { slot: 3, occupied: false, name: "", pixelCount: 20 },
    { slot: 4, occupied: false, name: "", pixelCount: 20 },
    { slot: 5, occupied: false, name: "", pixelCount: 20 },
  ]);
});


test("scanned unknown party names are kept when another row matches a known member", () => {
  const scanned = [
    { slot: 1, name: "A Ninja", occupied: true, pixelCount: 20 },
    { slot: 2, name: "X R P", occupied: true, pixelCount: 20 },
  ];

  assert.deepEqual(reconcileObservedParty(scanned, ["X R P"]), [
    { slot: 1, occupied: true, name: "A Ninja", pixelCount: 20 },
    { slot: 2, occupied: true, name: "X R P", pixelCount: 20 },
    { slot: 3, occupied: false, name: "", pixelCount: 0 },
    { slot: 4, occupied: false, name: "", pixelCount: 0 },
    { slot: 5, occupied: false, name: "", pixelCount: 0 },
  ]);
});
