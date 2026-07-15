import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dataUrlToBlob,
  supportsFolderSaving,
  writeDataUrlToFolder,
} from "../src/file-saver.js";

test("folder saving reports browser support only when picker and IndexedDB are present", () => {
  assert.equal(supportsFolderSaving({ showDirectoryPicker() {}, indexedDB: {} }), true);
  assert.equal(supportsFolderSaving({ indexedDB: {} }), false);
  assert.equal(supportsFolderSaving({ showDirectoryPicker() {} }), false);
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
  assert.match(app, /MAX_PENDING_RESULTS_PNGS = 20/);
  assert.match(app, /pendingResultsPngs\.length >= MAX_PENDING_RESULTS_PNGS/);
  assert.match(app, /if \(folder\.loading \|\| !folder\.handle\) return/);
  assert.match(app, /if \(folder\.handle !== handle\)/);
  assert.match(app, /capture\?\.mapReadAt === state\.lastMapReadAt/);
  assert.match(app, /mapAgeMs <= RESULT_MAP_MAX_AGE_MS/);
  assert.match(app, /lastConsumedAt: state\.lastResultMapConsumedAt/);
  assert.match(app, /resultMapSnapshotIsFresh\(capture/);
  assert.match(app, /capture\.mapSnapshotClaimed = claimed/);
});
