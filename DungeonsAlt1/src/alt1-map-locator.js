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
  return {
    x: Math.round(anchor.x) - floor.imageWidth + MAP_ANCHOR.width,
    y: Math.round(anchor.y),
  };
}

export function scoreMapCandidate(image, floor) {
  if (!image || !floor || image.width !== floor.imageWidth || image.height !== floor.imageHeight) return null;
  const gameMap = readGameMap(image, floor);
  const readableRooms = gameMap.openedRoomCount + gameMap.mysteryCount;
  const validCorners = isValidMap(image);
  if (!validCorners && readableRooms < 1) return null;
  return {
    gameMap,
    readableRooms,
    validCorners,
    score: (validCorners ? 10_000 : 0) + readableRooms * 50 + floor.width * floor.height,
  };
}

export function findMapByAlt1Anchor(api, captureRegion, {
  floors = FLOOR_SIZES,
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
    for (const floor of floors) {
      const candidate = mapCandidateFromAnchor(anchor, floor);
      if (!withinClient(candidate, floor, clientWidth, clientHeight)) continue;
      let image;
      try {
        image = captureRegion(candidate.x, candidate.y, floor.imageWidth, floor.imageHeight);
      } catch {
        continue;
      }
      const scored = scoreMapCandidate(image, floor);
      if (!scored) continue;
      const match = {
        x: candidate.x,
        y: candidate.y,
        floor,
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

  return best;
}
