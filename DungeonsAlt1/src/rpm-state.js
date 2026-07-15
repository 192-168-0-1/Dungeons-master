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
  const value = Math.floor(Math.max(0, Number(seconds) || 0));
  const mm = String(Math.floor((value % 3600) / 60)).padStart(2, "0");
  const ss = String(value % 60).padStart(2, "0");
  // Roll over into H:MM:SS past an hour instead of showing 61:01 etc.
  const hours = Math.floor(value / 3600);
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
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
  // Accept mm:ss and mm.ss/mm,ss (two second-digits required for the dot/comma
  // forms so "6.15" reads as 6:15, not 6 seconds), plus a bare seconds count but
  // only when plausible (>= 30) so a "6" or "6.5" typo falls back to the default
  // instead of becoming an absurdly small target.
  const clock = /^(\d{1,3})(?::([0-5]?\d)|[.,]([0-5]\d))$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2] ?? clock[3]);
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 30) return Math.round(seconds);
  return fallback;
}

// Subtle pace signal for the RPM display: this is dg-map's projection of
// elapsed / completion, where completion is the fraction of ALL KNOWN rooms
// visited (visited / (visited + unknown + locked)). projectedMinutes =
// elapsed * (possible / opened) is algebraically that same elapsed / completion
// — the caller widens `possible` with rooms behind doors that open onto empty
// cells. Would the floor finish within the target time? Returns a status the UI
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

// The base marker is allowed to disappear temporarily within one floor (player
// arrows and scaling can cover its probe), but a confirmed reset starts a new
// identity. In that case carrying the previous floor's base forward would make
// the new base look like a second floor change when it becomes readable later.
export function trackedBaseAfterTransition(previousBase, currentBase, didReset = false) {
  if (didReset) return currentBase ?? null;
  return currentBase ?? previousBase ?? null;
}

function confirmedReason(candidateReason) {
  switch (candidateReason) {
    case "base-change": return "confirmed-base-change";
    case "floor-change": return "confirmed-floor-change";
    case "map-gap-regression": return "confirmed-map-gap-regression";
    case "single-base":
    default: return "confirmed-single-base";
  }
}

function resetCandidateKey(gameMap, calibration) {
  if (!calibration) return "";
  // A base-less read still gets a stable key. In the first seconds of a new
  // floor the base marker is often unreadable, and an empty key made samePending
  // permanently false — the transition could then never confirm, freezing the
  // accepted map (and the rpm/stats overlay) on the PREVIOUS floor.
  return [
    calibration.floor?.name ?? "",
    Math.round(Number(calibration.x) || 0),
    Math.round(Number(calibration.y) || 0),
    gameMap?.base ? gameMap.base.x : "none",
    gameMap?.base ? gameMap.base.y : "none",
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
      resetRoomCount: null,
      reason: "missing-map",
    };
  }

  const openedRoomCount = Math.max(0, Number(gameMap.openedRoomCount) || 0);
  const floorStart = Number(previous.floorStart) || 0;
  if (!floorStart) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt: timestamp,
      resetRoomCount: openedRoomCount,
      reason: "first-map",
    };
  }

  const lastRoomCount = Math.max(0, Number(previous.lastRoomCount) || 0);
  const baseChanged = Boolean(previous.lastBase && gameMap.base && !samePoint(previous.lastBase, gameMap.base));
  const lastFloorName = String(previous.lastFloorName ?? "");
  const detectedFloorName = String(calibration?.floor?.name ?? "");
  const floorChanged = Boolean(lastFloorName && detectedFloorName && lastFloorName !== detectedFloorName);
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
  const pending = previous.pendingReset ?? null;
  const mapGapMs = Math.max(0, Number(previous.mapGapMs) || 0);
  // After a real capture gap, a smaller-but-not-quite-half room count is still
  // strong floor-change evidence. Requiring a >=2 room loss, <=75% of the old
  // count and the normal two-frame confirmation keeps a brief read miss from
  // resetting an active floor.
  const gapRoomRegression = (mapGapMs >= 2_000 || pending?.reason === "map-gap-regression")
    && lastRoomCount - openedRoomCount >= 2
    && openedRoomCount > 0
    && openedRoomCount <= lastRoomCount * 0.75;
  const candidateReason = floorChanged
    ? "floor-change"
    : gapRoomRegression
      ? "map-gap-regression"
      : baseChanged
        ? "base-change"
        : "single-base";
  const key = resetCandidateKey(gameMap, calibration);
  const samePending = Boolean(key && pending?.key === key);
  const hasPendingRoomCount = pending?.openedRoomCount !== null
    && pending?.openedRoomCount !== undefined
    && Number.isFinite(Number(pending.openedRoomCount));
  const pendingRoomCount = hasPendingRoomCount
    ? Math.max(0, Number(pending.openedRoomCount))
    : openedRoomCount;
  const pendingSeenAt = Number(pending?.seenAt);
  const hasPendingSeenAt = Number.isFinite(pendingSeenAt) && pendingSeenAt > 0;
  const hasPendingFrame = hasPendingSeenAt && hasPendingRoomCount;
  const resetAt = hasPendingFrame ? pendingSeenAt : timestamp;
  // Keep the room count paired with the frame that supplied resetAt. Combining
  // the first-seen time with a later confirmation frame's larger room count
  // backdates the timer far too much when floorStartForDetectedMap caps RPM.
  const resetRoomCount = hasPendingFrame ? pendingRoomCount : openedRoomCount;
  const confirmationWindowMs = 10_000;
  const recentEnough = !Number.isFinite(Number(pending?.seenAt))
    || timestamp - Number(pending.seenAt) <= confirmationWindowMs;
  const plausibleSingleBase = openedRoomCount <= Math.max(5, pendingRoomCount + 3);
  // The confirmation frame must itself still look like a floor change. Otherwise
  // a partial room-count misread (e.g. 12 -> 5 -> 7) that fired roomCountDropped
  // on the glitch frame would be confirmed by a recovery frame that is not a
  // reset candidate at all, spuriously resetting the timer mid-floor.
  const isResetCandidate = floorChanged || gapRoomRegression
    || baseChanged || singleBaseAfterProgress || roomCountDropped;

  // A results screen plus a real map gap proves that a new floor is expected,
  // but the first pixels after the gap can still be the old completed map. Hold
  // an otherwise-identical map instead of accepting or immediately resetting
  // it. A genuine same-identity new floor confirms once its room count advances
  // at least two beyond both the first candidate frame and the old floor; a
  // one/two-room classifier dip recovering to the old count cannot satisfy it.
  const lifecyclePending = pending?.reason === "results-lifecycle";
  // Unlike the generic gap-regression heuristic, this lifecycle candidate is
  // not a reset by itself, so even one genuinely lost frame can arm it safely.
  const lifecycleArmed = Boolean(previous.awaitingNewFloor) && mapGapMs > 0;
  if (!isResetCandidate && (lifecyclePending || lifecycleArmed)) {
    const lifecycleLastSeenAt = Number(pending?.seenAt);
    const lifecycleContinuous = lifecyclePending && Number.isFinite(lifecycleLastSeenAt)
      && timestamp - lifecycleLastSeenAt <= 2_000;
    const firstSeenAt = lifecycleContinuous && Number(pending?.firstSeenAt) > 0
      ? Number(pending.firstSeenAt)
      : timestamp;
    const hasLifecycleFirstCount = pending?.firstOpenedRoomCount !== null
      && pending?.firstOpenedRoomCount !== undefined
      && Number.isFinite(Number(pending.firstOpenedRoomCount));
    const firstRoomCount = lifecycleContinuous && hasLifecycleFirstCount
      ? Math.max(0, Number(pending.firstOpenedRoomCount))
      : openedRoomCount;
    const lifecycleProgressed = lifecycleContinuous && samePending
      && openedRoomCount >= firstRoomCount + 2
      && openedRoomCount > lastRoomCount;
    if (lifecycleProgressed) {
      return {
        accept: true,
        reset: true,
        pendingReset: null,
        resetAt: firstSeenAt,
        resetRoomCount: firstRoomCount,
        reason: "confirmed-results-lifecycle",
      };
    }
    return {
      accept: false,
      reset: false,
      resetAt: null,
      resetRoomCount: null,
      pendingReset: {
        key,
        openedRoomCount: firstRoomCount,
        base: gameMap.base ? { x: gameMap.base.x, y: gameMap.base.y } : null,
        seenAt: timestamp,
        firstSeenAt,
        firstOpenedRoomCount: firstRoomCount,
        reason: "results-lifecycle",
      },
      reason: "pending-results-lifecycle",
    };
  }

  if (samePending && pending?.reason === "single-base" && recentEnough && plausibleSingleBase && isResetCandidate) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt,
      resetRoomCount,
      reason: "confirmed-single-base",
    };
  }

  if (!isResetCandidate) {
    return {
      accept: true,
      reset: false,
      pendingReset: null,
      resetAt: null,
      resetRoomCount: null,
      reason: "same-floor",
    };
  }

  const plausibleResetCandidate = !singleBaseAfterProgress || plausibleSingleBase;

  if (samePending && pending?.reason === candidateReason
    && recentEnough && plausibleResetCandidate && isResetCandidate) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt,
      resetRoomCount,
      reason: confirmedReason(pending?.reason ?? candidateReason),
    };
  }

  // Escape valve for a jittering base: when the base cell reads differently on
  // every frame the pending key never matches twice and the two-frame gate can
  // stall indefinitely, freezing the accepted map on the previous floor. A
  // pending that has lived CONTINUOUSLY (refreshed every frame) for this long
  // while the room count stays collapsed can only be a genuinely new floor —
  // single-frame misreads resolve to same-floor within a frame and a base
  // oscillation without a count collapse never reaches this path.
  const collapseStreakMs = 2_500;
  const streakLastSeen = Number(pending?.seenAt);
  const streakAlive = pending?.reason === candidateReason
    && Number.isFinite(streakLastSeen) && timestamp - streakLastSeen <= 2_000;
  const streakStart = Number(pending?.firstSeenAt);
  const pendingFirstRoomCount = Number(pending?.firstOpenedRoomCount);
  const hasFirstPendingFrame = Number.isFinite(streakStart) && streakStart > 0
    && pending?.firstOpenedRoomCount !== null
    && pending?.firstOpenedRoomCount !== undefined
    && Number.isFinite(pendingFirstRoomCount);
  const firstOpenedRoomCount = streakAlive && streakStart > 0
    ? (hasFirstPendingFrame
      ? Math.max(0, pendingFirstRoomCount)
      : pendingRoomCount)
    : openedRoomCount;
  if (roomCountDropped && streakAlive && Number.isFinite(streakStart) && streakStart > 0
    && timestamp - streakStart >= collapseStreakMs) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt: hasFirstPendingFrame ? streakStart : resetAt,
      resetRoomCount: hasFirstPendingFrame ? firstOpenedRoomCount : resetRoomCount,
      reason: "confirmed-room-collapse",
    };
  }

  return {
    accept: false,
    reset: false,
    resetAt: null,
    resetRoomCount: null,
    pendingReset: {
      key,
      openedRoomCount,
      base: gameMap.base ? { x: gameMap.base.x, y: gameMap.base.y } : null,
      seenAt: timestamp,
      // The streak start survives key changes so the valve above can measure a
      // continuous pending; a gap (lost reads) starts a fresh streak.
      firstSeenAt: streakAlive && streakStart > 0 ? streakStart : timestamp,
      firstOpenedRoomCount,
      reason: candidateReason,
    },
    reason: `pending-${candidateReason}`,
  };
}
