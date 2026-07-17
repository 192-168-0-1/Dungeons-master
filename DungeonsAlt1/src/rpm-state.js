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

function openedRoomType(type) {
  const value = Number(type) || 0;
  return value > 0 && (value & 16) === 0;
}

// A falling room count alone is not proof of a new floor: one noisy capture can
// simply stop recognising part of the existing map. A real same-size/same-base
// floor normally introduces rooms/door topology that did not exist in the last
// accepted map, whereas a classifier dip is a subset of that map. Keep this
// deliberately conservative; the authoritative results lifecycle, map gap,
// floor-size and base-position routes remain available when topology overlaps.
export function mapTopologyDiscontinuity(previousMap, nextMap) {
  const previousTypes = previousMap?.roomTypes;
  const nextTypes = nextMap?.roomTypes;
  if (!Array.isArray(previousTypes) || !Array.isArray(nextTypes)
    || !previousTypes.length || previousTypes.length !== nextTypes.length) return false;
  let novel = 0;
  let shared = 0;
  let changed = 0;
  const identityMask = 1 | 2 | 4 | 8 | 32 | 64 | 128;
  for (let index = 0; index < nextTypes.length; index += 1) {
    const beforeOpen = openedRoomType(previousTypes[index]);
    const afterOpen = openedRoomType(nextTypes[index]);
    if (afterOpen && !beforeOpen) novel += 1;
    if (afterOpen && beforeOpen) {
      shared += 1;
      if ((Number(previousTypes[index]) & identityMask) !== (Number(nextTypes[index]) & identityMask)) changed += 1;
    }
  }
  return novel >= 2
    || (novel >= 1 && changed >= 1)
    || (shared >= 2 && changed >= Math.max(2, Math.ceil(shared * 0.6)));
}

const PENDING_STREAK_MAX_GAP_MS = 2_000;
const ROOM_REGRESSION_CONFIRM_MS = 2_500;

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
    case "room-regression": return "confirmed-room-regression";
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
  const rawSingleBaseAfterProgress = lastRoomCount > 1 && openedRoomCount === 1 && Boolean(gameMap.base);
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
  const rawRoomCountDropped = lastRoomCount > 1 && openedRoomCount > 0
    && openedRoomCount < lastRoomCount
    && (lastRoomCount - openedRoomCount) >= Math.max(2, Math.ceil(lastRoomCount / 2));
  const pending = previous.pendingReset ?? null;
  // A real same-size floor can start at 5 rooms before an 8-room previous floor
  // has produced either a one-room frame or a different base marker. That is
  // too small a collapse for the fast two-frame route above, but losing at
  // least two rooms and retaining no more than 75% of the accepted count is
  // still meaningful evidence when it persists. Unlike roomCountDropped this
  // weaker signal is deliberately time-gated below.
  const rawRoomRegression = lastRoomCount > 1 && openedRoomCount > 0
    && lastRoomCount - openedRoomCount >= 2
    && openedRoomCount <= lastRoomCount * 0.75;
  const mapGapMs = Math.max(0, Number(previous.mapGapMs) || 0);
  const topologyChanged = mapTopologyDiscontinuity(previous.lastGameMap, gameMap);
  const scaleChanged = Boolean(previous.scaleChanged);
  const mapGapSupportsRegression = mapGapMs >= 2_000 && (!scaleChanged || topologyChanged);
  // The exact one-room base frame is the desktop counter's strongest fallback
  // when a short results/loading phase was missed. Keep its two-frame gate.
  // Broader count collapses require independent topology or map-gap evidence.
  const singleBaseAfterProgress = rawSingleBaseAfterProgress;
  const roomCountDropped = rawRoomCountDropped && (topologyChanged || mapGapSupportsRegression);
  const roomRegression = rawRoomRegression && topologyChanged;
  // After a real capture gap, a smaller-but-not-quite-half room count is still
  // strong floor-change evidence. Requiring a >=2 room loss, <=75% of the old
  // count and the normal two-frame confirmation keeps a brief read miss from
  // resetting an active floor.
  const gapRoomRegression = (mapGapMs >= 2_000 || pending?.reason === "map-gap-regression")
    && (!scaleChanged || topologyChanged)
    && lastRoomCount - openedRoomCount >= 2
    && openedRoomCount > 0
    && openedRoomCount <= lastRoomCount * 0.75;
  const candidateReason = floorChanged
    ? "floor-change"
    : gapRoomRegression
      ? "map-gap-regression"
      : baseChanged
        ? "base-change"
        : singleBaseAfterProgress
          ? "single-base"
          : (roomCountDropped || roomRegression)
            ? "room-regression"
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
    || baseChanged || singleBaseAfterProgress || roomCountDropped || roomRegression;

  // A results screen proves that a new floor is expected, but the map behind it
  // can still be the old completed map. Hold
  // an otherwise-identical map instead of accepting or immediately resetting
  // it. A genuine same-identity new floor confirms once its room count advances
  // at least two beyond both the first candidate frame and the old floor; a
  // one/two-room classifier dip recovering to the old count cannot satisfy it.
  const lifecyclePending = pending?.reason === "results-lifecycle";
  // Unlike the generic gap-regression heuristic, this lifecycle candidate is
  // not a reset by itself, so it can arm even when DirectX/OpenGL kept the old
  // map readable behind the results interface and no capture gap was observed.
  const lifecycleArmed = Boolean(previous.awaitingNewFloor);
  // While the results interface is still visible, lifecycle evidence outranks
  // every map heuristic: Desktop capture can keep a noisy old map behind it.
  // Once that interface is gone, however, a stable floor-size or base change is
  // direct new-floor identity evidence. Let the normal two-frame gate confirm
  // it instead of waiting for two additional rooms to open.
  const lifecycleHardIdentityChange = !previous.resultsScreenVisible
    && (floorChanged || baseChanged);
  if ((lifecyclePending || lifecycleArmed) && !lifecycleHardIdentityChange) {
    const lifecycleLastSeenAt = Number(pending?.seenAt);
    const lifecycleContinuous = lifecyclePending && Number.isFinite(lifecycleLastSeenAt)
      && timestamp - lifecycleLastSeenAt <= 2_000;
    let firstSeenAt = lifecycleContinuous && Number(pending?.firstSeenAt) > 0
      ? Number(pending.firstSeenAt)
      : timestamp;
    const hasLifecycleFirstCount = pending?.firstOpenedRoomCount !== null
      && pending?.firstOpenedRoomCount !== undefined
      && Number.isFinite(Number(pending.firstOpenedRoomCount));
    let firstRoomCount = lifecycleContinuous && hasLifecycleFirstCount
      ? Math.max(0, Number(pending.firstOpenedRoomCount))
      : openedRoomCount;
    // Once the results interface has actually disappeared, a lower same-size,
    // same-base read is the new floor's baseline rather than progress from the
    // old completed map that may have armed the latch. Rebase the paired
    // timestamp/count and require two rooms of subsequent progress.
    if (lifecycleContinuous && samePending && !previous.resultsScreenVisible
      && openedRoomCount < firstRoomCount) {
      firstSeenAt = timestamp;
      firstRoomCount = openedRoomCount;
    }
    const lifecycleBaselineClearlyLower = firstRoomCount <= Math.max(5, Math.floor(lastRoomCount * 0.75));
    const lifecycleProgressed = lifecycleContinuous && samePending
      && !previous.resultsScreenVisible
      && openedRoomCount >= firstRoomCount + 2
      // A shallow classifier dip (15 -> 13 -> 15) is not a new floor. A true
      // low baseline may confirm on +2 progress; a shallow baseline must first
      // progress beyond the old accepted count.
      && (lifecycleBaselineClearlyLower || openedRoomCount > lastRoomCount);
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

  if (samePending && pending?.reason === "single-base"
    && recentEnough && plausibleSingleBase) {
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

  if (candidateReason !== "room-regression" && samePending && pending?.reason === candidateReason
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

  // Bounded escape valve for count-only evidence and a jittering base. A key
  // that moves every frame can never pass the normal two-frame gate, while a
  // same-size/same-base 8 -> 5 floor does not reach the half-collapse trigger.
  // In both cases a continuously refreshed regression may reset after 2.5s;
  // recovery to the accepted count clears the pending candidate before then.
  const streakLastSeen = Number(pending?.seenAt);
  const elapsedSincePending = timestamp - streakLastSeen;
  // The capture owner retains pendingReset while pixels are unavailable and
  // supplies the measured mapGapMs on the first readable frame. Use both the
  // previous candidate timestamp and reason explicitly: a <=2s capture gap may
  // bridge the scan interval around that gap, but a stale/different candidate
  // cannot be revived just because a later capture also happened to be lost.
  const shortCaptureGap = mapGapMs > 0 && mapGapMs <= PENDING_STREAK_MAX_GAP_MS
    && elapsedSincePending <= mapGapMs + PENDING_STREAK_MAX_GAP_MS;
  const streakAlive = pending?.reason === candidateReason
    && Number.isFinite(streakLastSeen) && streakLastSeen > 0
    && elapsedSincePending >= 0
    && (elapsedSincePending <= PENDING_STREAK_MAX_GAP_MS || shortCaptureGap);
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
  if (roomRegression && streakAlive && Number.isFinite(streakStart) && streakStart > 0
    && timestamp - streakStart >= ROOM_REGRESSION_CONFIRM_MS) {
    return {
      accept: true,
      reset: true,
      pendingReset: null,
      resetAt: hasFirstPendingFrame ? streakStart : resetAt,
      resetRoomCount: hasFirstPendingFrame ? firstOpenedRoomCount : resetRoomCount,
      reason: roomCountDropped ? "confirmed-room-collapse" : "confirmed-room-regression",
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
