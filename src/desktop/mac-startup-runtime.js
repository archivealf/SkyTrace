import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";

let installed = false;
let readyReported = false;
let state = {
  diagnosticLogPath: "",
  getMainWindow: () => null
};

function clean(value, max = 1000) {
  return String(value ?? "").replace(/[\r\n\0]+/g, " ").slice(0, max);
}

function append(type, detail = "") {
  try {
    const file = state.diagnosticLogPath || path.join(app.getPath("logs"), "desktop.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${clean(type, 80)}: ${clean(detail, 4000)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {}
}

function attachWindowMilestones(attempt = 0) {
  const window = state.getMainWindow?.();
  if (!window || window.isDestroyed()) {
    if (attempt < 80) setTimeout(() => attachWindowMilestones(attempt + 1), 100);
    return;
  }
  const contents = window.webContents;
  if (contents.__skytraceStartupMilestonesAttached) return;
  contents.__skytraceStartupMilestonesAttached = true;
  contents.on("dom-ready", () => append("renderer-dom-ready", contents.getURL()));
  contents.on("did-finish-load", () => append("renderer-did-finish-load", contents.getURL()));
  contents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) append("renderer-did-fail-load", `${code} ${description} ${validatedURL}`);
  });
  contents.on("unresponsive", () => append("renderer-unresponsive", contents.getURL()));
  contents.on("responsive", () => append("renderer-responsive", contents.getURL()));
}

function payloadHealthy(payload = {}) {
  return payload.health === true &&
    payload.auth === true &&
    payload.runtime === true &&
    payload.shell === true &&
    payload.degraded !== true;
}

export function installMacStartupRuntime({ diagnosticLogPath = "", getMainWindow } = {}) {
  if (installed || process.platform !== "darwin") return false;
  installed = true;
  state.diagnosticLogPath = String(diagnosticLogPath || "");
  state.getMainWindow = typeof getMainWindow === "function" ? getMainWindow : state.getMainWindow;

  append("startup-runtime", `installed version=${app.getVersion()} packaged=${app.isPackaged}`);

  ipcMain.on("skytrace:startup:ready", (_event, payload = {}) => {
    if (readyReported) return;
    readyReported = true;
    const detail = `health=${payload.health === true} auth=${payload.auth === true} runtime=${payload.runtime === true} shell=${payload.shell === true} degraded=${payload.degraded === true} reason=${clean(payload.reason, 160)} url=${clean(payload.url, 500)}`;
    append("renderer-ready", detail);
    if (process.env.SKYTRACE_SMOKE_TEST === "1") {
      setTimeout(() => app.exit(payloadHealthy(payload) ? 0 : 2), 250);
    }
  });

  ipcMain.on("skytrace:startup:error", (_event, payload = {}) => {
    append("renderer-startup-error", `${clean(payload.type, 120)} ${clean(payload.message, 2500)} ${clean(payload.source, 700)}`);
  });

  attachWindowMilestones();

  if (process.env.SKYTRACE_SMOKE_TEST === "1") {
    const timer = setTimeout(() => {
      if (!readyReported) {
        append("startup-smoke-timeout", "renderer never reported a healthy authenticated runtime state");
        app.exit(3);
      }
    }, 30000);
    timer.unref?.();
  }

  return true;
}
