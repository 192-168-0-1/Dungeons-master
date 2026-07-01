export const FLOOR_START_OFFSET_MS = 2000;
export const MIN_RPM_MINUTES = 1 / 60;
export const MAX_RESET_RPM = 8;

export function floorStartForDetectedMap(now = Date.now(), openedRooms = 1) {
  const timestamp = Number(now);
  const roomCount = Math.max(0, Number(openedRooms) || 0);
  const minimumElapsedByRooms = roomCount > 1
    ? ((Math.max(0, roomCount - 0.8) / MAX_RESET_RPM) * 60_000)
    : 0;
  return (Number.isFinite(timestamp) ? timestamp : Date.now()) - Math.max(FLOOR_START_OFFSET_MS, minimumElapsedByRooms);
}

export function elapsedFloorMinutes(floorStart, now = Date.now()) {
  const start = Number(floorStart);
  const timestamp = Number(now);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(timestamp)) return 0;
  return Math.max((timestamp - start) / 60_000, MIN_RPM_MINUTES);
}

export function elapsedFloorSeconds(floorStart, now = Date.now()) {
  const start = Number(floorStart);
  const timestamp = Number(now);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((timestamp - start) / 1000));
}

export function formatElapsedClock(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export function rpmValue(rooms = 0, minutes = 0) {
  const roomCount = Math.max(0, Number(rooms) || 0);
  const elapsedMinutes = Math.max(Number(minutes) || 0, MIN_RPM_MINUTES);
  return Math.max(0, (roomCount - 0.8) / elapsedMinutes).toFixed(1);
}

// Target floor time for the on-pace indicator. 6:15 by default (the user's
// benchmark); PACE_CLOSE_RATIO is how far over target still counts as "close".
export const DEFAULT_FLOOR_TARGET_SECONDS = 375;
export const PACE_CLOSE_RATIO = 1.2;

export function parseFloorTargetSeconds(value, fallback = DEFAULT_FLOOR_TARGET_SECONDS) {
  const text = String(value ?? "").trim();
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  return fallback;
}

// Subtle pace signal for the RPM display: projecting the current room-opening
// rate onto the whole currently-known floor (opened + still-visible mystery
// rooms), would it finish within the target floor time? Returns a status the UI
// tints the rpm with: "ahead" (on/under target), "close" (a little over),
// "behind" (well over), or "none" when there is not enough data yet.
export function floorPaceStatus({ openedRooms = 0, possibleRooms = 0, minutes = 0, targetSeconds = DEFAULT_FLOOR_TARGET_SECONDS } = {}) {
  const opened = Math.max(0, Number(openedRooms) || 0);
  const possible = Math.max(opened, Number(possibleRooms) || 0);
  const elapsed = Math.max(0, Number(minutes) || 0);
  const targetMinutes = Math.max(0, Number(targetSeconds) || 0) / 60;
  if (opened < 2 || elapsed < MIN_RPM_MINUTES * 2 || targetMinutes <= 0) {
    return { status: "none", ratio: 0, projectedSeconds: 0 };
  }
  const projectedMinutes = elapsed * (possible / opened);
  const ratio = projectedMinutes / targetMinutes;
  const status = ratio <= 1 ? "ahead" : ratio <= PACE_CLOSE_RATIO ? "close" : "behind";
  return { status, ratio, projectedSeconds: Math.round(projectedMinutes * 60) };
}

function samePoint(left, right) {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function resetCandidateKey(gameMap, calibration) {
  if (!gameMap?.base || !calibration) return "";
  return [
    calibration.floor?.name ?? "",
    Math.round(Number(calibration.x) || 0),
    Math.round(Number(calibration.y) || 0),
    gameMap.base.x,
    gameMap.base.y,
  ].join(":");
}

export function evaluateMapTransition(previous = {}, gameMap, calibration, now = Date.now()) {
  const timestamp = Number(now) || Date.now();
  if (!gameMap) {
    return {
      accept: false,
      reset: false,
      pendingReset: previous.pendingReset ?? null,
      resetAt: null,
      reason: "missing-map",
    };
  }

  const floorStart = Number(previous.floorStart) || 0;
  if (!floorStart) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt: timestamp,
      reason: "first-map",
    };
  }

  const lastRoomCount = Math.max(0, Number(previous.lastRoomCount) || 0);
  const openedRoomCount = Math.max(0, Number(gameMap.openedRoomCount) || 0);
  const baseChanged = Boolean(previous.lastBase && gameMap.base && !samePoint(previous.lastBase, gameMap.base));
  const singleBaseAfterProgress = lastRoomCount > 1 && openedRoomCount === 1 && Boolean(gameMap.base);
  // A new floor is entered with just the base room. On a slow/jittery scanner
  // the exact 1-room frame is often missed and the first clean read already
  // shows a few rooms, so when the new floor reuses the same base grid cell as
  // the previous one neither baseChanged nor singleBaseAfterProgress fires and
  // the timer is never reset (stale floorStart -> impossibly low rpm). Treat a
  // large collapse in the room count (you do not lose half your rooms except at
  // a floor change) as another reset trigger. The C# reference only needed
  // openedRoomCount===1 because its detection reliably caught that frame. This
  // is confirmed through the same two-frame gate below, so a single misread
  // cannot reset the timer.
  const roomCountDropped = lastRoomCount > 1 && openedRoomCount > 0
    && openedRoomCount < lastRoomCount
    && (lastRoomCount - openedRoomCount) >= Math.max(2, Math.ceil(lastRoomCount / 2));
  const key = resetCandidateKey(gameMap, calibration);
  const pending = previous.pendingReset ?? null;
  const samePending = Boolean(key && pending?.key === key);
  const pendingRoomCount = Math.max(0, Number(pending?.openedRoomCount) || 0);
  const pendingSeenAt = Number(pending?.seenAt);
  const resetAt = Number.isFinite(pendingSeenAt) && pendingSeenAt > 0 ? pendingSeenAt : timestamp;
  const confirmationWindowMs = 10_000;
  const recentEnough = !Number.isFinite(Number(pending?.seenAt))
    || timestamp - Number(pending.seenAt) <= confirmationWindowMs;
  const plausibleSingleBase = openedRoomCount <= Math.max(5, pendingRoomCount + 3);

  if (samePending && pending?.reason === "single-base" && recentEnough && plausibleSingleBase) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt,
      reason: "confirmed-single-base",
    };
  }

  if (!baseChanged && !singleBaseAfterProgress && !roomCountDropped) {
    return {
      accept: true,
      reset: false,
      pendingReset: null,
      resetAt: null,
      reason: "same-floor",
    };
  }

  const plausibleResetCandidate = !singleBaseAfterProgress || plausibleSingleBase;

  if (samePending && recentEnough && plausibleResetCandidate) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt,
      reason: baseChanged ? "confirmed-base-change" : "confirmed-single-base",
    };
  }

  return {
    accept: false,
    reset: false,
    resetAt: null,
    pendingReset: {
      key,
      openedRoomCount,
      base: gameMap.base ? { x: gameMap.base.x, y: gameMap.base.y } : null,
      seenAt: timestamp,
      reason: baseChanged ? "base-change" : "single-base",
    },
    reason: baseChanged ? "pending-base-change" : "pending-single-base",
  };
}
