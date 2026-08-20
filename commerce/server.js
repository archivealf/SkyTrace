import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");

const PRICE_IDS = Object.freeze({
  pro: "price_1U5rD119iuWs3yVBZ1Cl1iGe",
  airport_intelligence: "price_1U5rDF19iuWs3yVBUcK38gRO",
  advanced_aircraft: "price_1U5rDQ19iuWs3yVBoKeBPTfW",
  replay_plus: "price_1U5rDX19iuWs3yVBTTWlnAWk",
  themes: "price_1U5rDg19iuWs3yVBgPZmFESI"
});

const DEFAULT_PRODUCTS = Object.freeze({
  pro: { name: "SkyTrace Pro", amount: 799, currency: "gbp", entitlement: "pro", priceId: PRICE_IDS.pro },
  airport_intelligence: { name: "Airport Intelligence", amount: 199, currency: "gbp", entitlement: "airport_intelligence", priceId: PRICE_IDS.airport_intelligence },
  advanced_aircraft: { name: "Advanced Aircraft", amount: 199, currency: "gbp", entitlement: "advanced_aircraft", priceId: PRICE_IDS.advanced_aircraft },
  replay_plus: { name: "Replay+", amount: 199, currency: "gbp", entitlement: "replay_plus", priceId: PRICE_IDS.replay_plus },
  themes: { name: "Themes", amount: 99, currency: "gbp", entitlement: "themes", priceId: PRICE_IDS.themes }
});

function cleanString(value) { return typeof value === "string" ? value.trim() : ""; }
function readConfig() {
  if (!fs.existsSync(configPath)) throw new Error(`Missing commerce config: ${configPath}`);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const cfg = {
    server: {
      host: cleanString(raw?.server?.host) || "127.0.0.1",
      port: Number.isInteger(Number(raw?.server?.port)) ? Number(raw.server.port) : 8787,
      publicUrl: (cleanString(raw?.server?.publicUrl) || "http://127.0.0.1:8787").replace(/\/+$/, "")
    },
    security: {
      pepper: cleanString(raw?.security?.pepper),
      sessionDays: Math.max(1, Math.min(365, Number(raw?.security?.sessionDays) || 30)),
      allowRegistration: raw?.security?.allowRegistration !== false,
      minPasswordLength: Math.max(8, Math.min(64, Number(raw?.security?.minPasswordLength) || 10))
    },
    stripe: {
      enabled: raw?.stripe?.enabled === true,
      secretKey: cleanString(raw?.stripe?.secretKey),
      webhookSecret: cleanString(raw?.stripe?.webhookSecret)
    },
    products: structuredClone(DEFAULT_PRODUCTS),
    dataFile: path.resolve(__dirname, cleanString(raw?.dataFile) || "data/store.json")
  };
  if (raw?.products && typeof raw.products === "object") {
    for (const [key, value] of Object.entries(raw.products)) {
      if (!cfg.products[key] || !value || typeof value !== "object") continue;
      if (cleanString(value.priceId)) cfg.products[key].priceId = cleanString(value.priceId);
    }
  }
  if (cfg.security.pepper.length < 32) throw new Error("security.pepper must be a random secret of at least 32 characters.");
  if (!/^https:\/\//i.test(cfg.server.publicUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(cfg.server.publicUrl)) {
    throw new Error("server.publicUrl must use HTTPS unless it is localhost/127.0.0.1.");
  }
  return cfg;
}

const config = readConfig();
fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });

const EMPTY_STORE = () => ({ version: 2, users: [], sessions: [], purchases: [] });
function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    return { ...EMPTY_STORE(), ...parsed, version: 2 };
  } catch { return EMPTY_STORE(); }
}
function saveStore(store) {
  const temp = `${config.dataFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, config.dataFile);
  try { fs.chmodSync(config.dataFile, 0o600); } catch {}
}
let mutationQueue = Promise.resolve();
function mutateStore(fn) {
  const next = mutationQueue.then(() => {
    const store = loadStore();
    const result = fn(store);
    saveStore(store);
    return result;
  });
  mutationQueue = next.catch(() => {});
  return next;
}

function now() { return Date.now(); }
function id(prefix, bytes = 12) { return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`; }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function safeEqualBuffers(a, b) {
  try {
    const aa = Buffer.isBuffer(a) ? a : Buffer.from(a);
    const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}
function safeEqualHex(a, b) {
  try { return safeEqualBuffers(Buffer.from(String(a), "hex"), Buffer.from(String(b), "hex")); }
  catch { return false; }
}
function normalizeUsername(value) {
  const username = cleanString(value).toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) ? username : "";
}
function validatePassword(value) {
  const password = typeof value === "string" ? value : "";
  if (password.length < config.security.minPasswordLength || password.length > 128) return "";
  return password;
}
function passwordHash(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(`${password}\u0000${config.security.pepper}`, salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  }).toString("hex");
}
function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { passwordSalt: salt, passwordHash: passwordHash(password, salt) };
}
function verifyPassword(user, password) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  return safeEqualHex(user.passwordHash, passwordHash(password, user.passwordSalt));
}
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}
async function readBody(req, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const e = new Error("Request too large."); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try { return JSON.parse(body.toString("utf8")); }
  catch { const e = new Error("Invalid JSON request."); e.status = 400; throw e; }
}
function clientIp(req) {
  const forwarded = cleanString(req.headers["x-forwarded-for"]);
  return (forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress) || "unknown";
}

const authAttempts = new Map();
const registrations = new Map();
function trimAttempts(map, key, windowMs) {
  const cutoff = now() - windowMs;
  const list = (map.get(key) || []).filter(t => t > cutoff);
  map.set(key, list);
  return list;
}
function assertLoginAllowed(username, ip) {
  const key = `${username}|${ip}`;
  const list = trimAttempts(authAttempts, key, 15 * 60_000);
  if (list.length >= 8) { const e = new Error("Too many sign-in attempts. Try again later."); e.status = 429; throw e; }
}
function recordFailedLogin(username, ip) {
  const key = `${username}|${ip}`;
  const list = trimAttempts(authAttempts, key, 15 * 60_000);
  list.push(now());
  authAttempts.set(key, list);
}
function clearFailedLogins(username, ip) { authAttempts.delete(`${username}|${ip}`); }
function assertRegistrationAllowed(ip) {
  const list = trimAttempts(registrations, ip, 60 * 60_000);
  if (list.length >= 5) { const e = new Error("Too many account registrations from this device. Try again later."); e.status = 429; throw e; }
  list.push(now());
  registrations.set(ip, list);
}

function effectiveEntitlements(store, userId) {
  const owned = new Set(store.purchases.filter(p => p.userId === userId && p.status === "paid").map(p => p.entitlement));
  const effective = new Set(owned);
  if (owned.has("pro")) for (const product of Object.values(config.products)) effective.add(product.entitlement);
  return { entitlements: [...owned], effectiveEntitlements: [...effective] };
}
function publicUser(user) { return user ? { id: user.id, username: user.username, createdAt: user.createdAt } : null; }
function createSession(store, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  store.sessions = store.sessions.filter(s => s.expiresAt > now());
  store.sessions.push({ id: id("ses"), tokenHash: sha256(token), userId: user.id, createdAt: now(), expiresAt: now() + config.security.sessionDays * 86_400_000 });
  return token;
}
function authFromRequest(req) {
  const header = cleanString(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const tokenHash = sha256(match[1]);
  const store = loadStore();
  const session = store.sessions.find(s => s.tokenHash === tokenHash && s.expiresAt > now());
  if (!session) return null;
  const user = store.users.find(u => u.id === session.userId);
  return user ? { store, session, user } : null;
}
function requireAuth(req) {
  const auth = authFromRequest(req);
  if (!auth) { const e = new Error("Your session has expired. Sign in again."); e.status = 401; throw e; }
  return auth;
}

async function stripePost(pathname, fields) {
  if (!config.stripe.enabled) { const e = new Error("Payments are not enabled on this SkyTrace backend yet."); e.status = 503; throw e; }
  if (!config.stripe.secretKey.startsWith("sk_")) throw new Error("Stripe secret key is not configured on the backend.");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value != null) body.append(key, String(value));
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const e = new Error(payload?.error?.message || `Stripe returned ${response.status}.`);
    e.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw e;
  }
  return payload;
}
async function stripeGet(pathname) {
  if (!config.stripe.enabled) { const e = new Error("Payments are not enabled on this SkyTrace backend yet."); e.status = 503; throw e; }
  if (!config.stripe.secretKey.startsWith("sk_")) throw new Error("Stripe secret key is not configured on the backend.");
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    headers: { Authorization: `Bearer ${config.stripe.secretKey}` },
    signal: AbortSignal.timeout(15_000)
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const e = new Error(payload?.error?.message || `Stripe returned ${response.status}.`);
    e.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw e;
  }
  return payload;
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!config.stripe.webhookSecret.startsWith("whsec_")) return false;
  const parts = String(signatureHeader || "").split(",").map(x => x.trim());
  const timestamp = Number(parts.find(x => x.startsWith("t="))?.slice(2));
  const signatures = parts.filter(x => x.startsWith("v1=")).map(x => x.slice(3));
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", config.stripe.webhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  return signatures.some(sig => safeEqualHex(expected, sig));
}

async function grantCheckout(session) {
  const userId = cleanString(session?.metadata?.user_id) || cleanString(session?.client_reference_id);
  const entitlement = cleanString(session?.metadata?.entitlement);
  const productKey = cleanString(session?.metadata?.product_key);
  const sessionId = cleanString(session?.id);
  if (!userId || !entitlement || !sessionId) return;
  await mutateStore(store => {
    if (!store.users.some(u => u.id === userId)) return;
    const existing = store.purchases.find(p => p.stripeSessionId === sessionId);
    if (existing) {
      existing.status = "paid";
      existing.paymentIntent = cleanString(session.payment_intent) || existing.paymentIntent || "";
      existing.updatedAt = now();
      return;
    }
    store.purchases.push({
      id: id("pur"), userId, productKey, entitlement, status: "paid",
      stripeSessionId: sessionId, paymentIntent: cleanString(session.payment_intent),
      amountTotal: Number(session.amount_total) || null, currency: cleanString(session.currency),
      createdAt: now(), updatedAt: now()
    });
  });
}

async function handleStripeEvent(event) {
  const type = cleanString(event?.type);
  const object = event?.data?.object || {};
  if ((type === "checkout.session.completed" && object.payment_status === "paid") || type === "checkout.session.async_payment_succeeded") {
    await grantCheckout(object);
    return;
  }
  if (type === "charge.refunded" && object.refunded === true && object.payment_intent) {
    await mutateStore(store => {
      for (const purchase of store.purchases) {
        if (purchase.paymentIntent === object.payment_intent && purchase.status === "paid") {
          purchase.status = "refunded";
          purchase.updatedAt = now();
        }
      }
    });
  }
}

function catalog() {
  return Object.entries(config.products).map(([key, p]) => ({ key, name: p.name, amount: p.amount, currency: p.currency, entitlement: p.entitlement }));
}

async function route(req, res, url) {
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "SkyTrace Commerce",
      time: new Date().toISOString(),
      payments: config.stripe.enabled,
      auth: "username_password",
      registration: config.security.allowRegistration,
      webhook: config.stripe.webhookSecret.startsWith("whsec_")
    });
  }
  if (req.method === "GET" && url.pathname === "/v1/catalog") {
    return json(res, 200, { ok: true, products: catalog() });
  }
  if (req.method === "POST" && url.pathname === "/v1/auth/register") {
    if (!config.security.allowRegistration) { const e = new Error("New account registration is currently disabled."); e.status = 403; throw e; }
    assertRegistrationAllowed(clientIp(req));
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = validatePassword(body.password);
    if (!username) { const e = new Error("Username must be 3-32 characters using letters, numbers, dots, dashes or underscores."); e.status = 400; throw e; }
    if (!password) { const e = new Error(`Password must be ${config.security.minPasswordLength}-128 characters.`); e.status = 400; throw e; }
    const result = await mutateStore(store => {
      if (store.users.some(u => u.username === username)) { const e = new Error("That username is already taken."); e.status = 409; throw e; }
      const user = { id: id("usr"), username, ...makePasswordRecord(password), createdAt: now() };
      store.users.push(user);
      const token = createSession(store, user);
      return { token, user: publicUser(user), ...effectiveEntitlements(store, user.id) };
    });
    return json(res, 201, { ok: true, authenticated: true, ...result });
  }
  if (req.method === "POST" && url.pathname === "/v1/auth/login") {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) { const e = new Error("Enter your username and password."); e.status = 400; throw e; }
    const ip = clientIp(req);
    assertLoginAllowed(username, ip);
    const result = await mutateStore(store => {
      const user = store.users.find(u => u.username === username);
      if (!user || !verifyPassword(user, password)) {
        recordFailedLogin(username, ip);
        const e = new Error("Incorrect username or password.");
        e.status = 401;
        throw e;
      }
      clearFailedLogins(username, ip);
      const token = createSession(store, user);
      return { token, user: publicUser(user), ...effectiveEntitlements(store, user.id) };
    });
    return json(res, 200, { ok: true, authenticated: true, ...result });
  }
  if (req.method === "POST" && url.pathname === "/v1/auth/logout") {
    const auth = requireAuth(req);
    await mutateStore(store => { store.sessions = store.sessions.filter(s => s.id !== auth.session.id); });
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/v1/account") {
    const { store, user } = requireAuth(req);
    return json(res, 200, { ok: true, authenticated: true, user: publicUser(user), ...effectiveEntitlements(store, user.id) });
  }
  if (req.method === "POST" && url.pathname === "/v1/checkout") {
    const { store, user } = requireAuth(req);
    const body = await readJson(req);
    const productKey = cleanString(body.productKey);
    const product = config.products[productKey];
    if (!product) { const e = new Error("Unknown SkyTrace product."); e.status = 400; throw e; }
    const ent = effectiveEntitlements(store, user.id);
    if (ent.effectiveEntitlements.includes(product.entitlement)) { const e = new Error("This feature is already unlocked on your account."); e.status = 409; throw e; }
    const session = await stripePost("/v1/checkout/sessions", {
      mode: "payment",
      "line_items[0][price]": product.priceId,
      "line_items[0][quantity]": 1,
      customer_creation: "always",
      success_url: `${config.server.publicUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.server.publicUrl}/checkout/cancel`,
      client_reference_id: user.id,
      "metadata[user_id]": user.id,
      "metadata[product_key]": productKey,
      "metadata[entitlement]": product.entitlement,
      "payment_intent_data[metadata][user_id]": user.id,
      "payment_intent_data[metadata][product_key]": productKey,
      "payment_intent_data[metadata][entitlement]": product.entitlement
    });
    return json(res, 200, { ok: true, checkoutUrl: session.url, sessionId: session.id });
  }
  if (req.method === "POST" && url.pathname === "/v1/checkout/confirm") {
    const { user } = requireAuth(req);
    const body = await readJson(req);
    const sessionId = cleanString(body.sessionId);
    if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) { const e = new Error("Invalid Checkout Session."); e.status = 400; throw e; }
    const session = await stripeGet(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    const owner = cleanString(session?.metadata?.user_id) || cleanString(session?.client_reference_id);
    if (owner !== user.id) { const e = new Error("That Checkout Session belongs to a different SkyTrace account."); e.status = 403; throw e; }
    if (session.payment_status !== "paid") return json(res, 202, { ok: true, paid: false, status: session.payment_status || session.status || "pending" });
    await grantCheckout(session);
    const store = loadStore();
    return json(res, 200, { ok: true, paid: true, user: publicUser(user), ...effectiveEntitlements(store, user.id) });
  }
  if (req.method === "POST" && url.pathname === "/stripe/webhook") {
    if (!config.stripe.webhookSecret.startsWith("whsec_")) { const e = new Error("Stripe webhook is not configured on this local backend."); e.status = 503; throw e; }
    const raw = await readBody(req, 1_048_576);
    if (!verifyStripeSignature(raw, req.headers["stripe-signature"])) { const e = new Error("Invalid Stripe webhook signature."); e.status = 400; throw e; }
    const event = JSON.parse(raw.toString("utf8"));
    await handleStripeEvent(event);
    return json(res, 200, { received: true });
  }
  if (req.method === "GET" && ["/checkout/success", "/checkout/cancel"].includes(url.pathname)) {
    const success = url.pathname.endsWith("success");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SkyTrace</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050609;color:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.card{width:min(430px,calc(100% - 40px));padding:34px;border:1px solid #ffffff1f;border-radius:28px;background:#ffffff0d;backdrop-filter:blur(30px);box-shadow:0 24px 90px #0008}h1{margin:0 0 10px;font-size:30px}p{color:#a7abb4;line-height:1.55;margin:0}</style></head><body><main class="card"><h1>${success ? "Purchase complete" : "Checkout cancelled"}</h1><p>${success ? "Return to SkyTrace. The app will securely verify this Checkout Session with Stripe and unlock your purchase." : "Nothing was charged. You can return to SkyTrace whenever you are ready."}</p></main></body></html>`);
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url || "/", config.server.publicUrl);
  try {
    const handled = await route(req, res, url);
    if (handled !== false) return;
    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(error?.stack || error);
    if (res.headersSent) return res.end();
    json(res, error.status >= 400 && error.status < 600 ? error.status : 500, { ok: false, error: error.message || "Server error" });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`SkyTrace Commerce listening on http://${config.server.host}:${config.server.port}`);
  console.log(`Public URL: ${config.server.publicUrl}`);
  console.log(`Authentication: username + password`);
  console.log(`Stripe payments: ${config.stripe.enabled ? "enabled" : "disabled"}`);
  console.log(`Stripe webhook: ${config.stripe.webhookSecret.startsWith("whsec_") ? "enabled" : "optional/local confirm mode"}`);
});
