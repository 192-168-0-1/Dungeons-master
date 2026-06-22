const MIN_DIVIDER_WIDTH = 100;
const MIN_ROW_GAP = 18;
const MAX_ROW_GAP = 42;
const MAX_DIVIDER_PIXEL_GAP = 6;
const MIN_DIVIDER_DENSITY = 0.32;

const SLOT_RGB = Object.freeze([
  [231, 80, 43],
  [53, 183, 232],
  [82, 190, 76],
  [238, 211, 64],
  [170, 174, 178],
]);

export function resolvePartyOcrRuntime(root = globalThis) {
  const base = root?.A1lib ?? root?.a1lib;
  const ocr = root?.OCR ?? root?.ocr;
  const fontModule = root?.Alt1Fonts ?? root?.alt1fonts;
  const font = fontModule?.aa_8px
    ?? fontModule?.default
    ?? (fontModule?.chars ? fontModule : null)
    ?? root?.aa_8px;
  return {
    capture: typeof base?.capture === "function"
      ? (...args) => {
        const captured = base.capture(...args);
        return typeof captured?.toData === "function" ? captured.toData() : captured;
      }
      : null,
    ocr,
    font,
  };
}

function pixelOffset(image, x, y) {
  return (y * image.width + x) * 4;
}

function pixel(image, x, y) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return [0, 0, 0, 0];
  const offset = pixelOffset(image, x, y);
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

function isDividerPixel(color) {
  const [r, g, b, a] = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return a > 180 && r >= 42 && r <= 165 && g >= 38 && g <= 155 && b >= 24 && b <= 130
    && r + 10 >= b && g + 10 >= b && max - min <= 70;
}

export function isPartySlotPixel(color, slot) {
  const [r, g, b, a] = color;
  if (a < 180 || Math.max(r, g, b) < 55) return false;
  if (slot === 1) return r >= 75 && r >= g * 1.45 && r >= b * 1.35;
  if (slot === 2) return g >= 70 && b >= 70 && r + 25 <= Math.max(g, b) && Math.abs(g - b) <= 90;
  if (slot === 3) return g >= 70 && g >= r + 18 && g >= b + 12;
  if (slot === 4) return r >= 90 && g >= 75 && b + 22 <= Math.min(r, g);
  if (slot === 5) return Math.max(r, g, b) - Math.min(r, g, b) <= 35 && r >= 85;
  return false;
}

function dividerRuns(image) {
  const runs = [];
  for (let y = 1; y < image.height - 1; y += 1) {
    const row = [];
    let start = -1;
    let lastMatch = -1;
    let matchCount = 0;
    const finishRun = () => {
      if (start < 0 || lastMatch < start) return;
      const width = lastMatch - start + 1;
      if (width >= MIN_DIVIDER_WIDTH && matchCount / width >= MIN_DIVIDER_DENSITY) {
        row.push({ y, left: start, right: lastMatch });
      }
      start = -1;
      lastMatch = -1;
      matchCount = 0;
    };

    for (let x = 0; x < image.width; x += 1) {
      if (!isDividerPixel(pixel(image, x, y))) continue;
      if (start < 0 || x - lastMatch > MAX_DIVIDER_PIXEL_GAP) {
        finishRun();
        start = x;
      }
      lastMatch = x;
      matchCount += 1;
    }
    finishRun();
    row.sort((left, right) => (right.right - right.left) - (left.right - left.left));
    runs.push(...row.slice(0, 3));
  }
  return runs;
}

function compatibleRun(runsByY, y, previous) {
  for (let delta = -1; delta <= 1; delta += 1) {
    const candidates = runsByY.get(y + delta) ?? [];
    const match = candidates.find((run) => Math.abs(run.left - previous.left) <= 5
      && Math.abs(run.right - previous.right) <= 5);
    if (match) return match;
  }
  return null;
}

function rowColorData(image, panel, slot) {
  const nominalCenterY = Math.round(panel.firstDividerY - panel.rowGap / 2 + (slot - 1) * panel.rowGap);
  const bandTop = Math.max(0, slot === 1
    ? panel.firstDividerY - panel.rowGap - 10
    : panel.firstDividerY + (slot - 2) * panel.rowGap + 2);
  const bandBottom = Math.min(image.height - 1,
    panel.firstDividerY + (slot - 1) * panel.rowGap - 2);
  const counts = new Map();
  let pixelCount = 0;
  let totalY = 0;
  for (let y = bandTop; y <= bandBottom; y += 1) {
    for (let x = panel.lineLeft + 4; x <= panel.lineRight - 4; x += 1) {
      const color = pixel(image, x, y);
      if (!isPartySlotPixel(color, slot)) continue;
      pixelCount += 1;
      totalY += y;
      const key = `${color[0]},${color[1]},${color[2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const colors = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([key]) => key.split(",").map(Number));
  if (!colors.length) colors.push(SLOT_RGB[slot - 1]);
  const centerY = pixelCount ? Math.round(totalY / pixelCount) : nominalCenterY;
  return { centerY, pixelCount, colors };
}

export function findPartyPanel(image) {
  if (!image?.data || image.width < 140 || image.height < 100) return null;
  const runs = dividerRuns(image);
  const runsByY = new Map();
  for (const run of runs) {
    if (!runsByY.has(run.y)) runsByY.set(run.y, []);
    runsByY.get(run.y).push(run);
  }

  let best = null;
  for (const first of runs) {
    for (let gap = MIN_ROW_GAP; gap <= MAX_ROW_GAP; gap += 1) {
      const group = [first];
      let previous = first;
      for (let index = 1; index < 4; index += 1) {
        const match = compatibleRun(runsByY, first.y + index * gap, previous);
        if (!match) break;
        group.push(match);
        previous = match;
      }
      // Some interface layouts only expose three strong internal dividers;
      // player-color evidence below prevents generic panels from matching.
      if (group.length < 3) continue;
      const lineLeft = Math.max(...group.map((run) => run.left));
      const lineRight = Math.min(...group.map((run) => run.right));
      if (lineRight - lineLeft + 1 < MIN_DIVIDER_WIDTH) continue;
      const panel = { firstDividerY: first.y, rowGap: gap, lineLeft, lineRight };
      const rows = Array.from({ length: 5 }, (_, index) => rowColorData(image, panel, index + 1));
      const colorScore = rows.reduce((total, row) => total + Math.min(40, row.pixelCount), 0);
      if (colorScore < 3) continue;
      const score = colorScore + group.length * 20 + (lineRight - lineLeft) / 20;
      if (!best || score > best.score) {
        best = {
          ...panel,
          x: Math.max(0, lineLeft - 15),
          y: Math.max(0, first.y - gap - 5),
          width: Math.min(image.width - Math.max(0, lineLeft - 15), lineRight - lineLeft + 31),
          height: Math.min(image.height - Math.max(0, first.y - gap - 5), gap * 5 + 10),
          rows,
          score,
        };
      }
    }
  }
  return best;
}

function cleanOcrName(value) {
  return String(value ?? "").replace(/[^a-z0-9 _-]/gi, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function readRowName(image, panel, row, ocr, font) {
  if (!ocr?.findReadLine || !font || row.pixelCount < 3) return "";
  const centerX = Math.round((panel.lineLeft + panel.lineRight) / 2);
  let best = "";
  for (let yOffset = -3; yOffset <= 3; yOffset += 2) {
    for (let xOffset = -30; xOffset <= 30; xOffset += 10) {
      try {
        const result = ocr.findReadLine(image, font, row.colors, centerX + xOffset, row.centerY + yOffset);
        const name = cleanOcrName(result?.text);
        if (name.length > best.length) best = name;
      } catch {
        // An OCR miss at one probe point is expected; try the next point.
      }
    }
  }
  return best;
}

export function readPartyInterface(image, { ocr, font } = {}) {
  const panel = findPartyPanel(image);
  if (!panel) return null;
  const members = panel.rows.map((row, index) => ({
    slot: index + 1,
    occupied: row.pixelCount >= 3,
    name: readRowName(image, panel, row, ocr, font),
    pixelCount: row.pixelCount,
  }));
  return { panel, members };
}
