import assert from "node:assert/strict";
import test from "node:test";
import {
  RESULTS_SENTINEL_CADENCE_MS,
  createResultsSentinelPlan,
  resultsSentinelsMatch,
} from "../src/results-sentinel.js";

function image(width, height, color = [1, 2, 3, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3] ?? 255;
  }
  return { width, height, data };
}

function setPixel(target, x, y, color) {
  const index = (y * target.width + x) * 4;
  target.data[index] = color[0];
  target.data[index + 1] = color[1];
  target.data[index + 2] = color[2];
  target.data[index + 3] = 255;
}

function paintHits(target, plan, zoneIndex, count, color, { absolute = false } = {}) {
  for (const sample of plan.zones[zoneIndex].samples.slice(0, count)) {
    setPixel(
      target,
      absolute ? sample.absoluteX : sample.x,
      absolute ? sample.absoluteY : sample.y,
      color,
    );
  }
}

function paintMatchingZones(target, plan, count = 5, options = {}) {
  for (let index = 0; index < plan.zones.length; index += 1) {
    paintHits(target, plan, index, count, plan.zones[index].colors[0], options);
  }
}

test("uses dghelper's exact 250 ms cadence and 100 percent centre geometry", () => {
  const plan = createResultsSentinelPlan({
    clientWidth: 1920,
    clientHeight: 1080,
    interfaceScale: 1,
  });

  assert.equal(RESULTS_SENTINEL_CADENCE_MS, 250);
  assert.deepEqual(plan.zones.map((zone) => [zone.label, zone.centerX, zone.centerY]), [
    ["title-gold", 960, 384],
    ["dark-interior", 760, 681],
    ["ready-orange", 1158, 684],
  ]);
  assert.deepEqual(
    { x: plan.x, y: plan.y, width: plan.width, height: plan.height },
    { x: 758, y: 382, width: 403, height: 305 },
  );
  assert.equal(plan.anchorSource, "client-center");
  assert.ok(plan.zones.every((zone) => zone.samples.length === 25));
});

test("scales zone offsets from 100 through 200 percent but keeps the exact 5x5 rule", () => {
  const plan150 = createResultsSentinelPlan({
    clientWidth: 1920,
    clientHeight: 1080,
    interfaceScale: 1.5,
  });
  const percent150 = createResultsSentinelPlan({
    clientWidth: 1920,
    clientHeight: 1080,
    interfaceScale: 150,
  });
  const plan200 = createResultsSentinelPlan({
    clientWidth: 2560,
    clientHeight: 1440,
    interfaceScale: 2,
  });

  assert.deepEqual(plan150.zones.map((zone) => [zone.centerX, zone.centerY]), [
    [960, 306],
    [660, 752],
    [1257, 756],
  ]);
  assert.deepEqual(percent150, plan150);
  assert.deepEqual(plan200.zones.map((zone) => [zone.centerX, zone.centerY]), [
    [1280, 408],
    [880, 1002],
    [1676, 1008],
  ]);
  assert.ok(plan200.zones.every((zone) => zone.samples.length === 25));
});

test("a valid previous Winterface source follows the located results crop", () => {
  const plan = createResultsSentinelPlan({
    clientWidth: 1800,
    clientHeight: 1200,
    interfaceScale: 1.5,
    previousSource: { x: 200, y: 100, width: 768, height: 501, scale: 1.5 },
  });

  assert.equal(plan.anchorSource, "previous-source");
  assert.deepEqual(plan.zones.map((zone) => [zone.centerX, zone.centerY]), [
    [584, 117],
    [284, 563],
    [881, 567],
  ]);
});

test("a stale, differently scaled or out-of-client previous source uses the safe centre fallback", () => {
  for (const previousSource of [
    { x: 100, y: 100, width: 512, height: 334, scale: 1 },
    { x: -1, y: 100, width: 768, height: 501, scale: 1.5 },
    { x: 1700, y: 100, width: 768, height: 501, scale: 1.5 },
    { x: 200, y: 100, width: 768, height: 501, scale: 1.5, clientWidth: 1600, clientHeight: 1200 },
  ]) {
    const plan = createResultsSentinelPlan({
      clientWidth: 1920,
      clientHeight: 1200,
      interfaceScale: 1.5,
      previousSource,
    });
    assert.equal(plan.anchorSource, "client-center");
  }
});

test("requires at least 5 matching pixels in every one of the three zones", () => {
  const plan = createResultsSentinelPlan({ clientWidth: 1920, clientHeight: 1080, interfaceScale: 1 });
  const exact = image(plan.width, plan.height);
  paintMatchingZones(exact, plan, 5);
  assert.equal(resultsSentinelsMatch(exact, plan), true);

  const fourInOneZone = image(plan.width, plan.height);
  paintMatchingZones(fourInOneZone, plan, 5);
  for (const sample of plan.zones[2].samples) setPixel(fourInOneZone, sample.x, sample.y, [1, 2, 3]);
  paintHits(fourInOneZone, plan, 2, 4, plan.zones[2].colors[0]);
  assert.equal(resultsSentinelsMatch(fourInOneZone, plan), false);
});

test("matches palette alternatives and includes the per-channel tolerance boundary", () => {
  const plan = createResultsSentinelPlan({ clientWidth: 1920, clientHeight: 1080, interfaceScale: 1 });
  const target = image(plan.width, plan.height);
  for (let index = 0; index < plan.zones.length; index += 1) {
    const zone = plan.zones[index];
    const base = zone.colors.at(-1);
    paintHits(target, plan, index, 5, [
      base[0] - zone.tolerance,
      base[1] + zone.tolerance,
      base[2] - zone.tolerance,
    ]);
  }
  assert.equal(resultsSentinelsMatch(target, plan), true);

  const outside = image(plan.width, plan.height);
  paintMatchingZones(outside, plan, 5);
  const dark = plan.zones[1];
  for (const sample of dark.samples) setPixel(outside, sample.x, sample.y, [1, 2, 3]);
  paintHits(outside, plan, 1, 5, [dark.colors[0][0] + dark.tolerance + 1, 18, 14]);
  assert.equal(resultsSentinelsMatch(outside, plan), false);
});

test("matches both a bounded capture and the equivalent full-client image", () => {
  const plan = createResultsSentinelPlan({ clientWidth: 1920, clientHeight: 1080, interfaceScale: 1.25 });
  const crop = image(plan.width, plan.height);
  paintMatchingZones(crop, plan, 5);
  assert.equal(resultsSentinelsMatch(crop, plan), true);

  const fullClient = image(plan.clientWidth, plan.clientHeight);
  paintMatchingZones(fullClient, plan, 5, { absolute: true });
  assert.equal(resultsSentinelsMatch(fullClient, plan), true);
});

test("rejects invalid geometry, malformed images and unrelated image sizes", () => {
  assert.equal(createResultsSentinelPlan(), null);
  assert.equal(createResultsSentinelPlan({ clientWidth: 0, clientHeight: 1080, interfaceScale: 1 }), null);
  assert.equal(createResultsSentinelPlan({ clientWidth: 1920, clientHeight: 1080, interfaceScale: 2.05 }), null);

  const plan = createResultsSentinelPlan({ clientWidth: 1920, clientHeight: 1080, interfaceScale: 1 });
  assert.equal(resultsSentinelsMatch(null, plan), false);
  assert.equal(resultsSentinelsMatch({ width: plan.width, height: plan.height, data: [] }, plan), false);
  assert.equal(resultsSentinelsMatch(image(10, 10), plan), false);
});
