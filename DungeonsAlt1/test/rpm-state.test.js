import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FLOOR_TARGET_SECONDS,
  DEFAULT_PREDICTED_FLOOR_ROOMS,
  elapsedFloorMinutes,
  elapsedFloorSeconds,
  evaluateMapTransition,
  floorPredictionRoomTarget,
  floorPaceStatus,
  floorStartForDetectedMap,
  formatElapsedClock,
  mapTopologyDiscontinuity,
  parseFloorTargetSeconds,
  projectedFloorSecondsForRoomTarget,
  rpmValue,
  trackedBaseAfterTransition,
} from "../src/rpm-state.js";

function gameMap({ rooms, base = { x: 0, y: 0 }, mystery = 0, roomTypes = null } = {}) {
  return {
    openedRoomCount: rooms,
    mysteryCount: mystery,
    base,
    roomTypes,
  };
}

function topology(indices, size = 64) {
  const roomTypes = new Array(size).fill(0);
  for (const index of indices) roomTypes[index] = 1;
  return roomTypes;
}

test("map topology distinguishes a classifier subset from a different floor", () => {
  const previous = gameMap({ rooms: 8, roomTypes: topology([...Array(8).keys()]) });
  assert.equal(mapTopologyDiscontinuity(previous,
    gameMap({ rooms: 5, roomTypes: topology([0, 1, 2, 3, 4]) })), false);
  assert.equal(mapTopologyDiscontinuity(previous,
    gameMap({ rooms: 5, roomTypes: topology([20, 21, 22, 23, 24]) })), true);
});

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

test("floor pace target parses mm:ss and plain seconds, else falls back", () => {
  assert.equal(parseFloorTargetSeconds("6:15"), 375);
  assert.equal(parseFloorTargetSeconds("10:00"), 600);
  assert.equal(parseFloorTargetSeconds("90"), 90);
  assert.equal(parseFloorTargetSeconds("6.15"), 375);
  assert.equal(parseFloorTargetSeconds("6,15"), 375);
  assert.equal(parseFloorTargetSeconds("6"), DEFAULT_FLOOR_TARGET_SECONDS);
  assert.equal(parseFloorTargetSeconds("6.5"), DEFAULT_FLOOR_TARGET_SECONDS);
  assert.equal(parseFloorTargetSeconds("615"), 615);
  assert.equal(parseFloorTargetSeconds(""), DEFAULT_FLOOR_TARGET_SECONDS);
  assert.equal(parseFloorTargetSeconds("6:99"), DEFAULT_FLOOR_TARGET_SECONDS);
  assert.equal(parseFloorTargetSeconds("nonsense"), DEFAULT_FLOOR_TARGET_SECONDS);
});

test("floor pace projects the known floor onto the target time", () => {
  // Not enough progress yet -> no tint.
  assert.equal(floorPaceStatus({ openedRooms: 1, possibleRooms: 4, minutes: 1 }).status, "none");
  // Fast start, whole known floor projects well under 6:15 -> ahead.
  assert.equal(floorPaceStatus({ openedRooms: 5, possibleRooms: 5, minutes: 0.5, targetSeconds: 375 }).status, "ahead");
  // Projects a little over target (~7:12) -> close.
  assert.equal(floorPaceStatus({ openedRooms: 5, possibleRooms: 6, minutes: 6, targetSeconds: 375 }).status, "close");
  // Slow with lots still to open (~10:40 projected) -> behind.
  assert.equal(floorPaceStatus({ openedRooms: 3, possibleRooms: 8, minutes: 4, targetSeconds: 375 }).status, "behind");
});

test("the enriched unexplored denominator raises the early-floor projection", () => {
  // Doors into empty cells widen possibleRooms (2 opened, 8 known) so the
  // 1-minute pace projects a full 4:00 finish instead of tracking elapsed time.
  // Under the 6:15 default target (375s) that projects "ahead".
  const pace = floorPaceStatus({ openedRooms: 2, possibleRooms: 8, minutes: 1 });
  assert.equal(pace.projectedSeconds, 240);
  assert.equal(pace.status, "ahead");
});

test("predicted finish time extrapolates live room pace to the 55-58 room midpoint", () => {
  assert.equal(DEFAULT_PREDICTED_FLOOR_ROOMS, 56.5);

  // The existing dg-map projection is elapsed * target / opened.
  // Reaching 56.5 rooms from 12 rooms in 2 minutes projects to 565 seconds.
  assert.equal(projectedFloorSecondsForRoomTarget({
    openedRooms: 12,
    minutes: 2,
  }), 565);

  const pace = floorPaceStatus({
    openedRooms: 12,
    possibleRooms: DEFAULT_PREDICTED_FLOOR_ROOMS,
    minutes: 2,
    targetSeconds: 375,
  });
  assert.equal(pace.projectedSeconds, 565);
  assert.equal(pace.status, "behind");

  // The requested range brackets the midpoint prediction without changing the
  // live room count or RPM calculation.
  assert.equal(projectedFloorSecondsForRoomTarget({
    openedRooms: 12,
    minutes: 2,
    targetRooms: 55,
  }), 550);
  assert.equal(projectedFloorSecondsForRoomTarget({
    openedRooms: 12,
    minutes: 2,
    targetRooms: 58,
  }), 580);
});

test("the 56.5 room target applies only to Large floors", () => {
  assert.equal(floorPredictionRoomTarget({
    floorName: "Large",
    openedRooms: 12,
    knownRooms: 18,
  }), 56.5);
  assert.equal(floorPredictionRoomTarget({
    floorName: "large",
    openedRooms: 60,
    knownRooms: 62,
  }), 60);
  assert.equal(floorPredictionRoomTarget({
    floorName: "Medium",
    openedRooms: 12,
    knownRooms: 27,
  }), 27);
  assert.equal(floorPredictionRoomTarget({
    floorName: "Small",
    openedRooms: 15,
    knownRooms: 13,
  }), 15);
});

test("room-target prediction waits for progress and never predicts into the past", () => {
  assert.equal(projectedFloorSecondsForRoomTarget({ openedRooms: 1, minutes: 1 }), 0);
  assert.equal(projectedFloorSecondsForRoomTarget({ openedRooms: 60, minutes: 7 }), 420);
  assert.equal(projectedFloorSecondsForRoomTarget({
    openedRooms: 12,
    minutes: 2,
    targetRooms: "invalid",
  }), 565);
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
  assert.equal(result.resetRoomCount, 1);
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
  const previousMap = gameMap({ rooms: 20, base: { x: 0, y: 0 }, roomTypes: topology([...Array(20).keys()]) });
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 20,
    lastGameMap: previousMap,
    pendingReset: null,
  }, gameMap({ rooms: 1, base: { x: 0, y: 0 }, roomTypes: topology([30]) }), calibration, 30_000);

  assert.equal(first.accept, false);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "pending-single-base");
  assert.equal(first.pendingReset.reason, "single-base");

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 20,
    lastGameMap: previousMap,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 2, base: { x: 0, y: 0 }, roomTypes: topology([30, 31]) }), calibration, 30_600);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 30_000);
  assert.equal(confirmed.resetRoomCount, 1);
  assert.equal(confirmed.pendingReset, null);
  assert.equal(confirmed.reason, "confirmed-single-base");
});

test("an unreadable base cannot confirm a single-base false lock during an active floor", () => {
  const previousMap = gameMap({ rooms: 15, base: { x: 0, y: 0 }, roomTypes: topology([...Array(15).keys()]) });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    lastGameMap: previousMap,
    awaitingNewFloor: false,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 1, base: { x: 0, y: 0 }, roomTypes: topology([30]) }), calibration, 30_000);
  const unreadableBase = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset },
    gameMap({ rooms: 2, base: null, roomTypes: topology([30, 31]) }), calibration, 30_600);

  assert.equal(first.reason, "pending-single-base");
  assert.equal(unreadableBase.reset, false);
  assert.notEqual(unreadableBase.reason, "confirmed-single-base");
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
  assert.equal(confirmed.resetRoomCount, 6);
  assert.equal(confirmed.reason, "confirmed-base-change");
});

test("a new floor reusing the base resets even when the one-room frame is missed", () => {
  // Slow scanner: the 1-room entry frame was never captured, so the first clean
  // read of the new floor already shows 3 rooms, and the new base sits in the
  // same grid cell as the previous floor. Without the room-collapse trigger this
  // slipped through as same-floor and stranded floorStart (the 0.4 rpm bug).
  const oldTopology = topology([...Array(15).keys()]);
  const newTopology = topology([20, 21, 22]);
  const previousMap = gameMap({ rooms: 15, base: { x: 2, y: 3 }, roomTypes: oldTopology });
  const nextMap = gameMap({ rooms: 3, base: { x: 2, y: 3 }, roomTypes: newTopology });
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 2, y: 3 },
    lastRoomCount: 15,
    lastGameMap: previousMap,
    pendingReset: null,
  }, nextMap, calibration, 60_000);

  assert.equal(first.accept, false);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "pending-room-regression");

  const middle = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 2, y: 3 },
    lastRoomCount: 15,
    lastGameMap: previousMap,
    pendingReset: first.pendingReset,
  }, nextMap, calibration, 60_600);
  assert.equal(middle.reset, false);

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 2, y: 3 },
    lastRoomCount: 15,
    lastGameMap: previousMap,
    pendingReset: middle.pendingReset,
  }, nextMap, calibration, 62_500);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.resetRoomCount, 3);
  assert.equal(confirmed.reason, "confirmed-room-collapse");
});

test("a new floor whose base is not yet readable still confirms and resets", () => {
  // The first seconds of a new floor often read rooms but no base marker. An
  // empty pending key made samePending permanently false, freezing the accepted
  // map (and the 55-room overlay of the previous floor) indefinitely.
  const priorTopology = topology([...Array(55).keys()], 128);
  const firstTopology = topology([...Array(8).keys()].map((index) => index + 64), 128);
  const nextTopology = topology([...Array(10).keys()].map((index) => index + 64), 128);
  const priorMap = gameMap({ rooms: 55, base: { x: 5, y: 5 }, roomTypes: priorTopology });
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 55,
    lastGameMap: priorMap,
    pendingReset: null,
  }, gameMap({ rooms: 8, base: null, roomTypes: firstTopology }), calibration, 60_000);
  assert.equal(first.accept, false);
  assert.ok(first.pendingReset.key.length > 0);

  const middle = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 55,
    lastGameMap: priorMap,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 8, base: null, roomTypes: firstTopology }), calibration, 61_200);
  assert.equal(middle.reset, false);

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 55,
    lastGameMap: priorMap,
    pendingReset: middle.pendingReset,
  }, gameMap({ rooms: 10, base: null, roomTypes: nextTopology }), calibration, 62_500);
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.resetRoomCount, 8);
});

test("a base-less reset forgets the previous floor base before the new base appears", () => {
  const previousBase = { x: 5, y: 5 };
  assert.equal(trackedBaseAfterTransition(previousBase, null, true), null);
  assert.deepEqual(trackedBaseAfterTransition(previousBase, null, false), previousBase);

  const newBase = { x: 2, y: 2 };
  assert.equal(trackedBaseAfterTransition(previousBase, newBase, true), newBase);
  const afterReset = evaluateMapTransition({
    floorStart: 58_000,
    lastBase: trackedBaseAfterTransition(previousBase, null, true),
    lastRoomCount: 10,
    pendingReset: null,
  }, gameMap({ rooms: 12, base: newBase }), calibration, 62_000);

  assert.equal(afterReset.accept, true);
  assert.equal(afterReset.reset, false);
  assert.equal(afterReset.reason, "same-floor");
});

test("a results-screen latch holds an identical map until new-floor progress is confirmed", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastFloorName: "Large",
    mapGapMs: 2_500,
    awaitingNewFloor: true,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 8, base: { x: 0, y: 0 } }), calibration, 60_000);

  assert.equal(first.accept, false);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "pending-results-lifecycle");

  const oneRoom = evaluateMapTransition({ ...previous, mapGapMs: 0, pendingReset: first.pendingReset },
    gameMap({ rooms: 9, base: { x: 0, y: 0 } }), calibration, 60_600);
  assert.equal(oneRoom.accept, false);
  assert.equal(oneRoom.reset, false);

  const confirmed = evaluateMapTransition({ ...previous, mapGapMs: 0, pendingReset: oneRoom.pendingReset },
    gameMap({ rooms: 10, base: { x: 0, y: 0 } }), calibration, 61_200);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.pendingReset, null);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.resetRoomCount, 8);
  assert.equal(confirmed.reason, "confirmed-results-lifecycle");
});

test("a closed results screen confirms a stable one-room base on the second map frame", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: true,
  };
  const oneRoom = gameMap({ rooms: 1, base: { x: 0, y: 0 } });

  const behindResults = evaluateMapTransition(
    previous,
    oneRoom,
    { ...calibration, x: 100, y: 200 },
    60_000,
  );
  assert.equal(behindResults.accept, false);
  assert.equal(behindResults.reset, false);
  assert.equal(behindResults.reason, "pending-results-lifecycle");

  const stillBehindResults = evaluateMapTransition({
    ...previous,
    pendingReset: behindResults.pendingReset,
  }, oneRoom, { ...calibration, x: 101, y: 200 }, 60_300);
  assert.equal(stillBehindResults.accept, false);
  assert.equal(stillBehindResults.reset, false);
  assert.equal(stillBehindResults.reason, "pending-results-lifecycle");

  const firstAfterClose = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: stillBehindResults.pendingReset,
  }, oneRoom, { ...calibration, x: 101, y: 200 }, 60_600);
  assert.equal(firstAfterClose.accept, false);
  assert.equal(firstAfterClose.reason, "pending-single-base");

  const confirmed = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: firstAfterClose.pendingReset,
  }, oneRoom, { ...calibration, x: 100, y: 201 }, 61_200);
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.reason, "confirmed-single-base");
  assert.equal(confirmed.resetAt, 60_600);
  assert.equal(confirmed.resetRoomCount, 1);
});

test("fresh negative sentinel and three stable new-map frames override a stale results capture", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: true,
    resultsSentinelAbsent: true,
  };
  const nextMap = gameMap({ rooms: 1, base: { x: 0, y: 0 } });
  const first = evaluateMapTransition(previous, nextMap,
    { ...calibration, x: 100, y: 200 }, 60_000);
  const second = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset }, nextMap,
    { ...calibration, x: 101, y: 200 }, 60_600);
  const third = evaluateMapTransition({ ...previous, pendingReset: second.pendingReset }, nextMap,
    { ...calibration, x: 100, y: 201 }, 61_200);

  assert.equal(first.reason, "pending-results-lifecycle");
  assert.equal(first.pendingReset.visibleResultsOverride.frames, 1);
  assert.equal(second.reset, false);
  assert.equal(second.pendingReset.visibleResultsOverride.frames, 2);
  assert.equal(third.accept, true);
  assert.equal(third.reset, true);
  assert.equal(third.reason, "confirmed-stale-results-override");
  assert.equal(third.resetAt, 60_000);
  assert.equal(third.resetRoomCount, 1);
});

test("stale-results override never uses one bad map frame, the old map, or a positive sentinel", () => {
  const oldMap = gameMap({ rooms: 15, base: { x: 0, y: 0 } });
  const oneRoom = gameMap({ rooms: 1, base: { x: 0, y: 0 } });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: true,
    resultsSentinelAbsent: true,
  };
  const oneBadFrame = evaluateMapTransition(previous, oneRoom, calibration, 60_000);
  const recovered = evaluateMapTransition({ ...previous, pendingReset: oneBadFrame.pendingReset },
    oldMap, calibration, 60_600);
  assert.equal(oneBadFrame.reset, false);
  assert.equal(recovered.reset, false);
  assert.equal(recovered.pendingReset.visibleResultsOverride, null);

  let pendingReset = null;
  for (let frame = 0; frame < 8; frame += 1) {
    const held = evaluateMapTransition({
      ...previous,
      resultsSentinelAbsent: false,
      pendingReset,
    }, oneRoom, calibration, 70_000 + frame * 600);
    assert.equal(held.reset, false);
    assert.equal(held.reason, "pending-results-lifecycle");
    pendingReset = held.pendingReset;
  }
});

test("stale-results override restarts when detected floor identity alternates", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: true,
    resultsSentinelAbsent: true,
  };
  const oneRoom = gameMap({ rooms: 1, base: { x: 0, y: 0 } });
  const names = ["Small", "Medium", "Small", "Medium", "Small"];
  let pendingReset = null;
  for (let frame = 0; frame < names.length; frame += 1) {
    const result = evaluateMapTransition({ ...previous, pendingReset }, oneRoom, {
      ...calibration,
      x: 100,
      y: 200,
      floor: { name: names[frame] },
    }, 60_000 + frame * 600);
    assert.equal(result.reset, false);
    assert.equal(result.reason, "pending-results-lifecycle");
    assert.equal(result.pendingReset.visibleResultsOverride.frames, 1);
    assert.equal(result.pendingReset.visibleResultsOverride.key, names[frame]);
    pendingReset = result.pendingReset;
  }
});

test("results lifecycle preserves a real map gap while the visible reader vetoes the first map", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 12,
    lastFloorName: "Large",
    lastGameMap: gameMap({ rooms: 12, base: { x: 0, y: 0 } }),
    mapGapMs: 3_000,
    awaitingNewFloor: true,
    resultsScreenVisible: true,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 5, base: { x: 0, y: 0 } }), calibration, 60_000);
  assert.equal(first.pendingReset.hadMapGap, true);

  const afterClose = evaluateMapTransition({
    ...previous,
    mapGapMs: 0,
    resultsScreenVisible: false,
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 5, base: { x: 0, y: 0 } }), calibration, 60_600);
  assert.notEqual(afterClose.reason, "same-floor");
});

test("post-results candidates tolerate locator jitter but reject a different map lock", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: false,
  };
  const oneRoom = gameMap({ rooms: 1, base: { x: 0, y: 0 } });
  const first = evaluateMapTransition(previous, oneRoom,
    { ...calibration, x: 100, y: 50 }, 60_000);
  const relocated = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset }, oneRoom,
    { ...calibration, x: 1_200, y: 900 }, 60_600);

  assert.equal(first.reason, "pending-single-base");
  assert.equal(relocated.accept, false);
  assert.equal(relocated.reset, false);
  assert.equal(relocated.reason, "pending-single-base");
  assert.equal(relocated.pendingReset.firstSeenAt, 60_600);

  const jittered = evaluateMapTransition({ ...previous, pendingReset: relocated.pendingReset }, oneRoom,
    { ...calibration, x: 1_201, y: 899 }, 61_200);
  assert.equal(jittered.accept, true);
  assert.equal(jittered.reset, true);
  assert.equal(jittered.reason, "confirmed-single-base");
});

test("one post-results base frame followed by the old map cannot reset the timer", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: false,
  };
  const candidate = evaluateMapTransition(previous,
    gameMap({ rooms: 1, base: { x: 0, y: 0 } }), calibration, 60_000);
  const recoveredOldMap = evaluateMapTransition({ ...previous, pendingReset: candidate.pendingReset },
    gameMap({ rooms: 15, base: { x: 0, y: 0 } }), calibration, 60_600);

  assert.equal(candidate.reason, "pending-single-base");
  assert.equal(recoveredOldMap.accept, false);
  assert.equal(recoveredOldMap.reset, false);
  assert.equal(recoveredOldMap.reason, "pending-results-lifecycle");
});

test("results lifecycle survives slow captures, locator jitter and a newly readable base", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastFloorName: "Large",
    awaitingNewFloor: true,
    resultsScreenVisible: true,
    captureIntervalMs: 2_500,
  };
  const oldVisible = evaluateMapTransition(previous,
    gameMap({ rooms: 8, base: { x: 0, y: 0 } }), { ...calibration, x: 100, y: 200 }, 60_000);
  const newBaseline = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: oldVisible.pendingReset,
  }, gameMap({ rooms: 7, base: null }), { ...calibration, x: 101, y: 200 }, 66_000);
  const confirmed = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: newBaseline.pendingReset,
  }, gameMap({ rooms: 9, base: { x: 0, y: 0 } }), { ...calibration, x: 99, y: 201 }, 72_000);

  assert.equal(newBaseline.accept, false);
  assert.equal(newBaseline.pendingReset.firstOpenedRoomCount, 7);
  assert.equal(newBaseline.pendingReset.firstSeenAt, 66_000);
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.reason, "confirmed-results-lifecycle");
  assert.equal(confirmed.resetAt, 66_000);
  assert.equal(confirmed.resetRoomCount, 7);

  const expiredBaseline = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: oldVisible.pendingReset,
  }, gameMap({ rooms: 10, base: null }), { ...calibration, x: 101, y: 200 }, 68_000);
  assert.equal(expiredBaseline.accept, false);
  assert.equal(expiredBaseline.reset, false);
  assert.equal(expiredBaseline.pendingReset.firstSeenAt, 68_000);
});

test("post-results room regression follows a slow capture backend", () => {
  const oldMap = gameMap({ rooms: 15, base: { x: 5, y: 5 }, roomTypes: topology([...Array(15).keys()]) });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    lastGameMap: oldMap,
    awaitingNewFloor: true,
    resultsScreenVisible: false,
    captureIntervalMs: 2_500,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 3, base: { x: 5, y: 5 }, roomTypes: topology([20, 21, 22]) }), calibration, 60_000);
  const confirmed = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset },
    gameMap({ rooms: 4, base: { x: 5, y: 5 }, roomTypes: topology([20, 21, 22, 23]) }), calibration, 66_000);

  assert.equal(first.reason, "pending-room-regression");
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);

  const restarted = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset },
    gameMap({ rooms: 4, base: { x: 5, y: 5 }, roomTypes: topology([20, 21, 22, 23]) }), calibration, 68_000);
  assert.equal(restarted.reset, false);
  assert.equal(restarted.pendingReset.firstSeenAt, 68_000);
});

test("post-results base visibility changes share one confirmed regression streak", () => {
  const oldMap = gameMap({ rooms: 15, base: { x: 5, y: 5 }, roomTypes: topology([...Array(15).keys()]) });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    lastGameMap: oldMap,
    awaitingNewFloor: true,
    resultsScreenVisible: false,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 3, base: null, roomTypes: topology([20, 21, 22]) }), calibration, 60_000);
  const second = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset },
    gameMap({ rooms: 4, base: { x: 2, y: 2 }, roomTypes: topology([20, 21, 22, 23]) }), calibration, 61_200);
  const confirmed = evaluateMapTransition({ ...previous, pendingReset: second.pendingReset },
    gameMap({ rooms: 5, base: null, roomTypes: topology([20, 21, 22, 23, 24]) }), calibration, 62_500);

  assert.equal(first.reason, "pending-room-regression");
  assert.equal(second.reason, "pending-base-change");
  assert.equal(second.pendingReset.firstSeenAt, 60_000);
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
});

test("a finished results screen yields to confirmed floor-size or base identity", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 12,
    lastFloorName: "Small",
    awaitingNewFloor: true,
    resultsScreenVisible: false,
  };

  for (const scenario of [
    {
      name: "floor size",
      nextCalibration: calibration,
      map: gameMap({ rooms: 1, base: { x: 0, y: 0 } }),
      pendingReason: "pending-floor-change",
      confirmedReason: "confirmed-floor-change",
    },
    {
      name: "base",
      nextCalibration: { floor: { name: "Small" } },
      map: gameMap({ rooms: 1, base: { x: 3, y: 2 } }),
      pendingReason: "pending-base-change",
      confirmedReason: "confirmed-base-change",
    },
  ]) {
    const first = evaluateMapTransition(previous, scenario.map, scenario.nextCalibration, 60_000);
    assert.equal(first.accept, false, scenario.name);
    assert.equal(first.reason, scenario.pendingReason, scenario.name);

    const confirmed = evaluateMapTransition(
      { ...previous, pendingReset: first.pendingReset },
      scenario.map,
      scenario.nextCalibration,
      60_600,
    );
    assert.equal(confirmed.accept, true, scenario.name);
    assert.equal(confirmed.reset, true, scenario.name);
    assert.equal(confirmed.resetAt, 60_000, scenario.name);
    assert.equal(confirmed.resetRoomCount, 1, scenario.name);
    assert.equal(confirmed.reason, scenario.confirmedReason, scenario.name);
  }
});

test("a post-results classifier dip recovering to the old count cannot reset twice", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    mapGapMs: 2_500,
    awaitingNewFloor: true,
  };
  const dip = evaluateMapTransition(previous,
    gameMap({ rooms: 13, base: { x: 0, y: 0 } }), calibration, 60_000);
  assert.equal(dip.accept, false);
  assert.equal(dip.reason, "pending-results-lifecycle");

  const recovered = evaluateMapTransition({ ...previous, mapGapMs: 0, pendingReset: dip.pendingReset },
    gameMap({ rooms: 15, base: { x: 0, y: 0 } }), calibration, 60_600);
  assert.equal(recovered.accept, false);
  assert.equal(recovered.reset, false);
  assert.equal(recovered.reason, "pending-results-lifecycle");
});

test("a loading gap restarts results-lifecycle timing on the actual new map", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastFloorName: "Large",
    mapGapMs: 2_500,
    awaitingNewFloor: true,
  };
  const oldMap = evaluateMapTransition(previous,
    gameMap({ rooms: 8, base: { x: 0, y: 0 } }), calibration, 60_000);
  // app.js discards the old lifecycle candidate on any lost frame; even a short
  // real gap can safely arm a fresh hold because the hold itself is not a reset.
  const newMap = evaluateMapTransition({ ...previous, mapGapMs: 600, pendingReset: null },
    gameMap({ rooms: 8, base: { x: 0, y: 0 } }), calibration, 65_000);
  const progressed = evaluateMapTransition({ ...previous, mapGapMs: 0, pendingReset: newMap.pendingReset },
    gameMap({ rooms: 10, base: { x: 0, y: 0 } }), calibration, 65_600);

  assert.equal(progressed.reset, true);
  assert.equal(progressed.resetAt, 65_000);
  assert.equal(progressed.resetRoomCount, 8);
});

test("a detected floor-size change requires two frames and preserves first-frame timing", () => {
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 12,
    lastFloorName: "Small",
    pendingReset: null,
  }, gameMap({ rooms: 14, base: { x: 0, y: 0 } }), calibration, 60_000);

  assert.equal(first.accept, false);
  assert.equal(first.reason, "pending-floor-change");

  const confirmed = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 12,
    lastFloorName: "Small",
    pendingReset: first.pendingReset,
  }, gameMap({ rooms: 15, base: { x: 0, y: 0 } }), calibration, 60_600);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.resetRoomCount, 14);
  assert.equal(confirmed.reason, "confirmed-floor-change");
});

test("a two-second map gap confirms a 15 to 8 same-base floor regression", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 2, y: 3 },
    lastRoomCount: 15,
    lastFloorName: "Large",
    mapGapMs: 2_500,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 8, base: { x: 2, y: 3 } }), calibration, 60_000);

  assert.equal(first.accept, false);
  assert.equal(first.reason, "pending-map-gap-regression");

  // The caller may clear its live gap duration as soon as pixels return; the
  // pending candidate must retain that first-frame gap evidence for frame two.
  const confirmed = evaluateMapTransition({ ...previous, mapGapMs: 0, pendingReset: first.pendingReset },
    gameMap({ rooms: 9, base: { x: 2, y: 3 } }), calibration, 60_600);

  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.resetRoomCount, 8);
  assert.equal(confirmed.reason, "confirmed-map-gap-regression");
});

test("a jittering base cannot stall a collapsed-count floor change forever", () => {
  // The base cell reads differently every frame, so the pending key never
  // matches twice; the sustained-collapse valve must confirm after ~2.5s.
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 55,
    lastGameMap: gameMap({ rooms: 55, base: { x: 5, y: 5 }, roomTypes: topology([...Array(55).keys()], 128) }),
  };
  const bases = [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  let pending = null;
  let result = null;
  for (let frame = 0; frame < bases.length; frame += 1) {
    result = evaluateMapTransition({ ...previous, pendingReset: pending },
      gameMap({
        rooms: 8 + frame,
        base: bases[frame],
        roomTypes: topology([...Array(8 + frame).keys()].map((index) => index + 70), 128),
      }), calibration, 60_000 + frame * 1_000);
    if (result.reset) break;
    assert.equal(result.accept, false);
    pending = result.pendingReset;
  }
  assert.equal(result.reset, true);
  assert.equal(result.reason, "confirmed-room-collapse");
  assert.equal(result.resetAt, 60_000);
  assert.equal(result.resetRoomCount, 8);
});

test("a stale pending from before lost reads does not instantly confirm", () => {
  // Reads were lost for a while (loading screen); the surviving pending's
  // streak is dead, so the first new candidate frame must start over.
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 5, y: 5 },
    lastRoomCount: 55,
    pendingReset: { key: "old", openedRoomCount: 8, seenAt: 60_000, firstSeenAt: 55_000, reason: "single-base" },
  }, gameMap({ rooms: 9, base: { x: 2, y: 2 } }), calibration, 70_000);
  assert.equal(first.accept, false);
  assert.equal(first.pendingReset.firstSeenAt, 70_000);
});

test("results lifecycle works without a capture gap and rebases from the old visible map", () => {
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastFloorName: "Large",
    mapGapMs: 0,
    awaitingNewFloor: true,
    resultsScreenVisible: true,
  };
  const oldMap = evaluateMapTransition(previous,
    gameMap({ rooms: 8, base: { x: 0, y: 0 } }), calibration, 60_000);
  assert.equal(oldMap.accept, false);
  assert.equal(oldMap.reason, "pending-results-lifecycle");

  const newBaseline = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: oldMap.pendingReset,
  }, gameMap({ rooms: 7, base: { x: 0, y: 0 } }), calibration, 60_600);
  assert.equal(newBaseline.accept, false);
  assert.equal(newBaseline.pendingReset.firstOpenedRoomCount, 7);
  assert.equal(newBaseline.pendingReset.firstSeenAt, 60_600);

  const confirmed = evaluateMapTransition({
    ...previous,
    resultsScreenVisible: false,
    pendingReset: newBaseline.pendingReset,
  }, gameMap({ rooms: 9, base: { x: 0, y: 0 } }), calibration, 61_200);
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.reason, "confirmed-results-lifecycle");
  assert.equal(confirmed.resetAt, 60_600);
  assert.equal(confirmed.resetRoomCount, 7);
});

test("a recent map gap cannot revive an old matching room-regression pending", () => {
  const oldMap = gameMap({ rooms: 8, base: { x: 0, y: 0 }, roomTypes: topology([...Array(8).keys()]) });
  const regressedMap = gameMap({ rooms: 5, base: { x: 0, y: 0 }, roomTypes: topology([20, 21, 22, 23, 24]) });
  const result = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastGameMap: oldMap,
    mapGapMs: 1_800,
    pendingReset: {
      key: "old",
      openedRoomCount: 5,
      seenAt: 60_000,
      firstSeenAt: 55_000,
      firstOpenedRoomCount: 5,
      reason: "room-regression",
    },
  }, regressedMap, calibration, 70_000);

  assert.equal(result.accept, false);
  assert.equal(result.reset, false);
  assert.equal(result.reason, "pending-room-regression");
  assert.equal(result.pendingReset.firstSeenAt, 70_000);
});

test("a sustained 8 to 5 same-base regression resets only after 2.5 seconds", () => {
  const oldMap = gameMap({ rooms: 8, base: { x: 0, y: 0 }, roomTypes: topology([...Array(8).keys()]) });
  const fiveRoomMap = gameMap({ rooms: 5, base: { x: 0, y: 0 }, roomTypes: topology([20, 21, 22, 23, 24]) });
  const sixRoomMap = gameMap({ rooms: 6, base: { x: 0, y: 0 }, roomTypes: topology([20, 21, 22, 23, 24, 25]) });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastGameMap: oldMap,
  };
  const first = evaluateMapTransition(previous,
    fiveRoomMap, calibration, 60_000);
  assert.equal(first.accept, false);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "pending-room-regression");
  assert.equal(first.pendingReset.firstSeenAt, 60_000);
  assert.equal(first.pendingReset.firstOpenedRoomCount, 5);

  const middle = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset },
    fiveRoomMap, calibration, 61_200);
  const beforeThreshold = evaluateMapTransition({ ...previous, pendingReset: middle.pendingReset },
    sixRoomMap, calibration, 62_400);
  assert.equal(beforeThreshold.accept, false);
  assert.equal(beforeThreshold.reset, false);
  assert.equal(beforeThreshold.pendingReset.firstSeenAt, 60_000);

  const confirmed = evaluateMapTransition({ ...previous, pendingReset: beforeThreshold.pendingReset },
    sixRoomMap, calibration, 62_500);
  assert.equal(confirmed.accept, true);
  assert.equal(confirmed.reset, true);
  assert.equal(confirmed.reason, "confirmed-room-regression");
  assert.equal(confirmed.resetAt, 60_000);
  assert.equal(confirmed.resetRoomCount, 5);
});

test("a short capture miss preserves a mature room-regression streak explicitly", () => {
  const oldMap = gameMap({ rooms: 8, base: { x: 0, y: 0 }, roomTypes: topology([...Array(8).keys()]) });
  const regressedMap = gameMap({ rooms: 5, base: { x: 0, y: 0 }, roomTypes: topology([20, 21, 22, 23, 24]) });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 8,
    lastGameMap: oldMap,
  };
  const first = evaluateMapTransition(previous,
    regressedMap, calibration, 80_000);
  const stillPending = evaluateMapTransition({ ...previous, pendingReset: first.pendingReset },
    regressedMap, calibration, 80_600);
  assert.equal(stillPending.reset, false);

  const missed = evaluateMapTransition({ ...previous, pendingReset: stillPending.pendingReset },
    null, calibration, 81_200);
  assert.equal(missed.reason, "missing-map");
  assert.equal(missed.pendingReset, stillPending.pendingReset);
  assert.equal(missed.pendingReset.seenAt, 80_600);
  assert.equal(missed.pendingReset.reason, "room-regression");

  // Retaining the candidate's explicit timestamp/reason plus mapGapMs proves
  // that pixels were missing for only 1.8s. Although the readable-frame delta
  // is now 2.4s, the resumed frame may finish the existing 2.5s gate.
  const resumed = evaluateMapTransition({
    ...previous,
    mapGapMs: 1_800,
    pendingReset: missed.pendingReset,
  }, regressedMap, calibration, 83_000);

  assert.equal(resumed.accept, true);
  assert.equal(resumed.reset, true);
  assert.equal(resumed.reason, "confirmed-room-regression");
  assert.equal(resumed.resetAt, 80_000);
  assert.equal(resumed.resetRoomCount, 5);
});

test("a count-only 12 to 5 to 7 to 12 classifier dip never resets the floor timer", () => {
  // Every under-read is a subset of the last accepted topology. The reducer
  // therefore treats it as same-floor data; app.js's monotonic guard keeps the
  // displayed room count/RPM at 12 until the clean frame returns.
  const oldMap = gameMap({ rooms: 12, base: { x: 0, y: 0 }, roomTypes: topology([...Array(12).keys()]) });
  const previous = {
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 12,
    lastGameMap: oldMap,
    pendingReset: null,
  };
  const first = evaluateMapTransition(previous,
    gameMap({ rooms: 5, base: { x: 0, y: 0 }, roomTypes: topology([0, 1, 2, 3, 4]) }), calibration, 30_000);
  assert.equal(first.accept, true);
  assert.equal(first.reset, false);
  assert.equal(first.reason, "same-floor");

  const recovery = evaluateMapTransition(previous,
    gameMap({ rooms: 7, base: { x: 0, y: 0 }, roomTypes: topology([0, 1, 2, 3, 4, 5, 6]) }), calibration, 30_600);
  assert.equal(recovery.reset, false);
  assert.equal(recovery.reason, "same-floor");

  const restored = evaluateMapTransition(previous, oldMap, calibration, 31_200);
  assert.equal(restored.accept, true);
  assert.equal(restored.reset, false);
  assert.equal(restored.pendingReset, null);
  assert.equal(restored.reason, "same-floor");
});

test("automatic interface-scale recovery cannot turn its map gap into a floor reset", () => {
  const oldMap = gameMap({ rooms: 20, base: { x: 0, y: 0 }, roomTypes: topology([...Array(20).keys()]) });
  const scaledSubset = gameMap({ rooms: 10, base: { x: 0, y: 0 }, roomTypes: topology([...Array(10).keys()]) });
  const first = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 20,
    lastGameMap: oldMap,
    mapGapMs: 3_000,
    scaleChanged: true,
  }, scaledSubset, calibration, 60_000);
  assert.equal(first.accept, true);
  assert.equal(first.reset, false);

  const next = evaluateMapTransition({
    floorStart: 10_000,
    lastBase: { x: 0, y: 0 },
    lastRoomCount: 20,
    lastGameMap: oldMap,
    mapGapMs: 0,
    pendingReset: first.pendingReset,
  }, scaledSubset, calibration, 60_600);
  assert.equal(next.accept, true);
  assert.equal(next.reset, false);
});

test("the elapsed clock rolls into hours past 60 minutes", () => {
  assert.equal(formatElapsedClock(59), "00:59");
  assert.equal(formatElapsedClock(754), "12:34");
  assert.equal(formatElapsedClock(3600), "1:00:00");
  assert.equal(formatElapsedClock(3661), "1:01:01");
  assert.equal(formatElapsedClock(7325), "2:02:05");
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
  assert.equal(confirmed.resetRoomCount, 1);
  assert.equal(floorStartForDetectedMap(confirmed.resetAt, confirmed.resetRoomCount), 58_000);
  assert.equal(elapsedFloorSeconds(
    floorStartForDetectedMap(confirmed.resetAt, confirmed.resetRoomCount), 62_000), 4);
});
