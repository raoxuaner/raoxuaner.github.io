/* A deterrent for ordinary saving; public image URLs are not access control. */
(() => {
  'use strict';
  const selectors = ['.design-project-cover img', '.project-thumb', '.project-gallery img'];
  if (/\/projects\/[^/]+\/?$/.test(window.location.pathname)) selectors.push('main img');

  document.querySelectorAll(selectors.join(',')).forEach((image) => {
    image.draggable = false;
    if (image.closest('[data-project-image-guard]')) return;
    let surface = image.parentElement;
    if (surface.tagName !== 'A' || surface.children.length !== 1) {
      surface = document.createElement('span');
      image.before(surface);
      surface.append(image);
    }
    surface.setAttribute('data-project-image-guard', '');
    surface.setAttribute('draggable', 'false');
  });

  const blockImageAction = (event) => {
    if (event.target instanceof Element && event.target.closest('[data-project-image-guard]')) {
      event.preventDefault();
    }
  };
  document.addEventListener('contextmenu', blockImageAction, true);
  document.addEventListener('dragstart', blockImageAction, true);
})();
