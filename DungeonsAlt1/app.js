import {
  FLOOR_SIZES,
  ROOM_SIZE,
  RoomType,
  detectGatestones,
  gridOffset,
  imageToMap,
  isOpened,
  mapToImage,
  toChess,
} from "./src/map-core.js?v=20260718-37";
import {
  MAP_SCALE_CANDIDATES,
  findMapByAlt1Anchor,
  findMapByScaledCorners,
  readMapAtCalibration,
  scaledFloorDimensions,
} from "./src/alt1-map-locator.js?v=20260718-37";
import { captureFullRuneScape, captureRegion, hasAlt1, identifyApp, moveWindowFrom } from "./src/alt1-capture.js?v=20260718-37";
import { normalizeCaptureInterval, reserveCaptureSlot } from "./src/capture-scheduler.js?v=20260718-37";
import {
  createInterfaceScaleState,
  currentInterfaceScale,
  interfaceScaleLabel,
  isFreshInterfaceScaleObservation,
  parseSavedInterfaceScale,
  observeInterfaceScale,
} from "./src/interface-scale.js?v=20260718-37";
import {
  buildMapOverlayCommands,
  buildTestOverlayCommands,
  drawOverlayGroup,
  formatMapStats,
} from "./src/alt1-overlay.js?v=20260718-37";
import {
  DEFAULT_FLOOR_TARGET_SECONDS,
  elapsedFloorMinutes,
  elapsedFloorSeconds,
  evaluateMapTransition,
  floorPaceStatus,
  floorStartForDetectedMap,
  formatElapsedClock,
  parseFloorTargetSeconds,
  rpmValue,
  trackedBaseAfterTransition,
} from "./src/rpm-state.js?v=20260718-37";
import { TeamSync, createRoomCode } from "./src/team-sync.js?v=20260718-37";
import {
  PARTY_COLORS,
  automaticPartyRoomStatus,
  mergeObservedPartyCache,
  observedPartySlot,
  partyColor,
  reconcileObservedParty,
  roomStatusLine,
} from "./src/party-core.js?v=20260718-37";
import { readPartyInterface, resolvePartyOcrRuntime } from "./src/party-interface.js?v=20260718-37";
import { loadChatboxFont, readPartyByAnchor } from "./src/party-anchor.js?v=20260718-37";
import {
  RESULT_COLUMNS,
  RESULT_DISPLAY_COLUMNS,
  RESULT_BATCH_MODES,
  enforceResultStableDuration,
  nextAutoResultState,
  orderedResultsForDisplay,
  resultDisplayValue,
  plannedResultExports,
  resultCaptureRect,
  resultMapSnapshotMatchesGeneration,
  resultAlreadyRecorded,
  resultLooksComplete,
  resultStabilityKey,
  mapSnapshotFingerprint,
  resultBatchIsComplete,
  resultBatchStatus,
  resultMatchesFloorFilter,
  normalizeResultBatchTarget,
  normalizeStoredResults,
  safeFilePart,
  safeTimestampForFilename,
} from "./src/results-core.js?v=20260718-37";
import {
  chooseSaveFolder,
  clearStoredSaveFolder,
  isSaveFolderPermissionError,
  knownAlt1FolderWritesUnsupported,
  loadStoredSaveFolder,
  querySaveFolderPermission,
  requestSaveFolderPermission,
  supportsFolderSaving,
  writeDataUrlToFolder,
} from "./src/file-saver.js?v=20260718-37";
import {
  MAX_CAPTURE_ARCHIVE_ITEMS,
  buildCaptureZip,
  deleteCaptureArchiveRecords,
  loadCaptureArchive,
  requestPersistentCaptureStorage,
  triggerBlobDownload,
  upsertCaptureArchive,
} from "./src/capture-archive.js?v=20260718-37";
import { buildVisibleRemoteGatestones } from "./src/team-gates.js?v=20260718-37";
import { PARTY_CONTEXT_OPTIONS, clampContextMenuPosition } from "./src/party-menu.js?v=20260718-37";
import { WinterfaceReader } from "./src/winterface.js?v=20260718-37";
import {
  RESULTS_SENTINEL_CADENCE_MS,
  createResultsSentinelPlan,
  resultsSentinelsMatch,
} from "./src/results-sentinel.js?v=20260718-37";

const SCAN_INTERVAL = 600;
const AUTO_CALIBRATION_INTERVAL = 2500;
const STORAGE_PREFIX = "dungeons-alt1";
const INVALID_CAPTURES_BEFORE_RECALIBRATION = 3;
const UNREADABLE_CAPTURES_BEFORE_RECALIBRATION = 3;
const OVERLAY_DURATION = 30000;
// Native overlays live for OVERLAY_DURATION, so re-issuing them every 600ms
// frame is wasted native-call churn on the game screen. Only redraw when the
// overlay content changes, or this often to refresh before it expires.
const OVERLAY_REFRESH_INTERVAL = 20000;
const PARTY_SCAN_INTERVAL = 5000;
// Discover a newly opened final-results screen promptly, while the independent
// three-read + 1.2s wall-clock gate below still prevents empty/animating values
// from reaching the floor tracker. Alt1's larger captureInterval always wins.
const RESULTS_AUTO_INTERVAL = 900;
const RESULTS_SETTLE_INTERVAL = 300;
const RESULTS_MANUAL_MAX_SCANS = 30;
const RESULTS_SCALE_FALLBACK_ACTIVE_INTERVAL = 3000;
const RESULTS_SCALE_FALLBACK_IDLE_INTERVAL = 30000;
const MAX_PERSISTED_RESULTS = 500;
const RECENT_RESULT_SCREEN_MAX_AGE = 10 * 60 * 1000;

// High-resolution timer for the optional in-app performance readout (debug mode).
const perfNow = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? () => performance.now() : () => Date.now();

const elements = {
  titlebar: document.querySelector(".titlebar"),
  status: document.querySelector("#status"),
  stats: document.querySelector("#stats"),
  mapShell: document.querySelector(".map-shell"),
  canvas: document.querySelector("#map"),
  calibrate: document.querySelector("#calibrate"),
  pause: document.querySelector("#pause"),
  save: document.querySelector("#save"),
  clear: document.querySelector("#clear"),
  captureResults: document.querySelector("#capture-results"),
  showCapture: document.querySelector("#show-capture"),
  showGrid: document.querySelector("#show-grid"),
  rpmOnly: document.querySelector("#rpm-only"),
  gameOverlay: document.querySelector("#game-overlay"),
  statsPosition: document.querySelector("#stats-position"),
  interfaceScaleStatus: document.querySelector("#interface-scale-status"),
  statsFreeControls: document.querySelector("#stats-free-controls"),
  statsFreeX: document.querySelector("#stats-free-x"),
  statsFreeY: document.querySelector("#stats-free-y"),
  statsFreeNudge: [...document.querySelectorAll("[data-stats-nudge]")],
  statsPlace: document.querySelector("#stats-place"),
  paceIndicator: document.querySelector("#pace-indicator"),
  paceTarget: document.querySelector("#pace-target"),
  testOverlay: document.querySelector("#test-overlay"),
  overlayStatus: document.querySelector("#overlay-status"),
  autoTrackResults: document.querySelector("#auto-track-results"),
  autoSaveMapPng: document.querySelector("#auto-save-map-png"),
  autoSaveResultsPng: document.querySelector("#auto-save-results-png"),
  resultBatchSize: document.querySelector("#result-batch-size"),
  resultFloorFilter: document.querySelector("#result-floor-filter"),
  resultBatchMode: document.querySelector("#result-batch-mode"),
  resetResultBatch: document.querySelector("#reset-result-batch"),
  resultBatchSummary: document.querySelector("#result-batch-summary"),
  chooseMapSaveFolder: document.querySelector("#choose-map-save-folder"),
  clearMapSaveFolder: document.querySelector("#clear-map-save-folder"),
  reallowMapSaveFolder: document.querySelector("#reallow-map-save-folder"),
  mapSaveFolderStatus: document.querySelector("#map-save-folder-status"),
  chooseResultsSaveFolder: document.querySelector("#choose-results-save-folder"),
  clearResultsSaveFolder: document.querySelector("#clear-results-save-folder"),
  reallowResultsSaveFolder: document.querySelector("#reallow-results-save-folder"),
  resultsSaveFolderStatus: document.querySelector("#results-save-folder-status"),
  downloadCaptureArchive: document.querySelector("#download-capture-archive"),
  clearCaptureArchive: document.querySelector("#clear-capture-archive"),
  captureArchiveStatus: document.querySelector("#capture-archive-status"),
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
  roomStatus: document.querySelector("#room-status"),
  experimentalFeatures: document.querySelector("#experimental-features"),
  experimentalTools: document.querySelector("#experimental-tools"),
  experimentalAutoRoom: document.querySelector("#experimental-auto-room"),
  debugMode: document.querySelector("#debug-mode"),
  partyContextMenu: document.querySelector("#party-context-menu"),
  installLink: document.querySelector("#install-link"),
  environment: document.querySelector("#environment"),
  resultsBody: document.querySelector("#results-body"),
  copyResults: document.querySelector("#copy-results"),
};

const context = elements.canvas.getContext("2d", { alpha: true });
const teamSync = new TeamSync();
const winterfaceReader = WinterfaceReader.load();
const initialCalibration = loadCalibration();

const state = {
  calibration: initialCalibration,
  interfaceScale: createInterfaceScaleState(initialCalibration?.scale),
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
  lastFloorName: null,
  lastAcceptedMapScale: null,
  lastMapReadAt: 0,
  mapGeneration: 0,
  lastResultMapGenerationConsumed: 0,
  mapSnapshotFingerprint: "",
  mapSnapshotRevision: 0,
  lastResultMapSnapshotRevisionConsumed: 0,
  activeResultContext: null,
  mapLostAt: null,
  awaitingNewFloor: false,
  invalidCaptures: 0,
  unreadableCaptures: 0,
  weakFrameCaptures: 0,
  unusableCaptures: 0,
  autoScan: true,
  busy: false,
  lastCalibrationAttempt: 0,
  lastOverlayReport: null,
  lastOverlaySignature: "",
  lastOverlayDraw: 0,
  perf: null,
  // Free (movable) RPM/stats overlay position; restored from storage on init.
  statsFree: { x: 8, y: 8 },
  placingStats: false,
  results: loadStoredResults(),
  recentResultScreen: loadRecentResultScreen(),
  resultsBusy: false,
  autoResultState: { visible: false, key: "", handled: false, missing: 0, stable: 0 },
  resultStableTiming: { key: "", since: 0 },
  lastAutoResultScan: 0,
  lastResultSentinelProbe: 0,
  resultSentinelOpen: false,
  lastResultMarkerSource: null,
  nextPixelCaptureAt: 0,
  lastResultsScaleFallback: 0,
  pendingResultsPngs: [],
  pendingMapPngs: [],
  inFlightResultsPngs: [],
  inFlightMapPngs: [],
  droppedResultsPngs: 0,
  droppedMapPngs: 0,
  retryingResultsPngs: false,
  retryingMapPngs: false,
  retryMapPngsRequested: false,
  retryMapPngsNotify: false,
  retryResultsPngsRequested: false,
  retryResultsPngsNotify: false,
  captureArchive: {
    loaded: false,
    readSucceeded: false,
    supported: Boolean(window.indexedDB),
    persistent: null,
    exportBusy: false,
    clearBusy: false,
    lastExportCount: 0,
    lastExportKeys: new Set(),
    lastExportHadErrors: false,
    persistChain: Promise.resolve(),
    restorePromise: Promise.resolve(),
  },
  pendingFloorReset: null,
  saveFolders: {
    supported: false,
    hostWriteUnsupported: false,
    lastHostFailure: null,
    map: {
      handle: null,
      name: "",
      permission: "unknown",
      loading: true,
      source: "none",
      writeVerified: false,
      lastFailure: null,
    },
    results: {
      handle: null,
      name: "",
      permission: "unknown",
      loading: true,
      source: "none",
      writeVerified: false,
      lastFailure: null,
    },
  },
  observedParty: [],
  partyPendingChanges: new Map(),
  partyPanel: null,
  partyScanBusy: false,
  partyAutoScan: false,
  lastPartyScan: 0,
  chatboxFont: null,
  experimentalEnabled: false,
  syncedLocalGatestones: new Set(),
  partyMenuTarget: null,
  // Room-status indicator: roomWanted tracks whether we intended to be in a room
  // (so a drop reads "connection lost" rather than "not in a room"); roomStatusHint
  // holds the idle-state line (waiting/why-skipped) shown when no socket is live.
  roomWanted: false,
  roomStatusHint: null,
};

function loadCalibration() {
  try {
    const saved = JSON.parse(storageGet(`${STORAGE_PREFIX}:calibration`));
    const floor = FLOOR_SIZES.find((candidate) => candidate.name === saved?.floor);
    const scale = parseSavedInterfaceScale(saved?.scale);
    if (floor && scale !== null
      && Number.isInteger(saved.x) && saved.x >= 0
      && Number.isInteger(saved.y) && saved.y >= 0) {
      const dimensions = scaledFloorDimensions(floor, scale);
      const linkedClient = currentClientDimensions();
      const storedWidth = Number(saved.rsWidth) > 0 ? Math.round(Number(saved.rsWidth)) : 0;
      const storedHeight = Number(saved.rsHeight) > 0 ? Math.round(Number(saved.rsHeight)) : 0;
      const clientWidth = linkedClient.width || storedWidth;
      const clientHeight = linkedClient.height || storedHeight;
      if ((clientWidth && saved.x + dimensions.width > clientWidth)
        || (clientHeight && saved.y + dimensions.height > clientHeight)) return null;
      return {
        x: saved.x,
        y: saved.y,
        floor,
        scale: dimensions.scale,
        captureWidth: dimensions.width,
        captureHeight: dimensions.height,
        rsWidth: storedWidth || null,
        rsHeight: storedHeight || null,
        verified: false,
      };
    }
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
    scale: state.calibration.scale || 1,
    rsWidth: state.calibration.rsWidth || currentClientDimensions().width || null,
    rsHeight: state.calibration.rsHeight || currentClientDimensions().height || null,
  }));
}

function loadStoredResults() {
  try {
    return normalizeStoredResults(
      JSON.parse(storageGet(`${STORAGE_PREFIX}:results`) || "[]"),
      MAX_PERSISTED_RESULTS,
    );
  } catch {
    return [];
  }
}

function persistResults() {
  state.results = normalizeStoredResults(state.results, MAX_PERSISTED_RESULTS);
  return storageSet(`${STORAGE_PREFIX}:results`, JSON.stringify(state.results));
}

function loadRecentResultScreen() {
  try {
    const value = JSON.parse(storageGet(`${STORAGE_PREFIX}:last-result-screen`) || "null");
    const committedAt = Number(value?.committedAt);
    const key = String(value?.key || "").slice(0, 4096);
    return key && Number.isFinite(committedAt) && committedAt > 0 ? { key, committedAt } : null;
  } catch {
    return null;
  }
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

function currentClientDimensions() {
  const width = Math.round(Number(window.alt1?.rsWidth));
  const height = Math.round(Number(window.alt1?.rsHeight));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
  };
}

function calibrationWithClientDimensions(calibration) {
  if (!calibration) return null;
  const client = currentClientDimensions();
  return {
    ...calibration,
    rsWidth: client.width || calibration.rsWidth || null,
    rsHeight: client.height || calibration.rsHeight || null,
    verified: true,
  };
}

function calibrationMatchesLinkedClient(calibration) {
  if (!calibration) return false;
  const client = currentClientDimensions();
  if (!client.width || !client.height || !calibration.rsWidth || !calibration.rsHeight) return true;
  return client.width === calibration.rsWidth && client.height === calibration.rsHeight;
}

function updateInterfaceScaleStatus() {
  if (!elements.interfaceScaleStatus) return;
  let label = interfaceScaleLabel(
    state.interfaceScale,
    state.calibration?.verified ? state.calibration : null,
  );
  const desktopCapture = Boolean(window.alt1?.compatEnabled);
  if (desktopCapture) label += " — Desktop capture includes overlays; native in-game overlay disabled (use DirectX/OpenGL)";
  elements.interfaceScaleStatus.textContent = label;
  elements.interfaceScaleStatus.dataset.tone = desktopCapture ? "warn" : "ok";
}

function recordInterfaceScale(value, source) {
  state.interfaceScale = observeInterfaceScale(state.interfaceScale, value, source, Date.now());
  updateInterfaceScaleStatus();
}

function detectedInterfaceScale() {
  return currentInterfaceScale({ calibration: state.calibration, scaleState: state.interfaceScale });
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

function resetFloor(now = Date.now(), openedRooms = 1) {
  state.floorStart = floorStartForDetectedMap(now, openedRooms);
  state.mapGeneration += 1;
  state.pendingFloorReset = null;
  state.annotations.clear();
  state.manualCritical.clear();
  state.teamGatestones.clear();
  state.selected = null;
  elements.annotation.value = "";
  elements.selection.textContent = "No room selected";
}

function clearCalibration() {
  if (state.calibration?.scale) {
    state.interfaceScale = {
      ...state.interfaceScale,
      value: state.calibration.scale,
      source: "saved-hint",
      confirmed: false,
    };
  }
  state.calibration = null;
  storageRemove(`${STORAGE_PREFIX}:calibration`);
  clearGameOverlay();
  updateInterfaceScaleStatus();
}

function sameCalibration(left, right) {
  return Boolean(left && right
    && left.x === right.x
    && left.y === right.y
    && left.floor?.name === right.floor?.name
    && (left.scale || 1) === (right.scale || 1));
}

function findMapInRuneScapeClient() {
  // The Alt1 anchor is an exact-pixel 100%-scale template; on a scaled client
  // (interface scaling != 100%) it can never match, so once a calibration has
  // established a non-1 scale, go straight to the C#-style corner scan
  // (RuneScapeMapScaling.FindMap), which is scale-aware by construction.
  const calibratedScale = Number(state.calibration?.scale) || 1;
  if (calibratedScale === 1) {
    const anchored = findMapByAlt1Anchor(window.alt1, captureRegion);
    if (anchored) return anchored;
  }
  const fullClient = captureFullRuneScape();
  return findMapByScaledCorners(fullClient, captureRegion, { scales: MAP_SCALE_CANDIDATES });
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
    await waitForPixelCaptureSlot();
    const match = findMapInRuneScapeClient();
    if (!match) {
      clearCalibration();
      setStatus("Waiting for a Dungeoneering map to appear…", "warn");
    } else {
      state.calibration = calibrationWithClientDimensions(match);
      state.invalidCaptures = 0;
      state.unreadableCaptures = 0;
      state.weakFrameCaptures = 0;
      state.unusableCaptures = 0;
      recordInterfaceScale(match.scale || 1, "map");
      saveCalibration();
      found = true;
      const scaleText = match.scale && match.scale !== 1 ? ` @${Math.round(match.scale * 100)}%` : "";
      setStatus(`Calibrated by ${match.method || "corners"}: ${match.floor.name}${scaleText} at ${match.x},${match.y}`, "ok");
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
  if (state.busy || state.resultsBusy || !state.calibration || !state.autoScan) return;
  if (!tryReservePixelCaptureSlot()) return;
  state.busy = true;
  let shouldRecalibrate = false;
  try {
    assertAlt1Ready();
    if (!calibrationMatchesLinkedClient(state.calibration)) {
      shouldRecalibrate = true;
      setStatus("RuneScape client size changed — detecting the map and interface scale again", "warn");
      return;
    }
    // Re-read at the locked location, re-detecting the floor size in place the
    // way the desktop EXE does (MapForm.UpdateMap). Only fall back to a full
    // client search when the map can no longer be framed at its calibrated
    // coordinates at all. This keeps x/y/scale stable so the base room — and
    // therefore the rpm timer — does not jump on a transient read miss.
    // Fast path: re-read only the floor size we are locked onto. The size never
    // changes within a floor, so trying all three sizes every 600ms tripled the
    // per-frame capture + map-read work (the biggest steady-state cost). Fall
    // back to a full in-place size re-detect, then a client relocate, only when
    // the locked size no longer reads — e.g. on the next floor.
    const tRead0 = perfNow();
    let read = readMapAtCalibration(captureRegion, state.calibration, { floors: [state.calibration.floor] });
    if (!read) read = readMapAtCalibration(captureRegion, state.calibration);
    if (!read && Date.now() - state.lastCalibrationAttempt >= AUTO_CALIBRATION_INTERVAL) {
      // A full-client relocate is the most expensive operation in the app (a
      // full-screen capture plus a multi-scale corner search). Throttle it so a
      // stale calibration from a different account/layout cannot run it on every
      // 600ms frame and lag the whole app. The first miss after a steady lock
      // still relocates immediately (recovers fast); only rapid repeated misses
      // are throttled, and a persistent miss still escalates to recalibration.
      state.lastCalibrationAttempt = Date.now();
      const relocated = findMapInRuneScapeClient();
      if (relocated) read = readMapAtCalibration(captureRegion, relocated, { floors: [relocated.floor] });
    }
    if (!read) {
      if (!state.mapLostAt) {
        state.mapLostAt = Date.now();
        // Never leave a 30-second native overlay floating at stale coordinates
        // while the map/results/loading screen is no longer readable.
        clearGameOverlay();
      }
      state.invalidCaptures += 1;
      state.unusableCaptures += 1;
      setStatus(`Map image lost (${state.unusableCaptures}/${INVALID_CAPTURES_BEFORE_RECALIBRATION})`, "warn");
      shouldRecalibrate = state.unusableCaptures >= INVALID_CAPTURES_BEFORE_RECALIBRATION;
      return;
    }

    // A framed-but-unreadable read (0 rooms) only happens at non-100% interface
    // scaling, where blended pixels defeat even tolerant classification on this
    // frame. The map IS still located, so do not escalate toward recalibration
    // (reset invalidCaptures). We deliberately keep the last good state instead
    // of feeding a 0-room gameMap into evaluateMapTransition/state: an empty
    // frame looks like a fresh floor and would corrupt the rpm reset logic. This
    // trades C#'s show-degraded-data for holding the last good read.
    const readableRooms = read.gameMap.openedRoomCount + read.gameMap.mysteryCount;
    if (readableRooms < 1) {
      if (!state.mapLostAt) state.mapLostAt = Date.now();
      state.unreadableCaptures += 1;
      state.unusableCaptures += 1;
      clearGameOverlay();
      shouldRecalibrate = state.unusableCaptures >= UNREADABLE_CAPTURES_BEFORE_RECALIBRATION;
      setStatus(shouldRecalibrate
        ? "Map frame stayed unreadable — detecting interface scale again"
        : `Map framed but rooms unreadable (${state.unusableCaptures}/${UNREADABLE_CAPTURES_BEFORE_RECALIBRATION}) — keeping the last good RPM`, "warn");
      updateStats();
      return;
    }

    // A stale saved scale can occasionally hallucinate one readable room. Ask
    // an unverified localStorage hint for the strong top-right marker before it
    // may alter state. Once a lock has been proven live, retain the desktop
    // EXE's three-corner contract: that marker can legitimately disappear due
    // to scaled rasterisation or Desktop/overlay occlusion.
    if (!state.calibration.verified && !read.scoredMap.validCorners) {
      if (!state.mapLostAt) state.mapLostAt = Date.now();
      state.weakFrameCaptures += 1;
      state.unusableCaptures += 1;
      shouldRecalibrate = state.unusableCaptures >= UNREADABLE_CAPTURES_BEFORE_RECALIBRATION;
      setStatus(shouldRecalibrate
        ? "Map marker stayed invalid — detecting map size and interface scale again"
        : `Saved map lock is not verified (${state.unusableCaptures}/${UNREADABLE_CAPTURES_BEFORE_RECALIBRATION}) — holding the last good RPM`, "warn");
      updateStats();
      return;
    }

    const nextCalibration = calibrationWithClientDimensions({
      x: read.x,
      y: read.y,
      floor: read.floor,
      scale: read.scale,
      captureWidth: read.captureWidth,
      captureHeight: read.captureHeight,
    });
    const image = read.image;
    const scoredMap = read.scoredMap;
    const floor = read.floor;

    state.invalidCaptures = 0;
    state.unreadableCaptures = 0;
    state.weakFrameCaptures = 0;
    state.unusableCaptures = 0;
    const calibrationChanged = !sameCalibration(nextCalibration, state.calibration);
    const priorAcceptedScale = Number(state.lastAcceptedMapScale);
    const calibrationScaleChanged = Number.isFinite(priorAcceptedScale) && priorAcceptedScale > 0
      && Math.abs(Number(nextCalibration.scale || 1) - priorAcceptedScale) >= 0.025;
    const calibrationNeedsClientMetadata = !state.calibration?.rsWidth || !state.calibration?.rsHeight;
    state.calibration = nextCalibration;
    if (calibrationChanged || calibrationNeedsClientMetadata) saveCalibration();
    recordInterfaceScale(nextCalibration.scale || 1, "map");
    const gameMap = scoredMap.gameMap;
    const now = Date.now();
    const mapGapMs = state.mapLostAt ? Math.max(0, now - state.mapLostAt) : 0;
    const transition = evaluateMapTransition({
      floorStart: state.floorStart,
      lastBase: state.lastBase,
      lastRoomCount: state.lastRoomCount,
      lastFloorName: state.lastFloorName,
      lastGameMap: state.gameMap,
      scaleChanged: calibrationScaleChanged,
      mapGapMs,
      // The pure transition gate combines this results-screen lifecycle latch
      // with mapGapMs and never trusts a single returning map frame.
      awaitingNewFloor: state.awaitingNewFloor,
      resultsScreenVisible: Boolean(state.autoResultState?.visible),
      pendingReset: state.pendingFloorReset,
    }, gameMap, nextCalibration, now);
    // Gap evidence belongs to this first readable frame. A genuine gap-based
    // candidate carries its reason in pendingReset for the confirmation frame.
    state.mapLostAt = null;
    state.pendingFloorReset = transition.pendingReset;
    state.lastTransition = transition.reason;
    if (!transition.accept) {
      const pendingReason = {
        "pending-base-change": "base moved",
        "pending-floor-change": "floor size changed",
        "pending-map-gap-regression": "room count dropped after map loss",
        "pending-room-regression": "lower room count stayed visible",
        "pending-results-lifecycle": "results screen completed",
        "pending-single-base": "single base room",
      }[transition.reason] || transition.reason;
      setStatus(`Possible new floor detected (${pendingReason}); waiting for confirmation`, "warn");
      // Keep the elapsed clock / rpm ticking off the still-valid floor while the
      // new read awaits confirmation, matching the C# reference which refreshes
      // its data label every frame (the JS gate must not freeze the readout).
      updateStats();
      // Geometry is independent from accepted room progress. Re-anchor the
      // strip immediately when the map moved/rescaled, while annotations are
      // suppressed by renderGameOverlay if the semantic floor is still old.
      renderGameOverlay();
      return;
    }
    if (transition.reset) {
      resetFloor(transition.resetAt ?? now, transition.resetRoomCount ?? gameMap.openedRoomCount);
      state.awaitingNewFloor = false;
    } else if (gameMap.openedRoomCount < state.lastRoomCount) {
      // Opened rooms are monotonic within a floor. A small classifier dip is
      // display noise, not real progress and not a reason for RPM to go back.
      // Larger/new-floor regressions are handled by the transition gate above.
      state.lastTransition = "same-floor-room-regression-held";
      setStatus(`Room read dipped ${state.lastRoomCount}→${gameMap.openedRoomCount}; keeping the last good RPM`, "warn");
      updateStats();
      renderGameOverlay();
      return;
    }

    const tReadMs = perfNow() - tRead0;
    const snapshotFingerprint = mapSnapshotFingerprint(gameMap);
    if (snapshotFingerprint && snapshotFingerprint !== state.mapSnapshotFingerprint) {
      state.mapSnapshotFingerprint = snapshotFingerprint;
      state.mapSnapshotRevision += 1;
    }
    state.image = image;
    state.gameMap = gameMap;
    state.lastBase = trackedBaseAfterTransition(state.lastBase, gameMap.base, transition.reset);
    state.lastRoomCount = gameMap.openedRoomCount;
    state.lastFloorName = floor.name;
    state.lastAcceptedMapScale = nextCalibration.scale || 1;
    state.lastMapReadAt = now;
    const tDetect0 = perfNow();
    updateLocalGatestones(detectGatestones(image, gameMap));
    const tDetectMs = perfNow() - tDetect0;
    const tRender0 = perfNow();
    render();
    // Per-frame phase timings (ms) for the debug performance readout.
    state.perf = { read: tReadMs, detect: tDetectMs, render: perfNow() - tRender0 };
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

// Subtle "on pace for a 6:15 floor" signal. Toggle + target time live in Display.
const PACE_OVERLAY_COLORS = {
  ahead: overlayArgb(127, 223, 143),
  close: overlayArgb(240, 194, 74),
  behind: overlayArgb(239, 110, 90),
};

function floorPaceTargetSeconds() {
  return parseFloorTargetSeconds(elements.paceTarget?.value, DEFAULT_FLOOR_TARGET_SECONDS);
}

// The free-position X/Y controls only apply to the "Free / movable" mode.
function applyStatsFreeVisibility() {
  if (elements.statsFreeControls) {
    elements.statsFreeControls.hidden = (elements.statsPosition?.value || "bottom") !== "free";
  }
}

function clampStatsFree(value, axis) {
  const extent = axis === "x" ? Number(window.alt1?.rsWidth) : Number(window.alt1?.rsHeight);
  const limit = Number.isFinite(extent) && extent > 40 ? extent - 20 : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(limit, Math.round(Number(value) || 0)));
}

function setStatsFree(x, y) {
  state.statsFree = { x: clampStatsFree(x, "x"), y: clampStatsFree(y, "y") };
  if (elements.statsFreeX) elements.statsFreeX.value = state.statsFree.x;
  if (elements.statsFreeY) elements.statsFreeY.value = state.statsFree.y;
  storageSet(`${STORAGE_PREFIX}:stats-free`, JSON.stringify(state.statsFree));
  clearGameOverlay();
  renderGameOverlay();
}

// Alt1 delivers its events ONLY through the alt1.events[type] handler arrays
// (A1lib.on does exactly this push); it never dispatches DOM window events, so
// registering alt1pressed/permissionchanged on window silently never fires.
function onAlt1Event(type, handler) {
  if (!hasAlt1()) return;
  const api = window.alt1;
  api.events = api.events || {};
  api.events[type] = api.events[type] || [];
  api.events[type].push(handler);
}

function stopStatsPlacement(message, tone) {
  state.placingStats = false;
  if (elements.statsPlace) elements.statsPlace.textContent = "Place with Alt+1";
  if (message) setStatus(message, tone);
}

// Click-to-place: arm a mode where the next Alt+1 press drops the RPM counter at
// the cursor. Alt1 fires "alt1pressed" with mouseRs in RuneScape-client
// coordinates — the same system as the overlay — so no rsX/rsY offset is needed.
// The position mode switches to "free" only when a spot is actually placed (see
// onAlt1Pressed), so cancelling or a failed read leaves the current mode intact.
function beginStatsPlacement() {
  if (!hasAlt1()) {
    setStatus("Open the app in Alt1 to place the counter on the game screen", "warn");
    return;
  }
  if (state.placingStats) {
    stopStatsPlacement("Placement cancelled", "warn");
    return;
  }
  state.placingStats = true;
  if (elements.statsPlace) elements.statsPlace.textContent = "Cancel (waiting for Alt+1)";
  setStatus("Point the cursor where you want the RPM counter on RuneScape, then press Alt+1", "warn");
}

function onAlt1Pressed(event) {
  if (!state.placingStats) return;
  // Only trust mouseRs: it is guaranteed RuneScape-client coordinates. The
  // event's top-level x/y may be screen coordinates and would misplace the strip.
  const rs = event?.mouseRs || event?.detail?.mouseRs || null;
  if (!rs || !Number.isFinite(rs.x) || !Number.isFinite(rs.y)) {
    stopStatsPlacement("Could not read the cursor position — use the X/Y controls instead", "warn");
    return;
  }
  // Switch to free/movable mode only now that a spot is actually being placed.
  if (elements.statsPosition && elements.statsPosition.value !== "free") {
    elements.statsPosition.value = "free";
    storageSet(`${STORAGE_PREFIX}:stats-position`, "free");
    applyStatsFreeVisibility();
  }
  setStatsFree(rs.x, rs.y);
  stopStatsPlacement(`RPM counter placed at ${state.statsFree.x}, ${state.statsFree.y}`, "ok");
}

// Pace projection is dg-map's elapsed / completion-of-known-rooms: doors drawn
// toward still-empty cells (unexploredRoomCount) join opened + mystery in the
// denominator so early floors project a realistic finish instead of tracking
// elapsed time. The visible "(possible)" stats number stays opened + mystery.
function currentFloorPace() {
  if (!elements.paceIndicator?.checked || !state.gameMap) return { status: "none" };
  return floorPaceStatus({
    openedRooms: state.gameMap.openedRoomCount,
    possibleRooms: state.gameMap.openedRoomCount + state.gameMap.mysteryCount + (state.gameMap.unexploredRoomCount || 0),
    minutes: elapsedFloorMinutes(state.floorStart),
    targetSeconds: floorPaceTargetSeconds(),
  });
}

// Predicted floor finish time (dg-map style) from the current pace projection.
// Zero when the pace toggle is off or there is not enough data (status "none").
// Coarse rounding to the nearest 5s keeps the native overlay from redrawing
// every frame as the projection drifts.
function predictedFloorSeconds(pace = currentFloorPace()) {
  if (!pace || pace.status === "none") return 0;
  return Math.round((Number(pace.projectedSeconds) || 0) / 5) * 5;
}

function updateStats() {
  if (!state.gameMap) {
    elements.stats.textContent = "No map read yet";
    return;
  }
  const rooms = state.gameMap.openedRoomCount;
  const possible = rooms + state.gameMap.mysteryCount;
  const now = Date.now();
  const minutes = elapsedFloorMinutes(state.floorStart, now);
  const rpm = rpmValue(rooms, minutes);
  const elapsed = formatElapsedClock(elapsedFloorSeconds(state.floorStart, now));
  // Tint just the rpm token by floor pace (all interpolated values are
  // app-generated numbers, so this markup is injection-safe).
  const pace = currentFloorPace();
  const paceClass = { ahead: "pace-ahead", close: "pace-close", behind: "pace-behind" }[pace.status] || "";
  const rpmMarkup = paceClass ? `<span class="${paceClass}">${rpm} rpm</span>` : `${rpm} rpm`;
  let html = `${rooms} rooms (${possible}) · ${rpmMarkup} · ${state.gameMap.deadEndCount} dead ends · ${elapsed}`;
  // Predicted floor finish time (plain text, no tint), same ~M:SS token as the
  // native overlay; absent when the pace toggle is off or there is not enough data.
  const predicted = predictedFloorSeconds(pace);
  if (predicted > 0) html += ` | ~${formatElapsedClock(predicted).replace(/^0(?=\d:)/, "")}`;
  // Verbose diagnostics surface the per-frame map-loop cost so a slow machine or
  // an old Alt1 capture path can be told apart from a heavy app loop.
  if (elements.debugMode?.checked && state.perf) {
    const p = state.perf;
    const total = p.read + p.detect + p.render;
    // The transition reason makes a stuck/missed floor reset diagnosable live.
    if (state.lastTransition) html += ` · ${state.lastTransition}`;
    html += ` · ⏱ ${total.toFixed(0)}ms (read ${p.read.toFixed(0)} · det ${p.detect.toFixed(0)} · draw ${p.render.toFixed(0)})`;
  }
  elements.stats.innerHTML = html;
}

function currentOverlayStats() {
  if (!state.gameMap) return "";
  const minutes = elapsedFloorMinutes(state.floorStart);
  return formatMapStats({
    rooms: state.gameMap.openedRoomCount,
    mystery: state.gameMap.mysteryCount,
    deadEnds: state.gameMap.deadEndCount,
    minutes,
    predictedSeconds: predictedFloorSeconds(),
  });
}

function render() {
  const { image, gameMap } = state;
  elements.mapShell.hidden = elements.rpmOnly.checked;
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
  // The native overlay is gone after this, so the redraw gate's memo must be
  // reset too — otherwise a follow-up render with byte-identical commands is
  // skipped and the strip stays invisible for up to OVERLAY_REFRESH_INTERVAL.
  state.lastOverlaySignature = "";
  state.lastOverlayDraw = 0;
  if (hasAlt1() && typeof window.alt1.overLayClearGroup === "function") {
    for (const group of ["dungeons-alt1", "dungeons-alt1-test", PARTY_DEBUG_GROUP]) {
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

// Re-issue the native overlay only when its content changed (or before it
// expires). Native overlay commands are relatively costly on older Alt1/CEF, and
// the overlay lasts OVERLAY_DURATION, so redrawing identical content every 600ms
// frame was pure churn on the game screen.
function drawGameOverlayGated(api, group, commands) {
  const signature = JSON.stringify(commands);
  const now = Date.now();
  if (signature === state.lastOverlaySignature && now - state.lastOverlayDraw < OVERLAY_REFRESH_INTERVAL) return;
  state.lastOverlaySignature = signature;
  state.lastOverlayDraw = now;
  state.lastOverlayReport = drawOverlayGroup(api, group, commands);
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
  if (api.compatEnabled) {
    drawGameOverlayGated(api, group, []);
    updateOverlayStatus("Desktop capture active — native game overlay disabled to keep map/results pixels clean");
    return;
  }
  if (!elements.gameOverlay.checked || !state.calibration || !state.gameMap || api.permissionOverlay === false) {
    drawGameOverlayGated(api, group, []);
    updateOverlayStatus();
    return;
  }

  // Pixel capture and native overlays both use RuneScape-client coordinates.
  // Screen coordinates such as alt1.rsX/rsY must never be added here.
  const overlayFloor = state.calibration.floor;
  const mapContentMatchesGeometry = state.gameMap.floor?.name === overlayFloor?.name;
  const hideMapDetails = elements.rpmOnly.checked
    || !mapContentMatchesGeometry
    || Boolean(state.pendingFloorReset)
    || state.awaitingNewFloor
    || Boolean(state.autoResultState?.visible);
  const commands = buildMapOverlayCommands({
    mapX: state.calibration.x,
    mapY: state.calibration.y,
    floor: overlayFloor,
    overlayScale: state.calibration.scale || 1,
    annotations: hideMapDetails ? [] : [...state.annotations].map(([pointKey, annotation]) => ({
      point: pointFromKey(pointKey),
      text: annotation.text,
      color: ownerColor(annotation.ownerId, annotation.slot, null),
    })),
    manualCritical: hideMapDetails ? [] : [...state.manualCritical].map(pointFromKey),
    gatestones: hideMapDetails ? [] : collectGatestoneMarkers(overlayFloor),
    stats: currentOverlayStats(),
    statsPosition: elements.statsPosition?.value || "bottom",
    statsColor: PACE_OVERLAY_COLORS[currentFloorPace().status] || undefined,
    // The overlay module derives every physical size from the detected map
    // scale. There is no second manual UI-scale knob to drift out of sync.
    statsScale: 1,
    statsScreen: { width: api.rsWidth, height: api.rsHeight },
    statsAvoidMapOverlap: false,
    statsFree: state.statsFree,
    duration: OVERLAY_DURATION,
  });
  drawGameOverlayGated(api, group, commands);
  updateOverlayStatus();
}

function testGameOverlay() {
  updateOverlayStatus();
  if (!hasAlt1()) return;
  const api = window.alt1;
  if (api.compatEnabled) {
    updateOverlayStatus("Test disabled in Desktop capture — switch Alt1 to DirectX/OpenGL first");
    return;
  }
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
  const width = Math.round(state.calibration?.captureWidth ?? state.calibration?.floor.imageWidth ?? 280);
  const height = Math.round(state.calibration?.captureHeight ?? state.calibration?.floor.imageHeight ?? 100);
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

function captureArchiveKind(record) {
  if (record?.kind === "map" || record?.kind === "results") return record.kind;
  return String(record?.filename || "").startsWith("dungeon-map-") ? "map" : "results";
}

let captureArchiveSequence = 0;

function createCaptureArchiveId(kind) {
  captureArchiveSequence = (captureArchiveSequence + 1) % Number.MAX_SAFE_INTEGER;
  const random = typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${Date.now().toString(36)}-${captureArchiveSequence.toString(36)}-${random}`;
}

function captureArchiveRecordKey(record) {
  if (record?.id) return String(record.id);
  return `${captureArchiveKind(record)}\n${String(record?.filename || "")}\n${Math.max(0, Number(record?.createdAt) || 0)}`;
}

function pendingCaptureArchiveRecords() {
  const records = new Map();
  for (const [kind, pending, inFlight] of [
    ["map", state.pendingMapPngs, state.inFlightMapPngs],
    ["results", state.pendingResultsPngs, state.inFlightResultsPngs],
  ]) {
    for (const item of [...inFlight, ...pending]) {
      if (!item?.filename || !item?.dataUrl) continue;
      records.set(item.id || `${kind}\n${item.filename}`, {
        id: item.id,
        kind,
        filename: item.filename,
        dataUrl: item.dataUrl,
        createdAt: Math.max(0, Number(item.createdAt) || Date.now()),
        persisted: item.persisted === true,
      });
    }
  }
  return [...records.values()].sort((left, right) => left.createdAt - right.createdAt
    || left.filename.localeCompare(right.filename));
}

function ensureCaptureArchiveControls() {
  if (elements.downloadCaptureArchive && elements.clearCaptureArchive && elements.captureArchiveStatus) return;
  const resultsTools = elements.resultsSaveFolderStatus?.parentElement;
  const container = resultsTools?.parentElement;
  if (!container) return;
  let tools = container.querySelector?.(".capture-archive-tools");
  if (!tools) {
    tools = document.createElement("div");
    tools.className = "save-folder-tools capture-archive-tools";
    const next = resultsTools.nextSibling;
    if (next) container.insertBefore(tools, next);
    else container.appendChild(tools);
  }
  const ensureButton = (id, label) => {
    let button = tools.querySelector?.(`#${id}`);
    if (button) return button;
    button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.disabled = true;
    button.textContent = label;
    tools.appendChild(button);
    return button;
  };
  elements.downloadCaptureArchive = ensureButton("download-capture-archive", "Download stored captures (.zip)");
  elements.clearCaptureArchive = ensureButton("clear-capture-archive", "Clear stored captures");
  if (!elements.captureArchiveStatus) {
    const status = document.createElement("small");
    status.id = "capture-archive-status";
    status.textContent = "Loading the internal capture archive...";
    tools.appendChild(status);
    elements.captureArchiveStatus = status;
  }
}

function updateCaptureArchiveStatus() {
  if (!elements.captureArchiveStatus) return;
  const records = pendingCaptureArchiveRecords();
  const mapCount = records.filter((record) => record.kind === "map").length;
  const resultsCount = records.length - mapCount;
  const total = mapCount + resultsCount;
  const busy = state.captureArchive.exportBusy || state.captureArchive.clearBusy;
  if (elements.downloadCaptureArchive) elements.downloadCaptureArchive.disabled = busy || total === 0;
  if (elements.clearCaptureArchive) {
    elements.clearCaptureArchive.disabled = busy || state.retryingMapPngs || state.retryingResultsPngs || total === 0;
  }
  if (state.captureArchive.exportBusy) {
    elements.captureArchiveStatus.textContent = `Building ZIP for ${total} stored capture${total === 1 ? "" : "s"}...`;
    return;
  }
  if (state.captureArchive.clearBusy) {
    elements.captureArchiveStatus.textContent = "Updating the stored capture archive...";
    return;
  }
  if (!total) {
    elements.captureArchiveStatus.textContent = state.captureArchive.loaded
      ? "No captures stored in the app"
      : "Loading the internal capture archive...";
    return;
  }
  const parts = [];
  if (mapCount) parts.push(`${mapCount} map PNG${mapCount === 1 ? "" : "s"}`);
  if (resultsCount) parts.push(`${resultsCount} results PNG${resultsCount === 1 ? "" : "s"}`);
  const durability = state.captureArchive.supported
    ? (state.captureArchive.persistent === true ? "stored persistently in Alt1" : "stored in Alt1 app data")
    : "kept for this Alt1 session";
  const exported = state.captureArchive.lastExportCount
    ? ` · last ZIP contained ${state.captureArchive.lastExportCount}`
    : "";
  elements.captureArchiveStatus.textContent = `${parts.join(" + ")} ${durability}${exported}`;
}

function persistPendingCaptureArchive() {
  // Startup restoration owns the first database read. Do not let a capture that
  // arrives during that read replace the old archive with only the new item;
  // restorePendingCaptureArchive merges both sides and persists that snapshot.
  if (!state.captureArchive.loaded || !state.captureArchive.readSucceeded
    || state.captureArchive.clearBusy) {
    updateCaptureArchiveStatus();
    return state.captureArchive.persistChain;
  }
  const snapshot = pendingCaptureArchiveRecords().filter((record) => record.id && !record.persisted);
  if (!snapshot.length) return state.captureArchive.persistChain;
  const snapshotIds = new Set(snapshot.map((record) => record.id));
  state.captureArchive.persistChain = state.captureArchive.persistChain
    .catch(() => false)
    .then(async () => {
      const stored = await upsertCaptureArchive(snapshot, window);
      state.captureArchive.supported = stored !== false;
      if (stored) {
        for (const records of [
          state.pendingMapPngs,
          state.pendingResultsPngs,
          state.inFlightMapPngs,
          state.inFlightResultsPngs,
        ]) {
          for (const record of records) {
            if (snapshotIds.has(record.id)) record.persisted = true;
          }
        }
      }
      return stored;
    })
    .catch(() => {
      state.captureArchive.supported = false;
      return false;
    })
    .finally(updateCaptureArchiveStatus);
  return state.captureArchive.persistChain;
}

function deletePersistedCaptureRecords(records) {
  const ids = [...new Set((Array.isArray(records) ? records : [])
    .map((record) => record?.id)
    .filter(Boolean))];
  if (!ids.length || !state.captureArchive.readSucceeded) return Promise.resolve(true);
  state.captureArchive.persistChain = state.captureArchive.persistChain
    .catch(() => false)
    .then(async () => {
      const deleted = await deleteCaptureArchiveRecords(ids, window);
      state.captureArchive.supported = deleted !== false;
      return deleted;
    })
    .catch(() => {
      state.captureArchive.supported = false;
      return false;
    })
    .finally(updateCaptureArchiveStatus);
  return state.captureArchive.persistChain;
}

function mergeRestoredCaptureRecords(current, restored, kind) {
  const merged = new Map();
  const add = (item, persisted) => {
    if (!item?.filename || !item?.dataUrl || captureArchiveKind(item) !== kind) return;
    const id = item.id || createCaptureArchiveId(kind);
    const previous = merged.get(id);
    merged.set(id, {
      id,
      kind,
      filename: item.filename,
      dataUrl: item.dataUrl,
      createdAt: Math.max(0, Number(item.createdAt) || Number(previous?.createdAt) || Date.now()),
      persisted,
    });
  };
  for (const item of restored) add(item, true);
  for (const item of current) add(item, item.persisted === true);
  return [...merged.values()].sort((left, right) => left.createdAt - right.createdAt);
}

function enforceCaptureArchiveItemLimit() {
  const combined = [
    ...state.pendingMapPngs.map((record) => ({ kind: "map", record })),
    ...state.pendingResultsPngs.map((record) => ({ kind: "results", record })),
  ].sort((left, right) => left.record.createdAt - right.record.createdAt
    || String(left.record.id).localeCompare(String(right.record.id)));
  const overflow = Math.max(0, combined.length - MAX_CAPTURE_ARCHIVE_ITEMS);
  if (!overflow) return Promise.resolve(true);
  const dropped = combined.slice(0, overflow);
  const droppedIds = new Set(dropped.map(({ record }) => record.id));
  state.pendingMapPngs = state.pendingMapPngs.filter((record) => !droppedIds.has(record.id));
  state.pendingResultsPngs = state.pendingResultsPngs.filter((record) => !droppedIds.has(record.id));
  state.droppedMapPngs += dropped.filter(({ kind }) => kind === "map").length;
  state.droppedResultsPngs += dropped.filter(({ kind }) => kind === "results").length;
  return deletePersistedCaptureRecords(dropped.map(({ record }) => record));
}

async function restorePendingCaptureArchive() {
  state.captureArchive.readSucceeded = false;
  try {
    const [records, persistent] = await Promise.all([
      loadCaptureArchive(window),
      requestPersistentCaptureStorage(window),
    ]);
    if (!Array.isArray(records)) throw new Error("Capture archive could not be read safely");
    state.captureArchive.readSucceeded = true;
    state.captureArchive.supported = Boolean(window.indexedDB)
      && typeof window.indexedDB.open === "function";
    state.captureArchive.persistent = persistent;
    state.pendingMapPngs = mergeRestoredCaptureRecords(state.pendingMapPngs, records, "map");
    state.pendingResultsPngs = mergeRestoredCaptureRecords(state.pendingResultsPngs, records, "results");
    await enforceCaptureArchiveItemLimit();
  } catch {
    state.captureArchive.supported = false;
  } finally {
    state.captureArchive.loaded = true;
    updateAllSaveFolderStatuses();
    updateCaptureArchiveStatus();
  }
  if (state.captureArchive.readSucceeded) await persistPendingCaptureArchive();
  if (!state.saveFolders.hostWriteUnsupported) {
    if (state.pendingMapPngs.length && ["granted", "unknown"].includes(saveFolderState("map").permission)) {
      await retryPendingMapPngs({ quiet: true });
    }
    if (state.pendingResultsPngs.length && ["granted", "unknown"].includes(saveFolderState("results").permission)) {
      await retryPendingResultsPngs({ quiet: true });
    }
  }
}

async function downloadPendingCaptureArchive() {
  const records = pendingCaptureArchiveRecords();
  if (!records.length || state.captureArchive.exportBusy) return;
  state.captureArchive.exportBusy = true;
  updateCaptureArchiveStatus();
  try {
    const zip = await buildCaptureZip(records);
    const filename = `dungeons-captures-${safeTimestampForFilename(new Date())}.zip`;
    if (!triggerBlobDownload(zip, filename, window)) {
      throw new Error("Alt1 could not open the ZIP Save As dialog");
    }
    const exportedCount = Math.max(0, Number(zip.captureCount) || 0);
    const skippedCount = Math.max(0, Number(zip.skippedCaptureCount) || 0);
    state.captureArchive.lastExportCount = exportedCount;
    state.captureArchive.lastExportHadErrors = skippedCount > 0 || exportedCount !== records.length;
    state.captureArchive.lastExportKeys = state.captureArchive.lastExportHadErrors
      ? new Set()
      : new Set(records.map(captureArchiveRecordKey));
    setStatus(state.captureArchive.lastExportHadErrors
      ? `ZIP contains ${exportedCount} valid capture${exportedCount === 1 ? "" : "s"}; ${skippedCount} damaged capture${skippedCount === 1 ? " was" : "s were"} kept in the app`
      : `ZIP download opened for ${exportedCount} stored capture${exportedCount === 1 ? "" : "s"}; clear them only after verifying the ZIP`,
    state.captureArchive.lastExportHadErrors ? "warn" : "ok");
  } catch (error) {
    setStatus(`Could not build capture ZIP: ${error.message || error}`, "error");
  } finally {
    state.captureArchive.exportBusy = false;
    updateCaptureArchiveStatus();
  }
}

async function clearPendingCaptureArchive() {
  if (state.captureArchive.exportBusy || state.captureArchive.clearBusy
    || state.retryingMapPngs || state.retryingResultsPngs) return;
  const records = pendingCaptureArchiveRecords();
  const total = records.length;
  if (!total) return;
  const exportedKeys = state.captureArchive.lastExportKeys;
  const hasCompleteExport = exportedKeys.size > 0 && !state.captureArchive.lastExportHadErrors;
  const clearCount = hasCompleteExport
    ? records.filter((record) => exportedKeys.has(captureArchiveRecordKey(record))).length
    : total;
  const retainedCount = total - clearCount;
  if (!clearCount) {
    setStatus("Nothing from the last ZIP remains to clear; newer captures were kept", "warn");
    return;
  }
  const question = hasCompleteExport
    ? `Clear ${clearCount} capture${clearCount === 1 ? "" : "s"} included in the last ZIP?${retainedCount ? ` ${retainedCount} newer capture${retainedCount === 1 ? " will" : "s will"} be kept.` : ""}`
    : `Clear ${clearCount} stored capture${clearCount === 1 ? "" : "s"}? There is no complete ZIP snapshot to verify.`;
  if (!window.confirm(question)) return;

  const previousMap = state.pendingMapPngs;
  const previousResults = state.pendingResultsPngs;
  const shouldKeep = (item) => hasCompleteExport && !exportedKeys.has(captureArchiveRecordKey(item));
  state.pendingMapPngs = previousMap.filter(shouldKeep);
  state.pendingResultsPngs = previousResults.filter(shouldKeep);
  const retainedIds = new Set([...state.pendingMapPngs, ...state.pendingResultsPngs].map((item) => item.id));
  const clearedRecords = [...previousMap, ...previousResults].filter((item) => !retainedIds.has(item.id));
  state.captureArchive.clearBusy = true;
  updateAllSaveFolderStatuses();
  updateCaptureArchiveStatus();
  const deleted = await deletePersistedCaptureRecords(clearedRecords);
  if (!deleted) {
    const uncertainMap = clearedRecords
      .filter((record) => captureArchiveKind(record) === "map")
      .map((record) => ({ ...record, persisted: false }));
    const uncertainResults = clearedRecords
      .filter((record) => captureArchiveKind(record) === "results")
      .map((record) => ({ ...record, persisted: false }));
    state.pendingMapPngs = mergeRestoredCaptureRecords(
      [...state.pendingMapPngs, ...uncertainMap], [], "map",
    );
    state.pendingResultsPngs = mergeRestoredCaptureRecords(
      [...state.pendingResultsPngs, ...uncertainResults], [], "results",
    );
  } else {
    if (!state.pendingMapPngs.length) state.droppedMapPngs = 0;
    if (!state.pendingResultsPngs.length) state.droppedResultsPngs = 0;
    state.captureArchive.lastExportCount = 0;
    state.captureArchive.lastExportKeys = new Set();
    state.captureArchive.lastExportHadErrors = false;
  }
  state.captureArchive.clearBusy = false;
  await persistPendingCaptureArchive();
  updateAllSaveFolderStatuses();
  updateCaptureArchiveStatus();
  setStatus(deleted
    ? `Cleared ${clearCount} stored capture${clearCount === 1 ? "" : "s"}${retainedCount ? `; kept ${retainedCount} newer` : ""}`
    : "Could not clear the durable capture archive; all captures were restored in the app", deleted ? "warn" : "error");
}

function markFolderWritesHostUnsupported(error, operation = "write", kind = "map") {
  if (!hasAlt1()) return false;
  if (!knownAlt1FolderWritesUnsupported(window)) return false;
  const firstFailure = !state.saveFolders.hostWriteUnsupported;
  state.saveFolders.hostWriteUnsupported = true;
  state.saveFolders.lastHostFailure = {
    kind,
    operation,
    name: String(error?.name || "NotAllowedError").slice(0, 80),
    message: String(error?.message || "Alt1 denied external folder writing").slice(0, 240),
  };
  for (const kind of ["map", "results"]) {
    const folder = saveFolderState(kind);
    folder.handle = null;
    folder.permission = "unsupported";
    folder.loading = false;
    folder.writeVerified = false;
    folder.lastFailure = state.saveFolders.lastHostFailure;
  }
  if (firstFailure) {
    Promise.allSettled([
      clearStoredSaveFolder(window, saveFolderTarget("map").key),
      clearStoredSaveFolder(window, saveFolderTarget("results").key),
    ]).catch(() => {});
  }
  updateAllSaveFolderStatuses();
  updateCaptureArchiveStatus();
  return true;
}

const SAVE_FOLDER_TARGETS = Object.freeze({
  map: Object.freeze({
    key: "map-folder",
    label: "map",
    choose: "chooseMapSaveFolder",
    clear: "clearMapSaveFolder",
    reallow: "reallowMapSaveFolder",
    status: "mapSaveFolderStatus",
  }),
  results: Object.freeze({
    key: "results-folder",
    label: "results",
    choose: "chooseResultsSaveFolder",
    clear: "clearResultsSaveFolder",
    reallow: "reallowResultsSaveFolder",
    status: "resultsSaveFolderStatus",
  }),
});

function saveFolderTarget(kind) {
  return SAVE_FOLDER_TARGETS[kind] || SAVE_FOLDER_TARGETS.map;
}

function saveFolderState(kind) {
  return state.saveFolders[kind] || state.saveFolders.map;
}

function canRequestSaveFolderPermission(folder) {
  // Alt1 1.6 uses CefSharp's Alloy browser without a host PermissionHandler.
  // Its requestPermission promise can therefore remain unresolved forever.
  // Re-picking the directory is both supported and already requests readwrite.
  return !hasAlt1() && typeof folder?.handle?.requestPermission === "function";
}

function updateSaveFolderStatus(kind) {
  const target = saveFolderTarget(kind);
  const folder = saveFolderState(kind);
  const pendingCount = kind === "results" ? state.pendingResultsPngs.length : state.pendingMapPngs.length;
  const pendingText = pendingCount
    ? state.saveFolders.hostWriteUnsupported
      ? ` · ${pendingCount} ${target.label} PNG${pendingCount === 1 ? "" : "s"} stored in the capture archive`
      : ` · ${pendingCount} ${target.label} PNG${pendingCount === 1 ? "" : "s"} waiting to retry`
    : "";
  const dropped = kind === "results" ? state.droppedResultsPngs : state.droppedMapPngs;
  const droppedText = dropped
    ? ` · ${dropped} older PNG${dropped === 1 ? "" : "s"} could not be retained`
    : "";
  elements[target.choose].disabled = folder.loading || !state.saveFolders.supported
    || state.saveFolders.hostWriteUnsupported;
  elements[target.clear].disabled = folder.loading || !folder.handle;
  // Offer the one-click re-grant only when the embedded browser exposes that
  // operation. Some Alt1 builds can write a picker handle but cannot inspect or
  // separately request its permission state.
  elements[target.reallow].hidden = state.saveFolders.hostWriteUnsupported
    || !(!folder.loading && state.saveFolders.supported
    && folder.handle && folder.permission !== "granted"
    && canRequestSaveFolderPermission(folder));
  if (folder.loading) {
    elements[target.status].textContent = `Checking ${target.label} save folder...${pendingText}${droppedText}`;
    return;
  }
  if (state.saveFolders.hostWriteUnsupported) {
    const version = String(window.alt1?.version || "1.6");
    elements[target.status].textContent = `Alt1 ${version} cannot write external folders; ${target.label} PNGs are kept in the app — use Download stored captures (.zip)${pendingText}${droppedText}`;
    return;
  }
  if (!state.saveFolders.supported) {
    elements[target.status].textContent = `External folder saving is not supported here; ${target.label} PNGs are stored in the capture archive${pendingText}${droppedText}`;
    return;
  }
  if (folder.handle && folder.permission === "granted") {
    elements[target.status].textContent = folder.writeVerified
      ? `Saving ${target.label} PNGs to: ${folder.name || "selected folder"}${pendingText}${droppedText}`
      : `${target.label} folder selected: ${folder.name || "selected folder"} · the next PNG will verify write access${pendingText}${droppedText}`;
    return;
  }
  if (folder.handle && folder.permission === "unknown") {
    elements[target.status].textContent = `${target.label} folder selected: ${folder.name || "selected folder"} · write access will be verified on the next PNG${pendingText}${droppedText}`;
    return;
  }
  if (folder.handle) {
    const action = canRequestSaveFolderPermission(folder)
      ? "click Re-allow folder"
      : "choose the folder again";
    elements[target.status].textContent = `${target.label} folder access ${folder.permission === "denied" ? "blocked" : "needs confirmation"} — ${action}${pendingText}${droppedText}`;
    return;
  }
  elements[target.status].textContent = `Choose a ${target.label} folder before ${target.label} PNG auto-save${pendingText}${droppedText}`;
}

function updateAllSaveFolderStatuses() {
  updateSaveFolderStatus("map");
  updateSaveFolderStatus("results");
}

async function refreshStoredSaveFolder(kind) {
  const target = saveFolderTarget(kind);
  const folder = saveFolderState(kind);
  folder.loading = true;
  state.saveFolders.supported = supportsFolderSaving(window);
  updateSaveFolderStatus(kind);
  if (state.saveFolders.hostWriteUnsupported) {
    folder.handle = null;
    folder.name = "";
    folder.permission = "unsupported";
    folder.source = "none";
    folder.writeVerified = false;
    folder.loading = false;
    clearStoredSaveFolder(window, target.key).catch(() => false);
    updateSaveFolderStatus(kind);
    return;
  }
  if (!state.saveFolders.supported) {
    folder.loading = false;
    updateSaveFolderStatus(kind);
    return;
  }
  try {
    const handle = await loadStoredSaveFolder(window, target.key);
    folder.handle = handle;
    folder.name = handle?.name || "";
    folder.permission = handle ? await querySaveFolderPermission(handle) : "unknown";
    folder.source = handle ? "restored" : "none";
    folder.writeVerified = false;
    folder.lastFailure = null;
  } catch {
    folder.handle = null;
    folder.name = "";
    folder.permission = "unknown";
    folder.source = "none";
    folder.writeVerified = false;
  } finally {
    folder.loading = false;
    updateSaveFolderStatus(kind);
  }
  if (folder.permission === "granted" || folder.permission === "unknown") {
    if (kind === "results") await retryPendingResultsPngs();
    else await retryPendingMapPngs();
  }
}

function refreshStoredSaveFolders() {
  state.saveFolders.supported = supportsFolderSaving(window);
  state.saveFolders.hostWriteUnsupported ||= knownAlt1FolderWritesUnsupported(window);
  refreshStoredSaveFolder("map");
  refreshStoredSaveFolder("results");
}

async function selectSaveFolder(kind) {
  const target = saveFolderTarget(kind);
  const folder = saveFolderState(kind);
  if (folder.loading) return;
  if (state.saveFolders.hostWriteUnsupported) {
    setStatus("This Alt1 version cannot write external folders; use Download stored captures (.zip)", "warn");
    updateSaveFolderStatus(kind);
    return;
  }
  if (!state.saveFolders.supported) {
    setStatus("External folder saving is unavailable; captures remain in the internal archive", "warn");
    updateSaveFolderStatus(kind);
    return;
  }
  let selected = false;
  folder.loading = true;
  updateSaveFolderStatus(kind);
  try {
    const handle = await chooseSaveFolder(window, target.key);
    folder.handle = handle;
    folder.name = handle.name || "";
    // showDirectoryPicker({mode:"readwrite"}) only resolves after the fresh
    // grant succeeds. Trust that grant even if Alt1 lacks queryPermission.
    folder.permission = "granted";
    folder.source = "picker";
    folder.writeVerified = false;
    folder.lastFailure = null;
    selected = true;
  } catch (error) {
    const cancelled = error?.name === "AbortError";
    setStatus(cancelled ? `${target.label} save folder unchanged` : `Could not choose ${target.label} folder: ${error.message || error}`, cancelled ? "warn" : "error");
  } finally {
    folder.loading = false;
    updateSaveFolderStatus(kind);
  }
  if (selected && folder.permission === "granted") {
    if (kind === "results") await retryPendingResultsPngs();
    else await retryPendingMapPngs();
    if (state.saveFolders.hostWriteUnsupported) {
      setStatus("Alt1 blocked the real folder write; the PNG is in the internal archive — use Download stored captures (.zip)", "warn");
    } else if (folder.writeVerified) {
      setStatus(`${target.label} save folder verified: ${folder.name || "selected folder"}`, "ok");
    } else {
      setStatus(`${target.label} save folder selected; the first PNG will verify write access`, "ok");
    }
    updateSaveFolderStatus(kind);
  }
}

async function clearSelectedSaveFolder(kind) {
  const target = saveFolderTarget(kind);
  const folder = saveFolderState(kind);
  if (folder.loading || !folder.handle) return;
  const handle = folder.handle;
  folder.loading = true;
  updateSaveFolderStatus(kind);
  try {
    await clearStoredSaveFolder(window, target.key);
    if (folder.handle !== handle) return;
    folder.handle = null;
    folder.name = "";
    folder.permission = "unknown";
    folder.source = "none";
    folder.writeVerified = false;
    folder.lastFailure = null;
    setStatus(`${target.label} save folder cleared`, "warn");
  } finally {
    folder.loading = false;
    updateSaveFolderStatus(kind);
  }
}

async function reallowSaveFolder(kind) {
  const target = saveFolderTarget(kind);
  const folder = saveFolderState(kind);
  if (folder.loading || !folder.handle) return;
  if (state.saveFolders.hostWriteUnsupported) {
    setStatus("This Alt1 version cannot request external folder writes; use Download stored captures (.zip)", "warn");
    updateSaveFolderStatus(kind);
    return;
  }
  if (!canRequestSaveFolderPermission(folder)) {
    setStatus(`Choose the ${target.label} folder again to restore Alt1 write access`, "warn");
    updateSaveFolderStatus(kind);
    return;
  }
  const handle = folder.handle;
  folder.loading = true;
  updateSaveFolderStatus(kind);
  // The auto-save loop runs outside a user gesture and may not prompt; this
  // click is the gesture that restores the persisted grant.
  const permission = await requestSaveFolderPermission(handle);
  if (folder.handle !== handle) {
    folder.loading = false;
    updateSaveFolderStatus(kind);
    return;
  }
  folder.permission = permission;
  if (permission === "granted") folder.writeVerified = false;
  folder.loading = false;
  updateSaveFolderStatus(kind);
  const label = target.label.charAt(0).toUpperCase() + target.label.slice(1);
  if (folder.permission === "granted") {
    setStatus(`${label} folder re-allowed — PNG auto-save active`, "ok");
    if (kind === "results") await retryPendingResultsPngs();
    else await retryPendingMapPngs();
  } else {
    setStatus(folder.permission === "unknown"
      ? `${label} folder permission cannot be inspected in this Alt1 version; the next PNG write will verify it`
      : `${label} folder access still blocked — pick the folder again`, "warn");
  }
}

async function writePngToSaveFolder(kind, filename, dataUrl, label, options = {}) {
  const target = saveFolderTarget(kind);
  const folder = saveFolderState(kind);
  const quiet = Boolean(options?.quiet);
  if (state.saveFolders.hostWriteUnsupported) {
    if (!quiet) setStatus(`${label} stored in the app — use Download stored captures (.zip)`, "warn");
    updateSaveFolderStatus(kind);
    return { saved: false, reason: "host-unsupported" };
  }
  if (!state.saveFolders.supported) {
    if (!quiet) setStatus(`${label} stored in the app because external folder saving is unavailable`, "warn");
    return { saved: false, reason: "unsupported" };
  }
  const handle = folder.handle;
  if (!handle) {
    if (!quiet) setStatus(`Choose a ${target.label} folder before saving ${label}`, "warn");
    updateSaveFolderStatus(kind);
    return { saved: false, reason: "no-folder" };
  }
  // A freshly picked handle is already granted by showDirectoryPicker. Do not
  // downgrade it through an unsupported/broken queryPermission implementation;
  // a failed real write below will revoke this optimistic state safely.
  let permission = folder.permission === "granted"
    ? "granted"
    : await querySaveFolderPermission(handle);
  // The File System Access grant does not survive a reload, so a restored handle
  // reads back as "prompt". A manual save is a user gesture, so we can re-request
  // the grant in place instead of forcing the user to pick the folder again.
  // (The quiet auto-save path cannot prompt — it runs outside a user gesture.)
  if (permission === "prompt" && !quiet && canRequestSaveFolderPermission(folder)) {
    permission = await requestSaveFolderPermission(handle);
  }
  if (folder.handle !== handle) return { saved: false, reason: "handle-changed" };
  folder.permission = permission;
  updateSaveFolderStatus(kind);
  if (permission === "prompt" || permission === "denied") {
    if (!quiet) setStatus(`${target.label} folder permission needed; choose the folder again`, "warn");
    return { saved: false, reason: "permission" };
  }
  try {
    // Keep using the permission-checked handle even if another UI event changes
    // the selected folder while this asynchronous write is in progress.
    await writeDataUrlToFolder(handle, filename, dataUrl);
    if (folder.handle === handle) {
      folder.permission = "granted";
      folder.writeVerified = true;
      folder.lastFailure = null;
      updateSaveFolderStatus(kind);
    }
    if (!quiet) setStatus(`${label} saved to ${folder.name || "selected folder"}`, "ok");
    return { saved: true, filename };
  } catch (error) {
    const permissionError = isSaveFolderPermissionError(error);
    if (folder.handle === handle && permissionError) {
      folder.lastFailure = {
        operation: "write",
        name: String(error?.name || "Error").slice(0, 80),
        message: String(error?.message || error).slice(0, 240),
      };
      if (markFolderWritesHostUnsupported(error, "write", kind)) {
        if (!quiet) setStatus(`${label} stored in the app because Alt1 blocked external folder writing — use Download stored captures (.zip)`, "warn");
        return {
          saved: false,
          reason: "host-unsupported",
          errorName: folder.lastFailure.name,
        };
      }
      folder.writeVerified = false;
      folder.permission = "prompt";
      updateSaveFolderStatus(kind);
    }
    if (!quiet) {
      setStatus(permissionError
        ? `${target.label} folder write permission is unavailable in Alt1 — choose the folder again; this PNG is kept for retry`
        : `Could not save ${label}: ${error.message || error}`, permissionError ? "warn" : "error");
    }
    return {
      saved: false,
      reason: permissionError ? "permission" : "error",
      errorName: String(error?.name || "Error"),
    };
  }
}

function capturePngTimestamp(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return `${safeTimestampForFilename(value)}-${String(value.getMilliseconds()).padStart(3, "0")}`;
}

function mapPngFilename(date = new Date(), floorName = state.gameMap?.floor?.name) {
  const floor = safeFilePart(floorName, "unknown");
  return `dungeon-map-${floor}-${capturePngTimestamp(date)}.png`;
}

async function saveMap(options = {}) {
  const frozenDataUrl = typeof options?.dataUrl === "string" ? options.dataUrl : null;
  if (!frozenDataUrl && !state.image) {
    // Every other save path reports a reason; the manual button must not no-op
    // silently. Stay quiet on the auto-save path (it aggregates its own status).
    if (!options?.quiet) setStatus("No map to save yet — wait for a Dungeoneering map to appear", "warn");
    return { saved: false, reason: "no-map" };
  }
  const date = options?.date instanceof Date ? options.date : new Date();
  const prepared = {
    filename: mapPngFilename(date, options?.floorName),
    dataUrl: frozenDataUrl || elements.canvas.toDataURL("image/png"),
  };
  await state.captureArchive.restorePromise;
  await queuePendingMapPng({ saved: false, reason: "error", prepared }, { retry: false });
  const saved = await writePngToSaveFolder(
    "map",
    prepared.filename,
    prepared.dataUrl,
    "Map PNG",
    options,
  );
  if (saved.saved) await removePendingCapturePng("map", prepared);
  return { ...saved, prepared };
}

function resultsPngFilename(result, date = new Date()) {
  const floor = safeFilePart(result?.Floor || result?.FloorSize, "unknown");
  return `dungeon-results-${floor}-${capturePngTimestamp(date)}.png`;
}

function cropImageData(image, x, y, width, height) {
  if (!image || x < 0 || y < 0 || x + width > image.width || y + height > image.height) return null;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const source = ((y + row) * image.width + x) * 4;
    const target = row * width * 4;
    data.set(image.data.subarray(source, source + width * 4), target);
  }
  return new ImageData(data, width, height);
}

function imageDataToDataUrl(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const output = canvas.getContext("2d", { willReadFrequently: true });
  output.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function prepareResultsInterfacePng(capture, date = new Date()) {
  const { image, result } = capture;
  const rect = resultCaptureRect(capture);
  if (!rect) return null;
  const { offset, width, height } = rect;
  const cropped = cropImageData(image, offset.x, offset.y, width, height);
  if (!cropped) return null;
  return {
    filename: resultsPngFilename(result, date),
    dataUrl: imageDataToDataUrl(cropped),
  };
}

async function saveResultsInterfacePng(capture, date = new Date(), options = {}) {
  const prepared = options?.prepared || prepareResultsInterfacePng(capture, date);
  if (!prepared) return { saved: false, reason: "no-results-crop", prepared: null };
  await state.captureArchive.restorePromise;
  await queuePendingResultsPng({ saved: false, reason: "error", prepared }, { retry: false });
  const saved = await writePngToSaveFolder(
    "results",
    prepared.filename,
    prepared.dataUrl,
    "Results interface PNG",
    options,
  );
  if (saved.saved) await removePendingCapturePng("results", prepared);
  return { ...saved, prepared };
}

function queuePendingMapPng(artifact, { retry = true } = {}) {
  const prepared = artifact?.prepared;
  const retryable = ["no-folder", "permission", "error", "handle-changed", "unsupported", "host-unsupported"].includes(artifact?.reason);
  if (artifact?.saved || !retryable || !prepared?.filename || !prepared?.dataUrl) return;
  prepared.id ||= createCaptureArchiveId("map");
  const existing = state.pendingMapPngs.findIndex((item) => item.id === prepared.id);
  const previous = state.pendingMapPngs[existing];
  const archived = {
    ...prepared,
    kind: "map",
    createdAt: Number(previous?.createdAt) || Date.now(),
    persisted: previous?.persisted === true,
  };
  if (existing >= 0) state.pendingMapPngs[existing] = archived;
  else {
    state.pendingMapPngs.push(archived);
  }
  enforceCaptureArchiveItemLimit();
  const persistence = persistPendingCaptureArchive();
  updateSaveFolderStatus("map");
  updateCaptureArchiveStatus();
  if (retry && !state.saveFolders.hostWriteUnsupported
    && ["granted", "unknown"].includes(saveFolderState("map").permission)) {
    setTimeout(() => { retryPendingMapPngs({ quiet: true }); }, 0);
  }
  return persistence;
}

async function retryPendingMapPngs({ quiet = false } = {}) {
  if (state.saveFolders.hostWriteUnsupported) {
    return { saved: 0, remaining: state.pendingMapPngs.length };
  }
  if (state.retryingMapPngs) {
    state.retryMapPngsRequested = true;
    if (!quiet) state.retryMapPngsNotify = true;
    return { saved: 0, remaining: state.pendingMapPngs.length };
  }
  if (!state.pendingMapPngs.length) {
    return { saved: 0, remaining: state.pendingMapPngs.length };
  }
  const folder = saveFolderState("map");
  if (!state.saveFolders.supported || !folder.handle
    || folder.permission === "prompt" || folder.permission === "denied") {
    return { saved: 0, remaining: state.pendingMapPngs.length };
  }
  state.retryingMapPngs = true;
  let saved = 0;
  const savedRecords = [];
  try {
    do {
      state.retryMapPngsRequested = false;
      const pending = state.pendingMapPngs.splice(0);
      state.inFlightMapPngs = pending;
      const remaining = [];
      for (let index = 0; index < pending.length; index += 1) {
        const prepared = pending[index];
        const result = await writePngToSaveFolder(
          "map", prepared.filename, prepared.dataUrl, "Map PNG", { quiet: true },
        );
        if (result.saved) {
          saved += 1;
          savedRecords.push(prepared);
        }
        else {
          remaining.push(prepared, ...pending.slice(index + 1));
          break;
        }
      }
      const merged = new Map();
      for (const prepared of [...remaining, ...state.pendingMapPngs]) {
        if (prepared?.filename && prepared?.dataUrl) merged.set(prepared.id || prepared.filename, prepared);
      }
      state.pendingMapPngs = [...merged.values()];
      enforceCaptureArchiveItemLimit();
      state.inFlightMapPngs = [];
    } while (state.retryMapPngsRequested && state.pendingMapPngs.length);
  } finally {
    if (state.inFlightMapPngs.length) {
      const merged = new Map();
      for (const prepared of [...state.inFlightMapPngs, ...state.pendingMapPngs]) {
        if (prepared?.filename && prepared?.dataUrl) merged.set(prepared.id || prepared.filename, prepared);
      }
      state.pendingMapPngs = [...merged.values()];
      state.inFlightMapPngs = [];
      enforceCaptureArchiveItemLimit();
    }
    state.retryingMapPngs = false;
    persistPendingCaptureArchive();
    updateSaveFolderStatus("map");
    updateCaptureArchiveStatus();
  }
  if (savedRecords.length && !(await deletePersistedCaptureRecords(savedRecords))) {
    state.pendingMapPngs = mergeRestoredCaptureRecords([
      ...state.pendingMapPngs,
      ...savedRecords.map((record) => ({ ...record, persisted: false })),
    ], [], "map");
    await enforceCaptureArchiveItemLimit();
    await persistPendingCaptureArchive();
    updateSaveFolderStatus("map");
    updateCaptureArchiveStatus();
  }
  const notifyRetry = !quiet || state.retryMapPngsNotify;
  state.retryMapPngsNotify = false;
  if (notifyRetry && saved) {
    setStatus(`Retried and saved ${saved} map PNG${saved === 1 ? "" : "s"}`, state.pendingMapPngs.length ? "warn" : "ok");
  }
  return { saved, remaining: state.pendingMapPngs.length };
}

function queuePendingResultsPng(artifact, { retry = true } = {}) {
  const prepared = artifact?.prepared;
  const retryable = ["no-folder", "permission", "error", "handle-changed", "unsupported", "host-unsupported"].includes(artifact?.reason);
  if (artifact?.saved || !retryable || !prepared?.filename || !prepared?.dataUrl) return;
  prepared.id ||= createCaptureArchiveId("results");
  const existing = state.pendingResultsPngs.findIndex((item) => item.id === prepared.id);
  const previous = state.pendingResultsPngs[existing];
  const archived = {
    ...prepared,
    kind: "results",
    createdAt: Number(previous?.createdAt) || Date.now(),
    persisted: previous?.persisted === true,
  };
  if (existing >= 0) state.pendingResultsPngs[existing] = archived;
  else {
    state.pendingResultsPngs.push(archived);
  }
  enforceCaptureArchiveItemLimit();
  const persistence = persistPendingCaptureArchive();
  updateSaveFolderStatus("results");
  updateCaptureArchiveStatus();
  if (retry && !state.saveFolders.hostWriteUnsupported
    && ["granted", "unknown"].includes(saveFolderState("results").permission)) {
    // One asynchronous retry covers transient write errors. A repeated failure
    // remains visible in the queue until the user chooses/re-allows the folder.
    setTimeout(() => { retryPendingResultsPngs({ quiet: true }); }, 0);
  }
  return persistence;
}

async function retryPendingResultsPngs({ quiet = false } = {}) {
  if (state.saveFolders.hostWriteUnsupported) {
    return { saved: 0, remaining: state.pendingResultsPngs.length };
  }
  if (state.retryingResultsPngs) {
    state.retryResultsPngsRequested = true;
    if (!quiet) state.retryResultsPngsNotify = true;
    return { saved: 0, remaining: state.pendingResultsPngs.length };
  }
  if (!state.pendingResultsPngs.length) return { saved: 0, remaining: 0 };
  const folder = saveFolderState("results");
  // Avoid querying/walking the complete queue before every new floor when the
  // same missing or expired folder makes every write predictably impossible.
  if (!state.saveFolders.supported || !folder.handle
    || folder.permission === "prompt" || folder.permission === "denied") {
    return { saved: 0, remaining: state.pendingResultsPngs.length };
  }
  state.retryingResultsPngs = true;
  let saved = 0;
  const savedRecords = [];
  try {
    do {
      state.retryResultsPngsRequested = false;
      const pending = state.pendingResultsPngs.splice(0);
      state.inFlightResultsPngs = pending;
      const remaining = [];
      for (let index = 0; index < pending.length; index += 1) {
        const prepared = pending[index];
        const result = await writePngToSaveFolder(
          "results",
          prepared.filename,
          prepared.dataUrl,
          "Results interface PNG",
          { quiet: true },
        );
        if (result.saved) {
          saved += 1;
          savedRecords.push(prepared);
        }
        else {
          remaining.push(prepared);
          if (["no-folder", "permission", "handle-changed", "unsupported", "host-unsupported"].includes(result.reason)) {
            remaining.push(...pending.slice(index + 1));
            break;
          }
        }
      }
      // Merge by filename so a concurrent failed capture or retry cannot leave
      // duplicate writes queued for the same already-frozen PNG bytes.
      const merged = new Map();
      for (const prepared of [...remaining, ...state.pendingResultsPngs]) {
        if (prepared?.filename && prepared?.dataUrl) merged.set(prepared.id || prepared.filename, prepared);
      }
      state.pendingResultsPngs = [...merged.values()];
      enforceCaptureArchiveItemLimit();
      state.inFlightResultsPngs = [];
    } while (state.retryResultsPngsRequested && state.pendingResultsPngs.length);
  } finally {
    if (state.inFlightResultsPngs.length) {
      const merged = new Map();
      for (const prepared of [...state.inFlightResultsPngs, ...state.pendingResultsPngs]) {
        if (prepared?.filename && prepared?.dataUrl) merged.set(prepared.id || prepared.filename, prepared);
      }
      state.pendingResultsPngs = [...merged.values()];
      state.inFlightResultsPngs = [];
      enforceCaptureArchiveItemLimit();
    }
    state.retryingResultsPngs = false;
    persistPendingCaptureArchive();
    updateSaveFolderStatus("results");
    updateCaptureArchiveStatus();
  }
  if (savedRecords.length && !(await deletePersistedCaptureRecords(savedRecords))) {
    state.pendingResultsPngs = mergeRestoredCaptureRecords([
      ...state.pendingResultsPngs,
      ...savedRecords.map((record) => ({ ...record, persisted: false })),
    ], [], "results");
    await enforceCaptureArchiveItemLimit();
    await persistPendingCaptureArchive();
    updateSaveFolderStatus("results");
    updateCaptureArchiveStatus();
  }
  const notifyRetry = !quiet || state.retryResultsPngsNotify;
  state.retryResultsPngsNotify = false;
  if (notifyRetry && saved > 0) {
    const suffix = state.pendingResultsPngs.length
      ? `; ${state.pendingResultsPngs.length} still waiting`
      : "";
    setStatus(`Retried and saved ${saved} results PNG${saved === 1 ? "" : "s"}${suffix}`, state.pendingResultsPngs.length ? "warn" : "ok");
  }
  return { saved, remaining: state.pendingResultsPngs.length };
}

function liveResultExtraFields() {
  return {
    roomcount: state.gameMap?.openedRoomCount,
    deadEnds: state.gameMap?.deadEndCount,
    // Prefer the floor size detected from map geometry over the unreliable
    // "Dungeon Size" XP modifier text on the results screen.
    floorSize: state.gameMap?.floor?.name ?? state.calibration?.floor?.name,
  };
}

function resultExtraFields() {
  return state.activeResultContext?.extraFields || liveResultExtraFields();
}

function freezeCurrentResultContext(date = new Date()) {
  const extraFields = liveResultExtraFields();
  let mapDataUrl = null;
  if (state.image) {
    try {
      // Freeze the exact rendered end-of-floor map now. The independent map and
      // results scan loops may advance state while OCR settles for 1.2s.
      mapDataUrl = elements.canvas.toDataURL("image/png");
    } catch {
      mapDataUrl = null;
    }
  }
  return {
    extraFields,
    mapGeneration: state.mapGeneration,
    mapSnapshotRevision: state.mapSnapshotRevision,
    mapFloorName: state.gameMap?.floor?.name ?? null,
    mapDataUrl,
    capturedAt: date instanceof Date ? date : new Date(),
  };
}

async function readDungeonResultsCapture(date = new Date(), {
  allowScaleFallback = true,
  interfaceScale = null,
  trustScaleHint = false,
} = {}) {
  const reader = await winterfaceReader;
  // Do not capture until the lazily-loaded OCR assets are ready. On a cold
  // start, capturing first could leave us parsing an interface frame that was
  // already animating or closed by the time the reader finished loading.
  await prepareDesktopFullCapture();
  await waitForPixelCaptureSlot();
  const image = captureFullRuneScape();
  const calibratedScale = Number(state.calibration?.scale) || null;
  const scaleHint = interfaceScale ?? detectedInterfaceScale();
  const capture = reader.readWithOffset(image, {
    ...resultExtraFields(),
    timestamp: date,
    // The map locator already knows RuneScape's interface scale. The results
    // reader uses it first, then falls back across supported scales when no map
    // has been calibrated yet.
    interfaceScale: scaleHint,
    allowScaleFallback,
    // A stored/previous observation is only a fast probe. The matcher must
    // remain allowed to prove that RuneScape's interface scale changed.
    trustScaleHint,
  });
  if (!capture) return null;
  const markerRect = resultCaptureRect(capture);
  if (markerRect) {
    state.lastResultMarkerSource = {
      x: markerRect.offset.x,
      y: markerRect.offset.y,
      width: markerRect.width,
      height: markerRect.height,
      scale: Number(capture.rawScale ?? capture.sourceScale ?? capture.scale) || detectedInterfaceScale(),
      clientWidth: Number(window.alt1?.rsWidth) || 0,
      clientHeight: Number(window.alt1?.rsHeight) || 0,
    };
  }
  if (!state.activeResultContext) state.activeResultContext = freezeCurrentResultContext(date);
  const completionContext = state.activeResultContext;
  // Keep every follow-up OCR read paired with the map/stats from the first
  // marker sighting, even if a new map frame arrives while values settle.
  capture.result.Roomcount = String(completionContext.extraFields.roomcount ?? "");
  capture.result.DeadEnds = String(completionContext.extraFields.deadEnds ?? "");
  capture.result.FloorSize = completionContext.extraFields.floorSize || capture.result.FloorSize;
  if (capture.scale) {
    if (calibratedScale && Math.abs(capture.scale - calibratedScale) >= 0.025) {
      // The strong Winterface marker proves the global UI scale changed while
      // the old map lock was hidden by results. Drop stale geometry now rather
      // than waiting for three unreadable next-floor frames.
      clearCalibration();
    }
    recordInterfaceScale(capture.scale, "results");
  }
  // Seeing the winterface marker is an authoritative end-of-floor signal. The
  // RPM transition may hold the old map behind it, then rebases only after the
  // results screen disappears and new-floor room progress is confirmed.
  if (!state.awaitingNewFloor) state.pendingFloorReset = null;
  state.awaitingNewFloor = true;
  return {
    ...capture,
    image,
    date,
    mapReadAt: state.lastMapReadAt,
    mapGeneration: completionContext.mapGeneration,
    mapSnapshotRevision: completionContext.mapSnapshotRevision,
    mapFloorName: completionContext.mapFloorName,
    mapDataUrl: completionContext.mapDataUrl,
    mapCapturedAt: completionContext.capturedAt,
  };
}

async function probeDungeonResultsSentinel() {
  const skipped = {
    probed: false,
    present: Boolean(state.resultSentinelOpen),
    rising: false,
  };
  if (state.resultsBusy || !hasAlt1() || !window.alt1.rsLinked) return skipped;
  const now = Date.now();
  if (now - state.lastResultSentinelProbe < captureCadence(RESULTS_SENTINEL_CADENCE_MS)) return skipped;
  if (!tryReservePixelCaptureSlot()) return skipped;
  const plan = createResultsSentinelPlan({
    clientWidth: window.alt1.rsWidth,
    clientHeight: window.alt1.rsHeight,
    interfaceScale: detectedInterfaceScale(),
    previousSource: state.lastResultMarkerSource,
  });
  state.lastResultSentinelProbe = now;
  if (!plan) return { probed: true, present: false, rising: false };

  const image = captureRegion(plan.x, plan.y, plan.width, plan.height);
  const present = resultsSentinelsMatch(image, plan);
  const rising = present && !state.resultSentinelOpen;
  state.resultSentinelOpen = present;
  if (rising && (!state.autoResultState?.visible || !state.autoResultState?.handled)) {
    // Match dghelper's rising-edge behaviour: wake the results reader on the
    // very first positive 250 ms sentinel frame. This deliberately does not set
    // awaitingNewFloor; only the full marker/OCR reader below is authoritative.
    state.autoResultState = { visible: true, key: "", handled: false, missing: 0, stable: 0 };
    state.resultStableTiming = { key: "", since: 0 };
    state.lastAutoResultScan = 0;
    renderGameOverlay();
  }
  return { probed: true, present, rising };
}

function captureCadence(minimum = RESULTS_SETTLE_INTERVAL) {
  const recommended = Number(window.alt1?.captureInterval);
  return Number.isFinite(recommended) && recommended > 0
    ? Math.max(minimum, recommended)
    : minimum;
}

function backendCaptureInterval() {
  return normalizeCaptureInterval(window.alt1?.captureInterval);
}

async function prepareDesktopFullCapture() {
  if (!window.alt1?.compatEnabled) return;
  clearGameOverlay();
  // Desktop capture includes overlay pixels. Give Alt1 one backend frame after
  // clearing so neither OCR nor the saved final-interface crop contains our
  // own RPM/test/debug overlay.
  await new Promise((resolve) => setTimeout(resolve, backendCaptureInterval()));
}

function tryReservePixelCaptureSlot() {
  const reservation = reserveCaptureSlot(
    state.nextPixelCaptureAt,
    Date.now(),
    backendCaptureInterval(),
  );
  state.nextPixelCaptureAt = reservation.nextCaptureAt;
  return reservation.reserved;
}

async function waitForPixelCaptureSlot() {
  for (;;) {
    if (tryReservePixelCaptureSlot()) return;
    const delay = Math.max(1, state.nextPixelCaptureAt - Date.now());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function removePendingCapturePng(kind, prepared) {
  const key = kind === "results" ? "pendingResultsPngs" : "pendingMapPngs";
  const removed = state[key].filter((item) => prepared?.id
    ? item.id === prepared.id
    : item.filename === prepared?.filename && item.dataUrl === prepared?.dataUrl);
  if (!removed.length) return false;
  const removedIds = new Set(removed.map((item) => item.id));
  state[key] = state[key].filter((item) => !removedIds.has(item.id));
  if (!(await deletePersistedCaptureRecords(removed))) {
    state[key] = mergeRestoredCaptureRecords([
      ...state[key],
      ...removed.map((record) => ({ ...record, persisted: false })),
    ], [], kind);
    await enforceCaptureArchiveItemLimit();
    await persistPendingCaptureArchive();
  }
  updateSaveFolderStatus(kind);
  updateCaptureArchiveStatus();
  return !state[key].some((item) => removedIds.has(item.id));
}

function waitForNextResultScan() {
  return new Promise((resolve) => setTimeout(resolve, captureCadence(RESULTS_SETTLE_INTERVAL)));
}

async function readSettledDungeonResultsCapture() {
  let gate = { visible: false, key: "", handled: false, missing: 0, stable: 0 };
  let timing = { key: "", since: 0 };
  let latest = null;
  let found = false;
  for (let scan = 0; scan < RESULTS_MANUAL_MAX_SCANS; scan += 1) {
    const capture = await readDungeonResultsCapture(new Date());
    if (capture) {
      found = true;
      latest = capture;
    }
    gate = nextAutoResultState(gate, capture?.result ?? null);
    ({ gate, timing } = enforceResultStableDuration(timing, gate, Date.now()));
    if (capture && gate.shouldAdd) return { capture, found: true, settled: true, lost: false, gate, timing };
    if (!found && scan >= 2) return { capture: null, found: false, settled: false, lost: false, gate, timing };
    if (found && !capture && !gate.visible) return { capture: latest, found: true, settled: false, lost: true, gate, timing };
    if (scan + 1 < RESULTS_MANUAL_MAX_SCANS) await waitForNextResultScan();
  }
  return { capture: latest, found, settled: false, lost: false, gate, timing };
}

async function requestManualArtifactPermissions() {
  const requestedKinds = [];
  if (elements.autoSaveResultsPng.checked) requestedKinds.push("results");
  if (elements.autoSaveMapPng.checked) requestedKinds.push("map");
  const attempts = requestedKinds.map((kind) => {
    const folder = saveFolderState(kind);
    // Only a known prompt benefits from a proactive request. "unknown" is a
    // normal Alt1 compatibility state and must flow to the bounded real write;
    // "denied" requires selecting the folder again.
    if (!folder.handle || folder.permission !== "prompt" || !canRequestSaveFolderPermission(folder)) return null;
    // Run this before the settling delay while the Read-results click still
    // carries user activation; start every request before the first await. A
    // background/auto scan is not allowed to prompt.
    const handle = folder.handle;
    return { kind, folder, handle, request: requestSaveFolderPermission(handle) };
  }).filter(Boolean);
  const permissions = await Promise.all(attempts.map((attempt) => attempt.request));
  attempts.forEach((attempt, index) => {
    // A folder can be changed while its permission prompt is open; never apply
    // the old handle's answer to the newly selected handle.
    if (attempt.folder.handle === attempt.handle) attempt.folder.permission = permissions[index];
    updateSaveFolderStatus(attempt.kind);
  });
}

function appendResult(result) {
  state.results.unshift(result);
  const persisted = persistResults();
  renderResults();
  return persisted;
}

function resultBatchTarget() {
  return normalizeResultBatchTarget(elements.resultBatchSize.value);
}

function resultBatchMode() {
  return elements.resultBatchMode.value === RESULT_BATCH_MODES.Reset
    ? RESULT_BATCH_MODES.Reset
    : RESULT_BATCH_MODES.Lock;
}

function resultBatchFilter() {
  return elements.resultFloorFilter.value.trim();
}

function renderResultBatchSummary() {
  const status = resultBatchStatus(state.results, {
    target: resultBatchTarget(),
    filter: resultBatchFilter(),
  });
  const mode = resultBatchMode() === RESULT_BATCH_MODES.Reset ? "auto-next" : "locked";
  elements.resultBatchSummary.textContent = `${status.summary}${status.complete ? ` | complete (${mode})` : ""}`;
}

function resetResultBatch(notify = true) {
  state.results = [];
  persistResults();
  state.autoResultState = nextAutoResultState(state.autoResultState, null, { missesBeforeHidden: 0 });
  renderResults();
  if (notify) setStatus("Dungeon results batch reset", "warn");
}

function prepareResultBatch(result) {
  const filter = resultBatchFilter();
  if (!resultMatchesFloorFilter(result, filter)) {
    const filterText = filter || "all";
    return {
      accepted: false,
      status: `Results skipped: floor ${result?.Floor || "?"} does not match filter ${filterText}`,
      tone: "warn",
    };
  }
  if (resultAlreadyRecorded(state.results, result)) {
    return {
      accepted: false,
      duplicate: true,
      status: `Results skipped: floor ${result?.Floor || "?"} is already in the table`,
      tone: "warn",
    };
  }
  const recentKey = resultStabilityKey(result);
  const recentAge = Date.now() - Number(state.recentResultScreen?.committedAt);
  if (recentKey && state.recentResultScreen?.key === recentKey
    && Number.isFinite(recentAge) && recentAge >= 0 && recentAge <= RECENT_RESULT_SCREEN_MAX_AGE) {
    return {
      accepted: false,
      duplicate: true,
      status: `Results skipped: this still-visible floor ${result?.Floor || "?"} screen was already recorded`,
      tone: "warn",
    };
  }
  const target = resultBatchTarget();
  if (resultBatchIsComplete(state.results, target)) {
    if (resultBatchMode() === RESULT_BATCH_MODES.Reset) {
      resetResultBatch(false);
    } else {
      return {
        accepted: false,
        status: "Results batch is complete; reset batch before adding more floors",
        tone: "warn",
      };
    }
  }
  return { accepted: true };
}

async function saveResultArtifacts(capture, { quiet = true } = {}) {
  const hasMapData = Boolean(capture?.mapDataUrl);
  const mapSizeMatches = !capture?.ocrFloorSize || capture?.mapFloorName === capture.ocrFloorSize;
  const hasFreshMatchingMap = Boolean(capture?.mapSnapshotClaimed) && hasMapData && mapSizeMatches;
  const exports = plannedResultExports({
    autoSaveMap: elements.autoSaveMapPng.checked,
    autoSaveResults: elements.autoSaveResultsPng.checked,
    // Only auto-save the map when the held map matches the floor these results
    // are for. The last map read is sticky, so if the floor-B winterface was
    // reached without ever locking floor B's map, state.image is still floor A —
    // pairing a stale floor-A map PNG with a floor-B results row on disk.
    hasMap: hasFreshMatchingMap,
    hasResultsOffset: Boolean(resultCaptureRect(capture)),
  });
  const results = [];
  if (elements.autoSaveMapPng.checked && !hasMapData) {
    results.push({ kind: "map", saved: false, reason: "no-map" });
  } else if (elements.autoSaveMapPng.checked && !mapSizeMatches) {
    results.push({ kind: "map", saved: false, reason: "map-floor-mismatch" });
  } else if (elements.autoSaveMapPng.checked && !capture?.mapSnapshotClaimed) {
    results.push({ kind: "map", saved: false, reason: "map-snapshot-not-new" });
  }
  if (exports.includes("map")) {
    await retryPendingMapPngs({ quiet: true });
    const artifact = { kind: "map", ...await saveMap({
      date: capture.mapCapturedAt || capture.date,
      quiet,
      dataUrl: capture.mapDataUrl,
      floorName: capture.mapFloorName,
    }) };
    results.push(artifact);
    queuePendingMapPng(artifact);
    if (artifact.saved && state.pendingMapPngs.length) await retryPendingMapPngs({ quiet: true });
  }
  if (exports.includes("results")) {
    // A prior permission/no-folder failure keeps its already-captured PNG bytes.
    // Retry those first; never recapture an old results screen from live pixels.
    await retryPendingResultsPngs({ quiet: true });
    const artifact = {
      kind: "results",
      ...await saveResultsInterfacePng(capture, capture.date, { quiet }),
    };
    results.push(artifact);
    queuePendingResultsPng(artifact);
    if (artifact.saved && state.pendingResultsPngs.length) {
      await retryPendingResultsPngs({ quiet: true });
    }
  }
  return results;
}

function claimResultMapSnapshot(capture) {
  const generation = Math.max(0, Number(capture?.mapGeneration) || 0);
  const claimed = resultMapSnapshotMatchesGeneration(capture, {
    lastConsumedGeneration: state.lastResultMapGenerationConsumed,
    lastConsumedSnapshotRevision: state.lastResultMapSnapshotRevisionConsumed,
    hasMap: Boolean(capture?.mapDataUrl),
  });
  // Only a successfully matched snapshot consumes its floor generation, and
  // the caller invokes this after filter/dedupe/batch acceptance. A corrected
  // filter can therefore retry the same still-visible result safely.
  if (claimed && generation > 0) {
    state.lastResultMapGenerationConsumed = Math.max(state.lastResultMapGenerationConsumed, generation);
    state.lastResultMapSnapshotRevisionConsumed = Math.max(
      state.lastResultMapSnapshotRevisionConsumed,
      Math.max(0, Number(capture?.mapSnapshotRevision) || 0),
    );
  }
  capture.mapSnapshotClaimed = claimed;
  return claimed;
}

function resultArtifactSuffix(results) {
  if (!results?.length) return "";
  const saved = results.filter((result) => result.saved).length;
  if (saved === results.length) return `; saved ${saved} PNG${saved === 1 ? "" : "s"}`;
  const firstFailure = results.find((result) => !result.saved);
  const reason = {
    "host-unsupported": "stored in the capture archive (Alt1 folder writes unavailable)",
    unsupported: "stored in the capture archive (external folder saving unavailable)",
    "no-folder": "stored in the capture archive; choose a save folder for direct writes",
    permission: "stored in the capture archive; folder permission needed for direct writes",
    "handle-changed": "save folder changed; retry queued",
    error: "stored in the capture archive after the folder write failed",
    "no-map": "no map image",
    "map-floor-mismatch": "map size did not match results",
    "map-snapshot-not-new": "no newly accepted map snapshot",
    "no-results-crop": "results crop failed",
  }[firstFailure?.reason] || "save skipped";
  if (saved > 0) return `; saved ${saved}/${results.length} PNGs, ${reason}`;
  if (["host-unsupported", "unsupported", "no-folder", "permission", "handle-changed", "error"].includes(firstFailure?.reason)) {
    return `; PNG ${reason}`;
  }
  return `; PNG save skipped: ${reason}`;
}

function resultArtifactTone(results) {
  return results?.some((result) => !result.saved) ? "warn" : "ok";
}

async function commitDungeonResultsCapture(capture, source = "manual") {
  const { result } = capture;
  const batch = prepareResultBatch(result);
  if (!batch.accepted) {
    return batch;
  }
  claimResultMapSnapshot(capture);
  const persisted = appendResult(result);
  state.recentResultScreen = { key: resultStabilityKey(result), committedAt: Date.now() };
  storageSet(`${STORAGE_PREFIX}:last-result-screen`, JSON.stringify(state.recentResultScreen));
  const artifacts = await saveResultArtifacts(capture, { quiet: source === "auto" });
  const status = resultBatchStatus(state.results, {
    target: resultBatchTarget(),
    filter: resultBatchFilter(),
  });
  const complete = status.complete
    ? resultBatchMode() === RESULT_BATCH_MODES.Reset
      ? "; batch target reached, next matching floor starts a new batch"
      : "; batch complete, reset to continue"
    : "";
  const label = source === "auto" ? "Results auto-tracked" : "Results read";
  return {
    accepted: true,
    status: `${label}: floor ${result.Floor || "?"}, ${result.FinalXP || "?"} XP | avg ${status.averageText}${complete}${resultArtifactSuffix(artifacts)}${persisted ? "" : "; browser storage failed — row may be lost after restart"}`,
    tone: persisted ? resultArtifactTone(artifacts) : "warn",
  };
}

async function captureDungeonResults() {
  if (state.resultsBusy) return;
  state.resultsBusy = true;
  elements.captureResults.disabled = true;
  try {
    assertAlt1Ready();
    await requestManualArtifactPermissions();
    setStatus("Reading the Dungeoneering results screen and waiting for final values…");
    const settled = await readSettledDungeonResultsCapture();
    const capture = settled.capture;
    if (!settled.found || !capture) {
      setStatus("Results screen not found — keep the XP overview visible", "error");
      return;
    }
    // The pre-skip completion screen matches the winterface marker with every XP
    // field empty; committing it saves a blank results PNG. Wait for real values.
    if (!resultLooksComplete(capture.result)) {
      setStatus("Results not fully visible yet — press Skip in game, then read again", "warn");
      return;
    }
    if (!settled.settled) {
      setStatus(settled.lost
        ? "Results screen closed before final values stabilized — keep it open and read again"
        : "Results were still changing after 9 seconds — press Skip in game or wait for final values, then read again", "warn");
      return;
    }
    const committed = await commitDungeonResultsCapture(capture, "manual");
    // The manual reader already passed the same stability gate as auto mode.
    // Mark this still-visible screen handled so auto tracking does not perform
    // three more full-screen captures only to discover the same duplicate.
    state.autoResultState = {
      visible: true,
      key: settled.gate?.key || "",
      handled: true,
      missing: 0,
      stable: settled.gate?.stable || 3,
    };
    state.resultStableTiming = settled.timing || { key: settled.gate?.key || "", since: Date.now() };
    setStatus(committed.status, committed.tone);
  } catch (error) {
    setStatus(`Could not read the results screen: ${error.message || error}`, "error");
  } finally {
    state.resultsBusy = false;
    elements.captureResults.disabled = false;
  }
}

async function autoCaptureDungeonResults({ forceScan = false } = {}) {
  if (state.resultsBusy || !hasAlt1() || !window.alt1.rsLinked) return;
  const trackingEnabled = Boolean(elements.autoTrackResults.checked);
  const now = Date.now();
  // Results recognition is also the authoritative end-of-floor lifecycle
  // signal for RPM. The cheap sentinel is the fast path; this 900 ms full-reader
  // fallback deliberately remains active so custom colours, shifted dialogs or
  // a stale scale hint cannot make the checkbox control timer correctness.
  const lifecycleProbeNeeded = forceScan
    || trackingEnabled
    || Boolean(state.mapLostAt)
    || state.awaitingNewFloor
    || Boolean(state.autoResultState?.visible)
    || !state.resultSentinelOpen;
  if (!lifecycleProbeNeeded) return;
  // Once this physical results screen has been committed, dghelper keeps only
  // its cheap sentinel active until the panel closes. Avoid re-running a full
  // client OCR sweep every 250 ms while that same handled screen remains open.
  if (!forceScan && state.resultSentinelOpen
    && state.autoResultState?.visible && state.autoResultState?.handled) return;
  const awaitingStableResults = trackingEnabled
    && Boolean(state.autoResultState?.visible)
    && !state.autoResultState?.handled
    && Boolean(state.autoResultState?.key);
  const urgentPresenceCheck = forceScan || Boolean(state.mapLostAt);
  if (!urgentPresenceCheck && !awaitingStableResults
    && now - state.lastAutoResultScan < RESULTS_AUTO_INTERVAL) return;
  state.lastAutoResultScan = now;

  state.resultsBusy = true;
  try {
    const hasMeasuredScale = Boolean(state.calibration?.verified
      || isFreshInterfaceScaleObservation(state.interfaceScale, now));
    const scaleHint = detectedInterfaceScale();
    // Full 100..200% fallback is intentionally expensive. Run it promptly only
    // while a results/loading phase is plausible (or no scale was measured),
    // and very rarely while the live map proves the normal game UI is active.
    const fallbackInterval = (!hasMeasuredScale || state.mapLostAt || state.awaitingNewFloor)
      ? RESULTS_SCALE_FALLBACK_ACTIVE_INTERVAL
      : RESULTS_SCALE_FALLBACK_IDLE_INTERVAL;
    const allowScaleFallback = now - state.lastResultsScaleFallback >= fallbackInterval;
    if (allowScaleFallback) state.lastResultsScaleFallback = now;
    const trustResultsScale = state.interfaceScale?.source === "results"
      && isFreshInterfaceScaleObservation(state.interfaceScale, now);
    let capture = await readDungeonResultsCapture(new Date(), {
      allowScaleFallback,
      interfaceScale: scaleHint,
      trustScaleHint: trustResultsScale,
    });
    // A positive three-zone sentinel proves that the panel is still being
    // rendered even when the heavier marker/OCR pass misses this frame. Feed an
    // incomplete-but-visible observation so that one staged frame cannot tear
    // down the lifecycle state before the next 250 ms retry.
    const observedResult = capture?.result ?? (state.resultSentinelOpen ? {} : null);
    let next = nextAutoResultState(state.autoResultState, observedResult);
    let timed = enforceResultStableDuration(state.resultStableTiming, next, Date.now());
    next = timed.gate;

    // Once complete values appear, take two short follow-up reads in this same
    // results phase. The pure count gate is additionally held for at least 1.2
    // real seconds, so repeated backend frames cannot save an animated panel.
    if (trackingEnabled && capture && resultLooksComplete(capture.result)
      && !next.shouldAdd && !next.handled) {
      for (let burst = 0; burst < 2 && !next.shouldAdd; burst += 1) {
        await waitForNextResultScan();
        const followUp = await readDungeonResultsCapture(new Date(), {
          allowScaleFallback: false,
          interfaceScale: detectedInterfaceScale(),
          // The first pixel fallback just confirmed this scale. Tolerant noisy
          // markers need the trusted hinted path on the short follow-ups.
          trustScaleHint: state.interfaceScale?.source === "results"
            && isFreshInterfaceScaleObservation(state.interfaceScale, Date.now()),
        });
        next = nextAutoResultState(next, followUp?.result ?? null);
        timed = enforceResultStableDuration(timed.timing, next, Date.now());
        next = timed.gate;
        if (followUp) capture = followUp;
        if (!next.visible) break;
      }
    }

    if (!trackingEnabled && next.shouldAdd) {
      next = { ...next, handled: false, shouldAdd: false };
    }

    state.autoResultState = {
      visible: next.visible,
      key: next.key,
      handled: next.handled,
      missing: next.missing,
      stable: next.stable,
    };
    state.resultStableTiming = timed.timing;
    if (!next.visible) state.activeResultContext = null;
    if (!trackingEnabled || !capture || !next.shouldAdd) return;
    const committed = await commitDungeonResultsCapture(capture, "auto");
    setStatus(committed.status, committed.tone);
  } catch (error) {
    const observedResult = state.resultSentinelOpen ? {} : null;
    const missed = nextAutoResultState(state.autoResultState, observedResult);
    const timed = enforceResultStableDuration(state.resultStableTiming, missed, Date.now());
    state.autoResultState = timed.gate;
    state.resultStableTiming = timed.timing;
    if (!timed.gate.visible) state.activeResultContext = null;
    if (elements.debugMode?.checked) {
      setStatus(`Results lifecycle scan failed: ${error.message || error}`, "warn");
    }
  } finally {
    state.resultsBusy = false;
  }
}

function renderResults() {
  // Older Alt1/CEF builds (Chromium < 86) lack Element.replaceChildren, which
  // threw a startup error for some users. Stick to DOM Level 1 methods that are
  // supported everywhere Alt1 runs.
  const tbody = elements.resultsBody;
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  // Oldest floor first so the # column reads 1..N top-to-bottom.
  orderedResultsForDisplay(state.results).forEach((result, index) => {
    const row = document.createElement("tr");
    for (const column of RESULT_DISPLAY_COLUMNS) {
      const cell = document.createElement("td");
      cell.textContent = resultDisplayValue(result, column.field, index + 1);
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  });
  renderResultBatchSummary();
}

async function copyResults() {
  if (!state.results.length) return;
  // Export keeps the full XP breakdown (RESULT_COLUMNS), in the same play order
  // as the on-screen table (oldest first), with a leading floor number.
  const text = [
    ["#", ...RESULT_COLUMNS].join("\t"),
    ...orderedResultsForDisplay(state.results).map((result, index) =>
      [index + 1, ...RESULT_COLUMNS.map((column) => result[column] ?? "")].join("\t")),
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
  // Team-sync error facts (connection lost / removed from the room) must survive
  // forgetting the scanned party; only a stale non-error hint is cleared.
  if (state.roomStatusHint?.tone !== "error") state.roomStatusHint = null;
  renderRoomStatus();
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

function installedInAlt1() {
  if (!hasAlt1()) return false;
  if (window.alt1.permissionInstalled === true) return true;
  return ["permissionPixel", "permissionGameState", "permissionOverlay"]
    .some((key) => window.alt1[key] === true || window.alt1[key] === 1 || window.alt1[key] === "true");
}

function updateInstallLink() {
  if (!elements.installLink) return;
  elements.installLink.hidden = installedInAlt1();
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
    elements.teamStatus.textContent = "Only the party leader can kick players";
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
    elements.teamStatus.textContent = "Only the party leader can promote players";
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

function partyScanDebugSuffix(method) {
  if (!elements.debugMode?.checked) return "";
  const font = method === "sprite anchor"
    ? state.chatboxFont ? "chatbox font" : "FALLBACK font — chatbox font failed to load"
    : "aa font";
  return ` · ${method} · ${font}`;
}

const PARTY_DEBUG_GROUP = "dungeons-alt1-party-debug";

function overlayArgb(r, g, b, a = 255) {
  return (a << 24) | (r << 16) | (g << 8) | b;
}

function clearPartyDebugOverlay() {
  if (!hasAlt1() || typeof window.alt1.overLayClearGroup !== "function") return;
  window.alt1.overLayClearGroup(PARTY_DEBUG_GROUP);
  if (typeof window.alt1.overLayRefreshGroup === "function") window.alt1.overLayRefreshGroup(PARTY_DEBUG_GROUP);
}

// Draw the detected DG icon, the five row crops and the read names directly on
// the RuneScape screen so a misdetection is visible in game. Uses client capture
// coordinates only (never screen rsX/rsY), matching the native overlay contract.
function drawPartyDebugOverlay(panel, members = []) {
  if (!hasAlt1() || !elements.debugMode?.checked || !panel) return;
  const api = window.alt1;
  if (typeof api.overLaySetGroup !== "function" || typeof api.overLayRect !== "function") return;
  const duration = 6000;
  api.overLaySetGroup(PARTY_DEBUG_GROUP);
  if (typeof api.overLayClearGroup === "function") api.overLayClearGroup(PARTY_DEBUG_GROUP);
  if (panel.anchor) {
    api.overLayRect(overlayArgb(255, 230, 60), panel.anchor.x, panel.anchor.y, 14, 19, duration, 1);
  }
  for (const row of panel.rows ?? []) {
    const member = members.find((candidate) => candidate.slot === row.slot);
    const color = overlayArgb(row.color[0], row.color[1], row.color[2]);
    api.overLayRect(color, row.x, row.y, row.width, row.height, duration, 1);
    if (typeof api.overLayTextEx === "function") {
      const label = `${row.slot}:${member?.name || (member?.occupied ? "?" : "-")}`;
      api.overLayTextEx(label, color, 10, row.x, Math.max(0, row.y - 11), duration, "", true, false);
    }
  }
  if (typeof api.overLayRefreshGroup === "function") api.overLayRefreshGroup(PARTY_DEBUG_GROUP);
  api.overLaySetGroup("");
}

const ROOM_STATUS_TONES = new Set(["", "ok", "warn", "error"]);

function setRoomStatus(message, tone = "") {
  const el = elements.roomStatus;
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = ROOM_STATUS_TONES.has(tone) ? tone : "";
}

// Single source of truth for the "are we in a room?" line in the experimental
// panel. It always reflects the LIVE teamSync socket state, so a join is
// confirmed right where the user is looking — the per-scan status line is
// overwritten every 5s and the Team-sync panel is a different collapsible.
// Idle reasons (auto-join off/waiting, connection lost) come from roomStatusHint.
function renderRoomStatus() {
  if (!elements.roomStatus) return;
  const { message, tone } = roomStatusLine({
    connected: teamSync.connected,
    connecting: teamSync.connecting,
    roomCode: teamSync.roomCode,
    memberCount: teamSync.members.length,
    hint: state.roomStatusHint,
  });
  setRoomStatus(message, tone);
}

function maybeAutoJoinFromParty() {
  const localName = elements.teamName.value.trim() || teamSync.name;
  const status = automaticPartyRoomStatus(state.observedParty, localName);
  const haveRoom = Boolean(status.roomCode) && status.members.length >= 2;
  if (!elements.experimentalAutoRoom?.checked) {
    // The scan works but auto-join is off — tell the user how to start a room.
    state.roomStatusHint = haveRoom
      ? { message: `Party ready · tick “Auto-join” to start room ${status.roomCode}`, tone: "warn" }
      : null;
    renderRoomStatus();
    return;
  }
  // Only ever auto-join from a clean state. While a socket is OPEN or still
  // CONNECTING we leave it alone: this stops a 5s rescan from tearing down an
  // in-flight handshake (the relay can cold-start for ~30s) and never silently
  // overrides a room the user joined by hand. The indicator still reflects it.
  if (teamSync.connected || teamSync.connecting) {
    renderRoomStatus();
    return;
  }
  if (!haveRoom) {
    state.roomStatusHint = { message: `Auto-room waiting: ${status.message}`, tone: "warn" };
    elements.teamStatus.textContent = `Auto-room waiting: ${status.message}`;
    renderRoomStatus();
    return;
  }
  clearRemoteTeamState();
  // Join the leader's deterministic room. Only create/host it when the scan
  // placed us in slot 1; otherwise join (the relay forms the room on join), so a
  // missed local RSN no longer blocks the room from starting.
  const isLeader = status.localSlot === 1;
  state.roomWanted = true;
  state.roomStatusHint = null;
  elements.teamRoom.value = teamSync.connect(status.roomCode, localName, undefined, { create: isLeader });
  elements.teamStatus.textContent = status.localSlot
    ? `Experimental: auto-joining ${status.roomCode} (leader ${status.leaderName}, you are slot ${status.localSlot})…`
    : `Experimental: auto-joining ${status.roomCode} (leader ${status.leaderName}); set your RSN to claim a slot…`;
  renderRoomStatus();
}

async function scanPartyInterface({ manual = false, forceFull = false } = {}) {
  if (state.partyScanBusy || state.resultsBusy || state.autoResultState.visible
    || !state.experimentalEnabled || !elements.partyInterface.checked) return false;
  state.lastPartyScan = Date.now();
  if (manual) state.partyAutoScan = true;
  if (!hasAlt1() || !window.alt1.rsLinked) {
    // Keep auto-scan armed: Alt1 may relink. The loop simply retries.
    if (manual) {
      elements.partyScanStatus.textContent = state.observedParty.length
        ? `RuneScape unavailable; cached ${state.observedParty.length} party names retained`
        : "Link Alt1 to RuneScape before scanning the party";
    }
    return false;
  }
  const runtime = partyOcrRuntime();
  // The sprite-anchor reader needs only the chatbox font + OCR; the divider
  // reader needs an aa_* font. Only bail when neither path can run, so a partial
  // OCR-bundle load (aa_* font missing) still leaves the anchor reader working.
  const anchorReady = Boolean(state.chatboxFont) && Boolean(runtime.capture) && Boolean(runtime.ocr?.findReadLine);
  if (!runtime.capture || !runtime.ocr?.findReadLine || (!anchorReady && !runtime.font?.chars)) {
    elements.partyScanStatus.textContent = state.observedParty.length
      ? `Alt1 OCR unavailable; cached ${state.observedParty.length} party names retained`
      : "Alt1 OCR runtime unavailable; using team join order";
    return false;
  }

  state.partyScanBusy = true;
  elements.partyScan.disabled = true;
  try {
    if (manual) await waitForPixelCaptureSlot();
    else if (!tryReservePixelCaptureSlot()) return false;
    // Fast path: locate the panel from the DG skill icon via Alt1's native
    // sub-image search, then read each row. Cheap enough to run on every scan
    // (including the 5s auto loop) and works even when the chatbox font failed
    // to load — names then come from the aa_* fonts and occupancy from pixels.
    const anchorResult = readPartyByAnchor({
      api: window.alt1,
      capture: captureRegion,
      ocr: runtime.ocr,
      font: state.chatboxFont,
      fonts: runtime.fonts,
    });
    if (anchorResult) {
      drawPartyDebugOverlay(anchorResult.panel, anchorResult.members);
      state.partyPanel = null;
      const reconciled = reconcileObservedParty(anchorResult.members, expectedPartyNames());
      applyObservedParty(reconciled, "scan");
      state.partyAutoScan = true;
      elements.partyScanStatus.textContent = formatPartyScanStatus(anchorResult) + partyScanDebugSuffix("sprite anchor");
      renderParty();
      render();
      maybeAutoJoinFromParty();
      return true;
    }

    // The DG icon was not found (non-100% UI scale or a themed interface). The
    // divider detector captures and scans the whole screen and is far heavier,
    // so it only runs on an explicit manual scan.
    if (forceFull) {
      const area = { x: 0, y: 0, width: window.alt1.rsWidth, height: window.alt1.rsHeight };
      const image = runtime.capture(area.x, area.y, area.width, area.height);
      const result = readPartyInterface(image, { ...runtime, expectedNames: expectedPartyNames() });
      if (result) {
        state.partyPanel = globalPartyPanel(result.panel, area);
        const reconciled = reconcileObservedParty(result.members, expectedPartyNames());
        applyObservedParty(reconciled, "scan");
        state.partyAutoScan = true;
        elements.partyScanStatus.textContent = formatPartyScanStatus(result) + partyScanDebugSuffix("divider scan");
        renderParty();
        render();
        maybeAutoJoinFromParty();
        return true;
      }
    }

    // A miss is usually just the interface being closed or briefly occluded.
    // Keep auto-scan armed so the loop picks the party back up when it reappears.
    state.partyPanel = null;
    elements.partyScanStatus.textContent = state.observedParty.length
      ? `DG party interface not visible; tracking ${state.observedParty.length} cached names`
      : forceFull
        ? "DG party interface not found — open it in game (reads best at 100% UI scale)"
        : "Waiting for the DG party interface — open it in game";
    return false;
  } catch (error) {
    elements.partyScanStatus.textContent = `Party scan retrying after: ${error.message || error}`;
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
  elements.save.addEventListener("click", async () => {
    const artifact = await saveMap();
    queuePendingMapPng(artifact);
  });
  elements.clear.addEventListener("click", () => clearAnnotations(true));
  elements.captureResults.addEventListener("click", captureDungeonResults);
  elements.copyResults.addEventListener("click", copyResults);
  elements.chooseMapSaveFolder.addEventListener("click", () => selectSaveFolder("map"));
  elements.clearMapSaveFolder.addEventListener("click", () => clearSelectedSaveFolder("map"));
  elements.reallowMapSaveFolder.addEventListener("click", () => reallowSaveFolder("map"));
  elements.chooseResultsSaveFolder.addEventListener("click", () => selectSaveFolder("results"));
  elements.clearResultsSaveFolder.addEventListener("click", () => clearSelectedSaveFolder("results"));
  elements.reallowResultsSaveFolder.addEventListener("click", () => reallowSaveFolder("results"));
  elements.downloadCaptureArchive?.addEventListener("click", downloadPendingCaptureArchive);
  elements.clearCaptureArchive?.addEventListener("click", clearPendingCaptureArchive);
  elements.resetResultBatch.addEventListener("click", () => resetResultBatch(true));
  for (const control of [elements.resultBatchSize, elements.resultFloorFilter, elements.resultBatchMode]) {
    control.addEventListener("change", () => {
      const key = control === elements.resultBatchSize
        ? "result-batch-size"
        : control === elements.resultFloorFilter
          ? "result-floor-filter"
          : "result-batch-mode";
      storageSet(`${STORAGE_PREFIX}:${key}`, control.value);
      state.autoResultState = nextAutoResultState(state.autoResultState, null, { missesBeforeHidden: 0 });
      renderResultBatchSummary();
    });
    control.addEventListener("input", () => {
      if (control === elements.resultFloorFilter) {
        storageSet(`${STORAGE_PREFIX}:result-floor-filter`, control.value);
      }
      renderResultBatchSummary();
    });
  }
  elements.autoTrackResults.addEventListener("change", () => {
    storageSet(`${STORAGE_PREFIX}:auto-track-results`, elements.autoTrackResults.checked ? "1" : "0");
    if (elements.autoTrackResults.checked && state.autoResultState.visible) {
      // Lifecycle-only scans may already have observed this screen while table
      // tracking was off. Re-arm it so enabling the toggle can still commit the
      // currently visible, stable final interface.
      state.autoResultState.handled = false;
      state.autoResultState.stable = 0;
      state.resultStableTiming = { key: "", since: 0 };
      state.lastAutoResultScan = 0;
    } else if (!elements.autoTrackResults.checked) {
      // Do not disarm the results lifecycle: it keeps RPM/floor transitions
      // correct even when the user does not want rows added automatically.
      state.autoResultState.handled = false;
    }
  });
  elements.autoSaveMapPng.addEventListener("change", () => {
    storageSet(`${STORAGE_PREFIX}:auto-save-map-png`, elements.autoSaveMapPng.checked ? "1" : "0");
  });
  elements.autoSaveResultsPng.addEventListener("change", () => {
    storageSet(`${STORAGE_PREFIX}:auto-save-results-png`, elements.autoSaveResultsPng.checked ? "1" : "0");
  });
  elements.showCapture.addEventListener("change", render);
  elements.showGrid.addEventListener("change", render);
  elements.rpmOnly.addEventListener("change", render);
  elements.gameOverlay.addEventListener("change", renderGameOverlay);
  if (elements.statsPosition) {
    elements.statsPosition.addEventListener("change", () => {
      storageSet(`${STORAGE_PREFIX}:stats-position`, elements.statsPosition.value);
      applyStatsFreeVisibility();
      clearGameOverlay();
      renderGameOverlay();
    });
  }
  if (elements.statsFreeX) {
    elements.statsFreeX.addEventListener("change", () => setStatsFree(elements.statsFreeX.value, state.statsFree.y));
  }
  if (elements.statsFreeY) {
    elements.statsFreeY.addEventListener("change", () => setStatsFree(state.statsFree.x, elements.statsFreeY.value));
  }
  if (elements.statsPlace) elements.statsPlace.addEventListener("click", beginStatsPlacement);
  onAlt1Event("alt1pressed", onAlt1Pressed);
  for (const button of elements.statsFreeNudge) {
    button.addEventListener("click", () => {
      const step = 10;
      const dir = button.dataset.statsNudge;
      const dx = dir === "left" ? -step : dir === "right" ? step : 0;
      const dy = dir === "up" ? -step : dir === "down" ? step : 0;
      // Moving to a free spot implies the free mode; switch to it so the nudge shows.
      if (elements.statsPosition && elements.statsPosition.value !== "free") {
        elements.statsPosition.value = "free";
        storageSet(`${STORAGE_PREFIX}:stats-position`, "free");
        applyStatsFreeVisibility();
      }
      setStatsFree(state.statsFree.x + dx, state.statsFree.y + dy);
    });
  }
  if (elements.paceIndicator) {
    elements.paceIndicator.addEventListener("change", () => {
      storageSet(`${STORAGE_PREFIX}:pace-indicator`, elements.paceIndicator.checked ? "1" : "");
      updateStats();
      renderGameOverlay();
    });
  }
  if (elements.paceTarget) {
    elements.paceTarget.addEventListener("change", () => {
      // Normalize the field so the user sees the effective target (e.g. "6.15"
      // becomes "06:15", and a bare "6" falls back to the default clock).
      const seconds = parseFloorTargetSeconds(elements.paceTarget.value, DEFAULT_FLOOR_TARGET_SECONDS);
      elements.paceTarget.value = formatElapsedClock(seconds);
      storageSet(`${STORAGE_PREFIX}:pace-target`, elements.paceTarget.value);
      updateStats();
      renderGameOverlay();
    });
  }
  elements.testOverlay.addEventListener("click", testGameOverlay);
  window.addEventListener("beforeunload", () => {
    clearGameOverlay();
    teamSync.disconnect(false);
  });
  onAlt1Event("permissionchanged", updateInstallLink);
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
    state.roomWanted = true;
    state.roomStatusHint = null;
    elements.teamRoom.value = createRoomCode();
    elements.teamRoom.value = teamSync.connect(
      elements.teamRoom.value, elements.teamName.value, undefined, { create: true },
    );
    renderRoomStatus();
  });
  elements.teamJoin.addEventListener("click", () => {
    clearRemoteTeamState();
    state.roomWanted = true;
    state.roomStatusHint = null;
    elements.teamRoom.value = teamSync.connect(elements.teamRoom.value, elements.teamName.value);
    renderRoomStatus();
  });
  elements.teamDisconnect.addEventListener("click", () => {
    state.roomWanted = false;
    state.roomStatusHint = null;
    teamSync.disconnect();
    state.syncedLocalGatestones.clear();
    clearRemoteTeamState();
    renderRoomStatus();
  });
  elements.partyScan.addEventListener("click", () => scanPartyInterface({ manual: true, forceFull: true }));
  elements.partyForget.addEventListener("click", forgetParty);
  elements.partyInterface.addEventListener("change", () => {
    // Persist the opt-in/out first so both branches save it across a restart.
    storageSet(`${STORAGE_PREFIX}:party-interface`, elements.partyInterface.checked ? "1" : "");
    if (!elements.partyInterface.checked) {
      state.partyAutoScan = false;
      state.partyPanel = null;
      elements.partyScanStatus.textContent = state.observedParty.length
        ? `RuneScape party positions disabled; cached ${state.observedParty.length} names`
        : "RuneScape party positions disabled; using team join order";
      renderParty();
      render();
      // Drop a stale party-derived room hint, but keep team-sync error facts.
      if (state.roomStatusHint?.tone !== "error") state.roomStatusHint = null;
      renderRoomStatus();
      return;
    }
    elements.partyScanStatus.textContent = state.observedParty.length
      ? `Using ${state.observedParty.length} cached party names; scanning for updates`
      : "Open the DG party interface to scan its player order";
    scanPartyInterface({ manual: true, forceFull: true });
  });
  if (elements.experimentalFeatures) {
    elements.experimentalFeatures.addEventListener("change", () => {
      applyExperimentalState();
      storageSet(`${STORAGE_PREFIX}:experimental`, elements.experimentalFeatures.checked ? "1" : "");
      if (state.experimentalEnabled) {
        elements.partyScanStatus.textContent = "Party tracking on — open the DG party interface in game";
        renderRoomStatus();
        scanPartyInterface({ manual: true });
      }
    });
  }
  if (elements.experimentalAutoRoom) {
    elements.experimentalAutoRoom.addEventListener("change", () => {
      storageSet(`${STORAGE_PREFIX}:auto-room`, elements.experimentalAutoRoom.checked ? "1" : "");
      // Recompute the hint from the current party for both states — the unchecked
      // branch of maybeAutoJoinFromParty already refreshes the idle hint itself.
      maybeAutoJoinFromParty();
    });
  }
  if (elements.debugMode) {
    elements.debugMode.addEventListener("change", () => {
      storageSet(`${STORAGE_PREFIX}:debug`, elements.debugMode.checked ? "1" : "");
      if (!elements.debugMode.checked) clearPartyDebugOverlay();
    });
  }
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
  teamSync.addEventListener("status", (event) => {
    elements.teamStatus.textContent = event.detail;
    renderRoomStatus();
  });
  teamSync.addEventListener("connected", () => {
    state.roomWanted = true;
    state.roomStatusHint = null;
    sendTeamSnapshot();
    renderRoomStatus();
  });
  teamSync.addEventListener("disconnected", () => {
    state.syncedLocalGatestones.clear();
    clearRemoteTeamState();
    // An unexpected drop (we still wanted the room) reads as a lost connection;
    // a deliberate disconnect / kick / full-room clears roomWanted first so this
    // does not overwrite their more specific reason.
    if (state.roomWanted) {
      state.roomStatusHint = { message: "Room connection lost — rescan or press Join to rejoin", tone: "error" };
    }
    state.roomWanted = false;
    renderRoomStatus();
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
    renderRoomStatus();
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
  teamSync.addEventListener("full", () => {
    clearTeamGatestones();
    // The relay rejected us and is about to drop the socket; show why instead of
    // a generic "connection lost", and stop roomWanted from overriding it.
    state.roomWanted = false;
    state.roomStatusHint = { message: `Room ${teamSync.roomCode} is full (5/5) — not joined`, tone: "error" };
    renderRoomStatus();
  });
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
    state.roomWanted = false;
    state.roomStatusHint = { message: "Removed from the room", tone: "error" };
    renderRoomStatus();
    render();
  });
}

async function scanLoop() {
  await scanOnce();
  setTimeout(scanLoop, captureCadence(SCAN_INTERVAL));
}

async function resultsScanLoop() {
  try {
    const sentinel = await probeDungeonResultsSentinel();
    const shouldForceRead = Boolean(sentinel.rising)
      || (Boolean(sentinel.present)
        && Boolean(elements.autoTrackResults.checked)
        && !state.autoResultState?.handled);
    await autoCaptureDungeonResults({ forceScan: shouldForceRead });
  } catch (error) {
    if (elements.debugMode?.checked) {
      setStatus(`Results scan loop recovered from: ${error.message || error}`, "warn");
    }
  } finally {
    setTimeout(resultsScanLoop, captureCadence(RESULTS_SENTINEL_CADENCE_MS));
  }
}

async function partyScanLoop() {
  try {
    if (state.experimentalEnabled && elements.partyInterface.checked && state.partyAutoScan
      && Date.now() - state.lastPartyScan >= PARTY_SCAN_INTERVAL) {
      await scanPartyInterface();
    }
  } catch (error) {
    // Never let a scan error kill the loop.
    if (elements.debugMode?.checked) elements.partyScanStatus.textContent = `Party scan loop error: ${error.message || error}`;
  }
  setTimeout(partyScanLoop, 1000);
}

function applyExperimentalState() {
  state.experimentalEnabled = Boolean(elements.experimentalFeatures?.checked);
  if (elements.experimentalTools) elements.experimentalTools.hidden = !state.experimentalEnabled;
  // Arm continuous party tracking while experimental is on; the scan loop only
  // acts when the DG interface is actually on screen.
  state.partyAutoScan = state.experimentalEnabled && Boolean(elements.partyInterface?.checked);
}

// Load the RuneScape chatbox font for the sprite-anchor party reader once Alt1's
// OCR runtime is ready. Failure is non-fatal: the divider reader still works.
async function initPartyOcrFont() {
  try {
    if (window.__dungeonsOcrReady) await window.__dungeonsOcrReady;
  } catch {
    // OCR bundle load failed; loadChatboxFont will just return null below.
  }
  // Retry a few times: the Alt1 OCR globals can attach a moment after the
  // bundle scripts resolve.
  for (let attempt = 0; attempt < 5 && !state.chatboxFont; attempt += 1) {
    try {
      state.chatboxFont = await loadChatboxFont(window);
    } catch {
      state.chatboxFont = null;
    }
    if (!state.chatboxFont) await new Promise((resolve) => setTimeout(resolve, 800));
  }
  if (state.experimentalEnabled && elements.partyScanStatus) {
    elements.partyScanStatus.textContent = state.chatboxFont
      ? "Chatbox OCR font ready — scan the DG party"
      : "Chatbox OCR font unavailable; party names use a fallback font";
  }
}

async function scanOnce() {
  if (!state.autoScan || state.busy) return;
  if (state.calibration) {
    if (!calibrationMatchesLinkedClient(state.calibration)) {
      clearCalibration();
      setStatus("RuneScape client size changed — detecting map position and scale again", "warn");
    } else {
      await updateMap();
      return;
    }
  }
  if (Date.now() - state.lastCalibrationAttempt >= AUTO_CALIBRATION_INTERVAL) {
    await calibrate({ silent: true });
  }
}

function restoreResultSettings() {
  for (const [element, key] of [
    [elements.autoTrackResults, "auto-track-results"],
    [elements.autoSaveMapPng, "auto-save-map-png"],
    [elements.autoSaveResultsPng, "auto-save-results-png"],
  ]) {
    const saved = storageGet(`${STORAGE_PREFIX}:${key}`);
    if (saved !== null) element.checked = saved === "1";
  }
  const savedBatchSize = storageGet(`${STORAGE_PREFIX}:result-batch-size`);
  if (savedBatchSize !== null) elements.resultBatchSize.value = normalizeResultBatchTarget(savedBatchSize);
  const savedFilter = storageGet(`${STORAGE_PREFIX}:result-floor-filter`);
  if (savedFilter !== null) elements.resultFloorFilter.value = savedFilter;
  const savedMode = storageGet(`${STORAGE_PREFIX}:result-batch-mode`);
  if (savedMode && [...elements.resultBatchMode.options].some((option) => option.value === savedMode)) {
    elements.resultBatchMode.value = savedMode;
  }
}

function initialize() {
  state.saveFolders.hostWriteUnsupported = knownAlt1FolderWritesUnsupported(window);
  ensureCaptureArchiveControls();
  bindEvents();
  restoreResultSettings();
  updateAllSaveFolderStatuses();
  refreshStoredSaveFolders();
  state.captureArchive.restorePromise = restorePendingCaptureArchive();
  renderResults();
  renderParty();
  drawEmptyState();
  updateStats();
  updateInterfaceScaleStatus();
  // Restore the saved in-game stats overlay position and free coordinates. Its
  // physical size follows the automatically detected RuneScape interface scale.
  if (elements.statsPosition) {
    const savedStatsPosition = storageGet(`${STORAGE_PREFIX}:stats-position`);
    if (savedStatsPosition && [...elements.statsPosition.options].some((option) => option.value === savedStatsPosition)) {
      elements.statsPosition.value = savedStatsPosition;
    }
  }
  try {
    const savedFree = JSON.parse(storageGet(`${STORAGE_PREFIX}:stats-free`) || "null");
    if (savedFree && Number.isFinite(savedFree.x) && Number.isFinite(savedFree.y)) {
      state.statsFree = { x: Math.max(0, Math.round(savedFree.x)), y: Math.max(0, Math.round(savedFree.y)) };
    }
  } catch { /* keep the default free position */ }
  if (elements.statsFreeX) elements.statsFreeX.value = state.statsFree.x;
  if (elements.statsFreeY) elements.statsFreeY.value = state.statsFree.y;
  applyStatsFreeVisibility();
  // Restore the floor-pace indicator settings (defaults on / 6:15).
  if (elements.paceIndicator) {
    const savedPace = storageGet(`${STORAGE_PREFIX}:pace-indicator`);
    if (savedPace !== null) elements.paceIndicator.checked = savedPace === "1";
  }
  if (elements.paceTarget) {
    const savedTarget = storageGet(`${STORAGE_PREFIX}:pace-target`);
    if (savedTarget) elements.paceTarget.value = savedTarget;
  }
  // Restore the experimental opt-ins (all default off) before first render.
  if (elements.experimentalFeatures) elements.experimentalFeatures.checked = storageGet(`${STORAGE_PREFIX}:experimental`) === "1";
  if (elements.experimentalAutoRoom) elements.experimentalAutoRoom.checked = storageGet(`${STORAGE_PREFIX}:auto-room`) === "1";
  if (elements.debugMode) elements.debugMode.checked = storageGet(`${STORAGE_PREFIX}:debug`) === "1";
  // The party-interface opt-out must survive a restart. The !== null guard keeps
  // the default-checked markup on a fresh install (nothing stored yet).
  const savedPartyInterface = storageGet(`${STORAGE_PREFIX}:party-interface`);
  if (savedPartyInterface !== null && elements.partyInterface) elements.partyInterface.checked = savedPartyInterface === "1";
  applyExperimentalState();
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
  updateInstallLink();
  if (hasAlt1()) {
    try {
      identifyApp();
      updateInstallLink();
    } catch {
      // Alt1 identification is useful for permissions, but it must not block the UI.
    }
    // Show the running app build next to the Alt1 version so a stale CEF cache
    // is immediately visible (the displayed version must match the latest deploy).
    const appBuild = window.__dungeonsVersion ? ` · app ${window.__dungeonsVersion}` : "";
    elements.environment.textContent = `Alt1 ${window.alt1.version || ""}${appBuild}`.trim();
    initPartyOcrFont();
    if (state.calibration) setStatus(`Loading saved ${state.calibration.floor.name} calibration…`);
    else setStatus("Waiting for a Dungeoneering map to appear…", "warn");
  } else {
    elements.environment.textContent = "Browser preview";
    setStatus("Open this app in Alt1; a browser cannot read RuneScape pixels", "warn");
  }
  updateOverlayStatus();
  scanLoop();
  resultsScanLoop();
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
