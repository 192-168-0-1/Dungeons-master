export const WINTERFACE_WIDTH = 512;
export const WINTERFACE_HEIGHT = 334;
const DEFAULT_OFFSET = { x: 710, y: 330 };
const ASSET_ROOT = new URL("../assets/winterface/", import.meta.url);
const MIN_INTERFACE_SCALE = 1;
const MAX_INTERFACE_SCALE = 2;
const INTERFACE_SCALE_STEP = 0.05;
const SCALED_MARKER_MAX_SCORE = 600;
const HINTED_MARKER_TRUST_SCORE = 150;
const SCALED_MARKER_MAX_PROBE_SCORE = 5_000;
const SCALED_GLYPH_FOREGROUND_DISTANCE = 40_000;
const SCALED_GLYPH_BACKGROUND_DISTANCE = 2_000;
const HINT_SCAN_POSITION_BUDGET = 1_000_000;
const FALLBACK_SCAN_POSITION_BUDGET = 100_000;
const PRESENCE_SCAN_POSITION_BUDGET = 50_000;
const MAX_COARSE_CANDIDATES = 24;
const MAX_REFINE_RADIUS = 6;

const FONT_FILES = Object.freeze({
  Base: [...Array(10)].map((_, index) => [`${index}`, `Base${index}.png`]),
  Small: [
    ...[...Array(10)].map((_, index) => [`${index}`, `Small${index}.png`]),
    ["+", "SmallPlus.png"],
    ["-", "SmallMinus.png"],
    [":", "SmallColon.png"],
  ],
  Large: [
    ...[...Array(10)].map((_, index) => [`${index}`, `Large${index}.png`]),
    ["", "LargeComma.png"],
  ],
});

const FIELDS = Object.freeze([
  { name: "Time", font: "Small", color: [255, 255, 255], y: 308, startX: 28 },
  { name: "Floor", font: "Base", color: [198, 155, 1], y: 56, startX: 78 },
  { name: "FloorXP", font: "Base", color: [226, 226, 162], y: 70, startX: 47 },
  { name: "PrestigeXP", font: "Base", color: [226, 226, 162], y: 70, startX: 147 },
  { name: "BaseXP", font: "Base", color: [226, 226, 162], y: 70, startX: 247 },
  { name: "SizeMod", font: "Small", color: [226, 226, 162], y: 120, startX: 295 },
  { name: "DifficultyMod", font: "Small", color: [226, 226, 162], y: 162, startX: 156 },
  { name: "LevelMod", font: "Small", color: [226, 226, 162], y: 162, startX: 298 },
  { name: "FloorXPBoost", font: "Small", color: [226, 226, 162], y: 184, startX: 298 },
  { name: "TotalMod", font: "Base", color: [226, 226, 162], y: 236, startX: 126 },
  { name: "FinalXP", font: "Large", color: [226, 226, 162], y: 271, startX: 116 },
]);

function pixelIndex(image, x, y) {
  return (y * image.width + x) * 4;
}

function sameRgb(image, index, color) {
  return image.data[index] === color[0]
    && image.data[index + 1] === color[1]
    && image.data[index + 2] === color[2];
}

function colorDistanceAt(image, index, color) {
  const dr = image.data[index] - color[0];
  const dg = image.data[index + 1] - color[1];
  const db = image.data[index + 2] - color[2];
  return dr * dr + dg * dg + db * db;
}

async function loadImageData(fileName) {
  const image = new Image();
  image.src = new URL(fileName, ASSET_ROOT).href;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function templateMatchesExactly(image, template, offsetX, offsetY) {
  if (offsetX < 0 || offsetY < 0 || offsetX + template.width > image.width || offsetY + template.height > image.height) return false;
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      const source = pixelIndex(template, x, y);
      const target = pixelIndex(image, offsetX + x, offsetY + y);
      if (template.data[source] !== image.data[target]
        || template.data[source + 1] !== image.data[target + 1]
        || template.data[source + 2] !== image.data[target + 2]) return false;
    }
  }
  return true;
}

function templateAnchorsMatch(image, template, offsetX, offsetY, anchors) {
  for (const [x, y] of anchors) {
    const source = pixelIndex(template, x, y);
    const target = pixelIndex(image, offsetX + x, offsetY + y);
    if (template.data[source] !== image.data[target]
      || template.data[source + 1] !== image.data[target + 1]
      || template.data[source + 2] !== image.data[target + 2]) return false;
  }
  return true;
}

function findTemplateExactly(image, template) {
  const defaultCropFits = DEFAULT_OFFSET.x + WINTERFACE_WIDTH <= image.width
    && DEFAULT_OFFSET.y + WINTERFACE_HEIGHT <= image.height;
  if (defaultCropFits && templateMatchesExactly(image, template, DEFAULT_OFFSET.x, DEFAULT_OFFSET.y)) return DEFAULT_OFFSET;
  const anchors = [
    [0, 0],
    [template.width - 1, 0],
    [0, template.height - 1],
    [template.width - 1, template.height - 1],
    [Math.floor(template.width / 2), Math.floor(template.height / 2)],
  ];
  const maxX = image.width - WINTERFACE_WIDTH;
  const maxY = image.height - WINTERFACE_HEIGHT;
  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= maxX; x += 1) {
      if (templateAnchorsMatch(image, template, x, y, anchors)
        && templateMatchesExactly(image, template, x, y)) return { x, y };
    }
  }
  return null;
}

function normalizeScale(value) {
  let scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (scale > 10) scale /= 100;
  if (scale < MIN_INTERFACE_SCALE || scale > MAX_INTERFACE_SCALE) return null;
  return scale;
}

function scaleKey(scale) {
  return Number(scale).toFixed(4);
}

function fallbackInterfaceScales(scaleHint) {
  const result = [];
  const seen = new Set();
  const hinted = normalizeScale(scaleHint);
  if (hinted) {
    seen.add(scaleKey(hinted));
    result.push({ scale: hinted, hinted: true });
  }
  const steps = Math.round((MAX_INTERFACE_SCALE - MIN_INTERFACE_SCALE) / INTERFACE_SCALE_STEP);
  for (let index = 0; index <= steps; index += 1) {
    const scale = Number((MIN_INTERFACE_SCALE + index * INTERFACE_SCALE_STEP).toFixed(2));
    const key = scaleKey(scale);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ scale, hinted: false });
  }
  return result;
}

function scaledInterfaceDimensions(scale) {
  return {
    width: Math.round(WINTERFACE_WIDTH * scale),
    height: Math.round(WINTERFACE_HEIGHT * scale),
  };
}

function sourceCoordinate(offset, coordinate, scale, limit) {
  return Math.min(limit - 1, offset + Math.floor((coordinate + 0.5) * scale));
}

function markerPixelDistance(image, template, offsetX, offsetY, x, y, scale) {
  const templateIndex = pixelIndex(template, x, y);
  const targetX = sourceCoordinate(offsetX, x, scale, image.width);
  const targetY = sourceCoordinate(offsetY, y, scale, image.height);
  const imageIndex = pixelIndex(image, targetX, targetY);
  const red = image.data[imageIndex] - template.data[templateIndex];
  const green = image.data[imageIndex + 1] - template.data[templateIndex + 1];
  const blue = image.data[imageIndex + 2] - template.data[templateIndex + 2];
  return red * red + green * green + blue * blue;
}

function markerProbes(template) {
  const points = [
    [0, 0],
    [template.width - 1, 0],
    [0, template.height - 1],
    [template.width - 1, template.height - 1],
    [Math.floor(template.width / 2), Math.floor(template.height / 2)],
    [Math.floor(template.width / 4), Math.floor(template.height / 3)],
    [Math.floor(template.width * 3 / 4), Math.floor(template.height / 3)],
    [Math.floor(template.width / 4), Math.floor(template.height * 2 / 3)],
    [Math.floor(template.width * 3 / 4), Math.floor(template.height * 2 / 3)],
  ];
  let brightest = { x: 0, y: 0, value: -1 };
  let darkest = { x: 0, y: 0, value: Number.POSITIVE_INFINITY };
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      const index = pixelIndex(template, x, y);
      const value = template.data[index] + template.data[index + 1] + template.data[index + 2];
      if (value > brightest.value) brightest = { x, y, value };
      if (value < darkest.value) darkest = { x, y, value };
    }
  }
  points.push([brightest.x, brightest.y], [darkest.x, darkest.y]);
  const unique = new Map();
  for (const point of points) unique.set(`${point[0]}:${point[1]}`, point);
  return [...unique.values()];
}

function markerScore(image, template, offsetX, offsetY, scale, probes = null, maximumMean = Number.POSITIVE_INFINITY) {
  const points = probes || null;
  let total = 0;
  let count = 0;
  const expectedCount = points ? points.length : template.width * template.height;
  const maximumTotal = maximumMean * expectedCount;
  if (points) {
    for (const [x, y] of points) {
      total += markerPixelDistance(image, template, offsetX, offsetY, x, y, scale);
      count += 1;
      if (total > maximumTotal) return Number.POSITIVE_INFINITY;
    }
  } else {
    for (let y = 0; y < template.height; y += 1) {
      for (let x = 0; x < template.width; x += 1) {
        total += markerPixelDistance(image, template, offsetX, offsetY, x, y, scale);
        count += 1;
        if (total > maximumTotal) return Number.POSITIVE_INFINITY;
      }
    }
  }
  return count ? total / count : Number.POSITIVE_INFINITY;
}

function rememberCoarseCandidate(candidates, candidate) {
  if (candidates.length < MAX_COARSE_CANDIDATES) {
    candidates.push(candidate);
    candidates.sort((left, right) => left.score - right.score);
    return;
  }
  if (candidate.score >= candidates[candidates.length - 1].score) return;
  candidates[candidates.length - 1] = candidate;
  candidates.sort((left, right) => left.score - right.score);
}

function searchScaledTemplate(image, template, scale, probes, positionBudget) {
  const dimensions = scaledInterfaceDimensions(scale);
  const maxX = image.width - dimensions.width;
  const maxY = image.height - dimensions.height;
  if (maxX < 0 || maxY < 0) return null;

  const positions = (maxX + 1) * (maxY + 1);
  const stride = Math.max(1, Math.ceil(Math.sqrt(positions / Math.max(1, positionBudget))));
  const coarse = [];
  const addAt = (x, y) => {
    if (x < 0 || y < 0 || x > maxX || y > maxY) return;
    rememberCoarseCandidate(coarse, { x, y, score: markerScore(image, template, x, y, scale, probes) });
  };

  addAt(DEFAULT_OFFSET.x, DEFAULT_OFFSET.y);
  addAt(Math.round((image.width - dimensions.width) / 2), Math.round((image.height - dimensions.height) / 2));
  for (let y = 0; y <= maxY; y += stride) {
    for (let x = 0; x <= maxX; x += stride) addAt(x, y);
    if (maxX % stride) addAt(maxX, y);
  }
  if (maxY % stride) {
    for (let x = 0; x <= maxX; x += stride) addAt(x, maxY);
    addAt(maxX, maxY);
  }

  if (!coarse.length || coarse[0].score > SCALED_MARKER_MAX_PROBE_SCORE) return null;
  let best = null;
  const checked = new Set();
  const radius = Math.min(MAX_REFINE_RADIUS, stride);
  for (const candidate of coarse) {
    for (let y = Math.max(0, candidate.y - radius); y <= Math.min(maxY, candidate.y + radius); y += 1) {
      for (let x = Math.max(0, candidate.x - radius); x <= Math.min(maxX, candidate.x + radius); x += 1) {
        const key = `${x}:${y}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const maximum = best ? Math.min(SCALED_MARKER_MAX_SCORE, best.score) : SCALED_MARKER_MAX_SCORE;
        const score = markerScore(image, template, x, y, scale, null, maximum);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
  }
  if (!best || best.score > SCALED_MARKER_MAX_SCORE) return null;
  return {
    x: best.x,
    y: best.y,
    width: dimensions.width,
    height: dimensions.height,
    scale,
    score: best.score,
    tolerant: true,
  };
}

function findTemplate(image, template, scaleHint, allowScaleFallback = true, trustScaleHint = false) {
  // Keep the original exact 100% path first when 100% is plausible. Apart from
  // avoiding interpolation, it is much stricter than the scaled matcher and
  // cannot turn a legacy exact capture into a tolerant false positive.
  // With a measured non-100% hint a full 100%-pixel sweep cannot succeed and is
  // expensive on large clients, so go straight to the hinted scaled matcher.
  const hintedScale = normalizeScale(scaleHint);
  const exact = (!hintedScale || hintedScale === 1) ? findTemplateExactly(image, template) : null;
  if (exact) {
    return {
      x: exact.x,
      y: exact.y,
      width: WINTERFACE_WIDTH,
      height: WINTERFACE_HEIGHT,
      scale: 1,
      score: 0,
      tolerant: false,
    };
  }

  const probes = markerProbes(template);
  let best = null;
  for (const candidate of fallbackInterfaceScales(scaleHint)) {
    if (!candidate.hinted && hintedScale && !allowScaleFallback) continue;
    const match = searchScaledTemplate(
      image,
      template,
      candidate.scale,
      probes,
      candidate.hinted ? HINT_SCAN_POSITION_BUDGET : FALLBACK_SCAN_POSITION_BUDGET,
    );
    if (!match) continue;
    if (candidate.hinted) {
      if (match.score <= HINTED_MARKER_TRUST_SCORE) return match;
      if (!allowScaleFallback) return trustScaleHint ? match : null;
      best = match;
      continue;
    }
    if (!best || match.score < best.score) best = match;
  }
  return best;
}

function findTemplatePresence(image, template, scaleHint, previousSource = null) {
  const scale = normalizeScale(scaleHint);
  if (!scale) return null;
  const dimensions = scaledInterfaceDimensions(scale);
  const priorX = Number(previousSource?.x);
  const priorY = Number(previousSource?.y);
  if (Number.isFinite(priorX) && Number.isFinite(priorY)
    && priorX >= 0 && priorY >= 0
    && priorX + dimensions.width <= image.width
    && priorY + dimensions.height <= image.height) {
    const score = markerScore(image, template, priorX, priorY, scale, null, SCALED_MARKER_MAX_SCORE);
    if (score <= SCALED_MARKER_MAX_SCORE) {
      return {
        x: priorX, y: priorY, width: dimensions.width, height: dimensions.height,
        scale, score, tolerant: scale !== 1 || score > 0,
      };
    }
  }
  // Presence polling only needs the marker, not eleven OCR fields. Search one
  // already pixel-confirmed interface scale with a much smaller coarse budget;
  // the normal reader performs the exhaustive fallback after a hit.
  const probes = markerProbes(template);
  return searchScaledTemplate(image, template, scale, probes, PRESENCE_SCAN_POSITION_BUDGET);
}

function normalizeInterfaceRegion(image, source) {
  const data = new Uint8ClampedArray(WINTERFACE_WIDTH * WINTERFACE_HEIGHT * 4);
  const xRatio = source.width / WINTERFACE_WIDTH;
  const yRatio = source.height / WINTERFACE_HEIGHT;
  for (let y = 0; y < WINTERFACE_HEIGHT; y += 1) {
    const sourceY = source.y + Math.min(source.height - 1, Math.floor((y + 0.5) * yRatio));
    for (let x = 0; x < WINTERFACE_WIDTH; x += 1) {
      const sourceX = source.x + Math.min(source.width - 1, Math.floor((x + 0.5) * xRatio));
      const from = pixelIndex(image, sourceX, sourceY);
      const to = (y * WINTERFACE_WIDTH + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  if (typeof ImageData === "function") return new ImageData(data, WINTERFACE_WIDTH, WINTERFACE_HEIGHT);
  return { width: WINTERFACE_WIDTH, height: WINTERFACE_HEIGHT, data };
}

function glyphMatches(image, glyph, offsetX, offsetY, color, tolerance = 20, backgroundTolerance = 0) {
  if (offsetX < 0 || offsetY < 0 || offsetX + glyph.width > image.width || offsetY + glyph.height > image.height) return false;
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const glyphIndex = pixelIndex(glyph, x, y);
      const imageIndex = pixelIndex(image, offsetX + x, offsetY + y);
      const opaque = glyph.data[glyphIndex + 3] === 255;
      const distance = colorDistanceAt(image, imageIndex, color);
      if ((opaque && distance > tolerance)
        || (!opaque && (backgroundTolerance > 0 ? distance <= backgroundTolerance : sameRgb(image, imageIndex, color)))) return false;
    }
  }
  return true;
}

function findFieldStart(image, offset, field, glyphs, tolerant = false) {
  if (tolerant) {
    for (let x = field.startX; x < field.startX + 50; x += 1) {
      const absoluteX = offset.x + x;
      const absoluteY = offset.y + field.y;
      if (glyphs.some((glyph) => glyphMatches(
        image,
        glyph.image,
        absoluteX,
        absoluteY,
        field.color,
        SCALED_GLYPH_FOREGROUND_DISTANCE,
        SCALED_GLYPH_BACKGROUND_DISTANCE,
      ))) return absoluteX;
    }
    return -1;
  }
  const height = glyphs[0].image.height;
  for (let x = field.startX; x < field.startX + 50; x += 1) {
    for (let y = field.y; y < field.y + height; y += 1) {
      if (sameRgb(image, pixelIndex(image, offset.x + x, offset.y + y), field.color)) return offset.x + x;
    }
  }
  return -1;
}

function readField(image, offset, field, fonts, tolerant = false) {
  const glyphs = fonts[field.font];
  let x = findFieldStart(image, offset, field, glyphs, tolerant);
  if (x < 0) return "";
  let value = "";
  for (let guard = 0; guard < 20; guard += 1) {
    const match = glyphs.find((glyph) => glyphMatches(
      image,
      glyph.image,
      x,
      offset.y + field.y,
      field.color,
      tolerant ? SCALED_GLYPH_FOREGROUND_DISTANCE : 20,
      tolerant ? SCALED_GLYPH_BACKGROUND_DISTANCE : 0,
    ));
    if (!match) break;
    value += match.value;
    x += match.image.width;
  }
  return value;
}

function readBonus(image, offset) {
  const y = offset.y + 146;
  const begin = 115;
  const end = 295;
  const passes = (x) => image.data[pixelIndex(image, offset.x + x, y)] >= 142;
  if (!passes(begin + 1)) return 0;
  if (passes(end - 1)) return 1;
  let low = begin;
  let high = end;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (passes(middle)) low = middle;
    else high = middle;
  }
  return (low - begin + 1) / (end - begin);
}

// RuneScape's "Dungeon Size" XP modifier text is not a reliable size signal:
// the value has changed over time (a Large floor reads "+500%" today, not the
// historic "+850%" the C# reference hard-coded), and it can vary by context.
// The live map geometry (152x152 Small / 152x280 Medium / 280x280 Large) is
// unambiguous, so prefer the floor size detected during calibration and only
// fall back to the modifier text when no map was tracked (e.g. a manual read
// with no calibration). The fallback accepts both the current and historic
// Large modifiers so it is never worse than the original.
export function deriveFloorSize({ detected, sizeMod } = {}) {
  const name = String(detected ?? "").trim();
  if (name === "Small" || name === "Medium" || name === "Large") return name;
  const mod = String(sizeMod ?? "").trim();
  if (mod === "+850" || mod === "+500") return "Large";
  if (mod === "+350") return "Medium";
  return "Small";
}

export function deriveOcrFloorSize(sizeMod) {
  const mod = String(sizeMod ?? "").trim();
  if (mod === "+850" || mod === "+500") return "Large";
  if (mod === "+350") return "Medium";
  if (mod === "+0") return "Small";
  // Small historically meant "anything else", which is unsuitable as an
  // independent snapshot validator: a partial/noisy +500 read such as +50 must
  // be unknown, not positive evidence for Small.
  return null;
}

export class WinterfaceReader {
  constructor(marker, fonts) {
    this.marker = marker;
    this.fonts = fonts;
  }

  static async load() {
    const marker = await loadImageData("WinterfaceMarker.png");
    const fonts = {};
    for (const [fontName, files] of Object.entries(FONT_FILES)) {
      fonts[fontName] = await Promise.all(files.map(async ([value, fileName]) => ({ value, image: await loadImageData(fileName) })));
    }
    return new WinterfaceReader(marker, fonts);
  }

  locateMarker(image, { interfaceScale = 1, previousSource = null } = {}) {
    return findTemplatePresence(image, this.marker, interfaceScale, previousSource);
  }

  readWithOffset(image, extra = {}) {
    const source = findTemplate(
      image,
      this.marker,
      extra.interfaceScale,
      extra.allowScaleFallback !== false,
      Boolean(extra.trustScaleHint),
    );
    if (!source) return null;
    const tolerant = Boolean(source.tolerant);
    const ocrImage = tolerant ? normalizeInterfaceRegion(image, source) : image;
    const ocrOffset = tolerant ? { x: 0, y: 0 } : { x: source.x, y: source.y };
    const result = Object.fromEntries(FIELDS.map((field) => [field.name, readField(ocrImage, ocrOffset, field, this.fonts, tolerant)]));
    // Keep the XP-modifier-derived size separate from the geometry-derived
    // display value. The app uses this independent value to validate that a
    // frozen map snapshot belongs to the results interface; comparing two
    // fields both sourced from the same live map would be circular.
    const ocrFloorSize = deriveOcrFloorSize(result.SizeMod);
    result.FloorSize = deriveFloorSize({ detected: extra.floorSize, sizeMod: result.SizeMod });
    result.BonusMod = `${(readBonus(ocrImage, ocrOffset) * 100).toFixed(1)}%`;
    result.Roomcount = String(extra.roomcount ?? "");
    result.DeadEnds = String(extra.deadEnds ?? "");
    result.Timestamp = (extra.timestamp instanceof Date ? extra.timestamp : new Date()).toLocaleString();
    const sourceOffset = { x: source.x, y: source.y };
    return {
      result,
      // Keep the legacy crop fields pointed at the literal RuneScape pixels so
      // app.js saves a 768x501 source crop at 150%, not the normalized OCR copy.
      offset: sourceOffset,
      width: source.width,
      height: source.height,
      scale: source.scale,
      markerScore: source.score,
      sourceOffset: { ...sourceOffset },
      sourceWidth: source.width,
      sourceHeight: source.height,
      sourceScale: source.scale,
      rawOffset: { ...sourceOffset },
      rawWidth: source.width,
      rawHeight: source.height,
      rawScale: source.scale,
      ocrFloorSize,
    };
  }

  read(image, extra = {}) {
    return this.readWithOffset(image, extra)?.result ?? null;
  }
}
