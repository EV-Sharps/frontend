/* Illustrative homepage demo; only partner-code visits load referral capture. */
(() => {
  'use strict';
  const examples = {
    nhl: { player: 'Auston Matthews', market: 'Anytime goalscorer · Over 0.5 goals', icon: 'hockey', probability: 0.4, odds: [180, 165, 150, 140], route: 'atgs.html', link: 'Open NHL goals' },
    nba: { player: 'Jayson Tatum', market: 'Points · Over 25.5', icon: 'basketball', probability: 0.52, odds: [110, 105, -105, -115], route: 'nba.html', link: 'Open NBA props' },
    nfl: { player: 'Justin Jefferson', market: 'Anytime touchdown · Over 0.5 TDs', icon: 'football', probability: 0.36, odds: [210, 200, 180, 160], route: 'tds.html', link: 'Open NFL touchdowns' },
    mlb: { player: 'Aaron Judge', market: 'Home runs · Over 0.5', icon: 'baseball', probability: 0.25, odds: [350, 330, 300, 280], route: 'dingers.html', link: 'Open MLB home runs' },
  };
  const books = [
    { name: 'FanDuel', logo: 'fd' },
    { name: 'DraftKings', logo: 'dk' },
    { name: 'bet365', logo: 'b365' },
    { name: 'BetMGM', logo: 'mgm' },
  ];
  // Forward partner codes as a fallback, and reuse the existing capture so
  // attribution also survives intermediate pages such as the FAQ.
  const ref = new URLSearchParams(location.search).get('ref')?.trim().toUpperCase();
  const validRef = /^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(ref || '');
  function preserveReferral(link) {
    if (!validRef) return;
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

  function american(odds) {
    const value = Math.round(odds);
    return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
  }
  function showExample(sport) {
    const sample = examples[sport];
    if (!sample) return;
    document.getElementById('demo-player').textContent = sample.player;
    document.getElementById('demo-market').textContent = sample.market;
    document.getElementById('demo-sport-icon').src = `logos/${sample.icon}.png`;
    const fragment = document.createDocumentFragment();
    // Demo odds are deliberately fixed and best-to-worst, never real offers.
    books.forEach((book, index) => {
      const odds = sample.odds[index];
      const decimal = odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
      const ev = (sample.probability * decimal - 1) * 100;
      const row = document.createElement('div');
      row.className = 'demo-quote' + (index === 0 ? ' demo-quote-best' : '');
      const label = document.createElement('span');
      label.className = 'quote-book';
      const image = document.createElement('img');
      image.src = `logos/${book.logo}.png`;
      image.alt = '';
      image.width = image.height = 24;
      label.append(image, document.createTextNode(book.name));
      if (index === 0) {
        const best = document.createElement('span');
        best.className = 'best-tag';
        best.textContent = 'Best';
        label.append(best);
      }
      const price = document.createElement('strong');
      price.textContent = american(odds);
      const edge = document.createElement('span');
      const rounded = Number(ev.toFixed(1));
      edge.className = rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : '';
      edge.textContent = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(1)}%`;
      row.append(label, price, edge);
      fragment.append(row);
    });
    document.getElementById('demo-quotes').replaceChildren(fragment);
    const fair = sample.probability <= 0.5 ? 100 * (1 - sample.probability) / sample.probability : -100 * sample.probability / (1 - sample.probability);
    document.getElementById('demo-fair').textContent = american(fair);
    document.getElementById('demo-probability').textContent = `${(sample.probability * 100).toFixed(1)}%`;
    const link = document.getElementById('demo-open');
    link.href = sample.route;
    link.textContent = sample.link + ' ↗';
    preserveReferral(link);
    document.querySelectorAll('[data-sport]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sport === sport)));
    document.getElementById('demo-explanation').textContent = `${sport.toUpperCase()} example: same player, same prop. A different price changes the edge.`;
  }
  document.querySelectorAll('[data-sport]').forEach(button => button.addEventListener('click', () => showExample(button.dataset.sport)));
  document.querySelector('.sport-switch').hidden = false;
  document.getElementById('copyright-year').textContent = String(new Date().getFullYear());
})();
