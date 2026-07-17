import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  chooseSaveFolder,
  dataUrlToBlob,
  isSaveFolderPermissionError,
  querySaveFolderPermission,
  requestSaveFolderPermission,
  supportsFolderSaving,
  writeDataUrlToFolder,
} from "../src/file-saver.js";

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
});

test("results PNG retries are bounded and folder actions guard handle races", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const resultsCore = readFileSync(new URL("../src/results-core.js", import.meta.url), "utf8");
  assert.match(app, /MAX_PENDING_RESULTS_PNGS = 20/);
  assert.match(app, /pendingResultsPngs\.length >= MAX_PENDING_RESULTS_PNGS/);
  assert.match(app, /pendingMapPngs\.length >= MAX_PENDING_RESULTS_PNGS/);
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
    pendingMapPngs: [{ filename: "first.png", dataUrl: "first" }],
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
  const retryPendingMapPngs = Function(
    "state",
    "saveFolderState",
    "writePngToSaveFolder",
    "updateSaveFolderStatus",
    "setStatus",
    "MAX_PENDING_RESULTS_PNGS",
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
    () => {},
    20,
  );

  const activeRetry = retryPendingMapPngs({ quiet: true });
  await firstWriteStarted;
  state.pendingMapPngs.push({ filename: "arrived-during-retry.png", dataUrl: "second" });
  await retryPendingMapPngs({ quiet: true });
  releaseFirstWrite();
  const result = await activeRetry;

  assert.deepEqual(writes, ["first.png", "arrived-during-retry.png"]);
  assert.deepEqual(state.pendingMapPngs, []);
  assert.deepEqual(result, { saved: 2, remaining: 0 });
});
