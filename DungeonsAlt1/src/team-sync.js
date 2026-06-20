const DEFAULT_RELAY = "wss://dungeons-master.onrender.com/team-sync";

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
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(roomCode, name, relayUrl = DEFAULT_RELAY) {
    this.disconnect(false);
    this.roomCode = cleanRoomCode(roomCode) || createRoomCode();
    this.name = cleanName(name);
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
      this.send("HELLO");
      this.dispatchEvent(new CustomEvent("connected"));
    });
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus("Team-sync offline");
      this.dispatchEvent(new CustomEvent("disconnected"));
    });
    socket.addEventListener("error", () => this.setStatus("Team sync could not connect"));
    return this.roomCode;
  }

  disconnect(announce = true) {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (announce) this.setStatus("Team-sync offline");
  }

  send(type, ...fields) {
    if (!this.connected) return;
    const message = ["TS1", this.clientId, this.name, type, ...fields].map(escapeField).join("|");
    this.socket.send(message);
  }

  sendAnnotation(point, text) {
    this.send("ANN", point.x, point.y, text ?? "");
  }

  sendClear() {
    this.send("CLEAR");
  }

  sendGatestone(index, point) {
    this.send("GAT", index, point?.x ?? -1, point?.y ?? -1);
  }

  handleMessage(line) {
    const fields = line.split("|").map(unescapeField);
    if (fields.length < 4 || fields[0] !== "TS1" || fields[1] === this.clientId) return;
    const senderId = fields[1];
    const senderName = cleanName(fields[2]);
    const type = fields[3];
    if (type === "HELLO") {
      this.setStatus(`${senderName} joined the team room`);
      this.dispatchEvent(new CustomEvent("hello", { detail: { senderId, senderName } }));
    } else if (type === "CLEAR") {
      this.dispatchEvent(new CustomEvent("clear", { detail: { senderId, senderName } }));
    } else if (type === "ANN" && fields.length >= 7) {
      this.dispatchEvent(new CustomEvent("annotation", {
        detail: { senderId, senderName, point: { x: Number(fields[4]), y: Number(fields[5]) }, text: fields[6] },
      }));
    } else if (type === "GAT" && fields.length >= 7) {
      this.dispatchEvent(new CustomEvent("gatestone", {
        detail: {
          senderId,
          senderName,
          index: Number(fields[4]),
          point: { x: Number(fields[5]), y: Number(fields[6]) },
        },
      }));
    }
  }

  setStatus(text) {
    this.dispatchEvent(new CustomEvent("status", { detail: text }));
  }
}
