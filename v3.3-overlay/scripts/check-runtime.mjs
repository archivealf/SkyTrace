import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = [
  "electron-main.js",
  "desktop-services.js",
  "server.js",
  "app.v3.js",
  "v3.3-codes.js",
  "v3.3-entitlement-sync.js",
  "v3.3-platform.js",
  "v3.3-export-fix.js",
  "v3.4-features.js",
  "v3.4-polish.js",
  "airlines.v2.2.js",
  "service-worker.v3.js",
  "scripts/update-aviation-data.mjs",
  "scripts/generate-skytrace-icon.mjs",
  "scripts/check-runtime.mjs",
  "lib/config.js",
  "lib/account.js",
  "lib/live.js",
  "lib/airports.js",
  "lib/aircraft.js",
  "lib/weather.js",
  "lib/precipitation.js",
  "lib/aviationweather.js"
];

const apiDir = path.join(root, "api");
if (fs.existsSync(apiDir)) {
  for (const name of fs.readdirSync(apiDir).filter(name => name.endsWith(".js")).sort()) {
    files.push(path.join("api", name));
  }
}

let checked = 0;
for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error(`Runtime check is missing required file: ${rel}`);
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`JavaScript syntax check failed: ${rel}`);
  }
  checked++;
}

console.log(`SkyTrace runtime syntax checks passed: ${checked} files.`);
