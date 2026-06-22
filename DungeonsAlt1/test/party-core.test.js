import assert from "node:assert/strict";
import test from "node:test";
import {
  PARTY_COLORS,
  addPartyMember,
  automaticPartyRoom,
  automaticPartyRoomStatus,
  isTrustedPartySnapshot,
  mergeObservedPartyCache,
  normalizePartyRoster,
  normalizePartyName,
  normalizeObservedParty,
  observedPartySlot,
  parsePartyRoster,
  partyColor,
  partyRoomCodeFromLeader,
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

test("scanned rows never fabricate the local RSN into slot one", () => {
  const scanned = [
    { slot: 1, occupied: true, name: "", pixelCount: 20 },
    { slot: 2, occupied: true, name: "", pixelCount: 20 },
    { slot: 3, occupied: false, name: "", pixelCount: 0 },
  ];
  assert.deepEqual(reconcileObservedParty(scanned, ["X R P"]), [
    { slot: 1, occupied: true, name: "", pixelCount: 20 },
    { slot: 2, occupied: true, name: "", pixelCount: 20 },
    { slot: 3, occupied: false, name: "", pixelCount: 0 },
    { slot: 4, occupied: false, name: "", pixelCount: 0 },
    { slot: 5, occupied: false, name: "", pixelCount: 0 },
  ]);
});


test("scanned party names are kept even when the local RSN is not present", () => {
  const scanned = [
    { slot: 1, name: "A Ninja", occupied: true, pixelCount: 20 },
    { slot: 2, name: "Elwin", occupied: true, pixelCount: 20 },
  ];

  const reconciled = reconcileObservedParty(scanned, ["X R P"]);
  assert.deepEqual(reconciled, [
    { slot: 1, occupied: true, name: "A Ninja", pixelCount: 20 },
    { slot: 2, occupied: true, name: "Elwin", pixelCount: 20 },
    { slot: 3, occupied: false, name: "", pixelCount: 0 },
    { slot: 4, occupied: false, name: "", pixelCount: 0 },
    { slot: 5, occupied: false, name: "", pixelCount: 0 },
  ]);
  const status = automaticPartyRoomStatus(reconciled, "X R P");
  assert.equal(status.ready, false);
  assert.equal(status.reason, "local-rsn-not-found");
  assert.match(status.message, /RSN "X R P" not found/);
});

test("a local member in slot two joins the leader-derived automatic room", () => {
  const party = reconcileObservedParty([
    { slot: 1, name: "A Ninja", occupied: true, pixelCount: 20 },
    { slot: 2, name: "Elwin", occupied: true, pixelCount: 20 },
  ], ["Elwin"]);

  assert.deepEqual(automaticPartyRoom(party, "elwin"), {
    roomCode: partyRoomCodeFromLeader("A Ninja"),
    leaderName: "A Ninja",
    localSlot: 2,
    members: [
      { slot: 1, name: "A Ninja", occupied: true },
      { slot: 2, name: "Elwin", occupied: true },
    ],
  });
  assert.equal(automaticPartyRoom(party, "ELWIN").roomCode, automaticPartyRoom(party, "Elwin").roomCode);
});

test("leader spelling variants produce one deterministic automatic room", () => {
  assert.equal(partyRoomCodeFromLeader("A Ninja"), partyRoomCodeFromLeader("a_ninja"));
  assert.match(partyRoomCodeFromLeader("A Ninja"), /^DG[A-Z0-9]{8}$/);
  assert.notEqual(partyRoomCodeFromLeader("A Ninja"), partyRoomCodeFromLeader("Other Leader"));

  assert.deepEqual(automaticPartyRoom([
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "X R P", occupied: true },
  ], "x_r_p"), {
    roomCode: partyRoomCodeFromLeader("A Ninja"),
    leaderName: "A Ninja",
    localSlot: 2,
    members: [
      { slot: 1, name: "A Ninja", occupied: true },
      { slot: 2, name: "X R P", occupied: true },
    ],
  });
  assert.equal(automaticPartyRoom([{ slot: 1, name: "A Ninja" }], "A Ninja"), null);
  assert.equal(automaticPartyRoom([
    { slot: 1, name: "A Ninja" },
    { slot: 2, name: "X R P" },
  ], "Unknown"), null);
});

test("party cache fills gaps immediately but confirms removals and conflicts twice", () => {
  const initial = [
    { slot: 1, name: "Leader", occupied: true },
    { slot: 2, name: "Second", occupied: true },
  ];
  const first = mergeObservedPartyCache(initial, [
    { slot: 1, name: "Other", occupied: true },
    { slot: 2, name: "", occupied: true },
    { slot: 3, name: "Third", occupied: true },
  ]);
  assert.deepEqual(first.members, [
    { slot: 1, name: "Leader", occupied: true },
    { slot: 2, name: "Second", occupied: true },
    { slot: 3, name: "Third", occupied: true },
  ]);
  assert.equal(first.pending.get(1).count, 1);

  const confirmedConflict = mergeObservedPartyCache(first.members, [
    { slot: 1, name: "Other", occupied: true },
    { slot: 2, name: "", occupied: true },
    { slot: 3, name: "Third", occupied: true },
  ], first.pending);
  assert.equal(confirmedConflict.members[0].name, "Other");
  assert.equal(confirmedConflict.members[1].name, "Second");

  const firstRemoval = mergeObservedPartyCache(confirmedConflict.members, [
    { slot: 1, name: "Other", occupied: true },
    { slot: 2, name: "", occupied: false },
    { slot: 3, name: "Third", occupied: true },
  ], confirmedConflict.pending);
  assert.equal(firstRemoval.members.some((member) => member.slot === 2), true);
  const confirmedRemoval = mergeObservedPartyCache(firstRemoval.members, [
    { slot: 1, name: "Other", occupied: true },
    { slot: 2, name: "", occupied: false },
    { slot: 3, name: "Third", occupied: true },
  ], firstRemoval.pending);
  assert.equal(confirmedRemoval.members.some((member) => member.slot === 2), false);
});

test("remote party snapshots can fill gaps but cannot overwrite cached names", () => {
  const current = [
    { slot: 1, name: "Leader", occupied: true },
    { slot: 2, name: "Local", occupied: true },
  ];
  const merged = mergeObservedPartyCache(current, [
    { slot: 1, name: "Wrong Leader", occupied: true },
    { slot: 2, name: "Wrong Local", occupied: true },
    { slot: 3, name: "Remote", occupied: true },
  ], new Map(), { source: "remote" });
  assert.deepEqual(merged.members, [
    { slot: 1, name: "Leader", occupied: true },
    { slot: 2, name: "Local", occupied: true },
    { slot: 3, name: "Remote", occupied: true },
  ]);

  assert.equal(isTrustedPartySnapshot(current, [
    { slot: 1, name: "Leader" },
    { slot: 2, name: "Local" },
    { slot: 3, name: "Remote" },
  ], "Local"), true);
  assert.equal(isTrustedPartySnapshot(current, [
    { slot: 1, name: "Wrong Leader" },
    { slot: 2, name: "Local" },
  ], "Local"), false);
  assert.equal(isTrustedPartySnapshot(current, [
    { slot: 1, name: "Leader" },
    { slot: 3, name: "Remote" },
  ], "Local"), false);
});
