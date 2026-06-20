import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_SIZES,
  RoomType,
  SIGNATURES,
  detectGatestones,
  findMapByCorners,
  mapToImage,
  readGameMap,
  readRoom,
  setPixel,
} from "../src/map-core.js";

function image(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function paintSignature(target, origin, signature) {
  const colors = signature.split(";").map((color) => [...color.split(",").map(Number), 255]);
  [[6, 7], [7, 7], [6, 8], [7, 8]].forEach(([x, y], index) => {
    setPixel(target, origin.x + x, origin.y + y, colors[index]);
  });
}

const BOSS_RED_PROBES = [
  [11, 5], [20, 5], [10, 6], [21, 6], [9, 8], [22, 8],
  [8, 11], [23, 11], [23, 13], [14, 18], [17, 18],
];
const BOSS_JAW_PROBES = [
  [13, 9], [18, 9], [8, 13], [11, 22], [20, 22], [14, 25], [17, 25],
];

function paintBossMarker(target, origin, offsetX, offsetY) {
  for (const [x, y] of BOSS_RED_PROBES) {
    setPixel(target, origin.x + x + offsetX, origin.y + y + offsetY, [63, 20, 13, 255]);
  }
  for (const [x, y] of BOSS_JAW_PROBES) {
    setPixel(target, origin.x + x + offsetX, origin.y + y + offsetY, [39, 32, 17, 255]);
  }
}

test("calibration finds a large map by its four corners", () => {
  const target = image(700, 500);
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const x = 123;
  const y = 47;
  const corner = [108, 96, 75, 255];
  setPixel(target, x, y, corner);
  setPixel(target, x, y + floor.imageHeight - 1, corner);
  setPixel(target, x + floor.imageWidth - 1, y + floor.imageHeight - 1, corner);
  setPixel(target, x + floor.imageWidth - 1, y, [122, 52, 44, 255]);

  const match = findMapByCorners(target);
  assert.equal(match.x, x);
  assert.equal(match.y, y);
  assert.equal(match.floor.name, "Large");
});

test("room reader reuses the C# pixel signatures and detects base", () => {
  const target = image(32, 32);
  const [signature, type] = SIGNATURES.entries().next().value;
  paintSignature(target, { x: 0, y: 0 }, signature);
  setPixel(target, 19, 18, [150, 145, 105, 255]);

  assert.equal(readRoom(target, 0, 0), type | RoomType.Base);
});

test("game map counts opened rooms and detects a personal gatestone", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, origin, signature);
  setPixel(target, origin.x + 19, origin.y + 18, [150, 145, 105, 255]);
  setPixel(target, origin.x + 9, origin.y + 9, [20, 120, 110, 255]);
  setPixel(target, origin.x + 10, origin.y + 9, [20, 120, 110, 255]);
  setPixel(target, origin.x + 11, origin.y + 9, [20, 120, 110, 255]);

  const gameMap = readGameMap(target, floor);
  assert.equal(gameMap.openedRoomCount, 1);
  assert.deepEqual(gameMap.base, { x: 0, y: 0 });
  assert.deepEqual(detectGatestones(target, gameMap)[1], { x: 0, y: 0 });
});

test("boss-room red pixels are not detected as G2", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, origin, signature);
  setPixel(target, origin.x + 8, origin.y + 11, [63, 20, 13, 255]);
  setPixel(target, origin.x + 9, origin.y + 9, [80, 20, 25, 255]);
  setPixel(target, origin.x + 10, origin.y + 9, [80, 20, 25, 255]);
  setPixel(target, origin.x + 11, origin.y + 9, [80, 20, 25, 255]);

  const gameMap = readGameMap(target, floor);
  assert.ok(gameMap.typeAt(0, 0) & RoomType.Boss);
  assert.equal(detectGatestones(target, gameMap)[2], undefined);
});

test("shifted boss skulls are excluded from G2 detection", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);

  for (const [offsetX, offsetY] of [[-2, -1], [-1, 2], [1, -2], [2, 1]]) {
    const target = image(floor.imageWidth, floor.imageHeight);
    const origin = mapToImage({ x: 0, y: 0 }, floor);
    paintSignature(target, origin, signature);
    paintBossMarker(target, origin, offsetX, offsetY);

    const gameMap = readGameMap(target, floor);
    assert.ok(gameMap.typeAt(0, 0) & RoomType.Boss,
      `boss marker at offset ${offsetX},${offsetY} should classify the room as boss`);
    assert.equal(detectGatestones(target, gameMap)[2], undefined);
  }
});

test("player-arrow pixels are excluded while real G2 pixels remain detectable", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);

  const arrowImage = image(floor.imageWidth, floor.imageHeight);
  const arrowOrigin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(arrowImage, arrowOrigin, signature);
  for (const x of [9, 10, 11]) setPixel(arrowImage, arrowOrigin.x + x, arrowOrigin.y + 9, [100, 30, 10, 255]);
  assert.equal(detectGatestones(arrowImage, readGameMap(arrowImage, floor))[2], undefined);

  const gateImage = image(floor.imageWidth, floor.imageHeight);
  const gateOrigin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(gateImage, gateOrigin, signature);
  for (const x of [9, 10, 11]) setPixel(gateImage, gateOrigin.x + x, gateOrigin.y + 9, [80, 20, 25, 255]);
  assert.deepEqual(detectGatestones(gateImage, readGameMap(gateImage, floor))[2], { x: 0, y: 0 });
});

test("group-gatestone palette pixels are not detected as personal G1", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, origin, signature);

  // Bucket 0x05080A occurs in GroupGatestone.png and also satisfies the broad
  // teal G1 range. It must lower the score rather than create a false G1.
  for (const x of [9, 10, 11, 12]) setPixel(target, origin.x + x, origin.y + 9, [80, 128, 160, 255]);

  assert.equal(detectGatestones(target, readGameMap(target, floor))[1], undefined);
});
