import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INTERFACE_SCALE_OBSERVATION_MAX_AGE,
  createInterfaceScaleState,
  currentInterfaceScale,
  interfaceScaleLabel,
  isFreshInterfaceScaleObservation,
  normalizeInterfaceScale,
  observeInterfaceScale,
  parseSavedInterfaceScale,
} from "../src/interface-scale.js";

test("interface scale snaps to RuneScape's supported automatic 5 percent range", () => {
  assert.equal(normalizeInterfaceScale(1.48), 1.5);
  assert.equal(normalizeInterfaceScale(0.5), 1);
  assert.equal(normalizeInterfaceScale(2.8), 2);
  assert.equal(normalizeInterfaceScale("bad"), 1);
});

test("saved calibration scale rejects corrupt or out-of-range multipliers", () => {
  assert.equal(parseSavedInterfaceScale(undefined), 1);
  assert.equal(parseSavedInterfaceScale(null), 1);
  assert.equal(parseSavedInterfaceScale(1.23), 1.25);
  for (const value of [0, 2.05, 150, Number.NaN, "not-a-number"]) {
    assert.equal(parseSavedInterfaceScale(value), null);
  }
});

test("live map geometry overrides results and saved scale hints", () => {
  const saved = createInterfaceScaleState(1.25);
  assert.equal(saved.confirmed, false);
  assert.equal(currentInterfaceScale({ scaleState: saved }), 1.25);

  const results = observeInterfaceScale(saved, 1.5, "results", 1000);
  assert.equal(currentInterfaceScale({ scaleState: results, now: 2000 }), 1.5);
  assert.equal(currentInterfaceScale({ calibration: { scale: 1.75 }, scaleState: results, now: 2000 }), 1.75);
  assert.equal(interfaceScaleLabel(results, null, 2000), "Auto: 150% (results pixels)");
});

test("an old observation remains a hint and is never presented as live calibration", () => {
  const observed = observeInterfaceScale(null, 1.6, "results", 1000);
  const now = 1000 + INTERFACE_SCALE_OBSERVATION_MAX_AGE + 1;
  assert.equal(currentInterfaceScale({ scaleState: observed, now }), 1.6);
  assert.equal(isFreshInterfaceScaleObservation(observed, now), false);
  assert.equal(interfaceScaleLabel(observed, null, now), "Auto: 160% (detecting)");
  assert.equal(interfaceScaleLabel(observed, { scale: 1.4 }), "Auto: 140% (map pixels)");
});

test("the UI exposes detected scale instead of a second manual RPM percentage", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /<output id="interface-scale-status"/);
  assert.doesNotMatch(html, /id="stats-scale"/);
  assert.match(app, /recordInterfaceScale\(match\.scale \|\| 1, "map"\)/);
  assert.match(app, /recordInterfaceScale\(capture\.scale, "results"\)/);
  assert.match(app, /isFreshInterfaceScaleObservation\(state\.interfaceScale, now\)/);
  assert.match(app, /statsScale: 1/);
});
