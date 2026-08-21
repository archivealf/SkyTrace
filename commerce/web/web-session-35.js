(() => {
  'use strict';

  const SESSION_KEY = 'skytrace.webToken';
  const REMEMBER_KEY = 'skytrace.webToken.remembered.v35';
  const ENABLED_KEY = 'skytrace.rememberLogin.v35';
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;

  if (localStorage.getItem(ENABLED_KEY) == null) originalSet.call(localStorage, ENABLED_KEY, '1');
  const rememberEnabled = () => localStorage.getItem(ENABLED_KEY) !== '0';

  if (!sessionStorage.getItem(SESSION_KEY) && rememberEnabled()) {
    const remembered = localStorage.getItem(REMEMBER_KEY);
    if (remembered) originalSet.call(sessionStorage, SESSION_KEY, remembered);
  }

  Storage.prototype.setItem = function skyTraceSetItem(key, value) {
    originalSet.call(this, key, value);
    if (this === sessionStorage && key === SESSION_KEY && rememberEnabled() && value) {
      originalSet.call(localStorage, REMEMBER_KEY, String(value));
    }
    if (this === localStorage && key === ENABLED_KEY && String(value) === '0') {
      originalRemove.call(localStorage, REMEMBER_KEY);
    }
  };

  Storage.prototype.removeItem = function skyTraceRemoveItem(key) {
    originalRemove.call(this, key);
    if (this === sessionStorage && key === SESSION_KEY) originalRemove.call(localStorage, REMEMBER_KEY);
  };

  window.skytraceRememberLogin = {
    enabled: rememberEnabled,
    setEnabled(value) {
      originalSet.call(localStorage, ENABLED_KEY, value ? '1' : '0');
      if (!value) originalRemove.call(localStorage, REMEMBER_KEY);
      else {
        const token = sessionStorage.getItem(SESSION_KEY);
        if (token) originalSet.call(localStorage, REMEMBER_KEY, token);
      }
    },
    forget() {
      originalRemove.call(localStorage, REMEMBER_KEY);
      originalRemove.call(sessionStorage, SESSION_KEY);
    }
  };
})();
