(() => {
  "use strict";
  const $ = id => document.getElementById(id);

  function toast(message, ms = 4500) {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add("hidden"), ms);
  }

  function installStyles() {
    if ($("redeemCodeStyles")) return;
    const style = document.createElement("style");
    style.id = "redeemCodeStyles";
    style.textContent = `
      .redeem-card{margin-top:4px}.redeem-row{display:flex;gap:8px;align-items:stretch}.redeem-input{min-width:0;flex:1;border:1px solid #ffffff22;background:#05060999;color:inherit;border-radius:12px;padding:10px 12px;font:600 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;text-transform:uppercase;outline:none}.redeem-input:focus{border-color:#ffffff55}.redeem-button{white-space:nowrap}.redeem-help{display:block;margin-top:8px;color:var(--muted,#9298a6);font-size:11px;line-height:1.4}`;
    document.head.appendChild(style);
  }

  function installRedeemCard() {
    const scroll = document.querySelector("#storeView .store-scroll");
    if (!scroll || $("redeemCode")) return;
    const card = document.createElement("article");
    card.className = "store-card redeem-card";
    card.innerHTML = `
      <div class="store-card-top"><div><span class="store-kicker">REDEEM</span><h3>Have a SkyTrace code?</h3></div></div>
      <p>Redeem a code for a permanent unlock on your signed-in SkyTrace account.</p>
      <div class="redeem-row">
        <input id="redeemCode" class="redeem-input" maxlength="48" autocomplete="off" spellcheck="false" placeholder="SKY-PRO-XXXX-XXXX-XXXX" aria-label="SkyTrace redeem code">
        <button id="redeemCodeBtn" class="store-buy redeem-button">Redeem</button>
      </div>
      <small class="redeem-help" id="redeemCodeMessage">Codes are applied to the account you are currently signed into.</small>`;
    const note = scroll.querySelector(".store-note");
    scroll.insertBefore(card, note || null);

    const input = $("redeemCode");
    const button = $("redeemCodeBtn");
    input?.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/\s+/g, "");
    });
    input?.addEventListener("keydown", event => {
      if (event.key === "Enter") void redeem();
    });
    button?.addEventListener("click", () => void redeem());
  }

  async function redeem() {
    const input = $("redeemCode");
    const button = $("redeemCodeBtn");
    const message = $("redeemCodeMessage");
    const code = String(input?.value || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!code) return toast("Enter a SkyTrace code.");

    button.disabled = true;
    button.textContent = "Redeeming…";
    if (message) message.textContent = "Checking code securely…";
    try {
      const response = await fetch("/api/account/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ code })
      });
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Redeem failed (${response.status}).`);
      const name = payload?.redeemed?.name || "SkyTrace upgrade";
      if (message) message.textContent = `${name} unlocked permanently.`;
      toast(`${name} unlocked.`, 3000);
      input.value = "";
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      if (message) message.textContent = error.message;
      toast(error.message, 5000);
      button.disabled = false;
      button.textContent = "Redeem";
    }
  }

  installStyles();
  installRedeemCard();
  const observer = new MutationObserver(installRedeemCard);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
