const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseTempData } = require("./temp-data-parser.cjs");

const MAX_TEMP_DATA_AGE_MS = 180_000;

async function readCurrentDinosaur() {
  const localAppData = process.env.LOCALAPPDATA || path.resolve(app.getPath("appData"), "..", "Local");
  const directory = path.join(localAppData, "TheIsle", "Saved", "Prelobby");

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { available: false, reason: "game-data-folder-missing" };
    throw error;
  }

  const now = Date.now();
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^TempData_.*\.bin$/i.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      try {
        const metadata = await fs.stat(filePath);
        const ageMs = Math.max(0, now - metadata.mtimeMs);
        if (ageMs > MAX_TEMP_DATA_AGE_MS || metadata.size > 4096) return null;
        const record = parseTempData(await fs.readFile(filePath));
        return record ? { record, ageMs, version: metadata.mtimeMs } : null;
      } catch (error) {
        if (["ENOENT", "EBUSY", "EPERM"].includes(error.code)) return null;
        throw error;
      }
    }));

  const current = candidates
    .filter(Boolean)
    .sort((left, right) => left.ageMs - right.ageMs)[0];
  if (!current) return { available: false, reason: "no-recent-character-data" };
  return {
    available: true,
    stats: current.record,
    ageMs: current.ageMs,
    version: current.version
  };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: "#0c1117",
    title: "Evrima Pack Companion",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("game:read-local-dinosaur", readCurrentDinosaur);

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
