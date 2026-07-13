import { ROOM_SIZE, mapToImage } from "./map-core.js?v=20260625-29";
import { formatElapsedClock, rpmValue } from "./rpm-state.js?v=20260625-29";

export const GATESTONE_POSITIONS = Object.freeze([
  [2, 21],
  [21, 21],
  [21, 2],
  [2, 2],
  [12, 21],
  [12, 2],
]);

export function mixColor(r, g, b, a = 255) {
  // This intentionally matches a1lib.mixColor. Alt1 expects a signed 32-bit
  // ARGB integer; omitting alpha produces a fully transparent overlay.
  return (b << 0) + (g << 8) + (r << 16) + (a << 24);
}

export function hexToOverlayColor(value, alpha = 255) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ""));
  if (!match) return mixColor(255, 255, 255, alpha);
  const number = Number.parseInt(match[1], 16);
  return mixColor((number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff, alpha);
}

export function annotationOverlayColor(text) {
  const value = String(text || "").toLowerCase();
  if (value.startsWith("go")) return mixColor(255, 215, 0);
  if (value.startsWith("gr")) return mixColor(100, 255, 100);
  if (value.startsWith("o")) return mixColor(255, 165, 0);
  if (value.startsWith("y")) return mixColor(255, 240, 70);
  if (value.startsWith("b")) return mixColor(105, 200, 255);
  if (value.startsWith("p")) return mixColor(220, 175, 255);
  return mixColor(240, 245, 245);
}

export function pointInFloor(point, floor) {
  return Boolean(point && floor
    && Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.x < floor.width
    && point.y >= 0 && point.y < floor.height);
}

export function assignGatestoneSlots(markers, floor) {
  const nextSlotByRoom = new Map();
  const result = [];
  for (const marker of markers ?? []) {
    if (!pointInFloor(marker?.point, floor)) continue;
    const roomKey = `${marker.point.x},${marker.point.y}`;
    const slot = nextSlotByRoom.get(roomKey) ?? 0;
    nextSlotByRoom.set(roomKey, slot + 1);
    result.push({ ...marker, slot });
  }
  return result;
}

export function formatRpmCounter({ rooms = 0, minutes = 0 } = {}) {
  return `${rpmValue(rooms, minutes)} rpm`;
}

export function formatMapStats({ rooms = 0, mystery = 0, deadEnds = 0, minutes = 0, predictedSeconds = 0 } = {}) {
  const roomCount = Math.max(0, Number(rooms) || 0);
  const possible = roomCount + Math.max(0, Number(mystery) || 0);
  const rpm = rpmValue(roomCount, minutes);
  const roomLabel = roomCount === 1 ? "room" : "rooms";
  const line = `${roomCount} ${roomLabel} (${possible}) | ${rpm} rpm | ${Math.max(0, Number(deadEnds) || 0)} dead ends`;
  const predicted = Math.max(0, Number(predictedSeconds) || 0);
  // Predicted floor finish time (dg-map style), appended only once a projection
  // exists. formatElapsedClock reuses the shared mm:ss math; drop its leading
  // zero so a sub-10-minute projection reads ~6:40, not ~06:40.
  return predicted > 0 ? `${line} | ~${formatElapsedClock(predicted).replace(/^0(?=\d:)/, "")}` : line;
}

function rect(color, x, y, width, height, duration, lineWidth) {
  return { type: "rect", color, x, y, width, height, duration, lineWidth };
}

function text(value, color, size, x, y, duration, centered = true, shadow = true) {
  return {
    type: "text",
    text: String(value),
    color,
    size,
    x,
    y,
    duration,
    font: "",
    centered,
    shadow,
  };
}

function estimateOverlayTextWidth(value, size = 12) {
  return Math.ceil(String(value).length * size * 0.52);
}

function overlayScaleValue(value = 1) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export const STATS_POSITIONS = Object.freeze(["bottom", "top", "left", "right", "free", "hidden"]);

// Place the stats/rpm strip relative to the map rectangle, or free on screen.
// Returns the top-left {x, y} for a barWidth x barHeight strip.
export function statsBarOrigin({ position = "bottom", mapX, mapY, mapWidth, mapHeight, barWidth, barHeight, free = null }) {
  const x = Math.round(mapX);
  const y = Math.round(mapY);
  switch (position) {
    case "top": return { x, y: y - barHeight };
    case "left": return { x: x - barWidth, y };
    case "right": return { x: x + mapWidth, y };
    case "free": return { x: Math.round(free?.x ?? 8), y: Math.round(free?.y ?? 8) };
    case "bottom":
    default: return { x, y: y + mapHeight };
  }
}

export const STATS_DEFAULT_TEXT_COLOR = mixColor(220, 225, 226);

export function buildStatsOverlayCommands({ stats, mapX, mapY, floor, overlayScale = 1, duration = 30_000, position = "bottom", free = null, textColor = STATS_DEFAULT_TEXT_COLOR, sizeScale = 1, screen = null }) {
  if (!stats || !floor || position === "hidden") return [];
  const scale = overlayScaleValue(overlayScale);
  // Independent user size for the strip (default 1 keeps existing geometry).
  const size = overlayScaleValue(sizeScale);
  const barHeight = Math.round(21 * size);
  const fontSize = Math.max(6, Math.round(11 * size));
  const pad = Math.round(3 * size);
  const value = String(stats);
  const mapWidth = Math.round(floor.imageWidth * scale);
  const mapHeight = Math.round(floor.imageHeight * scale);
  // Right margin mirrors the left pad (identical to +8 at sizeScale 1, pad = 3).
  const barWidth = Math.max(mapWidth, estimateOverlayTextWidth(value, fontSize) + pad * 2 + 2);
  const origin = statsBarOrigin({ position, mapX, mapY, mapWidth, mapHeight, barWidth, barHeight, free });
  // The free point is the strip's top-left, so without a right/bottom clamp a
  // corner click leaves only a sliver on-screen. Only the free mode clamps to the
  // screen; every other position (and the no-screen default) keeps Math.max(0, ...).
  let originX = Math.max(0, origin.x);
  let barTop = Math.max(0, origin.y);
  if (position === "free" && screen
    && Number.isFinite(screen.width) && screen.width > 0
    && Number.isFinite(screen.height) && screen.height > 0) {
    originX = Math.max(0, Math.min(origin.x, Math.round(screen.width) - barWidth));
    barTop = Math.max(0, Math.min(origin.y, Math.round(screen.height) - barHeight));
  }
  const commands = [];

  // Alt1 rectangles are outlines rather than fills. Nested opaque-black
  // outlines cover every row of the panel reliably on all supported versions.
  for (let inset = 0; inset <= Math.floor(barHeight / 2); inset += 1) {
    commands.push(rect(mixColor(1, 1, 1), originX + inset, barTop + inset,
      Math.max(1, barWidth - inset * 2), Math.max(1, barHeight - inset * 2), duration, 1));
  }
  commands.push(text(value, textColor, fontSize,
    originX + pad, barTop + pad, duration, false, false));
  return commands;
}

export function buildMapOverlayCommands({
  mapX,
  mapY,
  floor,
  overlayScale = 1,
  annotations = [],
  manualCritical = [],
  gatestones = [],
  stats = "",
  statsPosition = "bottom",
  statsFree = null,
  statsColor = STATS_DEFAULT_TEXT_COLOR,
  statsScale = 1,
  statsScreen = null,
  duration = 30_000,
}) {
  const commands = [];
  const scale = overlayScaleValue(overlayScale);
  const originX = Math.round(mapX);
  const originY = Math.round(mapY);
  const mapOverlayX = (value) => Math.round(originX + value * scale);
  const mapOverlayY = (value) => Math.round(originY + value * scale);

  for (const annotation of annotations) {
    if (!annotation?.text || !pointInFloor(annotation.point, floor)) continue;
    const origin = mapToImage(annotation.point, floor);
    const centerX = mapOverlayX(origin.x + ROOM_SIZE / 2);
    const centerY = mapOverlayY(origin.y + ROOM_SIZE / 2);
    commands.push(rect(mixColor(1, 1, 1, 180), centerX - 13, centerY - 8, 26, 16, duration, 2));
    const color = annotation.color
      ? hexToOverlayColor(annotation.color, 255)
      : annotationOverlayColor(annotation.text);
    commands.push(text(annotation.text, color, 12,
      centerX, centerY, duration));
  }

  for (const point of manualCritical) {
    if (!pointInFloor(point, floor)) continue;
    const origin = mapToImage(point, floor);
    commands.push(rect(mixColor(60, 220, 238, 220), mapOverlayX(origin.x + 2),
      mapOverlayY(origin.y + 2), Math.max(1, Math.round(28 * scale)), Math.max(1, Math.round(28 * scale)), duration, 2));
  }

  for (const marker of gatestones) {
    if (!pointInFloor(marker?.point, floor)) continue;
    const origin = mapToImage(marker.point, floor);
    const [dx, dy] = GATESTONE_POSITIONS[(marker.slot ?? 0) % GATESTONE_POSITIONS.length];
    const x = mapOverlayX(origin.x + dx);
    const y = mapOverlayY(origin.y + dy);
    const fill = hexToOverlayColor(marker.fill, 255);
    commands.push(rect(fill, x, y, 9, 9, duration, 4));
    commands.push(text(marker.text, hexToOverlayColor(marker.textColor, 255), 7,
      x + 5, y + 5, duration));
  }

  if (stats) {
    commands.push(...buildStatsOverlayCommands({
      stats,
      mapX: originX,
      mapY: originY,
      floor,
      overlayScale: scale,
      duration,
      position: statsPosition,
      free: statsFree,
      textColor: statsColor,
      sizeScale: statsScale,
      screen: statsScreen,
    }));
  }

  return commands;
}

export function buildTestOverlayCommands({ x, y, width, height, duration = 8_000 }) {
  const left = Math.round(x);
  const top = Math.round(y);
  const overlayWidth = Math.round(width);
  const overlayHeight = Math.round(height);
  return [
    rect(mixColor(255, 0, 255), left, top, overlayWidth, overlayHeight, duration, 4),
    text("DUNGEONS NATIVE OVERLAY TEST", mixColor(255, 255, 0), 18,
      Math.round(left + overlayWidth / 2), top + 18, duration),
  ];
}

export function executeOverlayCommands(api, commands) {
  let sent = 0;
  let rejected = 0;
  for (const command of commands) {
    let accepted = false;
    if (command.type === "rect" && typeof api.overLayRect === "function") {
      accepted = api.overLayRect(command.color, command.x, command.y, command.width,
        command.height, command.duration, command.lineWidth);
      sent += 1;
    } else if (command.type === "text" && typeof api.overLayTextEx === "function") {
      accepted = api.overLayTextEx(command.text, command.color, command.size, command.x,
        command.y, command.duration, command.font, command.centered, command.shadow);
      sent += 1;
    } else {
      rejected += 1;
      continue;
    }
    if (accepted === false) rejected += 1;
  }
  return { sent, rejected };
}

export function drawOverlayGroup(api, group, commands = []) {
  const canFreeze = typeof api.overLayFreezeGroup === "function"
    && typeof api.overLayRefreshGroup === "function";
  if (canFreeze) api.overLayFreezeGroup(group);
  api.overLayClearGroup(group);
  api.overLaySetGroup(group);
  let report;
  try {
    report = executeOverlayCommands(api, commands);
  } finally {
    api.overLaySetGroup("");
    if (canFreeze) api.overLayRefreshGroup(group);
  }
  return report;
}
