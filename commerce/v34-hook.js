import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, 'config.json');
const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const dataFile = path.resolve(__dirname, String(rawConfig?.dataFile || 'data/store.json'));
const sqliteFile = path.resolve(__dirname, String(rawConfig?.sqliteFile || dataFile.replace(/\.json$/i, '') + '.sqlite3'));
const db = new DatabaseSync(sqliteFile, { timeout: 5000 });
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS aircraft_notes(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icao TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,icao)
) STRICT;
CREATE TABLE IF NOT EXISTS v34_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE INDEX IF NOT EXISTS v34_events_at_idx ON v34_events(at);
`);

const originalCreateServer = http.createServer.bind(http);
const CACHE = new Map();
const RATE = new Map();
const WEB_ROOT = path.join(__dirname, 'web');

function clean(v) { return typeof v === 'string' ? v.trim() : ''; }
function now() { return Date.now(); }
function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
function security(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
}
function clientIp(req) {
  const f = clean(req.headers['x-forwarded-for']);
  return (f ? f.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}
function rateLimit(req, bucket, max, windowMs) {
  const key = `${bucket}|${clientIp(req)}`;
  const cutoff = now() - windowMs;
  const list = (RATE.get(key) || []).filter(t => t > cutoff);
  if (list.length >= max) throw Object.assign(new Error('Too many requests. Try again shortly.'), { status: 429 });
  list.push(now()); RATE.set(key, list);
}
function auth(req) {
  const m = /^Bearer\s+(.+)$/i.exec(clean(req.headers.authorization));
  if (!m) return null;
  return db.prepare(`SELECT u.id,u.username,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sha256(m[1]), now()) || null;
}
function requireAuth(req) {
  const user = auth(req);
  if (!user) throw Object.assign(new Error('Sign in to SkyTrace first.'), { status: 401 });
  return user;
}
function entitlements(userId) {
  const owned = new Set(db.prepare("SELECT DISTINCT entitlement FROM purchases WHERE user_id=? AND status='paid'").all(userId).map(r => r.entitlement));
  const effective = new Set(owned);
  if (owned.has('pro')) for (const key of ['airport_intelligence','advanced_aircraft','replay_plus','themes']) effective.add(key);
  return { owned: [...owned], effective: [...effective] };
}
function requireEntitlement(userId, key) {
  if (!entitlements(userId).effective.includes(key)) throw Object.assign(new Error(`${key.replaceAll('_',' ')} or SkyTrace Pro is required.`), { status: 403 });
}
function admin(req) {
  const supplied = clean(req.headers['x-skytrace-admin']);
  if (!supplied) return false;
  const configured = clean(rawConfig?.security?.adminToken);
  let expected = configured;
  if (!expected) {
    try { expected = fs.readFileSync(path.join(path.dirname(sqliteFile), 'admin-token.txt'), 'utf8').trim(); } catch {}
  }
  const a = Buffer.from(supplied), b = Buffer.from(expected || '');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
async function readJson(req, limit = 256_000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request too large.'), { status: 413 }); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
function event(kind, detail = {}) {
  try { db.prepare('INSERT INTO v34_events(at,kind,detail_json) VALUES(?,?,?)').run(now(), kind, JSON.stringify(detail)); } catch {}
}
async function cachedFetchJson(key, url, ttl = 60_000) {
  const hit = CACHE.get(key);
  if (hit && now() - hit.at < ttl) return { data: hit.data, cache: 'HIT' };
  const response = await fetch(url, { headers: { Accept: 'application/json, application/geo+json', 'User-Agent': 'SkyTrace/3.4 Operations' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const data = await response.json();
  CACHE.set(key, { at: now(), data });
  return { data, cache: 'MISS' };
}
function normalizeLive(ac) {
  const lat = Number(ac?.lat), lon = Number(ac?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ground = String(ac.alt_baro || '').toLowerCase() === 'ground';
  return {
    icao24: clean(ac.hex).replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase(), callsign: clean(ac.flight) || 'NO CALLSIGN',
    registration: clean(ac.r), aircraftType: clean(ac.t), latitude: lat, longitude: lon,
    altitudeFt: ground ? 0 : Number.isFinite(Number(ac.alt_geom ?? ac.alt_baro)) ? Math.round(Number(ac.alt_geom ?? ac.alt_baro)) : null,
    speedKts: Number.isFinite(Number(ac.gs)) ? Math.round(Number(ac.gs)) : null,
    heading: Number.isFinite(Number(ac.true_heading ?? ac.track)) ? Math.round(Number(ac.true_heading ?? ac.track)) : 0,
    verticalRateFpm: Number.isFinite(Number(ac.geom_rate ?? ac.baro_rate)) ? Math.round(Number(ac.geom_rate ?? ac.baro_rate)) : null,
    onGround: ground, squawk: clean(ac.squawk) || null, emergency: ac.emergency && ac.emergency !== 'none' ? ac.emergency : null
  };
}
async function livePoint(lat, lon, radius = 120) {
  const la = Math.max(-90, Math.min(90, Number(lat))), lo = Math.max(-180, Math.min(180, Number(lon)));
  const r = Math.max(1, Math.min(245, Number(radius) || 120));
  if (![la, lo].every(Number.isFinite)) throw Object.assign(new Error('Valid lat/lon required.'), { status: 400 });
  const key = `live:${la.toFixed(2)}:${lo.toFixed(2)}:${Math.round(r)}`;
  const { data, cache } = await cachedFetchJson(key, `https://api.adsb.lol/v2/point/${la.toFixed(4)}/${lo.toFixed(4)}/${Math.round(r)}`, 8_000);
  return { ok: true, source: 'ADSB.lol', cache, flights: (data?.ac || []).map(normalizeLive).filter(Boolean), fetchedAt: now() };
}
async function operations() {
  const endpoints = {
    internationalSigmets: 'https://aviationweather.gov/api/data/isigmet?format=geojson',
    domesticSigmets: 'https://aviationweather.gov/api/data/airsigmet?format=geojson',
    graphicalAirmets: 'https://aviationweather.gov/api/data/gairmet?format=geojson',
    pireps: 'https://aviationweather.gov/api/data/pirep?format=geojson&age=2'
  };
  const result = {};
  await Promise.all(Object.entries(endpoints).map(async ([key, url]) => {
    try { const r = await cachedFetchJson(`ops:${key}`, url, 60_000); result[key] = { ok: true, cache: r.cache, geojson: r.data }; }
    catch (e) { result[key] = { ok: false, error: e.message, geojson: { type: 'FeatureCollection', features: [] } }; }
  }));
  const notamUrl = clean(rawConfig?.operations?.notamFeedUrl);
  let notams = { ok: false, configured: false, error: 'Official NOTAM API feed is not configured.' };
  if (notamUrl) {
    try {
      const headers = { Accept: 'application/json', 'User-Agent': 'SkyTrace/3.4 Operations' };
      const token = clean(rawConfig?.operations?.notamBearerToken);
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(notamUrl, { headers, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`NOTAM feed returned ${response.status}`);
      notams = { ok: true, configured: true, data: await response.json() };
    } catch (e) { notams = { ok: false, configured: true, error: e.message }; }
  }
  return { ok: true, generatedAt: now(), source: 'AviationWeather.gov', ...result, notams,
    note: 'SIGMET/PIREP/G-AIRMET data are operational weather products. NOTAM data is only enabled when an approved official feed is configured.' };
}
function replay(userId, params) {
  requireEntitlement(userId, 'replay_plus');
  const from = Number(params.get('from')) || now() - 6 * 3600_000;
  const to = Number(params.get('to')) || now();
  const icao = clean(params.get('icao')).toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6);
  const limit = Math.max(100, Math.min(20_000, Number(params.get('limit')) || 8000));
  const where = ['recorded_at BETWEEN ? AND ?']; const args = [from, to];
  if (icao) { where.push('icao=?'); args.push(icao); }
  const rows = db.prepare(`SELECT MIN(recorded_at) recordedAt,icao,MAX(callsign) callsign,AVG(latitude) latitude,AVG(longitude) longitude,AVG(altitude_ft) altitudeFt,AVG(speed_kts) speedKts,AVG(heading) heading,AVG(vertical_rate_fpm) verticalRateFpm,MAX(on_ground) onGround,MAX(squawk) squawk,COUNT(*) samples FROM flight_history WHERE ${where.join(' AND ')} GROUP BY bucket,icao ORDER BY recordedAt ASC LIMIT ?`).all(...args, limit);
  return { ok: true, from, to, icao: icao || null, points: rows, count: rows.length, global: true, retentionDays: 30 };
}
async function aircraftProfile(user, icaoRaw) {
  requireEntitlement(user.id, 'advanced_aircraft');
  const icao = clean(icaoRaw).toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6);
  if (icao.length !== 6) throw Object.assign(new Error('A six-character ICAO hex is required.'), { status: 400 });
  const recent = db.prepare('SELECT recorded_at recordedAt,callsign,latitude,longitude,altitude_ft altitudeFt,speed_kts speedKts,heading,vertical_rate_fpm verticalRateFpm,on_ground onGround,squawk FROM flight_history WHERE icao=? AND recorded_at>? ORDER BY recorded_at DESC LIMIT 250').all(icao, now() - 30 * 86400_000);
  const summary = db.prepare('SELECT COUNT(*) samples,MIN(recorded_at) firstSeen,MAX(recorded_at) lastSeen,MAX(altitude_ft) maxAltitudeFt,MAX(speed_kts) maxSpeedKts,COUNT(DISTINCT callsign) callsigns FROM flight_history WHERE icao=? AND recorded_at>?').get(icao, now() - 30 * 86400_000);
  let current = null;
  try { const r = await cachedFetchJson(`icao:${icao}`, `https://api.adsb.lol/v2/icao/${icao}`, 8_000); current = normalizeLive(r.data?.ac?.[0]); } catch {}
  const note = db.prepare('SELECT note,updated_at updatedAt FROM aircraft_notes WHERE user_id=? AND icao=?').get(user.id, icao) || { note: '', updatedAt: null };
  return { ok: true, icao, current, summary, recent, note };
}
function saveNote(user, body) {
  requireEntitlement(user.id, 'advanced_aircraft');
  const icao = clean(body.icao).toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6);
  if (icao.length !== 6) throw Object.assign(new Error('A six-character ICAO hex is required.'), { status: 400 });
  const note = clean(body.note).slice(0, 2000);
  db.prepare('INSERT INTO aircraft_notes(user_id,icao,note,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,icao) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at').run(user.id, icao, note, now());
  event('aircraft_note', { userId: user.id, icao });
  return { ok: true, icao, note };
}
function status() {
  const q = db.prepare('PRAGMA quick_check').all().map(r => Object.values(r)[0]);
  const counts = {};
  for (const [name, table] of Object.entries({ users:'users', purchases:'purchases', codes:'codes', cloudItems:'cloud_items', historyPoints:'flight_history', aircraftNotes:'aircraft_notes' })) {
    try { counts[name] = Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n); } catch { counts[name] = 0; }
  }
  return { ok: q.every(x => x === 'ok'), storage: 'sqlite-wal', sqlite: path.basename(sqliteFile), quickCheck: q, counts, time: new Date().toISOString(), version: '3.4' };
}
function makeBackup() {
  const dir = path.join(path.dirname(sqliteFile), 'backups'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `skytrace-${stamp}.sqlite3`);
  fs.copyFileSync(sqliteFile, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600);
  const st = fs.statSync(target); event('backup_created', { file: path.basename(target), bytes: st.size });
  return { ok: true, file: path.basename(target), bytes: st.size, createdAt: st.mtimeMs };
}
function adminAudit(limit = 200) {
  return { ok: true, rows: db.prepare('SELECT id,at,kind,detail_json detail FROM v34_events ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(1000, Number(limit)||200))) };
}
function serveFile(res, file, type) {
  const fp = path.join(WEB_ROOT, file); if (!fp.startsWith(WEB_ROOT) || !fs.existsSync(fp)) { res.statusCode = 404; return res.end('Not found'); }
  security(res); res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store'); fs.createReadStream(fp).pipe(res);
}

http.createServer = function v34CreateServer(...args) {
  const options = typeof args[0] === 'function' ? null : args[0];
  const listener = typeof args[0] === 'function' ? args[0] : args[1];
  const wrapped = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      security(res);
      if (req.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/')) return serveFile(res, 'index.html', 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/app/web.js') return serveFile(res, 'web.js', 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/app/web.css') return serveFile(res, 'web.css', 'text/css; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/v1/v34/status') return json(res, 200, status());
      if (req.method === 'GET' && url.pathname === '/v1/v34/live') { rateLimit(req,'live',60,60_000); requireAuth(req); return json(res,200,await livePoint(url.searchParams.get('lat'),url.searchParams.get('lon'),url.searchParams.get('radius'))); }
      if (req.method === 'GET' && url.pathname === '/v1/v34/operations') { rateLimit(req,'ops',20,60_000); requireAuth(req); return json(res,200,await operations()); }
      if (req.method === 'GET' && url.pathname === '/v1/v34/replay') { const u=requireAuth(req); return json(res,200,replay(u.id,url.searchParams)); }
      if (req.method === 'GET' && url.pathname === '/v1/v34/aircraft-profile') { const u=requireAuth(req); return json(res,200,await aircraftProfile(u,url.searchParams.get('icao'))); }
      if (req.method === 'POST' && url.pathname === '/v1/v34/aircraft-note') { const u=requireAuth(req); return json(res,200,saveNote(u,await readJson(req))); }
      if (req.method === 'POST' && url.pathname === '/v1/v34/admin/backup') { if(!admin(req)) return json(res,401,{ok:false,error:'Admin token required.'}); return json(res,200,makeBackup()); }
      if (req.method === 'GET' && url.pathname === '/v1/v34/admin/audit') { if(!admin(req)) return json(res,401,{ok:false,error:'Admin token required.'}); return json(res,200,adminAudit(url.searchParams.get('limit'))); }
      if (req.method === 'GET' && url.pathname === '/admin/v34') return serveFile(res, 'admin-v34.html', 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/admin/v34.js') return serveFile(res, 'admin-v34.js', 'text/javascript; charset=utf-8');
      return listener(req, res);
    } catch (error) { return json(res, error.status >= 400 && error.status < 600 ? error.status : 500, { ok:false, error:error.message || 'V3.4 server error' }); }
  };
  return options == null ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
};
