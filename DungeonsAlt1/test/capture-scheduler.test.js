import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCaptureInterval, reserveCaptureSlot } from "../src/capture-scheduler.js";

test("capture owners cannot start inside Alt1's recommended backend interval", () => {
  assert.equal(normalizeCaptureInterval(1000), 1000);
  let next = 0;
  const map = reserveCaptureSlot(next, 10_000, 1000);
  assert.equal(map.reserved, true);
  next = map.nextCaptureAt;

  const results = reserveCaptureSlot(next, 10_300, 1000);
  assert.deepEqual(results, { reserved: false, nextCaptureAt: 11_000, delay: 700 });
  const party = reserveCaptureSlot(next, 10_999, 1000);
  assert.equal(party.reserved, false);

  const resumed = reserveCaptureSlot(next, 11_000, 1000);
  assert.equal(resumed.reserved, true);
  assert.equal(resumed.nextCaptureAt, 12_000);
});

test("missing or invalid backend advice still gets a small safe slot", () => {
  assert.equal(normalizeCaptureInterval(undefined), 50);
  assert.equal(normalizeCaptureInterval(-1, 75), 75);
  assert.equal(reserveCaptureSlot(0, 100, undefined).nextCaptureAt, 150);
});
