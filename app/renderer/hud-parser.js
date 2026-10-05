(() => {
  const statLabels = [
    ["health", "Salud"],
    ["stamina", "Estamina"],
    ["hunger", "Hambre"],
    ["water", "Agua"],
    ["growth", "Crecimiento"]
  ];
  const labelPatterns = {
    health: /\b(?:salud|health)\b/i,
    stamina: /\b(?:estamina|stamina)\b/i,
    hunger: /\b(?:hambre|hunger)\b/i,
    water: /\b(?:agua|water)\b/i,
    growth: /\b(?:crecimiento|growth)\b/i
  };
  const speciesNames = [
    "Allosaurus", "Beipiaosaurus", "Carnotaurus", "Ceratosaurus", "Deinosuchus",
    "Diabloceratops", "Dilophosaurus", "Dryosaurus", "Gallimimus", "Herrerasaurus",
    "Hypsilophodon", "Iguanodon", "Maiasaura", "Pachycephalosaurus", "Pteranodon",
    "Stegosaurus", "Tenontosaurus", "Triceratops", "Troodon", "Tyrannosaurus",
    "Utahraptor"
  ];
  const ignoredMutationText = /^(?:activas?|mutaciones|sin mutaciones|no mutations|panel|vivo|prime)$/i;

  function normalizeText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function extractPercentage(text, allowBareNumber = false) {
    const pattern = allowBareNumber
      ? /(?:^|\D)(\d{1,3}(?:[.,]\d{1,2})?)\s*%?(?:\D|$)/
      : /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/;
    const match = text.match(pattern);
    if (!match) return null;
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }

  function parseHudLines(lines, words = [], {
    leftPanelWidth = 250,
    mutationMaxHeight = 450
  } = {}) {
    const normalized = lines.map((line) => ({
      text: typeof line === "string" ? line : line.text || "",
      bbox: typeof line === "string" ? null : line.bbox || null
    }));
    const normalizedWords = words.map((word) => ({
      text: word.text || "",
      bbox: word.bbox || null
    }));
    const texts = normalized.map((line) => line.text.trim()).filter(Boolean);
    const allText = texts.join("\n");
    const result = {
      species: null,
      prime: /\bpri(?:me|ne)\b/i.test(allText),
      mutations: [],
      health: null,
      stamina: null,
      hunger: null,
      water: null,
      growth: null
    };
    const normalizedAll = normalizeText(allText);
    result.species = speciesNames.find((species) =>
      normalizedAll.includes(normalizeText(species))
    ) || null;

    const labelWords = {};
    for (const [key, label] of Object.entries(labelPatterns)) {
      labelWords[key] = normalizedWords.find((word) => label.test(normalizeText(word.text))) || null;
    }

    for (const [key, label] of Object.entries(labelPatterns)) {
      const labelWord = labelWords[key];
      if (labelWord?.bbox) {
        const labelY = (labelWord.bbox.y0 + labelWord.bbox.y1) / 2;
        const labelHeight = labelWord.bbox.y1 - labelWord.bbox.y0;
        const nextLabelX = Object.values(labelWords)
          .filter((candidate) => candidate?.bbox && candidate.bbox.x0 > labelWord.bbox.x1)
          .filter((candidate) => Math.abs((candidate.bbox.y0 + candidate.bbox.y1) / 2 - labelY) <= Math.max(12, labelHeight * 1.5))
          .reduce((nearest, candidate) => Math.min(nearest, candidate.bbox.x0), Infinity);
        const candidates = normalizedWords
          .filter((word) => word !== labelWord && word.bbox)
          .filter((word) => {
            const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
            return word.bbox.x0 >= labelWord.bbox.x1 - 2
              && word.bbox.x0 < nextLabelX
              && Math.abs(centerY - labelY) <= Math.max(12, labelHeight * 1.5);
          })
          .sort((left, right) => left.bbox.x0 - right.bbox.x0);
        const firstNumber = candidates.find((word) => /\d/.test(word.text));
        if (firstNumber) {
          result[key] = extractPercentage(firstNumber.text, true);
          continue;
        }
      }

      const index = normalized.findIndex((line) => label.test(normalizeText(line.text)));
      if (index < 0) continue;
      const distinctLabels = Object.values(labelPatterns).filter((pattern) => pattern.test(normalizeText(normalized[index].text))).length;
      if (distinctLabels === 1) {
        result[key] = extractPercentage(normalized[index].text);
        if (result[key] === null && !/\d/.test(normalized[index].text)) {
          const adjacent = normalized[index + 1];
          if (adjacent && !Object.values(labelPatterns).some((pattern) => pattern.test(normalizeText(adjacent.text)))) {
            result[key] = extractPercentage(adjacent.text);
          }
        }
      }
    }

    if (!/sin mutacion|no mutation/i.test(allText)) {
      const heading = normalized.findIndex((line) => /\bmutaciones\b/i.test(normalizeText(line.text)));
      if (heading >= 0) {
        const headingY = normalized[heading].bbox?.y1 ?? 0;
        const leftLines = normalized.slice(heading + 1).filter((line) => {
          if (!line.bbox) return true;
          const leftEdge = line.bbox.x0 ?? line.bbox.left ?? line.bbox.x1;
          return leftEdge < leftPanelWidth
            && line.bbox.y1 >= headingY
            && line.bbox.y1 < headingY + mutationMaxHeight;
        });
        result.mutations = leftLines
          .map((line) => line.text.replace(/^[\s•·-]+/, "").trim())
          .filter((line) => line && line.length <= 48 && !ignoredMutationText.test(line))
          .slice(0, 12);
      }
    }
    return result;
  }

  function matchesBarColor(key, red, green, blue) {
    if (key === "health") return red > 100 && red > green * 1.4 && red > blue * 1.2 && green < 140;
    if (key === "stamina") return green > 100 && green > red * 1.3 && blue > red * 1.15 && green > blue * 0.9;
    if (key === "hunger") return red > 120 && red > green * 1.25 && green > blue * 1.25;
    if (key === "water") return blue > 100 && blue - red > 25 && blue > green * 1.1;
    return blue > 120 && blue - red > 30 && red - green > 25;
  }

  function measureHudBars(pixels, width, height, words) {
    const labels = {};
    for (const [key, pattern] of Object.entries(labelPatterns)) {
      labels[key] = words.find((word) => pattern.test(normalizeText(word.text)) && word.bbox) || null;
    }
    const labelPositions = [...new Set(Object.values(labels)
      .filter(Boolean)
      .map((word) => Math.round(word.bbox.x0)))]
      .sort((left, right) => left - right);
    const gaps = labelPositions.slice(1)
      .map((position, index) => position - labelPositions[index])
      .filter((gap) => gap >= width * 0.06 && gap <= width * 0.35);
    const sortedGaps = gaps.sort((left, right) => left - right);
    const columnStep = sortedGaps.length
      ? sortedGaps[Math.floor(sortedGaps.length / 2)]
      : width * 0.22;
    const barWidth = Math.max(1, columnStep * 0.925);
    const results = {};

    for (const key of Object.keys(labelPatterns)) {
      const label = labels[key];
      if (!label) {
        results[key] = null;
        continue;
      }
      const startX = Math.max(0, Math.floor(label.bbox.x0 - columnStep * 0.07));
      const endX = Math.min(width, Math.ceil(startX + barWidth));
      const startY = Math.max(0, Math.floor(label.bbox.y1 + 2));
      const endY = Math.min(height, Math.ceil(label.bbox.y1 + 19));
      let best = { colored: 0, neutral: 0, coverage: 0 };

      for (let y = startY; y < endY; y += 1) {
        let colored = 0;
        let neutral = 0;
        for (let x = startX; x < endX; x += 1) {
          const pixel = (y * width + x) * 4;
          const red = pixels[pixel];
          const green = pixels[pixel + 1];
          const blue = pixels[pixel + 2];
          if (matchesBarColor(key, red, green, blue)) colored += 1;
          else if (Math.max(red, green, blue) - Math.min(red, green, blue) < 16
            && red >= 20 && red <= 65 && green <= 70 && blue <= 75) neutral += 1;
        }
        const coverage = colored + neutral;
        if (colored > best.colored || (colored === best.colored && coverage > best.coverage)) {
          best = { colored, neutral, coverage };
        }
      }

      if (best.coverage < barWidth * 0.55) {
        results[key] = null;
      } else if (best.colored < 2) {
        results[key] = 0;
      } else {
        const ratio = (best.colored / barWidth) * 100;
        results[key] = ratio >= 96 ? 100 : Math.round(ratio);
      }
    }
    return results;
  }

  function isComplete(stats) {
    return Boolean(stats.species) && statLabels.every(([key]) => stats[key] !== null);
  }

  const api = { isComplete, measureHudBars, parseHudLines, statLabels };
  globalThis.HudParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
