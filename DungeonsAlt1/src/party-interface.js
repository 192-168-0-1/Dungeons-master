const MIN_DIVIDER_WIDTH = 100;
const MIN_ROW_GAP = 18;
// The native party rows are about 22 px apart at 100% RuneScape interface
// scale. Keep enough headroom for the supported 200% scale (44 px), plus a
// small rasterisation tolerance for non-integer DPI/capture transforms.
const MAX_ROW_GAP = 48;
const MAX_DIVIDER_PIXEL_GAP = 6;
const MIN_DIVIDER_DENSITY = 0.32;
const MIN_OCCUPIED_PIXELS = 6;

// The colours the RuneScape Dungeoneering party interface actually renders each
// player's RSN in. These are NOT the bright colours the app draws on the map
// (those live in PARTY_COLORS) — reading the interface needs the muted in-game
// text colours. Values taken from the working Sleepy-meh-alt-1/dg-map plugin,
// which the project maintainer confirmed reads this interface reliably. The
// previous values here were the overlay colours, so name rows were never matched
// against the right colour and the panel often went undetected.
const SLOT_RGB = Object.freeze([
  [210, 53, 0],    // Player 1 — orange-red
  [0, 137, 133],   // Player 2 — teal
  [72, 129, 0],    // Player 3 — green
  [145, 150, 0],   // Player 4 — yellow / olive
  [109, 134, 95],  // Player 5 — sage / grey-green
]);

// Squared RGB radius around each reference colour. The four green-ish slots
// (3/4/5) sit close together, so a pixel is only credited to a slot when that
// slot is also its nearest reference — preventing cross-contamination.
const SLOT_MATCH_DISTANCE = 60 * 60;

export function nearestPartySlot(color) {
  const [r, g, b, a] = color;
  if (a < 180) return 0;
  let bestSlot = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < SLOT_RGB.length; index += 1) {
    const [sr, sg, sb] = SLOT_RGB[index];
    const distance = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlot = index + 1;
    }
  }
  return bestDistance <= SLOT_MATCH_DISTANCE ? bestSlot : 0;
}

export function resolvePartyOcrRuntime(root = globalThis) {
  const base = root?.A1lib ?? root?.a1lib;
  const ocr = root?.OCR ?? root?.ocr;
  const fontModule = root?.Alt1Fonts ?? root?.alt1fonts;
  const fonts = [
    fontModule?.aa_8px,
    fontModule?.aa_8px_mono,
    fontModule?.aa_10px_mono,
    fontModule?.aa_12px_mono,
    fontModule?.default,
    fontModule?.chars ? fontModule : null,
    root?.aa_8px,
  ].filter((candidate, index, values) => candidate?.chars && values.indexOf(candidate) === index);
  return {
    capture: typeof base?.capture === "function"
      ? (...args) => {
        const captured = base.capture(...args);
        return typeof captured?.toData === "function" ? captured.toData() : captured;
      }
      : null,
    ocr,
    font: fonts[0] ?? null,
    fonts,
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
  return nearestPartySlot(color) === slot;
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
  let totalX = 0;
  let totalY = 0;
  let minX = image.width;
  let maxX = -1;
  for (let y = bandTop; y <= bandBottom; y += 1) {
    for (let x = panel.lineLeft + 4; x <= panel.lineRight - 4; x += 1) {
      const color = pixel(image, x, y);
      if (!isPartySlotPixel(color, slot)) continue;
      pixelCount += 1;
      totalX += x;
      totalY += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      const key = `${color[0]},${color[1]},${color[2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const colors = uniqueColors([
    ...[...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
      .map(([key]) => key.split(",").map(Number)),
    SLOT_RGB[slot - 1],
  ]);
  const centerY = pixelCount ? Math.round(totalY / pixelCount) : nominalCenterY;
  const centerX = pixelCount ? Math.round(totalX / pixelCount) : Math.round((panel.lineLeft + panel.lineRight) / 2);
  return {
    centerX,
    centerY,
    minX: pixelCount ? minX : panel.lineLeft,
    maxX: pixelCount ? maxX : panel.lineRight,
    pixelCount,
    colors,
  };
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
      for (let hiddenDividersBefore = 0; hiddenDividersBefore <= 2; hiddenDividersBefore += 1) {
        const virtualFirstDividerY = first.y - hiddenDividersBefore * gap;
        if (virtualFirstDividerY <= 0) continue;
        const panel = { firstDividerY: virtualFirstDividerY, rowGap: gap, lineLeft, lineRight };
        const rows = Array.from({ length: 5 }, (_, index) => rowColorData(image, panel, index + 1));
        const colorScore = rows.reduce((total, row) => total + Math.min(40, row.pixelCount), 0);
        if (colorScore < 3) continue;
        const occupiedPrefix = rows.findIndex((row) => row.pixelCount < MIN_OCCUPIED_PIXELS);
        const occupiedRows = occupiedPrefix < 0 ? rows.length : occupiedPrefix;
        const score = colorScore + group.length * 20 + (lineRight - lineLeft) / 20 + occupiedRows * 8 - hiddenDividersBefore * 2;
        if (!best || score > best.score) {
          const panelTop = Math.max(0, virtualFirstDividerY - gap - 5);
          best = {
            ...panel,
            x: Math.max(0, lineLeft - 15),
            y: panelTop,
            width: Math.min(image.width - Math.max(0, lineLeft - 15), lineRight - lineLeft + 31),
            height: Math.min(image.height - panelTop, gap * 5 + 10),
            rows,
            score,
          };
        }
      }
    }
  }
  return best;
}

export function normalizeOcrPartyName(value) {
  const name = String(value ?? "")
    .replace(/_+/g, " ")
    .replace(/[^a-z0-9 -]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);
  const compact = name.replace(/\s/g, "");
  const alphanumeric = compact.replace(/[^a-z0-9]/gi, "");
  const letters = alphanumeric.replace(/[^a-z]/gi, "");
  const hyphens = (compact.match(/-/g) ?? []).length;
  if (alphanumeric.length < 2 || letters.length < 1 || hyphens > 2
    || /--/.test(name) || alphanumeric.length / Math.max(1, compact.length) < 0.7) return "";
  return name;
}

function normalizePartyKey(value) {
  return String(value ?? "").toLowerCase().replace(/[_\s]+/g, "").replace(/[^a-z0-9]/g, "");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function matchExpectedPartyName(name, expectedNames) {
  const key = normalizePartyKey(name);
  if (!key) return "";
  let best = null;
  for (const expected of expectedNames ?? []) {
    const expectedName = String(expected ?? "").trim().slice(0, 24);
    const expectedKey = normalizePartyKey(expectedName);
    if (!expectedKey) continue;
    const distance = editDistance(key, expectedKey);
    const limit = expectedKey.length >= 10 ? 2 : expectedKey.length >= 4 ? 1 : 0;
    if (distance > limit) continue;
    if (!best || distance < best.distance || (distance === best.distance && expectedKey.length > best.key.length)) {
      best = { name: expectedName, key: expectedKey, distance };
    } else if (best && distance === best.distance) {
      best.ambiguous = true;
    }
  }
  return best && !best.ambiguous ? best.name : "";
}

function uniqueColors(colors) {
  const seen = new Set();
  const result = [];
  for (const color of colors ?? []) {
    if (!Array.isArray(color) || color.length < 3) continue;
    const rgb = color.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
    const key = rgb.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rgb);
  }
  return result;
}

function readRowName(image, panel, row, ocr, fonts, expectedNames = []) {
  if (!ocr?.findReadLine || !fonts?.length) return "";
  const panelCenterX = Math.round((panel.lineLeft + panel.lineRight) / 2);
  const leftTextX = Math.max(panel.lineLeft + 8, row.minX - 8);
  const rightTextX = Math.min(panel.lineRight - 8, row.maxX + 8);
  const xCenters = uniqueNumbers([
    row.centerX,
    panelCenterX,
    leftTextX + Math.round((rightTextX - leftTextX) / 2),
  ]);
  const xOffsets = [-54, -36, -18, 0, 18, 36, 54];
  const yOffsets = [-7, -5, -3, -1, 0, 1, 3, 5, 7];
  const colorSets = [
    row.colors,
    ...row.colors.slice(0, 5).map((color) => [color]),
  ].filter((colors) => colors?.length);
  let best = "";
  for (const font of fonts) {
    for (const colors of colorSets) {
      for (const centerX of xCenters) {
        for (const yOffset of yOffsets) {
          for (const xOffset of xOffsets) {
            const x = Math.max(panel.lineLeft + 4, Math.min(panel.lineRight - 4, centerX + xOffset));
            try {
              const result = ocr.findReadLine(image, font, colors, x, row.centerY + yOffset);
              const name = normalizeOcrPartyName(result?.text);
              const expected = matchExpectedPartyName(name, expectedNames);
              if (expected) return expected;
              if (name.length > best.length) best = name;
            } catch {
              // An OCR miss at one probe point is expected; try the next point/font.
            }
          }
        }
      }
    }
  }
  return best;
}

function uniqueNumbers(values) {
  const result = [];
  for (const value of values ?? []) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || result.includes(number)) continue;
    result.push(number);
  }
  return result;
}

export function readPartyInterface(image, { ocr, font, fonts, expectedNames = [] } = {}) {
  const panel = findPartyPanel(image);
  if (!panel) return null;
  const fontCandidates = fonts?.length ? fonts : font ? [font] : [];
  const rowNames = panel.rows.map((row) => readRowName(image, panel, row, ocr, fontCandidates, expectedNames));
  let foundEmptyRow = false;
  const members = panel.rows.map((row, index) => {
    const rowHasEvidence = row.pixelCount >= MIN_OCCUPIED_PIXELS || Boolean(rowNames[index]);
    const occupied = !foundEmptyRow && rowHasEvidence;
    if (!occupied) foundEmptyRow = true;
    return {
      slot: index + 1,
      occupied,
      name: occupied ? rowNames[index] : "",
      pixelCount: row.pixelCount,
    };
  });
  return { panel, members };
}
