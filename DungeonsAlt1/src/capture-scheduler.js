export function normalizeCaptureInterval(value, fallback = 50) {
  const recommended = Number(value);
  const safeFallback = Math.max(1, Number(fallback) || 50);
  return Number.isFinite(recommended) && recommended > 0
    ? Math.max(safeFallback, recommended)
    : safeFallback;
}

// Pure reservation primitive shared by map, results and party capture owners.
// A locator may issue multiple region reads inside one reservation to assemble
// one logical frame; independent owners can never begin inside the backend's
// recommended capture interval.
export function reserveCaptureSlot(nextCaptureAt, now, interval) {
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : 0;
  const next = Math.max(0, Number(nextCaptureAt) || 0);
  const cadence = normalizeCaptureInterval(interval);
  if (timestamp < next) {
    return { reserved: false, nextCaptureAt: next, delay: next - timestamp };
  }
  return { reserved: true, nextCaptureAt: timestamp + cadence, delay: 0 };
}
