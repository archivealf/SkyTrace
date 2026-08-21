(() => {
  'use strict';

  const SESSION_KEY = 'skytrace.webToken';
  const ENABLED_KEY = 'skytrace.rememberLogin.v35';
  const SENTINEL = '__skytrace_cookie_session__';

  // Remove the early Mobile 35 prototype that persisted the bearer token in
  // localStorage. Persistent auth is now held only in the server-issued
  // HttpOnly cookie; JavaScript stores a non-secret boot sentinel.
  try { localStorage.removeItem('skytrace.webToken.remembered.v35'); } catch {}

  if (localStorage.getItem(ENABLED_KEY) == null) localStorage.setItem(ENABLED_KEY, '1');
  const rememberEnabled = () => localStorage.getItem(ENABLED_KEY) !== '0';

  if (!sessionStorage.getItem(SESSION_KEY) && rememberEnabled()) {
    sessionStorage.setItem(SESSION_KEY, SENTINEL);
  }

  window.skytraceRememberLogin = {
    enabled: rememberEnabled,
    setEnabled(value) {
      localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
      if (value && !sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, SENTINEL);
      if (!value && sessionStorage.getItem(SESSION_KEY) === SENTINEL) sessionStorage.removeItem(SESSION_KEY);
    },
    async forget() {
      try { await fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }); } catch {}
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.setItem(ENABLED_KEY, '0');
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    const logout = document.getElementById('logoutBtn');
    logout?.addEventListener('click', () => {
      fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
    }, { capture: true });
  });
})();
