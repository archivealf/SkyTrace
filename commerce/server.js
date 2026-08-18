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
      publicUrl: (cleanString(raw?.server?.publicUrl) || "https://skytrace.duckdns.org").replace(/\/+$/, "")
    },
    security: {
      pepper: cleanString(raw?.security?.pepper),
      sessionDays: Math.max(1, Math.min(365, Number(raw?.security?.sessionDays) || 30)),
      otpMinutes: Math.max(3, Math.min(20, Number(raw?.security?.otpMinutes) || 10)),
      allowDevOtpEcho: raw?.security?.allowDevOtpEcho === true
    },
    mail: {
      mode: cleanString(raw?.mail?.mode) || "console",
      brevoApiKey: cleanString(raw?.mail?.brevoApiKey),
      senderName: cleanString(raw?.mail?.senderName) || "SkyTrace",
      senderEmail: cleanString(raw?.mail?.senderEmail)
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
    throw new Error("server.publicUrl must use HTTPS in production.");
  }
  return cfg;
}

const config = readConfig();
fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });

const EMPTY_STORE = () => ({ version: 1, users: [], challenges: [], sessions: [], purchases: [] });
function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    return { ...EMPTY_STORE(), ...parsed };
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
function hmac(value) { return crypto.createHmac("sha256", config.security.pepper).update(String(value)).digest("hex"); }
function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a), "hex"), bb = Buffer.from(String(b), "hex");
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}
function normalizeEmail(value) {
  const email = cleanString(value).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
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

const otpCooldown = new Map();
function checkOtpCooldown(email, ip) {
  const key = `${email}|${ip}`;
  const last = otpCooldown.get(key) || 0;
  const remaining = 60_000 - (now() - last);
  if (remaining > 0) {
    const e = new Error(`Please wait ${Math.ceil(remaining / 1000)} seconds before requesting another code.`);
    e.status = 429;
    e.retryAfter = Math.ceil(remaining / 1000);
    throw e;
  }
  otpCooldown.set(key, now());
}

async function sendOtp(email, code) {
  if (config.mail.mode === "console") {
    console.log(`[SkyTrace OTP] ${email}: ${code}`);
    return;
  }
  if (config.mail.mode !== "brevo") throw new Error("Unsupported mail.mode. Use console or brevo.");
  if (!config.mail.brevoApiKey) throw new Error("Brevo email is not configured.");
  if (!normalizeEmail(config.mail.senderEmail)) throw new Error("Brevo senderEmail must be a verified sender address.");

  const text = `Your SkyTrace sign-in code is ${code}. It expires in ${config.security.otpMinutes} minutes. If you did not request this code, you can ignore this email.`;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": config.mail.brevoApiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: { name: config.mail.senderName, email: config.mail.senderEmail },
      to: [{ email }],
      subject: "Your SkyTrace sign-in code",
      textContent: text,
      htmlContent: `<!doctype html><html><body style="margin:0;background:#080a0f;color:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><div style="max-width:520px;margin:0 auto;padding:40px 24px"><div style="padding:28px;border:1px solid #ffffff20;border-radius:24px;background:#11151d"><div style="font-size:13px;letter-spacing:.12em;color:#8d96a8">SKYTRACE</div><h1 style="font-size:24px;margin:12px 0 8px">Sign-in code</h1><div style="font-size:34px;font-weight:700;letter-spacing:.18em;margin:22px 0">${code}</div><p style="margin:0;color:#aeb6c5;line-height:1.6">This code expires in ${config.security.otpMinutes} minutes. If you did not request it, you can ignore this email.</p></div></div></body></html>`
    }),
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = cleanString(payload?.message) || cleanString(payload?.code);
    } catch {}
    const e = new Error(detail || `Brevo returned ${response.status}.`);
    e.status = 502;
    throw e;
  }
}

function effectiveEntitlements(store, userId) {
  const owned = new Set(store.purchases.filter(p => p.userId === userId && p.status === "paid").map(p => p.entitlement));
  const effective = new Set(owned);
  if (owned.has("pro")) for (const product of Object.values(config.products)) effective.add(product.entitlement);
  return { entitlements: [...owned], effectiveEntitlements: [...effective] };
}
function publicUser(user) { return user ? { id: user.id, email: user.email, createdAt: user.createdAt } : null; }
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

async function stripeRequest(pathname, fields) {
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

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!config.stripe.webhookSecret.startsWith("whsec_")) throw new Error("Stripe webhook secret is not configured.");
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
    return json(res, 200, { ok: true, service: "SkyTrace Commerce", time: new Date().toISOString(), payments: config.stripe.enabled, mail: config.mail.mode });
  }
  if (req.method === "GET" && url.pathname === "/v1/catalog") {
    return json(res, 200, { ok: true, products: catalog() });
  }
  if (req.method === "POST" && url.pathname === "/v1/auth/request-otp") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!email) { const e = new Error("Enter a valid email address."); e.status = 400; throw e; }
    checkOtpCooldown(email, clientIp(req));
    const challengeId = id("otp");
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = now() + config.security.otpMinutes * 60_000;
    await mutateStore(store => {
      store.challenges = store.challenges.filter(c => c.expiresAt > now() && !c.usedAt);
      store.challenges.push({ id: challengeId, email, codeHash: hmac(`${challengeId}|${email}|${code}`), createdAt: now(), expiresAt, attempts: 0, usedAt: null });
    });
    try { await sendOtp(email, code); }
    catch (error) {
      await mutateStore(store => { store.challenges = store.challenges.filter(c => c.id !== challengeId); });
      throw error;
    }
    const response = { ok: true, challengeId, expiresIn: config.security.otpMinutes * 60 };
    if (config.mail.mode === "console" && config.security.allowDevOtpEcho) response.devCode = code;
    return json(res, 200, response);
  }
  if (req.method === "POST" && url.pathname === "/v1/auth/verify-otp") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const challengeId = cleanString(body.challengeId);
    const code = cleanString(body.code);
    if (!email || !challengeId || !/^\d{6}$/.test(code)) { const e = new Error("Enter the six-digit code from your email."); e.status = 400; throw e; }
    const result = await mutateStore(store => {
      const challenge = store.challenges.find(c => c.id === challengeId && c.email === email);
      if (!challenge || challenge.usedAt || challenge.expiresAt <= now()) { const e = new Error("That sign-in code has expired. Request a new one."); e.status = 400; throw e; }
      if (challenge.attempts >= 5) { const e = new Error("Too many attempts. Request a new sign-in code."); e.status = 429; throw e; }
      challenge.attempts += 1;
      if (!safeEqualHex(challenge.codeHash, hmac(`${challengeId}|${email}|${code}`))) { const e = new Error("That sign-in code is incorrect."); e.status = 400; throw e; }
      challenge.usedAt = now();
      let user = store.users.find(u => u.email === email);
      if (!user) { user = { id: id("usr"), email, createdAt: now() }; store.users.push(user); }
      const token = crypto.randomBytes(32).toString("base64url");
      store.sessions.push({ id: id("ses"), tokenHash: sha256(token), userId: user.id, createdAt: now(), expiresAt: now() + config.security.sessionDays * 86_400_000 });
      const ent = effectiveEntitlements(store, user.id);
      return { token, user: publicUser(user), ...ent };
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
    const session = await stripeRequest("/v1/checkout/sessions", {
      mode: "payment",
      "line_items[0][price]": product.priceId,
      "line_items[0][quantity]": 1,
      success_url: `${config.server.publicUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.server.publicUrl}/checkout/cancel`,
      client_reference_id: user.id,
      customer_email: user.email,
      "metadata[user_id]": user.id,
      "metadata[product_key]": productKey,
      "metadata[entitlement]": product.entitlement,
      "payment_intent_data[metadata][user_id]": user.id,
      "payment_intent_data[metadata][product_key]": productKey,
      "payment_intent_data[metadata][entitlement]": product.entitlement
    });
    return json(res, 200, { ok: true, checkoutUrl: session.url, sessionId: session.id });
  }
  if (req.method === "POST" && url.pathname === "/stripe/webhook") {
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
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SkyTrace</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050609;color:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.card{width:min(430px,calc(100% - 40px));padding:34px;border:1px solid #ffffff1f;border-radius:28px;background:#ffffff0d;backdrop-filter:blur(30px);box-shadow:0 24px 90px #0008}h1{margin:0 0 10px;font-size:30px}p{color:#a7abb4;line-height:1.55;margin:0}</style></head><body><main class="card"><h1>${success ? "Purchase complete" : "Checkout cancelled"}</h1><p>${success ? "Your SkyTrace account is being updated. Return to the SkyTrace app; your purchase should unlock automatically within a few seconds." : "Nothing was charged. You can return to SkyTrace whenever you are ready."}</p></main></body></html>`);
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
    if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
    json(res, error.status >= 400 && error.status < 600 ? error.status : 500, { ok: false, error: error.message || "Server error", retryAfter: error.retryAfter || null });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`SkyTrace Commerce listening on http://${config.server.host}:${config.server.port}`);
  console.log(`Public URL: ${config.server.publicUrl}`);
  console.log(`Stripe payments: ${config.stripe.enabled ? "enabled" : "disabled"}`);
  console.log(`Email OTP: ${config.mail.mode}`);
});