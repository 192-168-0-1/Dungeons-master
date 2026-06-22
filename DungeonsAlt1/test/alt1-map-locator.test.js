import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_SIZES,
  RoomType,
  SIGNATURES,
  mapToImage,
  setPixel,
} from "../src/map-core.js";
import {
  MAP_ANCHOR,
  findMapByAlt1Anchor,
  mapCandidateFromAnchor,
  scoreMapCandidate,
} from "../src/alt1-map-locator.js";

function image(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function paintSignature(target, origin, signature) {
  const colors = signature.split(";").map((color) => [...color.split(",").map(Number), 255]);
  [[6, 7], [7, 7], [6, 8], [7, 8]].forEach(([x, y], index) => {
    setPixel(target, origin.x + x, origin.y + y, colors[index]);
  });
}

function paintValidMapCorners(target) {
  const corner = [108, 96, 75, 255];
  setPixel(target, 0, 0, corner);
  setPixel(target, 0, target.height - 1, corner);
  setPixel(target, target.width - 1, target.height - 1, corner);
  setPixel(target, target.width - 1, 0, [122, 52, 44, 255]);
}

function paintReadableRoom(target, floor, point = { x: 0, y: 0 }) {
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage(point, floor);
  paintSignature(target, origin, signature);
  setPixel(target, origin.x + 19, origin.y + 18, [150, 145, 105, 255]);
}

test("mapCandidateFromAnchor converts the top-right anchor to client-relative map coordinates", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  assert.deepEqual(mapCandidateFromAnchor({ x: 300, y: 20 }, floor), {
    x: 300 - floor.imageWidth + MAP_ANCHOR.width,
    y: 20,
  });
});

test("scoreMapCandidate accepts a readable map even when corner colors are unavailable", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  paintReadableRoom(target, floor);

  const scored = scoreMapCandidate(target, floor);
  assert.equal(scored.validCorners, false);
  assert.equal(scored.readableRooms, 1);
  assert.equal(scored.gameMap.openedRoomCount, 1);
});

test("scoreMapCandidate rejects blank or mismatched captures", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  assert.equal(scoreMapCandidate(image(floor.imageWidth, floor.imageHeight), floor), null);
  assert.equal(scoreMapCandidate(image(floor.imageWidth + 1, floor.imageHeight), floor), null);
});

test("findMapByAlt1Anchor uses Alt1 template matching and validates the captured map", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const mapX = 35;
  const mapY = 20;
  const anchor = { x: mapX + floor.imageWidth - MAP_ANCHOR.width, y: mapY };
  const target = image(floor.imageWidth, floor.imageHeight);
  paintValidMapCorners(target);
  paintReadableRoom(target, floor);

  const calls = [];
  const api = {
    rsWidth: 900,
    rsHeight: 600,
    bindRegion(x, y, width, height) {
      calls.push(["bindRegion", x, y, width, height]);
      return "rs-bind";
    },
    bindFindSubImg(bind, icon, width, x, y, searchWidth, searchHeight) {
      calls.push(["bindFindSubImg", bind, icon, width, x, y, searchWidth, searchHeight]);
      return JSON.stringify([anchor]);
    },
  };
  const captureRegion = (x, y, width, height) => {
    calls.push(["captureRegion", x, y, width, height]);
    return x === mapX && y === mapY && width === floor.imageWidth && height === floor.imageHeight
      ? target
      : image(width, height);
  };

  const match = findMapByAlt1Anchor(api, captureRegion);
  assert.equal(match.x, mapX);
  assert.equal(match.y, mapY);
  assert.equal(match.floor.name, "Large");
  assert.equal(match.method, "anchor");
  assert.equal(match.validCorners, true);
  assert.equal(match.readableRooms, 1);
  assert.deepEqual(calls[0], ["bindRegion", 0, 0, 900, 600]);
  assert.equal(calls[1][0], "bindFindSubImg");
  assert.equal(calls[1][2], MAP_ANCHOR.icon);
});

test("findMapByAlt1Anchor safely falls back when the Alt1 bind API is missing or invalid", () => {
  assert.equal(findMapByAlt1Anchor({}, () => image(1, 1)), null);
  assert.equal(findMapByAlt1Anchor({
    rsWidth: 900,
    rsHeight: 600,
    bindRegion: () => "rs-bind",
    bindFindSubImg: () => "not json",
  }, () => image(1, 1)), null);
});
