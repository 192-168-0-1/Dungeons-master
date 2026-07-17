const ARCHIVE_DATABASE_NAME = "dungeons-alt1-capture-archive";
const ARCHIVE_DATABASE_VERSION = 1;
const ARCHIVE_STORE_NAME = "captures";
const ARCHIVE_DATABASE_TIMEOUT_MS = 10000;
const STORAGE_PERSIST_TIMEOUT_MS = 2000;
const MAX_CAPTURE_FILENAME_CODE_POINTS = 240;
const MAX_CAPTURE_KIND_LENGTH = 32;
const MAX_CAPTURE_ID_LENGTH = 160;
const MAX_CAPTURE_DATA_URL_CHARS = 256 * 1024 * 1024;
const ZIP_UTF8_FLAG = 0x0800;

export const MAX_CAPTURE_ARCHIVE_ITEMS = 200;

function timeoutValue(options, fallback) {
  const candidate = typeof options === "number" ? options : options?.timeoutMs;
  const value = Number(candidate);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function settleWithin(operation, timeoutMs, fallback, root = globalThis, onTimeout = null) {
  const setTimer = typeof root?.setTimeout === "function"
    ? root.setTimeout.bind(root)
    : globalThis.setTimeout.bind(globalThis);
  const clearTimer = typeof root?.clearTimeout === "function"
    ? root.clearTimeout.bind(root)
    : globalThis.clearTimeout.bind(globalThis);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve(value);
    };
    const timer = setTimer(() => {
      try { onTimeout?.(); } catch { /* Timeout cancellation is best-effort. */ }
      finish(fallback);
    }, timeoutMs);
    Promise.resolve().then(operation).then(finish, () => finish(fallback));
  });
}

function normalizeCreatedAt(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp >= 0 ? Math.trunc(timestamp) : null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.trunc(numeric);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeKind(value) {
  if (typeof value !== "string") return null;
  const kind = value.trim().toLowerCase();
  if (!kind || kind.length > MAX_CAPTURE_KIND_LENGTH) return null;
  return kind === "map" || kind === "results" ? kind : null;
}

function fallbackCaptureId(kind, filename, createdAt, dataUrl) {
  const descriptor = `${kind}\n${filename}\n${createdAt}\n${dataUrl.length}\n${dataUrl.slice(-32)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < descriptor.length; index += 1) {
    hash ^= descriptor.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-${createdAt}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeCaptureId(value, fallback) {
  if (typeof value === "string") {
    const id = value.trim();
    if (id && id.length <= MAX_CAPTURE_ID_LENGTH && /^[A-Za-z0-9._:-]+$/.test(id)) return id;
  }
  return fallback;
}

function normalizePngFilename(value) {
  if (typeof value !== "string") return null;
  const leaf = value.trim().split(/[\\/]/).pop()
    ?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_");
  if (!leaf || !/\.png$/i.test(leaf)) return null;
  const extension = leaf.slice(-4);
  const stem = leaf.slice(0, -4).replace(/[. ]+$/g, "");
  if (!stem || stem === "." || stem === "..") return null;
  const boundedStem = Array.from(stem).slice(0, MAX_CAPTURE_FILENAME_CODE_POINTS - 4).join("");
  return `${boundedStem}${extension}`;
}

function parsePngDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_CAPTURE_DATA_URL_CHARS) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).toLowerCase().startsWith("data:image/png")) return null;
  const metadata = dataUrl.slice(5, comma).split(";");
  if (metadata.shift()?.trim().toLowerCase() !== "image/png") return null;
  const isBase64 = metadata.some((part) => part.trim().toLowerCase() === "base64");
  return { payload: dataUrl.slice(comma + 1), isBase64 };
}

function decodeBase64(value) {
  const clean = value.replace(/[\t\n\f\r ]/g, "");
  if (clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error("Invalid base64 PNG data URL");
  }
  const firstPadding = clean.indexOf("=");
  if (firstPadding >= 0 && firstPadding < clean.length - 2) {
    throw new Error("Invalid base64 PNG data URL");
  }
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((padded.length / 4) * 3 - padding);
  let output = 0;
  for (let index = 0; index < padded.length; index += 4) {
    const a = alphabet.indexOf(padded[index]);
    const b = alphabet.indexOf(padded[index + 1]);
    const c = padded[index + 2] === "=" ? 0 : alphabet.indexOf(padded[index + 2]);
    const d = padded[index + 3] === "=" ? 0 : alphabet.indexOf(padded[index + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Invalid base64 PNG data URL");
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (output < bytes.length) bytes[output++] = (combined >>> 16) & 0xff;
    if (output < bytes.length) bytes[output++] = (combined >>> 8) & 0xff;
    if (output < bytes.length) bytes[output++] = combined & 0xff;
  }
  return bytes;
}

function appendUtf8CodePoint(output, codePoint) {
  if (codePoint <= 0x7f) output.push(codePoint);
  else if (codePoint <= 0x7ff) {
    output.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
  } else if (codePoint <= 0xffff) {
    output.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  } else {
    output.push(
      0xf0 | (codePoint >>> 18),
      0x80 | ((codePoint >>> 12) & 0x3f),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
}

function decodePercentData(value, maxBytes = Number.POSITIVE_INFINITY) {
  const output = [];
  for (let index = 0; index < value.length && output.length < maxBytes;) {
    if (value[index] === "%") {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error("Invalid percent-encoded PNG data URL");
      output.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    const codePoint = value.codePointAt(index);
    appendUtf8CodePoint(output, codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return Uint8Array.from(output);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngSignature(dataUrl) {
  const parsed = parsePngDataUrl(dataUrl);
  if (!parsed) return false;
  try {
    let bytes;
    if (parsed.isBase64) {
      let prefix = "";
      for (const character of parsed.payload) {
        if (/[\t\n\f\r ]/.test(character)) continue;
        prefix += character;
        if (prefix.length >= 12 || character === "=") break;
      }
      bytes = decodeBase64(prefix);
    } else {
      bytes = decodePercentData(parsed.payload, PNG_SIGNATURE.length);
    }
    return bytes.length >= PNG_SIGNATURE.length
      && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  } catch {
    return false;
  }
}

function pngDataUrlToBytes(dataUrl) {
  const parsed = parsePngDataUrl(dataUrl);
  if (!parsed) throw new Error("Invalid PNG data URL");
  const bytes = parsed.isBase64
    ? decodeBase64(parsed.payload)
    : decodePercentData(parsed.payload);
  if (bytes.length < PNG_SIGNATURE.length
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("PNG data URL does not contain a PNG image");
  }
  return bytes;
}

function normalizeCaptureRecord(value) {
  try {
    if (!value || typeof value !== "object") return null;
    const kind = normalizeKind(value.kind);
    const filename = normalizePngFilename(value.filename);
    const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : null;
    const createdAt = normalizeCreatedAt(value.createdAt);
    if (!kind || !filename || !dataUrl || createdAt === null || !hasPngSignature(dataUrl)) return null;
    const id = normalizeCaptureId(value.id, fallbackCaptureId(kind, filename, createdAt, dataUrl));
    // Only inspect the small PNG signature here; repeatedly decoding every
    // archived image while adding one new capture would make a large archive
    // needlessly expensive. buildCaptureZip validates each complete payload.
    return { id, kind, filename, dataUrl, createdAt };
  } catch {
    return null;
  }
}

export function normalizeCaptureRecords(records, maxItems = MAX_CAPTURE_ARCHIVE_ITEMS) {
  if (!Array.isArray(records)) return [];
  const numericLimit = Number(maxItems);
  const limit = maxItems === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(numericLimit) && numericLimit >= 0
      ? Math.trunc(numericLimit)
      : MAX_CAPTURE_ARCHIVE_ITEMS;
  const retainedNewestFirst = [];
  for (let index = records.length - 1;
    index >= 0 && retainedNewestFirst.length < limit;
    index -= 1) {
    let normalized = null;
    try {
      normalized = normalizeCaptureRecord(records[index]);
    } catch {
      // Accessors on a corrupt structured-clone-like test value may throw.
    }
    if (!normalized) continue;
    retainedNewestFirst.push(normalized);
  }
  return retainedNewestFirst.reverse();
}

function supportsArchiveStorage(root) {
  return Boolean(root?.indexedDB) && typeof root.indexedDB.open === "function";
}

function requestToPromise(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(message));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Capture archive transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("Capture archive transaction was aborted"));
  });
}

function openArchiveDatabase(root) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = root.indexedDB.open(ARCHIVE_DATABASE_NAME, ARCHIVE_DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames?.contains(ARCHIVE_STORE_NAME)) {
        database.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open capture archive"));
    request.onblocked = () => reject(new Error("Capture archive upgrade is blocked"));
  });
}

function cancelArchiveOperation(control) {
  control.cancelled = true;
  try { control.transaction?.abort(); } catch { /* It may already be complete. */ }
  try { control.database?.close(); } catch { /* Closing is best-effort. */ }
}

async function withArchiveStore(root, mode, callback, control = null) {
  const database = await openArchiveDatabase(root);
  if (control) control.database = database;
  if (control?.cancelled) {
    database.close();
    throw new Error("Capture archive operation was cancelled");
  }
  let transaction;
  try {
    transaction = database.transaction(ARCHIVE_STORE_NAME, mode);
    if (control) control.transaction = transaction;
    if (control?.cancelled) {
      try { transaction.abort(); } catch { /* It may already be complete. */ }
      throw new Error("Capture archive operation was cancelled");
    }
    const completed = transactionToPromise(transaction);
    // A timeout can abort the transaction while callback() is still awaiting
    // an individual IDB request. Attach a handler immediately so that abort is
    // never reported as an unhandled rejection before the callback unwinds.
    completed.catch(() => {});
    let result;
    try {
      result = await callback(transaction.objectStore(ARCHIVE_STORE_NAME));
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already have aborted. */ }
      await completed.catch(() => {});
      throw error;
    }
    await completed;
    return result;
  } finally {
    if (control?.transaction === transaction) control.transaction = null;
    if (control?.database === database) control.database = null;
    database.close();
  }
}

function runArchiveOperation(root, mode, callback, timeoutMs, fallback) {
  const control = { cancelled: false, database: null, transaction: null };
  return settleWithin(
    () => withArchiveStore(root, mode, callback, control),
    timeoutMs,
    fallback,
    root,
    () => cancelArchiveOperation(control),
  );
}

export async function loadCaptureArchive(root = globalThis, options = {}) {
  if (!supportsArchiveStorage(root)) return null;
  const timeoutMs = timeoutValue(options, ARCHIVE_DATABASE_TIMEOUT_MS);
  const stored = await runArchiveOperation(
    root,
    "readonly",
    (store) => requestToPromise(
      store.getAll(),
      "Could not read capture archive",
    ),
    timeoutMs,
    null,
  );
  if (!Array.isArray(stored)) return null;
  stored.sort((left, right) => Number(left?.createdAt) - Number(right?.createdAt)
    || String(left?.id || "").localeCompare(String(right?.id || "")));
  // Do not cap a database read here. Multiple open Alt1 windows can each add
  // records after their startup snapshot. The app must see every record so it
  // can delete the exact oldest IDs when enforcing the global archive limit;
  // capping here would turn those older records into invisible IDB orphans.
  return normalizeCaptureRecords(stored, Number.POSITIVE_INFINITY).filter((record) => {
    try {
      pngDataUrlToBytes(record.dataUrl);
      return true;
    } catch {
      return false;
    }
  });
}

export async function replaceCaptureArchive(records, root = globalThis, options = {}) {
  if (!supportsArchiveStorage(root)) return false;
  const normalized = normalizeCaptureRecords(records);
  const timeoutMs = timeoutValue(options, ARCHIVE_DATABASE_TIMEOUT_MS);
  return runArchiveOperation(
    root,
    "readwrite",
    async (store) => {
      const requests = [requestToPromise(store.clear(), "Could not clear capture archive")];
      for (let position = 0; position < normalized.length; position += 1) {
        requests.push(requestToPromise(
          store.put(normalized[position]),
          "Could not write capture archive",
        ));
      }
      await Promise.all(requests);
      return true;
    },
    timeoutMs,
    false,
  );
}

export async function upsertCaptureArchive(records, root = globalThis, options = {}) {
  if (!supportsArchiveStorage(root)) return false;
  const normalized = normalizeCaptureRecords(records);
  if (Array.isArray(records) && records.length > 0 && normalized.length === 0) return false;
  const timeoutMs = timeoutValue(options, ARCHIVE_DATABASE_TIMEOUT_MS);
  return runArchiveOperation(
    root,
    "readwrite",
    async (store) => {
      await Promise.all(normalized.map((record) => requestToPromise(
        store.put(record),
        "Could not write capture archive record",
      )));
      return true;
    },
    timeoutMs,
    false,
  );
}

export async function deleteCaptureArchiveRecords(ids, root = globalThis, options = {}) {
  if (!supportsArchiveStorage(root)) return false;
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => normalizeCaptureId(id, null))
    .filter(Boolean))];
  if (!normalizedIds.length) return true;
  const timeoutMs = timeoutValue(options, ARCHIVE_DATABASE_TIMEOUT_MS);
  return runArchiveOperation(
    root,
    "readwrite",
    async (store) => {
      await Promise.all(normalizedIds.map((id) => requestToPromise(
        store.delete(id),
        "Could not delete capture archive record",
      )));
      return true;
    },
    timeoutMs,
    false,
  );
}

export async function clearCaptureArchive(root = globalThis, options = {}) {
  if (!supportsArchiveStorage(root)) return false;
  const timeoutMs = timeoutValue(options, ARCHIVE_DATABASE_TIMEOUT_MS);
  return runArchiveOperation(
    root,
    "readwrite",
    async (store) => {
      await requestToPromise(store.clear(), "Could not clear capture archive");
      return true;
    },
    timeoutMs,
    false,
  );
}

export async function requestPersistentCaptureStorage(root = globalThis, options = {}) {
  const storage = root?.navigator?.storage;
  if (!storage) return false;
  const timeoutMs = timeoutValue(options, STORAGE_PERSIST_TIMEOUT_MS);
  return settleWithin(async () => {
    if (typeof storage.persisted === "function") {
      try {
        if (await storage.persisted()) return true;
      } catch {
        // A failed status check should not prevent the best-effort request.
      }
    }
    if (typeof storage.persist !== "function") return false;
    try {
      return Boolean(await storage.persist());
    } catch {
      return false;
    }
  }, timeoutMs, false, root);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipTimestamp(createdAt) {
  const date = new Date(createdAt);
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear() || 1980));
  const month = Math.min(12, Math.max(1, date.getUTCMonth() + 1 || 1));
  const day = Math.min(31, Math.max(1, date.getUTCDate() || 1));
  const hours = Math.min(23, Math.max(0, date.getUTCHours() || 0));
  const minutes = Math.min(59, Math.max(0, date.getUTCMinutes() || 0));
  const seconds = Math.min(59, Math.max(0, date.getUTCSeconds() || 0));
  return {
    time: (hours << 11) | (minutes << 5) | Math.floor(seconds / 2),
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function zipHeader(length) {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}

function yieldToHost() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function buildCaptureZip(records) {
  const normalized = normalizeCaptureRecords(records);
  const exportable = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (index % 8 === 0) await yieldToHost();
    const record = normalized[index];
    try {
      exportable.push({ record, data: pngDataUrlToBytes(record.dataUrl) });
    } catch {
      // One damaged IndexedDB value must not prevent healthy captures from
      // being recovered. Invalid-only input is rejected below.
    }
  }
  if (Array.isArray(records) && records.length > 0 && exportable.length === 0) {
    throw new Error("No valid PNG captures are available to export");
  }
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (let index = 0; index < exportable.length; index += 1) {
    if (index % 8 === 0) await yieldToHost();
    const { record, data } = exportable[index];
    const filename = encodeUtf8(record.filename);
    if (filename.length > 0xffff || data.length > 0xffffffff) {
      throw new Error(`Capture is too large for a standard ZIP entry: ${record.filename}`);
    }
    const checksum = crc32(data);
    const timestamp = zipTimestamp(record.createdAt);

    const local = zipHeader(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 10, true);
    local.view.setUint16(6, ZIP_UTF8_FLAG, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, timestamp.time, true);
    local.view.setUint16(12, timestamp.date, true);
    local.view.setUint32(14, checksum, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, filename.length, true);
    local.view.setUint16(28, 0, true);
    localParts.push(local.bytes, filename, data);

    const central = zipHeader(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 10, true);
    central.view.setUint16(8, ZIP_UTF8_FLAG, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, timestamp.time, true);
    central.view.setUint16(14, timestamp.date, true);
    central.view.setUint32(16, checksum, true);
    central.view.setUint32(20, data.length, true);
    central.view.setUint32(24, data.length, true);
    central.view.setUint16(28, filename.length, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, localOffset, true);
    centralParts.push(central.bytes, filename);

    localOffset += local.bytes.length + filename.length + data.length;
    if (localOffset > 0xffffffff) throw new Error("Capture archive exceeds the standard ZIP size limit");
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  if (centralSize > 0xffffffff || exportable.length > 0xffff) {
    throw new Error("Capture archive exceeds the standard ZIP directory limit");
  }
  const end = zipHeader(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, exportable.length, true);
  end.view.setUint16(10, exportable.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, localOffset, true);
  end.view.setUint16(20, 0, true);
  const blob = new Blob([...localParts, ...centralParts, end.bytes], { type: "application/zip" });
  Object.defineProperties(blob, {
    captureCount: { value: exportable.length, enumerable: true },
    skippedCaptureCount: {
      value: Math.max(0, (Array.isArray(records) ? records.length : 0) - exportable.length),
      enumerable: true,
    },
  });
  return blob;
}

function safeZipFilename(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const leaf = raw.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_");
  if (!leaf) return "dungeons-captures.zip";
  return /\.zip$/i.test(leaf) ? leaf : `${leaf}.zip`;
}

export function triggerBlobDownload(blob, filename = "dungeons-captures.zip", root = globalThis) {
  const document = root?.document;
  const urlApi = root?.URL;
  if (!blob || !document || typeof document.createElement !== "function"
    || typeof urlApi?.createObjectURL !== "function") return false;

  let url = null;
  let anchor = null;
  try {
    url = urlApi.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeZipFilename(filename);
    anchor.rel = "noopener";
    if (anchor.style) anchor.style.display = "none";
    const parent = document.body || document.documentElement;
    if (parent && typeof parent.appendChild === "function") parent.appendChild(anchor);
    anchor.click();
    if (typeof anchor.remove === "function") anchor.remove();
    else if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    const revoke = () => urlApi.revokeObjectURL?.(url);
    const setTimer = typeof root.setTimeout === "function" ? root.setTimeout.bind(root) : globalThis.setTimeout;
    setTimer(revoke, 1000);
    return true;
  } catch {
    try {
      if (typeof anchor?.remove === "function") anchor.remove();
      if (url) urlApi.revokeObjectURL?.(url);
    } catch { /* Download cleanup is best-effort. */ }
    return false;
  }
}
