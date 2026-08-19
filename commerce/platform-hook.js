import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");
const originalReadFileSync = fs.readFileSync.bind(fs);
const originalRenameSync = fs.renameSync.bind(fs);
const originalUnlinkSync = fs.unlinkSync.bind(fs);
const originalCreateServer = http.createServer.bind(http);

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function now() { return Date.now(); }
function id(prefix, bytes = 12) { return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`; }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function safeEqual(a, b) { try { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb); } catch { return false; } }
function parseJson(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }

const rawConfig = JSON.parse(originalReadFileSync(configPath, "utf8"));
const pepper = clean(rawConfig?.security?.pepper);
if (pepper.length < 32) throw new Error("security.pepper must be configured before SkyTrace SQLite storage can start.");
const dataFile = path.resolve(__dirname, clean(rawConfig?.dataFile) || "data/store.json");
const sqliteFile = path.resolve(__dirname, clean(rawConfig?.sqliteFile) || dataFile.replace(/\.json$/i, "") + ".sqlite3");
fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
const db = new DatabaseSync(sqliteFile, { timeout: 5000 });
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,product_key TEXT NOT NULL,entitlement TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'stripe',stripe_session_id TEXT,payment_intent TEXT,code_id TEXT,amount_total INTEGER,currency TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS purchases_stripe_uq ON purchases(stripe_session_id) WHERE stripe_session_id IS NOT NULL AND stripe_session_id<>'';
CREATE INDEX IF NOT EXISTS purchases_user_idx ON purchases(user_id,status);
CREATE TABLE IF NOT EXISTS codes(id TEXT PRIMARY KEY,code_hash TEXT NOT NULL UNIQUE,prefix TEXT NOT NULL,last4 TEXT NOT NULL,product_key TEXT NOT NULL,entitlement TEXT NOT NULL,name TEXT NOT NULL,max_uses INTEGER NOT NULL DEFAULT 1,uses INTEGER NOT NULL DEFAULT 0,label TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,expires_at INTEGER,revoked_at INTEGER) STRICT;
CREATE TABLE IF NOT EXISTS code_redemptions(id INTEGER PRIMARY KEY AUTOINCREMENT,code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,redeemed_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS cloud_items(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,item_key TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',data_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,kind,item_key)) STRICT;
CREATE INDEX IF NOT EXISTS cloud_user_kind_idx ON cloud_items(user_id,kind);
CREATE TABLE IF NOT EXISTS flight_history(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,recorded_at INTEGER NOT NULL,bucket INTEGER NOT NULL,icao TEXT NOT NULL,callsign TEXT NOT NULL DEFAULT '',latitude REAL NOT NULL,longitude REAL NOT NULL,altitude_ft INTEGER,speed_kts INTEGER,heading INTEGER,vertical_rate_fpm INTEGER,on_ground INTEGER NOT NULL DEFAULT 0,squawk TEXT,source TEXT NOT NULL DEFAULT 'ADSB.lol',UNIQUE(user_id,bucket,icao)) STRICT;
CREATE INDEX IF NOT EXISTS history_time_idx ON flight_history(recorded_at);
CREATE INDEX IF NOT EXISTS history_icao_time_idx ON flight_history(icao,recorded_at);
CREATE TABLE IF NOT EXISTS admin_events(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,action TEXT NOT NULL,detail_json TEXT NOT NULL DEFAULT '{}') STRICT;
`);

function tx(fn) { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; } }
function meta(key) { return db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value || ""; }
function setMeta(key, value) { db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value)); }

function importStore(store) {
  tx(() => {
    db.exec("DELETE FROM code_redemptions; DELETE FROM codes; DELETE FROM purchases; DELETE FROM sessions; DELETE FROM users;");
    const ui = db.prepare("INSERT INTO users(id,username,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)");
    for (const u of store.users || []) if (u?.id && u?.username && u?.passwordSalt && u?.passwordHash) ui.run(u.id,u.username,u.passwordSalt,u.passwordHash,Number(u.createdAt)||now());
    const si = db.prepare("INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?,?)");
    for (const s of store.sessions || []) if (s?.id && s?.tokenHash && s?.userId) si.run(s.id,s.tokenHash,s.userId,Number(s.createdAt)||now(),Number(s.expiresAt)||now());
    const pi = db.prepare("INSERT INTO purchases(id,user_id,product_key,entitlement,status,source,stripe_session_id,payment_intent,code_id,amount_total,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const p of store.purchases || []) if (p?.id && p?.userId && p?.entitlement) pi.run(p.id,p.userId,clean(p.productKey),p.entitlement,p.status||"paid",p.source||(p.codeId?"redeem_code":"stripe"),clean(p.stripeSessionId)||null,clean(p.paymentIntent)||null,clean(p.codeId)||null,Number.isFinite(Number(p.amountTotal))?Number(p.amountTotal):null,clean(p.currency)||null,Number(p.createdAt)||now(),Number(p.updatedAt)||Number(p.createdAt)||now());
    const ci = db.prepare("INSERT INTO codes(id,code_hash,prefix,last4,product_key,entitlement,name,max_uses,uses,label,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const ri = db.prepare("INSERT INTO code_redemptions(code_id,user_id,purchase_id,redeemed_at) VALUES(?,?,?,?)");
    for (const c of store.codes || []) if (c?.id && c?.codeHash && c?.entitlement) {
      ci.run(c.id,c.codeHash,c.prefix||"SKY",c.last4||"????",c.productKey||c.entitlement,c.entitlement,c.name||c.productKey||c.entitlement,Math.max(1,Number(c.maxUses)||1),Math.max(0,Number(c.uses)||0),clean(c.label),Number(c.createdAt)||now(),c.expiresAt?Number(c.expiresAt):null,c.revokedAt?Number(c.revokedAt):null);
      for (const r of c.redemptions || []) if (r?.userId && r?.purchaseId) ri.run(c.id,r.userId,r.purchaseId,Number(r.redeemedAt)||now());
    }
  });
}
function exportStore() {
  const users = db.prepare("SELECT id,username,password_salt,password_hash,created_at FROM users").all().map(u=>({id:u.id,username:u.username,passwordSalt:u.password_salt,passwordHash:u.password_hash,createdAt:u.created_at}));
  const sessions = db.prepare("SELECT id,token_hash,user_id,created_at,expires_at FROM sessions").all().map(s=>({id:s.id,tokenHash:s.token_hash,userId:s.user_id,createdAt:s.created_at,expiresAt:s.expires_at}));
  const purchases = db.prepare("SELECT * FROM purchases").all().map(p=>({id:p.id,userId:p.user_id,productKey:p.product_key,entitlement:p.entitlement,status:p.status,source:p.source,stripeSessionId:p.stripe_session_id||"",paymentIntent:p.payment_intent||"",codeId:p.code_id||"",amountTotal:p.amount_total,currency:p.currency||"",createdAt:p.created_at,updatedAt:p.updated_at}));
  const codes = db.prepare("SELECT * FROM codes").all().map(c=>({id:c.id,codeHash:c.code_hash,prefix:c.prefix,last4:c.last4,productKey:c.product_key,entitlement:c.entitlement,name:c.name,maxUses:c.max_uses,uses:c.uses,label:c.label,createdAt:c.created_at,expiresAt:c.expires_at,revokedAt:c.revoked_at,redemptions:db.prepare("SELECT user_id,purchase_id,redeemed_at FROM code_redemptions WHERE code_id=?").all(c.id).map(r=>({userId:r.user_id,purchaseId:r.purchase_id,redeemedAt:r.redeemed_at}))}));
  return { version: 3, users, sessions, purchases, codes };
}

if (meta("legacy_migrated") !== "1") {
  try {
    const legacy = JSON.parse(originalReadFileSync(dataFile,"utf8"));
    const backup = `${dataFile}.pre-sqlite-${new Date().toISOString().replace(/[:.]/g,"-")}.bak`;
    try { fs.copyFileSync(dataFile,backup,fs.constants.COPYFILE_EXCL); } catch {}
    importStore(legacy);
  } catch {}
  setMeta("legacy_migrated","1");
}

function isStorePath(value) { try { return path.resolve(String(value)) === dataFile; } catch { return false; } }
fs.readFileSync = function patchedRead(file, options) {
  if (!isStorePath(file)) return originalReadFileSync(file, options);
  const text = `${JSON.stringify(exportStore(),null,2)}\n`;
  const encoding = typeof options === "string" ? options : options?.encoding;
  return encoding ? text : Buffer.from(text);
};
fs.renameSync = function patchedRename(from, to) {
  if (!isStorePath(to)) return originalRenameSync(from,to);
  const text = originalReadFileSync(from,"utf8");
  importStore(JSON.parse(text));
  try { originalUnlinkSync(from); } catch {}
};

function ensureAdminToken() {
  const configured = clean(rawConfig?.security?.adminToken);
  if (configured.length >= 32) return configured;
  const tokenFile = path.join(path.dirname(sqliteFile),"admin-token.txt");
  try { const t = originalReadFileSync(tokenFile,"utf8").trim(); if (t.length >= 32) return t; } catch {}
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(tokenFile,`${token}\n`,{mode:0o600}); try { fs.chmodSync(tokenFile,0o600); } catch {}
  return token;
}
const adminToken = ensureAdminToken();

function security(res) { res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"); }
function json(res,status,payload){security(res);res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(payload));}
async function body(req,limit=1_048_576){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error("Request too large."),{status:413});chunks.push(chunk)}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw Object.assign(new Error("Invalid JSON request."),{status:400})}}
function auth(req){const m=/^Bearer\s+(.+)$/i.exec(clean(req.headers.authorization));if(!m)return null;const row=db.prepare("SELECT u.id,u.username,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").get(sha256(m[1]),now());return row||null}
function requireAuth(req){const u=auth(req);if(!u)throw Object.assign(new Error("Your session has expired. Sign in again."),{status:401});return u}
function entitlements(userId){const owned=new Set(db.prepare("SELECT DISTINCT entitlement FROM purchases WHERE user_id=? AND status='paid'").all(userId).map(r=>r.entitlement));const effective=new Set(owned);if(owned.has("pro"))for(const x of ["airport_intelligence","advanced_aircraft","replay_plus","themes"])effective.add(x);return{entitlements:[...owned],effectiveEntitlements:[...effective]}}
function requireEntitlement(userId,key,msg){if(!entitlements(userId).effectiveEntitlements.includes(key))throw Object.assign(new Error(msg),{status:403})}
function codeHash(value){return crypto.createHmac("sha256",pepper).update(clean(value).toUpperCase().replace(/\s+/g,"")).digest("hex")}
const redeemAttempts=new Map();
function redeem(req,user,rawCode){const k=`${user.id}|${req.socket.remoteAddress||"unknown"}`,cut=now()-15*60_000,list=(redeemAttempts.get(k)||[]).filter(t=>t>cut);if(list.length>=12)throw Object.assign(new Error("Too many code attempts. Try again later."),{status:429});list.push(now());redeemAttempts.set(k,list);const normalized=clean(rawCode).toUpperCase().replace(/\s+/g,"");if(!/^SKY-[A-Z0-9-]{12,40}$/.test(normalized))throw Object.assign(new Error("Enter a valid SkyTrace code."),{status:400});return tx(()=>{const c=db.prepare("SELECT * FROM codes WHERE code_hash=?").get(codeHash(normalized));if(!c||c.revoked_at)throw Object.assign(new Error("That code is invalid or has been revoked."),{status:404});if(c.expires_at&&c.expires_at<=now())throw Object.assign(new Error("That code has expired."),{status:410});if(c.uses>=c.max_uses)throw Object.assign(new Error("That code has already been used."),{status:409});if(entitlements(user.id).effectiveEntitlements.includes(c.entitlement))throw Object.assign(new Error("Your account already has this unlock. The code was not consumed."),{status:409});const pid=id("pur"),t=now();db.prepare("INSERT INTO purchases(id,user_id,product_key,entitlement,status,source,code_id,amount_total,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(pid,user.id,c.product_key,c.entitlement,"paid","redeem_code",c.id,0,"gbp",t,t);db.prepare("UPDATE codes SET uses=uses+1 WHERE id=?").run(c.id);db.prepare("INSERT INTO code_redemptions(code_id,user_id,purchase_id,redeemed_at) VALUES(?,?,?,?)").run(c.id,user.id,pid,t);return{redeemed:{productKey:c.product_key,entitlement:c.entitlement,name:c.name},...entitlements(user.id)}})}

const kinds=new Set(["watchlist","alert","bookmark","workspace"]);
function cloudBundle(uid){const out={watchlist:[],alerts:[],bookmarks:[],workspaces:[]};for(const r of db.prepare("SELECT * FROM cloud_items WHERE user_id=? ORDER BY updated_at DESC").all(uid)){const item={id:r.id,key:r.item_key,label:r.label,data:parseJson(r.data_json,{}),createdAt:r.created_at,updatedAt:r.updated_at};if(r.kind==="alert")out.alerts.push(item);else if(r.kind==="bookmark")out.bookmarks.push(item);else if(r.kind==="workspace")out.workspaces.push(item);else out.watchlist.push(item)}return out}
function upsertCloud(uid,b){const kind=clean(b.kind).toLowerCase();if(!kinds.has(kind))throw Object.assign(new Error("Unknown cloud item type."),{status:400});const key=clean(b.key).slice(0,120);if(!key)throw Object.assign(new Error("Cloud item key is required."),{status:400});const label=clean(b.label).slice(0,120),data=JSON.stringify(b.data||{});if(Buffer.byteLength(data)>32768)throw Object.assign(new Error("Cloud item is too large."),{status:413});const old=db.prepare("SELECT id,created_at FROM cloud_items WHERE user_id=? AND kind=? AND item_key=?").get(uid,kind,key),cid=old?.id||id("cloud"),t=now();db.prepare("INSERT INTO cloud_items(id,user_id,kind,item_key,label,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,kind,item_key) DO UPDATE SET label=excluded.label,data_json=excluded.data_json,updated_at=excluded.updated_at").run(cid,uid,kind,key,label,data,old?.created_at||t,t);return{id:cid,kind,key,label,data:parseJson(data),createdAt:old?.created_at||t,updatedAt:t}}
function deleteCloud(uid,b){const result=b.id?db.prepare("DELETE FROM cloud_items WHERE user_id=? AND id=?").run(uid,clean(b.id)):db.prepare("DELETE FROM cloud_items WHERE user_id=? AND kind=? AND item_key=?").run(uid,clean(b.kind),clean(b.key));return Number(result.changes)>0}

let lastPrune=0;
function ingest(uid,b){const flights=Array.isArray(b.flights)?b.flights.slice(0,900):[],recordedAt=clamp(Number(b.recordedAt)||now(),now()-10*60_000,now()+60_000),bucket=Math.floor(recordedAt/15000);let inserted=0;tx(()=>{const q=db.prepare("INSERT OR IGNORE INTO flight_history(user_id,recorded_at,bucket,icao,callsign,latitude,longitude,altitude_ft,speed_kts,heading,vertical_rate_fpm,on_ground,squawk,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");for(const f of flights){const icao=clean(f.icao24||f.icao).toLowerCase().replace(/[^0-9a-f]/g,"").slice(0,6),lat=Number(f.latitude??f.lat),lon=Number(f.longitude??f.lon);if(icao.length!==6||!Number.isFinite(lat)||!Number.isFinite(lon))continue;const r=q.run(uid,recordedAt,bucket,icao,clean(f.callsign).slice(0,16),lat,lon,Number.isFinite(Number(f.altitudeFt))?Math.round(Number(f.altitudeFt)):null,Number.isFinite(Number(f.speedKts))?Math.round(Number(f.speedKts)):null,Number.isFinite(Number(f.heading))?Math.round(Number(f.heading)):null,Number.isFinite(Number(f.verticalRateFpm))?Math.round(Number(f.verticalRateFpm)):null,f.onGround?1:0,clean(f.squawk).slice(0,8)||null,clean(f.source).slice(0,40)||"ADSB.lol");inserted+=Number(r.changes)||0}});if(now()-lastPrune>3600000){lastPrune=now();db.prepare("DELETE FROM flight_history WHERE recorded_at<?").run(now()-30*86400000)}return{inserted}}
function history(uid,p){requireEntitlement(uid,"replay_plus","Cloud Replay requires Replay+ or SkyTrace Pro.");const to=clamp(Number(p.get("to"))||now(),now()-30*86400000,now()+60000),from=clamp(Number(p.get("from"))||to-3600000,to-7*86400000,to),icao=clean(p.get("icao")).toLowerCase().replace(/[^0-9a-f]/g,"").slice(0,6),limit=clamp(Number(p.get("limit"))||10000,1,25000),args=[from,to];let sql="SELECT recorded_at,icao,callsign,latitude,longitude,altitude_ft,speed_kts,heading,vertical_rate_fpm,on_ground,squawk,source FROM flight_history WHERE recorded_at BETWEEN ? AND ?";if(icao){sql+=" AND icao=?";args.push(icao)}sql+=" ORDER BY recorded_at ASC LIMIT ?";args.push(limit);const dedupe=new Map();for(const r of db.prepare(sql).all(...args)){const key=`${Math.floor(r.recorded_at/15000)}:${r.icao}`;if(!dedupe.has(key))dedupe.set(key,{recordedAt:r.recorded_at,icao24:r.icao,callsign:r.callsign,latitude:r.latitude,longitude:r.longitude,altitudeFt:r.altitude_ft,speedKts:r.speed_kts,heading:r.heading,verticalRateFpm:r.vertical_rate_fpm,onGround:Boolean(r.on_ground),squawk:r.squawk,source:r.source})}return[...dedupe.values()]}
function csv(rows){const cols=["recordedAt","icao24","callsign","latitude","longitude","altitudeFt","speedKts","heading","verticalRateFpm","onGround","squawk","source"],e=v=>`"${String(v??"").replaceAll('"','""')}"`;return[cols.join(","),...rows.map(r=>cols.map(k=>e(r[k])).join(","))].join("\n")+"\n"}
function geo(rows){return{type:"FeatureCollection",features:rows.map(r=>({type:"Feature",geometry:{type:"Point",coordinates:[r.longitude,r.latitude]},properties:{recordedAt:r.recordedAt,icao24:r.icao24,callsign:r.callsign,altitudeFt:r.altitudeFt,speedKts:r.speedKts,heading:r.heading,verticalRateFpm:r.verticalRateFpm,onGround:r.onGround,squawk:r.squawk,source:r.source}}))}}
function kml(rows){const groups=new Map();for(const r of rows)(groups.get(r.icao24)||groups.set(r.icao24,[]).get(r.icao24)).push(r);const x=v=>String(v??"").replace(/[<>&\"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"})[c]);const pm=[...groups].map(([icao,pts])=>`<Placemark><name>${x(pts.find(p=>p.callsign)?.callsign||icao)}</name><LineString><altitudeMode>absolute</altitudeMode><coordinates>${pts.map(p=>`${p.longitude},${p.latitude},${Number(p.altitudeFt)||0}`).join(" ")}</coordinates></LineString></Placemark>`).join("");return`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>SkyTrace Cloud Replay</name>${pm}</Document></kml>`}

function requireAdmin(req){const supplied=clean(req.headers["x-skytrace-admin"]||clean(req.headers.authorization).replace(/^Bearer\s+/i,""));if(!safeEqual(supplied,adminToken))throw Object.assign(new Error("Admin authentication required."),{status:401})}
function audit(action,detail={}){db.prepare("INSERT INTO admin_events(at,action,detail_json) VALUES(?,?,?)").run(now(),action,JSON.stringify(detail))}
function summary(){const n=sql=>Number(db.prepare(sql).get()?.n)||0;return{users:n("SELECT COUNT(*) n FROM users"),activeSessions:Number(db.prepare("SELECT COUNT(*) n FROM sessions WHERE expires_at>?").get(now())?.n)||0,paidPurchases:n("SELECT COUNT(*) n FROM purchases WHERE status='paid'"),stripeRevenueMinor:Number(db.prepare("SELECT COALESCE(SUM(amount_total),0) n FROM purchases WHERE status='paid' AND source='stripe'").get()?.n)||0,activeCodes:Number(db.prepare("SELECT COUNT(*) n FROM codes WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND uses<max_uses").get(now())?.n)||0,cloudItems:n("SELECT COUNT(*) n FROM cloud_items"),historyPoints:n("SELECT COUNT(*) n FROM flight_history")}}
const PRODUCTS={pro:{name:"SkyTrace Pro",entitlement:"pro",tag:"PRO"},airport_intelligence:{name:"Airport Intelligence",entitlement:"airport_intelligence",tag:"AIR"},advanced_aircraft:{name:"Advanced Aircraft",entitlement:"advanced_aircraft",tag:"ACFT"},replay_plus:{name:"Replay+",entitlement:"replay_plus",tag:"RPLY"},themes:{name:"Themes",entitlement:"themes",tag:"THEME"}},ALPH="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function chunk(){let s="";while(s.length<4)s+=ALPH[crypto.randomInt(ALPH.length)];return s}
function generate(productKey,count,maxUses,days,label){const p=PRODUCTS[productKey];if(!p)throw Object.assign(new Error("Unknown SkyTrace product."),{status:400});const out=[];tx(()=>{const q=db.prepare("INSERT INTO codes(id,code_hash,prefix,last4,product_key,entitlement,name,max_uses,uses,label,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)");for(let i=0;i<clamp(Number(count)||1,1,100);i++){let code,hash;do{code=`SKY-${p.tag}-${chunk()}-${chunk()}-${chunk()}`;hash=codeHash(code)}while(db.prepare("SELECT 1 FROM codes WHERE code_hash=?").get(hash));const t=now();q.run(id("code"),hash,`SKY-${p.tag}`,code.slice(-4),productKey,p.entitlement,p.name,clamp(Number(maxUses)||1,1,10000),0,clean(label).slice(0,80),t,Number(days)>0?t+clamp(Number(days),1,3650)*86400000:null);out.push(code)}});return out}

async function handle(req,res){const url=new URL(req.url||"/","http://localhost");try{
  if(req.method==="GET"&&url.pathname==="/health")return json(res,200,{ok:true,service:"SkyTrace Commerce",time:new Date().toISOString(),storage:"sqlite-wal",payments:rawConfig?.stripe?.enabled===true,auth:"username_password",registration:rawConfig?.security?.allowRegistration!==false,webhook:clean(rawConfig?.stripe?.webhookSecret).startsWith("whsec_"),redeemCodes:true,cloudSync:true,cloudReplay:true,admin:true});
  if(req.method==="POST"&&url.pathname==="/v1/redeem"){const u=requireAuth(req),b=await body(req,8192);return json(res,200,{ok:true,...redeem(req,u,b.code)})}
  if(req.method==="GET"&&url.pathname==="/v1/cloud"){const u=requireAuth(req);return json(res,200,{ok:true,...cloudBundle(u.id)})}
  if(req.method==="POST"&&url.pathname==="/v1/cloud/upsert"){const u=requireAuth(req);return json(res,200,{ok:true,item:upsertCloud(u.id,await body(req,65536))})}
  if(req.method==="POST"&&url.pathname==="/v1/cloud/delete"){const u=requireAuth(req);return json(res,200,{ok:true,deleted:deleteCloud(u.id,await body(req,8192))})}
  if(req.method==="POST"&&url.pathname==="/v1/history/ingest"){const u=requireAuth(req);return json(res,200,{ok:true,...ingest(u.id,await body(req))})}
  if(req.method==="GET"&&url.pathname==="/v1/history"){const u=requireAuth(req),rows=history(u.id,url.searchParams),format=clean(url.searchParams.get("format")).toLowerCase();if(format==="csv"){security(res);res.statusCode=200;res.setHeader("Content-Type","text/csv; charset=utf-8");return res.end(csv(rows))}if(format==="kml"){security(res);res.statusCode=200;res.setHeader("Content-Type","application/vnd.google-earth.kml+xml; charset=utf-8");return res.end(kml(rows))}if(format==="geojson")return json(res,200,geo(rows));return json(res,200,{ok:true,retentionDays:30,coverage:"community-collected",points:rows})}
  if(req.method==="GET"&&url.pathname==="/admin"){security(res);res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");return fs.createReadStream(path.join(__dirname,"admin.html")).pipe(res)}
  if(req.method==="GET"&&url.pathname==="/admin-ui.js"){security(res);res.statusCode=200;res.setHeader("Content-Type","text/javascript; charset=utf-8");res.setHeader("Cache-Control","no-store");return fs.createReadStream(path.join(__dirname,"admin-ui.js")).pipe(res)}
  if(url.pathname.startsWith("/v1/admin/")){requireAdmin(req);if(req.method==="GET"&&url.pathname==="/v1/admin/summary")return json(res,200,{ok:true,summary:summary()});if(req.method==="GET"&&url.pathname==="/v1/admin/users")return json(res,200,{ok:true,rows:db.prepare("SELECT u.id,u.username,u.created_at,(SELECT COUNT(*) FROM purchases p WHERE p.user_id=u.id AND p.status='paid') purchases,(SELECT GROUP_CONCAT(DISTINCT entitlement) FROM purchases p WHERE p.user_id=u.id AND p.status='paid') entitlements FROM users u ORDER BY u.created_at DESC LIMIT 200").all()});if(req.method==="GET"&&url.pathname==="/v1/admin/purchases")return json(res,200,{ok:true,rows:db.prepare("SELECT p.id,u.username,p.product_key,p.entitlement,p.status,p.source,p.amount_total,p.currency,p.created_at,p.updated_at FROM purchases p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 250").all()});if(req.method==="GET"&&url.pathname==="/v1/admin/codes")return json(res,200,{ok:true,rows:db.prepare("SELECT id,prefix,last4,product_key,name,max_uses,uses,label,created_at,expires_at,revoked_at FROM codes ORDER BY created_at DESC LIMIT 300").all()});if(req.method==="POST"&&url.pathname==="/v1/admin/codes/generate"){const b=await body(req);const codes=generate(clean(b.productKey),b.count,b.maxUses,b.days,b.label);audit("codes.generate",{productKey:b.productKey,count:codes.length,label:clean(b.label)});return json(res,200,{ok:true,codes})}if(req.method==="POST"&&url.pathname==="/v1/admin/codes/revoke"){const b=await body(req),r=db.prepare("UPDATE codes SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(now(),clean(b.id));audit("codes.revoke",{id:b.id});return json(res,200,{ok:true,revoked:Number(r.changes)>0})}if(req.method==="POST"&&url.pathname==="/v1/admin/grant"){const b=await body(req),username=clean(b.username).toLowerCase(),product=PRODUCTS[clean(b.productKey)],u=db.prepare("SELECT id FROM users WHERE username=?").get(username);if(!u||!product)throw Object.assign(new Error("Valid username and product are required."),{status:400});if(!entitlements(u.id).effectiveEntitlements.includes(product.entitlement)){const t=now();db.prepare("INSERT INTO purchases(id,user_id,product_key,entitlement,status,source,amount_total,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id("pur"),u.id,b.productKey,product.entitlement,"paid","admin_grant",0,"gbp",t,t)}audit("entitlement.grant",{username,productKey:b.productKey});return json(res,200,{ok:true,username,...entitlements(u.id)})}}
  return false;
}catch(e){return json(res,e.status>=400&&e.status<600?e.status:500,{ok:false,error:e.message||"Server error"})}}

http.createServer=function patchedCreateServer(...args){let options=null,listener=null;if(typeof args[0]==="function")listener=args[0];else{options=args[0];listener=args[1]}const wrapped=async(req,res)=>{const handled=await handle(req,res);if(handled!==false)return;return listener(req,res)};return options==null?originalCreateServer(wrapped):originalCreateServer(options,wrapped)};
