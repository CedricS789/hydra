// Sandboxed Electron preloads use bundled CommonJS, independently of the
// launcher's ESM preload. No application APIs are exposed to this controller.
const { contextBridge, ipcRenderer } = require("electron");
const controller = new URLSearchParams(location.search).get("controller");
if (!controller || !/^\d+$/.test(controller))
  throw new Error("Invalid browser controller.");
contextBridge.exposeInMainWorld("sourceBrowser", {
  state: () => ipcRenderer.invoke(`source-browser-state-${controller}`),
  command: (command) =>
    ipcRenderer.invoke(`source-browser-command-${controller}`, command),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("source-browser-state", handler);
    return () => ipcRenderer.removeListener("source-browser-state", handler);
  },
});
