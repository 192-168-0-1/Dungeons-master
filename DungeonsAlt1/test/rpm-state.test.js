import assert from "node:assert/strict";
import test from "node:test";
import {
  elapsedFloorMinutes,
  elapsedFloorSeconds,
  evaluateMapTransition,
  floorStartForDetectedMap,
  formatElapsedClock,
  rpmValue,
} from "../src/rpm-state.js";

function gameMap({ rooms, base = { x: 0, y: 0 }, mystery = 0 } = {}) {
  return {
    openedRoomCount: rooms,
    mysteryCount: mystery,
    base,
  };
}

const calibration = Object.freeze({
  x: 100,
  y: 50,
  floor: { name: "Large" },
});

test("floor timer and rpm formatting match the desktop counter baseline", () => {
  const now = 120_000;
  const floorStart = floorStartForDetectedMap(now);
  assert.equal(floorStart, 118_000);
  assert.equal(elapsedFloorSeconds(floorStart, now), 2);
  assert.equal(formatElapsedClock(65), "01:05");
  assert.equal(rpmValue(12, 2), "5.6");
  assert.equal(elapsedFloorMinutes(now, now), 1 / 60);
});

test("late map resets are backdated enough to avoid impossible initial rpm spikes", () => {
  const now = 300_000;
  const singleRoomStart = floorStartForDetectedMap(now, 1);
  assert.equal(singleRoomStart, now - 2_000);

  const lateStart = floorStartForDetectedMap(now, 20);
  const minutes = elapsedFloorMinutes(lateStart, now);
  assert.equal(rpmValue(20, minutes), "8.0");
  assert.ok(now - lateStart > 120_000);
});

test("first valid map starts a new floor immediately", () => {
  const result = evaluateMapTransition({
    floorStart: null,
    lastBase: null,
    lastRoomCount: 0,
    pendingReset: null,
  }, gameMap({ rooms: 1 }), calibration, 10_000);

  assert.equal(result.accept, true);
  assert.equal(result.reset, true);
  assert.equal(result.resetAt, 10_000);
  assert.equal(result.pendingReset, null);
  assert.equal(result.reason, "first-map");
});

test("normal same-floor progress is accepted without resetting rpm", () => {
  const result = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    pendingReset: { key: "old", seenAt: 12_000 },
  }, gameMap({ rooms: 9, base: { x: 0, y: 0 } }), calibration, 20_000);

  assert.equal(result.accept, true);
  assert.equal(result.reset, false);
  assert.equal(result.resetAt, null);
  assert.equal(result.pendingReset, null);
  assert.equal(result.reason, "same-floor");
});

test("single-base false locks do not update displayed rpm until confirmed", () => {
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 20,
    pendingReset: null,
  }, gameMap({ rooms: 1, base: { x: 0, y: 0 } }), calibration, 30_000);

  assert.equal(first.accept, false);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "pending-single-base");
  assert.equal(first.pendingReset.reason, "single-base");

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 20,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 2, base: { x: 0, y: 0 } }), calibration, 30_600);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 30_000);
  assert.equal(confirmed.pendingReset, null);
  assert.equal(confirmed.reason, "confirmed-single-base");
});

test("base changes require a confirmation before resetting the floor timer", () => {
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 32,
    pendingReset: null,
  }, gameMap({ rooms: 6, base: { x: 3, y: 4 } }), calibration, 40_000);

  assert.equal(first.accept, false);
  assert.equal(first.reason, "pending-base-change");

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 32,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 8, base: { x: 3, y: 4 } }), calibration, 41_000);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 40_000);
  assert.equal(confirmed.reason, "confirmed-base-change");
});

test("a new floor reusing the base resets even when the one-room frame is missed", () => {
  // Slow scanner: the 1-room entry frame was never captured, so the first clean
  // read of the new floor already shows 3 rooms, and the new base sits in the
  // same grid cell as the previous floor. Without the room-collapse trigger this
  // slipped through as same-floor and stranded floorStart (the 0.4 rpm bug).
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 2, y: 3 },
    lastRoomCount: 15,
    pendingReset: null,
  }, gameMap({ rooms: 3, base: { x: 2, y: 3 } }), calibration, 60_000);

  assert.equal(first.accept, false);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "pending-single-base");

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 2, y: 3 },
    lastRoomCount: 15,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 3, base: { x: 2, y: 3 } }), calibration, 60_600);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.reason, "confirmed-single-base");
});

test("a minor room-count dip on the same floor is not treated as a new floor", () => {
  // Detection noise that loses a couple of rooms (12 -> 11, far under the
  // half-collapse threshold) must stay same-floor and never reset the timer.
  const result = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 12,
    pendingReset: null,
  }, gameMap({ rooms: 11, base: { x: 0, y: 0 } }), calibration, 20_000);

  assert.equal(result.accept, true);
  assert.equal(result.reset, false);
  assert.equal(result.reason, "same-floor");
});

test("confirmed new floors keep the first-seen pending time for rpm accuracy", () => {
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 18,
    pendingReset: null,
  }, gameMap({ rooms: 1, base: { x: 0, y: 0 } }), calibration, 60_000);

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 18,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 3, base: { x: 0, y: 0 } }), calibration, 62_000);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(floorStartForDetectedMap(confirmed.resetAt), 58_000);
  assert.equal(elapsedFloorSeconds(floorStartForDetectedMap(confirmed.resetAt), 62_000), 4);
});
