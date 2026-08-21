(() => {
  'use strict';

  if (typeof refresh === 'undefined' || typeof flights === 'undefined' || typeof drawFlights === 'undefined') return;

  const CACHE_KEY = 'skytrace.mobile35.lastFlights';
  const FAILURE_RE = /fetch failed|provider is temporarily unreachable|upstream|timed out|network/i;

  function restoreLastGood() {
    if (flights.length) return false;
    const status = document.getElementById('status');
    const message = String(status?.textContent || status?.title || '');
    if (!FAILURE_RE.test(message)) return false;

    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const age = Date.now() - Number(cached?.at || 0);
      if (!Array.isArray(cached?.flights) || !cached.flights.length || age > 6 * 3600_000) return false;

      flights = cached.flights;
      flightByIcao = new Map(flights.map(flight => [String(flight?.icao24 || '').toLowerCase(), flight]));
      render();
      drawFlights();

      if (status) {
        status.textContent = 'Cached traffic';
        status.title = `Live provider unavailable — showing traffic saved ${new Date(cached.at).toLocaleTimeString()}`;
      }
      const meta = document.getElementById('trafficMeta');
      if (meta) meta.textContent = `Last good ${new Date(cached.at).toLocaleTimeString()}`;
      const visible = document.getElementById('visible');
      if (visible) visible.textContent = String(flights.length);
      return true;
    } catch {
      return false;
    }
  }

  const previousRefresh = refresh;
  refresh = async function skyTraceRefreshWithLiveRecovery(...args) {
    const result = await previousRefresh(...args);
    restoreLastGood();
    return result;
  };

  const observer = new MutationObserver(() => restoreLastGood());
  const status = document.getElementById('status');
  if (status) observer.observe(status, { childList: true, subtree: true, characterData: true });

  window.addEventListener('pageshow', () => setTimeout(restoreLastGood, 120));
  window.addEventListener('online', () => setTimeout(() => refresh(), 100));
  setTimeout(restoreLastGood, 900);
})();
