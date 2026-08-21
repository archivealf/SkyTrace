(() => {
  'use strict';

  const root = document.documentElement;
  const panel = document.querySelector('.panel');
  const handle = document.getElementById('sheetHandle');
  const header = document.querySelector('.panel-head');
  const productLabel = document.querySelector('.panel-title small');
  if (!panel || !handle) return;

  const isiPad = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || isiPad;
  const isiPhone = isiOS && !isiPad;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const mobile35Build = /^35\./.test(String(document.body?.dataset?.skytraceWebBuild || ''));

  root.classList.toggle('ios-device', isiOS);
  root.classList.toggle('ios-ipad', isiPad);
  root.classList.toggle('ios-iphone', isiPhone);
  root.classList.toggle('standalone-webapp', standalone);

  // Mobile 35 owns its own three-position sheet and visual identity. Keeping the
  // old 34.8 class/gesture system active at the same time caused competing
  // pointer handlers and overlapping sheet states inside the native WKWebView.
  if (!mobile35Build) root.classList.add('skytrace-mobile-34-8');

  if (!mobile35Build && productLabel && isiPhone) productLabel.textContent = 'SKYTRACE iPHONE · V3.4';
  else if (!mobile35Build && productLabel && isiPad) productLabel.textContent = 'SKYTRACE iPAD · V3.4';

  const installHint = document.getElementById('installHint');
  if (installHint) installHint.classList.toggle('hidden', !isiOS || standalone);

  let collapsed = false;
  let dragging = false;
  let dragStartY = 0;
  let dragDistance = 0;
  let startedCollapsed = false;
  let activePointerId = null;
  let activeDragTarget = null;
  let ignoreClickUntil = 0;
  let viewportFrame = 0;
  let panelObserver = null;
  let orientation = window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
  let restingViewportHeight = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || 1));

  const phonePortrait = () => isiPhone && window.matchMedia('(max-width:700px) and (orientation:portrait)').matches;

  function physicalScreenHeight() {
    const width = Number(window.screen?.width) || 0;
    const height = Number(window.screen?.height) || 0;
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    const current = orientation === 'landscape' ? shortSide : longSide;
    return Math.max(1, Math.round(current || window.innerHeight || 1));
  }

  function measurePanel() {
    const rect = panel.getBoundingClientRect();
    root.style.setProperty('--skytrace-panel-height', `${Math.max(0, Math.ceil(rect.height))}px`);
  }

  function editingControl() {
    const active = document.activeElement;
    return Boolean(active && (active.matches?.('input,textarea,select') || active.isContentEditable));
  }

  function updateViewport() {
    const vv = window.visualViewport;
    const height = Math.max(1, Math.round(vv?.height || window.innerHeight || 1));
    const top = Math.max(0, Math.round(vv?.offsetTop || 0));
    const nextOrientation = window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';

    if (nextOrientation !== orientation) {
      orientation = nextOrientation;
      restingViewportHeight = height;
    }

    const editing = editingControl();
    const keyboardOpen = isiOS && editing && (restingViewportHeight - height) > 90;
    if (!editing) restingViewportHeight = Math.max(restingViewportHeight, height);
    else if (!keyboardOpen && height > restingViewportHeight) restingViewportHeight = height;

    const screenHeight = Math.max(physicalScreenHeight(), Math.round(window.innerHeight || 0), Math.round(document.documentElement.clientHeight || 0));
    root.style.setProperty('--skytrace-screen-h', `${screenHeight}px`);
    root.style.setProperty('--skytrace-vvh', `${height}px`);
    root.style.setProperty('--skytrace-vv-top', `${top}px`);
    root.classList.toggle('ios-keyboard-open', keyboardOpen);

    if (!mobile35Build && keyboardOpen && collapsed) setCollapsed(false);

    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      measurePanel();
      window.skytraceResizeMap?.();
    });
  }

  function setCollapsed(next, announce = false) {
    // Mobile 35 must never receive the legacy sheet-collapsed class. Its own
    // sheet35-peek/half/full state is managed in web-mobile-35.js.
    if (mobile35Build) {
      collapsed = false;
      panel.classList.remove('sheet-collapsed', 'sheet-dragging');
      root.classList.remove('sheet-collapsed');
      panel.style.removeProperty('--skytrace-sheet-drag');
      return;
    }

    const allowed = phonePortrait() && !root.classList.contains('ios-keyboard-open');
    collapsed = allowed ? Boolean(next) : false;
    panel.classList.toggle('sheet-collapsed', collapsed);
    root.classList.toggle('sheet-collapsed', collapsed);
    handle.setAttribute('aria-expanded', String(!collapsed));
    handle.setAttribute('aria-label', collapsed ? 'Expand controls' : 'Minimise controls');
    panel.setAttribute('aria-expanded', String(!collapsed));
    panel.style.removeProperty('--skytrace-sheet-drag');

    requestAnimationFrame(() => {
      measurePanel();
      setTimeout(() => {
        measurePanel();
        window.skytraceResizeMap?.();
      }, 280);
    });

    if (announce) {
      const status = document.getElementById('status');
      if (status) status.title = collapsed
        ? 'Controls minimised — swipe up or tap the card to expand'
        : status.textContent || 'Controls expanded';
    }
  }

  function beginDrag(event) {
    if (mobile35Build || !phonePortrait() || root.classList.contains('ios-keyboard-open')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    dragStartY = event.clientY;
    dragDistance = 0;
    startedCollapsed = collapsed;
    activePointerId = event.pointerId;
    activeDragTarget = event.currentTarget;
    panel.classList.add('sheet-dragging');
    try { activeDragTarget.setPointerCapture(event.pointerId); } catch {}
  }

  function moveDrag(event) {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragDistance = event.clientY - dragStartY;
    const translated = startedCollapsed
      ? Math.max(-130, Math.min(22, dragDistance))
      : Math.max(-14, Math.min(230, dragDistance));
    panel.style.setProperty('--skytrace-sheet-drag', `${translated}px`);
    if (Math.abs(dragDistance) > 3) event.preventDefault();
  }

  function endDrag(event) {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    panel.classList.remove('sheet-dragging');
    panel.style.removeProperty('--skytrace-sheet-drag');
    try { activeDragTarget?.releasePointerCapture(event.pointerId); } catch {}
    activePointerId = null;
    activeDragTarget = null;

    if (Math.abs(dragDistance) > 8) ignoreClickUntil = Date.now() + 350;
    if (!startedCollapsed && dragDistance > 58) setCollapsed(true, true);
    else if (startedCollapsed && dragDistance < -30) setCollapsed(false, true);
    else setCollapsed(startedCollapsed);
  }

  if (!mobile35Build) {
    for (const target of [handle, header].filter(Boolean)) {
      target.addEventListener('pointerdown', beginDrag);
      target.addEventListener('pointermove', moveDrag, { passive: false });
      target.addEventListener('pointerup', endDrag);
      target.addEventListener('pointercancel', endDrag);
    }

    handle.addEventListener('click', event => {
      if (!phonePortrait()) return;
      if (Date.now() < ignoreClickUntil) {
        event.preventDefault();
        return;
      }
      setCollapsed(!collapsed, true);
    });

    panel.addEventListener('click', event => {
      if (!collapsed || !phonePortrait() || Date.now() < ignoreClickUntil) return;
      if (event.target.closest?.('#sheetHandle')) return;
      setCollapsed(false, true);
    });

    handle.addEventListener('keydown', event => {
      if (!phonePortrait()) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCollapsed(true, true);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCollapsed(false, true);
      }
    });
  }

  function reconcile() {
    if (!mobile35Build && (!phonePortrait() || root.classList.contains('ios-keyboard-open'))) setCollapsed(false);
    updateViewport();
    setTimeout(() => window.skytraceResizeMap?.(), 160);
  }

  if ('ResizeObserver' in window) {
    panelObserver = new ResizeObserver(measurePanel);
    panelObserver.observe(panel);
  }

  window.visualViewport?.addEventListener('resize', updateViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', updateViewport, { passive: true });
  window.addEventListener('resize', reconcile, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(reconcile, 120), { passive: true });
  document.addEventListener('focusin', () => { if (isiOS) setTimeout(updateViewport, 60); });
  document.addEventListener('focusout', () => { if (isiOS) setTimeout(updateViewport, 160); });
  window.addEventListener('pageshow', () => setTimeout(reconcile, 30));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(registration => registration.update().catch(() => {}))
      .catch(() => {});
  }

  // This temporary API is replaced by Mobile 35 a few milliseconds later. In a
  // 35.x build it only supplies viewport refresh until that replacement occurs.
  window.skytraceMobileSheet = {
    expand: () => { if (!mobile35Build) setCollapsed(false); },
    collapse: () => { if (!mobile35Build) setCollapsed(true); },
    isCollapsed: () => mobile35Build ? false : collapsed,
    refresh: () => {
      if (!mobile35Build && !phonePortrait()) setCollapsed(false);
      updateViewport();
    }
  };

  setCollapsed(false);
  updateViewport();
  setTimeout(() => {
    measurePanel();
    window.skytraceResizeMap?.();
  }, 80);
})();
