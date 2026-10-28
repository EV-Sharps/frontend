/* Available prediction-market prices for one player, market and line. */
(function (root) {
  'use strict';
  const MAX_AGE_MS = 15 * 60 * 1000;
  const BOOKS = ['nv', 'px', 'kal', 'poly'];
  const NAMES = {nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const number = value => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    if (!text || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
    const result = Number(text);
    return Number.isFinite(result) ? result : null;
  };
  const liquidity = value => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const amount = number(String(value).replace(/[$,]/g, ''));
    return amount !== null && amount >= 0 ? amount : null;
  };
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  const dateOf = row => row?.dt || row?.date || '';
  const dateConsistent = row => !row?.dt || !row?.date || row.dt === row.date;
  const probability = odds => odds > 0 ? 100 / (100 + odds) : -odds / (100 - odds);
  const american = p => p > 0 && p < 1 ? (p <= .5 ? Math.round(100 * (1 - p) / p) : -Math.round(100 * p / (1 - p))) : null;
  const oddsText = odds => odds === null ? '—' : `${odds >= 0 || Math.abs(odds) === 100 ? '+' : '-'}${Math.abs(odds).toLocaleString('en-US')}`;
  const money = value => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(value);
  // Correct only binary arithmetic dust (e.g. 0.29 * 100), not actual cents.
  const wholeMoney = value => value > 0 && value < 1 ? '<$1' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(Math.floor(value + Number.EPSILON * value * 4));

  function sameMarket(selected, row) {
    return !!row && !row.blurred && dateConsistent(row) && row.player === selected.player
      && row.prop === selected.prop && row.game === selected.game && dateOf(row) === dateOf(selected)
      && (!selected.gameId || !row.gameId || selected.gameId === row.gameId)
      && (!selected.sport || !row.sport || String(selected.sport).toLowerCase() === String(row.sport).toLowerCase());
  }

  // Group the shown American price, retaining original probabilities for totals/averages.
  function groupLevels(levels) {
    const groups = new Map();
    for (const level of levels) {
      const odds = Math.abs(level.odds) === 100 ? 100 : level.odds;
      const key = oddsText(odds);
      if (!groups.has(key)) groups.set(key, {odds, probability: level.probability, stake: null, unknownSizes: 0, sources: []});
      const group = groups.get(key);
      group.probability = Math.min(group.probability, level.probability);
      let source = group.sources.find(item => item.book === level.book);
      if (!source) {
        source = {book: level.book, stake: null, unknownSizes: 0, levels: []};
        group.sources.push(source);
      }
      source.levels.push(level);
      if (finite(level.stake) && level.stake > 0) {
        source.stake = (source.stake || 0) + level.stake;
        group.stake = (group.stake || 0) + level.stake;
      } else {
        source.unknownSizes++;
        group.unknownSizes++;
      }
    }
    for (const group of groups.values()) group.sources.sort((a, b) => BOOKS.indexOf(a.book) - BOOKS.indexOf(b.book));
    return [...groups.values()].sort((a, b) => a.probability - b.probability);
  }

  function summarize(levels) {
    levels.sort((a, b) => a.probability - b.probability || BOOKS.indexOf(a.book) - BOOKS.indexOf(b.book));
    const sized = levels.filter(level => finite(level.stake) && level.stake > 0);
    const totalStake = sized.reduce((sum, level) => sum + level.stake, 0);
    const totalPayout = sized.reduce((sum, level) => sum + level.stake / level.probability, 0);
    return {levels, groups: groupLevels(levels), totalStake, averageOdds: totalStake > 0 && totalPayout > totalStake ? american(totalStake / totalPayout) : null,
      unknownSizes: levels.length - sized.length};
  }

  function collect(selected, rows, payload = {}, options = {}) {
    const now = options.now ?? Date.now();
    const result = {lines: [], line: number(selected?.handicap), sides: {over: summarize([]), under: summarize([])}, sources: [], available: false, reason: ''};
    if (!selected?.player || !selected.prop || !selected.game || selected.blurred || !dateConsistent(selected)) {
      result.reason = 'Order books are unavailable for this selection.';
      return result;
    }
    const markets = (Array.isArray(rows) ? rows : []).filter(row => sameMarket(selected, row) && number(row.handicap) !== null);
    result.lines = [...new Set(markets.map(row => number(row.handicap)))].sort((a, b) => a - b);
    const current = markets.filter(row => number(row.handicap) === result.line);
    if (!current.length || result.line === null) {
      result.reason = 'This line is no longer in the current data.';
      return result;
    }
    const starts = timestamp(payload?.times?.[selected.game]);
    if (Number.isFinite(starts) && starts <= now) {
      result.reason = 'The game has started. Pregame order books are no longer shown.';
      return result;
    }
    const levels = {over: [], under: []};
    const updated = options.updated || payload.updated || {};
    const scorer = root.NovigDepth?.scorerMarket({...selected, handicap: result.line});
    const depthFields = {nv: 'novigDepth', kal: 'kalshiDepth', px: 'prophetxDepth'};
    for (const book of BOOKS) {
      const entry = depthFields[book] ? payload?.[depthFields[book]]?.[selected.game]?.[selected.player] : undefined;
      const advertised = Object.prototype.hasOwnProperty.call(payload.depthAvailable?.[selected.game]?.[selected.player] || {}, book);
      const discover = options.discover === true && Object.prototype.hasOwnProperty.call(depthFields, book);
      // Scorer depth is for 1+ goals, home runs or touchdowns, never alternate lines.
      if (scorer && (entry !== undefined || advertised || discover)) {
        const inspector = (book === 'px' && options.prophetxDepth) || (book === 'kal' && options.kalshiDepth) || options.novigDepth || root.NovigDepth;
        let depth;
        try { depth = inspector?.inspect(current[0], payload, {now, updated, book, discover}); } catch (_) { /* Invalid depth is unavailable. */ }
        if (!depth?.available) {
          result.sources.push({book, kind: depth?.loadable ? 'pending' : 'unavailable', status: depth?.status, reason: depth?.reason || 'Current depth is unavailable.'});
          continue; // Do not revive the same snapshot's expired best quote.
        }
        for (const side of ['over', 'under']) {
          const available = depth.availableBooks?.find(item => item.side === side);
          for (const order of available?.orders || []) {
            const p = number(order.probability), stake = number(order.stake_usd);
            if (p === null || p <= 0 || p >= 1 || stake === null || stake <= 0) continue;
            levels[side].push({book, probability: p, odds: number(order.odds) ?? american(p), stake, kind: 'depth', time: 'fresh'});
          }
        }
        result.sources.push({book, kind: 'depth', truncated: Object.fromEntries(['over', 'under'].map(side =>
          [side, depth.availableBooks?.find(item => item.side === side)?.truncated === true])), maxLevels: depth.maxLevels || (book === 'nv' ? 20 : 100), updated: depth.entry?.updated || entry?.updated});
        continue;
      }
      const quotes = [null, null];
      for (const row of current) {
        const raw = row.bookOdds?.[book];
        if (typeof raw !== 'string' && typeof raw !== 'number') continue;
        const pair = String(raw).split('/');
        if (pair.length > 2) continue;
        for (let side = 0; side < 2; side++) {
          const odds = number(pair[side]);
          if (odds === null || Math.abs(odds) < 100) continue;
          const stake = liquidity(Array.isArray(row.liquidity?.[book]) ? row.liquidity[book][side] : undefined);
          if (!quotes[side]) quotes[side] = {odds, stake};
          // Duplicate Over/Under rows are the same book, not additional size.
          else if (quotes[side].odds === odds && quotes[side].stake === null && stake !== null) quotes[side].stake = stake;
        }
      }
      if (!quotes.some(Boolean)) continue;
      const observed = timestamp(updated?.[book]);
      if (Number.isFinite(observed) && (observed > now || now - observed > MAX_AGE_MS)) {
        result.sources.push({book, kind: 'unavailable', reason: observed > now ? 'Quote timestamp is in the future.' : 'Quote is more than 15 minutes old.'});
        continue;
      }
      const time = Number.isFinite(observed) ? 'fresh' : 'unverified';
      quotes.forEach((quote, index) => {
        if (!quote || quote.stake === 0) return;
        levels[index ? 'under' : 'over'].push({book, odds: quote.odds, probability: probability(quote.odds), stake: quote.stake, kind: 'top', time});
      });
      result.sources.push({book, kind: 'top', time, updated: Number.isFinite(observed) ? updated[book] : null});
    }
    result.sides = {over: summarize(levels.over), under: summarize(levels.under)};
    result.available = !!(levels.over.length || levels.under.length);
    if (!result.available) result.reason = result.sources.some(source => source.kind === 'pending') ? 'Order book details are still loading or unavailable. See the status below.' : 'No current prediction-market prices with available or unreported size for this line.';
    return result;
  }

  const footnote = 'Before fees. Sizes are reported stakes, rounded down for display. Totals and average use the displayed levels at full precision; best quotes do not represent full depth. Orders can change before a fill.';

  function renderSide(result, side, options = {}) {
    const {levels, totalStake, averageOdds, unknownSizes} = result.sides[side];
    const groups = result.sides[side].groups || groupLevels(levels);
    const max = options.maxStake ?? Math.max(0, ...groups.map(group => group.stake || 0));
    const full = result.sources.filter(source => source.kind === 'depth');
    const tops = result.sources.filter(source => source.kind === 'top');
    const coverage = [full.map(source => `${NAMES[source.book]}: ${source.truncated?.[side] ? `top ${source.maxLevels} levels` : 'available depth'}`).join(' · '),
      tops.length ? `${tops.map(source => NAMES[source.book]).join(', ')}: best quote only` : ''].filter(Boolean).join(' · ');
    const unavailable = result.sources.filter(source => source.kind === 'unavailable');
    const pending = result.sources.filter(source => source.kind === 'pending');
    const known = levels.length - unknownSizes;
    return `<p class="prediction-depth-coverage">${escape(coverage || 'No current exchange coverage.')}</p>
      ${groups.length ? `<div class="prediction-depth-head" aria-hidden="true"><span>Sources</span><span>Odds</span><span>Reported size</span></div><ol class="prediction-depth-levels" aria-label="${side === 'under' ? 'Under' : 'Over'} prices, highest odds first">${groups.map(group => {
        const amount = group.stake === null ? 'Size unknown' : `${wholeMoney(group.stake)}${group.unknownSizes ? ' + ?' : ''}`;
        const width = max && group.stake !== null ? group.stake / max * 100 : 0;
        const breakdown = group.sources.map(source => `${NAMES[source.book]}: ${source.stake === null ? 'size unknown' : money(source.stake)}${source.stake !== null && source.unknownSizes ? ' + unknown size' : ''}`).join(' · ');
        const sources = group.sources.map(source => {
          const unverified = source.levels.some(level => level.time === 'unverified');
          const title = `${NAMES[source.book]} · ${source.stake === null ? 'Size unknown' : money(source.stake)} · ${source.levels.some(level => level.kind === 'depth') ? 'Available depth' : 'Best quote only'}${unverified ? ' · Time unverified' : ''}`;
          return `<span class="prediction-depth-source" data-book="${source.book}" title="${escape(title)}"><img src="logos/${source.book}.png" alt="" width="19" height="19"><span>${source.book.toUpperCase()}${unverified ? '<small>Time unverified</small>' : ''}</span></span>`;
        }).join('');
        const segments = group.sources.filter(source => source.stake !== null).map(source => `<span class="prediction-depth-segment" data-book="${source.book}" style="width:${(source.stake / group.stake * 100).toFixed(6)}%" title="${escape(`${NAMES[source.book]}: ${money(source.stake)}`)}"></span>`).join('');
        return `<li class="prediction-depth-level" data-price="${group.odds}"><span class="prediction-depth-sources${group.sources.length > 1 ? ' is-multiple' : ''}">${sources}</span><strong class="prediction-depth-odds">${oddsText(group.odds)}</strong><span class="prediction-depth-size${group.stake === null ? ' is-unknown' : ''}" title="${escape(breakdown)}" aria-label="${escape(breakdown)}"><span class="prediction-depth-bar" style="--depth-fill:${width.toFixed(3)}%" aria-hidden="true">${segments}</span><span class="prediction-depth-size-label">${escape(amount)}</span></span></li>`;
      }).join('')}</ol><div class="prediction-depth-total"><span>Displayed liquidity<strong>${known ? wholeMoney(totalStake) : 'Unknown'}</strong></span><span>Average payout odds<strong>${oddsText(averageOdds)}</strong></span></div>` : `<p class="prediction-depth-empty" role="status">${escape(result.available ? 'No available prices on this side.' : result.reason)}</p>`}
      ${unknownSizes ? `<p class="prediction-depth-note">${unknownSizes} quote${unknownSizes === 1 ? ' has' : 's have'} unknown size and ${unknownSizes === 1 ? 'is' : 'are'} excluded from the total and average.</p>` : ''}
      ${levels.some(level => level.time === 'unverified') ? '<p class="prediction-depth-note">Time unverified: these best quotes have no usable update time.</p>' : ''}
      ${unavailable.length ? `<p class="prediction-depth-note">${unavailable.map(source => `${escape(NAMES[source.book])}: ${escape(source.reason)}`).join(' ')}</p>` : ''}
      ${pending.length ? `<p class="prediction-depth-note" role="status">${pending.map(source => escape(source.reason)).join(' ')}</p>` : ''}
      ${options.footnote === false ? '' : `<p class="prediction-depth-note">${footnote}</p>`}`;
  }

  function mount(host, selected, options = {}) {
    if (!host || !root.document) return {destroy() {}};
    const panel = root.document.createElement('section');
    panel.className = 'prediction-depth';
    panel.innerHTML = '<header class="prediction-depth-header"><h3>Prediction market order books</h3><p>Available prices across exchanges, highest odds first.</p></header><div class="prediction-depth-controls"><label>Line <select aria-label="Order book line"></select></label></div><div class="prediction-depth-content"></div>';
    host.appendChild(panel);
    const select = panel.querySelector('select');
    const content = panel.querySelector('.prediction-depth-content');
    let line = number(selected?.handicap), destroyed = false, generation = 0;
    const accessToken = () => typeof ACCESS_TOKEN === 'string' ? ACCESS_TOKEN : '';
    function loadBooks(retry = false) {
      if (destroyed || !root.NovigDepth?.load) return;
      const rows = typeof options.getRows === 'function' ? options.getRows() : [];
      const payload = (typeof options.getPayload === 'function' ? options.getPayload() : null) || {};
      const updated = typeof options.getUpdated === 'function' ? options.getUpdated() : payload.updated;
      const current = {...selected, handicap: line};
      const result = collect(current, rows, payload, {updated, discover: true});
      const requests = result.sources.filter(source => source.kind === 'pending').map(source =>
        root.NovigDepth.load(current, payload, {book: source.book, retry, discover: true}));
      const requestGeneration = ++generation, token = accessToken();
      Promise.allSettled(requests).then(() => {
        if (!destroyed && requestGeneration === generation && token === accessToken()) refresh();
      });
      refresh();
    }
    function refresh() {
      if (destroyed) return;
      const rows = typeof options.getRows === 'function' ? options.getRows() : [];
      const payload = (typeof options.getPayload === 'function' ? options.getPayload() : null) || {};
      const updated = typeof options.getUpdated === 'function' ? options.getUpdated() : payload.updated;
      let result = collect({...selected, handicap: line}, rows, payload, {updated, discover: true});
      if (line === null && result.lines.length) {
        line = result.lines[0];
        result = collect({...selected, handicap: line}, rows, payload, {updated, discover: true});
      }
      const choices = result.lines.includes(line) ? result.lines : [line, ...result.lines].filter(value => value !== null);
      const optionsHtml = choices.map(value => `<option value="${value}">${value}${result.lines.includes(value) ? '' : ' · unavailable'}</option>`).join('');
      if (select.innerHTML !== optionsHtml) select.innerHTML = optionsHtml;
      select.value = String(line);
      select.disabled = choices.length < 2;
      const scorer = root.NovigDepth?.scorerMarket({...selected, handicap: line});
      const maxStake = Math.max(0, ...['over', 'under'].flatMap(side => result.sides[side].groups.map(group => group.stake || 0)));
      const books = BOOKS.filter(book => ['over', 'under'].some(side => result.sides[side].levels.some(level => level.book === book)));
      const legend = books.length ? `<div class="prediction-depth-legend" aria-label="Liquidity colors">${books.map(book => `<span data-book="${book}"><i aria-hidden="true"></i>${NAMES[book]}</span>`).join('')}</div>` : '';
      const retry = result.sources.some(source => source.kind === 'pending' && source.status !== 'loading') ? '<button type="button" data-prediction-depth-retry>Retry order books</button>' : '';
      const html = `${retry}${legend}<div class="prediction-depth-books">${['over', 'under'].map(side => {
        const yes = side === 'over';
        const label = yes ? 'Yes' : 'No';
        const outcome = scorer ? yes ? scorer.yes : scorer.no : `${yes ? 'Over' : 'Under'}${line === null ? '' : ` ${line}`}`;
        return `<section class="prediction-depth-book" data-depth-side="${side}" aria-label="${label} · ${escape(outcome)} order book"><header class="prediction-depth-book-header"><h4>${label}</h4><span>${escape(outcome)}</span></header>${renderSide(result, side, {maxStake, footnote: false})}</section>`;
      }).join('')}</div><p class="prediction-depth-note">Matching displayed odds share a row. Colors show each market's liquidity; bars use the same dollar scale on both sides. ${footnote}</p>`;
      if (content.innerHTML !== html) content.innerHTML = html;
    }
    const changeLine = () => { line = number(select.value); refresh(); loadBooks(); };
    panel.addEventListener('click', event => { if (event.target.closest('[data-prediction-depth-retry]')) loadBooks(true); });
    select.addEventListener('change', changeLine);
    root.addEventListener('odds-rendered', refresh);
    const timer = root.setInterval(refresh, 1000);
    refresh();
    loadBooks();
    return {destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      root.clearInterval(timer);
      root.removeEventListener('odds-rendered', refresh);
      select.removeEventListener('change', changeLine);
      panel.remove();
    }};
  }

  const api = {collect, groupLevels, mount, renderSide, MAX_AGE_MS};
  root.PredictionDepth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
