import assert from "node:assert/strict";
import test from "node:test";
import { captureRegion } from "../src/alt1-capture.js";

class TestImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function encodedBgra(width, height, [red, green, blue, alpha = 255]) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let index = 0; index < bytes.length; index += 4) {
    bytes[index] = blue;
    bytes[index + 1] = green;
    bytes[index + 2] = red;
    bytes[index + 3] = alpha;
  }
  return bytes.toString("base64");
}

function withAlt1(api, callback) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previousWindow = globalThis.window;
  const hadImageData = Object.prototype.hasOwnProperty.call(globalThis, "ImageData");
  const previousImageData = globalThis.ImageData;
  globalThis.window = { alt1: api };
  globalThis.ImageData = TestImageData;
  try {
    return callback();
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadImageData) globalThis.ImageData = previousImageData;
    else delete globalThis.ImageData;
  }
}

function assertSolidRgba(image, expected) {
  for (let index = 0; index < image.data.length; index += 4) {
    assert.deepEqual(Array.from(image.data.subarray(index, index + 4)), expected);
  }
}

test("large fallback captures bind one frame before transferring every decoded stripe", () => {
  const calls = [];
  let liveFrame = 1;
  let boundFrame = 0;
  const width = 256;
  const height = 100;
  const image = withAlt1({
    maxtransfer: 65_536,
    bindRegion(x, y, bindWidth, bindHeight) {
      calls.push(["bindRegion", x, y, bindWidth, bindHeight]);
      boundFrame = liveFrame;
      return 7;
    },
    bindGetRegion(bind, x, y, stripeWidth, stripeHeight) {
      calls.push(["bindGetRegion", bind, x, y, stripeWidth, stripeHeight]);
      liveFrame += 1;
      return encodedBgra(stripeWidth, stripeHeight, [boundFrame * 10, 20, 30, 255]);
    },
    getRegion() {
      calls.push(["getRegion"]);
      return "";
    },
  }, () => captureRegion(10, 20, width, height));

  assert.deepEqual(calls, [
    ["bindRegion", 10, 20, 256, 100],
    ["bindGetRegion", 7, 10, 20, 256, 64],
    ["bindGetRegion", 7, 10, 84, 256, 36],
  ]);
  assert.equal(image.width, width);
  assert.equal(image.height, height);
  assertSolidRgba(image, [10, 20, 30, 255]);
});

test("large fallback remains compatible when the Alt1 bind API is unavailable", () => {
  const calls = [];
  const width = 256;
  const height = 100;
  const image = withAlt1({
    maxtransfer: 65_536,
    getRegion(x, y, stripeWidth, stripeHeight) {
      calls.push([x, y, stripeWidth, stripeHeight]);
      return encodedBgra(stripeWidth, stripeHeight, [40, 50, 60, 255]);
    },
  }, () => captureRegion(10, 20, width, height));

  assert.deepEqual(calls, [
    [10, 20, 256, 64],
    [10, 84, 256, 36],
  ]);
  assertSolidRgba(image, [40, 50, 60, 255]);
});
