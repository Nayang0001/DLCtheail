const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocket, WebSocketServer } = require("ws");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_MEMBERS = 12;
const MIN_UPDATE_INTERVAL_MS = 900;
const MAX_ROOM_AGE_MS = 12 * 60 * 60 * 1000;

function createRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";
}

function validateProfile(value) {
  if (!value || typeof value !== "object") return null;
  const steamId = cleanText(value.steamId, 17);
  const name = cleanText(value.name, 32);
  if (!/^\d{17}$/.test(steamId) || !name) return null;
  return { steamId, name };
}

function validateStats(value) {
  if (!value || typeof value !== "object") return null;
  const percentage = (item) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 100;
  const mutations = Array.isArray(value.mutations)
    ? value.mutations.slice(0, 12).map((item) => cleanText(item, 48)).filter(Boolean)
    : [];
  const species = cleanText(value.species, 40);
  if (!species || typeof value.prime !== "boolean") return null;
  for (const key of ["health", "stamina", "hunger", "water", "growth"]) {
    if (!percentage(value[key])) return null;
  }
  return {
    species,
    prime: value.prime,
    mutations,
    health: value.health,
    stamina: value.stamina,
    hunger: value.hunger,
    water: value.water,
    growth: value.growth
  };
}

function createRelayServer({ port = Number(process.env.PORT) || 8787, host = "0.0.0.0" } = {}) {
  const rooms = new Map();
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, service: "evrima-pack-relay", activeRooms: rooms.size }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });

  function leaveRoom(socket) {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.members.delete(socket.profile.steamId);
    room.sockets.delete(socket);
    for (const member of room.sockets) {
      send(member, { type: "player:left", steamId: socket.profile.steamId });
    }
    if (room.members.size === 0) rooms.delete(socket.roomCode);
    socket.roomCode = null;
  }

  function attachToRoom(socket, roomCode, profile, room, created) {
    const existing = room.members.get(profile.steamId);
    if (existing) {
      send(socket, { type: "error", code: "already_in_room", message: "Ese SteamID ya está conectado a esta sala." });
      return;
    }
    if (room.members.size >= MAX_MEMBERS) {
      send(socket, { type: "error", code: "room_full", message: "La sala ya tiene el máximo de miembros." });
      return;
    }
    socket.roomCode = roomCode;
    socket.profile = profile;
    room.members.set(profile.steamId, { profile, stats: null, updatedAt: null });
    room.sockets.add(socket);
    send(socket, {
      type: "room:joined",
      roomCode,
      created,
      members: Array.from(room.members.values()).filter((member) => member.stats)
    });
    for (const member of room.sockets) {
      if (member !== socket) send(member, { type: "player:joined", profile });
    }
  }

  sockets.on("connection", (socket) => {
    socket.roomCode = null;
    socket.profile = null;
    socket.lastUpdateAt = 0;

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: "error", code: "invalid_json", message: "El mensaje no tiene un formato válido." });
        socket.close(1003, "Invalid JSON");
        return;
      }
      if (!message || typeof message.type !== "string") {
        send(socket, { type: "error", code: "invalid_message", message: "Mensaje inválido." });
        return;
      }

      if (message.type === "room:create" || message.type === "room:join") {
        if (socket.roomCode) {
          send(socket, { type: "error", code: "already_joined", message: "Ya estás conectado a una sala." });
          return;
        }
        const profile = validateProfile(message.profile);
        if (!profile) {
          send(socket, { type: "error", code: "invalid_profile", message: "Revisa tu nombre y el SteamID64 de 17 dígitos." });
          return;
        }
        if (message.type === "room:create") {
          let roomCode = createRoomCode();
          while (rooms.has(roomCode)) roomCode = createRoomCode();
          const room = { createdAt: Date.now(), members: new Map(), sockets: new Set() };
          rooms.set(roomCode, room);
          attachToRoom(socket, roomCode, profile, room, true);
          return;
        }
        const roomCode = cleanText(message.roomCode, 8).toUpperCase();
        const room = rooms.get(roomCode);
        if (!room || Date.now() - room.createdAt > MAX_ROOM_AGE_MS) {
          rooms.delete(roomCode);
          send(socket, { type: "error", code: "room_not_found", message: "No se encontró esa sala. Pide un código nuevo." });
          return;
        }
        attachToRoom(socket, roomCode, profile, room, false);
        return;
      }

      if (message.type === "player:update") {
        const room = socket.roomCode && rooms.get(socket.roomCode);
        const stats = validateStats(message.stats);
        if (!room || !stats) {
          send(socket, { type: "error", code: "invalid_stats", message: "No se pudieron validar los datos del dinosaurio." });
          return;
        }
        const now = Date.now();
        if (now - socket.lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
        socket.lastUpdateAt = now;
        const member = room.members.get(socket.profile.steamId);
        if (!member) {
          send(socket, { type: "error", code: "not_a_member", message: "Tu conexión a la sala expiró." });
          return;
        }
        member.stats = stats;
        member.updatedAt = now;
        for (const recipient of room.sockets) {
          send(recipient, {
            type: "player:update",
            profile: socket.profile,
            stats,
            updatedAt: now
          });
        }
        return;
      }

      if (message.type === "room:leave") {
        leaveRoom(socket);
        send(socket, { type: "room:left" });
        return;
      }

      send(socket, { type: "error", code: "unknown_message", message: "Tipo de mensaje desconocido." });
    });

    socket.on("close", () => leaveRoom(socket));
    socket.on("error", () => leaveRoom(socket));
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit("connection", webSocket, request));
  });

  return {
    rooms,
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      for (const socket of sockets.clients) socket.close(1001, "Server shutting down");
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

if (require.main === module) {
  const relay = createRelayServer();
  relay.listen().then((address) => {
    console.log(`Evrima Pack relay listening on ${address.address}:${address.port}`);
  }).catch((error) => {
    console.error("Relay failed to start:", error);
    process.exitCode = 1;
  });
  process.on("SIGINT", () => relay.close().finally(() => process.exit()));
  process.on("SIGTERM", () => relay.close().finally(() => process.exit()));
}

module.exports = { createRelayServer, validateProfile, validateStats };
