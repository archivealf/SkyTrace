import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const payloadDir = path.join(root, "source-payload");

const parts = fs.readdirSync(payloadDir)
  .filter((name) => /^frontend\.part\d+$/.test(name))
  .sort();

if (!parts.length) throw new Error("SkyTrace frontend source payload is missing.");

const encoded = parts.map((name) => fs.readFileSync(path.join(payloadDir, name), "utf8").trim()).join("");
const json = zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
const files = JSON.parse(json);

for (const [relative, content] of Object.entries(files)) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error(`Unsafe payload path: ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

console.log(`Materialized ${Object.keys(files).length} SkyTrace frontend files.`);
