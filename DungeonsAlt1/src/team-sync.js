import {
  addPartyMember,
  normalizeObservedParty,
  normalizePartyRoster,
  parsePartyRoster,
  removePartyMember,
} from "./party-core.js?v=20260715-31";

const DEFAULT_RELAY = "wss://dungeons-master.onrender.com/team-sync";
const HEARTBEAT_INTERVAL = 5_000;
const MEMBER_TIMEOUT = 16_000;

function cleanRoomCode(value) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function cleanName(value) {
  return String(value ?? "").trim() || "Team mate";
}

function cleanClientId(value) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
}

function escapeField(value) {
  return encodeURIComponent(String(value ?? ""));
}

function unescapeField(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function createRoomCode() {
  const bytes = new Uint8Array(4);
  randomBytes(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 6).toUpperCase();
}

function randomBytes(bytes) {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function createClientId() {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return String(cryptoApi.randomUUID()).replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
  randomBytes(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export class TeamSync extends EventTarget {
  constructor() {
    super();
    this.clientId = createClientId();
    this.socket = null;
    this.name = "Team mate";
    this.roomCode = "";
    this.roster = [];
    this.slot = null;
    this.isHost = false;
    this.mode = "offline";
    this.lastSeen = new Map();
    this.heartbeatTimer = null;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get connecting() {
    return this.socket?.readyState === WebSocket.CONNECTING;
  }

  get members() {
    return this.roster.map((member) => ({ ...member }));
  }

  member(id = this.clientId) {
    return this.roster.find((candidate) => candidate.id === id) ?? null;
  }

  connect(roomCode, name, relayUrl = DEFAULT_RELAY, { create = false, mode = "manual", slot = null } = {}) {
    this.disconnect(false);
    this.roomCode = cleanRoomCode(roomCode) || createRoomCode();
    this.name = cleanName(name);
    const peerMode = mode === "peer";
    this.mode = peerMode ? "peer" : create ? "host" : "manual";
    if (peerMode) {
      this.roster = [];
      this.slot = Number.isInteger(Number(slot)) && Number(slot) >= 1 && Number(slot) <= 5 ? Number(slot) : null;
      this.isHost = false;
    } else {
      this.isHost = Boolean(create);
      this.setRoster(create ? [{ id: this.clientId, name: this.name, slot: 1 }] : []);
    }
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
      this.send("HELLO", this.mode === "peer" ? "peer" : this.isHost ? "host" : "join");
      if (this.isHost) this.sendRoster();
      this.startHeartbeat();
      this.dispatchEvent(new CustomEvent("connected", { detail: { mode: this.mode, roomCode: this.roomCode } }));
    });
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      this.isHost = false;
      this.mode = "offline";
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
    this.mode = "offline";
    this.lastSeen.clear();
    this.setRoster([]);
    if (announce) this.setStatus("Team-sync offline");
  }

  send(type, ...fields) {
    if (!this.connected) return false;
    const message = ["TS1", this.clientId, this.name, type, ...fields].map(escapeField).join("|");
    this.socket.send(message);
    return true;
  }

  sendAnnotation(point, text) {
    return this.send("ANN", point.x, point.y, text ?? "", this.slot ?? 0);
  }

  sendClear() {
    return this.send("CLEAR");
  }

  sendGatestone(index, point) {
    return this.send("GAT", index, point?.x ?? -1, point?.y ?? -1, this.slot ?? 0);
  }

  sendPartyOrder(members) {
    const party = normalizeObservedParty(members);
    return party.length ? this.send("PARTY", JSON.stringify(party)) : false;
  }

  setPeerSlot(slot) {
    if (this.mode !== "peer") return;
    const number = Number(slot);
    this.slot = Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
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

  acceptLeaderRoster(senderId, roster) {
    const leader = roster.find((member) => member.slot === 1);
    if (leader?.id !== senderId) return false;
    const currentLeader = this.roster.find((member) => member.slot === 1);
    if (currentLeader && currentLeader.id !== senderId) return false;
    const includesSelf = roster.some((member) => member.id === this.clientId);
    if (!includesSelf) {
      if (currentLeader?.id === senderId) {
        this.dropFromRoom("You were removed from the team room", "removed", { senderId });
      }
      return false;
    }
    this.setRoster(roster);
    return true;
  }

  dropFromRoom(status, eventName = "disconnected", detail = {}) {
    const socket = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.isHost = false;
    this.mode = "offline";
    this.lastSeen.clear();
    this.setRoster([]);
    this.setStatus(status);
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
    if (eventName !== "disconnected") this.dispatchEvent(new CustomEvent("disconnected", { detail }));
  }

  rosterMember(id) {
    return this.roster.find((member) => member.id === cleanClientId(id)) ?? null;
  }

  promoteMember(id) {
    if (!this.isHost) return { ok: false, message: "Only the party leader can promote players" };
    const target = this.rosterMember(id);
    if (!target) return { ok: false, message: "Player is not in this team room" };
    if (target.id === this.clientId || target.slot <= 2) {
      return { ok: false, message: "Slot 1 is locked to the party leader; leader transfer is not available yet" };
    }
    const previousSlot = target.slot - 1;
    const previous = this.roster.find((member) => member.slot === previousSlot);
    const nextRoster = this.roster.map((member) => {
      if (member.id === target.id) return { ...member, slot: previousSlot };
      if (previous && member.id === previous.id) return { ...member, slot: target.slot };
      return { ...member };
    });
    this.setRoster(nextRoster);
    this.sendRoster();
    return { ok: true, message: `${target.name} promoted to slot ${previousSlot}` };
  }

  kickMember(id) {
    if (!this.isHost) return { ok: false, message: "Only the party leader can kick players" };
    const target = this.rosterMember(id);
    if (!target) return { ok: false, message: "Player is not in this team room" };
    if (target.id === this.clientId || target.slot === 1) {
      return { ok: false, message: "The party leader cannot kick themselves" };
    }
    this.send("KICK", target.id);
    this.setRoster(removePartyMember(this.roster, target.id));
    this.sendRoster();
    this.dispatchEvent(new CustomEvent("leave", {
      detail: { senderId: target.id, senderName: target.name, kicked: true },
    }));
    return { ok: true, message: `${target.name} was kicked from the team room` };
  }

  senderInRoster(senderId) {
    return !this.roster.length || this.roster.some((member) => member.id === senderId);
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
    if (this.mode === "peer") {
      const stalePeers = [...this.lastSeen.entries()]
        .filter(([id, seen]) => id !== this.clientId && now - seen > MEMBER_TIMEOUT)
        .map(([id]) => id);
      for (const senderId of stalePeers) {
        this.lastSeen.delete(senderId);
        this.dispatchEvent(new CustomEvent("leave", {
          detail: { senderId, senderName: "Team mate", timedOut: true },
        }));
      }
      return;
    }
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
    if (result.duplicate) {
      this.send("NAME_TAKEN", senderId, senderName);
      return { ok: false, reason: "duplicate" };
    }
    if (result.full) {
      this.send("FULL", senderId);
      return { ok: false, reason: "full" };
    }
    this.setRoster(result.roster);
    this.send("WELCOME", senderId, JSON.stringify(this.roster));
    this.sendRoster();
    return { ok: true };
  }

  handleMessage(line) {
    const fields = line.split("|").map(unescapeField);
    if (fields.length < 4 || fields[0] !== "TS1" || fields[1] === this.clientId) return;
    const senderId = fields[1];
    const senderName = cleanName(fields[2]);
    const type = fields[3];
    this.lastSeen.set(senderId, Date.now());
    if (type === "HELLO") {
      const admitted = this.mode !== "peer" && this.isHost
        ? this.admitMember(senderId, senderName)
        : null;
      if (admitted?.reason === "duplicate") this.setStatus(`${senderName} could not join: duplicate RSN`);
      else this.setStatus(`${senderName} joined the team room`);
      this.dispatchEvent(new CustomEvent("hello", { detail: { senderId, senderName } }));
    } else if (type === "ROSTER" && fields.length >= 5 && !this.isHost && this.mode !== "peer") {
      const roster = parsePartyRoster(fields[4]);
      this.acceptLeaderRoster(senderId, roster);
    } else if (type === "WELCOME" && fields.length >= 6
      && fields[4] === this.clientId && !this.isHost && this.mode !== "peer") {
      const roster = parsePartyRoster(fields[5]);
      this.acceptLeaderRoster(senderId, roster);
    } else if (type === "FULL" && fields[4] === this.clientId && this.mode !== "peer") {
      this.dropFromRoom("This team room is full (5/5)", "full");
    } else if (type === "NAME_TAKEN" && fields[4] === this.clientId && this.mode !== "peer") {
      this.dropFromRoom(`RSN "${fields[5] || this.name}" is already in this team room`, "duplicate");
    } else if (type === "KICK" && fields[4] === this.clientId && this.mode !== "offline") {
      const leader = this.roster.find((member) => member.slot === 1);
      if (!leader || leader.id !== senderId) return;
      this.dropFromRoom("You were kicked from the team room", "kicked", { senderId, senderName });
    } else if (type === "LEAVE") {
      this.lastSeen.delete(senderId);
      const departingWasLeader = this.roster.some((member) => member.id === senderId && member.slot === 1);
      if (this.mode !== "peer" && this.roster.some((member) => member.id === senderId)) {
        this.setRoster(removePartyMember(this.roster, senderId));
        if (departingWasLeader && this.isHost) this.sendRoster();
      }
      this.dispatchEvent(new CustomEvent("leave", { detail: { senderId, senderName } }));
    } else if (type === "PING") {
      // Presence is recorded above; no UI event is needed.
    } else if (type === "PARTY" && fields.length >= 5) {
      if (!this.senderInRoster(senderId)) return;
      let members = [];
      try { members = normalizeObservedParty(JSON.parse(fields[4])); } catch { /* Ignore malformed scans. */ }
      if (members.length) {
        this.dispatchEvent(new CustomEvent("party", { detail: { senderId, senderName, members } }));
      }
    } else if (type === "CLEAR") {
      if (!this.senderInRoster(senderId)) return;
      this.dispatchEvent(new CustomEvent("clear", { detail: { senderId, senderName } }));
    } else if (type === "ANN" && fields.length >= 7) {
      if (!this.senderInRoster(senderId)) return;
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
      if (!this.senderInRoster(senderId)) return;
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
