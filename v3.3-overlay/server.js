import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getFreeFlightSnapshot } from "./lib/live.js";
import { getAirport, listAirports, listNavaids, searchAirports } from "./lib/airports.js";
import { getAircraftMetadata, getFlightRoute } from "./lib/aircraft.js";
import { getWeather } from "./lib/weather.js";
import { getPrecipitationInfo, getPrecipitationTile } from "./lib/precipitation.js";
import { getAirportAviationWeather, getAirportAdvisories, getRecentPilotReports } from "./lib/aviationweather.js";
import { config } from "./lib/config.js";
import {
  getAccountServiceConfig, getAccountCatalog, registerAccount, loginAccount, getAccount, logoutAccount,
  createAccountCheckout, confirmAccountCheckout, redeemAccountCode, getCloudBundle, upsertCloudItem,
  deleteCloudItem, ingestAccountHistory, getAccountHistory, getAccountHistoryExport
} from "./lib/account.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json; charset=utf-8",
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
  const t = Date.now();
  const last = ipTimes.get(ip) || 0;
  ipTimes.set(ip, t);
  return t - last < 1200;
}
async function readJsonBody(req, maxBytes = 32768) {
  return await new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) { const e = new Error("Request body is too large."); e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { const e = new Error("Invalid JSON request."); e.status = 400; reject(e); }
    });
    req.on("error", reject);
  });
}
function qBounds(p) { return { lamin: p.get("lamin"), lomin: p.get("lomin"), lamax: p.get("lamax"), lomax: p.get("lomax") }; }
function toRad(d) { return d * Math.PI / 180; }
function distanceNm(aLat, aLon, bLat, bLon) {
  const R = 3440.065;
  const p1 = toRad(aLat), p2 = toRad(bLat), dp = toRad(bLat - aLat), dl = toRad(bLon - aLon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function runwaySummary(runways = []) {
  return runways.filter(r => !r.closed).sort((a, b) => (b.len || 0) - (a.len || 0)).slice(0, 6).map(r => ({
    ident: [r.le, r.he].filter(Boolean).join("/"), lengthFt: r.len, widthFt: r.wid, surface: r.surface, lighted: Boolean(r.lighted)
  }));
}
async function airportIntelligence(code) {
  const airport = getAirport(code);
  if (!airport) throw Object.assign(new Error("Airport not found."), { status: 404 });
  const lat = Number(airport.lat), lon = Number(airport.lon);
  const latSpan = 1.1, lonSpan = Math.max(1.1, 1.1 / Math.max(0.3, Math.cos(toRad(lat))));
  const [snapshot, aviation] = await Promise.all([
    getFreeFlightSnapshot({ bounds: { lamin: lat - latSpan, lomin: lon - lonSpan, lamax: lat + latSpan, lomax: lon + lonSpan } }),
    getAirportAviationWeather(airport.icao || airport.ident).catch(() => null)
  ]);
  const nearby = (snapshot.flights || []).map(f => ({ ...f, distanceNm: distanceNm(lat, lon, f.latitude, f.longitude) })).filter(f => f.distanceNm <= 75);
  const onGround = nearby.filter(f => f.onGround || (Number(f.altitudeFt) <= 250 && f.distanceNm <= 4));
  const inbound = nearby.filter(f => !f.onGround && f.distanceNm <= 55 && Number(f.verticalRateFpm) < -100);
  const outbound = nearby.filter(f => !f.onGround && f.distanceNm <= 45 && Number(f.verticalRateFpm) > 100);
  const airborne = nearby.filter(f => !f.onGround);
  const typeCounts = new Map();
  for (const f of nearby) {
    const type = String(f.aircraftType || "Unknown").trim() || "Unknown";
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }
  const busiestTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count }));
  const movements = [...inbound.map(f => ({ ...f, movement: "arrival estimate" })), ...outbound.map(f => ({ ...f, movement: "departure estimate" }))]
    .sort((a, b) => a.distanceNm - b.distanceNm).slice(0, 30)
    .map(f => ({ icao24: f.icao24, callsign: f.callsign, registration: f.registration, aircraftType: f.aircraftType, movement: f.movement,
      distanceNm: Math.round(f.distanceNm * 10) / 10, altitudeFt: f.altitudeFt, speedKts: f.speedKts, heading: f.heading }));
  const headingDiff = (a, b) => Math.abs((((Number(a) || 0) - (Number(b) || 0) + 540) % 360) - 180);
  const runwayEnds = (airport.runways || []).filter(r => !r.closed).flatMap(r => [
    r.le && Number.isFinite(Number(r.leh)) ? { ident: r.le, heading: Number(r.leh) } : null,
    r.he && Number.isFinite(Number(r.heh)) ? { ident: r.he, heading: Number(r.heh) } : null
  ].filter(Boolean));
  const runwayCounts = new Map();
  for (const f of nearby.filter(x => x.distanceNm <= 10 && !x.onGround && Number.isFinite(Number(x.heading)))) {
    const best = runwayEnds.slice().sort((a, b) => headingDiff(f.heading, a.heading) - headingDiff(f.heading, b.heading))[0];
    if (best && headingDiff(f.heading, best.heading) <= 45) runwayCounts.set(best.ident, (runwayCounts.get(best.ident) || 0) + 1);
  }
  const runwayUseEstimate = [...runwayCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([runway, count]) => ({ runway, count }));
  const trafficProfile = [
    { label: "0-5nm", count: nearby.filter(f => f.distanceNm <= 5).length },
    { label: "5-15nm", count: nearby.filter(f => f.distanceNm > 5 && f.distanceNm <= 15).length },
    { label: "15-30nm", count: nearby.filter(f => f.distanceNm > 15 && f.distanceNm <= 30).length },
    { label: "30-75nm", count: nearby.filter(f => f.distanceNm > 30 && f.distanceNm <= 75).length }
  ];
  return {
    ok: true, source: snapshot.source, generatedAt: Date.now(),
    airport: { ident: airport.ident, icao: airport.icao, iata: airport.iata, name: airport.name, city: airport.city, country: airport.country,
      lat, lon, elevationFt: airport.elev, type: airport.type, runways: runwaySummary(airport.runways), frequencies: airport.frequencies || [] },
    operations: { nearby: nearby.length, airborne: airborne.length, onGround: onGround.length, inboundEstimate: inbound.length, outboundEstimate: outbound.length,
      busiestTypes, movements, runwayUseEstimate, trafficProfile },
    weather: aviation,
    methodology: "Traffic figures are live ADS-B observations. Arrival/departure and runway-use labels are estimates from proximity, vertical rate and heading. SkyTrace does not claim schedule-delay data without a licensed schedule source."
  };
}

async function api(req, res, url) {
  const p = url.searchParams;
  try {
    const precipitationTile = url.pathname.match(/^\/api\/precipitation-tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (precipitationTile) {
      if (!config.providers.precipitation) { res.statusCode = 404; return res.end("Not found"); }
      const tile = await getPrecipitationTile(precipitationTile[1], precipitationTile[2], precipitationTile[3]);
      res.statusCode = 200; res.setHeader("Content-Type", tile.contentType || "image/png");
      res.setHeader("Cache-Control", "public,max-age=600"); res.setHeader("X-SkyTrace-Tile-Cache", tile.cache || "MISS");
      return res.end(tile.body);
    }

    if (url.pathname === "/api/health") return json(res, 200, {
      ok: true, service: "SkyTrace", version: "3.3.0-commerce-glass", time: new Date().toISOString(),
      integrations: { adsbLol: true, adsbLolStaleCache: config.providers.liveStaleCache, mictronicsAircraft: config.providers.aircraftEnrichment,
        vrsStandingRoutes: config.providers.routes, aviationWeather: config.providers.aviationWeather, ourAirports: true,
        metNorway: config.providers.generalWeather, nasaGibsPrecipitation: config.providers.precipitation, openFreeMap: true,
        accountCloudSync: true, cloudReplay: true, airportIntelligence: true }
    });

    if (url.pathname === "/api/account/config") return json(res, 200, getAccountServiceConfig());
    if (url.pathname === "/api/account/catalog") return json(res, 200, await getAccountCatalog());
    if (url.pathname === "/api/account/me") return json(res, 200, await getAccount());
    if (url.pathname === "/api/account/register" && req.method === "POST") return json(res, 201, await registerAccount(await readJsonBody(req)));
    if (url.pathname === "/api/account/login" && req.method === "POST") return json(res, 200, await loginAccount(await readJsonBody(req)));
    if (url.pathname === "/api/account/logout" && req.method === "POST") return json(res, 200, await logoutAccount());
    if (url.pathname === "/api/account/checkout" && req.method === "POST") { const body = await readJsonBody(req); return json(res, 200, await createAccountCheckout(body.productKey)); }
    if (url.pathname === "/api/account/checkout-confirm" && req.method === "POST") { const body = await readJsonBody(req); return json(res, 200, await confirmAccountCheckout(body.sessionId)); }
    if (url.pathname === "/api/account/redeem" && req.method === "POST") { const body = await readJsonBody(req); return json(res, 200, await redeemAccountCode(body.code)); }
    if (url.pathname === "/api/account/cloud" && req.method === "GET") return json(res, 200, await getCloudBundle());
    if (url.pathname === "/api/account/cloud/upsert" && req.method === "POST") return json(res, 200, await upsertCloudItem(await readJsonBody(req)));
    if (url.pathname === "/api/account/cloud/delete" && req.method === "POST") return json(res, 200, await deleteCloudItem(await readJsonBody(req)));
    if (url.pathname === "/api/account/history" && req.method === "GET") return json(res, 200, await getAccountHistory(url.search));
    if (url.pathname === "/api/account/history-export" && req.method === "GET") {
      const requested = String(p.get("format") || "csv").toLowerCase();
      const format = ["csv", "geojson", "kml"].includes(requested) ? requested : "csv";
      const exported = await getAccountHistoryExport(url.search, format);
      res.statusCode = 200; res.setHeader("Content-Type", exported.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="skytrace-history.${format}"`);
      return res.end(Buffer.from(exported.body, "base64"));
    }

    if (url.pathname === "/api/config") return json(res, 200, {
      ok: true, version: "3.3.0-commerce-glass", features: {
        noKeyDefault: true, liveProvider: "adsblol", liveStaleCache: config.providers.liveStaleCache,
        aircraftMetadata: config.providers.aircraftEnrichment, routes: config.providers.routes, aviationWeather: config.providers.aviationWeather,
        airports: true, airportIntelligence: true, weather: config.providers.generalWeather, precipitation: config.providers.precipitation, radar: false,
        desktop: Boolean(globalThis.__SKYTRACE_DESKTOP__), accounts: Boolean(config.commerce?.enabled), store: Boolean(config.commerce?.enabled),
        cloudSync: Boolean(config.commerce?.enabled), cloudReplay: Boolean(config.commerce?.enabled)
      }
    });

    if (url.pathname === "/api/flights") {
      if (rateLimited(req)) return json(res, 429, { ok: false, error: "Refreshing too quickly. Wait a moment." });
      const snapshot = await getFreeFlightSnapshot({ bounds: p.has("lamin") ? qBounds(p) : null, icao24: p.get("icao"), callsign: p.get("callsign") });
      void ingestAccountHistory({ flights: snapshot.flights, recordedAt: snapshot.fetchedAt || Date.now() }).catch(() => {});
      return json(res, 200, snapshot);
    }

    if (url.pathname === "/api/airports") {
      if (p.get("code")) { const airport = getAirport(p.get("code")); return airport ? json(res, 200, { ok: true, source: "OurAirports", airport }) : json(res, 404, { ok: false, error: "Airport not found" }); }
      if (p.get("q")) return json(res, 200, { ok: true, source: "OurAirports", airports: searchAirports(p.get("q"), p.get("limit")) });
      return json(res, 200, { ok: true, source: "OurAirports", airports: listAirports({ bounds: qBounds(p), zoom: p.get("zoom"), limit: p.get("limit") }) });
    }
    if (url.pathname === "/api/airport-intelligence") {
      const account = await getAccount();
      const entitlements = account?.effectiveEntitlements || [];
      if (!account?.authenticated || (!entitlements.includes("airport_intelligence") && !entitlements.includes("pro"))) {
        return json(res, 403, { ok: false, error: "Airport Intelligence requires Airport Intelligence or SkyTrace Pro." });
      }
      return json(res, 200, await airportIntelligence(p.get("icao") || p.get("code")));
    }
    if (url.pathname === "/api/navaids") return json(res, 200, { ok: true, source: "OurAirports", navaids: listNavaids({ bounds: qBounds(p), limit: p.get("limit") }) });
    if (url.pathname === "/api/aircraft") {
      if (!config.providers.aircraftEnrichment) return json(res, 404, { ok: false, error: "Aircraft enrichment is disabled in config." });
      return json(res, 200, await getAircraftMetadata(p.get("icao"), p.get("callsign") || ""));
    }
    if (url.pathname === "/api/route") {
      if (!config.providers.routes) return json(res, 404, { ok: false, error: "Route enrichment is disabled in config." });
      return json(res, 200, await getFlightRoute(p.get("callsign")));
    }
    if (url.pathname === "/api/weather") {
      if (!config.providers.generalWeather) return json(res, 404, { ok: false, error: "General weather is disabled in config." });
      return json(res, 200, await getWeather(p.get("lat"), p.get("lon")));
    }
    if (url.pathname === "/api/precipitation") {
      if (!config.providers.precipitation) return json(res, 404, { ok: false, error: "Precipitation is disabled in config." });
      return json(res, 200, getPrecipitationInfo());
    }
    if (url.pathname === "/api/aviation-weather") return json(res, 200, await getAirportAviationWeather(p.get("icao")));
    if (url.pathname === "/api/advisories") return json(res, 200, await getAirportAdvisories(p.get("icao")));
    if (url.pathname === "/api/pireps") return json(res, 200, await getRecentPilotReports({ hours: p.get("hours") }));
    return false;
  } catch (error) {
    return json(res, error.status >= 400 && error.status < 500 ? error.status : 502, { ok: false, error: error.message || "Upstream service unavailable", retryAfter: error.retryAfter || null });
  }
}

function staticFile(res, pathname) {
  if (pathname === "/config.json" || pathname === "/config.example.json" || pathname.startsWith("/lib/config")) { res.statusCode = 404; return res.end("Not found"); }
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel).replace(/\.\./g, "");
  const fp = path.join(__dirname, rel);
  if (!fp.startsWith(__dirname)) { res.statusCode = 403; return res.end("Forbidden"); }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      const fallback = path.join(__dirname, "index.html");
      return fs.readFile(fallback, (e, b) => { if (e) { res.statusCode = 404; return res.end("Not found"); } res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(b); });
    }
    const ext = path.extname(fp).toLowerCase(); res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    const base = path.basename(fp);
    if (ext === ".html" || ext === ".css" || ext === ".js" || ext === ".webmanifest" || base.startsWith("service-worker")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
    } else res.setHeader("Cache-Control", "public,max-age=3600");
    fs.createReadStream(fp).pipe(res);
  });
}

export function createSkyTraceServer() {
  return http.createServer(async (req, res) => {
    headers(res);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) { const handled = await api(req, res, url); if (handled !== false) return; }
    staticFile(res, url.pathname);
  });
}
export async function startSkyTraceServer({ port = config.server.port, host = "127.0.0.1", quiet = false } = {}) {
  const server = createSkyTraceServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  server.removeAllListeners("error");
  const address = server.address(); const actualPort = typeof address === "object" && address ? address.port : port;
  if (!quiet) {
    console.log(`SkyTrace V3.3 running at http://${host}:${actualPort}`);
    console.log("Live aircraft: ADSB.lol + five-minute stale cache");
    console.log("Aircraft metadata: Mictronics database + ADSB.lol");
    console.log("Routes: VRS Standing Data via ADSB.lol");
    console.log("General weather: MET Norway Locationforecast");
    console.log("Precipitation: NASA GPM IMERG via GIBS");
    console.log("Cloud: synced watchlists/alerts/bookmarks/workspaces + Replay+ history");
    console.log("Airport Intelligence: live ADS-B operations + AviationWeather.gov");
  }
  return { server, port: actualPort, host, url: `http://${host}:${actualPort}` };
}
const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) startSkyTraceServer().catch(error => { console.error(error); process.exitCode = 1; });
