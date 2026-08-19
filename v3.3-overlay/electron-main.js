import { app, BrowserWindow, Menu, shell, dialog, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName("SkyTrace");

let mainWindow = null;
let skyTraceServer = null;

const DEFAULT_CONFIG = {
  server: { port: 3000 },
  providers: {
    live: "adsblol",
    liveStaleCache: true,
    aircraftEnrichment: true,
    routes: true,
    aviationWeather: true,
    generalWeather: true,
    precipitation: true
  },
  commerce: { enabled: true, baseUrl: "http://127.0.0.1:8787" }
};

function ensureUserConfig() {
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });

  const configPath = path.join(userData, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, {
      mode: 0o600
    });
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const existingProviders = existing?.providers && typeof existing.providers === "object" ? existing.providers : {};
      const hasLegacyProviderConfig =
        ["openSkyFallback", "adsbdb", "openMeteo", "rainViewer"].some((key) => key in existingProviders) ||
        Boolean(existing?.opensky);
      let configChanged = false;
      if (hasLegacyProviderConfig) {
        existing.providers = {
          live: "adsblol",
          liveStaleCache: true,
          aircraftEnrichment: true,
          routes: true,
          aviationWeather: existingProviders.aviationWeather !== false,
          generalWeather: true,
          precipitation: true
        };
        delete existing.opensky;
        configChanged = true;
      }

      const releaseCommerceUrl = String(DEFAULT_CONFIG?.commerce?.baseUrl || "").trim();
      const existingCommerceUrl = String(existing?.commerce?.baseUrl || "").trim();
      const loopbackCommerce = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(existingCommerceUrl);
      const shouldMigrateCommerce =
        app.isPackaged &&
        /^https:\/\//i.test(releaseCommerceUrl) &&
        (!existingCommerceUrl || loopbackCommerce);

      if (shouldMigrateCommerce) {
        existing.commerce = {
          ...(existing.commerce && typeof existing.commerce === "object" ? existing.commerce : {}),
          enabled: true,
          baseUrl: releaseCommerceUrl
        };
        configChanged = true;
      }

      if (configChanged) {
        fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, {
          mode: 0o600
        });
      }
    } catch (error) {
      console.warn("Could not migrate SkyTrace config:", error?.message || error);
    }
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
    show: false,
    title: "SkyTrace",
    backgroundColor: "#07090d",
    vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    visualEffectState: process.platform === "darwin" ? "active" : undefined,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
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
  const userData = app.getPath("userData");

  if (process.platform === "darwin" && app.dock) {
    const iconPath = path.join(__dirname, "assets", "SkyTrace.png");
    if (fs.existsSync(iconPath)) {
      const dockIcon = nativeImage.createFromPath(iconPath);
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    }
  }

  globalThis.__SKYTRACE_CONFIG_PATH__ = configPath;
  globalThis.__SKYTRACE_DATA_DIR__ = userData;
  globalThis.__SKYTRACE_DESKTOP__ = true;

  const { startSkyTraceServer } = await import("./server.js");

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
