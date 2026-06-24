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

test("first valid map starts a new floor immediately", () => {
  const result = evaluateMapTransition({
    floorStart: null,
    lastBase: null,
    lastRoomCount: 0,
    pendingReset: null,
  }, gameMap({ rooms: 1 }), calibration, 10_000);

  assert.equal(result.accept, true);
  assert.equal(result.reset, true);
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
  assert.equal(confirmed.reason, "confirmed-base-change");
});
