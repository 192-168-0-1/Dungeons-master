const DB_NAME = "dungeons-alt1-file-save";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DEFAULT_SAVE_FOLDER_KEY = "save-folder";
const PERMISSION_QUERY_TIMEOUT_MS = 1500;
const PERMISSION_REQUEST_TIMEOUT_MS = 10000;
const FOLDER_WRITE_TIMEOUT_MS = 15000;
const HANDLE_DATABASE_TIMEOUT_MS = 1500;

export function knownAlt1FolderWritesUnsupported(root = globalThis) {
  const api = root?.alt1;
  if (!api) return false;
  const versionInt = Number(api.versionint);
  if (Number.isFinite(versionInt) && versionInt > 0) return versionInt < 1_007_000;
  const match = String(api.version || "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 1 || (major === 1 && minor <= 6);
}

export function supportsFolderSaving(root = globalThis) {
  // IndexedDB is only needed to remember a handle across app restarts. A
  // browser with a working directory picker can still save during this session
  // even when it cannot structured-clone handles into IndexedDB.
  return typeof root?.showDirectoryPicker === "function";
}

function supportsFolderPersistence(root = globalThis) {
  return Boolean(root?.indexedDB) && typeof root.indexedDB.open === "function";
}

function openHandleDatabase(root = globalThis) {
  return new Promise((resolve, reject) => {
    const request = root.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open save-folder storage"));
  });
}

async function withHandleStore(root, mode, callback) {
  const database = await openHandleDatabase(root);
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    return await callback(store);
  } finally {
    database.close();
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Save-folder storage request failed"));
  });
}

function saveFolderKey(key) {
  return String(key || DEFAULT_SAVE_FOLDER_KEY);
}

function settleWithin(operation, timeoutMs, fallback) {
  const wait = Math.max(1, Number(timeoutMs) || 1);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), wait);
    Promise.resolve().then(operation).then(finish, () => finish(fallback));
  });
}

function rejectAfter(operation, timeoutMs) {
  const wait = Math.max(1, Number(timeoutMs) || 1);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error("Folder write permission did not resolve in this Alt1 browser");
      error.name = "TimeoutError";
      finish(reject, error);
    }, wait);
    Promise.resolve().then(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function normalizePermission(value) {
  return ["granted", "prompt", "denied"].includes(value) ? value : "unknown";
}

export async function loadStoredSaveFolder(root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderPersistence(root)) return null;
  try {
    return await settleWithin(
      () => withHandleStore(root, "readonly", (store) => requestToPromise(store.get(saveFolderKey(key)))),
      HANDLE_DATABASE_TIMEOUT_MS,
      null,
    );
  } catch {
    return null;
  }
}

export async function storeSaveFolder(handle, root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderPersistence(root) || !handle) return false;
  try {
    return await settleWithin(
      async () => {
        await withHandleStore(root, "readwrite", (store) => requestToPromise(store.put(handle, saveFolderKey(key))));
        return true;
      },
      HANDLE_DATABASE_TIMEOUT_MS,
      false,
    );
  } catch {
    return false;
  }
}

export async function clearStoredSaveFolder(root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderPersistence(root)) return false;
  try {
    return await settleWithin(
      async () => {
        await withHandleStore(root, "readwrite", (store) => requestToPromise(store.delete(saveFolderKey(key))));
        return true;
      },
      HANDLE_DATABASE_TIMEOUT_MS,
      false,
    );
  } catch {
    return false;
  }
}

export async function querySaveFolderPermission(handle, timeoutMs = PERMISSION_QUERY_TIMEOUT_MS) {
  if (!handle) return "denied";
  // Some Alt1/CEF builds expose writable directory handles without the newer
  // permission-introspection methods. Missing introspection is not a denial;
  // the actual createWritable call remains authoritative.
  if (typeof handle.queryPermission !== "function") return "unknown";
  const permission = await settleWithin(
    () => handle.queryPermission({ mode: "readwrite" }),
    timeoutMs,
    "unknown",
  );
  return normalizePermission(permission);
}

export async function requestSaveFolderPermission(handle, timeoutMs = PERMISSION_REQUEST_TIMEOUT_MS) {
  if (!handle) return "denied";
  if (typeof handle.requestPermission !== "function") {
    return querySaveFolderPermission(handle, Math.min(timeoutMs, PERMISSION_QUERY_TIMEOUT_MS));
  }
  const permission = await settleWithin(
    () => handle.requestPermission({ mode: "readwrite" }),
    timeoutMs,
    "unknown",
  );
  if (permission !== "unknown") return normalizePermission(permission);
  // SecurityError or a host-side timeout commonly means the embedded browser
  // could not show a permission prompt, not that the user explicitly denied it.
  return querySaveFolderPermission(handle, Math.min(timeoutMs, PERMISSION_QUERY_TIMEOUT_MS));
}

export async function chooseSaveFolder(root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderSaving(root)) {
    throw new Error("Folder saving is not supported in this Alt1 browser");
  }
  // Per the File System Access specification, a readwrite directory picker only
  // resolves after that grant succeeds. Do not immediately demand a redundant
  // requestPermission method: older Alt1 Chromium builds may omit it even though
  // the returned handle is already writable.
  const handle = await root.showDirectoryPicker({ id: saveFolderKey(key), mode: "readwrite" });
  if (!handle || typeof handle.getFileHandle !== "function") {
    throw new Error("The selected folder does not expose writable file access");
  }
  await storeSaveFolder(handle, root, key);
  return handle;
}

export function isSaveFolderPermissionError(error) {
  return error?.name === "NotAllowedError"
    || error?.name === "SecurityError"
    || error?.name === "TimeoutError";
}

export function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl ?? "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Invalid PNG data URL");
  const mimeType = match[1] || "application/octet-stream";
  const base64 = Boolean(match[2]);
  const payload = match[3] || "";
  const binary = base64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function writeDataUrlToFolder(handle, filename, dataUrl, { timeoutMs = FOLDER_WRITE_TIMEOUT_MS } = {}) {
  if (!handle || typeof handle.getFileHandle !== "function") {
    throw new Error("No save folder selected");
  }
  await rejectAfter(async () => {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(dataUrlToBlob(dataUrl));
    } finally {
      await writable.close();
    }
  }, timeoutMs);
}
