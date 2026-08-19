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
