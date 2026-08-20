import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, powerMonitor, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const macNativePreloadPath = path.join(__dirname, "mac-native-preload.cjs");

const DEFAULTS = Object.freeze({
  menuBar: true,
  notifications: true,
  launchAtLogin: false,
  performanceProfile: "balanced",
  offlineFallback: true,
  trafficLabelDensity: "normal",
  reducedMotion: false,
  localReplay: {
    enabled: true,
    retentionHours: 168,
    maxMb: 100
  }
});

const state = {
  installed: false,
  getMainWindow: () => null,
  getServerUrl: () => "",
  configPath: "",
  settingsPath: "",
  replayPath: "",
  diagnosticLogPath: "",
  tray: null,
  settingsWindow: null,
  detachedWindows: new Set(),
  alertsPaused: false,
  menuStatus: { flights: 0, watchHits: 0, connection: "Starting" },
  lastPruneAt: 0
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function normalizeSettings(input = {}) {
  const base = cloneDefaults();
  const replay = input.localReplay && typeof input.localReplay === "object" ? input.localReplay : {};
  return {
    menuBar: input.menuBar !== false,
    notifications: input.notifications !== false,
    launchAtLogin: Boolean(input.launchAtLogin),
    performanceProfile: ["accuracy", "balanced", "battery"].includes(input.performanceProfile) ? input.performanceProfile : base.performanceProfile,
    offlineFallback: input.offlineFallback !== false,
    trafficLabelDensity: ["low", "normal", "high"].includes(input.trafficLabelDensity) ? input.trafficLabelDensity : base.trafficLabelDensity,
    reducedMotion: Boolean(input.reducedMotion),
    localReplay: {
      enabled: replay.enabled !== false,
      retentionHours: Math.max(1, Math.min(24 * 30, Number(replay.retentionHours) || base.localReplay.retentionHours)),
      maxMb: Math.max(10, Math.min(1000, Number(replay.maxMb) || base.localReplay.maxMb))
    }
  };
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(state.settingsPath, "utf8"));
    return normalizeSettings(parsed);
  } catch {
    const initial = cloneDefaults();
    try {
      fs.mkdirSync(path.dirname(state.settingsPath), { recursive: true });
      fs.writeFileSync(state.settingsPath, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o600 });
    } catch {}
    return initial;
  }
}

function writeSettings(next) {
  const normalized = normalizeSettings(next);
  fs.mkdirSync(path.dirname(state.settingsPath), { recursive: true });
  fs.writeFileSync(state.settingsPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(state.settingsPath, 0o600); } catch {}
  app.setLoginItemSettings({ openAtLogin: normalized.launchAtLogin, openAsHidden: false });
  syncTray(normalized);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("skytrace:settings:changed", normalized);
  }
  return normalized;
}

function replaySettings() {
  return readSettings().localReplay;
}

function replayLimitBytes() {
  return replaySettings().maxMb * 1024 * 1024;
}

function compactFlight(flight, recordedAt) {
  const latitude = Number(flight?.latitude);
  const longitude = Number(flight?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const icao = String(flight?.icao24 || flight?.icao || "").trim().toLowerCase();
  if (!icao) return null;
  return {
    t: Number(recordedAt) || Date.now(),
    i: icao,
    c: String(flight?.callsign || "").trim(),
    r: String(flight?.registration || "").trim(),
    y: String(flight?.aircraftType || "").trim(),
    a: Number.isFinite(Number(flight?.altitudeFt)) ? Number(flight.altitudeFt) : null,
    s: Number.isFinite(Number(flight?.speedKts)) ? Number(flight.speedKts) : null,
    h: Number.isFinite(Number(flight?.heading)) ? Number(flight.heading) : null,
    v: Number.isFinite(Number(flight?.verticalRateFpm)) ? Number(flight.verticalRateFpm) : null,
    x: longitude,
    z: latitude
  };
}

async function pruneReplay(force = false) {
  const now = Date.now();
  if (!force && now - state.lastPruneAt < 10 * 60_000) return;
  state.lastPruneAt = now;
  try {
    const settings = replaySettings();
    const stat = await fs.promises.stat(state.replayPath).catch(() => null);
    if (!stat) return;
    const cutoff = now - settings.retentionHours * 3600_000;
    if (!force && stat.size < replayLimitBytes() * 0.75 && stat.mtimeMs > cutoff) return;
    const text = await fs.promises.readFile(state.replayPath, "utf8");
    const kept = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const point = JSON.parse(line);
        if (Number(point.t) >= cutoff) kept.push(JSON.stringify(point));
      } catch {}
    }
    let output = kept.join("\n");
    if (output) output += "\n";
    const maxBytes = replayLimitBytes();
    if (Buffer.byteLength(output) > maxBytes) {
      const bytes = Buffer.from(output);
      let sliced = bytes.subarray(bytes.length - maxBytes).toString("utf8");
      const firstBreak = sliced.indexOf("\n");
      if (firstBreak >= 0) sliced = sliced.slice(firstBreak + 1);
      output = sliced;
    }
    await fs.promises.writeFile(state.replayPath, output, { mode: 0o600 });
  } catch {}
}

async function ingestReplay(snapshot) {
  const settings = replaySettings();
  if (!settings.enabled || !Array.isArray(snapshot?.flights)) return;
  const recordedAt = Number(snapshot.recordedAt) || Date.now();
  const lines = snapshot.flights.slice(0, 4000).map(f => compactFlight(f, recordedAt)).filter(Boolean).map(p => JSON.stringify(p));
  if (!lines.length) return;
  fs.mkdirSync(path.dirname(state.replayPath), { recursive: true });
  await fs.promises.appendFile(state.replayPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 }).catch(() => {});
  void pruneReplay(false);
}

async function queryReplay(options = {}) {
  const settings = replaySettings();
  const now = Date.now();
  const from = Math.max(now - settings.retentionHours * 3600_000, Number(options.from) || now - 6 * 3600_000);
  const to = Math.min(now + 60_000, Number(options.to) || now);
  const icao = String(options.icao || "").trim().toLowerCase();
  const limit = Math.max(100, Math.min(50000, Number(options.limit) || 15000));
  try {
    const text = await fs.promises.readFile(state.replayPath, "utf8");
    const out = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const p = JSON.parse(line);
        if (p.t < from || p.t > to) continue;
        if (icao && p.i !== icao) continue;
        out.push({
          recordedAt: p.t, icao: p.i, callsign: p.c, registration: p.r, aircraftType: p.y,
          altitudeFt: p.a, speedKts: p.s, heading: p.h, verticalRateFpm: p.v,
          longitude: p.x, latitude: p.z
        });
        if (out.length >= limit) break;
      } catch {}
    }
    return { ok: true, privateLocal: true, from, to, points: out, retentionHours: settings.retentionHours };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, privateLocal: true, from, to, points: [], retentionHours: settings.retentionHours };
    throw error;
  }
}

async function replayStats() {
  try {
    const stat = await fs.promises.stat(state.replayPath);
    const settings = replaySettings();
    return { ok: true, bytes: stat.size, maxBytes: replayLimitBytes(), retentionHours: settings.retentionHours, enabled: settings.enabled };
  } catch {
    const settings = replaySettings();
    return { ok: true, bytes: 0, maxBytes: replayLimitBytes(), retentionHours: settings.retentionHours, enabled: settings.enabled };
  }
}

function trayIcon() {
  const candidates = [
    path.join(path.dirname(__dirname), "assets", "SkyTrace.png"),
    path.join(process.resourcesPath || "", "app.asar", "assets", "SkyTrace.png")
  ];
  const found = candidates.find(file => file && fs.existsSync(file));
  const image = found ? nativeImage.createFromPath(found) : nativeImage.createEmpty();
  return image.isEmpty() ? image : image.resize({ width: 18, height: 18 });
}

function showMain(action = "") {
  const window = state.getMainWindow?.();
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (action) window.webContents.send("skytrace:navigate", { action });
  return true;
}

function buildTrayMenu(settings = readSettings()) {
  const status = state.menuStatus;
  return Menu.buildFromTemplate([
    { label: `SkyTrace · ${status.connection || "Ready"}`, enabled: false },
    { label: `${Number(status.flights || 0).toLocaleString()} visible aircraft`, enabled: false },
    { label: `${Number(status.watchHits || 0).toLocaleString()} watchlist hits`, enabled: false },
    { type: "separator" },
    { label: "Open SkyTrace", click: () => showMain() },
    { label: "Search…", accelerator: "CommandOrControl+K", click: () => showMain("command") },
    { label: "Airport Desk…", click: () => showMain("airportDesk") },
    { type: "separator" },
    { label: "Pause Alerts", type: "checkbox", checked: state.alertsPaused, click: item => { state.alertsPaused = item.checked; syncTray(settings); } },
    { label: "Settings…", click: () => openMacSettings() },
    { type: "separator" },
    { label: "Quit SkyTrace", role: "quit" }
  ]);
}

function syncTray(settings = readSettings()) {
  if (process.platform !== "darwin") return;
  if (!settings.menuBar) {
    state.tray?.destroy();
    state.tray = null;
    return;
  }
  if (!state.tray) {
    state.tray = new Tray(trayIcon());
    state.tray.setToolTip("SkyTrace");
    state.tray.on("click", () => showMain());
  }
  state.tray.setContextMenu(buildTrayMenu(settings));
}

function sharedWindowOptions() {
  return {
    backgroundColor: "#07090d",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: macNativePreloadPath
    }
  };
}

export async function openMacSettings() {
  if (process.platform !== "darwin") return false;
  if (state.settingsWindow && !state.settingsWindow.isDestroyed()) {
    state.settingsWindow.show();
    state.settingsWindow.focus();
    return true;
  }
  const url = state.getServerUrl?.();
  if (!url) return false;
  state.settingsWindow = new BrowserWindow({
    ...sharedWindowOptions(),
    width: 760,
    height: 640,
    minWidth: 680,
    minHeight: 560,
    title: "SkyTrace Settings",
    titleBarStyle: "hiddenInset"
  });
  state.settingsWindow.once("ready-to-show", () => state.settingsWindow?.show());
  state.settingsWindow.on("closed", () => { state.settingsWindow = null; });
  await state.settingsWindow.loadURL(`${url}/mac-settings.html`);
  return true;
}

async function openDetached({ type = "aircraft", id = "" } = {}) {
  const url = state.getServerUrl?.();
  if (!url) return false;
  const safeType = ["aircraft", "airport", "airportDesk"].includes(type) ? type : "aircraft";
  const window = new BrowserWindow({
    ...sharedWindowOptions(),
    width: safeType === "aircraft" ? 720 : 1040,
    height: safeType === "aircraft" ? 760 : 820,
    minWidth: 620,
    minHeight: 520,
    title: safeType === "aircraft" ? "SkyTrace Aircraft" : "SkyTrace Airport Desk",
    titleBarStyle: "hiddenInset"
  });
  state.detachedWindows.add(window);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => state.detachedWindows.delete(window));
  await window.loadURL(`${url}/mac-detached.html?type=${encodeURIComponent(safeType)}&id=${encodeURIComponent(String(id || "").trim())}`);
  return true;
}

function showNativeNotification(payload = {}) {
  const settings = readSettings();
  if (process.platform !== "darwin" || !settings.notifications || state.alertsPaused || !Notification.isSupported()) return false;
  const title = String(payload.title || "SkyTrace").slice(0, 120);
  const body = String(payload.body || "").slice(0, 500);
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", () => {
    showMain();
    const window = state.getMainWindow?.();
    if (window && !window.isDestroyed()) window.webContents.send("skytrace:navigate", payload.navigate || {});
  });
  notification.show();
  return true;
}

function registerIpc() {
  ipcMain.handle("skytrace:settings:open", () => openMacSettings());
  ipcMain.handle("skytrace:settings:get", () => readSettings());
  ipcMain.handle("skytrace:settings:save", (_event, next) => writeSettings(next));
  ipcMain.handle("skytrace:system:open-config", () => state.configPath ? shell.openPath(state.configPath) : false);
  ipcMain.handle("skytrace:system:show-data", () => { shell.showItemInFolder(state.settingsPath); return true; });
  ipcMain.handle("skytrace:system:show-log", () => { if (state.diagnosticLogPath) shell.showItemInFolder(state.diagnosticLogPath); return true; });
  ipcMain.handle("skytrace:login-item:get", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("skytrace:login-item:set", (_event, enabled) => {
    const next = readSettings();
    next.launchAtLogin = Boolean(enabled);
    return writeSettings(next).launchAtLogin;
  });
  ipcMain.handle("skytrace:notification:show", (_event, payload) => showNativeNotification(payload));
  ipcMain.handle("skytrace:alerts:get-paused", () => state.alertsPaused);
  ipcMain.handle("skytrace:alerts:set-paused", (_event, paused) => { state.alertsPaused = Boolean(paused); syncTray(); return state.alertsPaused; });
  ipcMain.on("skytrace:menubar:status", (_event, status) => {
    state.menuStatus = {
      flights: Math.max(0, Number(status?.flights) || 0),
      watchHits: Math.max(0, Number(status?.watchHits) || 0),
      connection: String(status?.connection || "Ready").slice(0, 40)
    };
    syncTray();
  });
  ipcMain.handle("skytrace:window:detached", (_event, payload) => openDetached(payload));
  ipcMain.handle("skytrace:window:focus-main", (_event, action) => showMain(String(action || "")));
  ipcMain.on("skytrace:local-replay:ingest", (_event, snapshot) => { void ingestReplay(snapshot); });
  ipcMain.handle("skytrace:local-replay:query", (_event, options) => queryReplay(options));
  ipcMain.handle("skytrace:local-replay:clear", async () => {
    await fs.promises.rm(state.replayPath, { force: true }).catch(() => {});
    return { ok: true };
  });
  ipcMain.handle("skytrace:local-replay:stats", () => replayStats());
}

export function installMacNativeMain({ getMainWindow, getServerUrl, configPath, diagnosticLogPath = "" } = {}) {
  if (state.installed || process.platform !== "darwin") return false;
  state.installed = true;
  state.getMainWindow = typeof getMainWindow === "function" ? getMainWindow : state.getMainWindow;
  state.getServerUrl = typeof getServerUrl === "function" ? getServerUrl : state.getServerUrl;
  state.configPath = String(configPath || "");
  state.diagnosticLogPath = String(diagnosticLogPath || "");
  const userData = app.getPath("userData");
  state.settingsPath = path.join(userData, "mac-native.json");
  state.replayPath = path.join(userData, "local-replay.ndjson");
  const settings = readSettings();
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, openAsHidden: false });
  registerIpc();
  syncTray(settings);
  powerMonitor.on("on-battery", () => BrowserWindow.getAllWindows().forEach(w => w.webContents.send("skytrace:power-state", { onBattery: true })));
  powerMonitor.on("on-ac", () => BrowserWindow.getAllWindows().forEach(w => w.webContents.send("skytrace:power-state", { onBattery: false })));
  void pruneReplay(true);
  return true;
}
