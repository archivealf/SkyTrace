import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, "config.json");
const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
const dataFile = path.resolve(__dirname, String(raw?.dataFile || "data/store.json"));
const sqliteFile = path.resolve(__dirname, String(raw?.sqliteFile || dataFile.replace(/\.json$/i, "") + ".sqlite3"));
const db = new DatabaseSync(sqliteFile, { timeout: 5000 });
db.exec("PRAGMA busy_timeout=5000;");

const migrated = db.prepare("SELECT value FROM meta WHERE key='cloud_fk_detached'").get()?.value === "1";
if (!migrated) {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
  try {
    db.exec(`
      ALTER TABLE cloud_items RENAME TO cloud_items_with_fk;
      CREATE TABLE cloud_items(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        item_key TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id,kind,item_key)
      ) STRICT;
      INSERT INTO cloud_items SELECT id,user_id,kind,item_key,label,data_json,created_at,updated_at FROM cloud_items_with_fk;
      DROP TABLE cloud_items_with_fk;
      CREATE INDEX IF NOT EXISTS cloud_user_kind_idx ON cloud_items(user_id,kind);

      ALTER TABLE flight_history RENAME TO flight_history_with_fk;
      CREATE TABLE flight_history(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        bucket INTEGER NOT NULL,
        icao TEXT NOT NULL,
        callsign TEXT NOT NULL DEFAULT '',
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude_ft INTEGER,
        speed_kts INTEGER,
        heading INTEGER,
        vertical_rate_fpm INTEGER,
        on_ground INTEGER NOT NULL DEFAULT 0,
        squawk TEXT,
        source TEXT NOT NULL DEFAULT 'ADSB.lol',
        UNIQUE(user_id,bucket,icao)
      ) STRICT;
      INSERT INTO flight_history(id,user_id,recorded_at,bucket,icao,callsign,latitude,longitude,altitude_ft,speed_kts,heading,vertical_rate_fpm,on_ground,squawk,source)
      SELECT id,user_id,recorded_at,bucket,icao,callsign,latitude,longitude,altitude_ft,speed_kts,heading,vertical_rate_fpm,on_ground,squawk,source FROM flight_history_with_fk;
      DROP TABLE flight_history_with_fk;
      CREATE INDEX IF NOT EXISTS history_time_idx ON flight_history(recorded_at);
      CREATE INDEX IF NOT EXISTS history_icao_time_idx ON flight_history(icao,recorded_at);
      INSERT INTO meta(key,value) VALUES('cloud_fk_detached','1') ON CONFLICT(key) DO UPDATE SET value='1';
    `);
    db.exec("COMMIT;");
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON;");
  }
}
