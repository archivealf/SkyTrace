(() => {
  "use strict";

  // Startup recovery must work even if Electron's preload bridge fails. Native
  // diagnostics are optional; DOM/API recovery is deliberately browser-only.
  const native = window.skytraceNative || null;
  let finished = false;
  let lastHealthStatus = 0;

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
      document.querySelector(".maplibregl-map") ||
      document.querySelector("main")
    );
  }

  async function healthLooksReady() {
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-SkyTrace-Startup-Probe": "1" }
      });
      lastHealthStatus = response.status;
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      return body?.ok !== false;
    } catch (error) {
      lastHealthStatus = 0;
      reportError("health-probe", error, "/api/health");
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

  function showRecoveryBanner({ shell, health }) {
    if (document.getElementById("skytraceStartupRecovery")) return;
    const banner = document.createElement("div");
    banner.id = "skytraceStartupRecovery";
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#111722f2;border:1px solid #ffffff24;border-radius:12px;padding:10px 12px;color:#f2f5ff;font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 10px 35px #0008;max-width:min(720px,92vw);display:flex;gap:10px;align-items:center";
    const detail = health
      ? "The local service is ready but the normal interface took too long to finish."
      : lastHealthStatus
        ? `The local API returned HTTP ${lastHealthStatus}.`
        : "The local API did not answer yet.";
    banner.innerHTML = `<span>${shell ? "SkyTrace opened in recovery mode." : "SkyTrace startup did not complete."} ${detail}</span><button type="button" style="border:1px solid #ffffff2b;background:#ffffff10;color:#fff;border-radius:8px;padding:6px 9px;cursor:pointer">Reload</button>`;
    banner.querySelector("button")?.addEventListener("click", () => location.reload());
    (document.body || document.documentElement).appendChild(banner);
  }

  function reportReady(payload) {
    if (typeof native?.reportReady !== "function") return;
    try { native.reportReady(payload); } catch {}
  }

  async function finish(reason, { degraded = false, force = false } = {}) {
    if (finished) return;
    const shell = shellLooksReady();
    const health = degraded ? false : await healthLooksReady();
    if (!force && !shell && !health) return;
    finished = true;
    removeStartupOverlays(reason);
    if (degraded || !shell || !health) showRecoveryBanner({ shell, health });
    reportReady({ health, shell, degraded: degraded || !health, reason, url: location.href });
  }

  async function run() {
    const started = Date.now();
    while (!finished) {
      const elapsed = Date.now() - started;
      const shell = shellLooksReady();

      if (elapsed >= 500) {
        const healthy = await healthLooksReady();
        if (healthy && shell) {
          await finish("health-and-shell-ready");
          return;
        }
        if (healthy && elapsed >= 6000) {
          // The backend is definitely alive. Never keep it hidden behind a
          // splash just because one expected shell selector changed.
          await finish("health-ready-shell-late", { force: true });
          return;
        }
      }

      if (shell && elapsed >= 10000) {
        reportError("startup-recovery", new Error(`health=${lastHealthStatus || "unreachable"}`), "startup guard");
        await finish("recovery-shell-ready", { degraded: true, force: true });
        return;
      }

      if (elapsed >= 16000) {
        // Absolute browser-only fail-safe. This path intentionally does not
        // require window.skytraceNative, IPC, a healthy API, or a known shell
        // selector. An infinite loading screen is never an acceptable state.
        reportError("startup-hard-timeout", new Error(`shell=${shell} health=${lastHealthStatus || "unreachable"}`), "startup guard");
        await finish("hard-timeout-recovery", { degraded: true, force: true });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, elapsed < 5000 ? 250 : 600));
    }
  }

  const observer = new MutationObserver(() => {
    if (finished) removeStartupOverlays("post-ready-cleanup");
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void run(), { once: true });
  } else {
    void run();
  }
})();
