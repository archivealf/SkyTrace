// Mobile 35 remembered sessions must wrap every downstream API hook so the
// HttpOnly cookie is converted into the existing bearer-session contract
// before account, Cloud, V3.4 or Airport Desk authentication runs.
import "./remember-session-hook.js";
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
// isolated in their own preload so they can guard login/account reads.
import "./admin-v34-hook.js";
// PWA/iOS assets are served without caching account/API responses.
import "./pwa-hook.js";
// SkyTrace Mobile 35 Airport Desk uses the same authenticated account and
// entitlement model as the rest of the commerce backend.
import "./mobile35-hook.js";
