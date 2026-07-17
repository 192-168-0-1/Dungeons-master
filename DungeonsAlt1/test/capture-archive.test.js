import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CAPTURE_ARCHIVE_ITEMS,
  buildCaptureZip,
  clearCaptureArchive,
  deleteCaptureArchiveRecords,
  loadCaptureArchive,
  normalizeCaptureRecords,
  replaceCaptureArchive,
  requestPersistentCaptureStorage,
  triggerBlobDownload,
  upsertCaptureArchive,
} from "../src/capture-archive.js";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function capture(overrides = {}) {
  const kind = overrides.kind || "map";
  const filename = overrides.filename || "dungeon-map-f1.png";
  const createdAt = overrides.createdAt ?? 1_750_000_000_000;
  return {
    id: overrides.id || `test-${createdAt}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`,
    kind,
    filename,
    dataUrl: PNG_DATA_URL,
    createdAt,
    ...overrides,
  };
}

function makeRequest(transaction, operation) {
  const request = {};
  transaction.pending += 1;
  const run = () => {
    if (transaction.aborted) return;
    try {
      request.result = operation();
      request.onsuccess?.({ target: request });
    } catch (error) {
      request.error = error;
      transaction.error = error;
      request.onerror?.({ target: request });
      transaction.onerror?.({ target: transaction });
    } finally {
      transaction.pending -= 1;
      transaction.maybeComplete();
    }
  };
  if (transaction.requestDelayMs > 0) setTimeout(run, transaction.requestDelayMs);
  else queueMicrotask(run);
  return request;
}

function fakeIndexedDbRoot() {
  const stores = new Map();
  let opened = false;
  let requestDelayMs = 0;

  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name, options = {}) {
      const state = { keyPath: options.keyPath, records: new Map() };
      stores.set(name, state);
      return state;
    },
    transaction(name) {
      const state = stores.get(name);
      if (!state) throw new Error(`Missing object store ${name}`);
      const transaction = {
        requestDelayMs,
        pending: 0,
        aborted: false,
        completeScheduled: false,
        error: null,
        maybeComplete() {
          if (this.aborted || this.pending || this.completeScheduled) return;
          this.completeScheduled = true;
          queueMicrotask(() => {
            if (!this.aborted && this.pending === 0) this.oncomplete?.({ target: this });
          });
        },
        abort() {
          if (this.aborted) return;
          this.aborted = true;
          queueMicrotask(() => this.onabort?.({ target: this }));
        },
        objectStore() {
          return {
            clear: () => makeRequest(transaction, () => {
              state.records.clear();
              return undefined;
            }),
            put: (value) => makeRequest(transaction, () => {
              const key = value[state.keyPath];
              state.records.set(key, structuredClone(value));
              return key;
            }),
            delete: (key) => makeRequest(transaction, () => state.records.delete(key)),
            getAll: () => makeRequest(transaction, () => (
              [...state.records.values()].map((value) => structuredClone(value))
            )),
          };
        },
      };
      queueMicrotask(() => transaction.maybeComplete());
      return transaction;
    },
    close() {},
  };

  return {
    indexedDB: {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          if (!opened) {
            opened = true;
            request.onupgradeneeded?.({ target: request });
          }
          queueMicrotask(() => request.onsuccess?.({ target: request }));
        });
        return request;
      },
    },
    setTimeout,
    clearTimeout,
    seedStoredCapture(value) {
      stores.get("captures").records.set(value.id, structuredClone(value));
    },
    setRequestDelay(value) {
      requestDelayMs = Math.max(0, Number(value) || 0);
    },
  };
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function parseZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const endOffset = bytes.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50, "end-of-central-directory signature");
  const count = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  assert.equal(centralOffset + centralSize, endOffset);

  const locals = [];
  let offset = 0;
  while (offset < centralOffset) {
    assert.equal(view.getUint32(offset, true), 0x04034b50, "local-file signature");
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    assert.equal(view.getUint32(offset + 22, true), size, "stored sizes match");
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + size);
    locals.push({
      offset,
      flags,
      method,
      checksum,
      filename: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
      data,
    });
    offset = dataStart + size;
  }

  const central = [];
  offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "central-directory signature");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    central.push({
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      checksum: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
      filename: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset);
  return { bytes, locals, central, count };
}

test("capture records are validated, normalized and capped to the newest 200", () => {
  const explosive = {};
  Object.defineProperty(explosive, "kind", { get() { throw new Error("corrupt clone"); } });
  const records = Array.from({ length: MAX_CAPTURE_ARCHIVE_ITEMS + 5 }, (_, index) => capture({
    filename: `map-${index}.png`,
    createdAt: index,
  }));
  records.splice(20, 0, null, explosive, capture({ dataUrl: "data:image/png;base64,bm90LXBuZw==" }));

  const normalized = normalizeCaptureRecords(records);
  assert.equal(MAX_CAPTURE_ARCHIVE_ITEMS, 200);
  assert.equal(normalized.length, 200);
  assert.equal(normalized[0].filename, "map-5.png");
  assert.equal(normalized.at(-1).filename, "map-204.png");
  const unsafe = capture({
    kind: " RESULTS ",
    filename: "../unsafe:name.png",
    createdAt: "2026-07-18T10:00:00.000Z",
  });
  assert.deepEqual(normalizeCaptureRecords([unsafe]), [{
    id: unsafe.id,
    kind: "results",
    filename: "unsafe_name.png",
    dataUrl: PNG_DATA_URL,
    createdAt: Date.parse("2026-07-18T10:00:00.000Z"),
  }]);
});

test("capture archive survives an IndexedDB replace/load/clear roundtrip", async () => {
  const root = fakeIndexedDbRoot();
  const expected = [capture(), capture({
    kind: "results",
    filename: "dungeon-results-f1.png",
    createdAt: 1_750_000_001_000,
  })];

  assert.equal(await replaceCaptureArchive(expected, root, { timeoutMs: 100 }), true);
  assert.deepEqual(await loadCaptureArchive(root, { timeoutMs: 100 }), expected);

  root.seedStoredCapture({
    id: "corrupt-99",
    kind: "map",
    filename: "corrupt.png",
    dataUrl: "not-a-data-url",
    createdAt: 1,
  });
  root.seedStoredCapture({
    id: "corrupt-100",
    kind: "map",
    filename: "late-corrupt.png",
    dataUrl: `${PNG_DATA_URL}!`,
    createdAt: 2,
  });
  assert.deepEqual(await loadCaptureArchive(root, { timeoutMs: 100 }), expected);
  assert.equal(await clearCaptureArchive(root, { timeoutMs: 100 }), true);
  assert.deepEqual(await loadCaptureArchive(root, { timeoutMs: 100 }), []);
});

test("per-record upsert and delete preserve captures written by another app window", async () => {
  const root = fakeIndexedDbRoot();
  const firstWindow = capture({ id: "window-a-map", filename: "window-a.png", createdAt: 1 });
  const secondWindow = capture({ id: "window-b-map", filename: "window-b.png", createdAt: 2 });
  assert.equal(await upsertCaptureArchive([firstWindow], root, 100), true);
  assert.equal(await upsertCaptureArchive([secondWindow], root, 100), true);
  assert.deepEqual(await loadCaptureArchive(root, 100), [firstWindow, secondWindow]);
  assert.equal(await deleteCaptureArchiveRecords([firstWindow.id], root, 100), true);
  assert.deepEqual(await loadCaptureArchive(root, 100), [secondWindow]);
});

test("loading exposes every multi-window record so the app can trim exact oldest IDs", async () => {
  const root = fakeIndexedDbRoot();
  const firstWindow = Array.from({ length: 120 }, (_, index) => capture({
    id: `window-a-${index}`,
    filename: `window-a-${index}.png`,
    createdAt: index,
  }));
  const secondWindow = Array.from({ length: 120 }, (_, index) => capture({
    id: `window-b-${index}`,
    filename: `window-b-${index}.png`,
    createdAt: 120 + index,
  }));
  assert.equal(await upsertCaptureArchive(firstWindow, root, 100), true);
  assert.equal(await upsertCaptureArchive(secondWindow, root, 100), true);
  const loaded = await loadCaptureArchive(root, 100);
  assert.equal(loaded.length, 240);
  assert.equal(loaded[0].id, "window-a-0");
  assert.equal(loaded.at(-1).id, "window-b-119");
});

test("IndexedDB operations fail closed within their caller-supplied time bound", async () => {
  const root = { indexedDB: { open: () => ({}) } };
  const started = Date.now();
  assert.equal(await loadCaptureArchive(root, { timeoutMs: 5 }), null);
  assert.equal(await loadCaptureArchive({}, { timeoutMs: 5 }), null);
  assert.equal(await replaceCaptureArchive([capture()], root, 5), false);
  assert.equal(await clearCaptureArchive(root, { timeoutMs: 5 }), false);
  assert.ok(Date.now() - started < 250, "hanging IndexedDB requests must not hang startup");
});

test("a timed-out delete is aborted and cannot remove the record later", async () => {
  const root = fakeIndexedDbRoot();
  const expected = capture({ id: "keep-after-timeout" });
  assert.equal(await upsertCaptureArchive([expected], root, 100), true);
  root.setRequestDelay(30);
  assert.equal(await deleteCaptureArchiveRecords([expected.id], root, 5), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  root.setRequestDelay(0);
  assert.deepEqual(await loadCaptureArchive(root, 100), [expected]);
});

test("persistent storage requests are best-effort and time-bounded", async () => {
  let requests = 0;
  assert.equal(await requestPersistentCaptureStorage({
    navigator: { storage: {
      async persisted() { return false; },
      async persist() { requests += 1; return true; },
    } },
  }), true);
  assert.equal(requests, 1);

  assert.equal(await requestPersistentCaptureStorage({
    navigator: { storage: {
      async persisted() { return true; },
      async persist() { throw new Error("must not run"); },
    } },
  }), true);
  assert.equal(await requestPersistentCaptureStorage({
    navigator: { storage: { persist: () => new Promise(() => {}) } },
  }, { timeoutMs: 5 }), false);
  assert.equal(await requestPersistentCaptureStorage({}), false);
});

test("ZIP builder emits standard stored entries with UTF-8 names and valid CRC32", async () => {
  const originalBytes = Uint8Array.from(Buffer.from(PNG_DATA_URL.split(",")[1], "base64"));
  const percentDataUrl = `data:image/png,${[...originalBytes]
    .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
    .join("")}`;
  const records = [
    capture({ filename: "dungeon-map-f1.png" }),
    capture({ filename: "corrupt-late.png", dataUrl: `${PNG_DATA_URL}!` }),
    capture({ kind: "results", filename: "resultaten-完.png", dataUrl: percentDataUrl, createdAt: 2 }),
  ];
  const blob = await buildCaptureZip(records);
  const zip = await parseZip(blob);

  assert.equal(blob.type, "application/zip");
  assert.equal(blob.captureCount, 2);
  assert.equal(blob.skippedCaptureCount, 1);
  assert.equal(zip.count, 2);
  const validRecords = [records[0], records[2]];
  assert.deepEqual(zip.locals.map((entry) => entry.filename), validRecords.map((record) => record.filename));
  assert.deepEqual(zip.central.map((entry) => entry.filename), validRecords.map((record) => record.filename));
  for (let index = 0; index < zip.locals.length; index += 1) {
    const local = zip.locals[index];
    const central = zip.central[index];
    assert.equal(local.flags & 0x0800, 0x0800, "local name is explicitly UTF-8");
    assert.equal(central.flags & 0x0800, 0x0800, "central name is explicitly UTF-8");
    assert.equal(local.method, 0, "entry is uncompressed/store");
    assert.equal(central.method, 0, "central method is store");
    assert.equal(local.checksum, crc32(local.data));
    assert.equal(central.checksum, local.checksum);
    assert.equal(central.size, local.data.length);
    assert.equal(central.compressedSize, local.data.length);
    assert.equal(central.localOffset, local.offset);
    assert.deepEqual(local.data, originalBytes);
  }
});

test("empty input produces an empty ZIP but invalid-only input cannot look successful", async () => {
  const zip = await parseZip(await buildCaptureZip([]));
  assert.equal(zip.count, 0);
  assert.equal(zip.bytes.length, 22);
  await assert.rejects(
    buildCaptureZip([null, { kind: "broken" }, capture({ dataUrl: `${PNG_DATA_URL}!` })]),
    /No valid PNG captures/,
  );
});

test("browser download helper clicks one hidden anchor and revokes its Blob URL", () => {
  const calls = [];
  const anchor = {
    style: {},
    click() { calls.push("click"); },
    remove() { calls.push("remove"); },
  };
  const root = {
    document: {
      body: { appendChild(value) { assert.equal(value, anchor); calls.push("append"); } },
      createElement(name) { assert.equal(name, "a"); return anchor; },
    },
    URL: {
      createObjectURL(blob) { assert.equal(blob.type, "application/zip"); return "blob:capture"; },
      revokeObjectURL(url) { calls.push(`revoke:${url}`); },
    },
    setTimeout(callback, delay) { assert.equal(delay, 1000); callback(); },
  };
  const blob = new Blob([], { type: "application/zip" });
  assert.equal(triggerBlobDownload(blob, "../DG captures", root), true);
  assert.equal(anchor.href, "blob:capture");
  assert.equal(anchor.download, "DG captures.zip");
  assert.equal(anchor.rel, "noopener");
  assert.equal(anchor.style.display, "none");
  assert.deepEqual(calls, ["append", "click", "remove", "revoke:blob:capture"]);
  assert.equal(triggerBlobDownload(blob, "archive.zip", {}), false);
});
