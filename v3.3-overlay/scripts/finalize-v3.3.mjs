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
  ["3.2.0-free", BUILD],
  ["V3.2 FREE", DISPLAY]
]);
replaceAll("styles.v3.css", [
  ["/* V3.2 Free Stack */", "/* SkyTrace V3.3.1 runtime styles */"]
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

// ASAR is enabled through forge.config.cjs. Native shell.openPath cannot open a
// virtual file inside app.asar, so read attribution through Electron's ASAR-aware
// fs layer and show it in a native dialog instead.
let electron = read("electron-main.js");
const oldAttributionAction = 'click: () => void shell.openPath(path.join(__dirname, "ATTRIBUTION.md"))';
const newAttributionAction = `click: () => {
            try {
              const attribution = fs.readFileSync(path.join(__dirname, "ATTRIBUTION.md"), "utf8");
              void dialog.showMessageBox({
                type: "info",
                title: "Data Licences & Attribution",
                message: "SkyTrace data licences and attribution",
                detail: attribution
              });
            } catch (error) {
              void dialog.showErrorBox("SkyTrace", \`Could not open attribution information: \${error?.message || error}\`);
            }
          }`;
if (!electron.includes(oldAttributionAction)) {
  throw new Error("Expected attribution Help action was not found during V3.3.1 finalization.");
}
electron = electron.replace(oldAttributionAction, newAttributionAction);
write("electron-main.js", electron);

const packagePath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = "3.3.1";
pkg.description = "SkyTrace live aviation intelligence for macOS with accounts, permanent upgrades and performance-optimized liquid-glass UI.";
pkg.config = { forge: "./forge.config.cjs" };
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Finalized SkyTrace ${BUILD}.`);
