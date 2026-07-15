import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTO_RESULT_STABLE_SCANS,
  RESULT_DISPLAY_COLUMNS,
  averageResultTime,
  formatResultCount,
  formatResultDuration,
  formatResultWhen,
  nextAutoResultState,
  orderedResultsForDisplay,
  resultDisplayValue,
  normalizeResultBatchTarget,
  parseResultTimeSeconds,
  plannedResultExports,
  resultCaptureRect,
  resultMapSnapshotIsFresh,
  resultAlreadyRecorded,
  resultBatchIsComplete,
  resultBatchStatus,
  resultFingerprint,
  resultLooksComplete,
  resultMatchesFloorFilter,
  safeFilePart,
  safeTimestampForFilename,
} from "../src/results-core.js";

const sampleResult = Object.freeze({
  Timestamp: "ignored",
  Time: "12:34",
  Floor: "54",
  FloorXP: "100",
  PrestigeXP: "200",
  BaseXP: "300",
  FloorSize: "Large",
  SizeMod: "+850",
  BonusMod: "14.0%",
  DifficultyMod: "+100",
  LevelMod: "+0",
  FloorXPBoost: "+0",
  TotalMod: "+950",
  FinalXP: "12345",
  Roomcount: "55",
  DeadEnds: "4",
});

test("the floor-tracking table shows the compact, numbered column set", () => {
  assert.deepEqual(RESULT_DISPLAY_COLUMNS.map((column) => column.header), [
    "#", "Floor", "Time", "Bonus %", "Size", "Rooms", "Dead ends", "Final XP",
  ]);
  assert.deepEqual(RESULT_DISPLAY_COLUMNS.map((column) => column.field), [
    "#", "Floor", "Time", "BonusMod", "DifficultyMod", "Roomcount", "DeadEnds", "FinalXP",
  ]);
});

test("display cells number the floor, show the difficulty ratio and group Final XP", () => {
  assert.equal(resultDisplayValue(sampleResult, "#", 3), "3");
  assert.equal(resultDisplayValue(sampleResult, "#", null), "");
  assert.equal(resultDisplayValue(sampleResult, "Floor", 1), "54");
  // The "Size" column is the difficulty ratio read into DifficultyMod (e.g. 5:5).
  assert.equal(resultDisplayValue({ DifficultyMod: "5:5" }, "DifficultyMod"), "5:5");
  assert.equal(resultDisplayValue(sampleResult, "FinalXP", 1), "12,345");
  assert.equal(resultDisplayValue({ FinalXP: "" }, "FinalXP"), "");
  // The timestamp formatter still works even though the table no longer shows it.
  assert.equal(resultDisplayValue({ Timestamp: "6/28/2026, 12:31:05 PM" }, "Timestamp"), "12:31 PM");
});

test("display formatters group counts and extract the clock time", () => {
  assert.equal(formatResultCount("259036"), "259,036");
  assert.equal(formatResultCount("18"), "18");
  assert.equal(formatResultCount(""), "");
  assert.equal(formatResultCount("14.0%"), "14.0%");
  assert.equal(formatResultWhen("6/28/2026, 12:31:05 PM"), "12:31 PM");
  assert.equal(formatResultWhen("2026-06-28 09:05:00"), "09:05");
  assert.equal(formatResultWhen(""), "");
});

test("the table renders oldest floor first regardless of newest-first storage", () => {
  const newestFirst = [{ Floor: "11" }, { Floor: "10" }, { Floor: "9" }];
  assert.deepEqual(orderedResultsForDisplay(newestFirst).map((row) => row.Floor), ["9", "10", "11"]);
  assert.deepEqual(orderedResultsForDisplay([]), []);
  assert.deepEqual(orderedResultsForDisplay(), []);
});

test("results auto tracking options are present and default off in the UI", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["auto-track-results", "auto-save-map-png", "auto-save-results-png"]) {
    const match = html.match(new RegExp(`<input id="${id}"[^>]*>`));
    assert.ok(match, `${id} should exist`);
    assert.equal(/\bchecked\b/.test(match[0]), false, `${id} should default off`);
  }
  const rpmOnly = html.match(/<input id="rpm-only"[^>]*>/);
  assert.ok(rpmOnly, "rpm-only should exist");
  assert.equal(/\bchecked\b/.test(rpmOnly[0]), false, "rpm-only should default off");
  for (const id of ["result-batch-size", "result-floor-filter", "result-batch-mode", "reset-result-batch", "result-batch-summary"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

const FRESH_AUTO_STATE = Object.freeze({ visible: false, key: "", handled: false, missing: 0, stable: 0 });

test("auto results state does nothing when no results screen is visible", () => {
  assert.deepEqual(nextAutoResultState({ visible: true, key: "old" }, null), {
    visible: true,
    key: "old",
    handled: false,
    missing: 1,
    stable: 0,
    shouldAdd: false,
  });
  assert.deepEqual(nextAutoResultState({ visible: true, key: "old" }, null, { missesBeforeHidden: 0 }), {
    visible: false,
    key: "",
    handled: false,
    missing: 0,
    stable: 0,
    shouldAdd: false,
  });
});

test("auto results state waits for a stable reading before adding a screen", () => {
  assert.equal(AUTO_RESULT_STABLE_SCANS, 3);
  // First sighting: the XP counters may still be animating, so it is not added.
  const seen = nextAutoResultState(FRESH_AUTO_STATE, sampleResult);
  assert.equal(seen.shouldAdd, false);
  assert.equal(seen.visible, true);
  assert.equal(seen.handled, false);
  assert.equal(seen.stable, 1);

  // A second identical read can still be a brief animation plateau.
  const second = nextAutoResultState(seen, { ...sampleResult, Timestamp: "later" });
  assert.equal(second.shouldAdd, false);
  assert.equal(second.handled, false);
  assert.equal(second.stable, 2);
  assert.equal(second.key, seen.key);

  const settled = nextAutoResultState(second, { ...sampleResult, Timestamp: "latest" });
  assert.equal(settled.shouldAdd, true);
  assert.equal(settled.handled, true);
  assert.equal(settled.stable, 3);
  assert.equal(settled.key, seen.key);
});

test("auto results state never adds while the XP counters are still animating", () => {
  let state = FRESH_AUTO_STATE;
  // Each scan reads a different (still counting up) FinalXP, so it never settles.
  for (const xp of ["100", "5000", "9000", "12000"]) {
    state = nextAutoResultState(state, { ...sampleResult, FinalXP: xp });
    assert.equal(state.shouldAdd, false);
    assert.equal(state.handled, false);
    assert.equal(state.stable, 1);
  }
  // Two matching reads can still be a temporary animation plateau.
  state = nextAutoResultState(state, { ...sampleResult, FinalXP: "12000" });
  assert.equal(state.stable, 2);
  assert.equal(state.shouldAdd, false);
  // The third consecutive match is the default commit threshold.
  state = nextAutoResultState(state, { ...sampleResult, FinalXP: "12000" });
  assert.equal(state.stable, 3);
  assert.equal(state.shouldAdd, true);
});

test("auto results state does not add the same screen twice once committed", () => {
  const first = nextAutoResultState(FRESH_AUTO_STATE, sampleResult);
  const second = nextAutoResultState(first, sampleResult);
  const settled = nextAutoResultState(second, sampleResult);
  assert.equal(settled.shouldAdd, true);

  // The screen stays open and the OCR even jitters; it must not be re-added.
  const again = nextAutoResultState(settled, sampleResult);
  assert.equal(again.shouldAdd, false);
  assert.equal(again.handled, true);
  const jitter = nextAutoResultState(settled, { ...sampleResult, FinalXP: "99999" });
  assert.equal(jitter.shouldAdd, false);
  assert.equal(jitter.handled, true);
});

test("auto results state tolerates a transient missed read without losing stability progress", () => {
  const seen = nextAutoResultState(FRESH_AUTO_STATE, sampleResult);
  assert.equal(seen.stable, 1);
  const missed = nextAutoResultState(seen, null);
  assert.equal(missed.visible, true);
  assert.equal(missed.missing, 1);
  assert.equal(missed.stable, 1);
  assert.equal(missed.shouldAdd, false);

  const recovered = nextAutoResultState(missed, sampleResult);
  assert.equal(recovered.stable, 2);
  assert.equal(recovered.shouldAdd, false);
  const settled = nextAutoResultState(recovered, sampleResult);
  assert.equal(settled.stable, 3);
  assert.equal(settled.shouldAdd, true);
});

test("auto results state resets after consecutive missed reads so the next screen can stabilise", () => {
  const seen = nextAutoResultState(FRESH_AUTO_STATE, sampleResult);
  const missedOnce = nextAutoResultState(seen, null);
  const missedTwice = nextAutoResultState(missedOnce, null);
  assert.deepEqual(missedTwice, {
    visible: false,
    key: "",
    handled: false,
    missing: 0,
    stable: 0,
    shouldAdd: false,
  });

  // A fresh screen still needs three stable reads before it is added.
  const freshSeen = nextAutoResultState(missedTwice, { ...sampleResult, FinalXP: "54321" });
  assert.equal(freshSeen.shouldAdd, false);
  const freshSecond = nextAutoResultState(freshSeen, { ...sampleResult, FinalXP: "54321" });
  assert.equal(freshSecond.shouldAdd, false);
  const freshSettled = nextAutoResultState(freshSecond, { ...sampleResult, FinalXP: "54321" });
  assert.equal(freshSettled.shouldAdd, true);
});

test("auto results state adds a changed screen after the previous disappears", () => {
  let state = nextAutoResultState(FRESH_AUTO_STATE, sampleResult);
  state = nextAutoResultState(state, sampleResult);
  state = nextAutoResultState(state, sampleResult);
  assert.equal(state.shouldAdd, true);
  const firstKey = state.key;

  // The screen closes (two misses), then a different floor appears and settles.
  state = nextAutoResultState(state, null);
  state = nextAutoResultState(state, null);
  const other = { ...sampleResult, FinalXP: "54321" };
  state = nextAutoResultState(state, other);
  assert.equal(state.shouldAdd, false);
  state = nextAutoResultState(state, other);
  assert.equal(state.shouldAdd, false);
  state = nextAutoResultState(state, other);
  assert.equal(state.shouldAdd, true);
  assert.notEqual(state.key, firstKey);
});

test("ticking Time stays one identity, settles on scan three, and never recommits", () => {
  // Time changes every scan, but it must neither reset stability nor create a
  // second identity after this physical results screen has been committed.
  const first = nextAutoResultState(FRESH_AUTO_STATE, { ...sampleResult, Time: "12:34" });
  assert.equal(first.stable, 1);
  assert.equal(first.shouldAdd, false);
  const second = nextAutoResultState(first, { ...sampleResult, Time: "12:33" });
  assert.equal(second.stable, 2);
  assert.equal(second.shouldAdd, false);
  assert.equal(second.key, first.key);
  const third = nextAutoResultState(second, { ...sampleResult, Time: "12:32" });
  assert.equal(third.stable, 3);
  assert.equal(third.shouldAdd, true);
  assert.equal(third.key, first.key);

  const tickingAfterCommit = nextAutoResultState(third, { ...sampleResult, Time: "12:31" });
  assert.equal(tickingAfterCommit.shouldAdd, false);
  assert.equal(tickingAfterCommit.handled, true);
  assert.equal(tickingAfterCommit.key, first.key);
});

test("auto results state never commits the empty pre-skip completion screen", () => {
  // The pre-skip screen matches the winterface marker with every XP field empty.
  const empty = { ...sampleResult, Floor: "", FinalXP: "" };
  let state = FRESH_AUTO_STATE;
  for (let scan = 0; scan < 3; scan += 1) {
    state = nextAutoResultState(state, empty);
    assert.equal(state.visible, true);
    assert.equal(state.stable, 0);
    assert.equal(state.handled, false);
    assert.equal(state.shouldAdd, false);
  }
  // Once real values appear it still takes exactly three stable scans to add.
  const seen = nextAutoResultState(state, sampleResult);
  assert.equal(seen.stable, 1);
  assert.equal(seen.shouldAdd, false);
  const second = nextAutoResultState(seen, sampleResult);
  assert.equal(second.stable, 2);
  assert.equal(second.shouldAdd, false);
  const settled = nextAutoResultState(second, sampleResult);
  assert.equal(settled.stable, 3);
  assert.equal(settled.shouldAdd, true);
});

test("resultLooksComplete requires both the floor number and the final XP", () => {
  assert.equal(resultLooksComplete(sampleResult), true);
  assert.equal(resultLooksComplete({ ...sampleResult, Floor: "" }), false);
  assert.equal(resultLooksComplete({ ...sampleResult, FinalXP: "" }), false);
  assert.equal(resultLooksComplete({}), false);
});

test("result fingerprints ignore volatile fields but include the winterface values", () => {
  // Timestamp, Time, Roomcount and DeadEnds drift while the same results screen is
  // open, so they must not change a floor's identity.
  assert.equal(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Timestamp: "later" }));
  assert.equal(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Time: "12:01" }));
  assert.equal(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Roomcount: "99", DeadEnds: "5" }));
  assert.notEqual(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, FinalXP: "999" }));
  assert.notEqual(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Floor: "55" }));
});

test("result table dedupe ignores volatile map fields but allows real result changes", () => {
  const existing = [{ ...sampleResult, Timestamp: "first read" }];
  assert.equal(resultAlreadyRecorded(existing, { ...sampleResult, Timestamp: "second read" }), true);
  assert.equal(resultAlreadyRecorded(existing, { ...sampleResult, Time: "12:01" }), true);
  // The same screen read again with a different live room count stays a dupe.
  assert.equal(resultAlreadyRecorded(existing, { ...sampleResult, Roomcount: "1", DeadEnds: "0" }), true);
  assert.equal(resultAlreadyRecorded(existing, { ...sampleResult, FinalXP: "54321" }), false);
  assert.equal(resultAlreadyRecorded([], sampleResult), false);
});

test("auto PNG export planning follows the map/results checkboxes", () => {
  assert.deepEqual(plannedResultExports(), []);
  assert.deepEqual(plannedResultExports({ autoSaveMap: true, hasMap: false }), []);
  assert.deepEqual(plannedResultExports({ autoSaveMap: true, hasMap: true }), ["map"]);
  assert.deepEqual(plannedResultExports({ autoSaveResults: true, hasResultsOffset: true }), ["results"]);
  assert.deepEqual(plannedResultExports({
    autoSaveMap: true,
    autoSaveResults: true,
    hasMap: true,
    hasResultsOffset: true,
  }), ["map", "results"]);
});

test("result screenshot crops prefer physical raw geometry over normalized OCR aliases", () => {
  assert.deepEqual(resultCaptureRect({
    offset: { x: 0, y: 0 }, width: 512, height: 334,
    sourceOffset: { x: 70, y: 40 }, sourceWidth: 640, sourceHeight: 418,
    rawOffset: { x: 90, y: 60 }, rawWidth: 768, rawHeight: 501,
  }), { offset: { x: 90, y: 60 }, width: 768, height: 501 });
  assert.deepEqual(resultCaptureRect({ offset: { x: 7, y: 8 }, width: 512, height: 334 }), {
    offset: { x: 7, y: 8 }, width: 512, height: 334,
  });
  assert.equal(resultCaptureRect({ offset: { x: -1, y: 0 }, width: 512, height: 334 }), null);
});

test("a results row can claim only a fresh, matching, unconsumed map snapshot", () => {
  const capture = {
    date: new Date(20_000),
    mapReadAt: 10_000,
    mapFloorName: "Large",
    result: { FloorSize: "Large" },
  };
  const current = {
    currentMapReadAt: 10_000,
    currentFloorName: "Large",
    lastConsumedAt: 0,
    hasMap: true,
    maxAgeMs: 15_000,
  };
  assert.equal(resultMapSnapshotIsFresh(capture, current), true);
  assert.equal(resultMapSnapshotIsFresh({ ...capture, date: new Date(26_000) }, current), false);
  assert.equal(resultMapSnapshotIsFresh(capture, { ...current, lastConsumedAt: 10_000 }), false);
  assert.equal(resultMapSnapshotIsFresh(capture, { ...current, currentMapReadAt: 11_000 }), false);
  assert.equal(resultMapSnapshotIsFresh(capture, { ...current, currentFloorName: "Small" }), false);
});

test("result file helpers produce safe deterministic file parts", () => {
  assert.equal(safeTimestampForFilename(new Date("2026-06-22T10:11:12.000Z")), "2026-06-22T10-11-12");
  assert.equal(safeFilePart("Floor 54 / Large"), "Floor-54-Large");
  assert.equal(safeFilePart(""), "unknown");
});

test("result time helpers calculate floor averages", () => {
  assert.equal(parseResultTimeSeconds("12:34"), 754);
  assert.equal(parseResultTimeSeconds("1:02:03"), 3723);
  assert.equal(parseResultTimeSeconds("garbage"), null);
  assert.equal(formatResultDuration(754), "12:34");
  assert.equal(formatResultDuration(3723), "1:02:03");
  assert.equal(averageResultTime([{ Time: "10:00" }, { Time: "20:00" }]), 900);
});

test("floor filters accept ranges, themes and floor sizes", () => {
  assert.equal(resultMatchesFloorFilter({ Floor: "54", FloorSize: "Large" }, ""), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "54", FloorSize: "Large" }, "warped"), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "42", FloorSize: "Large" }, "occult"), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "16", FloorSize: "Medium" }, "abandoned"), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "5", FloorSize: "Small" }, "1-11"), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "14", FloorSize: "Medium" }, "12-17"), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "30", FloorSize: "Large" }, "abandoned-2"), true);
  assert.equal(resultMatchesFloorFilter({ Floor: "54", FloorSize: "Large" }, "1-11, occult"), false);
  assert.equal(resultMatchesFloorFilter({ Floor: "54", FloorSize: "Large" }, "large"), true);
});

test("result batch status tracks target completion and average time", () => {
  const rows = [{ Time: "10:00", Floor: "48" }, { Time: "20:00", Floor: "49" }];
  assert.equal(normalizeResultBatchTarget("0"), 0);
  assert.equal(normalizeResultBatchTarget("3"), 3);
  assert.equal(resultBatchIsComplete(rows, 2), true);
  assert.deepEqual(resultBatchStatus(rows, { target: 3, filter: "warped" }), {
    count: 2,
    target: 3,
    complete: false,
    averageSeconds: 900,
    averageText: "15:00",
    summary: "Batch 2/3 floors | avg 15:00 | filter warped",
  });
});
