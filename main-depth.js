/* Main-market depth is fetched on demand; the table carries only its availability. */
(function (root) {
  'use strict';
  const AGE = 300000, BOOKS = ['nv', 'kal', 'px'];
  const NAMES = {nv: 'Novig', kal: 'Kalshi', px: 'ProphetX'};
  const SPORTS = ['nhl', 'nba', 'nfl', 'mlb', 'ncaaf', 'wnba'];
  const PROPS = ['ml', 'spread', 'total', 'away_total', 'home_total'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const number = value => (typeof value === 'number' || typeof value === 'string') && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value).trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  const lineKey = value => number(value) === null ? null : String(Number(value) || 0);
  const odds = p => p <= .5 ? Math.round(100 * (1 - p) / p) : -Math.round(100 * p / (1 - p));
  const price = n => `${n >= 0 || Math.abs(n) === 100 ? '+' : '-'}${Math.abs(n).toLocaleString('en-US')}`;
  const money = n => n > 0 && n < 1 ? '<$1' : '$' + Math.floor(n + Number.EPSILON * n * 4).toLocaleString('en-US');
  const signed = n => n > 0 ? `+${n}` : String(n || 0);
  const easternDate = ms => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
  const tokenOf = () => typeof ACCESS_TOKEN === 'string' ? ACCESS_TOKEN : '';
  const payloadOf = () => typeof RES === 'object' && RES ? RES : {};
  const sportOf = () => typeof SPORT === 'string' ? SPORT : '';
  const accessKey = () => JSON.stringify([tokenOf(), typeof CURR_USER === 'object' ? CURR_USER?.id : null, typeof CURR_USER === 'object' ? CURR_USER?.tier : null]);
  const lazy = {access: undefined, generation: 0, cache: new Map(), pending: new Map(), errors: new Map()};
  const state = {dialog: null, row: null, opener: null, book: 'all', mode: 'available', timer: null};

  function identity(row, payload = {}, options = {}) {
    const sport = String(row?.sport || options.sport || sportOf()).toLowerCase();
    if (!row || row.blurred || !SPORTS.includes(sport) || !PROPS.includes(row.prop) || typeof row.game !== 'string') return null;
    const teams = row.game.split(' @ ');
    if (teams.length !== 2 || teams.some(team => !team.trim())) return null;
    const home = row.under === true || row.under === 1;
    const value = row.prop === 'ml' ? .5 : number(row.handicap);
    if (value === null || Math.abs(value) > 10000 || (row.prop.includes('total') && value < 0)) return null;
    const line = lineKey(row.prop === 'spread' && home ? -value : value);
    const start = payload.times?.[row.game], starts = timestamp(start), now = options.now ?? Date.now();
    if (!Number.isFinite(starts) || starts <= now) return null;
    if ((row.dt && row.dt !== easternDate(starts)) || (row.date && row.date !== easternDate(starts))) return null;
    const sides = row.prop === 'ml' || row.prop === 'spread' ? ['away', 'home'] : ['over', 'under'];
    const labels = sides.map((side, index) => side === 'away' || side === 'home'
      ? `${teams[index].toUpperCase()}${row.prop === 'spread' ? ` ${signed(index ? -Number(line) : Number(line))}` : ''}`
      : `${side === 'over' ? 'Over' : 'Under'} ${line}`);
    const title = row.prop === 'ml' ? 'Moneyline' : row.prop === 'spread' ? 'Spread'
      : row.prop === 'total' ? 'Game total' : `${teams[row.prop === 'home_total' ? 1 : 0].toUpperCase()} team total`;
    return {sport, game: row.game, prop: row.prop, line, start, starts, sides, labels, title, selected: home ? sides[1] : sides[0]};
  }

  function fresh(updated, expiry, starts, now) {
    const seen = timestamp(updated), expires = timestamp(expiry);
    return [seen, expires, starts, now].every(Number.isFinite) && seen <= now && now - seen < AGE
      && seen < starts && expires > now && expires > seen && expires <= starts && expires <= seen + AGE;
  }

  function resetAccess() {
    const access = accessKey();
    if (access !== lazy.access) {
      for (const pending of lazy.pending.values()) pending.controller.abort();
      lazy.cache.clear(); lazy.pending.clear(); lazy.errors.clear();
      lazy.access = access; lazy.generation++;
      if (state.dialog?.open) state.dialog.close();
      if (state.dialog) {
        state.dialog.querySelector('.main-depth-content').replaceChildren();
        state.dialog.querySelector('#main-depth-title').textContent = '';
        state.dialog.querySelector('.main-depth-subtitle').textContent = '';
      }
      state.row = null;
    }
    return access;
  }

  function context(row, payload, book, options = {}) {
    const access = resetAccess(), market = identity(row, payload, options), now = options.now ?? Date.now();
    if (!market || !BOOKS.includes(book)) return null;
    const marker = payload.mainDepthAvailable?.[market.game]?.[market.prop]?.[market.line]?.[book];
    if (!marker || !fresh(marker.updated, marker.expires_at, market.starts, now)) return null;
    return {...market, book, marker, access, generation: lazy.generation,
      key: JSON.stringify([market.sport, market.game, market.prop, market.line, market.start, book, access])};
  }

  function normalize(entry, ctx, now = Date.now()) {
    const sourceStarts = timestamp(entry?.starts_at);
    if (!entry || entry.schema_version !== 1 || typeof entry.market_id !== 'string' || !entry.market_id
      || entry.prop !== ctx.prop || lineKey(entry.line) !== ctx.line || !Number.isFinite(sourceStarts)
      || sourceStarts <= now || Math.abs(sourceStarts - ctx.starts) > 20 * 60000
      || easternDate(sourceStarts) !== easternDate(ctx.starts)
      || !fresh(entry.updated, entry.expires_at, sourceStarts, now)
      || !fresh(entry.updated, entry.expires_at, ctx.starts, now) || timestamp(entry.updated) < timestamp(ctx.marker.updated)
      || !Array.isArray(entry.sides) || entry.sides.length !== 2) return null;
    const sides = [];
    for (const side of ctx.sides) {
      const found = entry.sides.filter(item => item?.side === side);
      if (found.length !== 1 || !Array.isArray(found[0].orders)) return null;
      const seen = new Set(), levels = [];
      for (const order of found[0].orders.slice(0, ctx.book === 'nv' ? 20 : 100)) {
        const p = number(order?.probability), stake = number(order?.stake_usd), opposite = number(order?.opposite_stake_usd), payout = number(order?.payout_usd);
        if (p === null || p <= 0 || p >= 1 || stake === null || stake <= 0 || opposite === null || opposite <= 0
          || payout === null || payout <= 0 || payout > 1e12 || Math.abs(payout - stake - opposite) > .03
          || Math.abs(stake - p * payout) > .03 || seen.has(p)) continue;
        seen.add(p);
        levels.push({book: ctx.book, probability:p, odds:odds(p), stake, oppositeStake:opposite, payout});
      }
      sides.push({side, orders:levels, truncated:found[0].truncated === true || found[0].orders.length > (ctx.book === 'nv' ? 20 : 100)});
    }
    if (!sides.some(side => side.orders.length)) return null;
    return {updated:entry.updated, expires_at:entry.expires_at, market_id:entry.market_id, sides};
  }

  function inspect(row, payload, book, options = {}) {
    const ctx = context(row, payload, book, options);
    if (!ctx) return {available:false, loadable:false, reason:'No fresh pregame order book for this line.'};
    const entry = lazy.cache.get(ctx.key), normalized = entry && normalize(entry, ctx, options.now ?? Date.now());
    if (normalized) return {available:true, loadable:false, entry:normalized, market:ctx, book};
    if (entry) lazy.cache.delete(ctx.key);
    return {available:false, loadable:true, market:ctx, book,
      status:lazy.pending.has(ctx.key) ? 'loading' : lazy.errors.has(ctx.key) ? 'error' : 'idle', reason:lazy.errors.get(ctx.key)};
  }

  function remember(map, key, value) {
    map.delete(key); map.set(key, value);
    while (map.size > 48) map.delete(map.keys().next().value);
  }

  function load(row, payload, book, options = {}) {
    const current = inspect(row, payload, book, options);
    if (!current.loadable) return Promise.resolve(current);
    const ctx = current.market;
    if (lazy.pending.has(ctx.key)) return lazy.pending.get(ctx.key).promise.then(() => inspect(row, payload, book, options));
    if (current.status === 'error' && !options.retry) return Promise.resolve(current);
    if (lazy.pending.size >= 9) return Promise.resolve({available:false, loadable:false, reason:'Other order books are loading. Try again.'});
    lazy.errors.delete(ctx.key);
    const controller = new AbortController(), pending = {controller, promise:null};
    const timer = root.setTimeout(() => controller.abort(), 15000);
    pending.promise = Promise.resolve().then(async () => {
      const url = new URL('/api/main-depth', typeof API_BASE === 'string' ? API_BASE : root.location.origin);
      for (const key of ['sport', 'book', 'game', 'prop', 'line', 'start']) url.searchParams.set(key, ctx[key]);
      const response = await root.fetch(url.toString(), {headers:{Authorization:`Bearer ${tokenOf()}`}, signal:controller.signal});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? 'Sharp access is required. Sign in again to continue.' : response.status === 404
          ? 'This order book expired or is no longer available.' : 'Unable to load this order book. Try again.');
      const result = await response.json();
      if (result?.schemaVersion !== 1 || ['sport','book','game','prop'].some(key => result[key] !== ctx[key])
        || lineKey(result.line) !== ctx.line || timestamp(result.start) !== ctx.starts || !normalize(result.entry, ctx, options.now ?? Date.now()))
        throw new Error('The order book does not match this line. Refresh the table.');
      resetAccess();
      if (ctx.generation === lazy.generation && context(row, payload, book, options)?.key === ctx.key) remember(lazy.cache, ctx.key, result.entry);
    }).catch(error => {
      resetAccess();
      if (ctx.generation === lazy.generation) remember(lazy.errors, ctx.key, error?.name === 'AbortError' ? 'The request timed out. Try again.' : error.message);
    }).finally(() => {
      root.clearTimeout(timer);
      if (lazy.pending.get(ctx.key) === pending) lazy.pending.delete(ctx.key);
    });
    lazy.pending.set(ctx.key, pending);
    return pending.promise.then(() => inspect(row, payload, book, options));
  }

  function collect(row, payload, options = {}) {
    const market = identity(row, payload, options);
    if (!market) return {available:false, reason:'The game has started or this market is unavailable.'};
    const sources = BOOKS.filter(book => !options.book || options.book === 'all' || options.book === book).map(book => ({book, ...inspect(row, payload, book, options)}));
    const sides = market.sides.map((side, index) => {
      const levels = [];
      for (const source of sources.filter(source => source.available)) {
        const resting = source.entry.sides.find(item => item.side === market.sides[options.mode === 'resting' ? index : 1 - index]);
        for (const order of resting.orders) levels.push(options.mode === 'resting' ? {...order} :
          {...order, probability:1-order.probability, odds:odds(1-order.probability), stake:order.oppositeStake});
      }
      levels.sort((a,b) => options.mode === 'resting' ? b.probability-a.probability : a.probability-b.probability);
      const total = levels.reduce((sum,item) => sum + item.stake, 0), payout = levels.reduce((sum,item) => sum + item.stake/item.probability, 0);
      return {side, label:market.labels[index], levels, total, average:total > 0 ? odds(total/payout) : null};
    });
    return {available:sources.some(source => source.available), market, sources, sides};
  }

  function render(result, mode = 'available') {
    if (!result.market) return `<p class="main-depth-empty">${escape(result.reason)}</p>`;
    const sources = result.sources.map(source => `<span class="main-depth-source" data-book="${source.book}">${NAMES[source.book]}: ${source.available ? 'current' : source.status === 'loading' ? 'loading…' : source.status === 'idle' ? 'ready to load' : source.reason || 'unavailable'}</span>`).join('');
    const maximum = Math.max(1, ...result.sides.flatMap(side => side.levels.map(level => level.stake)));
    const panels = result.sides.map(side => `<section class="main-depth-side" data-main-side="${side.side}"><h3>${escape(side.label)}</h3><p>${mode === 'resting' ? 'Resting bids · maker stake' : 'Available to take · your stake'}</p><div class="main-depth-columns"><span>Exchange</span><span>Odds</span><span>Stake</span></div><ol>${side.levels.map(level => `<li data-book="${level.book}"><span>${NAMES[level.book]}</span><strong>${price(level.odds)}</strong><span class="main-depth-size" style="--size:${(100 * level.stake / maximum).toFixed(2)}%">${money(level.stake)}</span></li>`).join('')}</ol>${side.levels.length ? `<div class="main-depth-total"><span>Displayed stake</span><strong>${money(side.total)}</strong><span>Average odds</span><strong>${price(side.average)}</strong></div>` : '<p class="main-depth-empty">No current liquidity</p>'}</section>`).join('');
    const oldest = result.sources.filter(source => source.available).map(source => timestamp(source.entry.updated));
    const clipped = result.sources.filter(source => source.available && source.entry.sides.some(side => side.truncated)).map(source => `${NAMES[source.book]}: top ${source.book === 'nv' ? 20 : 100} levels`);
    return `<div class="main-depth-sources">${sources}</div><div class="main-depth-panels">${panels}</div><p class="main-depth-note">${mode === 'resting' ? 'Resting bids want the named outcome. They are pending orders, not completed bets or fair value.' : 'Each side shows prices you can take from orders resting on the opposite outcome.'} Prices and stakes are before fees; orders may change before a fill. Dollars are rounded down.</p>${oldest.length ? `<p class="main-depth-observed">Oldest included snapshot ${escape(new Date(Math.min(...oldest)).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}))}${clipped.length ? ` · ${escape(clipped.join('; '))}` : ''}</p>` : ''}`;
  }

  function currentRow() {
    if (!state.row) return null;
    const payload = payloadOf(), original = identity(state.row, payload);
    if (!original) return null;
    return (payload.data || []).find(row => {
      const candidate = identity(row, payload);
      return candidate && candidate.sport === original.sport && candidate.game === original.game && candidate.prop === original.prop
        && candidate.line === original.line && candidate.selected === original.selected;
    }) || null;
  }

  function refresh() {
    resetAccess();
    if (!state.dialog?.open) return;
    const row = currentRow(), result = collect(row, payloadOf(), {book:state.book, mode:state.mode});
    state.dialog.querySelector('.main-depth-content').innerHTML = render(result, state.mode);
    state.dialog.querySelectorAll('[data-main-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mainMode === state.mode)));
  }

  async function request(retry = false) {
    const row = currentRow();
    if (!row) { refresh(); return; }
    const pending = BOOKS.filter(book => state.book === 'all' || state.book === book).map(book => load(row, payloadOf(), book, {retry}));
    refresh();
    await Promise.all(pending);
    refresh();
  }

  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const dialog = document.createElement('dialog'); dialog.id = 'main-depth-dialog'; dialog.setAttribute('aria-labelledby','main-depth-title');
    dialog.innerHTML = '<header class="main-depth-header"><div><p>Prediction market order books</p><h2 id="main-depth-title"></h2><p class="main-depth-subtitle"></p></div><button type="button" class="main-depth-close" aria-label="Close order books">×</button></header><div class="main-depth-controls"><label>Exchange <select class="main-depth-book"><option value="all">All exchanges</option><option value="nv">Novig</option><option value="kal">Kalshi</option><option value="px">ProphetX</option></select></label><div role="group" aria-label="Order book view"><button type="button" data-main-mode="available">Available to take</button><button type="button" data-main-mode="resting">Resting interest</button></div><button type="button" class="main-depth-retry">Retry</button></div><div class="main-depth-content" aria-live="polite"></div>';
    dialog.querySelector('.main-depth-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.main-depth-book').addEventListener('change', event => {state.book = event.target.value; request();});
    dialog.querySelector('.main-depth-retry').addEventListener('click', () => request(true));
    dialog.querySelectorAll('[data-main-mode]').forEach(button => button.addEventListener('click', () => {state.mode = button.dataset.mainMode; refresh();}));
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {root.clearInterval(state.timer); state.timer = null; state.opener?.focus({preventScroll:true});});
    document.body.appendChild(dialog); state.dialog = dialog;
    return dialog;
  }

  function open(row, opener, options = {}) {
    if (root.NovigDepth) return root.NovigDepth.open(row, opener, options);
    resetAccess();
    const market = identity(row, payloadOf());
    if (!market) return;
    const dialog = ensureDialog(); state.row = row; state.opener = opener; state.book = options.book || 'all'; state.mode = 'available';
    dialog.querySelector('#main-depth-title').textContent = market.game.toUpperCase();
    dialog.querySelector('.main-depth-subtitle').textContent = market.title;
    dialog.querySelector('.main-depth-book').value = state.book;
    dialog.showModal(); request(); root.clearInterval(state.timer); state.timer = root.setInterval(refresh, 1000);
  }

  function trigger(getRow, book) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'main-depth-trigger';
    button.mainDepthRow = getRow;
    button.textContent = book ? 'Depth' : 'Order books'; button.dataset.mainBook = book || 'all';
    button.setAttribute('aria-label', book ? `${NAMES[book]} order book` : 'Prediction market order books');
    button.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); open(getRow(), button, {book:book || 'all'});});
    return button;
  }

  function formatter(base, book) {
    if (root.NovigDepth) return root.NovigDepth.formatter(base, {book});
    return (cell, params, onRendered) => {
      const original = base(cell, params, onRendered), row = cell.getRow().getData();
      if (params?.blurOdds || !context(row, payloadOf(), book)) return original;
      const wrapper = document.createElement('div'); wrapper.className = 'main-depth-cell';
      const quote = document.createElement('div');
      if (original instanceof root.Node) quote.append(original); else quote.innerHTML = original ?? '';
      wrapper.append(quote, trigger(() => cell.getRow().getData(), book)); return wrapper;
    };
  }

  function enhanceCards() {
    if (root.NovigDepth) return;
    resetAccess();
    document.querySelectorAll('#card-container .data-card, #card-modal-inner .data-card').forEach(card => {
      const present = card.querySelector('.main-depth-trigger'), row = card.playerLinesData;
      if (!BOOKS.some(book => context(row, payloadOf(), book))) {present?.remove(); return;}
      if (!present) card.querySelector('.card-header')?.appendChild(trigger(() => card.playerLinesData));
    });
  }

  if (root.document && !root.NovigDepth) {
    const boot = () => {
      if (root.NovigDepth) return;
      for (const id of ['card-container','card-modal-inner']) {
        const host = document.getElementById(id);
        if (host) new MutationObserver(enhanceCards).observe(host, {subtree:true,childList:true});
      }
      enhanceCards();
      root.setInterval(() => {
        if (root.NovigDepth) return;
        resetAccess(); enhanceCards();
        document.querySelectorAll('#table .main-depth-trigger').forEach(button => {
          const row = button.mainDepthRow?.();
          button.disabled = !context(row, payloadOf(), button.dataset.mainBook);
        });
      }, 2000);
    };
    root.addEventListener('odds-rendered', () => {enhanceCards(); refresh();});
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
  root.MainDepth = {identity, normalize, inspect, load, collect, render, formatter, open, resetAccess};
})(typeof window === 'undefined' ? globalThis : window);
