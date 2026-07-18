import assert from "node:assert/strict";
import test from "node:test";
import {
  captureEvidenceIsFresh,
  globalResultMarkerSource,
  resultCaptureTarget,
  resultLifecycleObservation,
  resultRetirementKey,
} from "../src/results-capture.js";

function completeResult(overrides = {}) {
  return {
    Floor: "42",
    Time: "06:15",
    FloorXP: "1000",
    BaseXP: "800",
    FinalXP: "1200",
    ...overrides,
  };
}

test("a remembered Winterface source becomes a small padded client-relative target", () => {
  assert.deepEqual(resultCaptureTarget({
    x: 710,
    y: 330,
    width: 512,
    height: 334,
    scale: 1,
    clientWidth: 1920,
    clientHeight: 1080,
  }, { clientWidth: 1920, clientHeight: 1080 }), {
    x: 706,
    y: 326,
    width: 520,
    height: 342,
    scale: 1,
  });
});

test("target geometry rejects client resize, wrong scale dimensions and out-of-bounds rectangles", () => {
  const valid = { x: 100, y: 100, width: 768, height: 501, scale: 1.5, clientWidth: 1920, clientHeight: 1080 };
  assert.equal(resultCaptureTarget(valid, { clientWidth: 1600, clientHeight: 900 }), null);
  assert.equal(resultCaptureTarget({ ...valid, width: 700 }, { clientWidth: 1920, clientHeight: 1080 }), null);
  assert.equal(resultCaptureTarget({ ...valid, x: 1800 }, { clientWidth: 1920, clientHeight: 1080 }), null);
});

test("confirmed local crop offsets translate to a separate global marker source", () => {
  const source = globalResultMarkerSource({ offset: { x: 6, y: 7 }, width: 768, height: 501 },
    { x: 94, y: 93, scale: 1.5 }, { clientWidth: 1920, clientHeight: 1080 });
  assert.deepEqual(source, {
    x: 100,
    y: 100,
    width: 768,
    height: 501,
    scale: 1.5,
    clientWidth: 1920,
    clientHeight: 1080,
  });
});

test("result freshness follows both a safe minimum and a slow Alt1 backend", () => {
  assert.equal(captureEvidenceIsFresh(10_000, 11_999, 50), true);
  assert.equal(captureEvidenceIsFresh(10_000, 12_001, 50), false);
  assert.equal(captureEvidenceIsFresh(10_000, 17_500, 2500), true);
  assert.equal(captureEvidenceIsFresh(10_000, 17_501, 2500), false);
});

test("incomplete OCR needs a fresh sentinel while complete targeted OCR stands alone", () => {
  assert.equal(resultLifecycleObservation({}, { sentinelPositive: false }).observable, false);
  assert.equal(resultLifecycleObservation({}, { sentinelPositive: true }).observable, true);
  const complete = resultLifecycleObservation(completeResult());
  assert.equal(complete.observable, true);
  assert.equal(complete.complete, true);
  assert.ok(complete.key);
});

test("retired stale results stay muted until two targeted misses confirm closure", () => {
  const old = resultLifecycleObservation(completeResult());
  const suppressed = resultLifecycleObservation(completeResult(), { retired: true, retiredKey: old.key });
  assert.equal(suppressed.observable, false);
  assert.equal(suppressed.retired, true);

  const changed = resultLifecycleObservation(completeResult({ Floor: "43" }), { retired: true, retiredKey: old.key });
  assert.equal(changed.observable, false);
  assert.equal(changed.retired, true);

  const oneMiss = resultLifecycleObservation(null, { retired: true, retiredKey: old.key });
  assert.equal(oneMiss.retired, true);
  const sameAfterMiss = resultLifecycleObservation(completeResult(), {
    retired: oneMiss.retired,
    retiredKey: oneMiss.retiredKey,
  });
  assert.equal(sameAfterMiss.observable, false);
  assert.equal(sameAfterMiss.retired, true);

  const confirmedMissing = resultLifecycleObservation(null, {
    retired: true,
    retiredKey: old.key,
    confirmedMissing: true,
  });
  assert.equal(confirmedMissing.retired, false);
});

test("retirement ignores live-map FloorSize changes and incomplete OCR jitter", () => {
  const stale = completeResult({ FloorSize: "Large" });
  const retiredKey = resultRetirementKey(stale);
  assert.equal(retiredKey, resultRetirementKey({ ...stale, FloorSize: "Small" }));

  const samePixelsDifferentMap = resultLifecycleObservation({ ...stale, FloorSize: "Small" }, {
    retired: true,
    retiredKey,
  });
  assert.equal(samePixelsDifferentMap.observable, false);
  assert.equal(samePixelsDifferentMap.retired, true);

  const incompleteJitter = resultLifecycleObservation({ Floor: "43" }, {
    sentinelPositive: true,
    retired: true,
    retiredKey,
  });
  assert.equal(incompleteJitter.observable, false);
  assert.equal(incompleteJitter.retired, true);
});
