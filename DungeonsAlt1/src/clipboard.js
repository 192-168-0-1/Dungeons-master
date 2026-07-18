export const PNG_CLIPBOARD_MIME_TYPE = "image/png";
export const PNG_CLIPBOARD_WRITE_TIMEOUT_MS = 3000;

export const CLIPBOARD_WRITE_FAILURES = Object.freeze({
  Unsupported: "unsupported",
  InsecureContext: "insecure-context",
  InvalidPng: "invalid-png",
  UnsupportedType: "unsupported-type",
  Blocked: "blocked",
  Timeout: "timeout",
  Failed: "failed",
});

const KNOWN_FAILURES = new Set(Object.values(CLIPBOARD_WRITE_FAILURES));

export class ClipboardWriteError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "ClipboardWriteError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function classifyClipboardWriteError(error) {
  if (KNOWN_FAILURES.has(error?.code)) return error.code;
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return CLIPBOARD_WRITE_FAILURES.Blocked;
  }
  if (error?.name === "TimeoutError") return CLIPBOARD_WRITE_FAILURES.Timeout;
  if (error?.name === "NotSupportedError" || error?.name === "DataError") {
    return CLIPBOARD_WRITE_FAILURES.UnsupportedType;
  }
  return CLIPBOARD_WRITE_FAILURES.Failed;
}

function normalizedClipboardError(error, timeoutMs) {
  if (error instanceof ClipboardWriteError) return error;
  const code = classifyClipboardWriteError(error);
  const message = {
    [CLIPBOARD_WRITE_FAILURES.Blocked]: "Clipboard image access was blocked",
    [CLIPBOARD_WRITE_FAILURES.Timeout]: `Clipboard image write did not resolve within ${timeoutMs}ms`,
    [CLIPBOARD_WRITE_FAILURES.UnsupportedType]: "This browser does not support PNG clipboard images",
  }[code] || `Clipboard image write failed${error?.message ? `: ${error.message}` : ""}`;
  return new ClipboardWriteError(code, message, error);
}

function settleClipboardWrite(operation, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error("Clipboard image write timed out");
      error.name = "TimeoutError";
      finish(reject, error);
    }, timeoutMs);
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export async function writePngBlobToClipboard(
  blob,
  root = globalThis,
  { timeoutMs = PNG_CLIPBOARD_WRITE_TIMEOUT_MS } = {},
) {
  if (String(blob?.type || "").trim().toLowerCase() !== PNG_CLIPBOARD_MIME_TYPE) {
    throw new ClipboardWriteError(
      CLIPBOARD_WRITE_FAILURES.InvalidPng,
      "Clipboard image must be an image/png Blob",
    );
  }
  if (root?.isSecureContext === false) {
    throw new ClipboardWriteError(
      CLIPBOARD_WRITE_FAILURES.InsecureContext,
      "PNG clipboard writes require a secure context",
    );
  }

  const clipboard = root?.navigator?.clipboard;
  const ClipboardItemType = root?.ClipboardItem;
  if (typeof clipboard?.write !== "function" || typeof ClipboardItemType !== "function") {
    throw new ClipboardWriteError(
      CLIPBOARD_WRITE_FAILURES.Unsupported,
      "This browser does not expose PNG clipboard writing",
    );
  }
  if (typeof ClipboardItemType.supports === "function") {
    try {
      if (ClipboardItemType.supports(PNG_CLIPBOARD_MIME_TYPE) === false) {
        throw new ClipboardWriteError(
          CLIPBOARD_WRITE_FAILURES.UnsupportedType,
          "This browser does not support PNG clipboard images",
        );
      }
    } catch (error) {
      if (error instanceof ClipboardWriteError) throw error;
      // Some older embedded Chromium builds expose a broken supports() helper.
      // The ClipboardItem constructor and actual write remain authoritative.
    }
  }

  const wait = Number(timeoutMs);
  const boundedTimeout = Number.isFinite(wait) && wait > 0
    ? wait
    : PNG_CLIPBOARD_WRITE_TIMEOUT_MS;

  let operation;
  try {
    const item = new ClipboardItemType({ [PNG_CLIPBOARD_MIME_TYPE]: blob });
    // Start the protected operation synchronously. In particular, do not defer
    // this call behind a promise: the caller's click activation may be transient.
    operation = clipboard.write([item]);
  } catch (error) {
    throw normalizedClipboardError(error, boundedTimeout);
  }

  try {
    await settleClipboardWrite(operation, boundedTimeout);
    return true;
  } catch (error) {
    throw normalizedClipboardError(error, boundedTimeout);
  }
}
