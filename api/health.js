import { isOpenSkyAuthenticated } from "../lib/opensky.js";
import { isAircraftEnrichmentConfigured } from "../lib/aircraft.js";
export default function handler(_req, res) {
  res.status(200).json({ ok: true, service: "SkyTrace", version: "2.3.0", time: new Date().toISOString(), integrations: { openSkyOAuth: isOpenSkyAuthenticated(), skyLink: isAircraftEnrichmentConfigured(), ourAirports: true, openMeteo: true } });
}
