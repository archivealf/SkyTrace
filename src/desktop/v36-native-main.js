import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

let installed = false;

function safeFilters(input) {
  if (!Array.isArray(input)) return undefined;
  const out = input.slice(0, 6).map(item => ({
    name: String(item?.name || "File").slice(0, 40),
    extensions: Array.isArray(item?.extensions) ? item.extensions.map(value => String(value || "").replace(/[^a-z0-9]/gi, "").slice(0, 12)).filter(Boolean).slice(0, 8) : []
  })).filter(item => item.extensions.length);
  return out.length ? out : undefined;
}

async function saveTextFile(payload = {}) {
  const content = String(payload?.content ?? "");
  if (Buffer.byteLength(content, "utf8") > 20 * 1024 * 1024) throw new Error("Export is larger than the 20 MB desktop safety limit.");
  const defaultName = String(payload?.defaultName || "SkyTrace-export.txt").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "SkyTrace-export.txt";
  const result = await dialog.showSaveDialog({
    title: "Save SkyTrace Export",
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: safeFilters(payload?.filters),
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fs.promises.writeFile(result.filePath, content, { encoding: "utf8", mode: 0o600 });
  return { ok: true, filePath: result.filePath };
}

export function installV36ProductNative() {
  if (installed || process.platform !== "darwin") return false;
  installed = true;
  ipcMain.handle("skytrace:app:version", () => app.getVersion());
  ipcMain.handle("skytrace:system:open-external", async (_event, raw) => {
    const target = String(raw || "");
    let url;
    try { url = new URL(target); } catch { return false; }
    if (url.protocol !== "https:") return false;
    await shell.openExternal(url.toString());
    return true;
  });
  ipcMain.handle("skytrace:file:save-text", (_event, payload) => saveTextFile(payload));
  return true;
}
