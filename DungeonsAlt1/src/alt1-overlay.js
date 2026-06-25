import { ROOM_SIZE, mapToImage } from "./map-core.js?v=20260625-6";
import { rpmValue } from "./rpm-state.js?v=20260625-6";

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

export function formatMapStats({ rooms = 0, mystery = 0, deadEnds = 0, minutes = 0 } = {}) {
  const roomCount = Math.max(0, Number(rooms) || 0);
  const possible = roomCount + Math.max(0, Number(mystery) || 0);
  const rpm = rpmValue(roomCount, minutes);
  const roomLabel = roomCount === 1 ? "room" : "rooms";
  return `${roomCount} ${roomLabel} (${possible}) | ${rpm} rpm | ${Math.max(0, Number(deadEnds) || 0)} dead ends`;
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

export function buildStatsOverlayCommands({ stats, mapX, mapY, floor, overlayScale = 1, duration = 30_000 }) {
  if (!stats || !floor) return [];
  const scale = overlayScaleValue(overlayScale);
  const originX = Math.round(mapX);
  const barTop = Math.round(mapY + floor.imageHeight * scale);
  const barHeight = 21;
  const fontSize = 11;
  const value = String(stats);
  const barWidth = Math.max(Math.round(floor.imageWidth * scale), estimateOverlayTextWidth(value, fontSize) + 8);
  const commands = [];

  // Alt1 rectangles are outlines rather than fills. Nested opaque-black
  // outlines cover every row of the panel reliably on all supported versions.
  for (let inset = 0; inset <= Math.floor(barHeight / 2); inset += 1) {
    commands.push(rect(mixColor(1, 1, 1), originX + inset, barTop + inset,
      Math.max(1, barWidth - inset * 2), Math.max(1, barHeight - inset * 2), duration, 1));
  }
  commands.push(text(value, mixColor(220, 225, 226), fontSize,
    originX + 3, barTop + 3, duration, false, false));
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
