import {
  FLOOR_SIZES,
  ROOM_SIZE,
  RoomType,
  detectGatestones,
  findMapByCorners,
  gridOffset,
  imageToMap,
  isOpened,
  mapToImage,
  toChess,
} from "./src/map-core.js";
import { findMapByAlt1Anchor, scoreMapCandidate } from "./src/alt1-map-locator.js";
import { captureFullRuneScape, captureRegion, hasAlt1, identifyApp, moveWindowFrom } from "./src/alt1-capture.js";
import {
  buildMapOverlayCommands,
  buildTestOverlayCommands,
  drawOverlayGroup,
  formatMapStats,
} from "./src/alt1-overlay.js?v=20260622-12";
import { TeamSync, createRoomCode } from "./src/team-sync.js?v=20260622-12";
import {
  PARTY_COLORS,
  mergeObservedPartyCache,
  observedPartySlot,
  partyColor,
  reconcileObservedParty,
} from "./src/party-core.js?v=20260622-12";
import { readPartyInterface, resolvePartyOcrRuntime } from "./src/party-interface.js?v=20260622-12";
import { buildVisibleRemoteGatestones } from "./src/team-gates.js?v=20260622-12";
import { PARTY_CONTEXT_OPTIONS, clampContextMenuPosition } from "./src/party-menu.js?v=20260622-12";
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
  partyForget: document.querySelector("#party-forget"),
  partyScanStatus: document.querySelector("#party-scan-status"),
  partyContextMenu: document.querySelector("#party-context-menu"),
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
  partyPendingChanges: new Map(),
  partyPanel: null,
  partyScanBusy: false,
  partyAutoScan: false,
  lastPartyScan: 0,
  syncedLocalGatestones: new Set(),
  partyMenuTarget: null,
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
  const rosterSlot = teamSync.member(ownerId)?.slot;
  if (rosterSlot) return rosterSlot;
  if (!teamSync.members.length && elements.partyInterface.checked && state.observedParty.length) {
    const syncedName = teamSync.member(ownerId)?.name;
    const localName = ownerId === teamSync.clientId
      ? (elements.teamName.value.trim() || teamSync.name)
      : "";
    const observed = observedPartySlot(state.observedParty, syncedName || localName);
    if (observed) return observed;
  }
  return validHintedSlot(hintedSlot);
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

function findMapInRuneScapeClient() {
  const anchored = findMapByAlt1Anchor(window.alt1, captureRegion);
  if (anchored) return anchored;
  const fullClient = captureFullRuneScape();
  const cornerMatch = findMapByCorners(fullClient);
  return cornerMatch ? { ...cornerMatch, method: "corners" } : null;
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
    const match = findMapInRuneScapeClient();
    if (!match) {
      clearCalibration();
      setStatus("Waiting for a Dungeoneering map to appear…", "warn");
    } else {
      state.calibration = match;
      state.invalidCaptures = 0;
      saveCalibration();
      found = true;
      setStatus(`Calibrated by ${match.method || "corners"}: ${match.floor.name} at ${match.x},${match.y}`, "ok");
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
    let scoredMap = scoreMapCandidate(image, floor);
    if (!scoredMap) {
      // Reacquire a moved map immediately so native labels, gatestones and the
      // stats strip remain magnetically attached to its client coordinates.
      const relocated = findMapInRuneScapeClient();
      if (relocated) {
        state.calibration = relocated;
        ({ x, y, floor } = relocated);
        saveCalibration();
        image = captureRegion(x, y, floor.imageWidth, floor.imageHeight);
        scoredMap = scoreMapCandidate(image, floor);
      }
    }
    if (!scoredMap) {
      state.invalidCaptures += 1;
      setStatus(`Map image lost (${state.invalidCaptures}/${INVALID_CAPTURES_BEFORE_RECALIBRATION})`, "warn");
      shouldRecalibrate = state.invalidCaptures >= INVALID_CAPTURES_BEFORE_RECALIBRATION;
      return;
    }

    state.invalidCaptures = 0;
    const gameMap = scoredMap.gameMap;
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
    if ((previousPoint || nextPoint) && !samePoint(previousPoint, nextPoint)) {
      state.syncedLocalGatestones.delete(index);
      if (teamSync.sendGatestone(index, nextPoint) && nextPoint) state.syncedLocalGatestones.add(index);
    }
  }
  state.localGatestones = next;
}

function clearTeamGatestones() {
  if (!state.teamGatestones.size) return;
  state.teamGatestones.clear();
  render();
}

function clearRemoteTeamState() {
  state.teamGatestones.clear();
  for (const [pointKey, annotation] of state.annotations) {
    if (annotation.ownerId !== teamSync.clientId) state.annotations.delete(pointKey);
  }
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
  return buildVisibleRemoteGatestones(
    state.teamGatestones,
    floor,
    (ownerId, hintedSlot) => participantSlot(ownerId, hintedSlot),
  );
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
  const localCount = Object.keys(state.localGatestones).length;
  const localSent = state.syncedLocalGatestones.size;
  const teamCount = markers.length;
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
      + ` | labels ${state.annotations.size} | local gates detected ${localCount}/synced ${localSent}`
      + ` | remote gates visible ${teamCount}${delivery}`;
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
  link.download = `dungeon-map-${new Date().toISOString().replace(/:/g, "-").slice(0, 19)}.png`;
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

function applyObservedParty(incoming, source = "scan") {
  const merged = mergeObservedPartyCache(
    state.observedParty,
    incoming,
    state.partyPendingChanges,
    { source },
  );
  state.observedParty = merged.members;
  state.partyPendingChanges = merged.pending;
  return merged.changed;
}

function forgetParty() {
  state.observedParty = [];
  state.partyPendingChanges.clear();
  state.partyPanel = null;
  state.partyAutoScan = false;
  renderParty();
  elements.partyScanStatus.textContent = "Party forgotten; open the DG party interface and scan again";
}

function validHintedSlot(slot) {
  const number = Number(slot);
  return Number.isInteger(number) && number >= 1 && number <= PARTY_COLORS.length ? number : null;
}

function trustedTeamSender(senderId) {
  if (!teamSync.members.length) return true;
  return teamSync.members.some((member) => member.id === senderId);
}

function clearTeamMemberState(memberId) {
  state.teamGatestones.delete(memberId);
  for (const [pointKey, annotation] of state.annotations) {
    if (annotation.ownerId === memberId) state.annotations.delete(pointKey);
  }
}

function partyRowMember(row) {
  const memberId = row?.dataset?.memberId;
  if (memberId) return teamSync.members.find((member) => member.id === memberId) ?? null;
  const slot = Number(row?.dataset?.slot);
  return teamSync.members.find((member) => member.slot === slot) ?? null;
}

function partyRowDisplay(row) {
  const member = partyRowMember(row);
  if (member) return { member, slot: member.slot, name: member.name, source: "room" };
  const slot = Number(row?.dataset?.slot);
  const scanned = elements.partyInterface.checked
    ? state.observedParty.find((candidate) => candidate.slot === slot)
    : null;
  return {
    member: null,
    slot,
    name: scanned?.name || (scanned?.occupied ? `Player ${slot}` : ""),
    source: scanned ? "scan" : "empty",
  };
}

function renderParty() {
  const members = teamSync.members;
  const rosterActive = members.length > 0;
  const observed = !rosterActive && elements.partyInterface.checked ? state.observedParty : [];
  const localName = elements.teamName.value.trim() || teamSync.name;
  const observedSelfSlot = !rosterActive ? observedPartySlot(observed, localName) : null;
  for (const row of elements.partySlots) {
    const slot = Number(row.dataset.slot);
    const scanned = observed.find((candidate) => candidate.slot === slot);
    const member = members.find((candidate) => candidate.slot === slot);
    const displayName = scanned?.name || (scanned?.occupied ? `Player ${slot}` : "") || member?.name;
    row.style.setProperty("--player-color", partyColor(slot, "#6d6a62"));
    row.dataset.occupied = String(Boolean(displayName));
    row.dataset.self = String(rosterActive ? member?.id === teamSync.clientId : observedSelfSlot === slot);
    row.dataset.memberId = member?.id ?? "";
    row.dataset.source = member ? "room" : scanned ? "scan" : "empty";
    row.querySelector(".party-name").textContent = displayName || "Empty slot";
    row.title = displayName ? `Player ${slot}: ${displayName}` : `Player ${slot}: empty`;
  }
}

function hidePartyContextMenu() {
  if (!elements.partyContextMenu) return;
  elements.partyContextMenu.hidden = true;
  state.partyMenuTarget = null;
}

function showPartyContextMenu(event, row) {
  if (!elements.partyContextMenu) return;
  event.preventDefault();
  state.partyMenuTarget = partyRowDisplay(row);
  elements.partyContextMenu.hidden = false;
  elements.partyContextMenu.style.visibility = "hidden";
  elements.partyContextMenu.style.left = "0px";
  elements.partyContextMenu.style.top = "0px";
  const position = clampContextMenuPosition(
    event.clientX,
    event.clientY,
    elements.partyContextMenu.offsetWidth,
    elements.partyContextMenu.offsetHeight,
    window.innerWidth,
    window.innerHeight,
  );
  elements.partyContextMenu.style.left = `${position.x}px`;
  elements.partyContextMenu.style.top = `${position.y}px`;
  elements.partyContextMenu.style.visibility = "visible";
}

function inspectPartyTarget(target) {
  if (!target?.name) {
    elements.teamStatus.textContent = `Player ${target?.slot ?? "?"}: empty slot`;
    return;
  }
  const status = target.member
    ? target.member.id === teamSync.clientId ? "you" : "connected"
    : "scan helper only";
  elements.teamStatus.textContent = `Player ${target.slot}: ${target.name} (${status})`;
}

function kickPartyTarget(target) {
  if (!teamSync.isHost) {
    elements.teamStatus.textContent = "Only the red host can kick players";
    return;
  }
  if (!target?.member) {
    elements.teamStatus.textContent = "No connected player in that slot to kick";
    return;
  }
  if (target.member.id === teamSync.clientId) {
    elements.teamStatus.textContent = "The host cannot kick themselves";
    return;
  }
  const result = teamSync.kickMember(target.member.id);
  if (!result.ok) {
    elements.teamStatus.textContent = result.message;
    return;
  }
  clearTeamMemberState(target.member.id);
  elements.teamStatus.textContent = `${target.member.name} was kicked from the team room`;
  renderParty();
  render();
}

function promotePartyTarget(target) {
  if (!teamSync.isHost) {
    elements.teamStatus.textContent = "Only the red host can promote players";
    return;
  }
  if (!target?.member) {
    elements.teamStatus.textContent = "No connected player in that slot to promote";
    return;
  }
  const result = teamSync.promoteMember(target.member.id);
  elements.teamStatus.textContent = result.message;
  if (result.ok) {
    renderParty();
    render();
  }
}

function handlePartyContextAction(action) {
  if (!PARTY_CONTEXT_OPTIONS.map((option) => option.toLowerCase()).includes(action)) return;
  const target = state.partyMenuTarget;
  hidePartyContextMenu();
  if (action === "inspect") inspectPartyTarget(target);
  else if (action === "kick") kickPartyTarget(target);
  else if (action === "promote") promotePartyTarget(target);
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
  const names = [
    elements.teamName.value.trim(),
    ...state.observedParty.map((member) => member.name),
    ...teamSync.members.map((member) => member.name),
  ]
    .filter(Boolean);
  return names.filter((name, index) => names.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index);
}

function formatPartyScanStatus(result) {
  const rawNames = result.members
    .filter((member) => member.occupied && member.name)
    .map((member) => `${member.slot}:${member.name}`);
  const occupied = result.members.filter((member) => member.occupied).length;
  const cachedNames = state.observedParty.filter((member) => member.name);
  const namesText = rawNames.length ? `names ${rawNames.join(", ")}` : "OCR missed names";
  const rowEvidence = result.members.map((member) => member.pixelCount).join("/");
  const roomText = teamSync.members.length ? "; manual room order unchanged" : "; helper order active until a room roster is available";
  return `RuneScape party read ${rawNames.length}/${occupied} names (${namesText}); cached ${cachedNames.length}/5${roomText} - pixels ${rowEvidence}`;
}

async function scanPartyInterface({ manual = false, forceFull = false } = {}) {
  if (state.partyScanBusy || !elements.partyInterface.checked) return false;
  state.lastPartyScan = Date.now();
  if (manual) state.partyAutoScan = true;
  if (!hasAlt1() || !window.alt1.rsLinked) {
    state.partyAutoScan = false;
    if (manual) {
      elements.partyScanStatus.textContent = state.observedParty.length
        ? `RuneScape unavailable; cached ${state.observedParty.length} party names retained`
        : "Link Alt1 to RuneScape before scanning the party";
    }
    return false;
  }
  const runtime = partyOcrRuntime();
  if (!runtime.capture || !runtime.ocr?.findReadLine || !runtime.font?.chars) {
    state.partyAutoScan = false;
    elements.partyScanStatus.textContent = state.observedParty.length
      ? `Alt1 OCR unavailable; cached ${state.observedParty.length} party names retained`
      : "Alt1 OCR runtime unavailable; using team join order";
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
      const cached = attempts[attempts.length - 1];
      cached.width = Math.min(window.alt1.rsWidth - cached.x, state.partyPanel.width + margin * 2);
      cached.height = Math.min(window.alt1.rsHeight - cached.y, state.partyPanel.height + margin * 2);
    }
    attempts.push({ x: 0, y: 0, width: window.alt1.rsWidth, height: window.alt1.rsHeight });

    for (const area of attempts) {
      const image = runtime.capture(area.x, area.y, area.width, area.height);
      const result = readPartyInterface(image, { ...runtime, expectedNames: expectedPartyNames() });
      if (!result) continue;
      state.partyPanel = globalPartyPanel(result.panel, area);
      const reconciled = reconcileObservedParty(result.members, expectedPartyNames());
      applyObservedParty(reconciled, "scan");
      state.partyAutoScan = true;
      elements.partyScanStatus.textContent = formatPartyScanStatus(result);
      renderParty();
      render();
      return true;
    }
    state.partyAutoScan = false;
    state.partyPanel = null;
    elements.partyScanStatus.textContent = state.observedParty.length
      ? `DG party interface closed; cached ${state.observedParty.length} names`
      : "DG party interface not found; open it and try again";
    return false;
  } catch (error) {
    state.partyAutoScan = false;
    elements.partyScanStatus.textContent = `Party scan failed: ${error.message || error}`;
    return false;
  } finally {
    state.partyScanBusy = false;
    elements.partyScan.disabled = false;
  }
}

function sendTeamSnapshot() {
  for (const [pointKey, annotation] of state.annotations) {
    if (annotation.ownerId !== teamSync.clientId) continue;
    teamSync.sendAnnotation(pointFromKey(pointKey), annotation.text);
  }
  state.syncedLocalGatestones.clear();
  for (const [index, point] of Object.entries(state.localGatestones)) {
    if (teamSync.sendGatestone(index, point)) state.syncedLocalGatestones.add(Number(index));
  }
  updateOverlayStatus();
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
    if (event.key === "Escape" && !elements.partyContextMenu.hidden) {
      hidePartyContextMenu();
      event.preventDefault();
      return;
    }
    if (!state.selected || /^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (delta) {
      const point = { x: state.selected.x + delta[0], y: state.selected.y + delta[1] };
      if (pointInFloor(point)) selectPoint(point);
      event.preventDefault();
    }
  });

  elements.teamCreate.addEventListener("click", () => {
    clearRemoteTeamState();
    elements.teamRoom.value = createRoomCode();
    elements.teamRoom.value = teamSync.connect(
      elements.teamRoom.value, elements.teamName.value, undefined, { create: true },
    );
  });
  elements.teamJoin.addEventListener("click", () => {
    clearRemoteTeamState();
    elements.teamRoom.value = teamSync.connect(elements.teamRoom.value, elements.teamName.value);
  });
  elements.teamDisconnect.addEventListener("click", () => {
    teamSync.disconnect();
    state.syncedLocalGatestones.clear();
    clearRemoteTeamState();
  });
  elements.partyScan.addEventListener("click", () => scanPartyInterface({ manual: true, forceFull: true }));
  elements.partyForget.addEventListener("click", forgetParty);
  elements.partyInterface.addEventListener("change", () => {
    if (!elements.partyInterface.checked) {
      state.partyAutoScan = false;
      state.partyPanel = null;
      elements.partyScanStatus.textContent = state.observedParty.length
        ? `RuneScape party positions disabled; cached ${state.observedParty.length} names`
        : "RuneScape party positions disabled; using team join order";
      renderParty();
      render();
      return;
    }
    elements.partyScanStatus.textContent = state.observedParty.length
      ? `Using ${state.observedParty.length} cached party names; scanning for updates`
      : "Open the DG party interface to scan its player order";
    scanPartyInterface({ manual: true, forceFull: true });
  });
  for (const row of elements.partySlots) {
    row.addEventListener("contextmenu", (event) => showPartyContextMenu(event, row));
  }
  elements.partyContextMenu.addEventListener("mouseleave", hidePartyContextMenu);
  elements.partyContextMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = event.target?.dataset?.action;
    if (action) handlePartyContextAction(action);
  });
  document.addEventListener("click", (event) => {
    if (!elements.partyContextMenu.hidden && !elements.partyContextMenu.contains(event.target)) {
      hidePartyContextMenu();
    }
  });
  teamSync.addEventListener("status", (event) => { elements.teamStatus.textContent = event.detail; });
  teamSync.addEventListener("connected", () => {
    sendTeamSnapshot();
  });
  teamSync.addEventListener("disconnected", () => {
    state.syncedLocalGatestones.clear();
    clearRemoteTeamState();
  });
  teamSync.addEventListener("hello", (event) => {
    if (trustedTeamSender(event.detail.senderId)) sendTeamSnapshot();
  });
  teamSync.addEventListener("party", (event) => {
    if (!trustedTeamSender(event.detail.senderId)) return;
    applyObservedParty(event.detail.members, "remote");
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
    if (!trustedTeamSender(senderId) || !pointInFloor(point)) return;
    const trustedSlot = teamSync.member(senderId)?.slot ?? validHintedSlot(slot);
    if (text) {
      state.annotations.set(floorPointKey(point), {
        text: String(text).slice(0, 4),
        ownerId: senderId,
        ownerName: senderName,
        slot: trustedSlot,
      });
    }
    else state.annotations.delete(floorPointKey(point));
    render();
  });
  teamSync.addEventListener("clear", (event) => {
    if (trustedTeamSender(event.detail.senderId)) clearAnnotations(false);
  });
  teamSync.addEventListener("gatestone", (event) => {
    const { senderId, senderName, index, point, slot } = event.detail;
    if (!trustedTeamSender(senderId)) return;
    const trustedSlot = teamSync.member(senderId)?.slot ?? validHintedSlot(slot);
    let owner = state.teamGatestones.get(senderId);
    if (!owner) {
      owner = { id: senderId, name: senderName, slot: trustedSlot, locations: new Map() };
      state.teamGatestones.set(senderId, owner);
    }
    owner.name = senderName;
    owner.slot = trustedSlot ?? owner.slot;
    if (pointInFloor(point)) owner.locations.set(index, point);
    else owner.locations.delete(index);
    if (!owner.locations.size) state.teamGatestones.delete(senderId);
    render();
  });
  teamSync.addEventListener("leave", (event) => {
    const { senderId } = event.detail;
    clearTeamMemberState(senderId);
    render();
  });
  teamSync.addEventListener("kicked", () => {
    state.syncedLocalGatestones.clear();
    clearRemoteTeamState();
    render();
  });
}

async function scanLoop() {
  await scanOnce();
  setTimeout(scanLoop, SCAN_INTERVAL);
}

async function partyScanLoop() {
  if (elements.partyInterface.checked && state.partyAutoScan
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
