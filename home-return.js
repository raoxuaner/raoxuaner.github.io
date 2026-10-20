(() => {
  'use strict';
  const logo = document.querySelector('.site-header .wordmark');
  if (!logo) return;
  const hero = document.querySelector('.seona-hero');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timeout = 0;
  let entrance = null;

  function cleanup() {
    window.removeEventListener('scroll', arrive);
    window.clearTimeout(timeout);
    timeout = 0;
  }
  function arrive() {
    if (window.scrollY > 2) return;
    cleanup();
    if (!reduced.matches && hero && hero.animate) {
      if (entrance) entrance.cancel();
      entrance = hero.animate([{ opacity: .78 }, { opacity: 1 }], {
        duration: 550, easing: 'ease-out'
      });
    }
  }
  logo.addEventListener('click', event => {
    // Keep opening the ordinary home link in a new tab/window available.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    cleanup();
    if (entrance) entrance.cancel();
    if (reduced.matches) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      return;
    }
    window.addEventListener('scroll', arrive, { passive: true });
    // Remove the observer if the visitor interrupts the scroll midway.
    timeout = window.setTimeout(cleanup, 3000);
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    arrive();
  });
})();
