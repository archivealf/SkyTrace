import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");

let AIRPORTS = null;
let RUNWAYS = null;
let FREQUENCIES = null;
let NAVAIDS = null;
let AIRPORT_INDEX = null;

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
}

function loadAirports() {
  if (!AIRPORTS) {
    AIRPORTS = readJson("airports.json");
    AIRPORT_INDEX = new Map();
    for (const airport of AIRPORTS) {
      for (const key of [airport.ident, airport.icao, airport.iata, airport.gps, airport.local]) {
        if (key) AIRPORT_INDEX.set(String(key).toUpperCase(), airport);
      }
    }
  }
  return AIRPORTS;
}

function loadRunways() {
  if (!RUNWAYS) RUNWAYS = readJson("runways.json");
  return RUNWAYS;
}

function loadFrequencies() {
  if (!FREQUENCIES) FREQUENCIES = readJson("frequencies.json");
  return FREQUENCIES;
}

function loadNavaids() {
  if (!NAVAIDS) NAVAIDS = readJson("navaids.json");
  return NAVAIDS;
}

function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sanitizeBounds(input = {}) {
  let south = n(input.lamin, -90);
  let west = n(input.lomin, -180);
  let north = n(input.lamax, 90);
  let east = n(input.lomax, 180);

  south = Math.max(-90, Math.min(90, south));
  north = Math.max(-90, Math.min(90, north));
  west = Math.max(-180, Math.min(180, west));
  east = Math.max(-180, Math.min(180, east));
  if (south > north) [south, north] = [north, south];

  return { south, west, north, east, crossesDateline: west > east };
}

function inBounds(lat, lon, bounds) {
  if (lat < bounds.south || lat > bounds.north) return false;
  if (!bounds.crossesDateline) return lon >= bounds.west && lon <= bounds.east;
  return lon >= bounds.west || lon <= bounds.east;
}

function importance(airport) {
  const typeScore = {
    large_airport: 6,
    medium_airport: 5,
    seaplane_base: 3,
    small_airport: 2,
    heliport: 1,
    balloonport: 0
  }[airport.type] ?? 0;
  return typeScore * 10 + (airport.scheduled ? 8 : 0) + (airport.iata ? 3 : 0);
}

export function listAirports({ bounds, zoom = 5, limit = 900 } = {}) {
  const airports = loadAirports();
  const box = sanitizeBounds(bounds);
  const z = n(zoom, 5);
  let minScore = 0;
  if (z < 3.2) minScore = 58;
  else if (z < 4.5) minScore = 50;
  else if (z < 6.5) minScore = 28;
  else if (z < 8) minScore = 18;

  const result = [];
  for (const airport of airports) {
    if (importance(airport) < minScore) continue;
    if (!inBounds(airport.lat, airport.lon, box)) continue;
    result.push(airport);
  }

  result.sort((a, b) => importance(b) - importance(a));
  return result.slice(0, Math.max(50, Math.min(2500, n(limit, 900))));
}

export function searchAirports(query, limit = 30) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const airports = loadAirports();
  const scored = [];

  for (const airport of airports) {
    const ident = String(airport.ident || "").toLowerCase();
    const iata = String(airport.iata || "").toLowerCase();
    const icao = String(airport.icao || "").toLowerCase();
    const name = String(airport.name || "").toLowerCase();
    const city = String(airport.city || "").toLowerCase();
    let score = 0;
    if (iata === q || icao === q || ident === q) score = 100;
    else if (iata.startsWith(q) || icao.startsWith(q) || ident.startsWith(q)) score = 80;
    else if (name.startsWith(q) || city.startsWith(q)) score = 60;
    else if (name.includes(q) || city.includes(q)) score = 35;
    if (!score) continue;
    score += importance(airport);
    scored.push([score, airport]);
  }

  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, Math.max(1, Math.min(100, n(limit, 30)))).map((x) => x[1]);
}

export function getAirport(code) {
  loadAirports();
  const airport = AIRPORT_INDEX.get(String(code || "").trim().toUpperCase());
  if (!airport) return null;
  const runways = loadRunways()[airport.ident] || [];
  const frequencies = loadFrequencies()[airport.ident] || [];
  return { ...airport, runways, frequencies };
}

export function listNavaids({ bounds, limit = 1200 } = {}) {
  const navs = loadNavaids();
  const box = sanitizeBounds(bounds);
  const result = [];
  for (const nav of navs) {
    if (!inBounds(nav.lat, nav.lon, box)) continue;
    result.push(nav);
    if (result.length >= Math.max(1, Math.min(3000, n(limit, 1200)))) break;
  }
  return result;
}
