import assert from "node:assert/strict";
import test from "node:test";
import {
  findPartyPanel,
  isPartySlotPixel,
  normalizeOcrPartyName,
  readPartyInterface,
  resolvePartyOcrRuntime,
} from "../src/party-interface.js";

function image(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  return { width, height, data };
}

function setPixel(target, x, y, color) {
  const index = (y * target.width + x) * 4;
  target.data.set(color, index);
}

function paintPartyPanel(target) {
  for (const y of [50, 72, 94, 116]) {
    for (let x = 40; x <= 220; x += 1) setPixel(target, x, y, [80, 70, 55, 255]);
  }
  for (let x = 118; x <= 132; x += 1) setPixel(target, x, 39, [210, 53, 0, 255]);
  for (let x = 115; x <= 135; x += 1) setPixel(target, x, 61, [0, 137, 133, 255]);
}

test("party row color classification follows the five RuneScape slots", () => {
  assert.equal(isPartySlotPixel([210, 53, 0, 255], 1), true);
  assert.equal(isPartySlotPixel([0, 137, 133, 255], 2), true);
  assert.equal(isPartySlotPixel([72, 129, 0, 255], 3), true);
  assert.equal(isPartySlotPixel([145, 150, 0, 255], 4), true);
  assert.equal(isPartySlotPixel([109, 134, 95, 255], 5), true);
  assert.equal(isPartySlotPixel([0, 137, 133, 255], 1), false);
  assert.equal(isPartySlotPixel([80, 70, 55, 255], 1), false);
});

test("OCR runtime resolves the globals exported by the Alt1 browser bundles", () => {
  const imageData = image(2, 2);
  const capture = (...args) => ({ args, toData: () => imageData });
  const findReadLine = () => ({ text: "" });
  const font = { chars: [{ chr: "A" }] };
  const largerFont = { chars: [{ chr: "B" }] };
  const runtime = resolvePartyOcrRuntime({
    A1lib: { capture },
    OCR: { findReadLine },
    Alt1Fonts: { aa_8px: font, aa_10px_mono: largerFont },
  });

  assert.equal(runtime.capture(1, 2, 3, 4), imageData);
  assert.equal(runtime.ocr.findReadLine, findReadLine);
  assert.equal(runtime.font, font);
  assert.deepEqual(runtime.fonts, [font, largerFont]);
});

test("OCR party-name validation rejects divider garbage", () => {
  assert.equal(normalizeOcrPartyName("A Ninja"), "A Ninja");
  assert.equal(normalizeOcrPartyName("s_If"), "s If");
  assert.equal(normalizeOcrPartyName("I-----------"), "");
  assert.equal(normalizeOcrPartyName("_--- ---"), "");
  assert.equal(normalizeOcrPartyName("_"), "");
});

test("four evenly spaced dividers locate a five-row DG party panel", () => {
  const target = image(320, 220);
  paintPartyPanel(target);
  const panel = findPartyPanel(target);
  assert.ok(panel);
  assert.equal(panel.firstDividerY, 50);
  assert.equal(panel.rowGap, 22);
  assert.deepEqual(panel.rows.map((row) => row.pixelCount > 0), [true, true, false, false, false]);
});

test("the divider fallback locates the party panel at 200% interface scale", () => {
  const target = image(640, 420);
  for (const y of [100, 144, 188, 232]) {
    for (let x = 80; x <= 440; x += 1) setPixel(target, x, y, [80, 70, 55, 255]);
  }
  for (let x = 236; x <= 264; x += 1) setPixel(target, x, 78, [210, 53, 0, 255]);
  for (let x = 230; x <= 270; x += 1) setPixel(target, x, 122, [0, 137, 133, 255]);

  const panel = findPartyPanel(target);
  assert.ok(panel);
  assert.equal(panel.firstDividerY, 100);
  assert.equal(panel.rowGap, 44);
  assert.deepEqual(panel.rows.map((row) => row.pixelCount > 0), [true, true, false, false, false]);
});

test("the wider three-divider party layout from RuneScape is detected", () => {
  const target = image(320, 230);
  for (const y of [70, 104, 138]) {
    for (let x = 40; x <= 220; x += 1) {
      if (x % 5 !== 0) setPixel(target, x, y, x % 2 ? [80, 70, 55, 255] : [115, 98, 78, 230]);
    }
  }
  for (let y = 49; y <= 58; y += 1) {
    for (let x = 118; x <= 132; x += 1) setPixel(target, x, y, [210, 53, 0, 255]);
  }

  const panel = findPartyPanel(target);
  assert.ok(panel);
  assert.equal(panel.firstDividerY, 70);
  assert.equal(panel.rowGap, 34);
  assert.equal(panel.rows[0].centerY, 54);
  assert.equal(panel.rows[0].pixelCount > 0, true);
});

test("OCR results are attached to their detected RuneScape row", () => {
  const target = image(320, 220);
  paintPartyPanel(target);
  const ocr = {
    findReadLine(_image, _font, _colors, _x, y) {
      return { text: y < 50 ? "A Ninja" : "s If" };
    },
  };
  const result = readPartyInterface(target, { ocr, font: { chars: [{}] } });
  assert.deepEqual(result.members.slice(0, 2).map(({ slot, name, occupied }) => ({ slot, name, occupied })), [
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "s If", occupied: true },
  ]);
});

test("occupied party rows must be contiguous from player one", () => {
  const target = image(320, 230);
  paintPartyPanel(target);
  for (let x = 118; x <= 132; x += 1) setPixel(target, x, 105, [145, 150, 0, 255]);
  for (let x = 118; x <= 132; x += 1) setPixel(target, x, 127, [109, 134, 95, 255]);

  const result = readPartyInterface(target);
  assert.deepEqual(result.members.map((member) => member.occupied), [true, true, false, false, false]);
});


test("party OCR prefers a known team member over longer garbage", () => {
  const target = image(320, 220);
  paintPartyPanel(target);
  const ocr = {
    calls: 0,
    findReadLine() {
      this.calls += 1;
      return { text: this.calls === 1 ? "A Nlnja" : "divider garbage" };
    },
  };

  const result = readPartyInterface(target, {
    ocr,
    font: { chars: [{}] },
    expectedNames: ["A Ninja", "s If"],
  });

  assert.equal(result.members[0].name, "A Ninja");
});


test("occupied DG rows can appear above the first visible empty-row divider", () => {
  const target = image(360, 220);
  for (const y of [92, 116, 140]) {
    for (let x = 50; x <= 250; x += 1) setPixel(target, x, y, [80, 70, 55, 255]);
  }
  for (let x = 130; x <= 150; x += 1) setPixel(target, x, 58, [210, 53, 0, 255]);
  for (let x = 130; x <= 150; x += 1) setPixel(target, x, 82, [0, 137, 133, 255]);

  const panel = findPartyPanel(target);
  assert.ok(panel);
  assert.equal(panel.firstDividerY, 68);
  assert.deepEqual(panel.rows.map((row) => row.pixelCount > 0), [true, true, false, false, false]);

  const result = readPartyInterface(target);
  assert.deepEqual(result.members.map((member) => member.occupied), [true, true, false, false, false]);
});


test("OCR text can mark a low-color party row as occupied", () => {
  const target = image(320, 220);
  paintPartyPanel(target);
  for (let x = 115; x <= 135; x += 1) setPixel(target, x, 61, [0, 0, 0, 255]);
  const ocr = {
    findReadLine(_image, _font, _colors, _x, y) {
      if (y < 50) return { text: "A Ninja" };
      if (y < 75) return { text: "X R P" };
      return { text: "" };
    },
  };

  const result = readPartyInterface(target, { ocr, font: { chars: [{}] }, expectedNames: ["XRP"] });

  assert.deepEqual(result.members.slice(0, 2).map(({ slot, name, occupied }) => ({ slot, name, occupied })), [
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "XRP", occupied: true },
  ]);
});
