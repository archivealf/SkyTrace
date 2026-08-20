import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = Object.freeze({
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
  commerce: {
    enabled: true,
    baseUrl: "http://127.0.0.1:8787"
  }
});

function resolveConfigPath() {
  const desktopPath = globalThis.__SKYTRACE_CONFIG_PATH__;
  if (typeof desktopPath === "string" && desktopPath.trim()) return path.resolve(desktopPath);
  return path.resolve(__dirname, "../config.json");
}

export const configPath = resolveConfigPath();

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    console.warn(`[SkyTrace] config.json was not found at ${configPath}. Using the free commercial provider stack.`);
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const port = Number(raw?.server?.port);
    return {
      server: {
        port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3000
      },
      providers: {
        live: "adsblol",
        liveStaleCache: raw?.providers?.liveStaleCache !== false,
        aircraftEnrichment: raw?.providers?.aircraftEnrichment !== false,
        routes: raw?.providers?.routes !== false,
        aviationWeather: raw?.providers?.aviationWeather !== false,
        generalWeather: raw?.providers?.generalWeather !== false,
        precipitation: raw?.providers?.precipitation !== false
      },
      commerce: {
        enabled: raw?.commerce?.enabled !== false,
        baseUrl: cleanString(raw?.commerce?.baseUrl) || "http://127.0.0.1:8787"
      }
    };
  } catch (error) {
    console.error(`[SkyTrace] Could not read config.json: ${error.message}`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export const config = Object.freeze(loadConfig());
