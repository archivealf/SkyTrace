import { config } from "../lib/config.js";
export default function handler(_req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60");
  res.status(200).json({
    ok: true,
    version: "3.3.1-performance-rc",
    features: {
      noKeyDefault: true,
      liveProvider: "adsblol",
      liveStaleCache: config.providers.liveStaleCache,
      aircraftMetadata: config.providers.aircraftEnrichment,
      routes: config.providers.routes,
      aviationWeather: config.providers.aviationWeather,
      airports: true,
      weather: config.providers.generalWeather,
      precipitation: config.providers.precipitation,
      radar: false,
      pwa: true
    }
  });
}
