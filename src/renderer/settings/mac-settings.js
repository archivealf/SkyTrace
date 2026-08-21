(() => {
  "use strict";
  const native = window.skytraceNative;
  if (!native?.isMac) return;
  const $ = id => document.getElementById(id);
  let settings = null;
  let saveTimer = null;

  const sectionTitles = {
    general: "General",
    map: "Map & Traffic",
    alerts: "Alerts",
    performance: "Performance",
    replay: "Private Local Replay",
    advanced: "Advanced"
  };

  function setStatus(text) {
    if ($("saveStatus")) $("saveStatus").textContent = text;
  }

  function showSection(name) {
    document.querySelectorAll(".nav").forEach(node => node.classList.toggle("active", node.dataset.section === name));
    document.querySelectorAll(".pane").forEach(node => node.classList.toggle("active", node.dataset.pane === name));
    if ($("sectionTitle")) $("sectionTitle").textContent = sectionTitles[name] || "Settings";
  }

  function collect() {
    const profile = document.querySelector('input[name="performanceProfile"]:checked')?.value || "balanced";
    return {
      ...(settings || {}),
      menuBar: Boolean($("menuBar")?.checked),
      notifications: Boolean($("notifications")?.checked),
      performanceProfile: profile,
      offlineFallback: $("offlineFallback")?.checked !== false,
      trafficLabelDensity: $("trafficLabelDensity")?.value || "normal",
      reducedMotion: Boolean($("reducedMotion")?.checked),
      localReplay: {
        ...((settings || {}).localReplay || {}),
        enabled: $("replayEnabled")?.checked !== false,
        retentionHours: Number($("retentionHours")?.value || 168),
        maxMb: Number($("maxMb")?.value || 100)
      }
    };
  }

  function render(next) {
    settings = next || {};
    if ($("menuBar")) $("menuBar").checked = settings.menuBar !== false;
    if ($("notifications")) $("notifications").checked = settings.notifications !== false;
    if ($("offlineFallback")) $("offlineFallback").checked = settings.offlineFallback !== false;
    if ($("trafficLabelDensity")) $("trafficLabelDensity").value = settings.trafficLabelDensity || "normal";
    if ($("reducedMotion")) $("reducedMotion").checked = Boolean(settings.reducedMotion);
    if ($("replayEnabled")) $("replayEnabled").checked = settings.localReplay?.enabled !== false;
    if ($("retentionHours")) $("retentionHours").value = String(settings.localReplay?.retentionHours || 168);
    if ($("maxMb")) $("maxMb").value = String(settings.localReplay?.maxMb || 100);
    const profile = document.querySelector(`input[name="performanceProfile"][value="${CSS.escape(settings.performanceProfile || "balanced")}"]`);
    if (profile) profile.checked = true;
  }

  async function save() {
    clearTimeout(saveTimer);
    setStatus("Saving…");
    try {
      settings = await native.saveSettings(collect());
      render(settings);
      setStatus("Saved automatically");
      void updateReplayStats();
    } catch (error) {
      setStatus(error?.message || "Could not save settings");
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), 120);
  }

  async function updateReplayStats() {
    try {
      const stats = await native.localReplay.stats();
      if ($("replayStats")) $("replayStats").textContent = `${(Number(stats.bytes || 0) / 1024 / 1024).toFixed(1)} MB used of ${(Number(stats.maxBytes || 0) / 1024 / 1024).toFixed(0)} MB · ${Number(stats.retentionHours || 0)} hour retention`;
    } catch {
      if ($("replayStats")) $("replayStats").textContent = "Local replay status unavailable.";
    }
  }

  function bind() {
    document.querySelectorAll(".nav").forEach(button => button.onclick = () => showSection(button.dataset.section));
    document.querySelectorAll("input,select").forEach(control => control.addEventListener("change", scheduleSave));

    if ($("testNotification")) $("testNotification").onclick = async () => {
      try { await native.notify({ title: "SkyTrace Test Alert", body: "Native macOS notifications are working.", navigate: { action: "command" } }); }
      catch (error) { setStatus(error?.message || "Could not send test notification"); }
    };
    if ($("pauseAlerts")) $("pauseAlerts").onclick = async () => {
      try {
        const current = await native.getAlertsPaused();
        const next = await native.setAlertsPaused(!current);
        $("pauseAlerts").textContent = next ? "Resume alerts" : "Pause alerts";
      } catch (error) { setStatus(error?.message || "Could not change alert state"); }
    };
    native.getAlertsPaused().then(paused => { if ($("pauseAlerts")) $("pauseAlerts").textContent = paused ? "Resume alerts" : "Pause alerts"; }).catch(() => {});
    if ($("showData")) $("showData").onclick = () => native.showDataFolder().catch?.(() => {});
    if ($("clearReplay")) $("clearReplay").onclick = async () => {
      if (!confirm("Delete all Private Local Replay observations stored on this Mac?")) return;
      try { await native.localReplay.clear(); await updateReplayStats(); setStatus("Private Local Replay cleared"); }
      catch (error) { setStatus(error?.message || "Could not clear Local Replay"); }
    };
    if ($("openConfig")) $("openConfig").onclick = () => native.openConfig().catch?.(() => {});
    if ($("showLog")) $("showLog").onclick = () => native.showDiagnosticLog().catch?.(() => {});
  }

  async function boot() {
    bind();
    try {
      const loaded = await native.getSettings();
      render(loaded);
      setStatus("Saved automatically");
      await updateReplayStats();
    } catch (error) {
      render({
        menuBar: true,
        notifications: true,
        performanceProfile: "balanced",
        offlineFallback: true,
        trafficLabelDensity: "normal",
        reducedMotion: false,
        localReplay: { enabled: true, retentionHours: 168, maxMb: 100 }
      });
      setStatus(`Settings service unavailable: ${error?.message || "unknown error"}`);
    }
  }

  window.addEventListener("unhandledrejection", event => {
    setStatus(`Settings error: ${event.reason?.message || String(event.reason || "unknown")}`);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  else void boot();
})();
