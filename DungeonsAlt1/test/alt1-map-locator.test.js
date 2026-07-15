import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_SIZES,
  ROOM_SIZE,
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
  readMapAtCalibration,
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

function paintOpenedRoom(target, floor, point = { x: 0, y: 0 }, { base = false } = {}) {
  const [signature] = [...SIGNATURES.entries()].find(([, type]) => type === RoomType.E);
  const origin = mapToImage(point, floor);
  paintSignature(target, origin, signature);
  if (base) setPixel(target, origin.x + 19, origin.y + 18, [150, 145, 105, 255]);
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

// Center-aligned bilinear 1.5x upscaler. A blended render shifts every sampled
// channel a few counts, which is exactly what defeats the exact 4-pixel room
// signature lookup on a non-100% RuneScape interface scale (the C#-proven bug).
function scaleImageBilinear(source, scale) {
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const target = image(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const wy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const wx = sourceX - x0;
      const to = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const p00 = source.data[(y0 * source.width + x0) * 4 + c];
        const p10 = source.data[(y0 * source.width + x1) * 4 + c];
        const p01 = source.data[(y1 * source.width + x0) * 4 + c];
        const p11 = source.data[(y1 * source.width + x1) * 4 + c];
        const top = p00 + (p10 - p00) * wx;
        const bottom = p01 + (p11 - p01) * wx;
        target.data[to + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return target;
}

// A high-frequency room texture: tile the room's 2x2 signature block across the
// whole 32x32 cell. Nearest-neighbour 1.5x round-trips this byte-exact, while a
// bilinear 1.5x render blurs it enough to defeat the exact signature lookup.
function paintTiledRoom(target, floor, point, type) {
  const [signature] = [...SIGNATURES.entries()].find(([, value]) => value === type);
  const colors = signature.split(";").map((color) => [...color.split(",").map(Number), 255]);
  const origin = mapToImage(point, floor);
  for (let y = 0; y < ROOM_SIZE; y += 1) {
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      // Sample order is [(6,7),(7,7),(6,8),(7,8)] -> odd row uses cols 0/1,
      // even row uses cols 2/3, so the exact sample pixels get their true colors.
      const index = (y & 1) === 1 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 2 : 3);
      setPixel(target, origin.x + x, origin.y + y, colors[index]);
    }
  }
}

const TILED_FIXTURE_ROOMS = [
  { point: { x: 0, y: 0 }, type: RoomType.E, base: true },
  { point: { x: 1, y: 0 }, type: RoomType.N },
  { point: { x: 2, y: 0 }, type: RoomType.E | RoomType.S },
  { point: { x: 0, y: 1 }, type: RoomType.N | RoomType.S },
];

function buildTiledFixture(floor) {
  const canonical = image(floor.imageWidth, floor.imageHeight);
  paintValidMapCorners(canonical);
  for (const room of TILED_FIXTURE_ROOMS) {
    paintTiledRoom(canonical, floor, room.point, room.type);
    if (room.base) {
      const origin = mapToImage(room.point, floor);
      setPixel(canonical, origin.x + 19, origin.y + 18, [150, 145, 105, 255]);
    }
  }
  return canonical;
}

test("mapCandidateFromAnchor converts the top-right anchor to client-relative map coordinates", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const candidate = mapCandidateFromAnchor({ x: 300, y: 20 }, floor);
  assert.equal(candidate.x, 300 - floor.imageWidth + MAP_ANCHOR.width);
  assert.equal(candidate.y, 20);
  assert.equal(candidate.scale, 1);
  assert.equal(candidate.captureWidth, floor.imageWidth);
});

function paintExeMapFrame(target) {
  const corner = [108, 96, 75, 255];
  setPixel(target, 0, 0, corner);
  setPixel(target, 0, target.height - 1, corner);
  setPixel(target, target.width - 1, target.height - 1, corner);
}

test("scoreMapCandidate rejects readable captures without the RuneScape map frame", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  paintReadableRoom(target, floor);

  assert.equal(scoreMapCandidate(target, floor), null);
});

test("scoreMapCandidate accepts the desktop EXE three-corner map frame without the top-right marker", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  paintExeMapFrame(target);
  paintReadableRoom(target, floor);

  const scored = scoreMapCandidate(target, floor);
  assert.equal(scored.validFrame, true);
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

test("scaled corner locator scores all candidates and ignores an earlier small false lock", () => {
  const small = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const large = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const fullClient = image(900, 700);
  const smallX = 40;
  const smallY = 20;
  const largeX = 120;
  const largeY = 220;
  const corner = [108, 96, 75, 255];

  for (const [x, y, floor] of [[smallX, smallY, small], [largeX, largeY, large]]) {
    setPixel(fullClient, x, y, corner);
    setPixel(fullClient, x, y + floor.imageHeight - 1, corner);
    setPixel(fullClient, x + floor.imageWidth - 1, y + floor.imageHeight - 1, corner);
    setPixel(fullClient, x + floor.imageWidth - 1, y, [122, 52, 44, 255]);
  }

  const falseLock = image(small.imageWidth, small.imageHeight);
  paintValidMapCorners(falseLock);
  paintOpenedRoom(falseLock, small, { x: 0, y: 0 }, { base: true });

  const realMap = image(large.imageWidth, large.imageHeight);
  paintValidMapCorners(realMap);
  paintOpenedRoom(realMap, large, { x: 0, y: 0 }, { base: true });
  paintOpenedRoom(realMap, large, { x: 1, y: 0 });
  paintOpenedRoom(realMap, large, { x: 2, y: 0 });
  paintOpenedRoom(realMap, large, { x: 3, y: 0 });

  const match = findMapByScaledCorners(fullClient, (x, y, width, height) => {
    if (x === smallX && y === smallY && width === small.imageWidth && height === small.imageHeight) return falseLock;
    if (x === largeX && y === largeY && width === large.imageWidth && height === large.imageHeight) return realMap;
    return image(width, height);
  }, { scales: [1], floors: [small, large], limit: 20 });

  assert.equal(match.x, largeX);
  assert.equal(match.y, largeY);
  assert.equal(match.floor.name, "Large");
  assert.equal(match.readableRooms, 4);
});

test("scaled corner locator does not stop before the real map after many earlier candidates", () => {
  const small = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const large = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const fullClient = image(700, 620);
  const corner = [108, 96, 75, 255];
  const falseCandidates = [];

  for (let index = 0; index < 105; index += 1) {
    const y = index;
    const right = 220 + ((index * 7) % 220);
    const x = right - small.imageWidth + 1;
    const bottom = y + small.imageHeight - 1;
    falseCandidates.push(`${x},${y},${small.imageWidth},${small.imageHeight}`);
    setPixel(fullClient, x, y, corner);
    setPixel(fullClient, x, bottom, corner);
    setPixel(fullClient, right, bottom, corner);
    setPixel(fullClient, right, y, [122, 52, 44, 255]);
  }

  const largeX = 350;
  const largeY = 300;
  const largeRight = largeX + large.imageWidth - 1;
  const largeBottom = largeY + large.imageHeight - 1;
  setPixel(fullClient, largeX, largeY, corner);
  setPixel(fullClient, largeX, largeBottom, corner);
  setPixel(fullClient, largeRight, largeBottom, corner);
  setPixel(fullClient, largeRight, largeY, [122, 52, 44, 255]);

  const falseLock = image(small.imageWidth, small.imageHeight);
  paintValidMapCorners(falseLock);
  paintOpenedRoom(falseLock, small, { x: 0, y: 0 }, { base: true });

  const realMap = image(large.imageWidth, large.imageHeight);
  paintValidMapCorners(realMap);
  paintOpenedRoom(realMap, large, { x: 0, y: 0 }, { base: true });
  paintOpenedRoom(realMap, large, { x: 1, y: 0 });
  paintOpenedRoom(realMap, large, { x: 2, y: 0 });
  paintOpenedRoom(realMap, large, { x: 3, y: 0 });
  paintOpenedRoom(realMap, large, { x: 4, y: 0 });

  const match = findMapByScaledCorners(fullClient, (x, y, width, height) => {
    const key = `${x},${y},${width},${height}`;
    if (falseCandidates.includes(key)) return falseLock;
    if (x === largeX && y === largeY && width === large.imageWidth && height === large.imageHeight) return realMap;
    return image(width, height);
  }, { scales: [1], floors: [small, large] });

  assert.equal(match.x, largeX);
  assert.equal(match.y, largeY);
  assert.equal(match.floor.name, "Large");
  assert.equal(match.readableRooms, 5);
});

test("readMapAtCalibration re-detects the floor size in place at the locked location", () => {
  const small = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const large = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const mapX = 60;
  const mapY = 40;

  // The map at the calibrated top-left is really Large, but the stored
  // calibration still believes it is Small. The desktop EXE recovers from this
  // by re-detecting the size at the same location every frame.
  const realLarge = image(large.imageWidth, large.imageHeight);
  paintValidMapCorners(realLarge);
  paintOpenedRoom(realLarge, large, { x: 0, y: 0 }, { base: true });
  paintOpenedRoom(realLarge, large, { x: 1, y: 0 });
  paintOpenedRoom(realLarge, large, { x: 2, y: 0 });

  const captureRegion = (x, y, width, height) =>
    (x === mapX && y === mapY && width === large.imageWidth && height === large.imageHeight
      ? realLarge
      : image(width, height));

  const read = readMapAtCalibration(captureRegion, { x: mapX, y: mapY, floor: small, scale: 1 });
  assert.ok(read);
  assert.equal(read.x, mapX);
  assert.equal(read.y, mapY);
  assert.equal(read.floor.name, "Large");
  assert.equal(read.gameMap.openedRoomCount, 3);
});

test("readMapAtCalibration keeps the locked floor when valid and returns null off the map", () => {
  const small = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const valid = image(small.imageWidth, small.imageHeight);
  paintValidMapCorners(valid);
  paintOpenedRoom(valid, small, { x: 0, y: 0 }, { base: true });

  const captureRegion = (x, y, width, height) =>
    (width === small.imageWidth && height === small.imageHeight ? valid : image(width, height));
  const read = readMapAtCalibration(captureRegion, { x: 10, y: 10, floor: small, scale: 1 });
  assert.ok(read);
  assert.equal(read.floor.name, "Small");

  assert.equal(readMapAtCalibration(() => image(2, 2), { x: 0, y: 0, floor: small, scale: 1 }), null);
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

test("findMapByAlt1Anchor rejects a marker-less three-corner candidate by default", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Large");
  const mapX = 35;
  const mapY = 20;
  const anchor = { x: mapX + floor.imageWidth - MAP_ANCHOR.width, y: mapY };
  const target = image(floor.imageWidth, floor.imageHeight);
  paintExeMapFrame(target); // three brown corners but NO top-right map marker
  paintReadableRoom(target, floor);
  const api = {
    rsWidth: 900,
    rsHeight: 600,
    bindRegion: () => "bind",
    bindFindSubImg: () => JSON.stringify([anchor]),
  };
  const captureRegion = (x, y, width, height) =>
    (x === mapX && y === mapY && width === floor.imageWidth && height === floor.imageHeight ? target : image(width, height));

  // Calibration must reject scenery that only shares the brown corner colour.
  assert.equal(findMapByAlt1Anchor(api, captureRegion), null);
  const relaxed = findMapByAlt1Anchor(api, captureRegion, { requireMarker: false });
  assert.ok(relaxed);
  assert.equal(relaxed.validCorners, false);
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

test("nearest-neighbour 1.5x tiled fixture reads every room exactly (regression pins the NN path)", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const canonical = buildTiledFixture(floor);
  const normalized = normalizeMapCapture(scaleImageNearest(canonical, 1.5), floor, 1.5);
  // Default options (no allowEmpty/tolerant): the NN round-trip is byte-exact so
  // the exact signature lookup still reads all four rooms.
  const scored = scoreMapCandidate(normalized, floor);
  assert.ok(scored);
  assert.equal(scored.gameMap.openedRoomCount, 4);
  assert.deepEqual(scored.gameMap.base, { x: 0, y: 0 });
  assert.equal(scored.gameMap.typeAt(0, 0), RoomType.E | RoomType.Base);
  assert.equal(scored.gameMap.typeAt(1, 0), RoomType.N);
  assert.equal(scored.gameMap.typeAt(2, 0), RoomType.E | RoomType.S);
  assert.equal(scored.gameMap.typeAt(0, 1), RoomType.N | RoomType.S);
});

test("bilinear 1.5x tiled fixture defeats the exact signature lookup with default options", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const canonical = buildTiledFixture(floor);
  const bilinear = normalizeMapCapture(scaleImageBilinear(canonical, 1.5), floor, 1.5);
  // Pins the old failure: blended rooms miss the exact 4-pixel lookup, so only a
  // lone uniform-colour room survives and the default one-room-non-base guard
  // rejects the whole capture (null) — calibration could never lock.
  assert.equal(scoreMapCandidate(bilinear, floor), null);
});

test("bilinear 1.5x tiled fixture is kept locked via allowEmpty with rooms unreadable", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const canonical = buildTiledFixture(floor);
  const bilinear = normalizeMapCapture(scaleImageBilinear(canonical, 1.5), floor, 1.5);
  const scored = scoreMapCandidate(bilinear, floor, { allowEmpty: true });
  assert.ok(scored);
  assert.equal(scored.validFrame, true);
  // Exact reading recovers far fewer than the four true rooms; allowEmpty keeps
  // the frame-valid scaled map locked anyway (C# MapForm.UpdateMap parity).
  assert.ok(scored.readableRooms < 4);
});

test("bilinear 1.5x tiled fixture classifies to true door layouts with allowEmpty + tolerant", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const canonical = buildTiledFixture(floor);
  const bilinear = normalizeMapCapture(scaleImageBilinear(canonical, 1.5), floor, 1.5);
  const scored = scoreMapCandidate(bilinear, floor, { allowEmpty: true, tolerant: true });
  assert.ok(scored);
  assert.equal(scored.gameMap.openedRoomCount, 4);
  assert.deepEqual(scored.gameMap.base, { x: 0, y: 0 });
  assert.equal(scored.gameMap.typeAt(1, 0), RoomType.N);
  assert.equal(scored.gameMap.typeAt(2, 0), RoomType.E | RoomType.S);
  assert.equal(scored.gameMap.typeAt(0, 1), RoomType.N | RoomType.S);
  // A never-painted background cell must not be hallucinated into a room.
  assert.equal(scored.gameMap.typeAt(3, 3), RoomType.Gap);
});

test("scoreMapCandidate at 100% still rejects an unreadable framed capture with default options", () => {
  const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");
  const target = image(floor.imageWidth, floor.imageHeight);
  paintValidMapCorners(target); // valid frame + top-right marker, but zero rooms
  // Bit-identical 100% behavior: allowEmpty defaults off, so an empty frame at
  // scale 1 is still rejected.
  assert.equal(scoreMapCandidate(target, floor), null);
});
