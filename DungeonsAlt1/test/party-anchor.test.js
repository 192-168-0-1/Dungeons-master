import assert from "node:assert/strict";
import test from "node:test";
import {
  DG_ICON,
  DG_INTERFACE_ROW_END,
  PARTY_SLOT_COLORS,
  findDgIcon,
  locatePartyRows,
  readPartyByAnchor,
  removeDgInterfaceBackground,
} from "../src/party-anchor.js";

function image(width, height, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { width, height, data };
}

function setPixel(img, x, y, color) {
  const i = (y * img.width + x) * 4;
  img.data[i] = color[0];
  img.data[i + 1] = color[1];
  img.data[i + 2] = color[2];
  img.data[i + 3] = color[3] ?? 255;
}

// Fake Alt1 api: DG_ICON search returns a fixed absolute hit; the row-end search
// returns an offset relative to the icon x.
function fakeApi({ dgIconHit = { x: 100, y: 50 }, rowEndOffset = 130, rsWidth = 800, rsHeight = 600 } = {}) {
  return {
    rsWidth,
    rsHeight,
    bindRegion: () => "bind",
    bindFindSubImg: (_bind, icon) => {
      if (icon === DG_ICON.icon) return JSON.stringify(dgIconHit ? [dgIconHit] : []);
      if (icon === DG_INTERFACE_ROW_END.icon) return JSON.stringify(rowEndOffset == null ? [] : [{ x: rowEndOffset, y: 0 }]);
      return "[]";
    },
  };
}

test("findDgIcon returns the absolute icon position or null", () => {
  assert.deepEqual(findDgIcon(fakeApi({ dgIconHit: { x: 120, y: 64 } })), { x: 120, y: 64 });
  assert.equal(findDgIcon(fakeApi({ dgIconHit: null })), null);
  assert.equal(findDgIcon({}), null);
});

test("locatePartyRows derives five 22px rows from the icon, matching dg-map geometry", () => {
  const api = fakeApi({ dgIconHit: { x: 100, y: 50 }, rowEndOffset: 130 });
  const layout = locatePartyRows(api, { x: 100, y: 50 });
  assert.ok(layout);
  // firstRowLineBottomY = 50 + 19 = 69; rowWidth = min(120,130)=120; cropX = 100 + floor((130-120)/2) = 105
  assert.equal(layout.firstRowLineBottomY, 69);
  assert.equal(layout.rowWidth, 120);
  assert.equal(layout.cropX, 105);
  assert.deepEqual(layout.rows.map((r) => r.y), [47, 69, 91, 113, 135]);
  assert.deepEqual(layout.rows.map((r) => r.x), [105, 105, 105, 105, 105]);
  assert.equal(layout.rows[0].height, DG_INTERFACE_ROW_END.height === 2 ? 20 : layout.rows[0].height);
  assert.deepEqual(layout.rows[0].color, PARTY_SLOT_COLORS[0]);
  assert.equal(layout.rows[4].slot, 5);
});

test("locatePartyRows clamps the row width to 120 and returns null without a row end", () => {
  const narrow = locatePartyRows(fakeApi({ rowEndOffset: 80 }), { x: 100, y: 50 });
  assert.equal(narrow.rowWidth, 80);
  assert.equal(narrow.cropX, 100); // floor((80-80)/2) = 0
  assert.equal(locatePartyRows(fakeApi({ rowEndOffset: null }), { x: 100, y: 50 }), null);
});

test("removeDgInterfaceBackground blackens the divider band and panel tones but keeps name pixels", () => {
  const img = image(6, 8, [50, 46, 40, 255]); // a known panel background tone
  setPixel(img, 3, 6, [210, 53, 0, 255]); // a slot-1 name pixel below the textY band
  setPixel(img, 1, 2, [210, 53, 0, 255]); // a name-coloured pixel inside the top band (y < 5)
  removeDgInterfaceBackground(img, 5);
  // background tone cleared to black
  const bg = (3 * img.width + 0) * 4;
  assert.deepEqual([img.data[bg], img.data[bg + 1], img.data[bg + 2]], [0, 0, 0]);
  // name pixel below the band survives
  const keep = (6 * img.width + 3) * 4;
  assert.deepEqual([img.data[keep], img.data[keep + 1], img.data[keep + 2]], [210, 53, 0]);
  // pixel inside the top band is wiped regardless of colour
  const wiped = (2 * img.width + 1) * 4;
  assert.deepEqual([img.data[wiped], img.data[wiped + 1], img.data[wiped + 2]], [0, 0, 0]);
});

test("readPartyByAnchor reads contiguous occupied rows via the icon anchor", () => {
  const api = fakeApi({ dgIconHit: { x: 100, y: 50 }, rowEndOffset: 130 });
  // Each captured row is a band; rows 1 and 2 carry their slot colour, the rest empty.
  const capture = (x, y, width, height) => {
    const img = image(width, height, [50, 46, 40, 255]);
    const slotByY = { 47: 1, 69: 2 };
    const slot = slotByY[y];
    if (slot) {
      const color = PARTY_SLOT_COLORS[slot - 1];
      for (let px = 10; px < 20; px += 1) setPixel(img, px, Math.floor(height / 2), [...color, 255]);
    }
    return img;
  };
  const ocr = {
    findReadLine: (_img, _font, colors) => {
      const slot = PARTY_SLOT_COLORS.findIndex((c) => c[0] === colors[0][0] && c[1] === colors[0][1] && c[2] === colors[0][2]) + 1;
      return { text: slot === 1 ? "A Ninja" : slot === 2 ? "s If" : "" };
    },
  };
  const result = readPartyByAnchor({ api, capture, ocr, font: { chars: "abc" } });
  assert.ok(result);
  assert.equal(result.panel.method, "anchor");
  assert.deepEqual(result.members.map((m) => ({ slot: m.slot, name: m.name, occupied: m.occupied })), [
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "s If", occupied: true },
    { slot: 3, name: "", occupied: false },
    { slot: 4, name: "", occupied: false },
    { slot: 5, name: "", occupied: false },
  ]);
});

test("readPartyByAnchor returns null when the DG icon is not on screen", () => {
  const api = fakeApi({ dgIconHit: null });
  const result = readPartyByAnchor({ api, capture: () => image(120, 20), ocr: { findReadLine: () => ({ text: "" }) }, font: { chars: "a" } });
  assert.equal(result, null);
});
