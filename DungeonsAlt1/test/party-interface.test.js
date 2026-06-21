import assert from "node:assert/strict";
import test from "node:test";
import {
  findPartyPanel,
  isPartySlotPixel,
  readPartyInterface,
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

test("four evenly spaced dividers locate a five-row DG party panel", () => {
  const target = image(320, 220);
  paintPartyPanel(target);
  const panel = findPartyPanel(target);
  assert.ok(panel);
  assert.equal(panel.firstDividerY, 50);
  assert.equal(panel.rowGap, 22);
  assert.deepEqual(panel.rows.map((row) => row.pixelCount > 0), [true, true, false, false, false]);
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
