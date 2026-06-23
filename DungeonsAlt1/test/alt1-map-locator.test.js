import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_SIZES,
  RoomType,
  SIGNATURES,
  findMapByCorners,
  mapToImage,
  setPixel,
} from "../src/map-core.js";
import {
  MAP_ANCHOR,
  MAP_SCALE_CANDIDATES,
  findMapByAlt1Anchor,
  findMapByScaledCorners,
  mapCandidateFromAnchor,
  normalizeMapCapture,
  scoreMapCandidate,
  scaledFloorDimensions,
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

function scaleImageNearest(source, scale) {
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const target = image(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      target.data[to] = source.data[from];
      target.data[to + 1] = source.data[from + 1];
      target.data[to + 2] = source.data[from + 2];
      target.data[to + 3] = source.data[from + 3];
    }
  }
  return target;
}

test("mapCandidateFromAnchor converts the top-right anchor to client-relative map coordinates", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const candidate = mapCandidateFromAnchor({ x: 300, y: 20 }, floor);
  assert.equal(candidate.x, 300 - floor.imageWidth + MAP_ANCHOR.width);
  assert.equal(candidate.y, 20);
  assert.equal(candidate.scale, 1);
  assert.equal(candidate.captureWidth, floor.imageWidth);
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

test("scoreMapCandidate rejects one readable non-base room to avoid false map locks", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  paintSignature(target, mapToImage({ x: 0, y: 0 }, floor), signature);
  assert.equal(scoreMapCandidate(target, floor), null);
});

test("scaled corner detection and normalization supports 150 percent RuneScape UI scale", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const dimensions = scaledFloorDimensions(floor, 1.5);
  const fullClient = image(600, 500);
  const mapX = 40;
  const mapY = 30;
  const corner = [108, 96, 75, 255];
  setPixel(fullClient, mapX, mapY, corner);
  setPixel(fullClient, mapX, mapY + dimensions.height - 1, corner);
  setPixel(fullClient, mapX + dimensions.width - 1, mapY + dimensions.height - 1, corner);
  setPixel(fullClient, mapX + dimensions.width - 1, mapY, [122, 52, 44, 255]);

  const match = findMapByCorners(fullClient, { scales: [1, 1.5] });
  assert.equal(match.x, mapX);
  assert.equal(match.y, mapY);
  assert.equal(match.scale, 1.5);
  assert.equal(match.captureWidth, dimensions.width);

  const canonical = image(floor.imageWidth, floor.imageHeight);
  paintValidMapCorners(canonical);
  paintReadableRoom(canonical, floor);
  const normalized = normalizeMapCapture(scaleImageNearest(canonical, 1.5), floor, 1.5);
  const scored = scoreMapCandidate(normalized, floor);
  assert.equal(scored.gameMap.openedRoomCount, 1);
  assert.deepEqual(scored.gameMap.base, { x: 0, y: 0 });
});

test("scale candidates follow the desktop EXE 5 percent interface-scaling range", () => {
  assert.deepEqual(MAP_SCALE_CANDIDATES.slice(0, 2), [1, 1.5]);
  assert.ok(MAP_SCALE_CANDIDATES.includes(1.05));
  assert.ok(MAP_SCALE_CANDIDATES.includes(1.25));
  assert.ok(MAP_SCALE_CANDIDATES.includes(2));
});

test("EXE-style scaled corner locator uses the top-right run edge at 150 percent", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const dimensions = scaledFloorDimensions(floor, 1.5);
  const fullClient = image(700, 500);
  const mapX = 80;
  const mapY = 40;
  const right = mapX + dimensions.width - 1;
  const bottom = mapY + dimensions.height - 1;
  const corner = [108, 96, 75, 255];
  setPixel(fullClient, mapX, mapY, corner);
  setPixel(fullClient, mapX, bottom, corner);
  setPixel(fullClient, right, bottom, corner);
  setPixel(fullClient, right - 1, mapY, [122, 52, 44, 255]);
  setPixel(fullClient, right, mapY, [122, 52, 44, 255]);

  const canonical = image(floor.imageWidth, floor.imageHeight);
  paintValidMapCorners(canonical);
  paintReadableRoom(canonical, floor);
  const scaled = scaleImageNearest(canonical, 1.5);
  const calls = [];
  const match = findMapByScaledCorners(fullClient, (x, y, width, height) => {
    calls.push([x, y, width, height]);
    return x === mapX && y === mapY && width === dimensions.width && height === dimensions.height
      ? scaled
      : image(width, height);
  });

  assert.equal(match.x, mapX);
  assert.equal(match.y, mapY);
  assert.equal(match.scale, 1.5);
  assert.equal(match.readableRooms, 1);
  assert.deepEqual(calls[0], [mapX, mapY, dimensions.width, dimensions.height]);
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
