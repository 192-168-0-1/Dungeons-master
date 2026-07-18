import { resultLooksComplete, resultStabilityKey } from "./results-core.js?v=20260718-39";
import { WINTERFACE_HEIGHT, WINTERFACE_WIDTH } from "./winterface.js?v=20260718-39";

export const RESULT_CAPTURE_PADDING = 4;
export const RESULT_EVIDENCE_MIN_FRESH_MS = 2000;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// A remembered Winterface rectangle is client-relative. Validate it before a
// targeted capture so a RuneScape resize or a stale/corrupt saved rectangle can
// never make Alt1 request pixels outside the linked client.
export function resultCaptureTarget(source, {
  clientWidth,
  clientHeight,
  dimensionTolerance = 2,
  padding = RESULT_CAPTURE_PADDING,
} = {}) {
  const width = finitePositive(source?.width);
  const height = finitePositive(source?.height);
  const scale = finitePositive(source?.scale);
  const x = Number(source?.x);
  const y = Number(source?.y);
  const rsWidth = finitePositive(clientWidth);
  const rsHeight = finitePositive(clientHeight);
  if (![x, y].every(Number.isFinite) || !width || !height || !scale || !rsWidth || !rsHeight) return null;

  const rememberedClientWidth = finitePositive(source?.clientWidth);
  const rememberedClientHeight = finitePositive(source?.clientHeight);
  if ((rememberedClientWidth && Math.round(rememberedClientWidth) !== Math.round(rsWidth))
    || (rememberedClientHeight && Math.round(rememberedClientHeight) !== Math.round(rsHeight))) return null;

  const tolerance = Math.max(0, Number(dimensionTolerance) || 0);
  const expectedWidth = Math.round(WINTERFACE_WIDTH * scale);
  const expectedHeight = Math.round(WINTERFACE_HEIGHT * scale);
  if (Math.abs(Math.round(width) - expectedWidth) > tolerance
    || Math.abs(Math.round(height) - expectedHeight) > tolerance) return null;

  const sourceX = Math.round(x);
  const sourceY = Math.round(y);
  const sourceWidth = Math.round(width);
  const sourceHeight = Math.round(height);
  if (sourceX < 0 || sourceY < 0
    || sourceX + sourceWidth > Math.round(rsWidth)
    || sourceY + sourceHeight > Math.round(rsHeight)) return null;

  const margin = Math.max(0, Math.ceil((Number(padding) || 0) * scale));
  const targetX = Math.max(0, sourceX - margin);
  const targetY = Math.max(0, sourceY - margin);
  const targetRight = Math.min(Math.round(rsWidth), sourceX + sourceWidth + margin);
  const targetBottom = Math.min(Math.round(rsHeight), sourceY + sourceHeight + margin);
  return {
    x: targetX,
    y: targetY,
    width: targetRight - targetX,
    height: targetBottom - targetY,
    scale,
  };
}

export function globalResultMarkerSource(localRect, target, {
  clientWidth,
  clientHeight,
  scale = null,
} = {}) {
  const x = Number(localRect?.offset?.x);
  const y = Number(localRect?.offset?.y);
  const width = finitePositive(localRect?.width);
  const height = finitePositive(localRect?.height);
  const originX = Number(target?.x);
  const originY = Number(target?.y);
  const resolvedScale = finitePositive(scale) || finitePositive(target?.scale);
  if (![x, y, originX, originY].every(Number.isFinite)
    || !width || !height || !resolvedScale) return null;
  return {
    x: Math.round(originX + x),
    y: Math.round(originY + y),
    width: Math.round(width),
    height: Math.round(height),
    scale: resolvedScale,
    clientWidth: Math.max(0, Math.round(Number(clientWidth) || 0)),
    clientHeight: Math.max(0, Math.round(Number(clientHeight) || 0)),
  };
}

export function captureEvidenceIsFresh(lastSeenAt, now = Date.now(), captureIntervalMs = 0, {
  minimumMs = RESULT_EVIDENCE_MIN_FRESH_MS,
  intervalMultiplier = 3,
} = {}) {
  const seenAt = Number(lastSeenAt);
  const timestamp = Number(now);
  if (!Number.isFinite(seenAt) || seenAt <= 0 || !Number.isFinite(timestamp) || timestamp < seenAt) return false;
  const interval = Math.max(0, Number(captureIntervalMs) || 0);
  const maximumAge = Math.max(0, Number(minimumMs) || 0, interval * Math.max(0, Number(intervalMultiplier) || 0));
  return timestamp - seenAt <= maximumAge;
}

// FloorSize is supplied by the live map context rather than the Winterface OCR
// whenever a map is available. Exclude it from physical-screen retirement so a
// newly detected Small/Large map cannot make the same stale results pixels look
// like a different result screen.
export function resultRetirementKey(result) {
  if (!result || typeof result !== "object") return "";
  return resultStabilityKey({ ...result, FloorSize: "" });
}

// Automatic tracking treats a targeted, complete OCR result as authoritative.
// An incomplete marker is only a lifecycle observation when the independent
// small sentinel probe was also freshly positive. A retired result remains
// ignored until two targeted live misses confirm that physical screen closed;
// OCR field changes are not a trustworthy screen epoch.
export function resultLifecycleObservation(result, {
  sentinelPositive = false,
  retired = false,
  retiredKey = "",
  confirmedMissing = false,
} = {}) {
  if (!result) {
    if (retired && !confirmedMissing) {
      return {
        observable: false,
        complete: false,
        key: "",
        retired: true,
        retiredKey: String(retiredKey || ""),
      };
    }
    return {
      observable: false,
      complete: false,
      key: "",
      retired: false,
      retiredKey: "",
    };
  }
  const complete = resultLooksComplete(result);
  // Keep an identity for incomplete panels as well. Its empty-field separator
  // sequence lets a later completed (therefore changed) real result escape a
  // retired stale pre-skip frame without weakening resultLooksComplete.
  const key = resultRetirementKey(result);
  if (retired) {
    return { observable: false, complete, key, retired: true, retiredKey: String(retiredKey || "") };
  }
  return {
    observable: Boolean(complete || sentinelPositive),
    complete,
    key,
    retired: false,
    retiredKey: "",
  };
}
