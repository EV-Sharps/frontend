(function (root) {
  'use strict';

  const MAX_AGE_MS = 15 * 60 * 1000;
  const MIN_SIGNAL_STAKE_USD = 100;
  const EXCHANGES = new Set(['nv', 'novig', 'kal', 'kalshi', 'poly', 'polymarket', 'px', 'prophetx', 'matchbook', 'mb', 'bf', 'betfair']);
  const BOOK_NAMES = {fd: 'FanDuel', dk: 'DraftKings', b365: 'bet365', mgm: 'BetMGM', cz: 'Caesars', fn: 'Fanatics', pn: 'Pinnacle', circa: 'Circa', br: 'BetRivers', hr: 'Hard Rock', espn: 'ESPN BET', bol: 'BetOnline', bv: 'Bovada', fl: 'Fliff', re: 'Rebet'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const dollars = value => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(value);
  const percent = value => `${(value * 100).toFixed(2)}%`;
  const american = value => {
    if (!Number.isFinite(value)) return '—';
    const magnitude = Math.round(Math.abs(value));
    return `${value >= 0 || magnitude === 100 ? '+' : '-'}${magnitude}`;
  };
  const sideName = side => side === 'under' ? 'No goal' : 'Goal';
  const outcomeName = side => side === 'under' ? 'No' : 'Yes';
  const opposite = side => side === 'under' ? 'over' : 'under';

  // Decimal fractions keep the price comparison exact; never compare rounded odds.
  function fraction(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    if (text.length > 90 || !/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
    const negative = text.startsWith('-');
    const parts = text.replace(/^[+-]/, '').split('.');
    return {n: BigInt(parts[0] + (parts[1] || '')) * (negative ? -1n : 1n), d: 10n ** BigInt((parts[1] || '').length)};
  }

  function impliedFraction(value) {
    const price = fraction(value);
    if (!price || (price.n < 0n ? -price.n : price.n) < 100n * price.d) return null;
    const absolute = price.n < 0n ? -price.n : price.n;
    return {n: price.n > 0n ? 100n * price.d : absolute, d: absolute + 100n * price.d};
  }

  function complementProbability(value) {
    const p = fraction(value);
    if (!p || p.n <= 0n || p.n >= p.d) return null;
    const places = p.d.toString().length - 1;
    const digits = (p.d - p.n).toString().padStart(places + 1, '0');
    return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/0+$/, '').replace(/\.$/, '');
  }

  function americanFromFraction(p) {
    if (!p || p.n <= 0n || p.n >= p.d) return NaN;
    const positive = p.n * 2n <= p.d;
    const numerator = 100n * (positive ? p.d - p.n : p.n);
    const denominator = positive ? p.n : p.d - p.n;
    const magnitude = (2n * numerator + denominator) / (2n * denominator);
    return Number(magnitude) * (positive || magnitude === 100n ? 1 : -1);
  }

  const americanFromProbability = value => americanFromFraction(fraction(value));

  // Exact decimal sums avoid rounding a real $90 down to $89 after a complement.
  function stakeFraction(orders, other = false) {
    let n = 0n, d = 1n;
    for (const order of orders) {
      const p = fraction(order.probability);
      if (!p) continue;
      if (p.d > d) { n *= p.d / d; d = p.d; }
      n += (other ? p.d - p.n : p.n) * BigInt(order.contracts) * (d / p.d);
    }
    return {n, d: d * 100n};
  }

  function wholeStake(orders, other = false) {
    const amount = stakeFraction(orders, other);
    const whole = amount.n / amount.d;
    if (whole === 0n && amount.n > 0n) return '<$1';
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(Number(whole));
  }

  function takingOrders(raw) {
    return normalizeOrders(raw).map(order => {
      const probability = complementProbability(order.probability);
      const p = fraction(probability);
      const value = Number(p.n) / Number(p.d);
      return {probability, p: value, contracts: order.contracts, payout_usd: order.payout_usd,
        stake_usd: value * order.payout_usd, odds: americanFromFraction(p)};
    }).sort((a, b) => {
      const x = fraction(a.probability), y = fraction(b.probability);
      const delta = x.n * y.d - y.n * x.d;
      return delta < 0n ? -1 : delta > 0n ? 1 : 0;
    });
  }

  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return NaN;
    return Date.parse(value);
  }

  function easternDate(milliseconds) {
    if (!Number.isFinite(milliseconds)) return '';
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(milliseconds));
    const get = type => parts.find(part => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function safeLink(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function normalizeOrders(raw) {
    if (!Array.isArray(raw) || raw.length > 20) return [];
    const orders = [];
    for (const order of raw) {
      if (!order || typeof order !== 'object') return [];
      const probability = fraction(order.probability);
      const contracts = typeof order.contracts === 'number' ? order.contracts : Number(order.contracts);
      if (!probability || probability.n <= 0n || probability.n >= probability.d || !Number.isSafeInteger(contracts) || contracts <= 0 || typeof order.contracts === 'boolean') return [];
      const p = Number(probability.n) / Number(probability.d);
      if (!Number.isFinite(p) || p <= 0 || p >= 1) return [];
      const payout = contracts / 100;
      orders.push({probability: String(order.probability), p, contracts, payout_usd: payout, stake_usd: p * payout, opposite_stake_usd: (1 - p) * payout, odds: americanFromFraction(probability), opposite_odds: americanFromProbability(complementProbability(order.probability))});
    }
    return orders.sort((a, b) => b.p - a.p);
  }

  function bestBook(row, updated, side, now) {
    let best = null;
    for (const [book, prices] of Object.entries(row.bookOdds || {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (EXCHANGES.has(book.toLowerCase()) || (book === 'circa' && row.circa_blurred) || (typeof prices !== 'string' && typeof prices !== 'number')) continue;
      const observed = timestamp(updated?.[book]);
      if (!Number.isFinite(observed) || observed > now || now - observed > MAX_AGE_MS) continue;
      const price = String(prices).split('/')[side === 'under' ? 1 : 0];
      const implied = impliedFraction(price);
      if (!implied) continue;
      if (!best || implied.n * best.implied.d < best.implied.n * implied.d) {
        best = {book, name: BOOK_NAMES[book] || book.toUpperCase(), odds: Number(price), implied, probability: Number(implied.n) / Number(implied.d), updated: updated[book], link: row.links?.[book]};
      }
    }
    return best;
  }

  function compareOrders(orders, quote, threshold = MIN_SIGNAL_STAKE_USD) {
    const implied = quote ? impliedFraction(quote.odds) : null;
    const matching = orders.filter(order => {
      const p = fraction(order.probability);
      return implied && p && p.n * implied.d > implied.n * p.d;
    });
    const contracts = matching.reduce((sum, order) => sum + order.contracts, 0);
    const makerStake = matching.reduce((sum, order) => sum + order.stake_usd, 0);
    const oppositeStake = matching.reduce((sum, order) => sum + order.opposite_stake_usd, 0);
    const weightedProbability = contracts ? matching.reduce((sum, order) => sum + order.p * order.contracts, 0) / contracts : null;
    const exactStake = stakeFraction(matching), exactThreshold = fraction(threshold);
    const weightedOdds = contracts ? americanFromFraction({n: exactStake.n * 100n, d: exactStake.d * BigInt(contracts)}) : null;
    const substantial = matching.length > 0 && exactThreshold && exactStake.n * exactThreshold.d >= exactThreshold.n * exactStake.d;
    return {matching, contracts, makerStake, oppositeStake, weightedProbability, weightedOdds, substantial: Boolean(substantial), threshold};
  }

  function inspect(row, payload, options = {}) {
    const now = options.now ?? Date.now();
    const side = options.side === 'under' || options.side === 'over' ? options.side : row?.under ? 'under' : 'over';
    const unavailable = reason => ({available: false, reason, side});
    if (!row || row.blurred || row.prop !== 'atgs' || !['0.5', .5].includes(row.handicap) || !row.game || !row.player) return unavailable('Depth is unavailable for this selection.');
    const entry = payload?.novigDepth?.[row.game]?.[row.player];
    if (!entry || entry.schema_version !== 1 || typeof entry.market_id !== 'string' || !entry.market_id || !Array.isArray(entry.sides)) return unavailable('No current Novig resting orders.');
    const observed = timestamp(entry.updated), expires = timestamp(entry.expires_at), starts = timestamp(entry.starts_at);
    if (![now, observed, expires, starts].every(Number.isFinite) || observed > now || observed >= starts || expires <= observed || expires > starts || now - observed > MAX_AGE_MS || expires <= now || starts <= now) return unavailable('Novig depth expired or the game has started. Refresh for current data.');
    const date = row.dt || row.date;
    if (!date || date !== easternDate(starts) || (row.dt && row.date && row.dt !== row.date)) return unavailable('Depth does not match this game date.');
    const feedStart = payload?.times?.[row.game];
    if (feedStart !== undefined) {
      const expected = timestamp(feedStart);
      if (!Number.isFinite(expected) || expected <= now || easternDate(expected) !== date || Math.abs(expected - starts) > 20 * 60 * 1000) return unavailable('Depth does not match this game start.');
    }
    if (entry.sides.length !== 2 || new Set(entry.sides.map(item => item?.side)).size !== 2 || !entry.sides.every(item => ['over', 'under'].includes(item?.side))) return unavailable('No valid Novig depth for this market.');
    const selected = entry.sides.find(item => item.side === side);
    const opposed = entry.sides.find(item => item.side === opposite(side));
    const orders = normalizeOrders(selected?.orders);
    const anyOrders = entry.sides.some(item => normalizeOrders(item.orders).length > 0);
    if (!anyOrders) return unavailable('No current Novig resting orders.');
    const quote = bestBook(row, options.updated || payload.updated, side, now);
    const availableBooks = ['over', 'under'].map(outcome => {
      const source = entry.sides.find(item => item.side === opposite(outcome));
      return {side: outcome, orders: takingOrders(source.orders), truncated: source.truncated === true,
        quote: bestBook(row, options.updated || payload.updated, outcome, now)};
    });
    return {available: true, side, entry, orders, takingOrders: takingOrders(opposed.orders), takingTruncated: opposed.truncated === true,
      availableBooks, truncated: selected.truncated === true, quote, comparison: compareOrders(orders, quote), now};
  }

  function pagePayload() {
    return typeof RES !== 'undefined' && RES ? RES : {};
  }

  function pageUpdated(payload) {
    return typeof UPDATED !== 'undefined' && typeof PAGE !== 'undefined' && UPDATED?.[PAGE] ? UPDATED[PAGE] : payload.updated;
  }

  const state = {dialog: null, row: null, opener: null, side: 'over', mode: 'available', timer: null, iconTimer: null, observer: null};
  const icon = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 16V9m5 7V4m5 12V7m4 9H1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function createTrigger(getRow) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nv-depth-trigger';
    button.title = 'Novig order book';
    button.setAttribute('aria-label', `View Novig order book for ${getRow().player}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = icon;
    button.novigDepthRow = getRow;
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(getRow(), button); });
    if (!state.iconTimer) state.iconTimer = root.setInterval(() => {
      const payload = pagePayload();
      document.querySelectorAll('.nv-depth-trigger').forEach(trigger => {
        const result = inspect(trigger.novigDepthRow?.(), payload);
        trigger.disabled = !result.available;
        trigger.title = result.available ? 'Novig order book' : result.reason;
      });
    }, 1000);
    return button;
  }

  // Cards do not use Tabulator formatters. Enhance only this page's NV book tile.
  function enhanceCards() {
    if (typeof PAGE === 'undefined' || PAGE !== 'atgs') return;
    const container = document.getElementById('card-container');
    if (!container) return;
    if (!state.observer) {
      state.observer = new MutationObserver(enhanceCards);
      state.observer.observe(container, {childList: true, subtree: true});
    }
    const payload = pagePayload();
    container.querySelectorAll('.data-card').forEach(card => {
      const row = card.playerLinesData;
      const previous = card.querySelector('.nv-depth-trigger');
      if (!inspect(row, payload).available) { previous?.remove(); return; }
      if (previous) return;
      const book = card.querySelector('.book-logo-small[alt="nv"]')?.closest('.book-odd-item');
      const target = book || card.querySelector('.card-header');
      if (!target) return;
      const trigger = createTrigger(() => card.playerLinesData);
      trigger.classList.add('nv-depth-card-trigger');
      if (!book) trigger.insertAdjacentHTML('beforeend', '<span>NV depth</span>');
      target.appendChild(trigger);
    });
  }

  function formatter(baseFormatter) {
    return function (cell, params, onRendered) {
      const original = baseFormatter(cell, params, onRendered);
      const row = cell.getRow().getData();
      const result = inspect(row, pagePayload());
      if (!result.available || params?.blurOdds) return original;
      const wrapper = document.createElement('div');
      wrapper.className = 'nv-depth-cell';
      const odds = document.createElement('div');
      odds.className = 'nv-depth-existing-odds';
      if (original instanceof root.Node) odds.appendChild(original);
      else odds.innerHTML = original ?? '';
      const button = createTrigger(() => cell.getRow().getData());
      wrapper.append(odds, button);
      return wrapper;
    };
  }

  function close() {
    if (state.dialog?.open) state.dialog.close();
  }

  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const dialog = document.createElement('dialog');
    dialog.id = 'novig-depth-dialog';
    dialog.setAttribute('aria-labelledby', 'novig-depth-title');
    dialog.innerHTML = '<header class="nv-depth-header"><div><p class="nv-depth-eyebrow">NOVIG · ORDER BOOK</p><h2 id="novig-depth-title"></h2><p id="novig-depth-subtitle"></p></div><button type="button" class="nv-depth-close" aria-label="Close Novig depth">×</button></header><div class="nv-depth-modes" role="group" aria-label="Order book view"><button type="button" data-depth-mode="available">Available to take</button><button type="button" data-depth-mode="resting">Resting interest</button></div><div class="nv-depth-tabs" role="group" aria-label="Outcome"><button type="button" data-depth-side="over">Yes · Goal</button><button type="button" data-depth-side="under">No · No goal</button></div><div id="novig-depth-content" class="nv-depth-content" aria-live="polite"></div>';
    dialog.querySelector('.nv-depth-close').addEventListener('click', close);
    dialog.querySelectorAll('[data-depth-side]').forEach(button => button.addEventListener('click', () => { state.side = button.dataset.depthSide; refresh(); }));
    dialog.querySelectorAll('[data-depth-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.depthMode; refresh(); }));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter(item => !item.hidden && item.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    dialog.addEventListener('close', () => {
      root.clearInterval(state.timer); state.timer = null;
      const opener = state.opener; state.opener = null;
      if (opener?.isConnected) opener.focus({preventScroll: true});
    });
    document.body.appendChild(dialog);
    state.dialog = dialog;
    root.addEventListener('odds-rendered', refresh);
    return dialog;
  }

  function currentRow(payload) {
    if (!Array.isArray(payload.data)) return null;
    const previous = state.row;
    return payload.data.find(row => row.game === previous.game && row.player === previous.player && row.prop === previous.prop && Boolean(row.under) === Boolean(previous.under) && String(row.handicap) === String(previous.handicap) && (row.dt || row.date) === (previous.dt || previous.date)) || null;
  }

  function quoteLink(quote, side) {
    // Current ATGS feed links are saved Goal selections, even on Under rows.
    if (side !== 'over') return '';
    let value = quote.link;
    try { if (typeof resolveLink === 'function' && typeof value === 'string') value = resolveLink(value); } catch (_) { value = ''; }
    return safeLink(value);
  }

  function observedFooter(entry) {
    return `<footer class="nv-depth-footer"><span>Observed ${escape(new Date(timestamp(entry.updated)).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'}))}</span><p>Amounts shown in whole dollars, rounded down; calculations use full precision. Pending orders may change before a fill. Prices and amounts are before fees.</p></footer>`;
  }

  function bookPrice(quote, side) {
    const link = quoteLink(quote, side);
    const text = `${escape(quote.name)} ${american(quote.odds)}`;
    return link ? `<a href="${escape(link)}" target="_blank" rel="noopener noreferrer">${text} ↗</a>` : `<strong>${text}</strong>`;
  }

  function compactStake(orders) {
    const amount = stakeFraction(orders);
    const whole = amount.n / amount.d;
    for (const [scale, suffix] of [[1000000n, 'm'], [1000n, 'k']]) {
      if (whole >= scale) {
        const tenths = whole * 10n / scale;
        return `$${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}${suffix}`;
      }
    }
    return wholeStake(orders);
  }

  function availableAverage(orders) {
    const contracts = orders.reduce((sum, order) => sum + BigInt(order.contracts), 0n);
    if (!contracts) return null;
    const amount = stakeFraction(orders);
    return americanFromFraction({n: amount.n * 100n, d: amount.d * contracts});
  }

  function renderAvailable(result) {
    const books = result.availableBooks;
    const maximum = Math.max(0, ...books.flatMap(book => book.orders.map(order => order.stake_usd)));
    const panels = books.map(({side, orders, quote, truncated}) => {
      const label = outcomeName(side);
      const rows = orders.map(order => {
        const width = maximum ? order.stake_usd / maximum * 100 : 0;
        const value = wholeStake([order]);
        return `<li class="nv-depth-chart-row" aria-label="${label} ${american(order.odds)}, ${escape(value)} available"><span class="nv-depth-chart-odds">${american(order.odds)}</span><span class="nv-depth-chart-track"><span class="nv-depth-chart-fill" aria-hidden="true" style="--depth-width:${width.toFixed(4)}%"></span><span class="nv-depth-chart-amount" title="${escape(dollars(order.stake_usd))}">${escape(compactStake([order]))}</span></span></li>`;
      }).join('');
      const average = availableAverage(orders);
      return `<section class="nv-depth-book" data-book-side="${side}" aria-label="${label} ${sideName(side)} order book"><header class="nv-depth-book-header"><h3>${label}</h3><span>${sideName(side)}</span></header><p class="nv-depth-book-caption">Available to take</p>${orders.length ? `<ol class="nv-depth-chart" aria-label="${label} prices and available stakes">${rows}</ol>` : `<p class="nv-depth-chart-empty">No ${label} liquidity available</p>`}<div class="nv-depth-book-total"><span>Total available</span><strong>${escape(wholeStake(orders))}</strong>${average !== null ? `<span class="nv-depth-book-average">at <b>${label} ${american(average)}</b> avg</span>` : ''}</div><p class="nv-depth-book-quote nv-depth-best">${quote ? `<span>Best sportsbook</span>${bookPrice(quote, side)}` : 'No fresh sportsbook price'}</p>${truncated ? '<p class="nv-depth-note">Top 20 price levels shown.</p>' : ''}</section>`;
    }).join('');
    return `<div class="nv-depth-books" style="--depth-rows:${Math.max(1, ...books.map(book => book.orders.length))}">${panels}</div><p class="nv-depth-chart-key">Bars use the same dollar scale on both sides. Average odds cover the displayed liquidity.</p>${observedFooter(result.entry)}`;
  }

  function renderResult(result, mode = 'available') {
    if (!result.available) return `<p class="nv-depth-unavailable" role="status">${escape(result.reason)}</p><p class="nv-depth-note">No price comparison is available.</p>`;
    if (mode !== 'resting') return renderAvailable(result);
    const {side, orders, quote, comparison, entry} = result;
    const other = opposite(side);
    const maxStake = Math.max(1, ...orders.map(order => order.opposite_stake_usd));
    const matching = new Set(comparison.matching);
    let summary = '<p>No fresh conventional sportsbook price for this side. Comparison unavailable.</p>';
    if (quote) {
      const link = quoteLink(quote, side);
      const quoteText = `${escape(quote.name)} ${american(quote.odds)}`;
      const book = link ? `<a href="${escape(link)}" target="_blank" rel="noopener noreferrer">${quoteText} ↗</a>` : `<strong>${quoteText}</strong>`;
      summary = `<p class="nv-depth-best">Best fresh ${sideName(side).toLowerCase()} price: ${book} <span>(${percent(quote.probability)} implied)</span></p>`;
      if (comparison.matching.length) {
        summary += `<p class="nv-depth-comparison ${comparison.substantial ? 'nv-depth-comparison-strong' : ''}">Better price than resting orders · ${escape(wholeStake(comparison.matching))} maker stake${comparison.substantial ? '' : ` · below ${dollars(comparison.threshold)} highlight threshold`}</p><div class="nv-depth-metrics"><div><span>Matching maker stake · ${sideName(side)}</span><strong>${escape(wholeStake(comparison.matching))}</strong></div><div><span>Opposite taker stake · ${sideName(other)}</span><strong>${escape(wholeStake(comparison.matching, true))}</strong></div><div><span>Average requested odds</span><strong>${american(comparison.weightedOdds)} <small>${percent(comparison.weightedProbability)}</small></strong></div></div>`;
      } else summary += '<p>No sportsbook price is better than these resting-order prices.</p>';
    }
    const rows = orders.map(order => `<tr${matching.has(order) ? ' class="nv-depth-matching"' : ''}><td>${american(order.odds)}<small>${escape(order.probability)} probability</small></td><td>${escape(wholeStake([order]))}</td><td><div class="nv-depth-bar" aria-hidden="true" style="--depth-width:${Math.max(1, order.opposite_stake_usd / maxStake * 100).toFixed(2)}%"></div><span>${american(order.opposite_odds)}</span><strong>${escape(wholeStake([order], true))}</strong></td></tr>`).join('');
    return `<section class="nv-depth-summary">${summary}</section><p class="nv-depth-explainer">These resting bids want <strong>${sideName(side)}</strong>. Taking them backs <strong>${sideName(other)}</strong>. Maker stake and opposite taker stake are different amounts.</p><div class="nv-depth-totals"><span>Displayed maker stake <strong>${escape(wholeStake(orders))}</strong></span><span>Opposite taker stake <strong>${escape(wholeStake(orders, true))}</strong></span></div>${orders.length ? `<div class="nv-depth-table-wrap"><table class="nv-depth-table"><thead><tr><th scope="col">Maker wants<br>${sideName(side)} odds</th><th scope="col">Maker<br>stake</th><th scope="col">Available to take · ${sideName(other)}<br>Odds / taker stake</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="nv-depth-empty">No resting orders want ${sideName(side).toLowerCase()} in this snapshot.</p>`}<p class="nv-depth-note">Bars show opposite taker stake. Amounts are shown in whole dollars, rounded down; calculations use full precision. ${result.truncated ? 'Only the top 20 price levels are shown. ' : ''}Amounts and prices are before fees. Orders may change before a fill.</p><footer class="nv-depth-footer"><span>Observed ${escape(new Date(timestamp(entry.updated)).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'}))}</span><p>Pending orders are not completed bets or fair value. Goal links open the saved sportsbook selection; No-goal links are unavailable. This view places no bets.</p></footer>`;
  }

  function refresh() {
    if (!state.dialog?.open || !state.row) return;
    const payload = pagePayload();
    const row = currentRow(payload);
    const result = inspect(row, payload, {side: state.side, updated: pageUpdated(payload)});
    const dialog = state.dialog;
    dialog.querySelector('#novig-depth-title').textContent = state.row.player;
    dialog.querySelector('#novig-depth-subtitle').textContent = `${state.row.game} · ${state.row.dt || state.row.date} · Anytime goalscorer`;
    dialog.querySelectorAll('[data-depth-side]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.depthSide === state.side)));
    dialog.querySelectorAll('[data-depth-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.depthMode === state.mode)));
    dialog.querySelector('.nv-depth-tabs').hidden = state.mode === 'available';
    const content = dialog.querySelector('#novig-depth-content');
    const html = renderResult(result, state.mode);
    if (content.innerHTML !== html) {
      const hadFocus = content.contains(document.activeElement);
      content.innerHTML = html;
      if (hadFocus) dialog.querySelector(state.mode === 'resting' ? `[data-depth-side="${state.side}"]` : '[data-depth-mode="available"]').focus({preventScroll: true});
    }
  }

  function open(row, opener) {
    const dialog = ensureDialog();
    state.row = row;
    state.side = row.under ? 'under' : 'over';
    state.mode = 'available';
    state.opener = opener || document.activeElement;
    if (!dialog.open) dialog.showModal();
    refresh();
    dialog.querySelector('.nv-depth-close').focus({preventScroll: true});
    root.clearInterval(state.timer);
    state.timer = root.setInterval(refresh, 1000);
  }

  if (typeof document !== 'undefined') {
    root.addEventListener('odds-rendered', enhanceCards);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceCards, {once: true});
    else enhanceCards();
  }
  const api = {MAX_AGE_MS, MIN_SIGNAL_STAKE_USD, formatter, open, close, refresh, inspect, normalizeOrders, compareOrders, bestBook, safeLink, quoteLink, timestamp, easternDate, impliedFraction,
    complementProbability, takingOrders, wholeStake, americanFromProbability, renderResult};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovigDepth = api;
})(typeof window !== 'undefined' ? window : globalThis);
