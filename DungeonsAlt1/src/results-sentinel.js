/*
 * End-of-dungeon sentinel colours, offsets and thresholds are adapted from
 * miseenplac/dghelper src/index.js at commit
 * 80c9c6ced28c9a591d237749ef8c0ca06c6db615:
 * https://github.com/miseenplac/dghelper
 *
 * dghelper is MIT licensed, Copyright (c) 2026 miseenplac. The reference
 * implementation samples three 5x5 zones every 250 ms and requires at least
 * 5 matching pixels in every zone. This module preserves that detection rule
 * while scaling only the zone geometry for RuneScape UI scales 100..200%.
 */

export const RESULTS_SENTINEL_CADENCE_MS = 250;

const ZONE_HALF = 2;
const ZONE_MIN_HITS = 5;
// WinterfaceReader's 512x334 source excludes the outer 7px horizontal and 8px
// vertical dialog border from dghelper's 526x350 coordinate system.
const REFERENCE_SOURCE_CENTER_X = 256;
const REFERENCE_SOURCE_CENTER_Y = 167;
const WINTERFACE_WIDTH = 512;
const WINTERFACE_HEIGHT = 334;
const SOURCE_DIMENSION_TOLERANCE = 2;

const ZONE_DEFINITIONS = Object.freeze([
  Object.freeze({
    label: "title-gold",
    dx: 0,
    dy: -156,
    tolerance: 32,
    colors: Object.freeze([
      Object.freeze([182, 145, 94]),
      Object.freeze([176, 139, 89]),
      Object.freeze([240, 190, 121]),
      Object.freeze([239, 201, 0]),
      Object.freeze([255, 223, 0]),
      Object.freeze([255, 214, 40]),
    ]),
  }),
  Object.freeze({
    label: "dark-interior",
    dx: -200,
    dy: 141,
    tolerance: 8,
    colors: Object.freeze([Object.freeze([20, 18, 14])]),
  }),
  Object.freeze({
    label: "ready-orange",
    dx: 198,
    dy: 144,
    tolerance: 32,
    colors: Object.freeze([
      Object.freeze([255, 189, 0]),
      Object.freeze([237, 171, 40]),
    ]),
  }),
]);

function normalizeScale(value) {
  let scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (scale > 10) scale /= 100;
  if (scale < 1 || scale > 2) return null;
  return scale;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function sourceAnchor(previousSource, scale, clientWidth, clientHeight) {
  const x = Number(previousSource?.x);
  const y = Number(previousSource?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const priorClientWidth = Number(previousSource?.clientWidth);
  const priorClientHeight = Number(previousSource?.clientHeight);
  if ((Number.isFinite(priorClientWidth) && priorClientWidth > 0 && priorClientWidth !== clientWidth)
    || (Number.isFinite(priorClientHeight) && priorClientHeight > 0 && priorClientHeight !== clientHeight)) return null;

  const expectedWidth = Math.round(WINTERFACE_WIDTH * scale);
  const expectedHeight = Math.round(WINTERFACE_HEIGHT * scale);
  const width = positiveInteger(previousSource?.width ?? expectedWidth);
  const height = positiveInteger(previousSource?.height ?? expectedHeight);
  if (!width || !height
    || Math.abs(width - expectedWidth) > SOURCE_DIMENSION_TOLERANCE
    || Math.abs(height - expectedHeight) > SOURCE_DIMENSION_TOLERANCE) return null;

  const sourceScale = previousSource?.scale === undefined
    ? scale
    : normalizeScale(previousSource.scale);
  if (!sourceScale || Math.abs(sourceScale - scale) > 0.001) return null;
  if (x < 0 || y < 0 || x + width > clientWidth || y + height > clientHeight) return null;

  // WinterfaceReader returns the top-left of its normalized 512x334 inner
  // results crop. Convert that source to the outer dialog centre so a
  // previously located result follows client layout shifts. A stale,
  // differently scaled or out-of-client source is rejected and the plan safely
  // falls back to the RuneScape client centre.
  return {
    x: Math.round(x + REFERENCE_SOURCE_CENTER_X * scale),
    y: Math.round(y + REFERENCE_SOURCE_CENTER_Y * scale),
    source: "previous-source",
  };
}

function zoneAt(definition, anchor, scale) {
  const centerX = anchor.x + Math.round(definition.dx * scale);
  const centerY = anchor.y + Math.round(definition.dy * scale);
  const absoluteSamples = [];
  for (let dy = -ZONE_HALF; dy <= ZONE_HALF; dy += 1) {
    for (let dx = -ZONE_HALF; dx <= ZONE_HALF; dx += 1) {
      absoluteSamples.push({ x: centerX + dx, y: centerY + dy });
    }
  }
  return {
    label: definition.label,
    centerX,
    centerY,
    tolerance: definition.tolerance,
    colors: definition.colors,
    absoluteSamples,
  };
}

export function createResultsSentinelPlan({
  clientWidth,
  clientHeight,
  interfaceScale = 1,
  previousSource = null,
} = {}) {
  const width = positiveInteger(clientWidth);
  const height = positiveInteger(clientHeight);
  const scale = normalizeScale(interfaceScale);
  if (!width || !height || !scale) return null;

  let anchor = sourceAnchor(previousSource, scale, width, height);
  if (!anchor) {
    anchor = {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
      source: "client-center",
    };
  }

  let zones = ZONE_DEFINITIONS.map((definition) => zoneAt(definition, anchor, scale));
  const sourceIsUsable = zones.every((zone) => zone.absoluteSamples.every((sample) => (
    sample.x >= 0 && sample.y >= 0 && sample.x < width && sample.y < height
  )));
  if (!sourceIsUsable && anchor.source === "previous-source") {
    anchor = {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
      source: "client-center",
    };
    zones = ZONE_DEFINITIONS.map((definition) => zoneAt(definition, anchor, scale));
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const zone of zones) {
    for (const sample of zone.absoluteSamples) {
      minX = Math.min(minX, sample.x);
      minY = Math.min(minY, sample.y);
      maxX = Math.max(maxX, sample.x);
      maxY = Math.max(maxY, sample.y);
    }
  }
  minX = Math.max(0, minX);
  minY = Math.max(0, minY);
  maxX = Math.min(width - 1, maxX);
  maxY = Math.min(height - 1, maxY);
  if (maxX < minX || maxY < minY) return null;

  const x = minX;
  const y = minY;
  const captureWidth = maxX - minX + 1;
  const captureHeight = maxY - minY + 1;
  zones = zones.map((zone) => ({
    label: zone.label,
    centerX: zone.centerX,
    centerY: zone.centerY,
    tolerance: zone.tolerance,
    colors: zone.colors,
    samples: zone.absoluteSamples.map((sample) => ({
      x: sample.x - x,
      y: sample.y - y,
      absoluteX: sample.x,
      absoluteY: sample.y,
    })),
  }));

  return {
    x,
    y,
    width: captureWidth,
    height: captureHeight,
    clientWidth: width,
    clientHeight: height,
    interfaceScale: scale,
    anchorSource: anchor.source,
    zones,
  };
}

function pixelAt(image, x, y) {
  if (!image || !Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  if (typeof image.getPixel === "function") {
    try { return image.getPixel(x, y); } catch (_) { return null; }
  }
  if (!image.data || image.data.length < image.width * image.height * 4) return null;
  const index = (y * image.width + x) * 4;
  return [image.data[index], image.data[index + 1], image.data[index + 2]];
}

function matchesPalette(pixel, colors, tolerance) {
  if (!pixel || pixel.length < 3) return false;
  return colors.some((color) => (
    Math.abs(pixel[0] - color[0]) <= tolerance
    && Math.abs(pixel[1] - color[1]) <= tolerance
    && Math.abs(pixel[2] - color[2]) <= tolerance
  ));
}

export function resultsSentinelsMatch(image, plan) {
  if (!image || !plan || !Array.isArray(plan.zones) || plan.zones.length !== 3) return false;
  const localCapture = image.width === plan.width && image.height === plan.height;
  const fullClient = image.width === plan.clientWidth && image.height === plan.clientHeight;
  if (!localCapture && !fullClient) return false;

  return plan.zones.every((zone) => {
    let hits = 0;
    for (const sample of zone.samples) {
      const x = localCapture ? sample.x : sample.absoluteX;
      const y = localCapture ? sample.y : sample.absoluteY;
      if (matchesPalette(pixelAt(image, x, y), zone.colors, zone.tolerance)) hits += 1;
      if (hits >= ZONE_MIN_HITS) return true;
    }
    return false;
  });
}
