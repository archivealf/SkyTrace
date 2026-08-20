import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "data");

const SOURCES = {
  airports: "https://ourairports.com/data/airports.csv",
  runways: "https://ourairports.com/data/runways.csv",
  frequencies: "https://ourairports.com/data/airport-frequencies.csv",
  navaids: "https://ourairports.com/data/navaids.csv",
  aircraft: "https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz"
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }

  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() || [];
  return rows
    .filter((values) => values.some((v) => v !== ""))
    .map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
}

function num(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === "1" || String(value).toLowerCase() === "yes" || String(value).toLowerCase() === "true";
}

async function getCsv(url) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { headers: { "User-Agent": "SkyTrace-data-builder/3.3" } });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return parseCsv(await response.text());
}

async function getBinary(url) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { headers: { "User-Agent": "SkyTrace-data-builder/3.3" } });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const [airportRows, runwayRows, frequencyRows, navaidRows, aircraftDb] = await Promise.all([
    getCsv(SOURCES.airports),
    getCsv(SOURCES.runways),
    getCsv(SOURCES.frequencies),
    getCsv(SOURCES.navaids),
    getBinary(SOURCES.aircraft)
  ]);

  if (aircraftDb.length < 100_000 || aircraftDb[0] !== 0x1f || aircraftDb[1] !== 0x8b) {
    throw new Error("Downloaded aircraft database is not a valid-looking gzip payload.");
  }

  const airports = airportRows.map((r) => ({
    id: num(r.id), ident: r.ident || "", type: r.type || "", name: r.name || "",
    lat: num(r.latitude_deg, 0), lon: num(r.longitude_deg, 0), elev: num(r.elevation_ft),
    country: r.iso_country || "", region: r.iso_region || "", city: r.municipality || "",
    scheduled: String(r.scheduled_service || "").toLowerCase() === "yes",
    icao: r.icao_code || "", iata: r.iata_code || "", gps: r.gps_code || "", local: r.local_code || "",
    home: r.home_link || "", wiki: r.wikipedia_link || ""
  }));

  const runways = {};
  for (const r of runwayRows) {
    const ident = r.airport_ident || "";
    if (!ident) continue;
    (runways[ident] ||= []).push({
      len: num(r.length_ft), wid: num(r.width_ft), surface: r.surface || "",
      lighted: bool(r.lighted), closed: bool(r.closed), le: r.le_ident || "", he: r.he_ident || "",
      leh: num(r.le_heading_degT), heh: num(r.he_heading_degT)
    });
  }

  const frequencies = {};
  for (const r of frequencyRows) {
    const ident = r.airport_ident || "";
    if (!ident) continue;
    (frequencies[ident] ||= []).push({ type: r.type || "", desc: r.description || "", mhz: num(r.frequency_mhz) });
  }

  const navaids = navaidRows.map((r) => ({
    ident: r.ident || "", name: r.name || "", type: r.type || "", khz: num(r.frequency_khz),
    lat: num(r.latitude_deg, 0), lon: num(r.longitude_deg, 0), country: r.iso_country || "", airport: r.associated_airport || ""
  }));

  fs.writeFileSync(path.join(outDir, "airports.json"), JSON.stringify(airports));
  fs.writeFileSync(path.join(outDir, "runways.json"), JSON.stringify(runways));
  fs.writeFileSync(path.join(outDir, "frequencies.json"), JSON.stringify(frequencies));
  fs.writeFileSync(path.join(outDir, "navaids.json"), JSON.stringify(navaids));
  fs.writeFileSync(path.join(outDir, "aircraft.csv.gz"), aircraftDb);

  console.log(`Airports: ${airports.length.toLocaleString()}`);
  console.log(`Runway airports: ${Object.keys(runways).length.toLocaleString()}`);
  console.log(`Frequency airports: ${Object.keys(frequencies).length.toLocaleString()}`);
  console.log(`Navaids: ${navaids.length.toLocaleString()}`);
  console.log(`Mictronics/tar1090 aircraft database: ${(aircraftDb.length / 1024 / 1024).toFixed(1)} MiB`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
