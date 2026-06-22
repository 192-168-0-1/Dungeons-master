import assert from "node:assert/strict";
import test from "node:test";
import { PARTY_CONTEXT_OPTIONS, clampContextMenuPosition } from "../src/party-menu.js";

test("RuneScape party context menu exposes the requested options", () => {
  assert.deepEqual(PARTY_CONTEXT_OPTIONS, ["Inspect", "Kick", "Promote", "Cancel"]);
});

test("party context menu opens at the click point but stays inside the viewport", () => {
  assert.deepEqual(clampContextMenuPosition(40, 50, 112, 76, 800, 600), { x: 40, y: 50 });
  assert.deepEqual(clampContextMenuPosition(790, 590, 112, 76, 800, 600), { x: 686, y: 522 });
  assert.deepEqual(clampContextMenuPosition(-20, -10, 112, 76, 800, 600), { x: 2, y: 2 });
});
