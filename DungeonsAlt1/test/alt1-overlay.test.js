import assert from "node:assert/strict";
import test from "node:test";
import { FLOOR_SIZES } from "../src/map-core.js";
import {
  assignGatestoneSlots,
  buildMapOverlayCommands,
  buildTestOverlayCommands,
  drawOverlayGroup,
  formatMapStats,
  hexToOverlayColor,
  mixColor,
} from "../src/alt1-overlay.js";

const floor = FLOOR_SIZES.find((candidate) => candidate.name === "Small");

test("Alt1 colors include an opaque ARGB alpha byte", () => {
  assert.equal(mixColor(255, 255, 255), -1);
  assert.equal(mixColor(255, 0, 255), -65281);
  assert.equal(mixColor(1, 2, 3, 180) >>> 24, 180);
  assert.equal(hexToOverlayColor("#ffd23f") >>> 24, 255);
});

test("gatestone slots are allocated per room and invalid points are ignored", () => {
  const markers = assignGatestoneSlots([
    { point: { x: 1, y: 1 }, text: "G1" },
    { point: { x: 1, y: 1 }, text: "2" },
    { point: { x: 2, y: 1 }, text: "G2" },
    { point: { x: 99, y: 99 }, text: "invalid" },
  ], floor);

  assert.deepEqual(markers.map(({ text, slot }) => ({ text, slot })), [
    { text: "G1", slot: 0 },
    { text: "2", slot: 1 },
    { text: "G2", slot: 0 },
  ]);
});

test("map stats match the desktop EXE wording and RPM calculation", () => {
  assert.equal(formatMapStats({ rooms: 1, mystery: 3, deadEnds: 2, minutes: 2 }),
    "1 room (4) | 0.1 rpm | 2 dead ends");
  assert.equal(formatMapStats({ rooms: 12, mystery: 4, deadEnds: 5, minutes: 2 }),
    "12 rooms (16) | 5.6 rpm | 5 dead ends");
});

test("map commands use client-relative coordinates and include every marker type", () => {
  const gatestones = assignGatestoneSlots([
    { source: "local", point: { x: 1, y: 1 }, text: "G1", fill: "#ffd23f", textColor: "#111111" },
    { source: "team", point: { x: 1, y: 1 }, text: "2", fill: "#35b7e8", textColor: "#ffffff" },
    { source: "team", point: { x: -1, y: 0 }, text: "invalid", fill: "#ffffff", textColor: "#000000" },
  ], floor);
  const commands = buildMapOverlayCommands({
    mapX: 100,
    mapY: 50,
    floor,
    annotations: [
      { point: { x: 0, y: 0 }, text: "b", color: "#e7502b" },
      { point: { x: 9, y: 9 }, text: "invalid" },
    ],
    manualCritical: [{ x: 2, y: 2 }, { x: -1, y: 0 }],
    gatestones,
    stats: "4 rooms (7) | 3.2 rpm | 1 dead ends",
    duration: 30_000,
  });

  const annotation = commands.find((command) => command.type === "text" && command.text === "b");
  assert.deepEqual({ x: annotation.x, y: annotation.y }, { x: 128, y: 174 });
  assert.equal(annotation.color >>> 24, 255);
  assert.equal(annotation.color, hexToOverlayColor("#e7502b"));

  const local = commands.find((command) => command.type === "text" && command.text === "G1");
  const team = commands.find((command) => command.type === "text" && command.text === "2");
  assert.deepEqual({ x: local.x, y: local.y }, { x: 151, y: 152 });
  assert.notDeepEqual({ x: team.x, y: team.y }, { x: local.x, y: local.y });
  assert.equal(commands.some((command) => command.text === "invalid"), false);
  const stats = commands.find((command) => command.text === "4 rooms (7) | 3.2 rpm | 1 dead ends");
  const statsBackground = commands.find((command) => command.type === "rect"
    && command.y === 202 && command.height === 21);
  assert.deepEqual({ x: stats.x, y: stats.y, centered: stats.centered, shadow: stats.shadow },
    { x: 103, y: 205, centered: false, shadow: false });
  assert.equal(stats.color, mixColor(255, 255, 255));
  assert.ok(statsBackground);
  assert.equal(statsBackground.color, mixColor(0, 0, 0));
  assert.ok(statsBackground.width >= floor.imageWidth);
});

test("test overlay stays in RuneScape-client coordinates", () => {
  const commands = buildTestOverlayCommands({ x: 123.4, y: 45.6, width: 280, height: 152 });
  assert.deepEqual(
    { x: commands[0].x, y: commands[0].y, width: commands[0].width, height: commands[0].height },
    { x: 123, y: 46, width: 280, height: 152 },
  );
  assert.equal(commands[1].font, "");
  assert.equal(commands.every((command) => (command.color >>> 24) === 255), true);
});

test("overlay groups report rejected calls and always reset and refresh", () => {
  const calls = [];
  const api = {
    overLayFreezeGroup(group) { calls.push(["freeze", group]); },
    overLayClearGroup(group) { calls.push(["clear", group]); },
    overLaySetGroup(group) { calls.push(["set", group]); },
    overLayRefreshGroup(group) { calls.push(["refresh", group]); },
    overLayRect(...args) { calls.push(["rect", ...args]); return true; },
    overLayTextEx(...args) { calls.push(["text", ...args]); return false; },
  };
  const report = drawOverlayGroup(api, "test", buildTestOverlayCommands({
    x: 10, y: 20, width: 30, height: 40,
  }));

  assert.deepEqual(report, { sent: 2, rejected: 1 });
  assert.deepEqual(calls.slice(0, 3), [["freeze", "test"], ["clear", "test"], ["set", "test"]]);
  assert.deepEqual(calls.slice(-2), [["set", ""], ["refresh", "test"]]);
});
