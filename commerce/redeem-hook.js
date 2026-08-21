// Compatibility preload. The platform hook provides redeem codes,
// SQLite-backed account storage, cloud sync/history and the admin dashboard.
import "./platform-hook.js";
// Detach cloud/history tables from legacy account-table cascades so current
// auth/Stripe JSON-compatibility writes cannot remove Cloud data.
import "./platform-preserve.js";
// V3.4 adds operations, global replay, aircraft profiles, browser access,
// monitoring and backup/audit endpoints without replacing the proven
// authentication/Stripe compatibility layer above.
import "./v34-hook.js";
// Searchable account administration, disable/restore and expiring grants are
// isolated in their own final preload so they can guard login/account reads.
import "./admin-v34-hook.js";
// PWA/iOS assets are served by a small final wrapper so account/API responses
// remain untouched and are never cached by the web-app service worker.
import "./pwa-hook.js";
// Mobile 35 remembers successful browser/iOS sessions using a same-site,
// HttpOnly cookie. A short client sentinel lets the existing web runtime boot
// without exposing the persistent bearer token to JavaScript storage.
import "./remember-session-hook.js";
