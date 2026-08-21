import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");
let sessionDays = 30;
let secureCookie = true;
try {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  sessionDays = Math.max(1, Math.min(365, Number(config?.security?.sessionDays) || 30));
  const publicUrl = String(config?.server?.publicUrl || "");
  secureCookie = /^https:\/\//i.test(publicUrl);
} catch {}

const COOKIE = "skytrace_session";
const SENTINEL = "__skytrace_cookie_session__";
const previousCreateServer = http.createServer.bind(http);

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
  }
  return "";
}

function sessionCookie(token) {
  const maxAge = Math.round(sessionDays * 86400);
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? "; Secure" : ""}`;
}

http.createServer = function rememberSessionCreateServer(...args) {
  const options = typeof args[0] === "function" ? null : args[0];
  const listener = typeof args[0] === "function" ? args[0] : args[1];
  const wrapped = (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const cookieToken = cookieValue(req.headers.cookie, COOKIE);
    if (cookieToken) req.headers.authorization = `Bearer ${cookieToken}`;
    else if (/^Bearer\s+__skytrace_cookie_session__$/i.test(String(req.headers.authorization || ""))) delete req.headers.authorization;

    const originalEnd = res.end.bind(res);
    res.end = function rememberSessionEnd(chunk, encoding, callback) {
      if (!res.headersSent) {
        if (req.method === "POST" && ["/v1/auth/login", "/v1/auth/register"].includes(url.pathname) && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
            const payload = JSON.parse(text);
            if (typeof payload?.token === "string" && payload.token.length >= 20) res.setHeader("Set-Cookie", sessionCookie(payload.token));
          } catch {}
        }
        if (req.method === "POST" && url.pathname === "/v1/auth/logout") res.setHeader("Set-Cookie", clearCookie());
      }
      return originalEnd(chunk, encoding, callback);
    };

    return listener(req, res);
  };
  return options == null ? previousCreateServer(wrapped) : previousCreateServer(options, wrapped);
};

export { COOKIE as SKYTRACE_SESSION_COOKIE, SENTINEL as SKYTRACE_SESSION_SENTINEL };
