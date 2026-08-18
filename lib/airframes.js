import { config, hasAirframesKey } from "./config.js";

const BASE_URL = "https://api.airframes.io/v1";
const cache = new Map();

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function redact(text) {
  if (!config.airframes.redactSensitive) return text;

  return cleanText(text)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\b(?:\+?\d[\s().-]*){9,15}\b/g, "[phone redacted]");
}

function first(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === "number") {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function normalizeMessage(item, index = 0) {
  const rawText = first(item, [
    "text", "message", "body", "decoded", "decoded_text",
    "decodedText", "payload", "content", "raw"
  ]);

  const airframe = item?.airframe || item?.aircraft || {};
  const flightObj = item?.flight || {};

  return {
    id: String(first(item, ["id", "uuid", "_id"]) || `msg-${index}`),
    timestamp: normalizeTimestamp(first(item, [
      "timestamp", "created_at", "createdAt", "time", "received_at", "receivedAt"
    ])),
    protocol: cleanText(first(item, ["protocol", "source", "mode", "datalink", "channel"]) || "ACARS"),
    label: cleanText(first(item, ["label", "message_type", "messageType", "type"]) || ""),
    flight: cleanText(
      typeof flightObj === "string"
        ? flightObj
        : first(flightObj, ["callsign", "flight", "ident", "number"]) ||
          first(item, ["flight", "callsign", "flight_id", "flightId"])
    ),
    registration: cleanText(
      first(airframe, ["registration", "tail", "tail_number", "tailNumber"]) ||
      first(item, ["registration", "tail", "tail_number", "tailNumber"])
    ),
    icao24: cleanText(
      first(airframe, ["icao24", "hex", "icao"]) ||
      first(item, ["icao24", "hex", "icao"])
    ).toLowerCase(),
    station: cleanText(
      typeof item?.station === "string"
        ? item.station
        : first(item?.station, ["ident", "name", "id"]) ||
          first(item, ["station_ident", "stationIdent"])
    ),
    text: redact(rawText || "")
  };
}

function unpackMessages(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["messages", "data", "results", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (payload?.data && Array.isArray(payload.data?.messages)) return payload.data.messages;
  return [];
}

export function isAirframesConfigured() {
  return hasAirframesKey();
}

export async function getAcarsMessages({ flight, limit = 40 } = {}) {
  if (!config.airframes.enabled) {
    return {
      ok: true,
      configured: false,
      enabled: false,
      source: "Airframes.io",
      messages: []
    };
  }

  if (!hasAirframesKey()) {
    return {
      ok: true,
      configured: false,
      enabled: true,
      source: "Airframes.io",
      messages: []
    };
  }

  const callsign = cleanText(flight).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
  if (!callsign) {
    const error = new Error("A flight callsign is required for message lookup.");
    error.status = 400;
    throw error;
  }

  const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 40));
  const cacheKey = `${callsign}:${cappedLimit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < 12_000) {
    return { ...cached.payload, cache: "HIT" };
  }

  const url = new URL(`${BASE_URL}/messages`);
  url.searchParams.set("flight", callsign);
  url.searchParams.set("limit", String(cappedLimit));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.airframes.apiKey}`,
      "User-Agent": "SkyTrace/3.0"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      response.status === 401 || response.status === 403
        ? "Airframes rejected the API key."
        : response.status === 429
          ? "Airframes rate limit reached."
          : `Airframes request failed (${response.status}).`
    );
    error.status = response.status;
    error.detail = body.slice(0, 300);
    throw error;
  }

  const raw = await response.json();
  const messages = unpackMessages(raw)
    .map(normalizeMessage)
    .filter(message => message.text || message.label)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const payload = {
    ok: true,
    configured: true,
    enabled: true,
    source: "Airframes.io",
    callsign,
    messages,
    rateRemaining:
      response.headers.get("x-ratelimit-remaining") ||
      response.headers.get("x-rate-limit-remaining") ||
      null
  };

  cache.set(cacheKey, { time: Date.now(), payload });
  if (cache.size > 250) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].time - b[1].time)
      .slice(0, 50);
    for (const [key] of oldest) cache.delete(key);
  }

  return { ...payload, cache: "MISS" };
}
