import {
  addPartyMember,
  normalizePartyRoster,
  parsePartyRoster,
  removePartyMember,
} from "./party-core.js";

const DEFAULT_RELAY = "wss://dungeons-master.onrender.com/team-sync";
const HEARTBEAT_INTERVAL = 5_000;
const MEMBER_TIMEOUT = 16_000;

function cleanRoomCode(value) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function cleanName(value) {
  return String(value ?? "").trim() || "Team mate";
}

function escapeField(value) {
  return encodeURIComponent(String(value ?? ""));
}

function unescapeField(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function createRoomCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 6).toUpperCase();
}

export class TeamSync extends EventTarget {
  constructor() {
    super();
    this.clientId = crypto.randomUUID?.().replaceAll("-", "") ?? `${Date.now()}${Math.random()}`.replaceAll(".", "");
    this.socket = null;
    this.name = "Team mate";
    this.roomCode = "";
    this.roster = [];
    this.slot = null;
    this.isHost = false;
    this.lastSeen = new Map();
    this.heartbeatTimer = null;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get members() {
    return this.roster.map((member) => ({ ...member }));
  }

  member(id = this.clientId) {
    return this.roster.find((candidate) => candidate.id === id) ?? null;
  }

  connect(roomCode, name, relayUrl = DEFAULT_RELAY, { create = false } = {}) {
    this.disconnect(false);
    this.roomCode = cleanRoomCode(roomCode) || createRoomCode();
    this.name = cleanName(name);
    this.isHost = Boolean(create);
    this.setRoster(create ? [{ id: this.clientId, name: this.name, slot: 1 }] : []);
    const url = new URL(relayUrl || DEFAULT_RELAY);
    url.protocol = url.protocol === "http:" ? "ws:" : url.protocol === "https:" ? "wss:" : url.protocol;
    if (!url.pathname || url.pathname === "/") url.pathname = "/team-sync";
    url.searchParams.set("room", this.roomCode);

    this.setStatus(`Connecting to team room ${this.roomCode}…`);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.setStatus(`Connected to team room ${this.roomCode}`);
      this.send("HELLO", this.isHost ? "host" : "join");
      if (this.isHost) this.sendRoster();
      this.startHeartbeat();
      this.dispatchEvent(new CustomEvent("connected"));
    });
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      this.isHost = false;
      this.setRoster([]);
      this.setStatus("Team-sync offline");
      this.dispatchEvent(new CustomEvent("disconnected"));
    });
    socket.addEventListener("error", () => this.setStatus("Team sync could not connect"));
    return this.roomCode;
  }

  disconnect(announce = true) {
    const socket = this.socket;
    if (this.connected) this.send("LEAVE");
    this.socket = null;
    this.stopHeartbeat();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.isHost = false;
    this.setRoster([]);
    if (announce) this.setStatus("Team-sync offline");
  }

  send(type, ...fields) {
    if (!this.connected) return;
    const message = ["TS1", this.clientId, this.name, type, ...fields].map(escapeField).join("|");
    this.socket.send(message);
  }

  sendAnnotation(point, text) {
    this.send("ANN", point.x, point.y, text ?? "", this.slot ?? 0);
  }

  sendClear() {
    this.send("CLEAR");
  }

  sendGatestone(index, point) {
    this.send("GAT", index, point?.x ?? -1, point?.y ?? -1, this.slot ?? 0);
  }

  setRoster(value) {
    this.roster = normalizePartyRoster(value);
    const memberIds = new Set(this.roster.map((member) => member.id));
    for (const id of this.lastSeen.keys()) {
      if (!memberIds.has(id)) this.lastSeen.delete(id);
    }
    const now = Date.now();
    for (const member of this.roster) {
      if (!this.lastSeen.has(member.id)) this.lastSeen.set(member.id, now);
    }
    this.slot = this.member()?.slot ?? null;
    this.isHost = this.slot === 1;
    this.dispatchEvent(new CustomEvent("roster", {
      detail: { members: this.members, selfSlot: this.slot, isHost: this.isHost },
    }));
  }

  sendRoster() {
    if (this.isHost) this.send("ROSTER", JSON.stringify(this.roster));
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.lastSeen.set(this.clientId, Date.now());
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) return;
      this.lastSeen.set(this.clientId, Date.now());
      this.send("PING", this.slot ?? 0);
      this.removeTimedOutMembers();
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  removeTimedOutMembers(now = Date.now()) {
    const stale = this.roster
      .filter((member) => member.id !== this.clientId
        && now - (this.lastSeen.get(member.id) ?? now) > MEMBER_TIMEOUT)
      .map((member) => member.id);
    if (!stale.length) return;

    const wasHost = this.isHost;
    let roster = this.roster;
    for (const id of stale) roster = removePartyMember(roster, id);
    this.setRoster(roster);
    if (wasHost || this.isHost) this.sendRoster();
    for (const senderId of stale) {
      this.dispatchEvent(new CustomEvent("leave", {
        detail: { senderId, senderName: "Team mate", timedOut: true },
      }));
    }
  }

  admitMember(senderId, senderName) {
    const result = addPartyMember(this.roster, { id: senderId, name: senderName });
    if (result.full) {
      this.send("FULL", senderId);
      return;
    }
    this.setRoster(result.roster);
    this.sendRoster();
  }

  handleMessage(line) {
    const fields = line.split("|").map(unescapeField);
    if (fields.length < 4 || fields[0] !== "TS1" || fields[1] === this.clientId) return;
    const senderId = fields[1];
    const senderName = cleanName(fields[2]);
    const type = fields[3];
    this.lastSeen.set(senderId, Date.now());
    if (type === "HELLO") {
      if (this.isHost) this.admitMember(senderId, senderName);
      this.setStatus(`${senderName} joined the team room`);
      this.dispatchEvent(new CustomEvent("hello", { detail: { senderId, senderName } }));
    } else if (type === "ROSTER" && fields.length >= 5 && !this.isHost) {
      const roster = parsePartyRoster(fields[4]);
      const leader = roster.find((member) => member.slot === 1);
      const currentLeader = this.roster.find((member) => member.slot === 1);
      if (leader?.id === senderId && (!currentLeader || currentLeader.id === senderId)) this.setRoster(roster);
    } else if (type === "FULL" && fields[4] === this.clientId) {
      const socket = this.socket;
      this.socket = null;
      this.stopHeartbeat();
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      this.isHost = false;
      this.setRoster([]);
      this.setStatus("This team room is full (5/5)");
      this.dispatchEvent(new CustomEvent("full"));
    } else if (type === "LEAVE") {
      const departingWasLeader = this.roster.some((member) => member.id === senderId && member.slot === 1);
      if (this.roster.some((member) => member.id === senderId)) {
        this.setRoster(removePartyMember(this.roster, senderId));
        if (departingWasLeader && this.isHost) this.sendRoster();
      }
      this.dispatchEvent(new CustomEvent("leave", { detail: { senderId, senderName } }));
    } else if (type === "PING") {
      // Presence is recorded above; no UI event is needed.
    } else if (type === "CLEAR") {
      this.dispatchEvent(new CustomEvent("clear", { detail: { senderId, senderName } }));
    } else if (type === "ANN" && fields.length >= 7) {
      this.dispatchEvent(new CustomEvent("annotation", {
        detail: {
          senderId,
          senderName,
          point: { x: Number(fields[4]), y: Number(fields[5]) },
          text: fields[6],
          slot: Number(fields[7]) || null,
        },
      }));
    } else if (type === "GAT" && fields.length >= 7) {
      this.dispatchEvent(new CustomEvent("gatestone", {
        detail: {
          senderId,
          senderName,
          index: Number(fields[4]),
          point: { x: Number(fields[5]), y: Number(fields[6]) },
          slot: Number(fields[7]) || null,
        },
      }));
    }
  }

  setStatus(text) {
    this.dispatchEvent(new CustomEvent("status", { detail: text }));
  }
}
