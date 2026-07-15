import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_SIZES,
  RoomType,
  SIGNATURES,
  detectGatestones,
  findMapCandidatesByCorners,
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

function paintBossMarker(target, origin, offsetX, offsetY, {
  redCount = BOSS_RED_PROBES.length,
  jawColor = [39, 32, 17, 255], jawCount = BOSS_JAW_PROBES.length,
} = {}) {
  for (const [x, y] of BOSS_RED_PROBES.slice(0, redCount)) {
    setPixel(target, origin.x + x + offsetX, origin.y + y + offsetY, [63, 20, 13, 255]);
  }
  for (const [x, y] of BOSS_JAW_PROBES.slice(0, jawCount)) {
    setPixel(target, origin.x + x + offsetX, origin.y + y + offsetY, jawColor);
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
  setPixel(target, origin.x + 9, origin.y + 9, [70, 118, 105, 255]);
  setPixel(target, origin.x + 10, origin.y + 9, [85, 130, 118, 255]);
  setPixel(target, origin.x + 11, origin.y + 9, [100, 146, 132, 255]);

  const gameMap = readGameMap(target, floor);
  assert.equal(gameMap.openedRoomCount, 1);
  assert.deepEqual(gameMap.base, { x: 0, y: 0 });
  assert.deepEqual(detectGatestones(target, gameMap)[1], { x: 0, y: 0 });
});

test("readGameMap counts doors pointing at empty cells as unexplored rooms", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const signatureForType = (type) => [...SIGNATURES.entries()].find(([, value]) => value === type)[0];

  // Two connected opened rooms: A(0,0) has E (to B) and N (into empty (0,1));
  // B(1,0) has W back to A. Only A's N door opens onto a Gap cell -> count 1.
  const connected = image(floor.imageWidth, floor.imageHeight);
  paintSignature(connected, mapToImage({ x: 0, y: 0 }, floor), signatureForType(RoomType.E | RoomType.N));
  paintSignature(connected, mapToImage({ x: 1, y: 0 }, floor), signatureForType(RoomType.W));
  const connectedMap = readGameMap(connected, floor);
  assert.equal(connectedMap.openedRoomCount, 2);
  assert.equal(connectedMap.unexploredRoomCount, 1);

  // Two separate opened rooms whose doors both point at the SAME empty cell
  // (0,1): A(0,0) with N and C(0,2) with S. The shared cell counts once.
  const shared = image(floor.imageWidth, floor.imageHeight);
  paintSignature(shared, mapToImage({ x: 0, y: 0 }, floor), signatureForType(RoomType.N));
  paintSignature(shared, mapToImage({ x: 0, y: 2 }, floor), signatureForType(RoomType.S));
  const sharedMap = readGameMap(shared, floor);
  assert.equal(sharedMap.openedRoomCount, 2);
  assert.equal(sharedMap.unexploredRoomCount, 1);
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

test("corner calibration can return multiple candidates for scoring", () => {
  const target = image(700, 500);
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const corner = [108, 96, 75, 255];
  for (const [x, y] of [[40, 20], [300, 80]]) {
    setPixel(target, x, y, corner);
    setPixel(target, x, y + floor.imageHeight - 1, corner);
    setPixel(target, x + floor.imageWidth - 1, y + floor.imageHeight - 1, corner);
    setPixel(target, x + floor.imageWidth - 1, y, [122, 52, 44, 255]);
  }

  const candidates = findMapCandidatesByCorners(target, { limit: 5 });
  assert.deepEqual(candidates.map(({ x, y }) => ({ x, y })), [
    { x: 40, y: 20 },
    { x: 300, y: 80 },
  ]);
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

test("far-shifted and brighter live boss skull variants are excluded from G2", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const variants = [
    { offsetX: -4, offsetY: 1, redCount: 8, jawColor: [72, 52, 30, 255], jawCount: 2 },
    { offsetX: 3, offsetY: -4, redCount: 10, jawColor: [86, 58, 35, 255], jawCount: 0 },
  ];

  for (const variant of variants) {
    const target = image(floor.imageWidth, floor.imageHeight);
    const origin = mapToImage({ x: 0, y: 0 }, floor);
    paintSignature(target, origin, signature);
    paintBossMarker(target, origin, variant.offsetX, variant.offsetY, variant);

    const gameMap = readGameMap(target, floor);
    assert.ok(gameMap.typeAt(0, 0) & RoomType.Boss,
      `live boss variant at ${variant.offsetX},${variant.offsetY} should classify the room as boss`);
    assert.equal(detectGatestones(target, gameMap)[2], undefined);
  }
});

test("a dense compact G2 cluster is not mistaken for a boss skull", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, origin, signature);
  const gateColors = [[55, 35, 25, 255], [70, 35, 35, 255], [115, 35, 35, 255]];
  for (let y = 10; y <= 14; y += 1) {
    for (let x = 10; x <= 14; x += 1) {
      setPixel(target, origin.x + x, origin.y + y, gateColors[(x + y) % gateColors.length]);
    }
  }

  const gameMap = readGameMap(target, floor);
  assert.equal(Boolean(gameMap.typeAt(0, 0) & RoomType.Boss), false);
  assert.deepEqual(detectGatestones(target, gameMap)[2], { x: 0, y: 0 });
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
  [[55, 35, 25, 255], [70, 35, 35, 255], [115, 35, 35, 255]].forEach((color, index) => {
    setPixel(gateImage, gateOrigin.x + 9 + index, gateOrigin.y + 9, color);
  });
  assert.deepEqual(detectGatestones(gateImage, readGameMap(gateImage, floor))[2], { x: 0, y: 0 });
});

test("a cyan player arrow cannot satisfy the personal G1 palette evidence", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, origin, signature);

  for (let row = 0; row < 7; row += 1) {
    for (let column = row; column < 12 - row; column += 1) {
      setPixel(target, origin.x + 9 + column, origin.y + 8 + row, [20, 130, 145, 255]);
    }
  }

  assert.equal(detectGatestones(target, readGameMap(target, floor))[1], undefined);
});

test("boss palette evidence finds a skull away from the old fixed probes", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, origin, signature);
  [[63, 20, 13, 255], [82, 26, 17, 255], [102, 31, 21, 255], [132, 57, 46, 255]]
    .forEach((color, index) => setPixel(target, origin.x + 24, origin.y + 20 + index, color));

  const gameMap = readGameMap(target, floor);
  assert.ok(gameMap.typeAt(0, 0) & RoomType.Boss);
  assert.equal(detectGatestones(target, gameMap)[2], undefined);
});

test("readGameMap tolerant=false is bit-identical to the default on the canonical fixture", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  const signatureForType = (type) => [...SIGNATURES.entries()].find(([, value]) => value === type)[0];
  const baseOrigin = mapToImage({ x: 0, y: 0 }, floor);
  paintSignature(target, baseOrigin, signatureForType(RoomType.E));
  setPixel(target, baseOrigin.x + 19, baseOrigin.y + 18, [150, 145, 105, 255]);
  paintSignature(target, mapToImage({ x: 1, y: 0 }, floor), signatureForType(RoomType.N));
  paintSignature(target, mapToImage({ x: 2, y: 0 }, floor), signatureForType(RoomType.E | RoomType.S));

  const defaultRead = readGameMap(target, floor);
  const flaggedRead = readGameMap(target, floor, { tolerant: false });
  // Present-but-false flag must not perturb any classification output.
  assert.deepEqual(flaggedRead.roomTypes, defaultRead.roomTypes);
  assert.equal(flaggedRead.openedRoomCount, defaultRead.openedRoomCount);
  assert.equal(flaggedRead.mysteryCount, defaultRead.mysteryCount);
  assert.deepEqual(flaggedRead.base, defaultRead.base);
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
