(() => {
  "use strict";

  let lastSignature = null;
  let checking = false;

  function signature(payload) {
    const authenticated = Boolean(payload?.authenticated);
    const entitlements = [...(payload?.entitlements || [])].map(String).sort();
    const effective = [...(payload?.effectiveEntitlements || [])].map(String).sort();
    return JSON.stringify({ authenticated, entitlements, effective });
  }

  async function checkEntitlements({ reloadOnChange = true } = {}) {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch(`/api/account/me?_=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" }
      });
      if (!response.ok) return;
      const payload = await response.json();
      const next = signature(payload);
      if (lastSignature == null) {
        lastSignature = next;
        return;
      }
      if (next !== lastSignature) {
        lastSignature = next;
        if (reloadOnChange) location.reload();
      }
    } catch {
      // The normal account UI owns service-unreachable messaging.
    } finally {
      checking = false;
    }
  }

  // Establish a baseline after the normal commerce script has loaded the account.
  setTimeout(() => void checkEntitlements({ reloadOnChange: false }), 1200);

  // Admin grants/revocations happen outside the desktop process. Re-check whenever
  // the user returns to SkyTrace or opens Store/Account, plus a light background poll.
  window.addEventListener("focus", () => void checkEntitlements());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkEntitlements();
  });
  document.addEventListener("click", event => {
    if (event.target.closest?.(".commerce-mode-tab, #accountBtn, #accountOpenStore")) {
      setTimeout(() => void checkEntitlements(), 80);
    }
  }, true);
  setInterval(() => {
    if (document.visibilityState === "visible") void checkEntitlements();
  }, 15000);
})();
