export const FLOOR_START_OFFSET_MS = 2000;
export const MIN_RPM_MINUTES = 1 / 60;

export function floorStartForDetectedMap(now = Date.now()) {
  const timestamp = Number(now);
  return (Number.isFinite(timestamp) ? timestamp : Date.now()) - FLOOR_START_OFFSET_MS;
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
  if (!gameMap) {
    return {
      accept: false,
      reset: false,
      pendingReset: previous.pendingReset ?? null,
      reason: "missing-map",
    };
  }

  const floorStart = Number(previous.floorStart) || 0;
  if (!floorStart) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      reason: "first-map",
    };
  }

  const lastRoomCount = Math.max(0, Number(previous.lastRoomCount) || 0);
  const openedRoomCount = Math.max(0, Number(gameMap.openedRoomCount) || 0);
  const baseChanged = Boolean(previous.lastBase && gameMap.base && !samePoint(previous.lastBase, gameMap.base));
  const singleBaseAfterProgress = lastRoomCount > 1 && openedRoomCount === 1 && Boolean(gameMap.base);
  const key = resetCandidateKey(gameMap, calibration);
  const pending = previous.pendingReset ?? null;
  const samePending = Boolean(key && pending?.key === key);
  const pendingRoomCount = Math.max(0, Number(pending?.openedRoomCount) || 0);
  const confirmationWindowMs = 10_000;
  const recentEnough = !Number.isFinite(Number(pending?.seenAt))
    || Number(now) - Number(pending.seenAt) <= confirmationWindowMs;
  const plausibleSingleBase = openedRoomCount <= Math.max(5, pendingRoomCount + 3);

  if (samePending && pending?.reason === "single-base" && recentEnough && plausibleSingleBase) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      reason: "confirmed-single-base",
    };
  }

  if (!baseChanged && !singleBaseAfterProgress) {
    return {
      accept: true,
      reset: false,
      pendingReset: null,
      reason: "same-floor",
    };
  }

  const plausibleResetCandidate = !singleBaseAfterProgress || plausibleSingleBase;

  if (samePending && recentEnough && plausibleResetCandidate) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      reason: baseChanged ? "confirmed-base-change" : "confirmed-single-base",
    };
  }

  return {
    accept: false,
    reset: false,
    pendingReset: {
      key,
      openedRoomCount,
      base: gameMap.base ? { x: gameMap.base.x, y: gameMap.base.y } : null,
      seenAt: Number(now) || Date.now(),
      reason: baseChanged ? "base-change" : "single-base",
    },
    reason: baseChanged ? "pending-base-change" : "pending-single-base",
  };
}
