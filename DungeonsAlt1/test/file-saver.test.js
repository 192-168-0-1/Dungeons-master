import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  chooseSaveFolder,
  dataUrlToBlob,
  isSaveFolderPermissionError,
  knownAlt1FolderWritesUnsupported,
  querySaveFolderPermission,
  requestSaveFolderPermission,
  supportsFolderSaving,
  writeDataUrlToFolder,
} from "../src/file-saver.js";

test("Alt1 1.6 folder writes are disabled without affecting browsers or future hosts", () => {
  assert.equal(knownAlt1FolderWritesUnsupported({}), false);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { version: "1.6.0" } }), true);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { version: "1.6.9" } }), true);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { versionint: 1_006_000 } }), true);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { versionint: 1_006_999 } }), true);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { version: "1.7.0" } }), false);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { versionint: 1_007_000 } }), false);
  assert.equal(knownAlt1FolderWritesUnsupported({ alt1: { version: "unknown" } }), false);
});

test("folder saving needs a picker but not IndexedDB for the current session", () => {
  assert.equal(supportsFolderSaving({ showDirectoryPicker() {}, indexedDB: {} }), true);
  assert.equal(supportsFolderSaving({ showDirectoryPicker() {} }), true);
  assert.equal(supportsFolderSaving({ indexedDB: {} }), false);
});

test("a readwrite picker handle is accepted without a second permission API", async () => {
  const handle = { name: "DG maps", async getFileHandle() {} };
  let options = null;
  const root = {
    async showDirectoryPicker(value) {
      options = value;
      return handle;
    },
  };

  assert.equal(await chooseSaveFolder(root, "map-folder"), handle);
  assert.deepEqual(options, { id: "map-folder", mode: "readwrite" });
});

test("folder selection cannot silently look like a denied permission", async () => {
  await assert.rejects(
    chooseSaveFolder({}, "map-folder"),
    /Folder saving is not supported/,
  );

  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /save folder permission was not granted/);
  assert.match(app, /folder\.permission = "granted"/);
});

test("missing, broken and hanging permission introspection stays unknown", async () => {
  assert.equal(await querySaveFolderPermission({}), "unknown");
  assert.equal(await querySaveFolderPermission({ queryPermission() { throw new Error("CEF"); } }), "unknown");
  assert.equal(await querySaveFolderPermission({ async queryPermission() { return "surprise"; } }), "unknown");
  assert.equal(await querySaveFolderPermission({ async queryPermission() { return "granted"; } }), "granted");
  assert.equal(await querySaveFolderPermission({ queryPermission() { return new Promise(() => {}); } }, 5), "unknown");
});

test("permission requests fall back and cannot hang forever", async () => {
  assert.equal(await requestSaveFolderPermission({ async queryPermission() { return "granted"; } }, 5), "granted");
  assert.equal(await requestSaveFolderPermission({
    requestPermission() { return new Promise(() => {}); },
    async queryPermission() { return "prompt"; },
  }, 5), "prompt");
});

test("data URLs become typed blobs for file-system writes", async () => {
  const blob = dataUrlToBlob("data:image/png;base64,aGVsbG8=");
  assert.equal(blob.type, "image/png");
  assert.equal(await blob.text(), "hello");
});

test("writeDataUrlToFolder writes a PNG blob and closes the stream", async () => {
  const calls = [];
  let written = null;
  let closed = false;
  const folderHandle = {
    async getFileHandle(name, options) {
      calls.push({ name, options });
      return {
        async createWritable() {
          return {
            async write(blob) { written = blob; },
            async close() { closed = true; },
          };
        },
      };
    },
  };

  await writeDataUrlToFolder(folderHandle, "map.png", "data:image/png;base64,aGVsbG8=");

  assert.deepEqual(calls, [{ name: "map.png", options: { create: true } }]);
  assert.equal(written.type, "image/png");
  assert.equal(await written.text(), "hello");
  assert.equal(closed, true);
});

test("folder writes preserve permission failures and bound unresolved CEF prompts", async () => {
  const denied = new Error("blocked");
  denied.name = "NotAllowedError";
  await assert.rejects(
    writeDataUrlToFolder({ async getFileHandle() { throw denied; } }, "map.png", "data:image/png;base64,aA=="),
    (error) => error === denied,
  );
  assert.equal(isSaveFolderPermissionError(denied), true);

  await assert.rejects(
    writeDataUrlToFolder(
      { getFileHandle() { return new Promise(() => {}); } },
      "map.png",
      "data:image/png;base64,aA==",
      { timeoutMs: 5 },
    ),
    (error) => error?.name === "TimeoutError" && isSaveFolderPermissionError(error),
  );
});

test("separate map and results folder picker controls are present in the results UI", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of [
    "choose-map-save-folder",
    "clear-map-save-folder",
    "map-save-folder-status",
    "choose-results-save-folder",
    "clear-results-save-folder",
    "results-save-folder-status",
    "download-capture-archive",
    "clear-capture-archive",
    "capture-archive-status",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("PNG saves do not use download anchors or synthetic clicks", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /downloadDataUrl/);
  assert.doesNotMatch(app, /\.download\s*=/);
  assert.doesNotMatch(app, /\.click\(\)/);
  assert.match(app, /writePngToSaveFolder/);
  assert.match(app, /buildCaptureZip/);
  assert.match(app, /triggerBlobDownload/);
});

test("new archive controls stay optional while an older cached HTML shell is active", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /function ensureCaptureArchiveControls/);
  assert.match(app, /document\.createElement\("button"\)/);
  assert.match(app, /ensureCaptureArchiveControls\(\);\s*bindEvents\(\);/);
  assert.match(app, /elements\.downloadCaptureArchive\?\.addEventListener/);
  assert.match(app, /elements\.clearCaptureArchive\?\.addEventListener/);
});

test("Alt1 host denial is reported as archive fallback instead of asking for the folder again", async () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("async function writePngToSaveFolder");
  const end = app.indexOf("function mapPngFilename", start);
  assert.ok(start >= 0 && end > start, "folder write implementation must be extractable");

  const folder = {
    handle: {},
    name: "DG maps",
    permission: "granted",
    writeVerified: false,
    lastFailure: null,
  };
  const state = {
    saveFolders: { supported: true, hostWriteUnsupported: false },
  };
  const denied = new Error("embedder denied write");
  denied.name = "NotAllowedError";
  let hostFailure = null;
  const writePngToSaveFolder = Function(
    "state",
    "saveFolderTarget",
    "saveFolderState",
    "setStatus",
    "updateSaveFolderStatus",
    "querySaveFolderPermission",
    "canRequestSaveFolderPermission",
    "requestSaveFolderPermission",
    "writeDataUrlToFolder",
    "isSaveFolderPermissionError",
    "markFolderWritesHostUnsupported",
    `${app.slice(start, end)}; return writePngToSaveFolder;`,
  )(
    state,
    () => ({ label: "map" }),
    () => folder,
    () => {},
    () => {},
    async () => "granted",
    () => false,
    async () => "unknown",
    async () => { throw denied; },
    isSaveFolderPermissionError,
    (error, operation) => {
      hostFailure = { error, operation };
      state.saveFolders.hostWriteUnsupported = true;
      return true;
    },
  );

  const result = await writePngToSaveFolder(
    "map", "map.png", "data:image/png;base64,aA==", "Map PNG", { quiet: true },
  );
  assert.deepEqual(result, {
    saved: false,
    reason: "host-unsupported",
    errorName: "NotAllowedError",
  });
  assert.deepEqual(hostFailure, { error: denied, operation: "write" });
  assert.equal(folder.writeVerified, false);
});

test("known unsupported Alt1 status points to the durable ZIP archive", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("function updateSaveFolderStatus");
  const end = app.indexOf("function updateAllSaveFolderStatuses", start);
  assert.ok(start >= 0 && end > start, "folder status implementation must be extractable");
  const elements = {
    choose: { disabled: false },
    clear: { disabled: false },
    reallow: { hidden: false },
    status: { textContent: "" },
  };
  const state = {
    pendingMapPngs: [{ filename: "map.png" }],
    pendingResultsPngs: [],
    droppedMapPngs: 0,
    droppedResultsPngs: 0,
    saveFolders: {
      supported: true,
      hostWriteUnsupported: true,
      map: { handle: null, loading: false, permission: "unsupported" },
    },
  };
  const updateSaveFolderStatus = Function(
    "state",
    "elements",
    "window",
    "saveFolderTarget",
    "saveFolderState",
    "canRequestSaveFolderPermission",
    `${app.slice(start, end)}; return updateSaveFolderStatus;`,
  )(
    state,
    elements,
    { alt1: { version: "1.6.0" } },
    () => ({ label: "map", choose: "choose", clear: "clear", reallow: "reallow", status: "status" }),
    () => state.saveFolders.map,
    () => false,
  );

  updateSaveFolderStatus("map");
  assert.equal(elements.choose.disabled, true);
  assert.equal(elements.reallow.hidden, true);
  assert.match(elements.status.textContent, /cannot write external folders/);
  assert.match(elements.status.textContent, /stored in the capture archive/);
  assert.match(elements.status.textContent, /Download stored captures \(\.zip\)/);
  assert.doesNotMatch(elements.status.textContent, /choose the folder again/i);
});

test("a capture arriving during startup cannot overwrite the archive before restore merges it", async () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("function persistPendingCaptureArchive");
  const end = app.indexOf("function mergeRestoredCaptureRecords", start);
  assert.ok(start >= 0 && end > start, "archive persistence implementation must be extractable");
  const queued = [{ id: "new-id", kind: "map", filename: "new.png", dataUrl: "png", createdAt: 1, persisted: false }];
  const state = {
    pendingMapPngs: queued,
    pendingResultsPngs: [],
    inFlightMapPngs: [],
    inFlightResultsPngs: [],
    captureArchive: {
      loaded: false,
      readSucceeded: false,
      supported: true,
      persistChain: Promise.resolve(true),
    },
  };
  const writes = [];
  const persistPendingCaptureArchive = Function(
    "state",
    "pendingCaptureArchiveRecords",
    "upsertCaptureArchive",
    "window",
    "updateCaptureArchiveStatus",
    `${app.slice(start, end)}; return persistPendingCaptureArchive;`,
  )(
    state,
    () => queued,
    async (records) => { writes.push(records); return true; },
    {},
    () => {},
  );

  await persistPendingCaptureArchive();
  assert.deepEqual(writes, [], "the startup read must finish before the first upsert");
  state.captureArchive.loaded = true;
  state.captureArchive.readSucceeded = true;
  await persistPendingCaptureArchive();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].map(({ persisted: _persisted, ...record }) => record), [
    { id: "new-id", kind: "map", filename: "new.png", dataUrl: "png", createdAt: 1 },
  ]);
  assert.match(app, /state\.captureArchive\.loaded = true;[\s\S]*?await persistPendingCaptureArchive\(\);/);
  assert.match(app, /if \(!Array\.isArray\(records\)\) throw new Error/);
  assert.match(app, /if \(state\.captureArchive\.readSucceeded\) await persistPendingCaptureArchive\(\)/);
});

test("clearing a verified ZIP snapshot keeps captures created after that ZIP", async () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("async function clearPendingCaptureArchive");
  const end = app.indexOf("function markFolderWritesHostUnsupported", start);
  assert.ok(start >= 0 && end > start, "archive clear implementation must be extractable");
  const key = (item) => item.id;
  const exported = { id: "old-id", kind: "map", filename: "exported.png", dataUrl: "old", createdAt: 1 };
  const newer = { id: "new-id", kind: "map", filename: "newer.png", dataUrl: "new", createdAt: 2 };
  const state = {
    pendingMapPngs: [exported, newer],
    pendingResultsPngs: [],
    inFlightMapPngs: [],
    inFlightResultsPngs: [],
    droppedMapPngs: 0,
    droppedResultsPngs: 0,
    retryingMapPngs: false,
    retryingResultsPngs: false,
    captureArchive: {
      exportBusy: false,
      clearBusy: false,
      lastExportCount: 1,
      lastExportKeys: new Set([key(exported)]),
      lastExportHadErrors: false,
    },
  };
  let confirmation = "";
  const statuses = [];
  const clearPendingCaptureArchive = Function(
    "state",
    "pendingCaptureArchiveRecords",
    "captureArchiveRecordKey",
    "window",
    "updateAllSaveFolderStatuses",
    "updateCaptureArchiveStatus",
    "deletePersistedCaptureRecords",
    "persistPendingCaptureArchive",
    "mergeRestoredCaptureRecords",
    "setStatus",
    `${app.slice(start, end)}; return clearPendingCaptureArchive;`,
  )(
    state,
    () => [...state.pendingMapPngs, ...state.pendingResultsPngs],
    key,
    { confirm(message) { confirmation = message; return true; } },
    () => {},
    () => {},
    async () => true,
    async () => true,
    (current, restored) => [...restored, ...current],
    (message, tone) => statuses.push({ message, tone }),
  );

  await clearPendingCaptureArchive();
  assert.match(confirmation, /1 newer capture will be kept/);
  assert.deepEqual(state.pendingMapPngs, [newer]);
  assert.match(statuses.at(-1).message, /kept 1 newer/);

  const failedState = {
    pendingMapPngs: [{ ...exported, persisted: true }],
    pendingResultsPngs: [],
    inFlightMapPngs: [],
    inFlightResultsPngs: [],
    droppedMapPngs: 0,
    droppedResultsPngs: 0,
    retryingMapPngs: false,
    retryingResultsPngs: false,
    captureArchive: {
      exportBusy: false,
      clearBusy: false,
      lastExportCount: 0,
      lastExportKeys: new Set(),
      lastExportHadErrors: false,
    },
  };
  let reUpserts = 0;
  const clearAfterDeleteFailure = Function(
    "state",
    "pendingCaptureArchiveRecords",
    "captureArchiveRecordKey",
    "captureArchiveKind",
    "window",
    "updateAllSaveFolderStatuses",
    "updateCaptureArchiveStatus",
    "deletePersistedCaptureRecords",
    "persistPendingCaptureArchive",
    "mergeRestoredCaptureRecords",
    "setStatus",
    `${app.slice(start, end)}; return clearPendingCaptureArchive;`,
  )(
    failedState,
    () => [...failedState.pendingMapPngs, ...failedState.pendingResultsPngs],
    key,
    (record) => record.kind,
    { confirm() { return true; } },
    () => {},
    () => {},
    async () => false,
    async () => { reUpserts += 1; return true; },
    (current) => current,
    () => {},
  );
  await clearAfterDeleteFailure();
  assert.equal(reUpserts, 1);
  assert.equal(failedState.pendingMapPngs.length, 1);
  assert.equal(failedState.pendingMapPngs[0].persisted, false);
});

test("the global archive limit removes the exact oldest IDs after a multi-window restore", async () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("function enforceCaptureArchiveItemLimit");
  const end = app.indexOf("async function restorePendingCaptureArchive", start);
  assert.ok(start >= 0 && end > start, "archive limit implementation must be extractable");
  const make = (kind, index) => ({
    id: `${kind}-${index}`,
    kind,
    filename: `${kind}-${index}.png`,
    dataUrl: "png",
    createdAt: index,
    persisted: true,
  });
  const state = {
    pendingMapPngs: Array.from({ length: 130 }, (_, index) => make("map", index)),
    pendingResultsPngs: Array.from({ length: 100 }, (_, index) => make("results", 130 + index)),
    droppedMapPngs: 0,
    droppedResultsPngs: 0,
  };
  const deleted = [];
  const enforceCaptureArchiveItemLimit = Function(
    "state",
    "MAX_CAPTURE_ARCHIVE_ITEMS",
    "deletePersistedCaptureRecords",
    `${app.slice(start, end)}; return enforceCaptureArchiveItemLimit;`,
  )(
    state,
    200,
    async (records) => { deleted.push(...records.map((record) => record.id)); return true; },
  );

  assert.equal(await enforceCaptureArchiveItemLimit(), true);
  assert.equal(state.pendingMapPngs.length + state.pendingResultsPngs.length, 200);
  assert.deepEqual(deleted, Array.from({ length: 30 }, (_, index) => `map-${index}`));
  assert.equal(state.droppedMapPngs, 30);
  assert.equal(state.droppedResultsPngs, 0);
});

test("captures are archived before any potentially hanging external folder write", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const mapStart = app.indexOf("async function saveMap");
  const mapEnd = app.indexOf("function resultsPngFilename", mapStart);
  const resultsStart = app.indexOf("async function saveResultsInterfacePng");
  const resultsEnd = app.indexOf("function queuePendingMapPng", resultsStart);
  const mapSave = app.slice(mapStart, mapEnd);
  const resultsSave = app.slice(resultsStart, resultsEnd);
  assert.ok(mapSave.indexOf("queuePendingMapPng") < mapSave.indexOf("writePngToSaveFolder"));
  assert.ok(resultsSave.indexOf("queuePendingResultsPng") < resultsSave.indexOf("writePngToSaveFolder"));
  assert.doesNotMatch(app, /replaceCaptureArchive/);
  assert.match(app, /upsertCaptureArchive/);
  assert.match(app, /deleteCaptureArchiveRecords/);
  assert.match(app, /getMilliseconds\(\).*padStart\(3, "0"\)/s);
  assert.match(app, /findIndex\(\(item\) => item\.id === prepared\.id\)/);
  assert.match(app, /if \(!knownAlt1FolderWritesUnsupported\(window\)\) return false/);
  assert.match(app, /"host-unsupported": "stored in the capture archive/);
});

test("results PNG retries are bounded and folder actions guard handle races", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const resultsCore = readFileSync(new URL("../src/results-core.js", import.meta.url), "utf8");
  assert.match(app, /combined\.length - MAX_CAPTURE_ARCHIVE_ITEMS/);
  assert.match(app, /deletePersistedCaptureRecords\(dropped\.map/);
  assert.doesNotMatch(app, /slice\(-MAX_PENDING_RESULTS_PNGS\)/);
  assert.match(app, /queuePendingMapPng\(artifact\)/);
  assert.match(app, /const artifact = await saveMap\(\);\s*queuePendingMapPng\(artifact\)/);
  assert.match(app, /retryPendingMapPngs/);
  assert.match(app, /if \(folder\.loading \|\| !folder\.handle\) return/);
  assert.match(app, /if \(folder\.handle !== handle\)/);
  assert.match(app, /folder\.permission = "granted"/);
  assert.match(app, /function canRequestSaveFolderPermission/);
  assert.match(app, /return !hasAlt1\(\) && typeof folder\?\.handle\?\.requestPermission/);
  assert.match(app, /permission === "prompt" \|\| permission === "denied"/);
  assert.match(app, /folder\.permission = "granted"/);
  assert.match(app, /isSaveFolderPermissionError\(error\)/);
  assert.match(app, /folder\.permission !== "prompt"/);
  assert.match(app, /\["granted", "unknown"\]\.includes\(saveFolderState\("map"\)\.permission\)/);
  assert.match(app, /\["granted", "unknown"\]\.includes\(saveFolderState\("results"\)\.permission\)/);
  assert.match(app, /capture\?\.mapDataUrl/);
  assert.match(app, /dataUrl: capture\.mapDataUrl/);
  assert.match(app, /resultMapSnapshotMatchesGeneration\(capture/);
  assert.match(resultsCore, /snapshotRevision > Math\.max\(0, Number\(lastConsumedSnapshotRevision\)/);
  assert.match(resultsCore, /generation >= consumedGeneration/);
  assert.match(resultsCore, /capture\?\.mapFloorName === capture\.ocrFloorSize/);
  assert.match(app, /state\.mapGeneration \+= 1/);
  assert.match(app, /capture\.mapSnapshotClaimed = claimed/);
  const commitStart = app.indexOf("async function commitDungeonResultsCapture");
  const commitEnd = app.indexOf("async function captureDungeonResults", commitStart);
  const commit = app.slice(commitStart, commitEnd);
  assert.ok(commit.indexOf("prepareResultBatch(result)") < commit.indexOf("claimResultMapSnapshot(capture)"));
});

test("a map queued during an active retry is drained before that retry finishes", async () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("async function retryPendingMapPngs");
  const end = app.indexOf("function queuePendingResultsPng", start);
  assert.ok(start >= 0 && end > start, "map retry implementation must be extractable");

  const state = {
    pendingMapPngs: [{ id: "first-id", filename: "first.png", dataUrl: "first", persisted: true }],
    inFlightMapPngs: [],
    retryingMapPngs: false,
    retryMapPngsRequested: false,
    retryMapPngsNotify: false,
    droppedMapPngs: 0,
    saveFolders: {
      supported: true,
      map: { handle: {}, permission: "granted" },
    },
  };
  let releaseFirstWrite;
  let reportFirstWriteStarted;
  const firstWriteStarted = new Promise((resolve) => { reportFirstWriteStarted = resolve; });
  const firstWriteReleased = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const writes = [];
  const durableSnapshots = [];
  const persistArchive = () => {
    durableSnapshots.push([...state.inFlightMapPngs, ...state.pendingMapPngs].map((item) => item.filename));
    return Promise.resolve(true);
  };
  const retryPendingMapPngs = Function(
    "state",
    "saveFolderState",
    "writePngToSaveFolder",
    "updateSaveFolderStatus",
    "persistPendingCaptureArchive",
    "updateCaptureArchiveStatus",
    "deletePersistedCaptureRecords",
    "mergeRestoredCaptureRecords",
    "enforceCaptureArchiveItemLimit",
    "setStatus",
    `${app.slice(start, end)}; return retryPendingMapPngs;`,
  )(
    state,
    () => state.saveFolders.map,
    async (_kind, filename) => {
      writes.push(filename);
      if (filename === "first.png") {
        reportFirstWriteStarted();
        await firstWriteReleased;
      }
      return { saved: true };
    },
    () => {},
    persistArchive,
    () => Promise.resolve(true),
    async () => true,
    (current, restored) => [...restored, ...current],
    () => Promise.resolve(true),
    () => {},
  );

  const activeRetry = retryPendingMapPngs({ quiet: true });
  await firstWriteStarted;
  state.pendingMapPngs.push({ id: "second-id", filename: "arrived-during-retry.png", dataUrl: "second", persisted: true });
  await persistArchive();
  assert.deepEqual(durableSnapshots.at(-1), ["first.png", "arrived-during-retry.png"]);
  await retryPendingMapPngs({ quiet: true });
  releaseFirstWrite();
  const result = await activeRetry;

  assert.deepEqual(writes, ["first.png", "arrived-during-retry.png"]);
  assert.deepEqual(state.pendingMapPngs, []);
  assert.deepEqual(result, { saved: 2, remaining: 0 });
});
