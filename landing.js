/* Product screenshots and partner attribution. No example odds or live feed. */
(() => {
  'use strict';
  const ref = new URLSearchParams(location.search).get('ref')?.trim().toUpperCase();
  const validRef = /^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(ref || '');
  function preserveReferral(link) {
    if (!validRef || link.classList.contains('screenshot-link')) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
    url.searchParams.set('ref', ref);
    link.href = url.pathname + url.search + url.hash;
  }
  document.querySelectorAll('a[href]').forEach(preserveReferral);
  if (validRef) {
    const packaged = window.EV_APP_CONFIG?.packaged === true;
    const local = !packaged && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    window.API_BASE = local ? 'http://localhost:5001' : (packaged && window.EV_APP_CONFIG.apiBase || 'https://api-production-3a3b.up.railway.app');
    const script = document.createElement('script');
    script.src = new URL('referrals.js?v=20261013', document.currentScript?.src || location.href).href;
    document.head.append(script);
  }

  const tabs = [...document.querySelectorAll('[data-preview]')];
  function showPreview(selected) {
    tabs.forEach(tab => {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.dataset.preview).hidden = !active;
    });
  }
  tabs.forEach((tab, index) => {
    const panel = document.getElementById(tab.dataset.preview);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => showPreview(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      showPreview(tabs[next]);
      tabs[next].focus();
    });
  });
  if (tabs.length) {
    showPreview(tabs[0]);
    const tabList = document.querySelector('.preview-tabs');
    tabList.setAttribute('role', 'tablist');
    tabList.hidden = false;
  }

  const dialog = document.getElementById('screenshot-dialog');
  let opener = null;
  if (typeof dialog?.showModal === 'function') {
    document.querySelectorAll('.screenshot-link').forEach(link => {
      link.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        opener = link;
        const image = document.getElementById('enlarged-screenshot');
        image.src = link.href;
        image.alt = link.querySelector('img').alt;
        document.getElementById('screenshot-dialog-title').textContent = link.dataset.caption;
        dialog.showModal();
        document.body.classList.add('preview-open');
        dialog.querySelector('.enlarged-scroll').scrollTo(0, 0);
      });
    });
    dialog.querySelector('.close-preview').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('preview-open');
      opener?.focus({ preventScroll: true });
    });
  }
  document.getElementById('copyright-year').textContent = String(new Date().getFullYear());
})();
