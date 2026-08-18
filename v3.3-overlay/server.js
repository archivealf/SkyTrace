import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getFreeFlightSnapshot } from "./lib/live.js";
import { getAirport, listAirports, listNavaids, searchAirports } from "./lib/airports.js";
import { getAircraftMetadata, getFlightRoute } from "./lib/aircraft.js";
import { getWeather } from "./lib/weather.js";
import { getAirportAviationWeather, getAirportAdvisories, getRecentPilotReports } from "./lib/aviationweather.js";
import { isOpenSkyAuthenticated } from "./lib/opensky.js";
import { config } from "./lib/config.js";
import { getAccountServiceConfig, getAccountCatalog, registerAccount, loginAccount, getAccount, logoutAccount, createAccountCheckout, confirmAccountCheckout } from "./lib/account.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

const ipTimes = new Map();

function headers(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function rateLimited(req) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const last = ipTimes.get(ip) || 0;
  ipTimes.set(ip, now);
  return now - last < 1200;
}

async function readJsonBody(req, maxBytes = 32768) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Request body is too large.");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch {
        const error = new Error("Invalid JSON request.");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function qBounds(p) {
  return {
    lamin: p.get("lamin"),
    lomin: p.get("lomin"),
    lamax: p.get("lamax"),
    lomax: p.get("lomax")
  };
}

async function api(req, res, url) {
  const p = url.searchParams;
  try {
    if (url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        service: "SkyTrace",
        version: "3.3.0-commerce-glass",
        time: new Date().toISOString(),
        integrations: {
          adsbLol: config.providers.live === "adsblol",
          openSkyFallback: config.providers.openSkyFallback,
          openSkyOAuth: isOpenSkyAuthenticated(),
          adsbdb: config.providers.adsbdb,
          aviationWeather: config.providers.aviationWeather,
          ourAirports: true,
          openMeteo: config.providers.openMeteo,
          rainViewer: config.providers.rainViewer,
          openFreeMap: true
        }
      });
    }

    if (url.pathname === "/api/account/config") {
      return json(res, 200, getAccountServiceConfig());
    }

    if (url.pathname === "/api/account/catalog") {
      return json(res, 200, await getAccountCatalog());
    }

    if (url.pathname === "/api/account/me") {
      return json(res, 200, await getAccount());
    }

    if (url.pathname === "/api/account/register" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, 201, await registerAccount(body));
    }

    if (url.pathname === "/api/account/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, 200, await loginAccount(body));
    }

    if (url.pathname === "/api/account/logout" && req.method === "POST") {
      return json(res, 200, await logoutAccount());
    }

    if (url.pathname === "/api/account/checkout" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, 200, await createAccountCheckout(body.productKey));
    }

    if (url.pathname === "/api/account/checkout-confirm" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, 200, await confirmAccountCheckout(body.sessionId));
    }

    if (url.pathname === "/api/config") {
      return json(res, 200, {
        ok: true,
        version: "3.3.0-commerce-glass",
        features: {
          noKeyDefault: true,
          liveProvider: config.providers.live,
          openSkyFallback: config.providers.openSkyFallback,
          aircraftMetadata: config.providers.adsbdb,
          routes: config.providers.adsbdb,
          aviationWeather: config.providers.aviationWeather,
          airports: true,
          weather: config.providers.openMeteo,
          radar: config.providers.rainViewer,
          desktop: Boolean(globalThis.__SKYTRACE_DESKTOP__),
          accounts: Boolean(config.commerce?.enabled),
          store: Boolean(config.commerce?.enabled)
        }
      });
    }

    if (url.pathname === "/api/flights") {
      if (rateLimited(req)) {
        return json(res, 429, { ok: false, error: "Refreshing too quickly. Wait a moment." });
      }
      return json(
        res,
        200,
        await getFreeFlightSnapshot({
          bounds: p.has("lamin") ? qBounds(p) : null,
          icao24: p.get("icao"),
          callsign: p.get("callsign")
        })
      );
    }

    if (url.pathname === "/api/airports") {
      if (p.get("code")) {
        const airport = getAirport(p.get("code"));
        return airport
          ? json(res, 200, { ok: true, source: "OurAirports", airport })
          : json(res, 404, { ok: false, error: "Airport not found" });
      }
      if (p.get("q")) {
        return json(res, 200, {
          ok: true,
          source: "OurAirports",
          airports: searchAirports(p.get("q"), p.get("limit"))
        });
      }
      return json(res, 200, {
        ok: true,
        source: "OurAirports",
        airports: listAirports({
          bounds: qBounds(p),
          zoom: p.get("zoom"),
          limit: p.get("limit")
        })
      });
    }

    if (url.pathname === "/api/navaids") {
      return json(res, 200, {
        ok: true,
        source: "OurAirports",
        navaids: listNavaids({ bounds: qBounds(p), limit: p.get("limit") })
      });
    }

    if (url.pathname === "/api/aircraft") {
      return json(
        res,
        200,
        await getAircraftMetadata(p.get("icao"), p.get("callsign") || "")
      );
    }

    if (url.pathname === "/api/route") {
      return json(res, 200, await getFlightRoute(p.get("callsign")));
    }

    if (url.pathname === "/api/weather") {
      return json(res, 200, await getWeather(p.get("lat"), p.get("lon")));
    }

    if (url.pathname === "/api/aviation-weather") {
      return json(res, 200, await getAirportAviationWeather(p.get("icao")));
    }

    if (url.pathname === "/api/advisories") {
      return json(res, 200, await getAirportAdvisories(p.get("icao")));
    }

    if (url.pathname === "/api/pireps") {
      return json(res, 200, await getRecentPilotReports({ hours: p.get("hours") }));
    }

    return false;
  } catch (error) {
    return json(
      res,
      error.status >= 400 && error.status < 500 ? error.status : 502,
      {
        ok: false,
        error: error.message || "Upstream service unavailable",
        retryAfter: error.retryAfter || null
      }
    );
  }
}

function staticFile(res, pathname) {
  if (
    pathname === "/config.json" ||
    pathname === "/config.example.json" ||
    pathname.startsWith("/lib/config")
  ) {
    res.statusCode = 404;
    return res.end("Not found");
  }

  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel).replace(/\.\./g, "");
  const fp = path.join(__dirname, rel);

  if (!fp.startsWith(__dirname)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }

  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      const fallback = path.join(__dirname, "index.html");
      return fs.readFile(fallback, (e, b) => {
        if (e) {
          res.statusCode = 404;
          return res.end("Not found");
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(b);
      });
    }

    const ext = path.extname(fp).toLowerCase();
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    const base = path.basename(fp);

    if (
      ext === ".html" ||
      ext === ".css" ||
      ext === ".js" ||
      ext === ".webmanifest" ||
      base.startsWith("service-worker")
    ) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else {
      res.setHeader("Cache-Control", "public,max-age=3600");
    }

    fs.createReadStream(fp).pipe(res);
  });
}

export function createSkyTraceServer() {
  return http.createServer(async (req, res) => {
    headers(res);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await api(req, res, url);
      if (handled !== false) return;
    }

    staticFile(res, url.pathname);
  });
}

export async function startSkyTraceServer({
  port = config.server.port,
  host = "127.0.0.1",
  quiet = false
} = {}) {
  const server = createSkyTraceServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  server.removeAllListeners("error");
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  if (!quiet) {
    console.log(`SkyTrace V3.3 running at http://${host}:${actualPort}`);
    console.log("Live aircraft: ADSB.lol with free OpenSky fallback");
    console.log("Aircraft/routes: ADSBDB");
    console.log("Aviation weather: AviationWeather.gov");
    console.log("Maps: OpenFreeMap + MapLibre");
  }

  return {
    server,
    port: actualPort,
    host,
    url: `http://${host}:${actualPort}`
  };
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  startSkyTraceServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
