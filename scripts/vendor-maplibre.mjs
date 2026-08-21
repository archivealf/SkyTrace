import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "node_modules", "maplibre-gl", "dist");
const targetDir = path.join(root, "vendor", "maplibre-gl");
const files = ["maplibre-gl.js", "maplibre-gl.css"];

for (const name of files) {
  const source = path.join(sourceDir, name);
  if (!fs.existsSync(source)) {
    throw new Error(`MapLibre runtime asset is missing after npm install: ${source}`);
  }
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

for (const name of files) {
  fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"));
fs.writeFileSync(
  path.join(targetDir, "VERSION"),
  `${String(pkg.version || "unknown")}\n`,
  { encoding: "utf8", mode: 0o644 }
);

console.log(`Vendored MapLibre ${pkg.version || "unknown"} runtime assets into vendor/maplibre-gl.`);
