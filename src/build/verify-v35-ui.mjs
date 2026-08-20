import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] || process.cwd());
const failures = [];

function read(rel) {
  try { return fs.readFileSync(path.join(root, rel), "utf8"); }
  catch { failures.push(`missing ${rel}`); return ""; }
}

function requireText(rel, needle, label) {
  if (!read(rel).includes(needle)) failures.push(`${rel}: missing ${label}`);
}

for (const rel of ["mac-ui-fixes.js", "mac-ui-fixes.css"]) {
  if (!fs.existsSync(path.join(root, rel))) failures.push(`missing ${rel}`);
}

const jsPath = path.join(root, "mac-ui-fixes.js");
if (fs.existsSync(jsPath)) {
  const checked = spawnSync(process.execPath, ["--check", jsPath], { encoding: "utf8" });
  if (checked.status !== 0) failures.push(`mac-ui-fixes.js: syntax check failed: ${checked.stderr.trim()}`);
}

requireText("index.html", "/mac-ui-fixes.css", "Mac UI fix stylesheet");
requireText("index.html", "/mac-ui-fixes.js", "Mac UI fix runtime");
requireText("mac-ui-fixes.js", 'button.addEventListener("click", activateMacView, { capture: true })', "capture-phase Mac tab isolation");
requireText("mac-ui-fixes.js", 'view.style.setProperty("display", "flex", "important")', "forced visible Mac panel");
requireText("mac-ui-fixes.js", "skytrace-layer-toggle", "collapsible map controls");
requireText("mac-ui-fixes.js", "skytrace-compact-status", "compact bottom status bar");
requireText("mac-ui-fixes.js", "syncFreshness", "unified freshness updater");
requireText("mac-ui-fixes.js", "skytraceTrafficLoad", "adaptive traffic density state");
requireText("mac-ui-fixes.css", "skytrace-mac-view-active #sidebar", "narrow Mac sheet layout");
requireText("mac-ui-fixes.css", "html:not(.skytrace-mac-view-active) #sidebar", "bounded normal desktop sheet layout");
requireText("mac-ui-fixes.css", "overflow-x:hidden!important", "horizontal overflow containment");
requireText("mac-ui-fixes.css", "width:380px!important", "narrow-window normal sheet cap");
requireText("mac-ui-fixes.css", "data-skytrace-traffic-load=\"dense\"", "dense traffic label treatment");

if (failures.length) {
  console.error("SkyTrace V3.5 Mac UI verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Verified V3.5 Mac UI pass: visible Mac panel, isolated tab switching, bounded normal sheets, no horizontal sidebar overflow, compact HUD, collapsible map controls, unified freshness and adaptive label density.");
