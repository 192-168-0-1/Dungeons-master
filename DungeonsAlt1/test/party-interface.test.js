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
  for (let x = 118; x <= 132; x += 1) setPixel(target, x, 39, [231, 80, 43, 255]);
  for (let x = 115; x <= 135; x += 1) setPixel(target, x, 61, [53, 183, 232, 255]);
}

test("party row color classification follows the five RuneScape slots", () => {
  assert.equal(isPartySlotPixel([231, 80, 43, 255], 1), true);
  assert.equal(isPartySlotPixel([53, 183, 232, 255], 2), true);
  assert.equal(isPartySlotPixel([82, 190, 76, 255], 3), true);
  assert.equal(isPartySlotPixel([238, 211, 64, 255], 4), true);
  assert.equal(isPartySlotPixel([170, 174, 178, 255], 5), true);
  assert.equal(isPartySlotPixel([53, 183, 232, 255], 1), false);
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

test("the wider three-divider party layout from RuneScape is detected", () => {
  const target = image(320, 230);
  for (const y of [70, 104, 138]) {
    for (let x = 40; x <= 220; x += 1) {
      if (x % 5 !== 0) setPixel(target, x, y, x % 2 ? [80, 70, 55, 255] : [115, 98, 78, 230]);
    }
  }
  for (let y = 49; y <= 58; y += 1) {
    for (let x = 118; x <= 132; x += 1) setPixel(target, x, y, [231, 80, 43, 255]);
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
  for (let x = 118; x <= 132; x += 1) setPixel(target, x, 105, [238, 211, 64, 255]);
  for (let x = 118; x <= 132; x += 1) setPixel(target, x, 127, [170, 174, 178, 255]);

  const result = readPartyInterface(target);
  assert.deepEqual(result.members.map((member) => member.occupied), [true, true, false, false, false]);
});
