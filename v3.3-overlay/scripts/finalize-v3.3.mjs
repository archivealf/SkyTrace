import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const BUILD = "3.3.1-performance-rc";
const DISPLAY = "V3.3.1 RC";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function write(rel, text) {
  fs.writeFileSync(path.join(root, rel), text);
}
function replaceAll(rel, pairs) {
  let text = read(rel);
  for (const [from, to] of pairs) text = text.split(from).join(to);
  write(rel, text);
}

replaceAll("index.html", [
  ["3.3.0-commerce-glass", BUILD],
  ["3.2.0-free", BUILD]
]);
replaceAll("v3.3-commerce.js", [
  ["3.3.0-commerce-glass", BUILD],
  ['appVersion.textContent = "V3.3"', `appVersion.textContent = "${DISPLAY}"`]
]);
replaceAll("server.js", [
  ["3.3.0-commerce-glass", BUILD],
  ["3.2.0-free", BUILD]
]);
for (const rel of ["api/config.js", "api/health.js"]) {
  if (fs.existsSync(path.join(root, rel))) {
    replaceAll(rel, [
      ["3.2.0-free", BUILD],
      ["3.3.0-commerce-glass", BUILD]
    ]);
  }
}

const packagePath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = "3.3.1";
pkg.description = "SkyTrace live aviation intelligence for macOS with accounts, permanent upgrades and performance-optimized liquid-glass UI.";
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Finalized SkyTrace ${BUILD}.`);
