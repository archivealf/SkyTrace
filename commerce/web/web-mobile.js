(() => {
  "use strict";

  const root = document.documentElement;
  const panel = document.querySelector(".panel");
  const handle = document.getElementById("sheetHandle");
  const productLabel = document.querySelector(".panel-title small");
  if (!panel || !handle) return;

  const isiPad = /iPad/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || isiPad;
  const isiPhone = isiOS && !isiPad;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  root.classList.toggle("ios-device", isiOS);
  root.classList.toggle("ios-ipad", isiPad);
  root.classList.toggle("ios-iphone", isiPhone);
  root.classList.toggle("standalone-webapp", standalone);
  root.classList.add("skytrace-mobile-34-7");

  if (productLabel && isiPhone) productLabel.textContent = "SKYTRACE iPHONE · V3.4";
  else if (productLabel && isiPad) productLabel.textContent = "SKYTRACE iPAD · V3.4";

  const installHint = document.getElementById("installHint");
  if (installHint) installHint.classList.toggle("hidden", !isiOS || standalone);

  let collapsed = false;
  let dragging = false;
  let dragStartY = 0;
  let dragDistance = 0;
  let startedCollapsed = false;
  let activePointerId = null;
  let ignoreClickUntil = 0;
  let viewportFrame = 0;
  let panelObserver = null;
  let orientation = window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";
  let restingViewportHeight = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || 1));

  const phonePortrait = () => isiPhone && window.matchMedia("(max-width:700px) and (orientation:portrait)").matches;

  function measurePanel() {
    const rect = panel.getBoundingClientRect();
    root.style.setProperty("--skytrace-panel-height", `${Math.max(0, Math.ceil(rect.height))}px`);
  }

  function editingControl() {
    const active = document.activeElement;
    return Boolean(active && (active.matches?.("input,textarea,select") || active.isContentEditable));
  }

  function updateViewport() {
    const vv = window.visualViewport;
    const height = Math.max(1, Math.round(vv?.height || window.innerHeight || 1));
    const top = Math.max(0, Math.round(vv?.offsetTop || 0));
    const nextOrientation = window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";

    if (nextOrientation !== orientation) {
      orientation = nextOrientation;
      restingViewportHeight = height;
    }

    const editing = editingControl();
    const keyboardOpen = isiOS && editing && (restingViewportHeight - height) > 90;
    if (!editing) restingViewportHeight = Math.max(restingViewportHeight, height);
    else if (!keyboardOpen && height > restingViewportHeight) restingViewportHeight = height;

    root.style.setProperty("--skytrace-vvh", `${height}px`);
    root.style.setProperty("--skytrace-vv-top", `${top}px`);
    root.classList.toggle("ios-keyboard-open", keyboardOpen);

    if (keyboardOpen && collapsed) setCollapsed(false);

    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      measurePanel();
      window.skytraceResizeMap?.();
    });
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
      setTimeout(measurePanel, 280);
    });

    if (announce) {
      const status = document.getElementById("status");
      if (status) {
        status.title = collapsed
          ? "Controls minimised — swipe up or tap the card to expand"
          : status.textContent || "Controls expanded";
      }
    }
  }

  function beginDrag(event) {
    if (!phonePortrait() || root.classList.contains("ios-keyboard-open")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging = true;
    dragStartY = event.clientY;
    dragDistance = 0;
    startedCollapsed = collapsed;
    activePointerId = event.pointerId;
    panel.classList.add("sheet-dragging");
    try { handle.setPointerCapture(event.pointerId); } catch {}
  }

  function moveDrag(event) {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragDistance = event.clientY - dragStartY;
    const translated = startedCollapsed
      ? Math.max(-120, Math.min(22, dragDistance))
      : Math.max(-14, Math.min(220, dragDistance));
    panel.style.setProperty("--skytrace-sheet-drag", `${translated}px`);
    if (Math.abs(dragDistance) > 3) event.preventDefault();
  }

  function endDrag(event) {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    panel.classList.remove("sheet-dragging");
    panel.style.removeProperty("--skytrace-sheet-drag");
    try { handle.releasePointerCapture(event.pointerId); } catch {}
    activePointerId = null;

    if (Math.abs(dragDistance) > 8) ignoreClickUntil = Date.now() + 350;
    if (!startedCollapsed && dragDistance > 58) setCollapsed(true, true);
    else if (startedCollapsed && dragDistance < -30) setCollapsed(false, true);
    else setCollapsed(startedCollapsed);
  }

  handle.addEventListener("pointerdown", beginDrag);
  handle.addEventListener("pointermove", moveDrag, { passive: false });
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  handle.addEventListener("click", event => {
    if (!phonePortrait()) return;
    if (Date.now() < ignoreClickUntil) {
      event.preventDefault();
      return;
    }
    setCollapsed(!collapsed, true);
  });

  panel.addEventListener("click", event => {
    if (!collapsed || !phonePortrait() || Date.now() < ignoreClickUntil) return;
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

  function reconcile() {
    if (!phonePortrait() || root.classList.contains("ios-keyboard-open")) setCollapsed(false);
    updateViewport();
    setTimeout(() => window.skytraceResizeMap?.(), 160);
  }

  if ("ResizeObserver" in window) {
    panelObserver = new ResizeObserver(measurePanel);
    panelObserver.observe(panel);
  }

  window.visualViewport?.addEventListener("resize", updateViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateViewport, { passive: true });
  window.addEventListener("resize", reconcile, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(reconcile, 120), { passive: true });
  document.addEventListener("focusin", () => { if (isiOS) setTimeout(updateViewport, 60); });
  document.addEventListener("focusout", () => { if (isiOS) setTimeout(updateViewport, 160); });
  window.addEventListener("pageshow", () => setTimeout(reconcile, 30));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then(registration => registration.update().catch(() => {}))
      .catch(() => {});
  }

  window.skytraceMobileSheet = {
    expand: () => setCollapsed(false),
    collapse: () => setCollapsed(true),
    isCollapsed: () => collapsed,
    refresh: () => {
      if (!phonePortrait()) setCollapsed(false);
      else measurePanel();
    }
  };

  setCollapsed(false);
  updateViewport();
  setTimeout(() => {
    measurePanel();
    window.skytraceResizeMap?.();
  }, 80);
})();
