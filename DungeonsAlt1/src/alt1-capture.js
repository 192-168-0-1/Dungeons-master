export function hasAlt1() {
  return typeof window !== "undefined" && typeof window.alt1 !== "undefined";
}

export function identifyApp() {
  if (!hasAlt1() || typeof window.alt1.identifyAppUrl !== "function") return;
  window.alt1.identifyAppUrl(new URL("../appconfig.json", import.meta.url).href);
}

function decodeImageString(encoded, target, targetWidth, offsetX, offsetY, width, height) {
  const binary = atob(encoded);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const destination = ((offsetY + y) * targetWidth + offsetX + x) * 4;
      target[destination] = binary.charCodeAt(source + 2);
      target[destination + 1] = binary.charCodeAt(source + 1);
      target[destination + 2] = binary.charCodeAt(source);
      target[destination + 3] = binary.charCodeAt(source + 3);
    }
  }
}

function transferRegionInRows(readRegion, target, targetWidth, x, y, width, height, maxTransfer) {
  const rowsPerTransfer = Math.max(1, Math.floor(maxTransfer / 4 / width));
  for (let offsetY = 0; offsetY < height; offsetY += rowsPerTransfer) {
    const stripeHeight = Math.min(rowsPerTransfer, height - offsetY);
    const encoded = readRegion(x, y + offsetY, width, stripeHeight);
    if (!encoded) throw new Error("Alt1 could not read the RuneScape image.");
    decodeImageString(encoded, target, targetWidth, 0, offsetY, width, stripeHeight);
  }
}

export function captureRegion(x, y, width, height) {
  if (!hasAlt1()) throw new Error("Alt1 is not available.");
  const api = window.alt1;
  x = Math.round(x);
  y = Math.round(y);
  width = Math.round(width);
  height = Math.round(height);

  if (typeof api.capture === "function") {
    const result = api.capture(x, y, width, height);
    const data = result instanceof Uint8ClampedArray ? result : new Uint8ClampedArray(result);
    return new ImageData(data, width, height);
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const maxTransfer = Math.max(65536, Math.min(Number(api.maxtransfer) || 4_000_000, 4_000_000));

  // A large getRegion request has to be transferred in stripes. Bind the whole
  // source rectangle first so every stripe comes from one held RuneScape frame;
  // otherwise an animating interface can be stitched together from multiple
  // moments. Older Alt1 builds without the bind API keep the legacy getRegion
  // path below so pixel capture continues to work, albeit without that guarantee.
  if (width * height * 4 > maxTransfer
    && typeof api.bindRegion === "function"
    && typeof api.bindGetRegion === "function") {
    try {
      const bind = api.bindRegion(x, y, width, height);
      if (Number(bind) > 0) {
        transferRegionInRows(
          (stripeX, stripeY, stripeWidth, stripeHeight) =>
            api.bindGetRegion(bind, stripeX, stripeY, stripeWidth, stripeHeight),
          data,
          width,
          x,
          y,
          width,
          height,
          maxTransfer,
        );
        return new ImageData(data, width, height);
      }
    } catch {
      // Fall through to the compatible live getRegion path and refill all rows.
    }
  }

  if (typeof api.getRegion !== "function") throw new Error("Alt1 could not read the RuneScape image.");
  transferRegionInRows(
    (stripeX, stripeY, stripeWidth, stripeHeight) =>
      api.getRegion(stripeX, stripeY, stripeWidth, stripeHeight),
    data,
    width,
    x,
    y,
    width,
    height,
    maxTransfer,
  );
  return new ImageData(data, width, height);
}

export function captureFullRuneScape() {
  if (!hasAlt1() || !window.alt1.rsLinked) throw new Error("Link the RuneScape window to Alt1 first.");
  return captureRegion(0, 0, window.alt1.rsWidth, window.alt1.rsHeight);
}

export function moveWindowFrom(element) {
  element.addEventListener("mousedown", (event) => {
    if (!hasAlt1() || typeof window.alt1.userResize !== "function" || event.button !== 0) return;
    window.alt1.userResize(true, true, true, true);
    event.preventDefault();
  });
}
