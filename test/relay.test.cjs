const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { createRelayServer, validateProfile, validateStats } = require("../relay/server.cjs");

const profile = (name, steamId) => ({ name, steamId });
const validStats = {
  species: "Allosaurus",
  prime: null,
  mutations: null,
  health: 100,
  stamina: null,
  hunger: 88,
  water: 92,
  growth: 25
};

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for relay message"));
    }, 2000);
    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    }
    socket.on("message", onMessage);
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

test("validates SteamID64 format and bounded dinosaur stats", () => {
  assert.deepEqual(validateProfile(profile("Host", "76561198000000000")), profile("Host", "76561198000000000"));
  assert.equal(validateProfile(profile("Host", "1234")), null);
  assert.deepEqual(validateStats(validStats), validStats);
  assert.equal(validateStats({ ...validStats, health: 101 }), null);
  assert.equal(validateStats({ ...validStats, prime: "yes" }), null);
});

test("creates a private room and relays live member updates", async (t) => {
  const relay = createRelayServer({ port: 0, host: "127.0.0.1" });
  const address = await relay.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const host = await connect(url);
  const friend = await connect(url);
  const clients = [host, friend];
  t.after(async () => {
    await Promise.all(clients.map((socket) => new Promise((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      socket.once("close", resolve);
      socket.close();
    })));
    await relay.close();
  });

  const roomCreated = nextMessage(host, (message) => message.type === "room:joined");
  host.send(JSON.stringify({ type: "room:create", profile: profile("Host", "76561198000000000") }));
  const room = await roomCreated;
  assert.match(room.roomCode, /^[A-HJ-NP-Z2-9]{6}$/);

  const friendJoined = nextMessage(friend, (message) => message.type === "room:joined");
  friend.send(JSON.stringify({
    type: "room:join",
    roomCode: room.roomCode,
    profile: profile("Friend", "76561198000000001")
  }));
  await friendJoined;

  const hostUpdate = nextMessage(host, (message) => message.type === "player:update" && message.profile.name === "Friend");
  const friendUpdate = nextMessage(friend, (message) => message.type === "player:update" && message.profile.name === "Friend");
  friend.send(JSON.stringify({ type: "player:update", stats: validStats, sourceAgeMs: 1000 }));
  const relayedToHost = await hostUpdate;
  const relayedToFriend = await friendUpdate;
  assert.deepEqual(relayedToHost.stats, validStats);
  assert.deepEqual(relayedToFriend.stats, validStats);
  assert.ok(Number.isInteger(relayedToHost.sourceUpdatedAt));
  assert.ok(Date.now() - relayedToHost.sourceUpdatedAt >= 1000);

  const outsider = await connect(url);
  clients.push(outsider);
  const rejected = nextMessage(outsider, (message) => message.type === "error");
  outsider.send(JSON.stringify({
    type: "room:join",
    roomCode: "ZZZZZZ",
    profile: profile("Outsider", "76561198000000002")
  }));
  assert.equal((await rejected).code, "room_not_found");
});
