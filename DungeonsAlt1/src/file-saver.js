const DB_NAME = "dungeons-alt1-file-save";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DEFAULT_SAVE_FOLDER_KEY = "save-folder";

export function supportsFolderSaving(root = globalThis) {
  return typeof root?.showDirectoryPicker === "function" && typeof root?.indexedDB !== "undefined";
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

export async function loadStoredSaveFolder(root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderSaving(root)) return null;
  try {
    return await withHandleStore(root, "readonly", (store) => requestToPromise(store.get(saveFolderKey(key))));
  } catch {
    return null;
  }
}

export async function storeSaveFolder(handle, root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderSaving(root) || !handle) return false;
  try {
    await withHandleStore(root, "readwrite", (store) => requestToPromise(store.put(handle, saveFolderKey(key))));
    return true;
  } catch {
    return false;
  }
}

export async function clearStoredSaveFolder(root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderSaving(root)) return false;
  try {
    await withHandleStore(root, "readwrite", (store) => requestToPromise(store.delete(saveFolderKey(key))));
    return true;
  } catch {
    return false;
  }
}

export async function querySaveFolderPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return "prompt";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

export async function requestSaveFolderPermission(handle) {
  if (!handle) return "denied";
  if (typeof handle.requestPermission !== "function") return "prompt";
  try {
    return await handle.requestPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

export async function chooseSaveFolder(root = globalThis, key = DEFAULT_SAVE_FOLDER_KEY) {
  if (!supportsFolderSaving(root)) return null;
  const handle = await root.showDirectoryPicker({ mode: "readwrite" });
  const permission = await requestSaveFolderPermission(handle);
  if (permission !== "granted") return null;
  await storeSaveFolder(handle, root, key);
  return handle;
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

export async function writeDataUrlToFolder(handle, filename, dataUrl) {
  if (!handle || typeof handle.getFileHandle !== "function") {
    throw new Error("No save folder selected");
  }
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(dataUrlToBlob(dataUrl));
  } finally {
    await writable.close();
  }
}
