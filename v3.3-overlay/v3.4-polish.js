(() => {
  "use strict";

  function findStartupRoot() {
    const direct = document.getElementById("loading") || document.querySelector(".loading, .loading-screen, .startup-screen, [data-loading]");
    if (direct) return direct;

    const body = document.body;
    if (!body) return null;

    const phrases = ["connecting to aviation data", "preparing live aviation data", "skytrace"];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = String(node.nodeValue || "").trim().toLowerCase();
      if (!value || !phrases.some(phrase => value.includes(phrase))) continue;

      let element = node.parentElement;
      let best = element;
      while (element && element !== body) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const coversWindow = rect.width >= window.innerWidth * 0.7 && rect.height >= window.innerHeight * 0.7;
        const overlayLike = style.position === "fixed" || style.position === "absolute";
        if (coversWindow && overlayLike) return element;
        if (rect.width > (best?.getBoundingClientRect().width || 0) && rect.height > (best?.getBoundingClientRect().height || 0)) best = element;
        element = element.parentElement;
      }
      if (best && best !== body) return best;
    }
    return null;
  }

  function polishStartup() {
    const loading = findStartupRoot();
    if (!loading) return false;
    if (loading.dataset.skytracePolished === "true") return true;

    loading.dataset.skytracePolished = "true";
    loading.classList.add("skytrace-startup");
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
    return true;
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
    const found = polishStartup();
    polishStaticUi();
    return found;
  }

  // The base bundle's startup element has changed names across builds. Run
  // immediately and retry once at DOMContentLoaded instead of depending on a
  // single historical selector.
  const foundImmediately = boot();
  if (!foundImmediately && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
})();
