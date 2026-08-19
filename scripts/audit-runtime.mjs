import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set([".git", "node_modules", "out", "v3.2-bundle", "source-payload", "source-payload-fixed", "data", "backups"]);
const textExtensions = new Set([".js", ".mjs", ".cjs", ".sh", ".html", ".css", ".json", ".yml", ".yaml"]);
const jsExtensions = new Set([".js", ".mjs", ".cjs"]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExtensions.has(path.extname(entry.name))) files.push(full);
  }
}
walk(root);

const failures = [];
let linesScanned = 0;
let jsFilesChecked = 0;
for (const file of files) {
  const rel = path.relative(root, file);
  const ext = path.extname(file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  linesScanned += lines.length;

  if (jsExtensions.has(ext)) {
    jsFilesChecked += 1;
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (checked.status !== 0) failures.push(`${rel}: JavaScript syntax check failed: ${checked.stderr.trim()}`);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = `${rel}:${i + 1}`;
    if (jsExtensions.has(ext)) {
      if (/\beval\s*\(/.test(line)) failures.push(`${at}: eval() is not allowed in SkyTrace executable code.`);
      if (/\bnew\s+Function\s*\(/.test(line)) failures.push(`${at}: new Function() is not allowed in SkyTrace executable code.`);
      if (/\bwhile\s*\(\s*true\s*\)/.test(line) || /\bfor\s*\(\s*;\s*;\s*\)/.test(line)) failures.push(`${at}: unbounded loop requires explicit review.`);
    }
  }
}

function runtimeText(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

const app = runtimeText("app.v3.js");
if (app) {
  for (const rel of ["app.v3.js", "v3.3-codes.js", "v3.3-platform.js", "v3.3-entitlement-sync.js", "v3.4-features.js"]) {
    const text = runtimeText(rel);
    if (!text) failures.push(`${rel}: expected materialized runtime file is missing.`);
    else if (text.includes("MutationObserver")) failures.push(`${rel}: document MutationObserver is forbidden in the desktop runtime; use explicit events instead.`);
  }

  if (!app.includes('data-airport-traffic-icao')) failures.push("app.v3.js: optimized observed-airport traffic rows are missing.");
  if (!app.includes('el.aircraftList?.querySelector(".aircraft-row.selected")?.classList.remove("selected")')) failures.push("app.v3.js: constant-time aircraft close path is missing.");
  if (app.includes('function closeFlight(){state.selectedId=null;state.followSelected=false;el.detailsPanel.classList.add("hidden");updateSelectedAircraftFilter();renderFlightList();')) failures.push("app.v3.js: old full-list close redraw is still present.");
  if (fs.existsSync(path.join(root, "v3.4-airport-traffic-fix.js"))) failures.push("Obsolete recursive airport-traffic compatibility runtime is still materialized.");

  const replay = runtimeText("v3.4-features.js") || "";
  if (replay.includes("state.replay.slice(0,end)")) failures.push("v3.4-features.js: replay redraw still allocates the full prefix on every playback step.");
  if (!replay.includes("Math.ceil(state.replay.length/300)")) failures.push("v3.4-features.js: bounded Replay+ stepping is missing.");
}

if (failures.length) {
  console.error(`SkyTrace source audit failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`SkyTrace source audit passed: ${files.length} text/code files, ${jsFilesChecked} JavaScript/module syntax checks, ${linesScanned.toLocaleString()} source lines scanned.`);
if (app) console.log("Materialized renderer stability checks passed: no document MutationObservers, no dynamic eval, constant-time aircraft close, optimized airport traffic and bounded Replay+ rendering.");
else console.log("Source-tree audit passed before materialization; generated runtime checks will run after materialization.");
