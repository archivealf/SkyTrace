(() => {
  "use strict";

  const state = {
    lastDataAt: 0,
    trafficCount: 0,
    mapPanel: null,
    statusBar: null,
    macButton: null,
    installedFetchProbe: false
  };

  const q = selector => document.querySelector(selector);
  const qa = selector => [...document.querySelectorAll(selector)];

  function sourceTimestamp(snapshot) {
    const rawSource = Number(snapshot?.sourceTime);
    if (Number.isFinite(rawSource) && rawSource > 0) {
      const milliseconds = rawSource > 10_000_000_000 ? rawSource : rawSource * 1000;
      if (milliseconds > Date.now() - 24 * 3600_000 && milliseconds < Date.now() + 5 * 60_000) return milliseconds;
    }
    const fetched = Number(snapshot?.fetchedAt || snapshot?.cachedAt || 0);
    return Number.isFinite(fetched) && fetched > 0 ? fetched : Date.now();
  }

  function setTrafficLoad(count) {
    state.trafficCount = Number(count || 0);
    const load = state.trafficCount >= 220 ? "dense" : state.trafficCount >= 120 ? "busy" : "normal";
    document.documentElement.dataset.skytraceTrafficLoad = load;
  }

  function captureSnapshot(snapshot) {
    if (!Array.isArray(snapshot?.flights)) return;
    state.lastDataAt = sourceTimestamp(snapshot);
    setTrafficLoad(snapshot.flights.length);
    syncFreshness();
  }

  function installFetchProbe() {
    if (state.installedFetchProbe || window.__skytraceUiFreshnessFetch) return;
    state.installedFetchProbe = true;
    window.__skytraceUiFreshnessFetch = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (/\/api\/flights(?:\?|$)/.test(url) && response.ok) {
        response.clone().json().then(captureSnapshot).catch(() => {});
      }
      return response;
    };
  }

  function replaceText(root, pattern, replacement) {
    if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = String(node.nodeValue || "");
      if (!pattern.test(text)) continue;
      node.nodeValue = text.replace(pattern, replacement);
      return true;
    }
    return false;
  }

  function syncFreshness() {
    if (!state.lastDataAt) return;
    const age = Math.max(0, Math.min(999, Math.floor((Date.now() - state.lastDataAt) / 1000)));
    const live = q(".live-cluster");
    if (live) replaceText(live, /LIVE\s*\d+s?/i, `LIVE ${age}s`);

    const status = state.statusBar || q(".bottom-status");
    if (status) {
      state.statusBar = status;
      const ageCell = [...status.children].find(node => /DATA\s+AGE/i.test(node.textContent || ""));
      if (ageCell) replaceText(ageCell, /\d+s(?:\s+ago)?/i, `${age}s ago`);
    }
  }

  function deactivateMacView() {
    document.documentElement.classList.remove("skytrace-mac-view-active");
    document.body?.classList.remove("skytrace-mac-view-active");
    const view = document.getElementById("macNativeView");
    if (view) {
      view.classList.remove("active");
      view.style.removeProperty("display");
      view.style.removeProperty("flex-direction");
      view.style.removeProperty("min-height");
    }
  }

  function activateMacView(event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const view = document.getElementById("macNativeView");
    const sidebar = document.getElementById("sidebar");
    const button = state.macButton || q('.flightdeck-rail [data-view="mac"]');
    if (!view || !sidebar || !button) return false;

    qa(".mode-tab").forEach(node => node.classList.toggle("active", node === button));
    qa(".side-view").forEach(node => node.classList.toggle("active", node === view));
    button.classList.add("active");
    view.classList.add("active");
    view.hidden = false;
    view.removeAttribute("aria-hidden");
    view.style.setProperty("display", "flex", "important");
    view.style.setProperty("flex-direction", "column", "important");
    view.style.setProperty("min-height", "0", "important");
    sidebar.classList.remove("collapsed");
    document.documentElement.classList.add("skytrace-mac-view-active");
    document.body?.classList.add("skytrace-mac-view-active");
    return true;
  }

  function bindMacButton() {
    const button = q('.flightdeck-rail [data-view="mac"]');
    const view = document.getElementById("macNativeView");
    if (!button || !view) return false;
    if (button.dataset.skytraceUiFixed === "true") return true;
    button.dataset.skytraceUiFixed = "true";
    button.type = "button";
    button.setAttribute("aria-label", "Open Mac tools");
    button.addEventListener("click", activateMacView, { capture: true });
    state.macButton = button;
    return true;
  }

  function monitorViewChanges() {
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest(".mode-tab") : null;
      if (!button || button.dataset.view === "mac") return;
      deactivateMacView();
    }, true);
  }

  function findMapPanel() {
    const candidates = qa("aside,section,div").filter(node => {
      if (node.closest("#sidebar") || node.closest(".flightdeck-rail") || node.closest(".bottom-status")) return false;
      const text = String(node.textContent || "").replace(/\s+/g, " ");
      if (!(text.includes("Aircraft") && text.includes("Airports") && text.includes("Navaids") && text.includes("Precipitation"))) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 140 && rect.width <= 420 && rect.height >= 140 && rect.height <= 760 && rect.right > window.innerWidth * 0.72;
    });
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    });
    return candidates[0] || null;
  }

  function installMapPanelToggle() {
    const panel = state.mapPanel && document.contains(state.mapPanel) ? state.mapPanel : findMapPanel();
    if (!panel) return false;
    state.mapPanel = panel;
    panel.classList.add("skytrace-layer-panel");
    if (panel.querySelector(".skytrace-layer-toggle")) return true;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skytrace-layer-toggle";
    button.setAttribute("aria-label", "Collapse map controls");
    button.textContent = "−";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = panel.classList.toggle("skytrace-collapsed");
      button.textContent = collapsed ? "+" : "−";
      button.setAttribute("aria-label", collapsed ? "Expand map controls" : "Collapse map controls");
    });
    panel.appendChild(button);
    return true;
  }

  function compactStatusBar() {
    const status = q(".bottom-status");
    if (!status) return false;
    state.statusBar = status;
    status.classList.add("skytrace-compact-status");
    return true;
  }

  function boot() {
    installFetchProbe();
    monitorViewChanges();
    compactStatusBar();

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const macReady = bindMacButton();
      const controlsReady = installMapPanelToggle();
      compactStatusBar();
      if ((macReady && controlsReady) || attempts >= 60) clearInterval(timer);
    }, 250);

    setInterval(syncFreshness, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
