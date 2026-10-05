const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { parseTempData } = require("../app/temp-data-parser.cjs");

function makeRecord({
  species = "Allosaurus",
  health = 1,
  hunger = 0.887414,
  water = 0.95889,
  growth = 0.263163
} = {}) {
  const speciesBytes = Buffer.from(species, "utf8");
  const payload = Buffer.alloc(24 + speciesBytes.length);
  payload.writeFloatLE(health, 0);
  payload.writeFloatLE(hunger, 4);
  payload.writeFloatLE(water, 8);
  payload.writeFloatLE(growth, 12);
  payload.writeUInt32LE(speciesBytes.length, 16);
  speciesBytes.copy(payload, 20);
  return Buffer.concat([Buffer.from([payload.length, 0, 0, 0]), zlib.deflateSync(payload)]);
}

test("parses a compressed Evrima TempData record without OCR", () => {
  assert.deepEqual(parseTempData(makeRecord()), {
    species: "Allosaurus",
    health: 100,
    hunger: 88.7414,
    water: 95.889,
    growth: 26.3163,
    stamina: null,
    prime: null,
    mutations: null
  });
});

test("preserves supported species names and marks fields absent from TempData as unavailable", () => {
  const stats = parseTempData(makeRecord({ species: "Diabloceratops" }));
  assert.equal(stats.species, "Diabloceratops");
  assert.equal(stats.stamina, null);
  assert.equal(stats.prime, null);
  assert.equal(stats.mutations, null);
});

test("rejects malformed compressed files, invalid values, and inconsistent lengths", () => {
  assert.equal(parseTempData(Buffer.from("not TempData")), null);
  assert.equal(parseTempData(makeRecord({ health: 1.5 })), null);

  const corruptLength = makeRecord();
  corruptLength.writeUInt32LE(1, 0);
  assert.equal(parseTempData(corruptLength), null);
});
