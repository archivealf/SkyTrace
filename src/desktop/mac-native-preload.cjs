const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, handler) => {
  if (typeof handler !== "function") return () => {};
  const listener = (_event, payload) => {
    try { handler(payload); } catch {}
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("skytraceNative", {
  isMac: process.platform === "darwin",
  platform: process.platform,
  openSettings: () => ipcRenderer.invoke("skytrace:settings:open"),
  getSettings: () => ipcRenderer.invoke("skytrace:settings:get"),
  saveSettings: settings => ipcRenderer.invoke("skytrace:settings:save", settings),
  openConfig: () => ipcRenderer.invoke("skytrace:system:open-config"),
  showDataFolder: () => ipcRenderer.invoke("skytrace:system:show-data"),
  showDiagnosticLog: () => ipcRenderer.invoke("skytrace:system:show-log"),
  getLaunchAtLogin: () => ipcRenderer.invoke("skytrace:login-item:get"),
  setLaunchAtLogin: enabled => ipcRenderer.invoke("skytrace:login-item:set", Boolean(enabled)),
  notify: payload => ipcRenderer.invoke("skytrace:notification:show", payload),
  getAlertsPaused: () => ipcRenderer.invoke("skytrace:alerts:get-paused"),
  setAlertsPaused: paused => ipcRenderer.invoke("skytrace:alerts:set-paused", Boolean(paused)),
  updateMenuBar: status => ipcRenderer.send("skytrace:menubar:status", status),
  openDetached: (type, id) => ipcRenderer.invoke("skytrace:window:detached", { type, id }),
  focusMain: action => ipcRenderer.invoke("skytrace:window:focus-main", action),
  reportReady: payload => ipcRenderer.send("skytrace:startup:ready", payload || {}),
  reportStartupError: payload => ipcRenderer.send("skytrace:startup:error", payload || {}),
  localReplay: {
    ingest: snapshot => ipcRenderer.send("skytrace:local-replay:ingest", snapshot),
    query: options => ipcRenderer.invoke("skytrace:local-replay:query", options || {}),
    clear: () => ipcRenderer.invoke("skytrace:local-replay:clear"),
    stats: () => ipcRenderer.invoke("skytrace:local-replay:stats")
  },
  onNavigate: handler => on("skytrace:navigate", handler),
  onSettingsChanged: handler => on("skytrace:settings:changed", handler),
  onPowerState: handler => on("skytrace:power-state", handler)
});
