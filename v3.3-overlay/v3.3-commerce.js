(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const ENTITLEMENT_LABELS = {
    pro: "SkyTrace Pro",
    airport_intelligence: "Airport Intelligence",
    advanced_aircraft: "Advanced Aircraft",
    replay_plus: "Replay+",
    themes: "Themes"
  };
  const account = { authenticated:false, user:null, entitlements:[], effectiveEntitlements:[] };
  let otpChallengeId = null;
  let purchasePollTimer = null;

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  async function jsonFetch(url, options) {
    const response = await fetch(url, options);
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  }
  function showToast(message, ms = 4200) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), ms);
  }
  function hasEntitlement(key) {
    return Boolean(account.effectiveEntitlements.includes(key) || account.effectiveEntitlements.includes("pro"));
  }

  function ensureUi() {
    const live = document.querySelector(".live-cluster");
    if (live && !$("accountBtn")) {
      const button = document.createElement("button");
      button.id = "accountBtn";
      button.className = "account-pill";
      button.setAttribute("aria-label", "SkyTrace account");
      button.innerHTML = '<span class="account-dot"></span><b id="accountBtnLabel">Sign in</b>';
      live.insertBefore(button, $("refreshBtn") || null);
    }

    const rail = document.querySelector(".flightdeck-rail");
    if (rail && !rail.querySelector('[data-view="store"]')) {
      const button = document.createElement("button");
      button.className = "mode-tab commerce-mode-tab";
      button.dataset.view = "store";
      button.innerHTML = "<span>◇</span><b>Store</b>";
      rail.insertBefore(button, $("statsBtn") || null);
    }

    const sidebar = $("sidebar");
    if (sidebar && !$("storeView")) {
      const section = document.createElement("section");
      section.className = "side-view";
      section.id = "storeView";
      section.innerHTML = `
        <div class="sidebar-head store-head"><div><div class="eyebrow">SKYTRACE STORE</div><h1>Unlock more</h1></div><span class="store-account" id="storeAccountLabel">Sign in to purchase</span></div>
        <div class="store-scroll scroll-list">
          <article class="store-card store-card-pro" data-product-card="pro"><div class="store-card-top"><div><span class="store-kicker">COMPLETE EXPERIENCE</span><h3>SkyTrace Pro</h3></div><strong>£7.99</strong></div><p>One permanent unlock for every current premium feature.</p><div class="store-features"><span>Airport Intelligence</span><span>Advanced Aircraft</span><span>Replay+</span><span>Themes</span></div><button class="store-buy" data-product="pro">Upgrade to Pro</button></article>
          <article class="store-card" data-product-card="airport_intelligence"><div class="store-card-top"><div><span class="store-kicker">AIRPORTS</span><h3>Airport Intelligence</h3></div><strong>£1.99</strong></div><p>Observed traffic analytics and advanced airport intelligence.</p><button class="store-buy" data-product="airport_intelligence">Unlock permanently</button></article>
          <article class="store-card" data-product-card="advanced_aircraft"><div class="store-card-top"><div><span class="store-kicker">AIRCRAFT</span><h3>Advanced Aircraft</h3></div><strong>£1.99</strong></div><p>Enhanced telemetry timeline, analytics and aircraft detail tools.</p><button class="store-buy" data-product="advanced_aircraft">Unlock permanently</button></article>
          <article class="store-card" data-product-card="replay_plus"><div class="store-card-top"><div><span class="store-kicker">REPLAY</span><h3>Replay+</h3></div><strong>£1.99</strong></div><p>Advanced playback controls and longer locally recorded history.</p><button class="store-buy" data-product="replay_plus">Unlock permanently</button></article>
          <article class="store-card" data-product-card="themes"><div class="store-card-top"><div><span class="store-kicker">CUSTOMISE</span><h3>Themes</h3></div><strong>£0.99</strong></div><p>Premium map and interface appearance controls.</p><button class="store-buy" data-product="themes">Unlock permanently</button></article>
          <p class="store-note">One-time purchases. Sign in with your email to restore purchases on another Mac.</p>
        </div>`;
      const footer = sidebar.querySelector("footer.source-row");
      sidebar.insertBefore(section, footer || null);
    }

    if (!$("accountPanel")) {
      const section = document.createElement("section");
      section.className = "account-modal flightdeck-sheet hidden";
      section.id = "accountPanel";
      section.setAttribute("aria-modal", "true");
      section.setAttribute("role", "dialog");
      section.setAttribute("aria-labelledby", "accountTitle");
      section.innerHTML = `
        <button class="detail-close" id="accountClose" aria-label="Close">×</button>
        <div class="account-hero"><div class="account-mark">◇</div><div><div class="eyebrow">SKYTRACE ACCOUNT</div><h2 id="accountTitle">Sign in</h2><p id="accountSubtitle">Use your email to sync permanent purchases across Macs.</p></div></div>
        <div id="accountSignedOut"><label class="account-field"><span>Email address</span><input id="accountEmail" type="email" autocomplete="email" placeholder="you@example.com"></label><div class="account-code-row hidden" id="accountCodeRow"><label class="account-field"><span>Six-digit code</span><input id="accountCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></label></div><button class="account-primary" id="accountSubmit">Send sign-in code</button><p class="account-fine" id="accountMessage">No password. We send a short-lived code to your email.</p></div>
        <div class="hidden" id="accountSignedIn"><div class="account-profile"><span class="account-avatar">◇</span><div><strong id="accountEmailLabel">—</strong><small>SkyTrace account</small></div></div><div class="account-entitlements" id="accountEntitlements"></div><button class="account-secondary" id="accountOpenStore">Open SkyTrace Store</button><button class="account-logout" id="accountLogout">Sign out</button></div>`;
      const toast = $("toast");
      toast?.parentElement?.insertBefore(section, toast);
    }

    const weather = document.querySelector(".aviation-weather-grid");
    if (weather && !$("sigmetSummary")) {
      const grid = document.createElement("div");
      grid.className = "advisory-grid";
      grid.innerHTML = '<div class="advisory-card"><span>SIGMET</span><strong id="sigmetSummary">Loading…</strong><div class="advisory-list" id="sigmetList"></div></div><div class="advisory-card"><span>PILOT REPORTS</span><strong id="pirepSummary">Loading…</strong><div class="advisory-list" id="pirepList"></div></div>';
      weather.insertAdjacentElement("afterend", grid);
    }

    const timeline = document.querySelector('.detail-tab[data-detail="timeline"]');
    const track = document.querySelector('.detail-tab[data-detail="track"]');
    timeline?.setAttribute("data-premium", "advanced_aircraft");
    track?.setAttribute("data-premium", "replay_plus");
    $("loadTrackBtn")?.setAttribute("data-premium", "replay_plus");
    $("loadOpsBtn")?.setAttribute("data-premium", "airport_intelligence");
    $("themeBtn")?.setAttribute("data-premium", "themes");
    for (const node of [timeline, track, $("loadTrackBtn"), $("loadOpsBtn")]) {
      if (node && !node.querySelector(".premium-tag")) node.insertAdjacentHTML("beforeend", ' <i class="premium-tag">PRO</i>');
    }

    const appVersion = document.querySelector(".bottom-status>div:last-child strong");
    if (appVersion) appVersion.textContent = "V3.3";
    window.SKYTRACE_BUILD = "3.3.0-commerce-glass";
  }

  function switchStore(open = true) {
    if (!open) return;
    document.querySelectorAll(".mode-tab").forEach(button => button.classList.toggle("active", button.dataset.view === "store"));
    document.querySelectorAll(".side-view").forEach(view => view.classList.toggle("active", view.id === "storeView"));
    $("sidebar")?.classList.remove("collapsed");
    renderStore();
  }
  function openAccount() {
    $("accountPanel")?.classList.remove("hidden");
    renderAccount();
    if (!account.authenticated) setTimeout(() => $("accountEmail")?.focus(), 70);
  }
  function closeAccount() { $("accountPanel")?.classList.add("hidden"); }

  function renderPremiumState() {
    document.querySelectorAll("[data-premium]").forEach(node => {
      const unlocked = hasEntitlement(node.dataset.premium);
      node.classList.toggle("premium-unlocked", unlocked);
      node.classList.toggle("premium-locked", !unlocked);
    });
    const theme = $("themeBtn");
    if (theme && !hasEntitlement("themes")) theme.querySelector("b").textContent = "PRO";
    const ops = $("loadOpsBtn");
    if (ops && !hasEntitlement("airport_intelligence")) ops.firstChild.textContent = "Unlock Airport Intelligence ";
  }
  function renderStore() {
    const label = $("storeAccountLabel");
    if (label) label.textContent = account.authenticated ? (account.user?.email || "Signed in") : "Sign in to purchase";
    document.querySelectorAll(".store-buy[data-product]").forEach(button => {
      const key = button.dataset.product;
      const owned = hasEntitlement(key);
      button.disabled = owned;
      button.classList.toggle("owned", owned);
      button.textContent = owned ? "Unlocked" : key === "pro" ? "Upgrade to Pro" : "Unlock permanently";
    });
  }
  function renderAccount() {
    const signedIn = account.authenticated;
    $("accountBtn")?.classList.toggle("signed-in", signedIn);
    if ($("accountBtnLabel")) $("accountBtnLabel").textContent = signedIn ? (account.user?.email?.split("@")[0] || "Account") : "Sign in";
    $("accountSignedOut")?.classList.toggle("hidden", signedIn);
    $("accountSignedIn")?.classList.toggle("hidden", !signedIn);
    if (signedIn) {
      $("accountEmailLabel").textContent = account.user?.email || "SkyTrace account";
      $("accountTitle").textContent = "Your SkyTrace account";
      $("accountSubtitle").textContent = "Purchases are synced to this email and can be restored on another Mac.";
      const owned = account.entitlements || [];
      $("accountEntitlements").innerHTML = owned.length ? owned.map(key => `<span>${escapeHtml(ENTITLEMENT_LABELS[key] || key)}</span>`).join("") : "<span>Free plan</span>";
    } else {
      $("accountTitle").textContent = "Sign in";
      $("accountSubtitle").textContent = "Use your email to sync permanent purchases across Macs.";
    }
    renderPremiumState();
    renderStore();
  }

  async function loadAccount({ silent = true } = {}) {
    try {
      const payload = await jsonFetch("/api/account/me");
      account.authenticated = Boolean(payload.authenticated);
      account.user = payload.user || null;
      account.entitlements = payload.entitlements || [];
      account.effectiveEntitlements = payload.effectiveEntitlements || [];
    } catch (error) {
      if (!silent) showToast(error.message, 5000);
    }
    renderAccount();
    return account;
  }

  async function submitAccount() {
    const email = $("accountEmail")?.value.trim() || "";
    if (!email) return showToast("Enter your email address.");
    const submit = $("accountSubmit");
    submit.disabled = true;
    try {
      if (!otpChallengeId) {
        const payload = await jsonFetch("/api/account/request-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ email }) });
        otpChallengeId = payload.challengeId;
        $("accountCodeRow").classList.remove("hidden");
        submit.textContent = "Verify code";
        $("accountMessage").textContent = `Code sent to ${email}. It expires in ${Math.round((payload.expiresIn || 600) / 60)} minutes.`;
        if (payload.devCode) { $("accountCode").value = payload.devCode; $("accountMessage").textContent = "Development OTP loaded automatically."; }
        setTimeout(() => $("accountCode")?.focus(), 70);
      } else {
        const code = $("accountCode")?.value.trim() || "";
        if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from your email.");
        const payload = await jsonFetch("/api/account/verify-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ email, code, challengeId:otpChallengeId }) });
        account.authenticated = true;
        account.user = payload.user || null;
        account.entitlements = payload.entitlements || [];
        account.effectiveEntitlements = payload.effectiveEntitlements || [];
        otpChallengeId = null;
        $("accountCode").value = "";
        $("accountCodeRow").classList.add("hidden");
        submit.textContent = "Send sign-in code";
        renderAccount();
        showToast("Signed in to SkyTrace.");
      }
    } catch (error) {
      $("accountMessage").textContent = error.message;
      showToast(error.message, 5000);
    } finally { submit.disabled = false; }
  }
  async function logoutAccount() {
    try { await jsonFetch("/api/account/logout", { method:"POST" }); } catch {}
    account.authenticated = false; account.user = null; account.entitlements = []; account.effectiveEntitlements = []; otpChallengeId = null;
    renderAccount(); showToast("Signed out.");
  }
  function startPurchasePolling() {
    clearInterval(purchasePollTimer);
    let attempts = 0;
    purchasePollTimer = setInterval(async () => {
      attempts++;
      const before = account.effectiveEntitlements.join("|");
      await loadAccount();
      const after = account.effectiveEntitlements.join("|");
      if (before !== after) { clearInterval(purchasePollTimer); purchasePollTimer = null; showToast("Purchase unlocked. Welcome to your new SkyTrace features.", 5000); }
      else if (attempts >= 30) { clearInterval(purchasePollTimer); purchasePollTimer = null; }
    }, 4000);
  }
  async function purchaseProduct(productKey) {
    if (!account.authenticated) { openAccount(); return showToast("Sign in before purchasing so SkyTrace can restore your unlocks.", 5000); }
    const button = document.querySelector(`.store-buy[data-product="${productKey}"]`);
    if (button) { button.disabled = true; button.textContent = "Opening checkout…"; }
    try {
      const payload = await jsonFetch("/api/account/checkout", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ productKey }) });
      if (!payload.checkoutUrl) throw new Error("Checkout URL was not returned.");
      window.open(payload.checkoutUrl, "_blank", "noopener");
      showToast("Secure Stripe Checkout opened in your browser. SkyTrace will unlock automatically after payment.", 6000);
      startPurchasePolling();
    } catch (error) { showToast(error.message, 5500); }
    finally { renderStore(); }
  }

  function bindEvents() {
    $("accountBtn")?.addEventListener("click", openAccount);
    $("accountClose")?.addEventListener("click", closeAccount);
    $("accountSubmit")?.addEventListener("click", submitAccount);
    $("accountLogout")?.addEventListener("click", logoutAccount);
    $("accountOpenStore")?.addEventListener("click", () => { closeAccount(); switchStore(); });
    $("accountCode")?.addEventListener("keydown", event => { if (event.key === "Enter") submitAccount(); });
    $("accountEmail")?.addEventListener("keydown", event => { if (event.key === "Enter") submitAccount(); });
    $("accountEmail")?.addEventListener("input", () => {
      if (!otpChallengeId) return;
      otpChallengeId = null;
      $("accountCodeRow").classList.add("hidden");
      $("accountCode").value = "";
      $("accountSubmit").textContent = "Send sign-in code";
      $("accountMessage").textContent = "Email changed. Request a new sign-in code.";
    });
    document.querySelector('.commerce-mode-tab')?.addEventListener("click", () => switchStore());
    document.querySelectorAll(".store-buy[data-product]").forEach(button => button.addEventListener("click", () => purchaseProduct(button.dataset.product)));

    document.addEventListener("click", event => {
      const premium = event.target.closest?.("[data-premium]");
      if (!premium || hasEntitlement(premium.dataset.premium)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switchStore();
      showToast(`${ENTITLEMENT_LABELS[premium.dataset.premium] || "This feature"} is a permanent SkyTrace upgrade.`, 4500);
    }, true);
  }

  ensureUi();
  bindEvents();
  renderAccount();
  void loadAccount();
})();
