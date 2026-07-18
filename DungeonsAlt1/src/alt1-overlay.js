import { ROOM_SIZE, mapToImage } from "./map-core.js?v=20260718-39";
import { formatElapsedClock, rpmValue } from "./rpm-state.js?v=20260718-39";

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

function normalizedScreenBounds(screen) {
  const width = Math.round(Number(screen?.width));
  const height = Math.round(Number(screen?.height));
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
}

function containedStatsBarOrigin({
  position,
  mapX,
  mapY,
  mapWidth,
  mapHeight,
  barWidth,
  barHeight,
  free,
  screen,
  avoidMapOverlap = false,
}) {
  const bounds = normalizedScreenBounds(screen);
  if (avoidMapOverlap) {
    const requested = STATS_POSITIONS.includes(position) ? position : "bottom";
    const candidates = [...new Set([requested, "bottom", "top", "right", "left"])];
    const mapRight = mapX + mapWidth;
    const mapBottom = mapY + mapHeight;
    for (const candidate of candidates) {
      if (candidate === "hidden") continue;
      const value = statsBarOrigin({
        position: candidate, mapX, mapY, mapWidth, mapHeight, barWidth, barHeight, free,
      });
      const onScreen = !bounds || (value.x >= 0 && value.y >= 0
        && value.x + barWidth <= bounds.width && value.y + barHeight <= bounds.height);
      const overlapsMap = value.x < mapRight && value.x + barWidth > mapX
        && value.y < mapBottom && value.y + barHeight > mapY;
      if (onScreen && !overlapsMap) return value;
    }
    // In Desktop compatibility mode an overlapping strip would be captured as
    // map pixels. Hiding it on an impossibly cramped client is safer than
    // corrupting floor/RPM classification.
    return null;
  }
  let resolvedPosition = position;
  let origin = statsBarOrigin({
    position: resolvedPosition,
    mapX,
    mapY,
    mapWidth,
    mapHeight,
    barWidth,
    barHeight,
    free,
  });

  if (bounds) {
    // Preserve the requested side whenever it fits. If the strip would leave
    // the RuneScape client, prefer the opposite side before clamping. This
    // keeps an edge-mounted map and its stats visually connected.
    if (resolvedPosition === "bottom" && origin.y + barHeight > bounds.height) resolvedPosition = "top";
    else if (resolvedPosition === "top" && origin.y < 0) resolvedPosition = "bottom";
    else if (resolvedPosition === "right" && origin.x + barWidth > bounds.width) resolvedPosition = "left";
    else if (resolvedPosition === "left" && origin.x < 0) resolvedPosition = "right";

    if (resolvedPosition !== position) {
      origin = statsBarOrigin({
        position: resolvedPosition,
        mapX,
        mapY,
        mapWidth,
        mapHeight,
        barWidth,
        barHeight,
        free,
      });
    }

    return {
      x: Math.max(0, Math.min(origin.x, Math.max(0, bounds.width - barWidth))),
      y: Math.max(0, Math.min(origin.y, Math.max(0, bounds.height - barHeight))),
    };
  }

  return { x: Math.max(0, origin.x), y: Math.max(0, origin.y) };
}

export const STATS_DEFAULT_TEXT_COLOR = mixColor(220, 225, 226);

export function buildStatsOverlayCommands({ stats, mapX, mapY, floor, overlayScale = 1, duration = 30_000, position = "bottom", free = null, textColor = STATS_DEFAULT_TEXT_COLOR, sizeScale = 1, screen = null, avoidMapOverlap = false }) {
  if (!stats || !floor || position === "hidden") return [];
  const scale = overlayScaleValue(overlayScale);
  // Follow RuneScape's detected interface scale automatically. sizeScale is an
  // optional caller-controlled multiplier (1 = match the game interface).
  const size = scale * overlayScaleValue(sizeScale);
  const barHeight = Math.round(21 * size);
  const fontSize = Math.max(6, Math.round(11 * size));
  const pad = Math.round(3 * size);
  const value = String(stats);
  const mapWidth = Math.round(floor.imageWidth * scale);
  const mapHeight = Math.round(floor.imageHeight * scale);
  // Right margin mirrors the left pad (identical to +8 at sizeScale 1, pad = 3).
  const barWidth = Math.max(mapWidth, estimateOverlayTextWidth(value, fontSize) + pad * 2 + 2);
  const origin = containedStatsBarOrigin({
    position, mapX, mapY, mapWidth, mapHeight, barWidth, barHeight, free, screen, avoidMapOverlap,
  });
  if (!origin) return [];
  const originX = origin.x;
  const barTop = origin.y;
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
  statsAvoidMapOverlap = false,
  duration = 30_000,
}) {
  const commands = [];
  const scale = overlayScaleValue(overlayScale);
  const originX = Math.round(mapX);
  const originY = Math.round(mapY);
  const mapOverlayX = (value) => Math.round(originX + value * scale);
  const mapOverlayY = (value) => Math.round(originY + value * scale);
  const scaledPixels = (value) => Math.max(1, Math.round(value * scale));

  for (const annotation of annotations) {
    if (!annotation?.text || !pointInFloor(annotation.point, floor)) continue;
    const origin = mapToImage(annotation.point, floor);
    const centerX = mapOverlayX(origin.x + ROOM_SIZE / 2);
    const centerY = mapOverlayY(origin.y + ROOM_SIZE / 2);
    const boxWidth = scaledPixels(26);
    const boxHeight = scaledPixels(16);
    commands.push(rect(mixColor(1, 1, 1, 180), centerX - Math.round(boxWidth / 2),
      centerY - Math.round(boxHeight / 2), boxWidth, boxHeight, duration, scaledPixels(2)));
    const color = annotation.color
      ? hexToOverlayColor(annotation.color, 255)
      : annotationOverlayColor(annotation.text);
    commands.push(text(annotation.text, color, Math.max(6, Math.round(12 * scale)),
      centerX, centerY, duration));
  }

  for (const point of manualCritical) {
    if (!pointInFloor(point, floor)) continue;
    const origin = mapToImage(point, floor);
    commands.push(rect(mixColor(60, 220, 238, 220), mapOverlayX(origin.x + 2),
      mapOverlayY(origin.y + 2), scaledPixels(28), scaledPixels(28), duration, scaledPixels(2)));
  }

  for (const marker of gatestones) {
    if (!pointInFloor(marker?.point, floor)) continue;
    const origin = mapToImage(marker.point, floor);
    const [dx, dy] = GATESTONE_POSITIONS[(marker.slot ?? 0) % GATESTONE_POSITIONS.length];
    const x = mapOverlayX(origin.x + dx);
    const y = mapOverlayY(origin.y + dy);
    const fill = hexToOverlayColor(marker.fill, 255);
    const markerSize = scaledPixels(9);
    commands.push(rect(fill, x, y, markerSize, markerSize, duration, scaledPixels(4)));
    commands.push(text(marker.text, hexToOverlayColor(marker.textColor, 255),
      Math.max(4, Math.round(7 * scale)), x + Math.round(markerSize / 2),
      y + Math.round(markerSize / 2), duration));
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
      avoidMapOverlap: statsAvoidMapOverlap,
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
