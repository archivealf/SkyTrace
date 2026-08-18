import { app, BrowserWindow, Menu, shell, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName("SkyTrace");

let mainWindow = null;
let skyTraceServer = null;

const DEFAULT_CONFIG = {
  server: { port: 3000 },
  opensky: { clientId: "", clientSecret: "" },
  skylink: { apiKey: "" },
  airframes: {
    apiKey: "",
    enabled: true,
    redactSensitive: true
  }
};

function ensureUserConfig() {
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });

  const configPath = path.join(userData, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, {
      mode: 0o600
    });
  }

  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Non-fatal on filesystems that do not expose POSIX permissions.
  }

  return configPath;
}

async function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: "SkyTrace",
    backgroundColor: "#050609",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//i.test(target)) {
      void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    const allowedOrigin = new URL(url).origin;
    try {
      if (new URL(target).origin !== allowedOrigin) {
        event.preventDefault();
        if (/^https:\/\//i.test(target)) void shell.openExternal(target);
      }
    } catch {
      event.preventDefault();
    }
  });

  await mainWindow.loadURL(url);
}

function buildMenu(configPath) {
  const template = [
    {
      label: "SkyTrace",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Open config.json",
          accelerator: "CmdOrCtrl+,",
          click: () => void shell.openPath(configPath)
        },
        {
          label: "Show Config Folder",
          click: () => shell.showItemInFolder(configPath)
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Refresh Flight Data",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.reloadIgnoringCache()
        },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    },
    {
      role: "help",
      submenu: [
        {
          label: "SkyTrace Project",
          click: () => void shell.openExternal("https://github.com/archivealf/SkyTrace")
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot() {
  const configPath = ensureUserConfig();

  // These globals are set before importing the backend so the backend reads
  // the per-user config file rather than any file inside the application bundle.
  globalThis.__SKYTRACE_CONFIG_PATH__ = configPath;
  globalThis.__SKYTRACE_DESKTOP__ = true;

  const { startSkyTraceServer } = await import("./server.js");

  // Port 0 asks macOS for an available loopback port, avoiding "port already in use".
  skyTraceServer = await startSkyTraceServer({
    port: 0,
    host: "127.0.0.1",
    quiet: true
  });

  buildMenu(configPath);
  await createWindow(skyTraceServer.url);
}

app.whenReady().then(boot).catch(async (error) => {
  console.error(error);
  await dialog.showErrorBox(
    "SkyTrace could not start",
    error?.stack || error?.message || String(error)
  );
  app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0 && skyTraceServer) {
    await createWindow(skyTraceServer.url);
  }
});

app.on("before-quit", () => {
  try {
    skyTraceServer?.server?.close();
  } catch {
    // Closing is best-effort during app termination.
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
