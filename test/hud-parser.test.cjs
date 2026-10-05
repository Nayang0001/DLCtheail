const test = require("node:test");
const assert = require("node:assert/strict");
const { isComplete, measureHudBars, parseHudLines } = require("../app/renderer/hud-parser.js");

test("parses the requested Evrima HUD fields from Spanish labels", () => {
  const result = parseHudLines([
    "Allosaurus",
    "PRINE",
    "Salud 100%",
    "Estamina 100%",
    "Hambre 98%",
    "Agua 99%",
    "Crecimiento 25%",
    "Mutaciones",
    "Sin mutaciones"
  ]);

  assert.deepEqual(result, {
    species: "Allosaurus",
    prime: true,
    mutations: [],
    health: 100,
    stamina: 100,
    hunger: 98,
    water: 99,
    growth: 25
  });
  assert.equal(isComplete(result), true);
});

test("does not treat out-of-range or missing percentages as complete data", () => {
  const result = parseHudLines([
    "Allosaurus",
    "Salud 101%",
    "Estamina 100%",
    "Hambre 98%",
    "Agua 99%",
    "Crecimiento 25%"
  ]);

  assert.equal(result.health, null);
  assert.equal(result.prime, false);
  assert.equal(isComplete(result), false);
});

test("collects mutation names from the overlay's left panel", () => {
  const result = parseHudLines([
    { text: "Mutaciones", bbox: { x1: 10, y1: 40 } },
    { text: "Nocturnal", bbox: { x1: 18, y1: 75 } },
    { text: "Panel", bbox: { x1: 20, y1: 600 } }
  ]);

  assert.deepEqual(result.mutations, ["Nocturnal"]);
});

test("uses nearby OCR word boxes to associate percentages with the correct bars", () => {
  const labels = [
    ["Salud", 193, 174],
    ["Estamina", 422, 174],
    ["Hambre", 650, 174],
    ["Agua", 193, 205],
    ["Crecimiento", 650, 205]
  ];
  const values = [
    ["100%", 366, 174],
    ["100%", 595, 174],
    ["98%", 828, 174],
    ["99%", 368, 205],
    ["25%", 829, 205]
  ];
  const line = (text, x, y) => ({
    text,
    bbox: { x0: x, y0: y - 7, x1: x + text.length * 7, y1: y }
  });
  const words = [...labels, ...values].map(([text, x, y]) => line(text, x, y));
  const lines = [
    "Salud 100% Estamina 100% Hambre 98%",
    "Agua 99% Crecimiento 25%"
  ];

  const result = parseHudLines(lines, words);
  assert.deepEqual(
    [result.health, result.stamina, result.hunger, result.water, result.growth],
    [100, 100, 98, 99, 25]
  );
});

test("measures the five colored HUD bars when OCR cannot read their numbers", () => {
  const width = 1022;
  const height = 240;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const labels = [
    ["Salud", 193, 181, [190, 60, 80], 100],
    ["Estamina", 422, 181, [48, 164, 136], 100],
    ["Hambre", 650, 181, [198, 122, 52], 98],
    ["Agua", 193, 214, [52, 138, 199], 99],
    ["Crecimiento", 650, 214, [158, 115, 225], 25]
  ];
  const words = labels.map(([text, x, y]) => ({
    text,
    bbox: { x0: x, y0: y - 7, x1: x + 40, y1: y }
  }));
  const gaps = [228, 229];
  const step = gaps[1];
  for (const [text, labelX, labelY, color, value] of labels) {
    const start = Math.floor(labelX - step * 0.07);
    const barWidth = Math.max(1, step * 0.925);
    const filledWidth = Math.round(barWidth * value / 100);
    const y = labelY + 9;
    for (let offset = 0; offset < barWidth; offset += 1) {
      const x = start + offset;
      const pixel = (y * width + x) * 4;
      const selectedColor = offset < filledWidth ? color : [33, 38, 43];
      pixels[pixel] = selectedColor[0];
      pixels[pixel + 1] = selectedColor[1];
      pixels[pixel + 2] = selectedColor[2];
      pixels[pixel + 3] = 255;
    }
  }

  const result = measureHudBars(pixels, width, height, words);
  assert.deepEqual(
    [result.health, result.stamina, result.hunger, result.water, result.growth],
    [100, 100, 100, 100, 25]
  );
});
