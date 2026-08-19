import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

function cleanString(value) { return typeof value === "string" ? value.trim() : ""; }
function now() { return Date.now(); }
function id(prefix, bytes = 12) { return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`; }
function normalizeCode(value) { return cleanString(value).toUpperCase().replace(/\s+/g, ""); }
function readConfig() {
  if (!fs.existsSync(configPath)) throw new Error(`Missing commerce config: ${configPath}`);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const pepper = cleanString(raw?.security?.pepper);
  if (pepper.length < 32) throw new Error("security.pepper must be configured first.");
  return { pepper, dataFile: path.resolve(__dirname, cleanString(raw?.dataFile) || "data/store.json") };
}
const config = readConfig();
function codeHash(value) { return crypto.createHmac("sha256", config.pepper).update(normalizeCode(value)).digest("hex"); }
function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    return { version: Math.max(3, Number(parsed?.version) || 0), users: [], sessions: [], purchases: [], codes: [], ...parsed };
  } catch { return { version: 3, users: [], sessions: [], purchases: [], codes: [] }; }
}
function saveStore(store) {
  store.version = Math.max(3, Number(store.version) || 0);
  const temp = `${config.dataFile}.tmp-codes-cli-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, config.dataFile);
  try { fs.chmodSync(config.dataFile, 0o600); } catch {}
}
function randomChunk(length = 4) {
  let out = "";
  while (out.length < length) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}
function makeCode(tag) { return `SKY-${tag}-${randomChunk()}-${randomChunk()}-${randomChunk()}`; }
function parseOptions(args) {
  const options = { maxUses: 1, days: 0, label: "" };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--uses") { options.maxUses = Math.max(1, Math.min(10000, Number(value) || 1)); i += 1; }
    else if (flag === "--days") { options.days = Math.max(0, Math.min(3650, Number(value) || 0)); i += 1; }
    else if (flag === "--label") { options.label = cleanString(value).slice(0, 80); i += 1; }
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}
function help() {
  console.log(`SkyTrace redeem-code manager\n\nGenerate codes:\n  node codes.js generate pro 5\n  node codes.js generate themes 20 --days 30 --label launch-giveaway\n  node codes.js generate pro 1 --uses 25 --label event-code\n\nManage codes:\n  node codes.js list\n  node codes.js revoke <code-id-or-full-code>\n\nProducts:\n  ${Object.keys(PRODUCTS).join("\n  ")}\n\nCodes are shown only when generated. The store keeps an HMAC hash, not the plaintext code.`);
}

const [command = "help", ...args] = process.argv.slice(2);
if (["help", "-h", "--help"].includes(command)) { help(); process.exit(0); }

if (command === "generate") {
  const productKey = cleanString(args[0]);
  const product = PRODUCTS[productKey];
  if (!product) throw new Error(`Unknown product. Use one of: ${Object.keys(PRODUCTS).join(", ")}`);
  const count = Math.max(1, Math.min(100, Number(args[1]) || 1));
  const options = parseOptions(args.slice(2));
  const store = loadStore();
  store.codes = Array.isArray(store.codes) ? store.codes : [];
  const plaintext = [];
  for (let i = 0; i < count; i += 1) {
    let code;
    let hash;
    do { code = makeCode(product.tag); hash = codeHash(code); } while (store.codes.some(item => item.codeHash === hash));
    const createdAt = now();
    store.codes.push({
      id: id("code"), codeHash: hash, prefix: code.split("-").slice(0, 2).join("-"), last4: code.slice(-4),
      productKey, entitlement: product.entitlement, name: product.name,
      maxUses: options.maxUses, uses: 0, redemptions: [], label: options.label,
      createdAt, expiresAt: options.days ? createdAt + options.days * 86_400_000 : null, revokedAt: null
    });
    plaintext.push(code);
  }
  saveStore(store);
  console.log(`Created ${count} ${product.name} code${count === 1 ? "" : "s"}:`);
  for (const code of plaintext) console.log(code);
  console.log("\nSave these now. Plaintext codes are not stored on the server.");
  process.exit(0);
}

if (command === "list") {
  const store = loadStore();
  const rows = (store.codes || []).map(code => ({
    id: code.id,
    product: code.productKey,
    uses: `${Number(code.uses) || 0}/${Math.max(1, Number(code.maxUses) || 1)}`,
    status: code.revokedAt ? "revoked" : code.expiresAt && code.expiresAt <= now() ? "expired" : "active",
    hint: `${code.prefix || "SKY"}-…-${code.last4 || "????"}`,
    expires: code.expiresAt ? new Date(code.expiresAt).toISOString() : "never",
    label: code.label || ""
  }));
  if (!rows.length) console.log("No redeem codes have been created.");
  else console.table(rows);
  process.exit(0);
}

if (command === "revoke") {
  const target = cleanString(args[0]);
  if (!target) throw new Error("Provide a code ID or full code to revoke.");
  const store = loadStore();
  const normalized = normalizeCode(target);
  const hash = normalized.startsWith("SKY-") ? codeHash(normalized) : "";
  const code = (store.codes || []).find(item => item.id === target || (hash && item.codeHash === hash));
  if (!code) throw new Error("Code not found.");
  if (!code.revokedAt) code.revokedAt = now();
  saveStore(store);
  console.log(`Revoked ${code.id} (${code.prefix || "SKY"}-…-${code.last4 || "????"}).`);
  process.exit(0);
}

throw new Error(`Unknown command: ${command}`);
