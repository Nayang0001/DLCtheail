const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  listScreenSources: () => ipcRenderer.invoke("screen:list"),
  captureScreenSource: (sourceId) => ipcRenderer.invoke("screen:capture", sourceId)
});
