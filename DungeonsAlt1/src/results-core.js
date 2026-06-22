export const RESULT_COLUMNS = Object.freeze([
  "Timestamp", "Time", "Floor", "FloorXP", "PrestigeXP", "BaseXP", "FloorSize", "SizeMod",
  "BonusMod", "DifficultyMod", "LevelMod", "FloorXPBoost", "TotalMod", "FinalXP", "Roomcount", "DeadEnds",
]);

const RESULT_ID_COLUMNS = RESULT_COLUMNS.filter((column) => column !== "Timestamp");

export function resultFingerprint(result) {
  if (!result || typeof result !== "object") return "";
  return RESULT_ID_COLUMNS.map((column) => String(result[column] ?? "").trim()).join("\u001f");
}

export function nextAutoResultState(previous, result) {
  if (!result) return { visible: false, key: "", shouldAdd: false };
  const key = resultFingerprint(result);
  const visible = Boolean(previous?.visible);
  return {
    visible: true,
    key,
    shouldAdd: Boolean(key) && (!visible || previous?.key !== key),
  };
}

export function plannedResultExports({ autoSaveMap = false, autoSaveResults = false, hasMap = false, hasResultsOffset = false } = {}) {
  const exports = [];
  if (autoSaveMap && hasMap) exports.push("map");
  if (autoSaveResults && hasResultsOffset) exports.push("results");
  return exports;
}

export function safeTimestampForFilename(date = new Date()) {
  const value = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date();
  return value.toISOString().replace(/:/g, "-").slice(0, 19);
}

export function safeFilePart(value, fallback = "unknown") {
  const cleaned = String(value ?? "").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return cleaned || fallback;
}
