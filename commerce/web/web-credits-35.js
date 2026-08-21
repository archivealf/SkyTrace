(() => {
  'use strict';

  const drawer = document.getElementById('drawer');
  if (!drawer) return;

  const BUILD = '35.0.7';

  function creditsMarkup() {
    return `<div class="mobile35-page">
      <div class="mobile35-page-head">
        <div><small>SKYTRACE · CREDITS</small><h2>Credits</h2></div>
        <button type="button" data-credits-back>Back</button>
      </div>
      <div class="mobile35-airport-card">
        <small>CREATOR</small>
        <h3>Alfie Hall</h3>
        <p class="mobile35-copy">Creator of SkyTrace.</p>
      </div>
      <div class="mobile35-airport-card">
        <small>MOTIVATION</small>
        <h3>Mia icantspellyournamesoz</h3>
        <p class="mobile35-copy">Thanks for the motivation behind SkyTrace.</p>
      </div>
      <p class="mobile35-footnote">SkyTrace Mobile ${BUILD}</p>
    </div>`;
  }

  function injectCreditsButton() {
    if (document.documentElement.dataset.mobile35Tab !== 'more') return;
    const menu = drawer.querySelector('.mobile35-menu');
    if (!menu) return;

    const versionLabel = drawer.querySelector('.mobile35-page-head small');
    const expectedLabel = `SKYTRACE iPHONE · ${BUILD}`;
    if (versionLabel && /SKYTRACE iPHONE/i.test(versionLabel.textContent || '') && versionLabel.textContent !== expectedLabel) {
      versionLabel.textContent = expectedLabel;
    }

    if (menu.querySelector('[data-more-credits]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-more-credits', '');
    button.innerHTML = '<span>Credits</span><small>Creator and motivation behind SkyTrace</small>';
    menu.appendChild(button);
  }

  drawer.addEventListener('click', event => {
    if (event.target.closest('[data-more-credits]')) {
      drawer.innerHTML = creditsMarkup();
      drawer.setAttribute('aria-label', 'SkyTrace credits');
      drawer.scrollTop = 0;
      window.skytraceMobileSheet?.expand?.();
      return;
    }

    if (event.target.closest('[data-credits-back]')) {
      document.querySelector('#mobile35Tabs [data-tab="more"]')?.click();
    }
  });

  // Keep the button available when More is re-rendered, but never rewrite an
  // already-correct node. Rewriting textContent from inside this observer used
  // to trigger the observer again forever and freeze WKWebView after tapping More.
  new MutationObserver(injectCreditsButton).observe(drawer, { childList: true, subtree: true });
  injectCreditsButton();
})();
