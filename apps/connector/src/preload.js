const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("connector", {
  pair: (pairingCode) => ipcRenderer.invoke("pair", pairingCode),
});
