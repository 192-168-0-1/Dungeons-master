import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  averageResultTime,
  formatResultDuration,
  nextAutoResultState,
  normalizeResultBatchTarget,
  parseResultTimeSeconds,
  plannedResultExports,
  resultAlreadyRecorded,
  resultBatchIsComplete,
  resultBatchStatus,
  resultFingerprint,
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
  // First sighting: the XP counters may still be animating, so it is not added.
  const seen = nextAutoResultState(FRESH_AUTO_STATE, sampleResult);
  assert.equal(seen.shouldAdd, false);
  assert.equal(seen.visible, true);
  assert.equal(seen.handled, false);
  assert.equal(seen.stable, 1);

  // An identical second read means the values are final — add it now.
  const settled = nextAutoResultState(seen, { ...sampleResult, Timestamp: "later" });
  assert.equal(settled.shouldAdd, true);
  assert.equal(settled.handled, true);
  assert.equal(settled.stable, 2);
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
  // Once the counter holds steady, the next matching read commits it.
  state = nextAutoResultState(state, { ...sampleResult, FinalXP: "12000" });
  assert.equal(state.stable, 2);
  assert.equal(state.shouldAdd, true);
});

test("auto results state does not add the same screen twice once committed", () => {
  const settled = nextAutoResultState(nextAutoResultState(FRESH_AUTO_STATE, sampleResult), sampleResult);
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
  assert.equal(recovered.shouldAdd, true);
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

  // A fresh screen still needs two stable reads before it is added.
  const freshSeen = nextAutoResultState(missedTwice, { ...sampleResult, FinalXP: "54321" });
  assert.equal(freshSeen.shouldAdd, false);
  const freshSettled = nextAutoResultState(freshSeen, { ...sampleResult, FinalXP: "54321" });
  assert.equal(freshSettled.shouldAdd, true);
});

test("auto results state adds a changed screen after the previous disappears", () => {
  let state = nextAutoResultState(nextAutoResultState(FRESH_AUTO_STATE, sampleResult), sampleResult);
  assert.equal(state.shouldAdd, true);
  const firstKey = state.key;

  // The screen closes (two misses), then a different floor appears and settles.
  state = nextAutoResultState(state, null);
  state = nextAutoResultState(state, null);
  const other = { ...sampleResult, FinalXP: "54321" };
  state = nextAutoResultState(state, other);
  assert.equal(state.shouldAdd, false);
  state = nextAutoResultState(state, other);
  assert.equal(state.shouldAdd, true);
  assert.notEqual(state.key, firstKey);
});

test("result fingerprints ignore volatile fields but include the winterface values", () => {
  // Timestamp, Roomcount and DeadEnds drift while the same results screen is
  // open, so they must not change a floor's identity.
  assert.equal(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Timestamp: "later" }));
  assert.equal(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Roomcount: "99", DeadEnds: "5" }));
  assert.notEqual(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, FinalXP: "999" }));
  assert.notEqual(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Floor: "55" }));
});

test("result table dedupe ignores volatile map fields but allows real result changes", () => {
  const existing = [{ ...sampleResult, Timestamp: "first read" }];
  assert.equal(resultAlreadyRecorded(existing, { ...sampleResult, Timestamp: "second read" }), true);
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
