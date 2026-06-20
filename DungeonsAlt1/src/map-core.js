export const ROOM_SIZE = 32;

export const RoomType = Object.freeze({
  Gap: 0,
  E: 1,
  N: 2,
  S: 4,
  W: 8,
  Mystery: 16,
  Crit: 32,
  Base: 64,
  Boss: 128,
});

export const FLOOR_SIZES = Object.freeze([
  Object.freeze({ name: "Small", width: 4, height: 4, imageWidth: 152, imageHeight: 152 }),
  Object.freeze({ name: "Medium", width: 4, height: 8, imageWidth: 152, imageHeight: 280 }),
  Object.freeze({ name: "Large", width: 8, height: 8, imageWidth: 280, imageHeight: 280 }),
]);

const MAP_CORNER_MIN = [100, 87, 65];
const MAP_CORNER_MAX = [117, 104, 83];
const MAP_CORNER_TOLERANCE = 8;
const MAP_TOP_RIGHT = [122, 52, 44];
const MAP_TOP_RIGHT_DISTANCE = 900;

const SIGNATURE_ROWS = [
  ["RoomE", "90,65,30;128,94,46;114,84,41;132,98,49"],
  ["RoomEN", "132,98,49;140,105,52;132,98,49;137,102,50"],
  ["RoomENS", "108,81,41;132,98,49;108,81,41;132,98,49"],
  ["RoomENSW", "112,82,38;123,91,45;112,82,38;123,91,45"],
  ["RoomENW", "132,98,49;128,95,48;137,102,50;108,81,41"],
  ["RoomES", "114,84,41;118,88,43;140,106,57;140,106,57"],
  ["RoomESW", "114,84,41;140,105,52;112,82,38;144,107,54"],
  ["RoomEW", "140,105,52;123,91,45;140,105,52;140,105,52"],
  ["RoomN", "123,93,49;123,93,49;123,93,49;123,93,49"],
  ["RoomNS", "140,105,52;129,96,46;140,105,52;123,91,45"],
  ["RoomNSW", "123,91,45;137,102,50;132,98,49;140,105,52"],
  ["RoomNW", "117,89,48;140,106,57;140,106,57;140,106,57"],
  ["RoomS", "132,98,49;132,98,49;129,96,46;123,91,45"],
  ["RoomSW", "123,91,45;114,84,41;114,84,41;105,77,36"],
  ["RoomW", "137,102,50;118,88,43;114,84,41;137,102,50"],
  ["CritE", "115,83,35;170,125,52;138,101,42;156,115,49"],
  ["CritEN", "161,118,49;164,124,57;172,131,58;172,131,58"],
  ["CritENS", "141,104,44;164,121,51;147,107,45;172,131,58"],
  ["CritENSW", "147,107,45;164,121,51;138,101,42;146,108,50"],
  ["CritENW", "170,125,52;161,118,49;176,133,56;147,107,45"],
  ["CritES", "141,105,49;156,115,49;172,131,58;165,129,61"],
  ["CritESW", "147,107,45;179,138,59;138,101,42;172,131,58"],
  ["CritEW", "164,124,57;146,108,50;172,131,58;172,131,58"],
  ["CritN", "155,118,57;155,118,57;172,131,58;168,126,56"],
  ["CritNS", "164,121,51;161,118,49;172,131,58;161,118,49"],
  ["CritNSW", "156,115,49;173,129,54;173,129,54;179,138,59"],
  ["CritNW", "146,108,50;172,131,58;172,131,58;172,131,58"],
  ["CritS", "164,121,51;164,121,51;170,125,52;161,118,49"],
  ["CritSW", "146,108,50;147,107,45;147,107,45;132,97,43"],
  ["CritW", "173,129,54;149,112,51;152,110,45;172,131,58"],
  ["MysteryE", "75,53,24;69,49,21;61,42,16;93,68,33"],
  ["MysteryN", "75,53,24;54,38,16;61,42,16;65,45,19"],
  ["MysteryS", "105,77,36;96,70,33;100,73,35;75,53,24"],
  ["MysteryW", "109,80,38;78,56,25;93,68,33;73,52,22"],
];

function typeFromResourceName(name) {
  let type = name.startsWith("Crit") ? RoomType.Crit : name.startsWith("Mystery") ? RoomType.Mystery : 0;
  const directions = name.replace(/^(Room|Crit|Mystery)/, "");
  if (directions.includes("E")) type |= RoomType.E;
  if (directions.includes("N")) type |= RoomType.N;
  if (directions.includes("S")) type |= RoomType.S;
  if (directions.includes("W")) type |= RoomType.W;
  return type;
}

export const SIGNATURES = new Map(SIGNATURE_ROWS.map(([name, signature]) => [signature, typeFromResourceName(name)]));

function indexOf(image, x, y) {
  return (y * image.width + x) * 4;
}

export function getPixel(image, x, y) {
  if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height) return [0, 0, 0, 0];
  const index = indexOf(image, x, y);
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]];
}

export function setPixel(image, x, y, color) {
  const index = indexOf(image, x, y);
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = color.length > 3 ? color[3] : 255;
}

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function isMapCornerColor(color) {
  return color[0] >= MAP_CORNER_MIN[0] - MAP_CORNER_TOLERANCE
    && color[0] <= MAP_CORNER_MAX[0] + MAP_CORNER_TOLERANCE
    && color[1] >= MAP_CORNER_MIN[1] - MAP_CORNER_TOLERANCE
    && color[1] <= MAP_CORNER_MAX[1] + MAP_CORNER_TOLERANCE
    && color[2] >= MAP_CORNER_MIN[2] - MAP_CORNER_TOLERANCE
    && color[2] <= MAP_CORNER_MAX[2] + MAP_CORNER_TOLERANCE;
}

export function isMapTopRightColor(color) {
  return colorDistance(color, MAP_TOP_RIGHT) <= MAP_TOP_RIGHT_DISTANCE;
}

export function isValidMap(image) {
  return Boolean(image)
    && isMapCornerColor(getPixel(image, 0, 0))
    && isMapCornerColor(getPixel(image, 0, image.height - 1))
    && isMapCornerColor(getPixel(image, image.width - 1, image.height - 1))
    && isMapTopRightColor(getPixel(image, image.width - 1, 0));
}

function isMapCornerAt(image, x, y) {
  const index = indexOf(image, x, y);
  return image.data[index] >= MAP_CORNER_MIN[0] - MAP_CORNER_TOLERANCE
    && image.data[index] <= MAP_CORNER_MAX[0] + MAP_CORNER_TOLERANCE
    && image.data[index + 1] >= MAP_CORNER_MIN[1] - MAP_CORNER_TOLERANCE
    && image.data[index + 1] <= MAP_CORNER_MAX[1] + MAP_CORNER_TOLERANCE
    && image.data[index + 2] >= MAP_CORNER_MIN[2] - MAP_CORNER_TOLERANCE
    && image.data[index + 2] <= MAP_CORNER_MAX[2] + MAP_CORNER_TOLERANCE;
}

function isMapTopRightAt(image, x, y) {
  const index = indexOf(image, x, y);
  const dr = image.data[index] - MAP_TOP_RIGHT[0];
  const dg = image.data[index + 1] - MAP_TOP_RIGHT[1];
  const db = image.data[index + 2] - MAP_TOP_RIGHT[2];
  return dr * dr + dg * dg + db * db <= MAP_TOP_RIGHT_DISTANCE;
}

export function findMapByCorners(image) {
  if (!image) return null;

  for (let y = 0; y < image.height; y += 1) {
    for (let rightX = 0; rightX < image.width; rightX += 1) {
      if (!isMapTopRightAt(image, rightX, y)) continue;
      for (const floor of FLOOR_SIZES) {
        const x = rightX - floor.imageWidth + 1;
        const bottomY = y + floor.imageHeight - 1;
        if (x < 0 || bottomY >= image.height) continue;
        if (isMapCornerAt(image, x, y)
          && isMapCornerAt(image, x, bottomY)
          && isMapCornerAt(image, rightX, bottomY)) {
          return { x, y, floor };
        }
      }
    }
  }

  return null;
}

export function gridOffset(floor) {
  return {
    x: Math.floor((floor.imageWidth - floor.width * ROOM_SIZE) / 2),
    y: Math.floor((floor.imageHeight - floor.height * ROOM_SIZE) / 2),
  };
}

export function mapToImage(point, floor) {
  const offset = gridOffset(floor);
  return {
    x: point.x * ROOM_SIZE + offset.x,
    y: (floor.height - point.y - 1) * ROOM_SIZE + offset.y,
  };
}

export function imageToMap(point, floor) {
  const offset = gridOffset(floor);
  const x = Math.floor((point.x - offset.x) / ROOM_SIZE);
  const y = floor.height - Math.floor((point.y - offset.y) / ROOM_SIZE) - 1;
  return x >= 0 && x < floor.width && y >= 0 && y < floor.height ? { x, y } : null;
}

function signatureAt(image, originX, originY) {
  return [[6, 7], [7, 7], [6, 8], [7, 8]]
    .map(([x, y]) => getPixel(image, originX + x, originY + y).slice(0, 3).join(","))
    .join(";");
}

export function readRoom(image, originX, originY) {
  let type = SIGNATURES.get(signatureAt(image, originX, originY)) ?? RoomType.Gap;
  const base = getPixel(image, originX + 19, originY + 18);
  const boss = getPixel(image, originX + 8, originY + 11);
  if (base[0] === 150 && base[1] === 145 && base[2] === 105) type |= RoomType.Base;
  else if (boss[0] === 63 && boss[1] === 20 && boss[2] === 13) type |= RoomType.Boss;
  return type;
}

export function isOpened(type) {
  return type > 0 && (type & RoomType.Mystery) === 0;
}

function key(point) {
  return `${point.x},${point.y}`;
}

function inRange(point, floor) {
  return point.x >= 0 && point.x < floor.width && point.y >= 0 && point.y < floor.height;
}

const DIRECTIONS = [
  { bit: RoomType.W, dx: -1, dy: 0 },
  { bit: RoomType.E, dx: 1, dy: 0 },
  { bit: RoomType.S, dx: 0, dy: -1 },
  { bit: RoomType.N, dx: 0, dy: 1 },
];

export function readGameMap(image, floor) {
  const roomTypes = new Array(floor.width * floor.height).fill(RoomType.Gap);
  let openedRoomCount = 0;
  let mysteryCount = 0;
  let deadEndCount = 0;
  let base = null;
  let boss = null;
  const critEndpoints = [];

  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const origin = mapToImage({ x, y }, floor);
      const type = readRoom(image, origin.x, origin.y);
      roomTypes[y * floor.width + x] = type;
      if (isOpened(type)) {
        openedRoomCount += 1;
        if (type & RoomType.Crit) critEndpoints.push({ x, y });
        if (type & RoomType.Base) base = { x, y };
        else if (type & RoomType.Boss) boss = { x, y };
        const exits = DIRECTIONS.reduce((count, direction) => count + ((type & direction.bit) ? 1 : 0), 0);
        if (exits === 1 && !(type & (RoomType.Base | RoomType.Boss))) deadEndCount += 1;
      } else if (type & RoomType.Mystery) {
        mysteryCount += 1;
      }
    }
  }

  const parent = new Map();
  const visited = new Set();
  const visit = (point, previous) => {
    if (!inRange(point, floor) || visited.has(key(point))) return;
    visited.add(key(point));
    if (previous) parent.set(key(point), previous);
    const type = roomTypes[point.y * floor.width + point.x];
    for (const direction of DIRECTIONS) {
      if (type & direction.bit) {
        visit({ x: point.x + direction.dx, y: point.y + direction.dy }, point);
      }
    }
  };
  if (base) visit(base, null);

  const criticalPath = new Set();
  const traceToBase = (start) => {
    let current = start;
    for (let guard = 0; current && guard < floor.width * floor.height; guard += 1) {
      criticalPath.add(key(current));
      if (base && current.x === base.x && current.y === base.y) break;
      current = parent.get(key(current)) ?? null;
    }
  };
  for (const endpoint of critEndpoints) traceToBase(endpoint);
  if (boss) traceToBase(boss);

  return {
    floor,
    roomTypes,
    openedRoomCount,
    mysteryCount,
    deadEndCount,
    base,
    boss,
    critEndpoints,
    criticalPath,
    parent,
    isComplete: openedRoomCount > 0 && mysteryCount === 0,
    typeAt(x, y) {
      return inRange({ x, y }, floor) ? roomTypes[y * floor.width + x] : RoomType.Gap;
    },
  };
}

function isFirstGatestonePixel(color) {
  return color[3] > 200
    && color[0] <= 105
    && color[1] >= 85 && color[1] <= 190
    && color[2] >= 70 && color[2] <= 180
    && color[1] - color[0] >= 30
    && color[2] >= color[1] - 25 && color[2] <= color[1] + 35;
}

function isSecondGatestonePixel(color) {
  return color[3] > 200
    && color[0] >= 35 && color[0] <= 125
    && color[1] <= 45
    && color[2] >= 8 && color[2] <= 45
    && color[0] - color[1] >= 20
    && color[0] - color[2] >= 20;
}

function isPlayerArrowPixel(color) {
  return color[3] > 200 && color[0] >= 95 && color[1] >= 20 && color[1] <= 85
    && color[2] <= 12 && color[0] - color[1] >= 55;
}

function isBrightMapMarkerPixel(color) {
  const max = Math.max(color[0], color[1], color[2]);
  const min = Math.min(color[0], color[1], color[2]);
  return color[3] > 200 && max >= 175 && max - min >= 85;
}

// Quantized from Common/Resources/Gatestones/GroupGatestone.png. Group
// gatestones and cyan player arrows overlap the broad G1 color range, so
// these colors must reduce the personal-gatestone score instead of raising it.
const GROUP_GATESTONE_PALETTE = new Set([
  0x020405, 0x030405, 0x030406, 0x030506, 0x030507, 0x040507, 0x040607,
  0x040608, 0x040609, 0x040708, 0x040709, 0x050608, 0x050708, 0x050709,
  0x05070A, 0x05080A, 0x05080B, 0x060709, 0x060809, 0x06080A, 0x06080B,
  0x06090B, 0x06090C, 0x060A0C, 0x060A0D, 0x07080A, 0x07080B, 0x07090A,
  0x07090B, 0x07090C, 0x070A0C, 0x070A0D, 0x080A0C, 0x080A0D, 0x080B0D,
  0x080B0E, 0x090B0E,
]);

function isPaletteCandidatePixel(color) {
  const max = Math.max(color[0], color[1], color[2]);
  const min = Math.min(color[0], color[1], color[2]);
  return color[3] > 160 && max >= 35 && max <= 220 && max - min >= 25;
}

function quantizePaletteColor(color) {
  return (Math.floor(color[0] / 16) << 16)
    | (Math.floor(color[1] / 16) << 8)
    | Math.floor(color[2] / 16);
}

function isGroupGatestonePixel(color) {
  return isPaletteCandidatePixel(color) && GROUP_GATESTONE_PALETTE.has(quantizePaletteColor(color));
}

export function detectGatestones(image, gameMap) {
  const best = { 1: null, 2: null };
  for (let y = 0; y < gameMap.floor.height; y += 1) {
    for (let x = 0; x < gameMap.floor.width; x += 1) {
      const roomType = gameMap.typeAt(x, y);
      // The dark red boss marker shares colors with G2. A personal gatestone
      // is not useful in the boss room, so exclude that room completely.
      if (!isOpened(roomType) || (roomType & RoomType.Boss)) continue;
      const origin = mapToImage({ x, y }, gameMap.floor);
      let one = 0;
      let two = 0;
      for (let py = origin.y + 8; py < origin.y + ROOM_SIZE - 5; py += 1) {
        for (let px = origin.x + 8; px < origin.x + ROOM_SIZE - 8; px += 1) {
          const color = getPixel(image, px, py);
          if (isFirstGatestonePixel(color)) one += 1;
          if (isSecondGatestonePixel(color)) two += 1;
          if (isBrightMapMarkerPixel(color)) { one -= 2; two -= 2; }
          if (isPlayerArrowPixel(color)) two -= 4;
          if (isGroupGatestonePixel(color)) one -= 2;
        }
      }
      if (!best[1] || one > best[1].score) best[1] = { x, y, score: Math.max(0, one) };
      if (!best[2] || two > best[2].score) best[2] = { x, y, score: Math.max(0, two) };
    }
  }

  return Object.fromEntries(Object.entries(best)
    .filter(([, value]) => value && value.score >= 3)
    .map(([gatestone, value]) => [gatestone, { x: value.x, y: value.y }]));
}

export function toChess(point) {
  return point ? `${String.fromCharCode(97 + point.x)}${point.y + 1}` : "-";
}
