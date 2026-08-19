import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");
const attempts = new Map();

function cleanString(value) { return typeof value === "string" ? value.trim() : ""; }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function id(prefix, bytes = 12) { return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`; }
function now() { return Date.now(); }
function readConfig() {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const pepper = cleanString(raw?.security?.pepper);
  if (pepper.length < 32) throw new Error("security.pepper must be configured before redemption codes can be used.");
  return {
    pepper,
    dataFile: path.resolve(__dirname, cleanString(raw?.dataFile) || "data/store.json")
  };
}
const config = readConfig();

function normalizeCode(value) {
  return cleanString(value).toUpperCase().replace(/\s+/g, "");
}
function codeHash(value) {
  return crypto.createHmac("sha256", config.pepper).update(normalizeCode(value)).digest("hex");
}
function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    return { version: Math.max(3, Number(parsed?.version) || 0), users: [], sessions: [], purchases: [], codes: [], ...parsed };
  } catch {
    return { version: 3, users: [], sessions: [], purchases: [], codes: [] };
  }
}
function saveStore(store) {
  store.version = Math.max(3, Number(store.version) || 0);
  const temp = `${config.dataFile}.tmp-codes-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, config.dataFile);
  try { fs.chmodSync(config.dataFile, 0o600); } catch {}
}
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}
function json(res, status, payload) {
  securityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
async function readJson(req, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON request."), { status: 400 }); }
}
function requestIp(req) {
  const forwarded = cleanString(req.headers["x-forwarded-for"]);
  return (forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress) || "unknown";
}
function authUser(req, store) {
  const match = /^Bearer\s+(.+)$/i.exec(cleanString(req.headers.authorization));
  if (!match) return null;
  const tokenHash = sha256(match[1]);
  const session = store.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > now());
  return session ? store.users.find(user => user.id === session.userId) || null : null;
}
function effectiveEntitlements(store, userId) {
  const owned = new Set(store.purchases.filter(p => p.userId === userId && p.status === "paid").map(p => p.entitlement));
  const effective = new Set(owned);
  if (owned.has("pro")) for (const key of ["airport_intelligence", "advanced_aircraft", "replay_plus", "themes"]) effective.add(key);
  return { entitlements: [...owned], effectiveEntitlements: [...effective] };
}
function assertAttemptAllowed(userId, ip) {
  const key = `${userId}|${ip}`;
  const cutoff = now() - 15 * 60_000;
  const list = (attempts.get(key) || []).filter(time => time > cutoff);
  if (list.length >= 12) throw Object.assign(new Error("Too many code attempts. Try again later."), { status: 429 });
  list.push(now());
  attempts.set(key, list);
}
function productName(code) {
  return cleanString(code.name) || ({
    pro: "SkyTrace Pro",
    airport_intelligence: "Airport Intelligence",
    advanced_aircraft: "Advanced Aircraft",
    replay_plus: "Replay+",
    themes: "Themes"
  })[code.productKey] || code.productKey;
}

async function redeem(req, res) {
  try {
    const body = await readJson(req);
    const normalized = normalizeCode(body.code);
    if (!/^SKY-[A-Z0-9-]{12,40}$/.test(normalized)) {
      throw Object.assign(new Error("Enter a valid SkyTrace code."), { status: 400 });
    }

    const store = loadStore();
    const user = authUser(req, store);
    if (!user) throw Object.assign(new Error("Your session has expired. Sign in again."), { status: 401 });
    assertAttemptAllowed(user.id, requestIp(req));

    const hash = codeHash(normalized);
    const code = (store.codes || []).find(item => item.codeHash === hash);
    if (!code || code.revokedAt) throw Object.assign(new Error("That code is invalid or has been revoked."), { status: 404 });
    if (code.expiresAt && code.expiresAt <= now()) throw Object.assign(new Error("That code has expired."), { status: 410 });
    const uses = Number(code.uses) || 0;
    const maxUses = Math.max(1, Number(code.maxUses) || 1);
    if (uses >= maxUses) throw Object.assign(new Error("That code has already been used."), { status: 409 });

    const before = effectiveEntitlements(store, user.id);
    if (before.effectiveEntitlements.includes(code.entitlement)) {
      throw Object.assign(new Error("Your account already has this unlock. The code was not consumed."), { status: 409 });
    }

    const createdAt = now();
    const purchaseId = id("pur");
    store.purchases.push({
      id: purchaseId,
      userId: user.id,
      productKey: code.productKey,
      entitlement: code.entitlement,
      status: "paid",
      source: "redeem_code",
      codeId: code.id,
      amountTotal: 0,
      currency: "gbp",
      createdAt,
      updatedAt: createdAt
    });
    code.uses = uses + 1;
    code.redemptions = Array.isArray(code.redemptions) ? code.redemptions : [];
    code.redemptions.push({ userId: user.id, purchaseId, redeemedAt: createdAt });
    saveStore(store);

    const after = effectiveEntitlements(store, user.id);
    return json(res, 200, {
      ok: true,
      redeemed: { productKey: code.productKey, entitlement: code.entitlement, name: productName(code) },
      ...after
    });
  } catch (error) {
    return json(res, error.status >= 400 && error.status < 600 ? error.status : 500, {
      ok: false,
      error: error.message || "Could not redeem code."
    });
  }
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(...args) {
  let options = null;
  let listener = null;
  if (typeof args[0] === "function") listener = args[0];
  else { options = args[0]; listener = args[1]; }

  const wrapped = async (req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/v1/redeem") return redeem(req, res);
    return listener(req, res);
  };
  return options == null ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
};
