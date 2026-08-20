import { config } from "../lib/config.js";
export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    service: "SkyTrace",
    version: "3.3.1-performance-rc",
    time: new Date().toISOString(),
    integrations: {
      adsbLol: true,
      adsbLolStaleCache: config.providers.liveStaleCache,
      mictronicsAircraft: config.providers.aircraftEnrichment,
      vrsStandingRoutes: config.providers.routes,
      aviationWeather: config.providers.aviationWeather,
      ourAirports: true,
      metNorway: config.providers.generalWeather,
      nasaGibsPrecipitation: config.providers.precipitation,
      openFreeMap: true
    }
  });
}
