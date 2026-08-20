import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);

let html = read("index.html");
html = html
  .replace(/\/node_modules\/maplibre-gl\/dist\/maplibre-gl\.css/g, "/vendor/maplibre-gl/maplibre-gl.css")
  .replace(/\/node_modules\/maplibre-gl\/dist\/maplibre-gl\.js/g, "/vendor/maplibre-gl/maplibre-gl.js")
  .replace(/https:\/\/unpkg\.com\/maplibre-gl(?:@[^/\"']+)?\/dist\/maplibre-gl\.css/gi, "/vendor/maplibre-gl/maplibre-gl.css")
  .replace(/https:\/\/unpkg\.com\/maplibre-gl(?:@[^/\"']+)?\/dist\/maplibre-gl\.js/gi, "/vendor/maplibre-gl/maplibre-gl.js")
  .replace(/Connecting to OpenSky/g, "Connecting to ADSB.lol");
write("index.html", html);

const packagePath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.scripts = pkg.scripts || {};
const vendorCommand = "node scripts/vendor-maplibre.mjs";
const existingPostinstall = String(pkg.scripts.postinstall || "").trim();
if (!existingPostinstall.includes(vendorCommand)) {
  pkg.scripts.postinstall = [existingPostinstall, vendorCommand].filter(Boolean).join(" && ");
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

if (!html.includes("/vendor/maplibre-gl/maplibre-gl.js")) throw new Error("Local vendored MapLibre JS path was not applied.");
if (!html.includes("/vendor/maplibre-gl/maplibre-gl.css")) throw new Error("Local vendored MapLibre CSS path was not applied.");
if (html.includes("/node_modules/maplibre-gl/")) throw new Error("MapLibre still points into node_modules, which Forge excludes from the packaged app.");
if (!String(pkg.scripts.postinstall || "").includes(vendorCommand)) throw new Error("MapLibre vendor postinstall step was not configured.");

console.log("Applied packaged MapLibre vendor path and postinstall asset copy.");
