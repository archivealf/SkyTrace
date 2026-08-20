(() => {
  "use strict";
  const native = window.skytraceNative;
  if (!native?.isMac) return;

  let finished = false;
  let lastHealthStatus = 0;

  function reportError(type, error, source = "") {
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
      ".loading",
      ".loading-screen",
      ".startup-screen",
      ".skytrace-startup",
      "[data-loading]"
    ];
    return [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
  }

  function shellLooksReady() {
    return Boolean(
      document.querySelector(".flightdeck-rail") ||
      document.querySelector("#sidebar") ||
      document.querySelector("#map") ||
      document.querySelector(".maplibregl-map")
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
        node.style.setProperty("pointer-events", "none", "important");
        setTimeout(() => node.remove(), 50);
      } catch {}
    }
    document.documentElement.dataset.skytraceStartup = reason;
  }

  function showDegradedBanner() {
    if (document.getElementById("skytraceStartupRecovery")) return;
    const banner = document.createElement("div");
    banner.id = "skytraceStartupRecovery";
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;background:#111722f2;border:1px solid #ffffff24;border-radius:12px;padding:9px 12px;color:#f2f5ff;font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 10px 35px #0008;max-width:min(680px,90vw)";
    banner.textContent = lastHealthStatus
      ? `SkyTrace opened in recovery mode because the local API returned HTTP ${lastHealthStatus}. Reload after the service reconnects.`
      : "SkyTrace opened in recovery mode because the local API did not answer. The interface is available while it reconnects.";
    document.body.appendChild(banner);
  }

  async function markReady(reason, degraded = false) {
    if (finished) return;
    finished = true;
    const shell = shellLooksReady();
    const health = degraded ? false : await healthLooksReady();
    removeStartupOverlays(reason);
    if (degraded) showDegradedBanner();
    try {
      native.reportReady({
        health,
        shell,
        degraded,
        reason,
        url: location.href
      });
    } catch {}
  }

  async function run() {
    const started = Date.now();
    while (!finished) {
      const elapsed = Date.now() - started;
      const shell = shellLooksReady();
      if (shell && elapsed >= 500) {
        const healthy = await healthLooksReady();
        if (healthy) {
          await markReady("health-and-shell-ready", false);
          return;
        }
      }

      if (shell && elapsed >= 12000) {
        reportError("startup-recovery", new Error(`health=${lastHealthStatus || "unreachable"}`), "startup watchdog");
        await markReady("recovery-shell-ready", true);
        return;
      }

      if (elapsed >= 25000) {
        reportError("startup-timeout", new Error(`shell=${shell} health=${lastHealthStatus || "unreachable"}`), "startup watchdog");
        removeStartupOverlays("timeout-recovery");
        showDegradedBanner();
        try {
          native.reportReady({ health: false, shell, degraded: true, reason: "timeout-recovery", url: location.href });
        } catch {}
        finished = true;
        return;
      }

      await new Promise(resolve => setTimeout(resolve, elapsed < 5000 ? 250 : 700));
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
