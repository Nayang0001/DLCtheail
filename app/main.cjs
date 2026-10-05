const { app, BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const path = require("node:path");

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

ipcMain.handle("screen:list", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 640, height: 360 },
    fetchWindowIcons: false
  });

  return sources.map(({ id, name, thumbnail }) => ({
    id,
    name,
    thumbnail: thumbnail.toDataURL()
  }));
});

ipcMain.handle("screen:capture", async (_event, sourceId) => {
  if (typeof sourceId !== "string" || sourceId.length > 256) {
    throw new TypeError("Invalid screen source.");
  }

  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false
  });
  const source = sources.find((candidate) => candidate.id === sourceId);

  if (!source) {
    throw new Error("The selected screen or window is no longer available.");
  }

  return source.thumbnail.toDataURL();
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
