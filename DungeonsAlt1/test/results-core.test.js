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

test("auto results state does nothing when no results screen is visible", () => {
  assert.deepEqual(nextAutoResultState({ visible: true, key: "old" }, null), {
    visible: false,
    key: "",
    shouldAdd: false,
  });
});

test("auto results state adds a new screen once but not while the same screen stays visible", () => {
  const first = nextAutoResultState({ visible: false, key: "" }, sampleResult);
  assert.equal(first.shouldAdd, true);
  assert.equal(first.visible, true);

  const duplicate = nextAutoResultState(first, { ...sampleResult, Timestamp: "later" });
  assert.equal(duplicate.shouldAdd, false);
  assert.equal(duplicate.key, first.key);
});

test("auto results state adds a changed screen after the previous screen disappears", () => {
  const first = nextAutoResultState({ visible: false, key: "" }, sampleResult);
  const gone = nextAutoResultState(first, null);
  const changed = nextAutoResultState(gone, { ...sampleResult, FinalXP: "54321" });
  assert.equal(changed.shouldAdd, true);
  assert.notEqual(changed.key, first.key);
});

test("result fingerprints ignore timestamp but include table values", () => {
  assert.equal(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, Timestamp: "later" }));
  assert.notEqual(resultFingerprint(sampleResult), resultFingerprint({ ...sampleResult, DeadEnds: "5" }));
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
