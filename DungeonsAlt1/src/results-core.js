export const RESULT_COLUMNS = Object.freeze([
  "Timestamp", "Time", "Floor", "FloorXP", "PrestigeXP", "BaseXP", "FloorSize", "SizeMod",
  "BonusMod", "DifficultyMod", "LevelMod", "FloorXPBoost", "TotalMod", "FinalXP", "Roomcount", "DeadEnds",
]);

export const RESULT_BATCH_MODES = Object.freeze({
  Lock: "lock",
  Reset: "reset",
});

// The on-screen floor-tracking table shows a compact, glanceable subset led by a
// per-floor number. The full XP breakdown stays in every result object and in the
// "Copy table" export (RESULT_COLUMNS); this only controls what the table renders.
export const RESULT_DISPLAY_COLUMNS = Object.freeze([
  { header: "#", field: "#" },
  { header: "Floor", field: "Floor" },
  { header: "Time", field: "Time" },
  { header: "Bonus %", field: "BonusMod" },
  // "Size" shows the in-game difficulty ratio (the team size the floor was
  // scaled for, e.g. 5:5 or 1:1), which the winterface reads into DifficultyMod.
  { header: "Size", field: "DifficultyMod" },
  { header: "Rooms", field: "Roomcount" },
  { header: "Dead ends", field: "DeadEnds" },
  { header: "Final XP", field: "FinalXP" },
]);

// Group whole-number counts (e.g. Final XP "259036" -> "259,036"); leave anything
// that is not a plain integer untouched (blank reads, already-formatted values).
export function formatResultCount(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text).toLocaleString("en-US") : text;
}

// The stored Timestamp is a full locale date-time; the table only needs the clock
// time. Pull HH:MM (keeping AM/PM when present); fall back to the raw string.
export function formatResultWhen(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/(\d{1,2}:\d{2})(?::\d{2})?\s*([AP]\.?M\.?)?/i);
  return match ? `${match[1]}${match[2] ? ` ${match[2].toUpperCase().replace(/\./g, "")}` : ""}` : text;
}

export function resultDisplayValue(result, field, number) {
  switch (field) {
    case "#": return number == null ? "" : String(number);
    case "Timestamp": return formatResultWhen(result?.Timestamp);
    case "FinalXP": return formatResultCount(result?.FinalXP);
    default: return String(result?.[field] ?? "");
  }
}

// The table reads top-to-bottom in play order (oldest floor = #1), independent of
// the newest-first storage order used everywhere else.
export function orderedResultsForDisplay(results = []) {
  return (Array.isArray(results) ? results : []).slice().reverse();
}

export const RESULT_THEME_RANGES = Object.freeze({
  frozen: [[1, 11]],
  abandoned: [[12, 17], [30, 35]],
  abandoned1: [[12, 17]],
  abandoned2: [[30, 35]],
  furnished: [[18, 29]],
  occult: [[36, 47]],
  warped: [[48, 60]],
});

// A result's identity excludes values that change while the same results screen
// remains visible. Timestamp changes on every read, Time keeps ticking, and
// Roomcount/DeadEnds come from the live map. Including any of them lets one
// physical completion screen acquire multiple fingerprints and be saved twice.
const RESULT_VOLATILE_COLUMNS = new Set(["Timestamp", "Time", "Roomcount", "DeadEnds"]);
const RESULT_ID_COLUMNS = RESULT_COLUMNS.filter((column) => !RESULT_VOLATILE_COLUMNS.has(column));
export const AUTO_RESULT_MISSES_BEFORE_HIDDEN = 2;
// The Dungeoneering results screen animates its XP counters up after it opens
// (and they jump to final the instant the player presses skip). Capturing on
// the first sighting therefore reads half-counted, non-final numbers. Require
// the winterface OCR to read identically across this many consecutive scans
// before committing, so every value is final regardless of whether the player
// waited out the animation or skipped it.
export const AUTO_RESULT_STABLE_SCANS = 3;

export function resultFingerprint(result) {
  if (!result || typeof result !== "object") return "";
  return RESULT_ID_COLUMNS.map((column) => String(result[column] ?? "").trim()).join("\u001f");
}

export function resultStabilityKey(result) {
  return resultFingerprint(result);
}

// The pre-skip completion screen matches the winterface marker with every field
// empty; an all-empty read is stable and used to be committed (early PNG with no
// values). Only a screen carrying both the floor number and the final XP counts.
export function resultLooksComplete(result) {
  return Boolean(String(result?.Floor ?? "").trim()) && Boolean(String(result?.FinalXP ?? "").trim());
}

export function resultAlreadyRecorded(results = [], result) {
  const key = resultFingerprint(result);
  return Boolean(key) && (results ?? []).some((candidate) => resultFingerprint(candidate) === key);
}

export function nextAutoResultState(previous, result, {
  missesBeforeHidden = AUTO_RESULT_MISSES_BEFORE_HIDDEN,
  stableScansRequired = AUTO_RESULT_STABLE_SCANS,
} = {}) {
  if (!result) {
    const visible = Boolean(previous?.visible);
    const threshold = Math.max(0, Number(missesBeforeHidden) || 0);
    const missing = visible ? (Math.max(0, Number(previous?.missing) || 0) + 1) : 0;
    if (visible && missing < threshold) {
      // A one-off missed read is OCR noise, not the screen closing: keep the
      // stability progress so a single dropped frame does not restart the wait.
      return {
        visible: true,
        key: previous?.key ?? "",
        handled: Boolean(previous?.handled),
        missing,
        stable: Math.max(0, Number(previous?.stable) || 0),
        shouldAdd: false,
      };
    }
    return { visible: false, key: "", handled: false, missing: 0, stable: 0, shouldAdd: false };
  }
  if (!resultLooksComplete(result)) {
    // The empty pre-skip completion screen reads identically every scan, so it
    // used to satisfy the stability gate and commit a blank PNG. Count it as
    // visible so the miss counter does not tear down state, but never accumulate
    // stability and never add. Preserve handled so an already-committed screen
    // followed by a transiently-empty OCR read does not re-arm.
    return {
      visible: true,
      key: "",
      handled: Boolean(previous?.visible) && Boolean(previous?.handled),
      missing: 0,
      stable: 0,
      shouldAdd: false,
    };
  }
  const key = resultStabilityKey(result);
  const required = Math.max(1, Number(stableScansRequired) || 1);
  if (Boolean(previous?.visible) && Boolean(previous?.handled)) {
    // Already committed this screen; ignore every further read (including OCR
    // jitter that changes the fingerprint) until the screen disappears.
    return { visible: true, key, handled: true, missing: 0, stable: required, shouldAdd: false };
  }
  // Count how many consecutive scans produced this exact reading. The counter
  // only advances while the value holds steady, so a still-animating screen
  // keeps resetting to 1 and is never added mid-count.
  const sameAsPrevious = Boolean(previous?.visible) && Boolean(key) && previous?.key === key;
  const stable = sameAsPrevious ? Math.max(1, Number(previous?.stable) || 0) + 1 : 1;
  const shouldAdd = Boolean(key) && stable >= required;
  return {
    visible: true,
    key,
    handled: shouldAdd,
    missing: 0,
    stable,
    shouldAdd,
  };
}

export function plannedResultExports({ autoSaveMap = false, autoSaveResults = false, hasMap = false, hasResultsOffset = false } = {}) {
  const exports = [];
  if (autoSaveMap && hasMap) exports.push("map");
  if (autoSaveResults && hasResultsOffset) exports.push("results");
  return exports;
}

export function resultCaptureRect(capture) {
  const offset = capture?.rawOffset ?? capture?.sourceOffset ?? capture?.offset;
  const width = Number(capture?.rawWidth ?? capture?.sourceWidth ?? capture?.width);
  const height = Number(capture?.rawHeight ?? capture?.sourceHeight ?? capture?.height);
  const x = Number(offset?.x);
  const y = Number(offset?.y);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  return {
    offset: { x: Math.round(x), y: Math.round(y) },
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function resultMapSnapshotIsFresh(capture, {
  currentMapReadAt = 0,
  currentFloorName = "",
  lastConsumedAt = 0,
  hasMap = false,
  maxAgeMs = 15_000,
} = {}) {
  const capturedAt = capture?.date instanceof Date ? capture.date.getTime() : Number.NaN;
  const mapReadAt = Number(capture?.mapReadAt || 0);
  const mapAgeMs = capturedAt - mapReadAt;
  return Boolean(hasMap)
    && mapReadAt > Number(lastConsumedAt || 0)
    && mapReadAt === Number(currentMapReadAt || 0)
    && capture?.mapFloorName === currentFloorName
    && capture?.mapFloorName === capture?.result?.FloorSize
    && Number.isFinite(mapAgeMs)
    && mapAgeMs >= 0
    && mapAgeMs <= Math.max(0, Number(maxAgeMs) || 0);
}

export function parseResultTimeSeconds(value) {
  const parts = String(value ?? "").trim().split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  const seconds = parts.pop();
  const minutes = parts.pop();
  const hours = parts.pop() ?? 0;
  if (seconds > 59 || minutes > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatResultDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function averageResultTime(results = []) {
  const times = results.map((result) => parseResultTimeSeconds(result?.Time)).filter((value) => value !== null);
  if (!times.length) return null;
  return times.reduce((sum, value) => sum + value, 0) / times.length;
}

function floorInRanges(floor, ranges) {
  return ranges.some(([from, to]) => floor >= from && floor <= to);
}

function normalizeFilterToken(token) {
  return String(token ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function resultMatchesFloorFilter(result, filter = "") {
  const query = String(filter ?? "").trim();
  if (!query || /^(all|\*)$/i.test(query)) return true;
  const floor = Number.parseInt(result?.Floor, 10);
  const size = String(result?.FloorSize ?? "").trim().toLowerCase();
  // Keep the hyphen intact here (trim + lowercase only): normalizeFilterToken
  // strips hyphens, which would turn a "1-11" range into "111" and stop the
  // range regex below from ever matching. Theme aliases apply it individually.
  const tokens = query.split(/[,\s]+/).map((token) => String(token ?? "").trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;

  for (const token of tokens) {
    const range = /^(\d{1,2})-(\d{1,2})$/.exec(token);
    if (range && Number.isFinite(floor)) {
      const from = Number.parseInt(range[1], 10);
      const to = Number.parseInt(range[2], 10);
      if (floor >= Math.min(from, to) && floor <= Math.max(from, to)) return true;
      continue;
    }
    if (/^\d{1,2}$/.test(token) && Number.parseInt(token, 10) === floor) return true;
    const themeRanges = RESULT_THEME_RANGES[normalizeFilterToken(token)];
    if (themeRanges && Number.isFinite(floor) && floorInRanges(floor, themeRanges)) return true;
    if (["small", "medium", "large"].includes(token) && token === size) return true;
  }
  return false;
}

export function normalizeResultBatchTarget(value) {
  const target = Number.parseInt(value, 10);
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(target, 999);
}

export function resultBatchIsComplete(results = [], target = 0) {
  const normalizedTarget = normalizeResultBatchTarget(target);
  return normalizedTarget > 0 && results.length >= normalizedTarget;
}

export function resultBatchStatus(results = [], { target = 0, filter = "" } = {}) {
  const normalizedTarget = normalizeResultBatchTarget(target);
  const average = averageResultTime(results);
  const averageText = formatResultDuration(average);
  const count = results.length;
  const targetText = normalizedTarget > 0 ? `${count}/${normalizedTarget}` : `${count}`;
  const filterText = String(filter ?? "").trim() || "all";
  return {
    count,
    target: normalizedTarget,
    complete: resultBatchIsComplete(results, normalizedTarget),
    averageSeconds: average,
    averageText,
    summary: `Batch ${targetText} floors | avg ${averageText} | filter ${filterText}`,
  };
}

export function safeTimestampForFilename(date = new Date()) {
  const value = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date();
  return value.toISOString().replace(/:/g, "-").slice(0, 19);
}

export function safeFilePart(value, fallback = "unknown") {
  const cleaned = String(value ?? "").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return cleaned || fallback;
}
