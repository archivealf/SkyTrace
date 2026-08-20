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

  function showSection(name) {
    document.querySelectorAll(".nav").forEach(node => node.classList.toggle("active", node.dataset.section === name));
    document.querySelectorAll(".pane").forEach(node => node.classList.toggle("active", node.dataset.pane === name));
    $("sectionTitle").textContent = sectionTitles[name] || "Settings";
  }

  function collect() {
    const profile = document.querySelector('input[name="performanceProfile"]:checked')?.value || "balanced";
    return {
      ...(settings || {}),
      menuBar: $("menuBar").checked,
      notifications: $("notifications").checked,
      launchAtLogin: $("launchAtLogin").checked,
      performanceProfile: profile,
      offlineFallback: $("offlineFallback").checked,
      trafficLabelDensity: $("trafficLabelDensity").value,
      reducedMotion: $("reducedMotion").checked,
      localReplay: {
        ...((settings || {}).localReplay || {}),
        enabled: $("replayEnabled").checked,
        retentionHours: Number($("retentionHours").value),
        maxMb: Number($("maxMb").value)
      }
    };
  }

  function render(next) {
    settings = next;
    $("menuBar").checked = next.menuBar !== false;
    $("notifications").checked = next.notifications !== false;
    $("launchAtLogin").checked = Boolean(next.launchAtLogin);
    $("offlineFallback").checked = next.offlineFallback !== false;
    $("trafficLabelDensity").value = next.trafficLabelDensity || "normal";
    $("reducedMotion").checked = Boolean(next.reducedMotion);
    $("replayEnabled").checked = next.localReplay?.enabled !== false;
    $("retentionHours").value = String(next.localReplay?.retentionHours || 168);
    $("maxMb").value = String(next.localReplay?.maxMb || 100);
    const profile = document.querySelector(`input[name="performanceProfile"][value="${CSS.escape(next.performanceProfile || "balanced")}"]`);
    if (profile) profile.checked = true;
  }

  async function save() {
    clearTimeout(saveTimer);
    $("saveStatus").textContent = "Saving…";
    try {
      settings = await native.saveSettings(collect());
      render(settings);
      $("saveStatus").textContent = "Saved automatically";
      updateReplayStats();
    } catch (error) {
      $("saveStatus").textContent = error.message || "Could not save";
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 120);
  }

  async function updateReplayStats() {
    try {
      const stats = await native.localReplay.stats();
      $("replayStats").textContent = `${(Number(stats.bytes || 0) / 1024 / 1024).toFixed(1)} MB used of ${(Number(stats.maxBytes || 0) / 1024 / 1024).toFixed(0)} MB · ${Number(stats.retentionHours || 0)} hour retention`;
    } catch {
      $("replayStats").textContent = "Local replay status unavailable.";
    }
  }

  async function boot() {
    settings = await native.getSettings();
    render(settings);
    updateReplayStats();

    document.querySelectorAll(".nav").forEach(button => button.onclick = () => showSection(button.dataset.section));
    document.querySelectorAll("input,select").forEach(control => control.addEventListener("change", scheduleSave));

    $("testNotification").onclick = () => native.notify({ title: "SkyTrace Test Alert", body: "Native macOS notifications are working.", navigate: { action: "command" } });
    $("pauseAlerts").onclick = async () => {
      const current = await native.getAlertsPaused();
      const next = await native.setAlertsPaused(!current);
      $("pauseAlerts").textContent = next ? "Resume alerts" : "Pause alerts";
    };
    native.getAlertsPaused().then(paused => { $("pauseAlerts").textContent = paused ? "Resume alerts" : "Pause alerts"; }).catch(() => {});
    $("showData").onclick = () => native.showDataFolder();
    $("clearReplay").onclick = async () => {
      if (!confirm("Delete all Private Local Replay observations stored on this Mac?")) return;
      await native.localReplay.clear();
      updateReplayStats();
    };
    $("openConfig").onclick = () => native.openConfig();
    $("showLog").onclick = () => native.showDiagnosticLog();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
