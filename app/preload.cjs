const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  readLocalDinosaur: () => ipcRenderer.invoke("game:read-local-dinosaur")
});
