import assert from "node:assert/strict";
import test from "node:test";
import { deriveFloorSize } from "../src/winterface.js";

test("floor size prefers the detected map geometry over the modifier text", () => {
  // A current Large floor shows "+500%", which the historic text mapping would
  // misread as Small. The detected geometry must win.
  assert.equal(deriveFloorSize({ detected: "Large", sizeMod: "+500" }), "Large");
  assert.equal(deriveFloorSize({ detected: "Medium", sizeMod: "+999" }), "Medium");
  assert.equal(deriveFloorSize({ detected: "Small", sizeMod: "+850" }), "Small");
});

test("floor size falls back to the modifier text when no map was tracked", () => {
  // Accept both the current (+500) and historic (+850) Large modifiers.
  assert.equal(deriveFloorSize({ sizeMod: "+500" }), "Large");
  assert.equal(deriveFloorSize({ sizeMod: "+850" }), "Large");
  assert.equal(deriveFloorSize({ sizeMod: "+350" }), "Medium");
  assert.equal(deriveFloorSize({ sizeMod: "+0" }), "Small");
});

test("floor size ignores blank or unrecognised detection and arguments", () => {
  assert.equal(deriveFloorSize({ detected: "", sizeMod: "+500" }), "Large");
  assert.equal(deriveFloorSize({ detected: "Huge", sizeMod: "+350" }), "Medium");
  assert.equal(deriveFloorSize(), "Small");
  assert.equal(deriveFloorSize({}), "Small");
});
