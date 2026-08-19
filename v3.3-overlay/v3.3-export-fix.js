(() => {
  "use strict";
  const formats = { replayCsv: "csv", replayGeo: "geojson", replayKml: "kml" };
  document.addEventListener("click", async event => {
    const button = event.target.closest?.("#replayCsv,#replayGeo,#replayKml");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const format = formats[button.id];
    const from = new Date(document.getElementById("replayFrom")?.value || "").getTime();
    const to = new Date(document.getElementById("replayTo")?.value || "").getTime();
    const params = new URLSearchParams({ format, limit: "25000" });
    if (Number.isFinite(from)) params.set("from", String(from));
    if (Number.isFinite(to)) params.set("to", String(to));
    const icao = String(document.getElementById("replayIcao")?.value || "").trim();
    if (icao) params.set("icao", icao);
    button.disabled = true;
    try {
      const response = await fetch(`/api/account/history-export?${params}`);
      if (!response.ok) {
        let payload = {}; try { payload = await response.json(); } catch {}
        throw new Error(payload?.error || `Export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `skytrace-history.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const toast = document.getElementById("toast");
      if (toast) { toast.textContent = error.message; toast.classList.remove("hidden"); setTimeout(() => toast.classList.add("hidden"), 5000); }
    } finally { button.disabled = false; }
  }, true);
})();
