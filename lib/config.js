import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = Object.freeze({
  server: { port: 3000 },
  opensky: { clientId: "", clientSecret: "" },
  skylink: { apiKey: "" },
  airframes: {
    apiKey: "",
    enabled: true,
    redactSensitive: true
  }
});

function resolveConfigPath() {
  const desktopPath = globalThis.__SKYTRACE_CONFIG_PATH__;
  if (typeof desktopPath === "string" && desktopPath.trim()) {
    return path.resolve(desktopPath);
  }
  return path.resolve(__dirname, "../config.json");
}

export const configPath = resolveConfigPath();

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    console.warn(`[SkyTrace] config.json was not found at ${configPath}. Starting with optional API integrations disabled.`);
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const port = Number(raw?.server?.port);

    return {
      server: {
        port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3000
      },
      opensky: {
        clientId: cleanString(raw?.opensky?.clientId),
        clientSecret: cleanString(raw?.opensky?.clientSecret)
      },
      skylink: {
        apiKey: cleanString(raw?.skylink?.apiKey)
      },
      airframes: {
        apiKey: cleanString(raw?.airframes?.apiKey),
        enabled: raw?.airframes?.enabled !== false,
        redactSensitive: raw?.airframes?.redactSensitive !== false
      }
    };
  } catch (error) {
    console.error(`[SkyTrace] Could not read config.json: ${error.message}`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export const config = Object.freeze(loadConfig());

export function hasOpenSkyCredentials() {
  return Boolean(config.opensky.clientId && config.opensky.clientSecret);
}

export function hasSkyLinkKey() {
  return Boolean(config.skylink.apiKey);
}

export function hasAirframesKey() {
  return Boolean(config.airframes.enabled && config.airframes.apiKey);
}
