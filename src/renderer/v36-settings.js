(() => {
  "use strict";
  const native = window.skytraceNative;
  if (!native?.isMac) return;
  const q = selector => document.querySelector(selector);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[ch]);
  const API = "https://api.github.com/repos/archivealf/SkyTrace/releases/latest";

  function parts(v) { return String(v || "").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map(x => Number(x) || 0); }
  function newer(a, b) { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }

  function addSections() {
    const nav = q(".settings-nav");
    const content = q(".settings-content");
    if (!nav || !content || $("v36UpdatesPane")) return;
    const advanced = nav.querySelector('[data-section="advanced"]');
    const updates = document.createElement("button");
    updates.className = "nav";
    updates.dataset.section = "updates";
    updates.textContent = "Updates";
    nav.insertBefore(updates, advanced || null);
    const shortcuts = document.createElement("button");
    shortcuts.className = "nav";
    shortcuts.dataset.section = "shortcuts";
    shortcuts.textContent = "Keyboard";
    nav.insertBefore(shortcuts, advanced || null);

    const updatePane = document.createElement("section");
    updatePane.id = "v36UpdatesPane";
    updatePane.className = "pane";
    updatePane.dataset.pane = "updates";
    updatePane.innerHTML = `<div class="setting-card vertical"><div><h2>Verified GitHub updates</h2><p>SkyTrace checks the public release feed but keeps installation manual because this build is unsigned. Release pages open externally so you can verify and install deliberately.</p></div><div id="v36UpdateStatus" class="v36-settings-status">Not checked yet.</div><div class="button-row"><button id="v36SettingsCheckUpdate">Check now</button><button id="v36SettingsOpenRelease" disabled>Open release</button></div></div><div class="setting-card vertical"><div><h2>What's New</h2><p>Reopen the Product Preview highlights whenever you want.</p></div><div class="button-row"><button id="v36SettingsWhatsNew">Show What's New</button></div></div>`;
    content.appendChild(updatePane);

    const shortcutPane = document.createElement("section");
    shortcutPane.className = "pane";
    shortcutPane.dataset.pane = "shortcuts";
    shortcutPane.innerHTML = `<div class="setting-card vertical"><div><h2>Keyboard shortcuts</h2><p>Core desktop controls for the map, Timeline and product tools.</p></div><div class="v36-shortcut-grid"><kbd>⌘K</kbd><span>Command Centre 2.0</span><kbd>⌘1…4</kbd><span>Map / Cloud / Ops / Mac</span><kbd>⌘F</kbd><span>Focus search</span><kbd>⌘0</kbd><span>Reset map view</span><kbd>⌘⇧T</kbd><span>SkyTrace Timeline</span><kbd>⌘⇧W</kbd><span>Watchlists</span><kbd>⌘⇧G</kbd><span>Geofences</span><kbd>⌘⇧A</kbd><span>Notification Center</span><kbd>⌘,</kbd><span>Settings</span><kbd>Space</kbd><span>Timeline play / pause</span></div></div>`;
    content.appendChild(shortcutPane);

    for (const button of [updates, shortcuts]) button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach(x => x.classList.toggle("active", x === button));
      document.querySelectorAll(".pane").forEach(x => x.classList.toggle("active", x.dataset.pane === button.dataset.section));
      const title = $("sectionTitle");
      if (title) title.textContent = button.dataset.section === "updates" ? "Updates" : "Keyboard";
    });

    $("v36SettingsCheckUpdate").onclick = check;
    $("v36SettingsWhatsNew").onclick = () => native.focusMain?.("whatsNew");
  }

  async function check() {
    const status = $("v36UpdateStatus"), open = $("v36SettingsOpenRelease");
    if (!status) return;
    status.textContent = "Checking GitHub releases…";
    open.disabled = true;
    try {
      const current = await native.getVersion?.() || "3.5.0";
      const response = await fetch(API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = await response.json();
      const latest = release.tag_name || release.name || current;
      const available = newer(latest, current);
      status.innerHTML = `<strong>${available ? "Update available" : "Up to date"}</strong><span>Installed ${esc(current)} · Latest ${esc(latest)}</span>`;
      if (release.html_url) {
        open.disabled = false;
        open.onclick = () => native.openExternal?.(release.html_url);
      }
    } catch (error) {
      status.textContent = `Update check failed: ${error.message || error}`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addSections, { once: true }); else addSections();
})();
