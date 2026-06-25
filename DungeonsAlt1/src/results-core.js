export const RESULT_COLUMNS = Object.freeze([
  "Timestamp", "Time", "Floor", "FloorXP", "PrestigeXP", "BaseXP", "FloorSize", "SizeMod",
  "BonusMod", "DifficultyMod", "LevelMod", "FloorXPBoost", "TotalMod", "FinalXP", "Roomcount", "DeadEnds",
]);

export const RESULT_BATCH_MODES = Object.freeze({
  Lock: "lock",
  Reset: "reset",
});

export const RESULT_THEME_RANGES = Object.freeze({
  frozen: [[1, 11]],
  abandoned: [[12, 17], [30, 35]],
  abandoned1: [[12, 17]],
  abandoned2: [[30, 35]],
  furnished: [[18, 29]],
  occult: [[36, 47]],
  warped: [[48, 60]],
});

const RESULT_ID_COLUMNS = RESULT_COLUMNS.filter((column) => column !== "Timestamp");

export function resultFingerprint(result) {
  if (!result || typeof result !== "object") return "";
  return RESULT_ID_COLUMNS.map((column) => String(result[column] ?? "").trim()).join("\u001f");
}

export function nextAutoResultState(previous, result) {
  if (!result) return { visible: false, key: "", handled: false, shouldAdd: false };
  const key = resultFingerprint(result);
  const visible = Boolean(previous?.visible);
  const handled = visible ? Boolean(previous?.handled) : false;
  const shouldAdd = Boolean(key) && !handled;
  return {
    visible: true,
    key,
    handled: handled || shouldAdd,
    shouldAdd,
  };
}

export function plannedResultExports({ autoSaveMap = false, autoSaveResults = false, hasMap = false, hasResultsOffset = false } = {}) {
  const exports = [];
  if (autoSaveMap && hasMap) exports.push("map");
  if (autoSaveResults && hasResultsOffset) exports.push("results");
  return exports;
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
  const tokens = query.split(/[,\s]+/).map(normalizeFilterToken).filter(Boolean);
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
    const themeRanges = RESULT_THEME_RANGES[token];
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
