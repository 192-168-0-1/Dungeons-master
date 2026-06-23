import {
  FLOOR_SIZES,
  isValidMap,
  readGameMap,
} from "./map-core.js";

// Anchor-based map location adapted from Sleepy-meh-alt-1/dg-map with
// permission relayed by this project's maintainer. The anchor is the fixed
// 15px top-right minimap decoration, which is more stable than sampling every
// map border pixel on scaled RuneScape interfaces.
export const MAP_ANCHOR = Object.freeze({
  icon: "ICVs/yAlbP8cIWX/HCFl/xwhZf8cIWX/HCFl/xwhZf8cIWX/HCFl/xwhZf8cIWX/HCFl/yAlbP8oMXv/KDF7/ygxe/8jKWv/Iylr/ycudP8oMXv/KDF7/ygxe/8oMXv/KDF7/ycudP8jKWv/Iylr/yw0gf8tOIT/LTiD/y45i/+Rzuj/YYWv/ys1ff8tOIT/LjmL/y45i/8uOYv/LTiE/ys1ff9hha//kc/o/y46i/8tOIT/KzV9/zNAjv9ihrb/kc/o/1yCrP8nLnT/KzV9/y04hP8rNX3/Jy50/1yCrP+Rz+j/Yoa2/zNAjv8rNX3/KDF7/y04hP85Qof/Yoa2/4jF4P9afab/JS1t/ycudP8lLW3/Wn2m/4jF4P9ihrb/OUKH/y45i/8oMXv/Jy50/yUzg/8rNX3/OUB9/1yCrP+Bvdr/VXih/yUpWv9VeKH/gb3a/1yCrP85QH3/KzV9/yUzg/8nLnT/JS1t/ygxe/8oMXv/MDd2/zA3dv9VeKH/ebXT/1+YvP95tdP/VXih/zA3dv8wN3b/KDF7/ygxe/8lLW3/Iylr/ycudP8nLnT/JS1t/yUtbf8jKWv/XY20/3CtzP9djbT/Iylr/yMpa/8lLW3/Jy50/ycudP8jKWv/ISdk/yAncv8jKWv/ISdk/yAjW/9BYoz/ZqLF/1yCrP9mosX/QWKM/yAjW/8hJ2T/Iylr/yAncv8hJ2T/ICNb/yAlbP8hJ2T/HB9T/0FijP9fmLz/R2mR/zk9ZP9HaZH/X5i8/0FijP8cH1P/ISdk/yMpa/8gI1v/Gx5Y/xwhZf8cH1P/PFyH/1SRuP9BYoz/Ky5d/ysuXf8rLl3/QWKM/1SRuP88XIf/HB9T/xwhZf8bHlj/HB9T/xseWP81VYX/TYmx/zxch/8rLl3/ICNb/xseWP8lKVr/Ky5d/zxch/9NibH/NVWF/xseWP8cH1P/FRtK/yEnZP9Fg6z/PFyH/ysuXf8gI1v/Gx5Y/xseWP8bHlj/ICNb/yUpWv88XIf/RYOs/yAlbP8VG0r/FRtK/ykpYv8pKWL/KSli/xseWP8bHlj/Gx5Y/xseWP8bHlj/Gx5Y/xseWP8pKWL/KSli/ykpYv8YGUf/FRRB/xUUQf8VFEH/FRRB/xUUQf8VFEH/FRRB/xUUQf8VFEH/FRRB/xUUQf8VFEH/FRRB/xUUQf8VFEH/",
  width: 15,
});

export const MAP_SCALE_CANDIDATES = Object.freeze([1, 1.25, 1.5, 1.75, 2]);

export function scaledFloorDimensions(floor, scale = 1) {
  const value = Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) : 1;
  return {
    width: Math.round(floor.imageWidth * value),
    height: Math.round(floor.imageHeight * value),
    scale: value,
  };
}

export function normalizeMapCapture(image, floor, scale = 1) {
  if (!image || !floor) return image;
  const normalizedScale = Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) : 1;
  if (normalizedScale === 1
    && image.width === floor.imageWidth
    && image.height === floor.imageHeight) {
    return image;
  }

  const data = new Uint8ClampedArray(floor.imageWidth * floor.imageHeight * 4);
  const xRatio = image.width / floor.imageWidth;
  const yRatio = image.height / floor.imageHeight;
  for (let y = 0; y < floor.imageHeight; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * yRatio));
    for (let x = 0; x < floor.imageWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * xRatio));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * floor.imageWidth + x) * 4;
      data[target] = image.data[source];
      data[target + 1] = image.data[source + 1];
      data[target + 2] = image.data[source + 2];
      data[target + 3] = image.data[source + 3];
    }
  }
  if (typeof ImageData === "function") return new ImageData(data, floor.imageWidth, floor.imageHeight);
  return { width: floor.imageWidth, height: floor.imageHeight, data };
}

function parseMatches(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function withinClient(candidate, floor, clientWidth, clientHeight) {
  return candidate.x >= 0
    && candidate.y >= 0
    && candidate.x + floor.imageWidth <= clientWidth
    && candidate.y + floor.imageHeight <= clientHeight;
}

export function mapCandidateFromAnchor(anchor, floor) {
  return mapCandidateFromScaledAnchor(anchor, floor, 1);
}

export function mapCandidateFromScaledAnchor(anchor, floor, scale = 1) {
  const dimensions = scaledFloorDimensions(floor, scale);
  return {
    x: Math.round(anchor.x) - dimensions.width + Math.round(MAP_ANCHOR.width * dimensions.scale),
    y: Math.round(anchor.y),
    scale: dimensions.scale,
    captureWidth: dimensions.width,
    captureHeight: dimensions.height,
  };
}

export function scoreMapCandidate(image, floor) {
  if (!image || !floor || image.width !== floor.imageWidth || image.height !== floor.imageHeight) return null;
  const gameMap = readGameMap(image, floor);
  const readableRooms = gameMap.openedRoomCount + gameMap.mysteryCount;
  const validCorners = isValidMap(image);
  if (readableRooms < 1) return null;
  if (readableRooms === 1 && !gameMap.base) return null;
  if (!validCorners && readableRooms < 2 && !gameMap.base) return null;
  return {
    gameMap,
    readableRooms,
    validCorners,
    score: (validCorners ? 10_000 : 0) + (gameMap.base ? 1_000 : 0) + readableRooms * 50 + floor.width * floor.height,
  };
}

export function findMapByAlt1Anchor(api, captureRegion, {
  floors = FLOOR_SIZES,
  scales = MAP_SCALE_CANDIDATES,
  clientWidth = Number(api?.rsWidth) || 0,
  clientHeight = Number(api?.rsHeight) || 0,
} = {}) {
  if (!api || typeof captureRegion !== "function"
    || typeof api.bindRegion !== "function"
    || typeof api.bindFindSubImg !== "function"
    || clientWidth <= 0 || clientHeight <= 0) {
    return null;
  }

  let bind;
  let anchors;
  try {
    bind = api.bindRegion(0, 0, clientWidth, clientHeight);
    anchors = parseMatches(api.bindFindSubImg(
      bind,
      MAP_ANCHOR.icon,
      MAP_ANCHOR.width,
      0,
      0,
      clientWidth,
      clientHeight,
    ));
  } catch {
    return null;
  }

  let best = null;
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) continue;
    for (const scale of scales) {
      for (const floor of floors) {
        const candidate = mapCandidateFromScaledAnchor(anchor, floor, scale);
        if (!withinClient({
          x: candidate.x,
          y: candidate.y,
        }, { imageWidth: candidate.captureWidth, imageHeight: candidate.captureHeight }, clientWidth, clientHeight)) continue;
        let image;
        try {
          image = captureRegion(candidate.x, candidate.y, candidate.captureWidth, candidate.captureHeight);
        } catch {
          continue;
        }
        const normalized = normalizeMapCapture(image, floor, candidate.scale);
        const scored = scoreMapCandidate(normalized, floor);
        if (!scored) continue;
        const match = {
          x: candidate.x,
          y: candidate.y,
          floor,
          scale: candidate.scale,
          captureWidth: candidate.captureWidth,
          captureHeight: candidate.captureHeight,
          method: "anchor",
          anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
          readableRooms: scored.readableRooms,
          validCorners: scored.validCorners,
          gameMap: scored.gameMap,
          score: scored.score,
        };
        if (!best || match.score > best.score) best = match;
      }
    }
  }

  return best;
}
