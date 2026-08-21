import dns from 'node:dns';

// Oracle/cloud hosts sometimes resolve public aviation endpoints to IPv6 first
// even when the instance has no working IPv6 route. Prefer IPv4 while keeping
// Node's normal fallback behaviour for every other request.
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const originalFetch = globalThis.fetch.bind(globalThis);
const retryHosts = new Set(['api.adsb.lol', 'aviationweather.gov', 'raw.githubusercontent.com']);
const stale = new Map();
const STALE_MS = 90_000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function urlOf(input) {
  try { return new URL(typeof input === 'string' || input instanceof URL ? input : input.url); }
  catch { return null; }
}
function isRetryableStatus(status) { return status === 408 || status === 425 || status === 429 || status >= 500; }
function isAdsbPoint(url) { return url?.hostname === 'api.adsb.lol' && /^\/v2\/(point|lat)\//.test(url.pathname); }
function staleResponse(url) {
  const hit = stale.get(url.href);
  if (!hit || Date.now() - hit.at > STALE_MS) return null;
  return new Response(hit.body.slice(0), { status: 200, headers: hit.headers });
}
function cacheSuccessfulResponse(url, response) {
  if (!isAdsbPoint(url) || !response.ok) return;
  const clone = response.clone();
  clone.arrayBuffer().then(body => {
    stale.set(url.href, {
      at: Date.now(),
      body,
      headers: { 'content-type': clone.headers.get('content-type') || 'application/json' }
    });
  }).catch(() => {});
}

// Retry only idempotent public upstream GETs. App/API requests to the local
// SkyTrace backend are not changed by this wrapper.
globalThis.fetch = async function skyTraceReliableFetch(input, init = {}) {
  const url = urlOf(input);
  const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  if (!url || method !== 'GET' || !retryHosts.has(url.hostname)) return originalFetch(input, init);

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      let options = init;
      if (attempt > 0 && init?.signal?.aborted) options = { ...init, signal: AbortSignal.timeout(10_000) };
      const response = await originalFetch(input, options);
      if (response.ok) {
        cacheSuccessfulResponse(url, response);
        return response;
      }
      if (!isRetryableStatus(response.status) || attempt === 1) return response;
      lastError = new Error(`Upstream returned ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
    }
    await sleep(300 + attempt * 350);
  }

  const cached = staleResponse(url);
  if (cached) return cached;

  const code = lastError?.cause?.code || lastError?.code || lastError?.name || 'network_error';
  console.error(`[SkyTrace Mobile 35] upstream fetch failed for ${url.hostname}: ${code}`);
  throw new Error('Live aircraft provider is temporarily unreachable.');
};
