(() => {
  "use strict";

  function ensureStartupRootStyles() {
    if (document.getElementById("skytraceStartupRootStyles")) return;
    const style = document.createElement("style");
    style.id = "skytraceStartupRootStyles";
    style.textContent = `
      .skytrace-startup{
        position:fixed!important;inset:0!important;z-index:10000!important;
        display:grid!important;place-items:center!important;overflow:hidden!important;
        background:radial-gradient(circle at 50% 38%,rgba(88,111,201,.13),transparent 32%),radial-gradient(circle at 28% 76%,rgba(58,116,112,.07),transparent 29%),linear-gradient(180deg,#080a0f 0%,#05070b 64%,#040509 100%)!important;
        opacity:1!important;visibility:visible!important;
        transition:opacity .42s ease,visibility .42s ease!important;
      }
      .skytrace-startup::before{
        content:"";position:absolute;inset:-30%;pointer-events:none;
        background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);
        background-size:42px 42px;
        mask-image:radial-gradient(circle at center,#000 0%,transparent 61%);
        -webkit-mask-image:radial-gradient(circle at center,#000 0%,transparent 61%);
        transform:perspective(700px) rotateX(64deg) translateY(15%);transform-origin:center;
      }
      .skytrace-startup.done,
      .skytrace-startup.hidden,
      .skytrace-startup[hidden],
      .skytrace-startup[aria-hidden="true"],
      .skytrace-startup[data-loading="false"]{
        opacity:0!important;visibility:hidden!important;pointer-events:none!important;display:none!important
      }
      .skytrace-startup.done .startup-progress i{animation:none!important;width:100%!important;transform:none!important;background:#9fb1ff!important}
      .performance-mode .skytrace-startup{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      @media(prefers-reduced-transparency:reduce){.skytrace-startup{background:#07090d!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findStartupRoot() {
    const direct = document.getElementById("loading") || document.querySelector(".loading, .loading-screen, .startup-screen, [data-loading]");
    if (direct) return direct;

    const body = document.body;
    if (!body) return null;

    const phrases = ["connecting to aviation data", "preparing live aviation data"];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = String(node.nodeValue || "").trim().toLowerCase();
      if (!value || !phrases.some(phrase => value.includes(phrase))) continue;

      let element = node.parentElement;
      let best = element;
      let bestArea = 0;
      while (element && element !== body) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        if (area > bestArea) { bestArea = area; best = element; }
        const coversWindow = rect.width >= window.innerWidth * 0.7 && rect.height >= window.innerHeight * 0.7;
        const overlayLike = style.position === "fixed" || style.position === "absolute";
        if (coversWindow && overlayLike) return element;
        element = element.parentElement;
      }
      if (best && best !== body) return best;
    }
    return null;
  }

  function finishStartup(reason = "ready") {
    const loading = findStartupRoot();
    if (!loading) return false;
    if (loading.dataset.skytraceFinished === "true") return true;
    loading.dataset.skytraceFinished = "true";
    loading.dataset.skytraceFinishReason = reason;
    loading.classList.add("done");
    loading.setAttribute("aria-hidden", "true");
    loading.setAttribute("data-loading", "false");
    setTimeout(() => {
      try { loading.remove(); } catch {}
    }, 520);
    return true;
  }

  function shellLooksReady() {
    return Boolean(
      document.querySelector(".flightdeck-rail") ||
      document.querySelector("#sidebar") ||
      document.querySelector(".maplibregl-map") ||
      document.querySelector("#map")
    );
  }

  async function apiLooksReady() {
    try {
      const response = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null);
      return payload?.ok !== false;
    } catch {
      return false;
    }
  }

  function startStartupWatchdog() {
    if (window.__skytraceStartupWatchdogInstalled) return;
    window.__skytraceStartupWatchdogInstalled = true;
    const started = Date.now();
    let checking = false;

    const tick = async () => {
      const loading = findStartupRoot();
      if (!loading || loading.dataset.skytraceFinished === "true") return;

      const hiddenByLegacyRuntime =
        loading.hidden ||
        loading.classList.contains("hidden") ||
        loading.getAttribute("aria-hidden") === "true" ||
        loading.getAttribute("data-loading") === "false";
      if (hiddenByLegacyRuntime) return void finishStartup("legacy-runtime");

      const elapsed = Date.now() - started;
      if (!checking && shellLooksReady() && elapsed >= 900) {
        checking = true;
        const apiReady = await apiLooksReady();
        checking = false;
        if (apiReady) return void finishStartup("health-and-shell-ready");
      }

      const status = loading.querySelector(".startup-status");
      if (status && elapsed > 12000) status.textContent = "SkyTrace is taking longer than expected…";
      if (status && elapsed > 22000) status.textContent = "Checking local aviation service…";

      setTimeout(tick, elapsed < 6000 ? 250 : 700);
    };

    setTimeout(tick, 300);
    window.addEventListener("load", () => setTimeout(tick, 100), { once: true });
  }

  function polishStartup() {
    const loading = findStartupRoot();
    if (!loading) return false;
    if (loading.dataset.skytracePolished === "true") {
      startStartupWatchdog();
      return true;
    }

    ensureStartupRootStyles();
    loading.dataset.skytracePolished = "true";
    loading.classList.add("skytrace-startup");
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.setAttribute("aria-label", "Starting SkyTrace");

    loading.innerHTML = `
      <div class="startup-shell">
        <span class="startup-status">Preparing live aviation data…</span>
        <div class="startup-logo" aria-hidden="true"><img src="/assets/SkyTrace.png" alt=""></div>
        <div class="startup-eyebrow">LIVE AVIATION INTELLIGENCE</div>
        <h1 class="startup-title">SkyTrace</h1>
        <div class="startup-version">V3.4.0 RC1</div>
        <div class="startup-progress" aria-hidden="true"><i></i></div>
        <div class="startup-caption">Map · Traffic · Weather · Operations</div>
      </div>`;
    startStartupWatchdog();
    return true;
  }

  function polishDetailPanels() {
    document.querySelectorAll(".flight-card").forEach(panel => {
      panel.classList.add("skytrace-aircraft-detail");
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "Aircraft details");
    });
    document.querySelectorAll(".airport-panel").forEach(panel => {
      panel.classList.add("skytrace-airport-detail");
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "Airport details");
    });
    document.querySelectorAll(".metadata-empty").forEach(empty => empty.classList.add("skytrace-empty-state"));
    document.querySelectorAll(".airport-traffic-row").forEach(row => {
      if (!row.hasAttribute("type")) row.setAttribute("type", "button");
      if (!row.getAttribute("aria-label")) {
        const label = String(row.textContent || "").replace(/\s+/g, " ").trim();
        if (label) row.setAttribute("aria-label", `Open aircraft ${label}`);
      }
    });
  }

  let detailPolishScheduled = false;
  function scheduleDetailPolish() {
    if (detailPolishScheduled) return;
    detailPolishScheduled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        detailPolishScheduled = false;
        polishDetailPanels();
      });
    });
  }

  function polishStaticUi() {
    document.documentElement.classList.add("skytrace-polished");

    const search = document.querySelector('.command-search input[type="search"], .command-search input');
    if (search) {
      search.setAttribute("spellcheck", "false");
      if (!search.getAttribute("aria-label")) search.setAttribute("aria-label", "Search flights, aircraft and airports");
    }

    document.querySelectorAll(".detail-close").forEach(button => {
      if (!button.getAttribute("title")) button.setAttribute("title", "Close");
      if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", "Close details");
    });

    document.querySelectorAll(".mode-tab, .detail-tab, .round-button").forEach(button => {
      if (!button.hasAttribute("type")) button.setAttribute("type", "button");
    });
    polishDetailPanels();
  }

  function boot() {
    const found = polishStartup();
    polishStaticUi();
    startStartupWatchdog();
    return found;
  }

  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest(".aircraft-row,.airport-row,.airport-traffic-row,.detail-tab,.mode-tab")) {
      scheduleDetailPolish();
    }
  }, true);
  document.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.closest(".aircraft-row,.airport-row")) {
      scheduleDetailPolish();
    }
  }, true);

  const foundImmediately = boot();
  if (!foundImmediately && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
})();