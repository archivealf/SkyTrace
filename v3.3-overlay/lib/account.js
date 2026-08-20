import fs from "node:fs";
import path from "node:path";
import { config, configPath } from "./config.js";

const dataDir = globalThis.__SKYTRACE_DATA_DIR__ || path.dirname(configPath);
const sessionPath = path.join(dataDir, "account-session.json");

function accountBaseUrl() {
  const raw = String(config?.commerce?.baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { return ""; }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return "";
  return url.toString().replace(/\/$/, "");
}
function readSession() {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    return typeof parsed?.token === "string" && parsed.token ? parsed : null;
  } catch { return null; }
}
function writeSession(session) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(sessionPath, 0o600); } catch {}
}
function clearSession() { try { fs.rmSync(sessionPath, { force: true }); } catch {} }
function authHeaders() {
  const session = readSession();
  if (!session?.token) {
    const error = new Error("Sign in to your SkyTrace account first.");
    error.status = 401;
    throw error;
  }
  return { Authorization: `Bearer ${session.token}` };
}
async function fetchRemote(pathname, { method = "GET", body = null, auth = false, timeout = 12000 } = {}) {
  const base = accountBaseUrl();
  if (!config?.commerce?.enabled || !base) throw Object.assign(new Error("SkyTrace Account service is not configured yet."), { status: 503 });
  const headers = { Accept: "application/json" };
  if (body != null) headers["Content-Type"] = "application/json";
  if (auth) Object.assign(headers, authHeaders());
  try {
    return await fetch(`${base}${pathname}`, {
      method, headers, body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout)
    });
  } catch (cause) {
    const error = new Error("SkyTrace Account service is currently unreachable.");
    error.status = 503; error.cause = cause; throw error;
  }
}
async function remote(pathname, options = {}) {
  const response = await fetchRemote(pathname, options);
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.ok === false) {
    if (response.status === 401 && options.auth) clearSession();
    const error = new Error(payload?.error || `Account service request failed (${response.status}).`);
    error.status = response.status; throw error;
  }
  return payload;
}
function saveAuthResult(result) {
  if (!result?.token) throw Object.assign(new Error("Account service did not return a session."), { status: 502 });
  writeSession({ token: result.token, savedAt: new Date().toISOString() });
  const { token, ...safe } = result;
  return safe;
}

export function getAccountServiceConfig() {
  return { ok: true, enabled: Boolean(config?.commerce?.enabled && accountBaseUrl()), baseUrl: accountBaseUrl(), login: "username_password", cloudSync: true, cloudReplay: true };
}
export async function getAccountCatalog() { return remote("/v1/catalog"); }
export async function registerAccount({ username, password }) {
  return saveAuthResult(await remote("/v1/auth/register", { method: "POST", body: { username, password } }));
}
export async function loginAccount({ username, password }) {
  return saveAuthResult(await remote("/v1/auth/login", { method: "POST", body: { username, password } }));
}
export async function getAccount() {
  const session = readSession();
  if (!session?.token) return { ok: true, authenticated: false, entitlements: [], effectiveEntitlements: [] };
  try {
    let result = await remote("/v1/account", { auth: true });
    const current = readSession();
    if (current?.pendingCheckoutId) {
      try {
        const confirmed = await remote("/v1/checkout/confirm", { method: "POST", body: { sessionId: current.pendingCheckoutId }, auth: true });
        if (confirmed?.paid) {
          const next = readSession();
          if (next?.token) { delete next.pendingCheckoutId; writeSession(next); }
          result = { ok: true, authenticated: true, ...confirmed };
        }
      } catch {}
    }
    return result;
  } catch (error) {
    if (error.status === 401) return { ok: true, authenticated: false, entitlements: [], effectiveEntitlements: [] };
    throw error;
  }
}
export async function logoutAccount() {
  try { if (readSession()?.token) await remote("/v1/auth/logout", { method: "POST", auth: true }); }
  catch {} finally { clearSession(); }
  return { ok: true, authenticated: false };
}
export async function createAccountCheckout(productKey) {
  const result = await remote("/v1/checkout", { method: "POST", body: { productKey }, auth: true });
  if (result?.sessionId) {
    const session = readSession();
    if (session?.token) writeSession({ ...session, pendingCheckoutId: result.sessionId });
  }
  return result;
}
export async function confirmAccountCheckout(sessionId) {
  const result = await remote("/v1/checkout/confirm", { method: "POST", body: { sessionId }, auth: true });
  if (result?.paid) {
    const session = readSession();
    if (session?.token) { delete session.pendingCheckoutId; writeSession(session); }
  }
  return result;
}
export async function redeemAccountCode(code) {
  return remote("/v1/redeem", { method: "POST", body: { code }, auth: true });
}
export async function getCloudBundle() { return remote("/v1/cloud", { auth: true }); }
export async function upsertCloudItem(item) { return remote("/v1/cloud/upsert", { method: "POST", body: item, auth: true }); }
export async function deleteCloudItem(item) { return remote("/v1/cloud/delete", { method: "POST", body: item, auth: true }); }
export async function ingestAccountHistory({ flights, recordedAt }) {
  if (!readSession()?.token || !Array.isArray(flights) || !flights.length) return { ok: true, skipped: true };
  try { return await remote("/v1/history/ingest", { method: "POST", body: { flights, recordedAt }, auth: true, timeout: 7000 }); }
  catch (error) { if (error.status === 401) return { ok: true, skipped: true }; throw error; }
}
export async function getAccountHistory(search = "") {
  const suffix = search ? (String(search).startsWith("?") ? String(search) : `?${search}`) : "";
  return remote(`/v1/history${suffix}`, { auth: true, timeout: 18000 });
}
export async function getAccountHistoryExport(search = "", format = "csv") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  params.set("format", format);
  const response = await fetchRemote(`/v1/history?${params.toString()}`, { auth: true, timeout: 18000 });
  if (!response.ok) {
    let payload = {}; try { payload = await response.json(); } catch {}
    throw Object.assign(new Error(payload?.error || `History export failed (${response.status}).`), { status: response.status });
  }
  const body = Buffer.from(await response.arrayBuffer());
  return { ok: true, contentType: response.headers.get("content-type") || "application/octet-stream", body: body.toString("base64") };
}
