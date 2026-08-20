(() => {
  const root = document.documentElement;
  const panel = document.querySelector(".panel");
  const handle = document.getElementById("sheetHandle");
  const header = document.querySelector(".panel-head");
  const productLabel = document.querySelector(".panel-title small");

  if (!panel || !handle) return;

  const isiPad = /iPad/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || isiPad;
  const isiPhone = isiOS && !isiPad;
  const phonePortrait = () => isiPhone && window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches;

  if (productLabel && isiPhone) productLabel.textContent = "SKYTRACE iPHONE · V3.4";
  else if (productLabel && isiPad) productLabel.textContent = "SKYTRACE iPAD · V3.4";

  root.classList.add("skytrace-mobile-34-6");

  let collapsed = false;
  let dragging = false;
  let dragStartY = 0;
  let dragDistance = 0;
  let startedCollapsed = false;
  let activeTarget = null;
  let ignoreClickUntil = 0;

  function measurePanel() {
    const rect = panel.getBoundingClientRect();
    root.style.setProperty("--skytrace-panel-height", `${Math.max(0, Math.ceil(rect.height))}px`);
  }

  function setCollapsed(next, announce = false) {
    const allowed = phonePortrait() && !root.classList.contains("ios-keyboard-open");
    collapsed = allowed ? Boolean(next) : false;
    panel.classList.toggle("sheet-collapsed", collapsed);
    root.classList.toggle("sheet-collapsed", collapsed);
    handle.setAttribute("aria-expanded", String(!collapsed));
    handle.setAttribute("aria-label", collapsed ? "Expand controls" : "Minimise controls");
    panel.setAttribute("aria-expanded", String(!collapsed));
    panel.style.removeProperty("--skytrace-sheet-drag");
    requestAnimationFrame(() => {
      measurePanel();
      requestAnimationFrame(measurePanel);
    });
    if (announce) {
      const status = document.getElementById("status");
      if (status) status.title = collapsed ? "Controls minimised — swipe up or tap the card to expand" : status.textContent || "Controls expanded";
    }
  }

  function beginDrag(event) {
    if (!phonePortrait() || root.classList.contains("ios-keyboard-open")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging = true;
    dragStartY = event.clientY;
    dragDistance = 0;
    startedCollapsed = collapsed;
    activeTarget = event.currentTarget;
    panel.classList.add("sheet-dragging");
    try { activeTarget.setPointerCapture(event.pointerId); } catch {}
  }

  function moveDrag(event) {
    if (!dragging) return;
    dragDistance = event.clientY - dragStartY;
    const translated = startedCollapsed
      ? Math.max(-110, Math.min(24, dragDistance))
      : Math.max(-14, Math.min(190, dragDistance));
    panel.style.setProperty("--skytrace-sheet-drag", `${translated}px`);
    if (Math.abs(dragDistance) > 3) event.preventDefault();
  }

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("sheet-dragging");
    panel.style.removeProperty("--skytrace-sheet-drag");
    try { activeTarget?.releasePointerCapture(event.pointerId); } catch {}
    activeTarget = null;

    if (Math.abs(dragDistance) > 8) ignoreClickUntil = Date.now() + 350;

    if (!startedCollapsed && dragDistance > 54) setCollapsed(true, true);
    else if (startedCollapsed && dragDistance < -30) setCollapsed(false, true);
    else setCollapsed(startedCollapsed);
  }

  for (const target of [handle, header].filter(Boolean)) {
    target.addEventListener("pointerdown", beginDrag);
    target.addEventListener("pointermove", moveDrag, { passive: false });
    target.addEventListener("pointerup", endDrag);
    target.addEventListener("pointercancel", endDrag);
  }

  handle.addEventListener("click", event => {
    if (Date.now() < ignoreClickUntil) {
      event.preventDefault();
      return;
    }
    if (!phonePortrait()) return;
    setCollapsed(!collapsed, true);
  });

  panel.addEventListener("click", event => {
    if (!collapsed || Date.now() < ignoreClickUntil || !phonePortrait()) return;
    if (event.target.closest?.("#sheetHandle")) return;
    setCollapsed(false, true);
  });

  handle.addEventListener("keydown", event => {
    if (!phonePortrait()) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCollapsed(true, true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCollapsed(false, true);
    }
  });

  function reconcileLayout() {
    if (!phonePortrait() || root.classList.contains("ios-keyboard-open")) setCollapsed(false);
    else measurePanel();
  }

  window.addEventListener("resize", reconcileLayout, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(reconcileLayout, 120), { passive: true });
  window.visualViewport?.addEventListener("resize", () => setTimeout(reconcileLayout, 30), { passive: true });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(registration => registration.update().catch(() => {})).catch(() => {});
  }

  setCollapsed(false);
})();
