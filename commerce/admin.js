import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");
const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
const dataFile = path.resolve(__dirname, String(raw?.dataFile || "data/store.json"));
const sqliteFile = path.resolve(__dirname, String(raw?.sqliteFile || dataFile.replace(/\.json$/i, "") + ".sqlite3"));
const tokenFile = path.join(path.dirname(sqliteFile), "admin-token.txt");
const configured = String(raw?.security?.adminToken || "").trim();

function ensureToken() {
  if (configured.length >= 32) return { token: configured, source: "config.json security.adminToken" };
  try {
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    if (token.length >= 32) return { token, source: tokenFile };
  } catch {}
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  try { fs.chmodSync(tokenFile, 0o600); } catch {}
  return { token, source: tokenFile };
}

const command = process.argv[2] || "show";
if (command === "show" || command === "token") {
  const item = ensureToken();
  console.log(`SkyTrace admin token (${item.source}):`);
  console.log(item.token);
  console.log("\nOpen /admin on the commerce HTTPS domain and enter this token. Keep it private.");
} else if (command === "rotate") {
  if (configured.length >= 32) throw new Error("security.adminToken is set in config.json. Remove/change that value there instead of rotating the token file.");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  try { fs.chmodSync(tokenFile, 0o600); } catch {}
  console.log("Rotated SkyTrace admin token:");
  console.log(token);
  console.log("\nRestart skytrace-commerce so the running server loads the new token.");
} else {
  console.log("Usage: node admin.js [show|rotate]");
  process.exitCode = 2;
}
