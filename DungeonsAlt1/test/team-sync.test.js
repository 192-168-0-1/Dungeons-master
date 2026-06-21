import assert from "node:assert/strict";
import test from "node:test";
import { TeamSync } from "../src/team-sync.js";

globalThis.WebSocket = { OPEN: 1, CLOSING: 2 };

function message(id, name, type, ...fields) {
  return ["TS1", id, name, type, ...fields].map((value) => encodeURIComponent(String(value))).join("|");
}

function connectedClient(name) {
  const client = new TeamSync();
  client.name = name;
  const sent = [];
  client.socket = { readyState: WebSocket.OPEN, send(value) { sent.push(value); } };
  return { client, sent };
}

test("the room creator assigns slots in join order and enforces five players", () => {
  const { client: host, sent } = connectedClient("Leader");
  host.setRoster([{ id: host.clientId, name: host.name, slot: 1 }]);

  for (let number = 2; number <= 5; number += 1) {
    host.handleMessage(message(`player${number}`, `Player ${number}`, "HELLO", "join"));
  }
  host.handleMessage(message("player6", "Player 6", "HELLO", "join"));

  assert.deepEqual(host.members.map((member) => member.slot), [1, 2, 3, 4, 5]);
  assert.equal(host.members.at(-1).name, "Player 5");
  assert.equal(sent.some((line) => decodeURIComponent(line).includes("|FULL|player6")), true);
});

test("a joining client accepts a roster only from its slot-one leader", () => {
  const { client } = connectedClient("Joiner");
  const roster = [
    { id: "leader", name: "Leader", slot: 1 },
    { id: client.clientId, name: "Joiner", slot: 2 },
  ];
  client.handleMessage(message("intruder", "Intruder", "ROSTER", JSON.stringify(roster)));
  assert.equal(client.members.length, 0);

  client.handleMessage(message("leader", "Leader", "ROSTER", JSON.stringify(roster)));
  assert.equal(client.slot, 2);
  assert.equal(client.members[0].name, "Leader");
});

test("annotation and gatestone packets carry the sender party slot", () => {
  const { client, sent } = connectedClient("Player");
  client.setRoster([{ id: client.clientId, name: client.name, slot: 3 }]);
  client.sendAnnotation({ x: 2, y: 4 }, "go");
  client.sendGatestone(2, { x: 3, y: 1 });

  const decoded = sent.map((line) => line.split("|").map(decodeURIComponent));
  assert.deepEqual(decoded[0].slice(3), ["ANN", "2", "4", "go", "3"]);
  assert.deepEqual(decoded[1].slice(3), ["GAT", "2", "3", "1", "3"]);
});

test("scanned RuneScape party order is relayed as sanitized name and slot data", () => {
  const { client, sent } = connectedClient("Player");
  client.sendPartyOrder([
    { slot: 2, name: " s If ", occupied: true },
    { slot: 1, name: "A Ninja", occupied: true },
  ]);
  const fields = sent[0].split("|").map(decodeURIComponent);
  assert.equal(fields[3], "PARTY");
  assert.deepEqual(JSON.parse(fields[4]), [
    { slot: 1, name: "A Ninja", occupied: true },
    { slot: 2, name: "s If", occupied: true },
  ]);
});

test("timed-out members free their slot and the party compacts", () => {
  const { client: host } = connectedClient("Leader");
  host.setRoster([
    { id: host.clientId, name: host.name, slot: 1 },
    { id: "gone", name: "Gone", slot: 2 },
    { id: "staying", name: "Staying", slot: 3 },
  ]);
  const now = Date.now();
  host.lastSeen.set("gone", now - 20_000);
  host.lastSeen.set("staying", now);
  host.removeTimedOutMembers(now);

  assert.deepEqual(host.members.map(({ id, slot }) => ({ id, slot })), [
    { id: host.clientId, slot: 1 },
    { id: "staying", slot: 2 },
  ]);
});
