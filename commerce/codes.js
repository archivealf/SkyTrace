import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");
const PRODUCTS = Object.freeze({
  pro: { name: "SkyTrace Pro", entitlement: "pro", tag: "PRO" },
  airport_intelligence: { name: "Airport Intelligence", entitlement: "airport_intelligence", tag: "AIR" },
  advanced_aircraft: { name: "Advanced Aircraft", entitlement: "advanced_aircraft", tag: "ACFT" },
  replay_plus: { name: "Replay+", entitlement: "replay_plus", tag: "RPLY" },
  themes: { name: "Themes", entitlement: "themes", tag: "THEME" }
});
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function now() { return Date.now(); }
function id(prefix, bytes = 12) { return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`; }
function normalizeCode(value) { return clean(value).toUpperCase().replace(/\s+/g, ""); }
function readConfig() {
  if (!fs.existsSync(configPath)) throw new Error(`Missing commerce config: ${configPath}`);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const pepper = clean(raw?.security?.pepper);
  if (pepper.length < 32) throw new Error("security.pepper must be configured first.");
  const dataFile = path.resolve(__dirname, clean(raw?.dataFile) || "data/store.json");
  const sqliteFile = path.resolve(__dirname, clean(raw?.sqliteFile) || dataFile.replace(/\.json$/i, "") + ".sqlite3");
  return { pepper, sqliteFile };
}
const config = readConfig();
if (!fs.existsSync(config.sqliteFile)) throw new Error(`SQLite store is not initialized yet: ${config.sqliteFile}. Start the commerce server once first.`);
const db = new DatabaseSync(config.sqliteFile, { timeout: 5000 });
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");

function codeHash(value) { return crypto.createHmac("sha256", config.pepper).update(normalizeCode(value)).digest("hex"); }
function randomChunk(length = 4) { let out = ""; while (out.length < length) out += ALPHABET[crypto.randomInt(ALPHABET.length)]; return out; }
function makeCode(tag) { return `SKY-${tag}-${randomChunk()}-${randomChunk()}-${randomChunk()}`; }
function parseOptions(args) {
  const options = { maxUses: 1, days: 0, label: "" };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i], value = args[i + 1];
    if (flag === "--uses") { options.maxUses = Math.max(1, Math.min(10000, Number(value) || 1)); i += 1; }
    else if (flag === "--days") { options.days = Math.max(0, Math.min(3650, Number(value) || 0)); i += 1; }
    else if (flag === "--label") { options.label = clean(value).slice(0, 80); i += 1; }
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}
function help() {
  console.log(`SkyTrace redeem-code manager\n\nGenerate:\n  node codes.js generate pro 5\n  node codes.js generate themes 20 --days 30 --label launch\n  node codes.js generate pro 1 --uses 25 --label event\n\nManage:\n  node codes.js list\n  node codes.js revoke <code-id-or-full-code>\n\nProducts:\n  ${Object.keys(PRODUCTS).join("\n  ")}\n\nCodes are shown only when generated. SQLite stores an HMAC hash, never the plaintext code.`);
}

const [command = "help", ...args] = process.argv.slice(2);
if (["help", "-h", "--help"].includes(command)) { help(); process.exit(0); }

if (command === "generate") {
  const productKey = clean(args[0]);
  const product = PRODUCTS[productKey];
  if (!product) throw new Error(`Unknown product. Use one of: ${Object.keys(PRODUCTS).join(", ")}`);
  const count = Math.max(1, Math.min(100, Number(args[1]) || 1));
  const options = parseOptions(args.slice(2));
  const insert = db.prepare(`INSERT INTO codes(id,code_hash,prefix,last4,product_key,entitlement,name,max_uses,uses,label,created_at,expires_at,revoked_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)`);
  const plaintext = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let i = 0; i < count; i += 1) {
      let code, hash;
      do { code = makeCode(product.tag); hash = codeHash(code); } while (db.prepare("SELECT 1 FROM codes WHERE code_hash=?").get(hash));
      const createdAt = now();
      insert.run(id("code"), hash, `SKY-${product.tag}`, code.slice(-4), productKey, product.entitlement, product.name,
        options.maxUses, 0, options.label, createdAt, options.days ? createdAt + options.days * 86_400_000 : null);
      plaintext.push(code);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  console.log(`Created ${count} ${product.name} code${count === 1 ? "" : "s"}:`);
  plaintext.forEach(code => console.log(code));
  console.log("\nSave these now. Plaintext codes are not stored on the server.");
  process.exit(0);
}

if (command === "list") {
  const rows = db.prepare(`SELECT id,product_key,uses,max_uses,prefix,last4,expires_at,revoked_at,label FROM codes ORDER BY created_at DESC`).all()
    .map(code => ({ id: code.id, product: code.product_key, uses: `${code.uses}/${code.max_uses}`,
      status: code.revoked_at ? "revoked" : code.expires_at && code.expires_at <= now() ? "expired" : "active",
      hint: `${code.prefix}-…-${code.last4}`, expires: code.expires_at ? new Date(code.expires_at).toISOString() : "never", label: code.label || "" }));
  if (!rows.length) console.log("No redeem codes have been created."); else console.table(rows);
  process.exit(0);
}

if (command === "revoke") {
  const target = clean(args[0]);
  if (!target) throw new Error("Provide a code ID or full code to revoke.");
  const normalized = normalizeCode(target);
  const row = normalized.startsWith("SKY-")
    ? db.prepare("SELECT id FROM codes WHERE code_hash=?").get(codeHash(normalized))
    : db.prepare("SELECT id FROM codes WHERE id=?").get(target);
  if (!row) throw new Error("Code not found.");
  db.prepare("UPDATE codes SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(now(), row.id);
  console.log(`Revoked ${row.id}.`);
  process.exit(0);
}

throw new Error(`Unknown command: ${command}`);
