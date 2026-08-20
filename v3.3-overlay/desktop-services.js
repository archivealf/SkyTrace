import { app, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

const CURRENT_RELEASE_TAG = "v3.4.0-rc1";
const CURRENT_RELEASE_LABEL = "SkyTrace V3.4.0 RC1";
const RELEASES_API = "https://api.github.com/repos/archivealf/SkyTrace/releases?per_page=12";
const MAX_LOG_BYTES = 1024 * 1024;
const KEEP_LOG_BYTES = 512 * 1024;
let reliabilityInstalled = false;

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

  process.on("uncaughtException", error => logDesktopEvent("uncaughtException", error));
  process.on("unhandledRejection", reason => logDesktopEvent("unhandledRejection", reason instanceof Error ? reason : String(reason)));
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

    const result = await dialog.showMessageBox(parentWindow || undefined, {
      type: "info",
      title: "SkyTrace Update Available",
      message: `${displayTag(newer.tag_name)} is available`,
      detail: "Open the verified SkyTrace GitHub release to review the notes and download the correct macOS build.",
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
