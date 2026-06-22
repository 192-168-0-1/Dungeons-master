import {
  FLOOR_SIZES,
  ROOM_SIZE,
  RoomType,
  detectGatestones,
  findMapByCorners,
  gridOffset,
  imageToMap,
  isOpened,
  isValidMap,
  mapToImage,
  readGameMap,
  toChess,
} from "./src/map-core.js";
import { captureFullRuneScape, captureRegion, hasAlt1, identifyApp, moveWindowFrom } from "./src/alt1-capture.js";
import {
  assignGatestoneSlots,
  buildMapOverlayCommands,
  buildTestOverlayCommands,
  drawOverlayGroup,
  formatMapStats,
} from "./src/alt1-overlay.js?v=20260622-8";
import { TeamSync, createRoomCode } from "./src/team-sync.js";
import {
  PARTY_COLORS,
  observedPartySlot,
  partyColor,
  partyTextColor,
  reconcileObservedParty,
} from "./src/party-core.js";
import { readPartyInterface, resolvePartyOcrRuntime } from "./src/party-interface.js?v=20260622-8";
import { WinterfaceReader } from "./src/winterface.js";

const SCAN_INTERVAL = 600;
const AUTO_CALIBRATION_INTERVAL = 2500;
const STORAGE_PREFIX = "dungeons-alt1";
const INVALID_CAPTURES_BEFORE_RECALIBRATION = 3;
const OVERLAY_DURATION = 30000;
const PARTY_SCAN_INTERVAL = 5000;

const elements = {
  titlebar: document.querySelector(".titlebar"),
  status: document.querySelector("#status"),
  stats: document.querySelector("#stats"),
  canvas: document.querySelector("#map"),
  calibrate: document.querySelector("#calibrate"),
  pause: document.querySelector("#pause"),
  save: document.querySelector("#save"),
  clear: document.querySelector("#clear"),
  captureResults: document.querySelector("#capture-results"),
  showCapture: document.querySelector("#show-capture"),
  showGrid: document.querySelector("#show-grid"),
  gameOverlay: document.querySelector("#game-overlay"),
  testOverlay: document.querySelector("#test-overlay"),
  overlayStatus: document.querySelector("#overlay-status"),
  selection: document.querySelector("#selection"),
  annotation: document.querySelector("#annotation"),
  applyAnnotation: document.querySelector("#apply-annotation"),
  teamName: document.querySelector("#team-name"),
  teamRoom: document.querySelector("#team-room"),
  teamCreate: document.querySelector("#team-create"),
  teamJoin: document.querySelector("#team-join"),
  teamDisconnect: document.querySelector("#team-disconnect"),
  teamStatus: document.querySelector("#team-status"),
  partySlots: [...document.querySelectorAll(".party-slot")],
  partyInterface: document.querySelector("#party-interface"),
  partyScan: document.querySelector("#party-scan"),
  partyScanStatus: document.querySelector("#party-scan-status"),
  installLink: document.querySelector("#install-link"),
  environment: document.querySelector("#environment"),
  resultsBody: document.querySelector("#results-body"),
  copyResults: document.querySelector("#copy-results"),
};

const context = elements.canvas.getContext("2d", { alpha: true });
const teamSync = new TeamSync();
const winterfaceReader = WinterfaceReader.load();

const state = {
  calibration: loadCalibration(),
  image: null,
  gameMap: null,
  selected: null,
  annotations: new Map(),
  manualCritical: new Set(),
  localGatestones: {},
  teamGatestones: new Map(),
  floorStart: null,
  lastBase: null,
  lastRoomCount: 0,
  invalidCaptures: 0,
  autoScan: true,
  busy: false,
  lastCalibrationAttempt: 0,
  lastOverlayReport: null,
  results: [],
  observedParty: [],
  partyPanel: null,
  partyScanBusy: false,
  lastPartyScan: 0,
};

function loadCalibration() {
  try {
    const saved = JSON.parse(storageGet(`${STORAGE_PREFIX}:calibration`));
    const floor = FLOOR_SIZES.find((candidate) => candidate.name === saved?.floor);
    if (floor && Number.isInteger(saved.x) && Number.isInteger(saved.y)) return { x: saved.x, y: saved.y, floor };
  } catch {
    // A corrupt development setting is safe to ignore.
  }
  return null;
}

function saveCalibration() {
  if (!state.calibration) return;
  storageSet(`${STORAGE_PREFIX}:calibration`, JSON.stringify({
    x: state.calibration.x,
    y: state.calibration.y,
    floor: state.calibration.floor.name,
  }));
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function setStatus(text, tone = "neutral") {
  elements.status.textContent = text;
  elements.status.dataset.tone = tone;
}

function floorPointKey(point) {
  return `${point.x},${point.y}`;
}

function pointFromKey(value) {
  const [x, y] = value.split(",").map(Number);
  return { x, y };
}

function samePoint(left, right) {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function participantSlot(ownerId, hintedSlot = null) {
  if (elements.partyInterface.checked && state.observedParty.length) {
    const syncedName = teamSync.member(ownerId)?.name;
    const localName = ownerId === teamSync.clientId
      ? (elements.teamName.value.trim() || teamSync.name)
      : "";
    const observed = observedPartySlot(state.observedParty, syncedName || localName);
    if (observed) return observed;
  }
  const rosterSlot = teamSync.member(ownerId)?.slot;
  if (rosterSlot) return rosterSlot;
  const slot = Number(hintedSlot);
  return Number.isInteger(slot) && slot >= 1 && slot <= PARTY_COLORS.length ? slot : null;
}

function ownerColor(ownerId, hintedSlot, fallback) {
  return partyColor(participantSlot(ownerId, hintedSlot), fallback);
}

function localAnnotation(text) {
  return {
    text,
    ownerId: teamSync.clientId,
    ownerName: teamSync.name,
    slot: teamSync.slot,
  };
}

function pointInFloor(point, floor = state.gameMap?.floor) {
  return Boolean(point && floor && point.x >= 0 && point.x < floor.width && point.y >= 0 && point.y < floor.height);
}

function resetFloor() {
  state.floorStart = Date.now() - 2000;
  state.annotations.clear();
  state.manualCritical.clear();
  state.teamGatestones.clear();
  state.selected = null;
  elements.annotation.value = "";
  elements.selection.textContent = "No room selected";
}

function clearCalibration() {
  state.calibration = null;
  storageRemove(`${STORAGE_PREFIX}:calibration`);
}

async function calibrate({ silent = false } = {}) {
  if (state.busy) return false;
  state.busy = true;
  state.lastCalibrationAttempt = Date.now();
  elements.calibrate.disabled = true;
  let found = false;
  try {
    assertAlt1Ready();
    if (!silent) setStatus("Searching for the Dungeoneering map…");
    await nextPaint();
    const fullClient = captureFullRuneScape();
    const match = findMapByCorners(fullClient);
    if (!match) {
      clearCalibration();
      setStatus("Waiting for a Dungeoneering map to appear…", "warn");
    } else {
      state.calibration = match;
      state.invalidCaptures = 0;
      saveCalibration();
      found = true;
      setStatus(`Calibrated: ${match.floor.name} at ${match.x},${match.y}`, "ok");
    }
  } catch (error) {
    setStatus(error.message || String(error), silent ? "warn" : "error");
  } finally {
    state.busy = false;
    elements.calibrate.disabled = false;
  }
  if (found) await updateMap();
  return found;
}

function assertAlt1Ready() {
  if (!hasAlt1()) throw new Error("Open this page inside Alt1 to read RuneScape.");
  if (!window.alt1.rsLinked) throw new Error("Waiting for Alt1 to link to the RuneScape window…");
  if (window.alt1.permissionPixel === false) throw new Error("Install the app in Alt1 and grant pixel permission.");
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function updateMap() {
  if (state.busy || !state.calibration || !state.autoScan) return;
  state.busy = true;
  let shouldRecalibrate = false;
  try {
    assertAlt1Ready();
    let { x, y, floor } = state.calibration;
    let image = captureRegion(x, y, floor.imageWidth, floor.imageHeight);
    if (!isValidMap(image)) {
      // Reacquire a moved map immediately so native labels, gatestones and the
      // stats strip remain magnetically attached to its client coordinates.
      const relocated = findMapByCorners(captureFullRuneScape());
      if (relocated) {
        state.calibration = relocated;
        ({ x, y, floor } = relocated);
        saveCalibration();
        image = captureRegion(x, y, floor.imageWidth, floor.imageHeight);
      }
    }
    if (!isValidMap(image)) {
      state.invalidCaptures += 1;
      setStatus(`Map image lost (${state.invalidCaptures}/${INVALID_CAPTURES_BEFORE_RECALIBRATION})`, "warn");
      shouldRecalibrate = state.invalidCaptures >= INVALID_CAPTURES_BEFORE_RECALIBRATION;
      return;
    }

    state.invalidCaptures = 0;
    const gameMap = readGameMap(image, floor);
    const newFloor = !state.floorStart
      || (state.lastBase && gameMap.base && !samePoint(state.lastBase, gameMap.base))
      || (state.lastRoomCount > 1 && gameMap.openedRoomCount === 1);
    if (newFloor) resetFloor();

    state.image = image;
    state.gameMap = gameMap;
    state.lastBase = gameMap.base ?? state.lastBase;
    state.lastRoomCount = gameMap.openedRoomCount;
    updateLocalGatestones(detectGatestones(image, gameMap));
    render();
    setStatus(`${floor.name} map live`, "ok");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    state.busy = false;
    if (shouldRecalibrate) {
      clearCalibration();
      setTimeout(() => calibrate({ silent: true }), 0);
    }
  }
}

function updateLocalGatestones(next) {
  for (const index of [1, 2]) {
    const previousPoint = state.localGatestones[index] ?? null;
    const nextPoint = next[index] ?? null;
    if ((previousPoint || nextPoint) && !samePoint(previousPoint, nextPoint)) teamSync.sendGatestone(index, nextPoint);
  }
  state.localGatestones = next;
}

function clearTeamGatestones() {
  if (!state.teamGatestones.size) return;
  state.teamGatestones.clear();
  render();
}

function updateStats() {
  if (!state.gameMap) {
    elements.stats.textContent = "No map read yet";
    return;
  }
  const rooms = state.gameMap.openedRoomCount;
  const possible = rooms + state.gameMap.mysteryCount;
  const minutes = state.floorStart ? Math.max((Date.now() - state.floorStart) / 60_000, 1 / 60) : 0;
  const rpm = minutes ? Math.max(0, (rooms - 0.8) / minutes).toFixed(1) : "0.0";
  const elapsedSeconds = state.floorStart ? Math.max(0, Math.floor((Date.now() - state.floorStart) / 1000)) : 0;
  const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  elements.stats.textContent = `${rooms} rooms (${possible}) · ${rpm} rpm · ${state.gameMap.deadEndCount} dead ends · ${elapsed}`;
}

function currentOverlayStats() {
  if (!state.gameMap) return "";
  const minutes = state.floorStart ? Math.max((Date.now() - state.floorStart) / 60_000, 1 / 60) : 0;
  return formatMapStats({
    rooms: state.gameMap.openedRoomCount,
    mystery: state.gameMap.mysteryCount,
    deadEnds: state.gameMap.deadEndCount,
    minutes,
  });
}

function render() {
  const { image, gameMap } = state;
  if (!image || !gameMap) {
    drawEmptyState();
    updateStats();
    return;
  }

  elements.canvas.width = image.width;
  elements.canvas.height = image.height;
  context.imageSmoothingEnabled = false;
  if (elements.showCapture.checked) context.putImageData(image, 0, 0);
  else drawAbstractMap(gameMap);
  if (elements.showGrid.checked) drawGrid(gameMap.floor);
  drawCriticalRooms(gameMap);
  drawAnnotations(gameMap.floor);
  drawGatestones(gameMap.floor);
  drawSelection(gameMap.floor);
  updateStats();
  renderGameOverlay();
}

function drawEmptyState() {
  elements.canvas.width = 280;
  elements.canvas.height = 280;
  context.clearRect(0, 0, 280, 280);
  context.fillStyle = "#101417";
  context.fillRect(0, 0, 280, 280);
  context.fillStyle = "#7f8c91";
  context.font = "14px system-ui";
  context.textAlign = "center";
  context.fillText("Waiting for a Dungeoneering map", 140, 140);
}

function drawAbstractMap(gameMap) {
  const { floor } = gameMap;
  context.clearRect(0, 0, floor.imageWidth, floor.imageHeight);
  context.fillStyle = "rgba(8, 12, 14, .88)";
  context.fillRect(0, 0, floor.imageWidth, floor.imageHeight);
  context.lineCap = "round";
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const type = gameMap.typeAt(x, y);
      if (type === RoomType.Gap) continue;
      const origin = mapToImage({ x, y }, floor);
      const centerX = origin.x + ROOM_SIZE / 2;
      const centerY = origin.y + ROOM_SIZE / 2;
      context.strokeStyle = type & RoomType.Mystery ? "#8c6a3b" : "#8fa3a8";
      context.lineWidth = 4;
      context.beginPath();
      if (type & RoomType.W) { context.moveTo(origin.x, centerY); context.lineTo(centerX, centerY); }
      if (type & RoomType.E) { context.moveTo(centerX, centerY); context.lineTo(origin.x + ROOM_SIZE, centerY); }
      if (type & RoomType.N) { context.moveTo(centerX, origin.y); context.lineTo(centerX, centerY); }
      if (type & RoomType.S) { context.moveTo(centerX, centerY); context.lineTo(centerX, origin.y + ROOM_SIZE); }
      context.stroke();

      context.fillStyle = type & RoomType.Base ? "#d8d2a4"
        : type & RoomType.Boss ? "#9e3d35"
          : type & RoomType.Crit ? "#c89a42"
            : type & RoomType.Mystery ? "#5a432a" : "#59686c";
      context.fillRect(origin.x + 9, origin.y + 9, 14, 14);
      context.strokeStyle = "rgba(255,255,255,.35)";
      context.lineWidth = 1;
      context.strokeRect(origin.x + 9.5, origin.y + 9.5, 13, 13);
    }
  }
}

function drawGrid(floor) {
  const offset = gridOffset(floor);
  context.save();
  context.strokeStyle = "rgba(220, 244, 247, .16)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= floor.width; x += 1) {
    const px = offset.x + x * ROOM_SIZE + 0.5;
    context.moveTo(px, offset.y);
    context.lineTo(px, offset.y + floor.height * ROOM_SIZE);
  }
  for (let y = 0; y <= floor.height; y += 1) {
    const py = offset.y + y * ROOM_SIZE + 0.5;
    context.moveTo(offset.x, py);
    context.lineTo(offset.x + floor.width * ROOM_SIZE, py);
  }
  context.stroke();
  context.restore();
}

function drawCriticalRooms(gameMap) {
  context.save();
  context.lineWidth = 2;
  for (let y = 0; y < gameMap.floor.height; y += 1) {
    for (let x = 0; x < gameMap.floor.width; x += 1) {
      const point = { x, y };
      const pointKey = floorPointKey(point);
      const detected = gameMap.criticalPath.has(pointKey);
      const manual = state.manualCritical.has(pointKey);
      if (!detected && !manual) continue;
      const origin = mapToImage(point, gameMap.floor);
      context.strokeStyle = manual ? "rgba(58, 218, 238, .95)" : "rgba(255, 185, 58, .78)";
      context.strokeRect(origin.x + 2, origin.y + 2, ROOM_SIZE - 4, ROOM_SIZE - 4);
    }
  }
  context.restore();
}

function legacyAnnotationColor(text) {
  const value = String(text || "").toLowerCase();
  if (value.startsWith("go")) return "rgba(255, 215, 0, .95)";
  if (value.startsWith("gr")) return "rgba(100, 255, 100, .95)";
  if (value.startsWith("o")) return "rgba(255, 165, 0, .95)";
  if (value.startsWith("y")) return "rgba(255, 240, 70, .95)";
  if (value.startsWith("b")) return "rgba(105, 200, 255, .95)";
  if (value.startsWith("p")) return "rgba(220, 175, 255, .95)";
  return "rgba(240, 245, 245, .94)";
}

function drawAnnotations(floor) {
  context.save();
  context.font = "bold 10px Consolas, monospace";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.shadowColor = "rgba(0,0,0,.9)";
  context.shadowBlur = 2;
  for (const [pointKey, annotation] of state.annotations) {
    if (!annotation?.text) continue;
    const point = pointFromKey(pointKey);
    if (!pointInFloor(point, floor)) continue;
    const origin = mapToImage(point, floor);
    context.fillStyle = ownerColor(annotation.ownerId, annotation.slot, legacyAnnotationColor(annotation.text));
    context.fillText(annotation.text, origin.x + 3, origin.y + 3);
  }
  context.restore();
}

function drawGatestones(floor) {
  for (const marker of collectGatestoneMarkers(floor)) {
    drawGatestoneBadge(marker.point, marker.text, marker.fill, marker.textColor, floor, marker.slot);
  }
}

function drawGatestoneBadge(point, text, fill, color, floor, slot) {
  if (!pointInFloor(point, floor)) return;
  const origin = mapToImage(point, floor);
  const positions = [[2, 21], [21, 21], [21, 2], [2, 2], [12, 21], [12, 2]];
  const [dx, dy] = positions[slot % positions.length];
  context.save();
  context.fillStyle = fill;
  context.strokeStyle = "rgba(255,255,255,.8)";
  context.lineWidth = 1;
  context.fillRect(origin.x + dx, origin.y + dy, 9, 9);
  context.strokeRect(origin.x + dx + 0.5, origin.y + dy + 0.5, 8, 8);
  context.fillStyle = color;
  context.font = "bold 6px system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, origin.x + dx + 4.5, origin.y + dy + 4.8);
  context.restore();
}

function collectGatestoneMarkers(floor = state.gameMap?.floor) {
  if (!floor) return [];
  const localSlot = participantSlot(teamSync.clientId, teamSync.slot);
  const markers = Object.entries(state.localGatestones)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([index, point]) => ({
      source: "local",
      ownerId: teamSync.clientId,
      ownerName: teamSync.name,
      partySlot: localSlot,
      point,
      text: `G${index}`,
      fill: partyColor(localSlot, "#ffd23f"),
      textColor: partyTextColor(localSlot, "#111111"),
    }));

  const owners = [...state.teamGatestones.values()]
    .sort((left, right) => (participantSlot(left.id, left.slot) ?? 99)
      - (participantSlot(right.id, right.slot) ?? 99)
      || String(left.id).localeCompare(String(right.id)));
  for (const owner of owners) {
    const slot = participantSlot(owner.id, owner.slot);
    const locations = [...owner.locations.entries()]
      .sort(([left], [right]) => Number(left) - Number(right));
    for (const [index, point] of locations) {
      markers.push({
        source: "team",
        ownerId: owner.id,
        ownerName: owner.name,
        partySlot: slot,
        point,
        text: String(index),
        fill: partyColor(slot, "#aaafb2"),
        textColor: partyTextColor(slot, "#ffffff"),
      });
    }
  }
  return assignGatestoneSlots(markers, floor);
}

function drawSelection(floor) {
  if (!pointInFloor(state.selected, floor)) return;
  const origin = mapToImage(state.selected, floor);
  context.save();
  context.strokeStyle = "#5fe8f5";
  context.lineWidth = 2;
  context.setLineDash([4, 2]);
  context.strokeRect(origin.x + 1, origin.y + 1, ROOM_SIZE - 2, ROOM_SIZE - 2);
  context.restore();
}

function clearGameOverlay() {
  if (hasAlt1() && typeof window.alt1.overLayClearGroup === "function") {
    for (const group of ["dungeons-alt1", "dungeons-alt1-test"]) {
      window.alt1.overLayClearGroup(group);
      if (typeof window.alt1.overLayRefreshGroup === "function") window.alt1.overLayRefreshGroup(group);
    }
  }
}

function updateOverlayStatus(text = "") {
  if (!elements.overlayStatus) return;
  if (text) {
    elements.overlayStatus.textContent = text;
    return;
  }
  if (!hasAlt1()) {
    elements.overlayStatus.textContent = "Native overlay unavailable in a browser";
    return;
  }
  const api = window.alt1;
  const permission = api.permissionOverlay === true ? "yes" : api.permissionOverlay === false ? "no" : "unknown";
  const markers = collectGatestoneMarkers();
  const localCount = markers.filter((marker) => marker.source === "local").length;
  const teamCount = markers.filter((marker) => marker.source === "team").length;
  if (!api.rsLinked) {
    elements.overlayStatus.textContent = `Native overlay waiting for RuneScape | permission ${permission}`;
  } else if (api.permissionOverlay === false) {
    elements.overlayStatus.textContent = "Native overlay permission is missing; reinstall the app";
  } else if (typeof api.overLayTextEx !== "function" || typeof api.overLayRect !== "function") {
    elements.overlayStatus.textContent = "This Alt1 version does not expose the native overlay API";
  } else if (state.calibration) {
    const report = state.lastOverlayReport;
    const delivery = report?.rejected
      ? ` | rejected ${report.rejected}/${report.sent}`
      : report ? ` | sent ${report.sent}` : "";
    elements.overlayStatus.textContent = `Native overlay permission ${permission} | map ${state.calibration.x},${state.calibration.y}`
      + ` | labels ${state.annotations.size} | local gates ${localCount} | team gates ${teamCount}${delivery}`;
  } else {
    elements.overlayStatus.textContent = `Native overlay permission ${permission} | waiting for map calibration`;
  }
}

function renderGameOverlay() {
  if (!hasAlt1()) {
    updateOverlayStatus();
    return;
  }
  const api = window.alt1;
  if (typeof api.overLayClearGroup !== "function" || typeof api.overLaySetGroup !== "function") {
    updateOverlayStatus();
    return;
  }
  const group = "dungeons-alt1";
  if (!elements.gameOverlay.checked || !state.calibration || !state.gameMap || api.permissionOverlay === false) {
    state.lastOverlayReport = drawOverlayGroup(api, group, []);
    updateOverlayStatus();
    return;
  }

  // Pixel capture and native overlays both use RuneScape-client coordinates.
  // Screen coordinates such as alt1.rsX/rsY must never be added here.
  const commands = buildMapOverlayCommands({
    mapX: state.calibration.x,
    mapY: state.calibration.y,
    floor: state.gameMap.floor,
    annotations: [...state.annotations].map(([pointKey, annotation]) => ({
      point: pointFromKey(pointKey),
      text: annotation.text,
      color: ownerColor(annotation.ownerId, annotation.slot, null),
    })),
    manualCritical: [...state.manualCritical].map(pointFromKey),
    gatestones: collectGatestoneMarkers(state.gameMap.floor),
    stats: currentOverlayStats(),
    duration: OVERLAY_DURATION,
  });
  state.lastOverlayReport = drawOverlayGroup(api, group, commands);
  updateOverlayStatus();
}

function testGameOverlay() {
  updateOverlayStatus();
  if (!hasAlt1()) return;
  const api = window.alt1;
  if (!api.rsLinked) {
    updateOverlayStatus("Test failed: Alt1 is not linked to RuneScape");
    return;
  }
  if (api.permissionOverlay === false) {
    updateOverlayStatus("Test failed: native overlay permission is missing; reinstall the app");
    return;
  }
  if (typeof api.overLaySetGroup !== "function" || typeof api.overLayClearGroup !== "function"
    || typeof api.overLayRect !== "function" || typeof api.overLayTextEx !== "function") {
    updateOverlayStatus("Test failed: native overlay API unavailable");
    return;
  }

  const group = "dungeons-alt1-test";
  const x = Math.round(state.calibration?.x ?? Math.max(20, api.rsWidth / 2 - 140));
  const y = Math.round(state.calibration?.y ?? Math.max(20, api.rsHeight / 2 - 50));
  const width = Math.round(state.calibration?.floor.imageWidth ?? 280);
  const height = Math.round(state.calibration?.floor.imageHeight ?? 100);
  const report = drawOverlayGroup(api, group, buildTestOverlayCommands({ x, y, width, height }));
  updateOverlayStatus(report.rejected
    ? `Alt1 rejected ${report.rejected}/${report.sent} native overlay test calls`
    : `Test sent at client ${x},${y}: look for a pink box on the RuneScape map (8 seconds)`);
}

function selectPoint(point) {
  if (!pointInFloor(point)) return;
  state.selected = point;
  const annotation = state.annotations.get(floorPointKey(point));
  elements.selection.textContent = `${toChess(point)} · ${isOpened(state.gameMap.typeAt(point.x, point.y)) ? "room" : "unknown"}`;
  elements.annotation.value = annotation?.text ?? "";
  elements.annotation.focus();
  elements.annotation.select();
  render();
}

function setSelectedAnnotation(value, notify = true) {
  if (!pointInFloor(state.selected)) return;
  const text = String(value ?? "").slice(0, 4);
  const pointKey = floorPointKey(state.selected);
  if (text) state.annotations.set(pointKey, localAnnotation(text));
  else state.annotations.delete(pointKey);
  elements.annotation.value = text;
  if (notify) teamSync.sendAnnotation(state.selected, text);
  render();
}

function clearAnnotations(notify = true) {
  state.annotations.clear();
  state.manualCritical.clear();
  elements.annotation.value = "";
  if (notify) teamSync.sendClear();
  render();
}

function canvasPoint(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * elements.canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * elements.canvas.height / bounds.height,
  };
}

function saveMap() {
  if (!state.image) return;
  const link = document.createElement("a");
  link.download = `dungeon-map-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.png`;
  link.href = elements.canvas.toDataURL("image/png");
  link.click();
}

const RESULT_COLUMNS = [
  "Timestamp", "Time", "Floor", "FloorXP", "PrestigeXP", "BaseXP", "FloorSize", "SizeMod",
  "BonusMod", "DifficultyMod", "LevelMod", "FloorXPBoost", "TotalMod", "FinalXP", "Roomcount", "DeadEnds",
];

async function captureDungeonResults() {
  if (state.busy) return;
  state.busy = true;
  elements.captureResults.disabled = true;
  try {
    assertAlt1Ready();
    setStatus("Reading the Dungeoneering results screen…");
    const reader = await winterfaceReader;
    const result = reader.read(captureFullRuneScape(), {
      roomcount: state.gameMap?.openedRoomCount,
      deadEnds: state.gameMap?.deadEndCount,
    });
    if (!result) {
      setStatus("Results screen not found — keep the XP overview visible", "error");
      return;
    }
    state.results.unshift(result);
    renderResults();
    setStatus(`Results read: floor ${result.Floor || "?"}, ${result.FinalXP || "?"} XP`, "ok");
  } catch (error) {
    setStatus(`Could not read the results screen: ${error.message || error}`, "error");
  } finally {
    state.busy = false;
    elements.captureResults.disabled = false;
  }
}

function renderResults() {
  elements.resultsBody.replaceChildren(...state.results.map((result) => {
    const row = document.createElement("tr");
    for (const column of RESULT_COLUMNS) {
      const cell = document.createElement("td");
      cell.textContent = result[column] ?? "";
      row.append(cell);
    }
    return row;
  }));
}

async function copyResults() {
  if (!state.results.length) return;
  const text = [
    RESULT_COLUMNS.join("\t"),
    ...state.results.map((result) => RESULT_COLUMNS.map((column) => result[column] ?? "").join("\t")),
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  setStatus("Results table copied to the clipboard", "ok");
}

function renderParty() {
  const members = teamSync.members;
  const observed = elements.partyInterface.checked ? state.observedParty : [];
  const localName = elements.teamName.value.trim() || teamSync.name;
  const observedSelfSlot = observedPartySlot(observed, localName);
  for (const row of elements.partySlots) {
    const slot = Number(row.dataset.slot);
    const scanned = observed.find((candidate) => candidate.slot === slot);
    const member = observed.length
      ? members.find((candidate) => observedPartySlot(observed, candidate.name) === slot)
      : members.find((candidate) => candidate.slot === slot);
    const displayName = scanned?.name || (scanned?.occupied ? `Player ${slot}` : "") || member?.name;
    row.style.setProperty("--player-color", partyColor(slot, "#6d6a62"));
    row.dataset.occupied = String(Boolean(displayName));
    row.dataset.self = String(observedSelfSlot ? observedSelfSlot === slot : member?.id === teamSync.clientId);
    row.querySelector(".party-name").textContent = displayName || "Empty slot";
    row.title = displayName ? `Player ${slot}: ${displayName}` : `Player ${slot}: empty`;
  }
}

function partyOcrRuntime() {
  return {
    ...resolvePartyOcrRuntime(window),
    // Reuse the app's striped capture path so a full-client party scan never
    // exceeds Alt1's maximum transfer size.
    capture: captureRegion,
  };
}

function globalPartyPanel(panel, offset) {
  return {
    ...panel,
    x: panel.x + offset.x,
    y: panel.y + offset.y,
    lineLeft: panel.lineLeft + offset.x,
    lineRight: panel.lineRight + offset.x,
    firstDividerY: panel.firstDividerY + offset.y,
  };
}

function expectedPartyNames() {
  const names = [elements.teamName.value.trim(), ...teamSync.members.map((member) => member.name)]
    .filter(Boolean);
  return names.filter((name, index) => names.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index);
}

async function scanPartyInterface({ manual = false, forceFull = false } = {}) {
  if (state.partyScanBusy || !elements.partyInterface.checked) return false;
  state.lastPartyScan = Date.now();
  if (!hasAlt1() || !window.alt1.rsLinked) {
    if (manual) elements.partyScanStatus.textContent = "Link Alt1 to RuneScape before scanning the party";
    return false;
  }
  const runtime = partyOcrRuntime();
  if (!runtime.capture || !runtime.ocr?.findReadLine || !runtime.font?.chars) {
    elements.partyScanStatus.textContent = "Alt1 OCR runtime unavailable; using team join order";
    return false;
  }

  state.partyScanBusy = true;
  elements.partyScan.disabled = true;
  try {
    const attempts = [];
    if (state.partyPanel && !forceFull) {
      const margin = 8;
      attempts.push({
        x: Math.max(0, state.partyPanel.x - margin),
        y: Math.max(0, state.partyPanel.y - margin),
        width: 0,
        height: 0,
      });
      const cached = attempts.at(-1);
      cached.width = Math.min(window.alt1.rsWidth - cached.x, state.partyPanel.width + margin * 2);
      cached.height = Math.min(window.alt1.rsHeight - cached.y, state.partyPanel.height + margin * 2);
    }
    attempts.push({ x: 0, y: 0, width: window.alt1.rsWidth, height: window.alt1.rsHeight });

    for (const area of attempts) {
      const image = runtime.capture(area.x, area.y, area.width, area.height);
      const result = readPartyInterface(image, { ...runtime, expectedNames: expectedPartyNames() });
      if (!result) continue;
      state.partyPanel = globalPartyPanel(result.panel, area);
      state.observedParty = reconcileObservedParty(result.members, expectedPartyNames());
      const named = state.observedParty.filter((member) => member.name).length;
      const occupied = state.observedParty.filter((member) => member.occupied).length;
      const rowEvidence = result.members.map((member) => member.pixelCount).join("/");
      elements.partyScanStatus.textContent = named
        ? `RuneScape party read: ${named}/${occupied} names · positions active`
        : `Party rows ${occupied}/5, OCR missed names · pixels ${rowEvidence}`;
      if (named) teamSync.sendPartyOrder(state.observedParty);
      renderParty();
      render();
      return true;
    }
    if (manual) elements.partyScanStatus.textContent = "DG party interface not found; keep it open and try again";
    return false;
  } catch (error) {
    elements.partyScanStatus.textContent = `Party scan failed: ${error.message || error}`;
    return false;
  } finally {
    state.partyScanBusy = false;
    elements.partyScan.disabled = false;
  }
}

function sendTeamSnapshot() {
  for (const [pointKey, annotation] of state.annotations) {
    teamSync.sendAnnotation(pointFromKey(pointKey), annotation.text);
  }
  for (const [index, point] of Object.entries(state.localGatestones)) teamSync.sendGatestone(index, point);
  teamSync.sendPartyOrder(state.observedParty);
}

function bindEvents() {
  moveWindowFrom(elements.titlebar);
  elements.calibrate.addEventListener("click", () => calibrate({ silent: false }));
  elements.pause.addEventListener("click", () => {
    state.autoScan = !state.autoScan;
    elements.pause.textContent = state.autoScan ? "Pause" : "Resume";
    setStatus(state.autoScan ? "Automatic scanning resumed" : "Automatic scanning paused", "warn");
    if (state.autoScan) scanOnce();
  });
  elements.save.addEventListener("click", saveMap);
  elements.clear.addEventListener("click", () => clearAnnotations(true));
  elements.captureResults.addEventListener("click", captureDungeonResults);
  elements.copyResults.addEventListener("click", copyResults);
  elements.showCapture.addEventListener("change", render);
  elements.showGrid.addEventListener("change", render);
  elements.gameOverlay.addEventListener("change", renderGameOverlay);
  elements.testOverlay.addEventListener("click", testGameOverlay);
  window.addEventListener("beforeunload", () => {
    clearGameOverlay();
    teamSync.disconnect(false);
  });
  elements.applyAnnotation.addEventListener("click", () => setSelectedAnnotation(elements.annotation.value));
  elements.annotation.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { setSelectedAnnotation(elements.annotation.value); elements.canvas.focus(); }
  });
  elements.canvas.addEventListener("click", (event) => {
    if (!state.gameMap) return;
    const point = imageToMap(canvasPoint(event), state.gameMap.floor);
    if (point) selectPoint(point);
  });
  elements.canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state.gameMap) return;
    const point = imageToMap(canvasPoint(event), state.gameMap.floor);
    if (!point || !isOpened(state.gameMap.typeAt(point.x, point.y))) return;
    const pointKey = floorPointKey(point);
    if (state.manualCritical.has(pointKey)) state.manualCritical.delete(pointKey);
    else state.manualCritical.add(pointKey);
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (!state.selected || /^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (delta) {
      const point = { x: state.selected.x + delta[0], y: state.selected.y + delta[1] };
      if (pointInFloor(point)) selectPoint(point);
      event.preventDefault();
    }
  });

  elements.teamCreate.addEventListener("click", () => {
    clearTeamGatestones();
    elements.teamRoom.value = createRoomCode();
    elements.teamRoom.value = teamSync.connect(
      elements.teamRoom.value, elements.teamName.value, undefined, { create: true },
    );
  });
  elements.teamJoin.addEventListener("click", () => {
    clearTeamGatestones();
    elements.teamRoom.value = teamSync.connect(elements.teamRoom.value, elements.teamName.value);
  });
  elements.teamDisconnect.addEventListener("click", () => {
    teamSync.disconnect();
    clearTeamGatestones();
  });
  elements.partyScan.addEventListener("click", () => scanPartyInterface({ manual: true, forceFull: true }));
  elements.partyInterface.addEventListener("change", () => {
    if (!elements.partyInterface.checked) {
      state.observedParty = [];
      state.partyPanel = null;
      elements.partyScanStatus.textContent = "RuneScape party positions disabled; using team join order";
      renderParty();
      render();
      return;
    }
    elements.partyScanStatus.textContent = "Open the DG party interface to scan its player order";
    scanPartyInterface({ manual: true, forceFull: true });
  });
  teamSync.addEventListener("status", (event) => { elements.teamStatus.textContent = event.detail; });
  teamSync.addEventListener("connected", () => {
    sendTeamSnapshot();
    scanPartyInterface({ forceFull: !state.partyPanel });
  });
  teamSync.addEventListener("disconnected", clearTeamGatestones);
  teamSync.addEventListener("hello", sendTeamSnapshot);
  teamSync.addEventListener("party", (event) => {
    state.observedParty = event.detail.members;
    elements.partyScanStatus.textContent = `RuneScape party order received from ${event.detail.senderName}`;
    renderParty();
    render();
  });
  teamSync.addEventListener("roster", () => {
    renderParty();
    const memberIds = new Set(teamSync.members.map((member) => member.id));
    if (memberIds.size) {
      for (const ownerId of state.teamGatestones.keys()) {
        if (!memberIds.has(ownerId)) state.teamGatestones.delete(ownerId);
      }
      for (const [pointKey, annotation] of state.annotations) {
        if (annotation.ownerId !== teamSync.clientId && !memberIds.has(annotation.ownerId)) {
          state.annotations.delete(pointKey);
        }
      }
    }
    render();
  });
  teamSync.addEventListener("full", clearTeamGatestones);
  teamSync.addEventListener("annotation", (event) => {
    const { senderId, senderName, point, text, slot } = event.detail;
    if (!pointInFloor(point)) return;
    if (text) {
      state.annotations.set(floorPointKey(point), {
        text: String(text).slice(0, 4),
        ownerId: senderId,
        ownerName: senderName,
        slot,
      });
    }
    else state.annotations.delete(floorPointKey(point));
    render();
  });
  teamSync.addEventListener("clear", () => clearAnnotations(false));
  teamSync.addEventListener("gatestone", (event) => {
    const { senderId, senderName, index, point, slot } = event.detail;
    let owner = state.teamGatestones.get(senderId);
    if (!owner) {
      owner = { id: senderId, name: senderName, slot, locations: new Map() };
      state.teamGatestones.set(senderId, owner);
    }
    owner.name = senderName;
    owner.slot = slot ?? owner.slot;
    if (pointInFloor(point)) owner.locations.set(index, point);
    else owner.locations.delete(index);
    if (!owner.locations.size) state.teamGatestones.delete(senderId);
    render();
  });
}

async function scanLoop() {
  await scanOnce();
  setTimeout(scanLoop, SCAN_INTERVAL);
}

async function partyScanLoop() {
  if (elements.partyInterface.checked && (teamSync.connected || state.partyPanel)
    && Date.now() - state.lastPartyScan >= PARTY_SCAN_INTERVAL) {
    await scanPartyInterface();
  }
  setTimeout(partyScanLoop, 1000);
}

async function scanOnce() {
  if (!state.autoScan || state.busy) return;
  if (state.calibration) {
    await updateMap();
    return;
  }
  if (Date.now() - state.lastCalibrationAttempt >= AUTO_CALIBRATION_INTERVAL) {
    await calibrate({ silent: true });
  }
}

function initialize() {
  bindEvents();
  renderParty();
  drawEmptyState();
  updateStats();
  window.__dungeonsAppReady = true;
  elements.teamRoom.value = createRoomCode();
  elements.teamName.value = storageGet(`${STORAGE_PREFIX}:name`) || "";
  elements.teamName.addEventListener("change", () => {
    storageSet(`${STORAGE_PREFIX}:name`, elements.teamName.value);
    renderParty();
    render();
  });

  const configUrl = new URL("appconfig.json", window.location.href).href;
  elements.installLink.href = `alt1://addapp/${configUrl}`;
  if (hasAlt1()) {
    try {
      identifyApp();
    } catch {
      // Alt1 identification is useful for permissions, but it must not block the UI.
    }
    elements.environment.textContent = `Alt1 ${window.alt1.version || ""}`.trim();
    if (state.calibration) setStatus(`Loading saved ${state.calibration.floor.name} calibration…`);
    else setStatus("Waiting for a Dungeoneering map to appear…", "warn");
  } else {
    elements.environment.textContent = "Browser preview";
    setStatus("Open this app in Alt1; a browser cannot read RuneScape pixels", "warn");
  }
  updateOverlayStatus();
  scanLoop();
  partyScanLoop();
}

try {
  initialize();
} catch (error) {
  window.__dungeonsAppReady = true;
  const message = error && error.message ? error.message : String(error);
  elements.environment.textContent = "Startup error";
  setStatus(`Startup error: ${message}`, "error");
}
