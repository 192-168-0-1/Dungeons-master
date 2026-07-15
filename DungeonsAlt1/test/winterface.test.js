import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";
import {
  WINTERFACE_HEIGHT,
  WINTERFACE_WIDTH,
  WinterfaceReader,
  deriveFloorSize,
} from "../src/winterface.js";

function image(width, height, color = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3];
  }
  return { width, height, data };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

const PNG_FIXTURE_CACHE = new Map();

// Tiny test-only decoder for the checked-in, non-interlaced 8-bit RGB/RGBA
// fixtures. Using the real marker and number glyphs pins the scaled matcher to
// the assets the browser actually loads without adding an npm dependency.
function readFixturePng(name) {
  if (PNG_FIXTURE_CACHE.has(name)) return PNG_FIXTURE_CACHE.get(name);
  const bytes = readFileSync(new URL(`../assets/winterface/${name}`, import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "IDAT") compressed.push(chunk);
    offset += length + 12;
    if (type === "IEND") break;
  }
  assert.equal(bitDepth, 8);
  assert.ok(colorType === 2 || colorType === 6);
  assert.equal(interlace, 0);
  const channels = colorType === 6 ? 4 : 3;
  const packed = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const decoded = new Uint8Array(stride * height);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[input];
    input += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[input];
      input += 1;
      const left = x >= channels ? decoded[y * stride + x - channels] : 0;
      const up = y > 0 ? decoded[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : Number.NaN;
      assert.ok(Number.isFinite(predictor), `unsupported PNG filter ${filter}`);
      decoded[y * stride + x] = (raw + predictor) & 0xff;
    }
  }
  const result = image(width, height, [0, 0, 0, 0]);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    result.data[pixel * 4] = decoded[pixel * channels];
    result.data[pixel * 4 + 1] = decoded[pixel * channels + 1];
    result.data[pixel * 4 + 2] = decoded[pixel * channels + 2];
    result.data[pixel * 4 + 3] = channels === 4 ? decoded[pixel * channels + 3] : 255;
  }
  PNG_FIXTURE_CACHE.set(name, result);
  return result;
}

function setPixel(target, x, y, color) {
  const index = (y * target.width + x) * 4;
  target.data[index] = color[0];
  target.data[index + 1] = color[1];
  target.data[index + 2] = color[2];
  target.data[index + 3] = color[3];
}

function blit(target, source, offsetX, offsetY) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const from = (y * source.width + x) * 4;
      setPixel(target, offsetX + x, offsetY + y, source.data.subarray(from, from + 4));
    }
  }
}

function paintGlyph(target, glyph, offsetX, offsetY, color) {
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const index = (y * glyph.width + x) * 4;
      if (glyph.data[index + 3] === 255) setPixel(target, offsetX + x, offsetY + y, [...color, 255]);
    }
  }
}

function paintText(target, glyphs, value, offsetX, offsetY, color) {
  let x = offsetX;
  for (const character of value) {
    const glyph = glyphs.find((candidate) => candidate.value === character);
    assert.ok(glyph, `missing fixture glyph ${character}`);
    paintGlyph(target, glyph.image, x, offsetY, color);
    x += glyph.image.width;
  }
}

function scaleImageNearest(source, scale) {
  const target = image(Math.round(source.width * scale), Math.round(source.height * scale));
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      const from = (sourceY * source.width + sourceX) * 4;
      setPixel(target, x, y, source.data.subarray(from, from + 4));
    }
  }
  return target;
}

function scaleImageBilinear(source, scale) {
  const target = image(Math.round(source.width * scale), Math.round(source.height * scale));
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const weightY = sourceY - y0;
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const weightX = sourceX - x0;
      const color = [];
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source.data[(y0 * source.width + x0) * 4 + channel];
        const topRight = source.data[(y0 * source.width + x1) * 4 + channel];
        const bottomLeft = source.data[(y1 * source.width + x0) * 4 + channel];
        const bottomRight = source.data[(y1 * source.width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * weightX;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
        color[channel] = Math.round(top + (bottom - top) * weightY);
      }
      setPixel(target, x, y, color);
    }
  }
  return target;
}

function winterfaceFixture() {
  const marker = readFixturePng("WinterfaceMarker.png");
  const fonts = {
    Base: [...Array(10)].map((_, index) => ({ value: `${index}`, image: readFixturePng(`Base${index}.png`) })),
    Small: [
      ...[...Array(10)].map((_, index) => ({ value: `${index}`, image: readFixturePng(`Small${index}.png`) })),
      { value: "+", image: readFixturePng("SmallPlus.png") },
      { value: "-", image: readFixturePng("SmallMinus.png") },
      { value: ":", image: readFixturePng("SmallColon.png") },
    ],
    Large: [
      ...[...Array(10)].map((_, index) => ({ value: `${index}`, image: readFixturePng(`Large${index}.png`) })),
      { value: "", image: readFixturePng("LargeComma.png") },
    ],
  };
  const canonical = image(WINTERFACE_WIDTH, WINTERFACE_HEIGHT, [8, 12, 16, 255]);
  blit(canonical, marker, 0, 0);
  paintText(canonical, fonts.Small, "1:2", 28, 308, [255, 255, 255]);
  paintText(canonical, fonts.Base, "7", 78, 56, [198, 155, 1]);
  paintText(canonical, fonts.Large, "809", 116, 271, [226, 226, 162]);
  return {
    canonical,
    marker,
    fonts,
  };
}

function placeOnClient(source, offset) {
  const client = image(offset.x + source.width + 79, offset.y + source.height + 61, [73, 19, 91, 255]);
  blit(client, source, offset.x, offset.y);
  return client;
}

function assertSourceRect(capture, offset, scale) {
  const width = Math.round(WINTERFACE_WIDTH * scale);
  const height = Math.round(WINTERFACE_HEIGHT * scale);
  assert.deepEqual(capture.offset, offset);
  assert.equal(capture.width, width);
  assert.equal(capture.height, height);
  assert.equal(capture.scale, scale);
  assert.deepEqual(capture.sourceOffset, offset);
  assert.equal(capture.sourceWidth, width);
  assert.equal(capture.sourceHeight, height);
  assert.equal(capture.sourceScale, scale);
  assert.deepEqual(capture.rawOffset, offset);
  assert.equal(capture.rawWidth, width);
  assert.equal(capture.rawHeight, height);
  assert.equal(capture.rawScale, scale);
}

function assertFixtureOcr(capture) {
  assert.equal(capture.result.Time, "1:2");
  assert.equal(capture.result.Floor, "7");
  assert.equal(capture.result.FinalXP, "809");
}

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

test("the exact 100 percent reader keeps canonical OCR and source geometry", () => {
  const fixture = winterfaceFixture();
  const offset = { x: 43, y: 29 };
  const reader = new WinterfaceReader(fixture.marker, fixture.fonts);
  const capture = reader.readWithOffset(placeOnClient(fixture.canonical, offset));

  assert.ok(capture);
  assert.equal(capture.markerScore, 0);
  assertFixtureOcr(capture);
  assertSourceRect(capture, offset, 1);
});

test("nearest-neighbour 150 percent detection normalizes OCR but returns the physical source crop", () => {
  const fixture = winterfaceFixture();
  const offset = { x: 73, y: 59 };
  const scaled = scaleImageNearest(fixture.canonical, 1.5);
  const reader = new WinterfaceReader(fixture.marker, fixture.fonts);
  // Percent-form hints are accepted because UI settings commonly expose 150,
  // while map calibration stores the same scale as 1.5.
  const capture = reader.readWithOffset(placeOnClient(scaled, offset), { interfaceScale: 150 });

  assert.ok(capture);
  assertFixtureOcr(capture);
  assertSourceRect(capture, offset, 1.5);
  assert.equal(capture.width, 768);
  assert.equal(capture.height, 501);
});

test("bilinear 150 percent fallback finds the real marker, reads glyphs tolerantly and preserves the raw rect", () => {
  const fixture = winterfaceFixture();
  const offset = { x: 57, y: 41 };
  const scaled = scaleImageBilinear(fixture.canonical, 1.5);
  const reader = new WinterfaceReader(fixture.marker, fixture.fonts);
  // No hint: this exercises the bounded 100..200% fallback in 5% steps.
  const capture = reader.readWithOffset(placeOnClient(scaled, offset));

  assert.ok(capture);
  assert.ok(capture.markerScore < 150);
  assertFixtureOcr(capture);
  assertSourceRect(capture, offset, 1.5);
  assert.equal(capture.width, 768);
  assert.equal(capture.height, 501);
});

test("a stale scale hint falls back to the actual interface scale", () => {
  const fixture = winterfaceFixture();
  const offset = { x: 61, y: 47 };
  const scaled = scaleImageBilinear(fixture.canonical, 1.5);
  const reader = new WinterfaceReader(fixture.marker, fixture.fonts);
  assert.equal(reader.readWithOffset(placeOnClient(scaled, offset), {
    interfaceScale: 1.25,
    allowScaleFallback: false,
  }), null);
  const capture = reader.readWithOffset(placeOnClient(scaled, offset), { interfaceScale: 1.25 });

  assert.ok(capture);
  assert.ok(capture.markerScore < 150);
  assertFixtureOcr(capture);
  assertSourceRect(capture, offset, 1.5);
});

test("the exact default marker never returns a results crop outside the client", () => {
  const fixture = winterfaceFixture();
  const client = image(766, 340, [8, 12, 16, 255]);
  blit(client, fixture.marker, 710, 330);
  const reader = new WinterfaceReader(fixture.marker, fixture.fonts);

  assert.equal(reader.readWithOffset(client, { interfaceScale: 1, allowScaleFallback: false }), null);
});

test("bounded scaled fallback rejects a marker-coloured large blank client", () => {
  const fixture = winterfaceFixture();
  const reader = new WinterfaceReader(fixture.marker, fixture.fonts);
  // This dark colour is deliberately close to the real marker palette. The
  // search still has fixed per-scale coarse budgets and must reject structure-
  // free lookalikes instead of refining every pixel at every candidate scale.
  const blankClient = image(1600, 900, [37, 31, 25, 255]);
  assert.equal(reader.readWithOffset(blankClient, { interfaceScale: 1.5 }), null);
});
