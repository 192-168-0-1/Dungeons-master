export const WINTERFACE_WIDTH = 512;
export const WINTERFACE_HEIGHT = 334;
const DEFAULT_OFFSET = { x: 710, y: 330 };
const ASSET_ROOT = new URL("../assets/winterface/", import.meta.url);

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

function findTemplate(image, template) {
  if (templateMatchesExactly(image, template, DEFAULT_OFFSET.x, DEFAULT_OFFSET.y)) return DEFAULT_OFFSET;
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

function glyphMatches(image, glyph, offsetX, offsetY, color, tolerance = 20) {
  if (offsetX < 0 || offsetY < 0 || offsetX + glyph.width > image.width || offsetY + glyph.height > image.height) return false;
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const glyphIndex = pixelIndex(glyph, x, y);
      const imageIndex = pixelIndex(image, offsetX + x, offsetY + y);
      const opaque = glyph.data[glyphIndex + 3] === 255;
      if ((opaque && colorDistanceAt(image, imageIndex, color) > tolerance)
        || (!opaque && sameRgb(image, imageIndex, color))) return false;
    }
  }
  return true;
}

function findFieldStart(image, offset, field, height) {
  for (let x = field.startX; x < field.startX + 50; x += 1) {
    for (let y = field.y; y < field.y + height; y += 1) {
      if (sameRgb(image, pixelIndex(image, offset.x + x, offset.y + y), field.color)) return offset.x + x;
    }
  }
  return -1;
}

function readField(image, offset, field, fonts) {
  const glyphs = fonts[field.font];
  let x = findFieldStart(image, offset, field, glyphs[0].image.height);
  if (x < 0) return "";
  let value = "";
  for (let guard = 0; guard < 20; guard += 1) {
    const match = glyphs.find((glyph) => glyphMatches(image, glyph.image, x, offset.y + field.y, field.color));
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

  readWithOffset(image, extra = {}) {
    const offset = findTemplate(image, this.marker);
    if (!offset) return null;
    const result = Object.fromEntries(FIELDS.map((field) => [field.name, readField(image, offset, field, this.fonts)]));
    result.FloorSize = result.SizeMod === "+850" ? "Large" : result.SizeMod === "+350" ? "Medium" : "Small";
    result.BonusMod = `${(readBonus(image, offset) * 100).toFixed(1)}%`;
    result.Roomcount = String(extra.roomcount ?? "");
    result.DeadEnds = String(extra.deadEnds ?? "");
    result.Timestamp = (extra.timestamp instanceof Date ? extra.timestamp : new Date()).toLocaleString();
    return { result, offset, width: WINTERFACE_WIDTH, height: WINTERFACE_HEIGHT };
  }

  read(image, extra = {}) {
    return this.readWithOffset(image, extra)?.result ?? null;
  }
}
