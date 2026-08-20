import { app, autoUpdater, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CURRENT_RELEASE_TAG = "v3.4.0-rc1";
const CURRENT_RELEASE_LABEL = "SkyTrace V3.4.0 RC1";
const RELEASES_API = "https://api.github.com/repos/archivealf/SkyTrace/releases?per_page=12";
const MAC_UPDATE_BASE = "https://update.electronjs.org/archivealf/SkyTrace/darwin";
const AUTO_UPDATE_FIRST_CHECK_MS = 15_000;
const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_LOG_BYTES = 1024 * 1024;
const KEEP_LOG_BYTES = 512 * 1024;
let reliabilityInstalled = false;
let automaticUpdatesStarted = false;
let nativeUpdaterReady = false;
let updateDownloadedPromptShown = false;
let autoUpdateTimer = null;

function releaseParts(tag) {
  const match = String(tag || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] == null ? null : Number(match[4])
  };
}

function compareReleaseTags(a, b) {
  const left = releaseParts(a);
  const right = releaseParts(b);
  if (!left || !right) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.rc == null && right.rc != null) return 1;
  if (left.rc != null && right.rc == null) return -1;
  if (left.rc == null && right.rc == null) return 0;
  return left.rc === right.rc ? 0 : left.rc > right.rc ? 1 : -1;
}

function displayTag(tag) {
  return String(tag || "").replace(/^v/i, "V").replace(/-rc(\d+)$/i, " RC$1");
}

function logDirectory() {
  const base = app.getPath("logs");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function desktopLogPath() {
  return path.join(logDirectory(), "desktop.log");
}

function trimLogIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= MAX_LOG_BYTES) return;
    const fd = fs.openSync(file, "r");
    try {
      const keep = Math.min(KEEP_LOG_BYTES, stat.size);
      const buffer = Buffer.allocUnsafe(keep);
      fs.readSync(fd, buffer, 0, keep, stat.size - keep);
      fs.writeFileSync(file, buffer, { mode: 0o600 });
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function logDesktopEvent(type, value = "") {
  try {
    const file = desktopLogPath();
    trimLogIfNeeded(file);
    const line = `[${new Date().toISOString()}] ${type}: ${value instanceof Error ? (value.stack || value.message) : String(value)}\n`;
    fs.appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Diagnostics must never become a startup failure.
  }
}

export function installDesktopReliability() {
  if (reliabilityInstalled) return;
  reliabilityInstalled = true;

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    logDesktopEvent("uncaughtException", `${origin || "unknown"}: ${error?.stack || error?.message || String(error)}`);
  });
  app.on("render-process-gone", (_event, webContents, details) => {
    logDesktopEvent("render-process-gone", `${details?.reason || "unknown"} exit=${details?.exitCode ?? "?"} url=${webContents?.getURL?.() || ""}`);
  });
  app.on("child-process-gone", (_event, details) => {
    logDesktopEvent("child-process-gone", `${details?.type || "unknown"} ${details?.reason || "unknown"} exit=${details?.exitCode ?? "?"}`);
  });
  logDesktopEvent("desktop", `${CURRENT_RELEASE_LABEL} started`);
}

export function attachWindowDiagnostics(window) {
  const contents = window?.webContents;
  if (!contents) return;
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) logDesktopEvent("did-fail-load", `${errorCode} ${errorDescription} ${validatedURL}`);
  });
  contents.on("console-message", details => {
    if (details?.level === "warning" || details?.level === "error") {
      logDesktopEvent("renderer-console", `${details.message || ""} (${details.sourceId || "renderer"}:${details.lineNumber ?? "?"})`);
    }
  });
  contents.on("unresponsive", () => logDesktopEvent("renderer", "unresponsive"));
  contents.on("responsive", () => logDesktopEvent("renderer", "responsive"));
}

async function fetchReleases() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RELEASES_API, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `SkyTrace/${app.getVersion()}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error("Unexpected GitHub release response");
    return releases
      .filter(release => !release?.draft && releaseParts(release?.tag_name))
      .sort((a, b) => compareReleaseTags(b.tag_name, a.tag_name));
  } finally {
    clearTimeout(timer);
  }
}

function macBundlePath() {
  return path.resolve(path.dirname(process.execPath), "..", "..");
}

function hasDeveloperMacSignature() {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  try {
    const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", macBundlePath()], {
      encoding: "utf8",
      timeout: 5000
    });
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.status !== 0) return false;
    const match = detail.match(/TeamIdentifier=([^\s]+)/);
    return Boolean(match && match[1] && match[1].toLowerCase() !== "not" && match[1].toLowerCase() !== "unset");
  } catch {
    return false;
  }
}

function nativeMacFeedUrl() {
  return `${MAC_UPDATE_BASE}/${encodeURIComponent(app.getVersion())}`;
}

function checkNativeUpdates() {
  if (!nativeUpdaterReady) return;
  try {
    autoUpdater.checkForUpdates();
  } catch (error) {
    logDesktopEvent("auto-update-check-failed", error);
  }
}

export function startAutomaticUpdates(parentWindow = null) {
  if (automaticUpdatesStarted) return nativeUpdaterReady;
  automaticUpdatesStarted = true;

  if (process.platform !== "darwin" || !app.isPackaged) {
    logDesktopEvent("auto-update", "native updater skipped: not a packaged macOS app");
    return false;
  }

  if (!hasDeveloperMacSignature()) {
    logDesktopEvent("auto-update", "native updater disabled: macOS build is not Developer ID signed; manual release checks remain available");
    return false;
  }

  try {
    autoUpdater.setFeedURL({ url: nativeMacFeedUrl() });
    nativeUpdaterReady = true;
  } catch (error) {
    logDesktopEvent("auto-update-feed-failed", error);
    return false;
  }

  autoUpdater.on("checking-for-update", () => logDesktopEvent("auto-update", "checking"));
  autoUpdater.on("update-available", () => logDesktopEvent("auto-update", "new release available; download started"));
  autoUpdater.on("update-not-available", () => logDesktopEvent("auto-update", "up to date"));
  autoUpdater.on("error", error => logDesktopEvent("auto-update-error", error));
  autoUpdater.on("update-downloaded", async (_event, releaseNotes, releaseName) => {
    logDesktopEvent("auto-update", `downloaded ${releaseName || "new release"}`);
    if (updateDownloadedPromptShown) return;
    updateDownloadedPromptShown = true;

    const result = await dialog.showMessageBox(parentWindow || undefined, {
      type: "info",
      title: "SkyTrace Update Ready",
      message: `${releaseName || "A SkyTrace update"} has been downloaded`,
      detail: "Restart SkyTrace now to install it, or choose Later. A downloaded update will also be applied on a future restart.",
      buttons: ["Restart and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });

  setTimeout(checkNativeUpdates, AUTO_UPDATE_FIRST_CHECK_MS);
  autoUpdateTimer = setInterval(checkNativeUpdates, AUTO_UPDATE_INTERVAL_MS);
  autoUpdateTimer.unref?.();
  logDesktopEvent("auto-update", `enabled via ${MAC_UPDATE_BASE}`);
  return true;
}

export async function checkForUpdates(parentWindow = null) {
  try {
    const releases = await fetchReleases();
    const newer = releases.find(release => compareReleaseTags(release.tag_name, CURRENT_RELEASE_TAG) > 0);

    if (!newer) {
      await dialog.showMessageBox(parentWindow || undefined, {
        type: "info",
        title: "SkyTrace Updates",
        message: "SkyTrace is up to date",
        detail: `${CURRENT_RELEASE_LABEL} is the newest published SkyTrace release available to this update channel.`,
        buttons: ["OK"]
      });
      return;
    }

    if (nativeUpdaterReady) {
      checkNativeUpdates();
      await dialog.showMessageBox(parentWindow || undefined, {
        type: "info",
        title: "SkyTrace Update Available",
        message: `${displayTag(newer.tag_name)} is available`,
        detail: "SkyTrace has started the automatic macOS updater. The update will download in the background and SkyTrace will tell you when it is ready to install.",
        buttons: ["OK"]
      });
      return;
    }

    const result = await dialog.showMessageBox(parentWindow || undefined, {
      type: "info",
      title: "SkyTrace Update Available",
      message: `${displayTag(newer.tag_name)} is available`,
      detail: "This SkyTrace build cannot self-update automatically. Open the verified GitHub release to review the notes and install the correct macOS build.",
      buttons: ["View Release", "Later"],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0 && /^https:\/\//i.test(String(newer.html_url || ""))) {
      await shell.openExternal(newer.html_url);
    }
  } catch (error) {
    logDesktopEvent("update-check-failed", error);
    await dialog.showMessageBox(parentWindow || undefined, {
      type: "warning",
      title: "Could Not Check for Updates",
      message: "SkyTrace could not reach the update service.",
      detail: "Your current installation is unchanged. Check your internet connection and try again later.",
      buttons: ["OK"]
    });
  }
}
