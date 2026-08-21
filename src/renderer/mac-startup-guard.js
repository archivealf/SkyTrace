(() => {
  "use strict";

  // Startup recovery must work even if Electron's preload bridge fails. Native
  // diagnostics are optional; DOM/API recovery is deliberately browser-only.
  const native = window.skytraceNative || null;
  let finished = false;
  let lastHealthStatus = 0;
  let lastAuthStatus = 0;

  function reportError(type, error, source = "") {
    if (typeof native?.reportStartupError !== "function") return;
    try {
      native.reportStartupError({
        type,
        message: error?.stack || error?.message || String(error || "unknown"),
        source
      });
    } catch {}
  }

  window.addEventListener("error", event => {
    reportError("window-error", event.error || event.message, `${event.filename || "renderer"}:${event.lineno || 0}`);
  });
  window.addEventListener("unhandledrejection", event => {
    reportError("unhandled-rejection", event.reason, "renderer promise");
  });

  function startupNodes() {
    const selectors = [
      "#loading",
      ".loading-screen",
      ".startup-screen",
      ".skytrace-startup",
      "[data-loading=\"true\"]",
      "[data-loading=\"false\"]"
    ];
    return [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
  }

  function shellLooksReady() {
    return Boolean(
      document.querySelector(".flightdeck-rail") ||
      document.querySelector("#sidebar") ||
      document.querySelector("#map") ||
      document.querySelector("main")
    );
  }

  function runtimeLooksReady() {
    // #map exists in the static document; .maplibregl-map/canvas is created by
    // the actual application runtime. Requiring it catches CSP/script failures
    // that would otherwise make a static shell look healthy in CI.
    return Boolean(
      document.querySelector(".maplibregl-map") ||
      document.querySelector("#map canvas") ||
      window.__SKYTRACE_MAP__
    );
  }

  async function probeJson(url, kind) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-SkyTrace-Startup-Probe": "1" }
      });
      if (kind === "health") lastHealthStatus = response.status;
      else lastAuthStatus = response.status;
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      return body?.ok !== false;
    } catch (error) {
      if (kind === "health") lastHealthStatus = 0;
      else lastAuthStatus = 0;
      reportError(`${kind}-probe`, error, url);
      return false;
    }
  }

  function removeStartupOverlays(reason) {
    for (const node of startupNodes()) {
      try {
        node.classList.add("done", "hidden");
        node.hidden = true;
        node.setAttribute("aria-hidden", "true");
        node.setAttribute("data-loading", "false");
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("visibility", "hidden", "important");
        node.style.setProperty("opacity", "0", "important");
        node.style.setProperty("pointer-events", "none", "important");
        setTimeout(() => {
          try { node.remove(); } catch {}
        }, 50);
      } catch {}
    }
    document.documentElement.dataset.skytraceStartup = reason;
  }

  function showRecoveryBanner({ shell, health, auth, runtime }) {
    if (document.getElementById("skytraceStartupRecovery")) return;
    const banner = document.createElement("div");
    banner.id = "skytraceStartupRecovery";
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#111722f2;border:1px solid #ffffff24;border-radius:12px;padding:10px 12px;color:#f2f5ff;font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 10px 35px #0008;max-width:min(760px,92vw);display:flex;gap:10px;align-items:center";
    let detail = "The application runtime did not finish starting.";
    if (!health) detail = lastHealthStatus ? `The local service returned HTTP ${lastHealthStatus}.` : "The local service did not answer yet.";
    else if (!auth) detail = lastAuthStatus ? `Desktop API authorization returned HTTP ${lastAuthStatus}.` : "Desktop API authorization did not complete.";
    else if (!runtime) detail = "The local service is ready, but the map/application runtime did not initialize.";
    else if (!shell) detail = "The application runtime is ready, but the normal interface shell was not detected.";
    banner.innerHTML = `<span>${shell ? "SkyTrace opened in recovery mode." : "SkyTrace startup did not complete."} ${detail}</span><button type="button" style="border:1px solid #ffffff2b;background:#ffffff10;color:#fff;border-radius:8px;padding:6px 9px;cursor:pointer">Reload</button>`;
    banner.querySelector("button")?.addEventListener("click", () => location.reload());
    (document.body || document.documentElement).appendChild(banner);
  }

  function reportReady(payload) {
    if (typeof native?.reportReady !== "function") return;
    try { native.reportReady(payload); } catch {}
  }

  async function readiness() {
    const [health, auth] = await Promise.all([
      probeJson("/api/health", "health"),
      probeJson("/api/config", "auth")
    ]);
    return { health, auth, shell: shellLooksReady(), runtime: runtimeLooksReady() };
  }

  async function finish(reason, { degraded = false, force = false, known = null } = {}) {
    if (finished) return;
    const result = known || await readiness();
    if (!force && !(result.health && result.auth && result.runtime && result.shell)) return;
    finished = true;
    removeStartupOverlays(reason);
    const unhealthy = degraded || !result.health || !result.auth || !result.runtime || !result.shell;
    if (unhealthy) showRecoveryBanner(result);
    reportReady({
      health: result.health,
      auth: result.auth,
      runtime: result.runtime,
      shell: result.shell,
      degraded: unhealthy,
      reason,
      url: location.href
    });
    // One bounded late cleanup catches a legacy loader transition without a
    // permanent document-wide MutationObserver.
    setTimeout(() => removeStartupOverlays(`${reason}-late-cleanup`), 1200);
  }

  async function run() {
    const started = Date.now();
    while (!finished) {
      const elapsed = Date.now() - started;
      const result = await readiness();

      if (result.health && result.auth && result.runtime && result.shell) {
        await finish("health-auth-runtime-shell-ready", { known: result });
        return;
      }

      if (result.health && result.auth && result.runtime && elapsed >= 6000) {
        // The real runtime is alive; do not keep it hidden because a shell
        // selector changed in a future UI revision.
        await finish("runtime-ready-shell-late", { force: true, known: result });
        return;
      }

      if (result.shell && elapsed >= 10000) {
        reportError(
          "startup-recovery",
          new Error(`health=${lastHealthStatus || "unreachable"} auth=${lastAuthStatus || "unreachable"} runtime=${result.runtime}`),
          "startup guard"
        );
        await finish("recovery-shell-ready", { degraded: true, force: true, known: result });
        return;
      }

      if (elapsed >= 16000) {
        // Absolute browser-only fail-safe. This path intentionally does not
        // require window.skytraceNative, IPC, a healthy API, or a known shell.
        reportError(
          "startup-hard-timeout",
          new Error(`shell=${result.shell} runtime=${result.runtime} health=${lastHealthStatus || "unreachable"} auth=${lastAuthStatus || "unreachable"}`),
          "startup guard"
        );
        await finish("hard-timeout-recovery", { degraded: true, force: true, known: result });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, elapsed < 5000 ? 300 : 650));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void run(), { once: true });
  } else {
    void run();
  }
})();
