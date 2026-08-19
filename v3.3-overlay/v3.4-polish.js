(() => {
  "use strict";

  function polishStartup() {
    const loading = document.getElementById("loading") || document.querySelector(".loading");
    if (!loading || loading.dataset.skytracePolished === "true") return;

    loading.dataset.skytracePolished = "true";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.setAttribute("aria-label", "Starting SkyTrace");

    // Keep the first <span> as the live status text: the existing app updates
    // loading.querySelector("span") if aviation data takes unusually long.
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
    });

    document.querySelectorAll(".mode-tab, .detail-tab, .round-button").forEach(button => {
      if (!button.hasAttribute("type")) button.setAttribute("type", "button");
    });
  }

  function boot() {
    polishStartup();
    polishStaticUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
