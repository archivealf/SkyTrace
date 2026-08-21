(() => {
  'use strict';

  if (typeof refresh === 'undefined' || typeof flights === 'undefined' || typeof drawFlights === 'undefined') return;

  const CACHE_KEY = 'skytrace.mobile35.lastFlights';
  const FAILURE_RE = /fetch failed|provider is temporarily unreachable|upstream|timed out|network|refresh failed/i;
  const EMPTY_HOLD_LIMIT = 2;
  let consecutiveEmpty = 0;
  let lastGoodFlights = Array.isArray(flights) && flights.length ? flights.slice() : [];

  function applyFlights(nextFlights) {
    flights = nextFlights.slice();
    flightByIcao = new Map(flights.map(flight => [String(flight?.icao24 || '').toLowerCase(), flight]));
    render();
    drawFlights();
    const visible = document.getElementById('visible');
    if (visible) visible.textContent = String(flights.length);
  }

  function cachedFlights() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const age = Date.now() - Number(cached?.at || 0);
      if (!Array.isArray(cached?.flights) || !cached.flights.length || age > 6 * 3600_000) return null;
      return { flights: cached.flights, at: Number(cached.at || 0) };
    } catch {
      return null;
    }
  }

  function restoreFailureSnapshot() {
    if (flights.length) return false;
    const status = document.getElementById('status');
    const message = `${status?.textContent || ''} ${status?.title || ''}`;
    if (!FAILURE_RE.test(message)) return false;

    const cached = cachedFlights();
    const replacement = lastGoodFlights.length ? { flights: lastGoodFlights, at: Date.now() } : cached;
    if (!replacement?.flights?.length) return false;

    applyFlights(replacement.flights);
    if (status) {
      status.textContent = 'Holding traffic';
      status.title = 'Live refresh failed — keeping the last known aircraft on the map';
    }
    const meta = document.getElementById('trafficMeta');
    if (meta) meta.textContent = cached?.at ? `Last good ${new Date(cached.at).toLocaleTimeString()}` : 'Keeping last live snapshot';
    return true;
  }

  const previousRefresh = refresh;
  refresh = async function skyTraceRefreshWithLiveRecovery(...args) {
    const before = Array.isArray(flights) ? flights.slice() : [];
    if (before.length) lastGoodFlights = before.slice();

    const result = await previousRefresh(...args);
    const status = document.getElementById('status');
    const statusMessage = `${status?.textContent || ''} ${status?.title || ''}`;
    const failed = FAILURE_RE.test(statusMessage);

    if (flights.length) {
      consecutiveEmpty = 0;
      lastGoodFlights = flights.slice();
      return result;
    }

    if (failed) {
      restoreFailureSnapshot();
      return result;
    }

    // Some ADS-B upstream responses occasionally contain a valid but empty
    // snapshot between populated refreshes. Do not wipe every aircraft from
    // the map on a single 12-second refresh. Require three consecutive empty
    // successful snapshots before accepting that the current map area is empty.
    if (before.length) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty <= EMPTY_HOLD_LIMIT) {
        applyFlights(before);
        if (status) {
          status.textContent = 'Updating…';
          status.title = `Empty live snapshot ${consecutiveEmpty}/${EMPTY_HOLD_LIMIT + 1}; keeping previous aircraft until confirmed`;
        }
        const meta = document.getElementById('trafficMeta');
        if (meta) meta.textContent = 'Confirming live traffic…';
        return result;
      }
    }

    consecutiveEmpty = Math.min(consecutiveEmpty + 1, EMPTY_HOLD_LIMIT + 1);
    return result;
  };

  const observer = new MutationObserver(() => restoreFailureSnapshot());
  const status = document.getElementById('status');
  if (status) observer.observe(status, { childList: true, subtree: true, characterData: true });

  window.addEventListener('pageshow', () => setTimeout(restoreFailureSnapshot, 120));
  window.addEventListener('online', () => setTimeout(() => refresh(), 100));
  setTimeout(restoreFailureSnapshot, 900);
})();
