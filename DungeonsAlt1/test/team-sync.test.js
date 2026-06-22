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

test("host can promote manual roster members within non-host slots", () => {
  const { client: host, sent } = connectedClient("Leader");
  host.setRoster([
    { id: host.clientId, name: host.name, slot: 1 },
    { id: "second", name: "Second", slot: 2 },
    { id: "third", name: "Third", slot: 3 },
    { id: "fourth", name: "Fourth", slot: 4 },
  ]);

  const promoted = host.promoteMember("fourth");
  assert.equal(promoted.ok, true);
  assert.deepEqual(host.members.map(({ id, slot }) => ({ id, slot })), [
    { id: host.clientId, slot: 1 },
    { id: "second", slot: 2 },
    { id: "fourth", slot: 3 },
    { id: "third", slot: 4 },
  ]);
  assert.equal(sent.some((line) => decodeURIComponent(line).includes("|ROSTER|")), true);

  const hostLocked = host.promoteMember("second");
  assert.equal(hostLocked.ok, false);
  assert.match(hostLocked.message, /host-locked/);
});

test("non-host clients cannot promote or kick manual roster members", () => {
  const { client } = connectedClient("Second");
  client.setRoster([
    { id: "leader", name: "Leader", slot: 1 },
    { id: client.clientId, name: client.name, slot: 2 },
  ]);

  assert.equal(client.promoteMember(client.clientId).ok, false);
  assert.equal(client.kickMember("leader").ok, false);
});

test("host kick sends KICK, compacts roster and broadcasts the update", () => {
  const { client: host, sent } = connectedClient("Leader");
  host.setRoster([
    { id: host.clientId, name: host.name, slot: 1 },
    { id: "second", name: "Second", slot: 2 },
    { id: "third", name: "Third", slot: 3 },
  ]);

  const result = host.kickMember("second");
  assert.equal(result.ok, true);
  const decoded = sent.map((line) => line.split("|").map(decodeURIComponent));
  assert.equal(decoded.some((fields) => fields[3] === "KICK" && fields[4] === "second"), true);
  assert.equal(decoded.some((fields) => fields[3] === "ROSTER"), true);
  assert.deepEqual(host.members.map(({ id, slot }) => ({ id, slot })), [
    { id: host.clientId, slot: 1 },
    { id: "third", slot: 2 },
  ]);
});

test("a kicked client disconnects locally when targeted by KICK", () => {
  const { client } = connectedClient("Second");
  let closed = false;
  client.socket.close = () => { closed = true; };
  client.mode = "manual";
  client.setRoster([
    { id: "leader", name: "Leader", slot: 1 },
    { id: client.clientId, name: client.name, slot: 2 },
  ]);

  let kicked = false;
  client.addEventListener("kicked", () => { kicked = true; });
  client.handleMessage(message("leader", "Leader", "KICK", client.clientId));

  assert.equal(kicked, true);
  assert.equal(closed, true);
  assert.equal(client.mode, "offline");
  assert.deepEqual(client.members, []);
});

test("manual rooms ignore packets from senders outside the current roster", () => {
  const { client } = connectedClient("Leader");
  client.setRoster([
    { id: client.clientId, name: client.name, slot: 1 },
    { id: "known", name: "Known", slot: 2 },
  ]);
  let annotations = 0;
  let gatestones = 0;
  let parties = 0;
  client.addEventListener("annotation", () => { annotations += 1; });
  client.addEventListener("gatestone", () => { gatestones += 1; });
  client.addEventListener("party", () => { parties += 1; });

  client.handleMessage(message("unknown", "Unknown", "ANN", 1, 2, "go", 3));
  client.handleMessage(message("unknown", "Unknown", "GAT", 1, 2, 3, 3));
  client.handleMessage(message("unknown", "Unknown", "PARTY", JSON.stringify([{ slot: 1, name: "Unknown" }])));
  client.handleMessage(message("known", "Known", "ANN", 1, 2, "go", 2));

  assert.equal(annotations, 1);
  assert.equal(gatestones, 0);
  assert.equal(parties, 0);
});

test("automatic party clients share a peer room without electing duplicate hosts", () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  class PeerSocket {
    static OPEN = 1;
    static CLOSING = 2;

    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.listeners = new Map();
      this.sent = [];
      sockets.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    open() {
      this.readyState = PeerSocket.OPEN;
      this.listeners.get("open")?.();
    }

    send(value) {
      this.sent.push(value);
    }

    close() {
      this.readyState = PeerSocket.CLOSING;
    }
  }

  globalThis.WebSocket = PeerSocket;
  let first;
  let second;
  try {
    first = new TeamSync();
    second = new TeamSync();
    first.connect("DGABC12345", "Leader", "https://relay.example/team-sync", { mode: "peer", slot: 1 });
    second.connect("DGABC12345", "Second", "https://relay.example/team-sync", { mode: "peer", slot: 2 });
    sockets[0].open();
    sockets[1].open();

    assert.equal(first.mode, "peer");
    assert.equal(second.mode, "peer");
    assert.equal(first.isHost, false);
    assert.equal(second.isHost, false);
    assert.deepEqual(first.members, []);
    assert.deepEqual(second.members, []);
    assert.equal(first.slot, 1);
    assert.equal(second.slot, 2);
    assert.match(sockets[0].url, /room=DGABC12345/);
    assert.match(sockets[1].url, /room=DGABC12345/);
    assert.equal(decodeURIComponent(sockets[0].sent[0]).includes("|HELLO|peer"), true);

    first.handleMessage(message("other", "Second", "ROSTER", JSON.stringify([
      { id: "other", name: "Second", slot: 1 },
    ])));
    assert.deepEqual(first.members, []);
    assert.equal(first.slot, 1);
  } finally {
    first?.stopHeartbeat();
    second?.stopHeartbeat();
    globalThis.WebSocket = originalWebSocket;
  }
});
