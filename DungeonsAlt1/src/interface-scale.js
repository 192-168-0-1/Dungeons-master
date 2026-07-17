export const INTERFACE_SCALE_MIN = 1;
export const INTERFACE_SCALE_MAX = 2;
export const INTERFACE_SCALE_STEP = 0.05;
export const INTERFACE_SCALE_OBSERVATION_MAX_AGE = 10 * 60 * 1000;

export function normalizeInterfaceScale(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return normalizeInterfaceScale(fallback, 1);
  const clamped = Math.min(INTERFACE_SCALE_MAX, Math.max(INTERFACE_SCALE_MIN, number));
  const steps = Math.round((clamped - INTERFACE_SCALE_MIN) / INTERFACE_SCALE_STEP);
  return Number((INTERFACE_SCALE_MIN + steps * INTERFACE_SCALE_STEP).toFixed(2));
}

// localStorage is an input boundary, not a trusted source. Older builds stored
// the multiplier directly, so a missing value still means the legacy 100%; an
// explicitly present value outside RuneScape's supported 100..200% range must
// be rejected instead of clamped. Clamping `150` to `2` would still turn a
// corrupt calibration into a very large pixel capture before auto-detection can
// recover it.
export function parseSavedInterfaceScale(value) {
  if (value === undefined || value === null || value === "") return 1;
  const number = Number(value);
  if (!Number.isFinite(number) || number < INTERFACE_SCALE_MIN || number > INTERFACE_SCALE_MAX) return null;
  return normalizeInterfaceScale(number);
}

export function createInterfaceScaleState(savedScale = null) {
  const hasSavedScale = Number.isFinite(Number(savedScale)) && Number(savedScale) > 0;
  return {
    value: normalizeInterfaceScale(hasSavedScale ? savedScale : 1),
    source: hasSavedScale ? "saved-hint" : "default",
    observedAt: 0,
    confirmed: false,
  };
}

export function observeInterfaceScale(previous, value, source, observedAt = Date.now()) {
  const timestamp = Number(observedAt);
  return {
    value: normalizeInterfaceScale(value, previous?.value ?? 1),
    source: String(source || "pixels"),
    observedAt: Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0,
    confirmed: true,
  };
}

export function isFreshInterfaceScaleObservation(scaleState, now = Date.now()) {
  const observedAt = Number(scaleState?.observedAt);
  const age = Number(now) - observedAt;
  return Boolean(scaleState?.confirmed)
    && Number.isFinite(age)
    && age >= 0
    && age <= INTERFACE_SCALE_OBSERVATION_MAX_AGE;
}

export function currentInterfaceScale({ calibration = null, scaleState = null, now = Date.now() } = {}) {
  const calibrationScale = Number(calibration?.scale);
  if (Number.isFinite(calibrationScale) && calibrationScale > 0) {
    return normalizeInterfaceScale(calibrationScale);
  }
  if (isFreshInterfaceScaleObservation(scaleState, now)) {
    return normalizeInterfaceScale(scaleState.value);
  }
  // A saved or older observation is useful only as a cheap first probe. Every
  // pixel reader that consumes this value must keep its scale fallback enabled.
  return normalizeInterfaceScale(scaleState?.value ?? 1);
}

export function interfaceScaleLabel(scaleState, calibration = null, now = Date.now()) {
  const value = currentInterfaceScale({ calibration, scaleState, now });
  const freshObservation = isFreshInterfaceScaleObservation(scaleState, now);
  const source = calibration
    ? "map pixels"
    : freshObservation && scaleState?.source === "results"
      ? "results pixels"
      : freshObservation
        ? "detected pixels"
        : "detecting";
  return `Auto: ${Math.round(value * 100)}% (${source})`;
}
