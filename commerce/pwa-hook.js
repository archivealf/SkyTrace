import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "web");
const AIRLINES_FILE = path.resolve(__dirname, "..", "airlines.v2.2.js");
const previousCreateServer = http.createServer.bind(http);

function headers(res, type, cache = "no-store") {
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function localFile(name) {
  const target = path.resolve(WEB_ROOT, name);
  const root = path.resolve(WEB_ROOT) + path.sep;
  if (!target.startsWith(root)) return null;
  return fs.existsSync(target) ? target : null;
}

function servePath(res, file, type, cache) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  headers(res, type, cache);
  fs.createReadStream(file).pipe(res);
}

function serveFile(res, name, type, cache) {
  return servePath(res, localFile(name), type, cache);
}

function serveBase64(res, name, type, cache) {
  const file = localFile(name);
  if (!file) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  let data;
  try {
    data = Buffer.from(fs.readFileSync(file, "utf8").replace(/\s+/g, ""), "base64");
  } catch {
    res.statusCode = 500;
    return res.end("Invalid icon asset");
  }
  headers(res, type, cache);
  res.setHeader("Content-Length", String(data.length));
  res.end(data);
}

const APP_ASSETS = new Map([
  ["/app/web-mobile.css", ["web-mobile.css", "text/css; charset=utf-8"]],
  ["/app/web-mobile.js", ["web-mobile.js", "text/javascript; charset=utf-8"]],
  ["/app/web-session-35.js", ["web-session-35.js", "text/javascript; charset=utf-8"]],
  ["/app/web-mobile-35.css", ["web-mobile-35.css", "text/css; charset=utf-8"]],
  ["/app/web-mobile-35.js", ["web-mobile-35.js", "text/javascript; charset=utf-8"]],
  ["/app/web-mobile-35-fix.css", ["web-mobile-35-fix.css", "text/css; charset=utf-8"]],
  ["/app/web-mobile-35-fix.js", ["web-mobile-35-fix.js", "text/javascript; charset=utf-8"]],
  ["/app/vendor/maplibre-gl/maplibre-gl.js", ["vendor/maplibre-gl/maplibre-gl.js", "text/javascript; charset=utf-8"]],
  ["/app/vendor/maplibre-gl/maplibre-gl.css", ["vendor/maplibre-gl/maplibre-gl.css", "text/css; charset=utf-8"]],
  ["/app/vendor/maplibre-gl/version.txt", ["vendor/maplibre-gl/version.txt", "text/plain; charset=utf-8"]]
]);

http.createServer = function pwaCreateServer(...args) {
  const options = typeof args[0] === "function" ? null : args[0];
  const listener = typeof args[0] === "function" ? args[0] : args[1];
  const wrapped = (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET") {
      if (url.pathname === "/app/manifest.webmanifest") return serveFile(res, "manifest.webmanifest", "application/manifest+json; charset=utf-8", "no-cache");
      const asset = APP_ASSETS.get(url.pathname);
      if (asset) return serveFile(res, asset[0], asset[1], "no-cache");
      if (url.pathname === "/app/airlines.js") return servePath(res, AIRLINES_FILE, "text/javascript; charset=utf-8", "no-cache");
      if (url.pathname === "/app/icon.svg") return serveFile(res, "icon.svg", "image/svg+xml; charset=utf-8", "public, max-age=86400");
      if (url.pathname === "/app/apple-touch-icon.png") return serveBase64(res, "apple-touch-icon.png.b64", "image/png", "public, max-age=86400");
      if (url.pathname === "/app/sw.js") {
        res.setHeader("Service-Worker-Allowed", "/app/");
        return serveFile(res, "sw.js", "text/javascript; charset=utf-8", "no-cache");
      }
    }
    return listener(req, res);
  };
  return options == null ? previousCreateServer(wrapped) : previousCreateServer(options, wrapped);
};
