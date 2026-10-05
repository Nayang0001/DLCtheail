const zlib = require("node:zlib");

const MAX_COMPRESSED_BYTES = 4096;
const MAX_PAYLOAD_BYTES = 256;
const MAX_SPECIES_BYTES = 48;

function parseTempData(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.length > MAX_COMPRESSED_BYTES) {
    return null;
  }

  const payloadLength = buffer.readUInt32LE(0);
  if (payloadLength < 24 || payloadLength > MAX_PAYLOAD_BYTES) return null;

  let payload;
  try {
    payload = zlib.inflateSync(buffer.subarray(4), { maxOutputLength: MAX_PAYLOAD_BYTES });
  } catch {
    return null;
  }
  if (payload.length !== payloadLength) return null;

  const speciesLength = payload.readUInt32LE(16);
  if (speciesLength < 3 || speciesLength > MAX_SPECIES_BYTES || 20 + speciesLength > payload.length) {
    return null;
  }

  const species = payload
    .subarray(20, 20 + speciesLength)
    .toString("utf8")
    .replace(/\0+$/g, "")
    .trim();
  if (!/^[\p{L}][\p{L} -]{2,47}$/u.test(species)) return null;

  const values = [0, 4, 8, 12].map((offset) => payload.readFloatLE(offset));
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1.001)) {
    return null;
  }

  const [health, hunger, water, growth] = values;
  const percent = (value) => Number((value * 100).toFixed(4));
  return {
    species,
    health: percent(health),
    hunger: percent(hunger),
    water: percent(water),
    growth: percent(growth),
    stamina: null,
    prime: null,
    mutations: null
  };
}

module.exports = { parseTempData };
