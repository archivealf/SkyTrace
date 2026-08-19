const WMS_ROOT = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
const LAYER = "IMERG_Precipitation_Rate_30min";
const EXTENT = 20037508.342789244;
const TILE_CACHE = new Map();
const CACHE_TTL = 10 * 60_000;
const MAX_TILES = 96;
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69+RkgAAAABJRU5ErkJggg==",
  "base64"
);

function tileBounds(z, x, y) {
  const zoom = Number(z);
  const col = Number(x);
  const row = Number(y);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 8) throw Object.assign(new Error("Invalid precipitation tile zoom."), { status: 400 });
  const count = 2 ** zoom;
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= count || row >= count) {
    throw Object.assign(new Error("Invalid precipitation tile coordinates."), { status: 400 });
  }
  const span = (EXTENT * 2) / count;
  const minx = -EXTENT + col * span;
  const maxx = minx + span;
  const maxy = EXTENT - row * span;
  const miny = maxy - span;
  return { minx, miny, maxx, maxy, zoom, col, row };
}

function trimCache() {
  while (TILE_CACHE.size > MAX_TILES) TILE_CACHE.delete(TILE_CACHE.keys().next().value);
}

export function getPrecipitationInfo() {
  return {
    ok: true,
    source: "NASA GPM IMERG via GIBS",
    kind: "satellite-precipitation-estimate",
    layer: LAYER,
    maxNativeZoom: 6,
    attribution: "NASA GPM IMERG imagery via NASA GIBS"
  };
}

export async function getPrecipitationTile(z, x, y) {
  const b = tileBounds(z, x, y);
  const key = `${b.zoom}/${b.col}/${b.row}`;
  const cached = TILE_CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return { ...cached, cache: "HIT" };

  const url = new URL(WMS_ROOT);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("REQUEST", "GetMap");
  url.searchParams.set("VERSION", "1.1.1");
  url.searchParams.set("LAYERS", LAYER);
  url.searchParams.set("STYLES", "");
  url.searchParams.set("FORMAT", "image/png");
  url.searchParams.set("TRANSPARENT", "true");
  url.searchParams.set("SRS", "EPSG:3857");
  url.searchParams.set("BBOX", `${b.minx},${b.miny},${b.maxx},${b.maxy}`);
  url.searchParams.set("WIDTH", "256");
  url.searchParams.set("HEIGHT", "256");

  const response = await fetch(url, {
    headers: { Accept: "image/png,image/*;q=0.9,*/*;q=0.1", "User-Agent": "SkyTrace/3.3" }
  });

  if (response.status === 404 || response.status === 204) {
    return { body: TRANSPARENT_PNG, contentType: "image/png", cache: "MISS", empty: true };
  }
  if (!response.ok) {
    const error = new Error(`NASA GIBS precipitation tile failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw Object.assign(new Error("NASA GIBS returned a non-image precipitation response."), { status: 502 });
  }
  const body = Buffer.from(await response.arrayBuffer());
  const entry = { body, contentType, at: Date.now(), empty: false };
  TILE_CACHE.set(key, entry);
  trimCache();
  return { ...entry, cache: "MISS" };
}
