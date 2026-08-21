import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const commerceRoot = path.resolve(here, '..');
const dist = path.join(commerceRoot, 'node_modules', 'maplibre-gl', 'dist');
const target = path.join(commerceRoot, 'web', 'vendor', 'maplibre-gl');
const files = ['maplibre-gl.js', 'maplibre-gl.css'];

for (const name of files) {
  const source = path.join(dist, name);
  if (!fs.existsSync(source) || fs.statSync(source).size < 1024) {
    throw new Error(`MapLibre asset is missing: ${source}. Run npm install in commerce first.`);
  }
}

fs.mkdirSync(target, { recursive: true });
for (const name of files) {
  const source = path.join(dist, name);
  const destination = path.join(target, name);
  fs.copyFileSync(source, destination);
}

const pkgPath = path.join(commerceRoot, 'node_modules', 'maplibre-gl', 'package.json');
let version = '5';
try { version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || version; } catch {}
fs.writeFileSync(path.join(target, 'version.txt'), `${version}\n`);
console.log(`Vendored MapLibre GL JS ${version} into commerce/web/vendor/maplibre-gl.`);
