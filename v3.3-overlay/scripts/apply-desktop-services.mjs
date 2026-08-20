import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] || ".");
const overlayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(overlayRoot, "desktop-services.js");
const target = path.join(root, "desktop-services.js");
const mainFile = path.join(root, "electron-main.js");

if (!fs.existsSync(source)) throw new Error("Desktop services source is missing.");
fs.copyFileSync(source, target);

let main = fs.readFileSync(mainFile, "utf8");

const importMarker = 'import { app, BrowserWindow, Menu, shell, dialog, nativeImage } from "electron";';
const servicesImport = 'import { attachWindowDiagnostics, checkForUpdates, desktopLogPath, installDesktopReliability, logDesktopEvent } from "./desktop-services.js";';
if (!main.includes(servicesImport)) {
  if (!main.includes(importMarker)) throw new Error("Could not locate Electron import for desktop services.");
  main = main.replace(importMarker, `${importMarker}\n${servicesImport}`);
}

const windowMarker = '  // Wait for the renderer document and its startup-polish script to finish';
if (!main.includes("attachWindowDiagnostics(mainWindow);")) {
  if (!main.includes(windowMarker)) throw new Error("Could not locate window diagnostics insertion point.");
  main = main.replace(windowMarker, `  attachWindowDiagnostics(mainWindow);\n\n${windowMarker}`);
}

const menuMarker = '        { role: "about" },\n        { type: "separator" },';
if (!main.includes('label: "Check for Updates…"')) {
  if (!main.includes(menuMarker)) throw new Error("Could not locate SkyTrace menu for updater.");
  main = main.replace(menuMarker, `        { role: "about" },\n        {\n          label: "Check for Updates…",\n          click: () => void checkForUpdates(mainWindow)\n        },\n        { type: "separator" },`);
}

const configFolderMarker = `        {\n          label: "Show Config Folder",\n          click: () => shell.showItemInFolder(configPath)\n        },`;
if (!main.includes('label: "Show Diagnostic Log"')) {
  if (!main.includes(configFolderMarker)) throw new Error("Could not locate diagnostic menu insertion point.");
  main = main.replace(configFolderMarker, `${configFolderMarker}\n        {\n          label: "Show Diagnostic Log",\n          click: () => shell.showItemInFolder(desktopLogPath())\n        },`);
}

const bootMarker = '  const configPath = ensureUserConfig();\n  const userData = app.getPath("userData");';
if (!main.includes("installDesktopReliability();")) {
  if (!main.includes(bootMarker)) throw new Error("Could not locate boot diagnostics insertion point.");
  main = main.replace(bootMarker, `${bootMarker}\n  installDesktopReliability();`);
}

const catchMarker = 'app.whenReady().then(boot).catch(async (error) => {\n  console.error(error);';
if (!main.includes('logDesktopEvent("boot-failed", error);')) {
  if (!main.includes(catchMarker)) throw new Error("Could not locate desktop boot failure handler.");
  main = main.replace(catchMarker, `app.whenReady().then(boot).catch(async (error) => {\n  console.error(error);\n  logDesktopEvent("boot-failed", error);`);
}

fs.writeFileSync(mainFile, main);
console.log("Applied native SkyTrace update checks and desktop diagnostics.");
