const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_RELAY_URL, normalizeRelayUrl } = require("../app/renderer/app-config.js");

test("defaults to the deployed Railway relay", () => {
  assert.equal(DEFAULT_RELAY_URL, "wss://dlctheail-production.up.railway.app/ws");
  assert.equal(normalizeRelayUrl(""), DEFAULT_RELAY_URL);
  assert.equal(normalizeRelayUrl(undefined), DEFAULT_RELAY_URL);
});

test("migrates a previously saved localhost relay to the deployed URL", () => {
  assert.equal(normalizeRelayUrl("ws://localhost:8787/ws"), DEFAULT_RELAY_URL);
  assert.equal(normalizeRelayUrl("ws://127.0.0.1:8787/ws/"), DEFAULT_RELAY_URL);
});

test("keeps a non-local relay URL the player has configured", () => {
  assert.equal(
    normalizeRelayUrl("wss://other-relay.example/ws"),
    "wss://other-relay.example/ws"
  );
});
