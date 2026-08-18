import { isOpenSkyAuthenticated } from "../lib/opensky.js";
import { isAircraftEnrichmentConfigured } from "../lib/aircraft.js";
export default function handler(_req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60");
  res.status(200).json({ ok: true, version: "2.3.0", features: { openSkyOAuth: isOpenSkyAuthenticated(), aircraftMetadata: isAircraftEnrichmentConfigured(), airports: true, weather: true, pwa: true } });
}
