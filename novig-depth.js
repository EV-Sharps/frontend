(function (root) {
  'use strict';

  const MAX_AGE_MS = 15 * 60 * 1000;
  const MIN_SIGNAL_STAKE_USD = 100;
  const PROVIDERS = {
    nv: {book: 'nv', name: 'Novig', field: 'novigDepth', maxAge: MAX_AGE_MS, maxLevels: 20, divisor: 100},
    kal: {book: 'kal', name: 'Kalshi', field: 'kalshiDepth', maxAge: 5 * 60 * 1000, maxLevels: 100, divisor: 1},
    px: {book: 'px', name: 'ProphetX', field: 'prophetxDepth', maxAge: 5 * 60 * 1000, maxLevels: 100}
  };
  const providerFor = (options = {}) => {
    const book = options.book || options.exchange;
    return ['px', 'prophetx'].includes(book) ? PROVIDERS.px : ['kal', 'kalshi'].includes(book) ? PROVIDERS.kal : PROVIDERS.nv;
  };
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
  const SCORERS = {
    atgs: {sport: 'nhl', endpoint: '/api/atgs-depth', title: 'Anytime goalscorer', yes: 'Goal', no: 'No goal'},
    hr: {sport: 'mlb', endpoint: '/api/homers-depth', title: 'Home run', yes: 'Home run', no: 'No home run'},
    attd: {sport: 'nfl', endpoint: '/api/attd-depth', title: 'Anytime touchdown', yes: 'Touchdown', no: 'No touchdown'}
  };
  function scorerMarket(row) {
    const market = Object.hasOwn(SCORERS, row?.prop) ? SCORERS[row.prop] : null;
    return market && ['0.5', '.5', .5].includes(row.handicap)
      && (!row.sport || String(row.sport).toLowerCase() === market.sport) ? market : null;
  }
  const sideName = (side, market = SCORERS.atgs) => side === 'under' ? market.no : market.yes;
  const outcomeName = (side, market) => market?.outcomes?.[side === 'under' ? 1 : 0] || (side === 'under' ? 'No' : 'Yes');
  const opposite = side => side === 'under' ? 'over' : 'under';

  // Keep market-specific validation and lazy request caches in their adapters.
  // All pages share the same preview, chart and maker/taker presentation here.
  function adapterFor(row) {
    if (['ml', 'spread', 'total', 'away_total', 'home_total'].includes(row?.prop)) return root.MainDepth;
    if (['pts', 'reb', 'ast', '3ptm'].includes(row?.prop)) return root.NBAPropDepth;
    return null;
  }

  function displayMarket(row, payload, options = {}) {
    const adapter = adapterFor(row);
    if (!adapter) return scorerMarket(row);
    const identity = adapter.identity(row, payload, options);
    return identity ? {...identity, yes: identity.labels[0], no: identity.labels[1],
      outcomes: identity.sides[0] === 'away' ? ['Away', 'Home'] : ['Over', 'Under']} : null;
  }

  function numberFraction(value) {
    const [mantissa, exponent = '0'] = String(value).split('e');
    const amount = fraction(mantissa), power = Number(exponent);
    if (!amount || !Number.isInteger(power) || Math.abs(power) > 324) return null;
    return power >= 0 ? {n: amount.n * 10n ** BigInt(power), d: amount.d}
      : {n: amount.n, d: amount.d * 10n ** BigInt(-power)};
  }

  function adapterOrders(orders) {
    return orders.map(order => {
      const implied = numberFraction(order.probability), stake = numberFraction(order.stake);
      const other = numberFraction(order.oppositeStake), payout = numberFraction(order.payout);
      return {probability: String(order.probability), p: order.probability,
        odds: americanFromFraction(implied), opposite_odds: americanFromFraction({n: implied.d - implied.n, d: implied.d}),
        stake_usd: order.stake, opposite_stake_usd: order.oppositeStake, payout_usd: order.payout,
        money: {implied, stake, opposite: other, payout}};
    }).sort((a, b) => b.p - a.p);
  }

  function inspectAdapter(row, payload, options, adapter) {
    const provider = providerFor(options), result = adapter.inspect(row, payload, provider.book, options);
    const side = options.side === 'under' || options.side === 'over' ? options.side : row?.under ? 'under' : 'over';
    const market = displayMarket(row, payload, options);
    if (!result.available) return {...result, provider, market, side,
      reason: result.reason || (result.status === 'loading' ? `Loading ${provider.name} order book…` : `${provider.name} order book has not been loaded.`)};
    const now = options.now ?? Date.now(), updated = options.updated || payload.updated;
    // The adapters return canonical away/home or over/under order, independent of
    // the clicked row. Map those to the two common chart slots, never to Yes/No.
    const entry = {...result.entry, sides: result.entry.sides.map((item, index) => ({...item,
      side: index ? 'under' : 'over', orders: adapterOrders(item.orders)}))};
    const selected = entry.sides.find(item => item.side === side);
    const opposed = entry.sides.find(item => item.side === opposite(side));
    const quoteFor = outcome => {
      const quote = bestBook(row, updated, outcome, now);
      // Main/prop feeds may share one link across both sides. Compare prices
      // without claiming that URL selects either outcome.
      return quote ? {...quote, link: ''} : null;
    };
    const quote = quoteFor(side);
    return {available: true, loadable: false, side, entry, provider, market, maxLevels: provider.maxLevels,
      orders: selected.orders, truncated: selected.truncated, quote, comparison: compareOrders(selected.orders, quote), now,
      takingOrders: takeNormalizedOrders(opposed.orders), takingTruncated: opposed.truncated,
      availableBooks: entry.sides.map(item => {
        const source = entry.sides.find(other => other.side === opposite(item.side));
        return {side: item.side, orders: takeNormalizedOrders(source.orders), truncated: source.truncated, quote: quoteFor(item.side)};
      })};
  }

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

  function sumFractions(values) {
    let n = 0n, d = 1n;
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    for (const value of values) {
      const common = gcd(d, value.d);
      n = n * (value.d / common) + value.n * (d / common);
      d *= value.d / common;
      const reduce = gcd(n < 0n ? -n : n, d);
      n /= reduce; d /= reduce;
    }
    return {n, d};
  }

  function payoutFraction(order) {
    if (order.money) return order.money.payout;
    const contracts = fraction(order.contracts);
    return contracts ? {n: contracts.n, d: contracts.d * BigInt(order.payout_divisor || 100)} : null;
  }

  // Decimal quantities preserve fractional Kalshi $1 contracts and Novig cents.
  function stakeFraction(orders, other = false) {
    const values = [];
    for (const order of orders) {
      if (order.money) { values.push(other ? order.money.opposite : order.money.stake); continue; }
      const p = fraction(order.probability);
      const payout = payoutFraction(order);
      if (!p || !payout) continue;
      values.push({n: (other ? p.d - p.n : p.n) * payout.n, d: p.d * payout.d});
    }
    return sumFractions(values);
  }

  function wholeStake(orders, other = false) {
    const amount = stakeFraction(orders, other);
    const whole = amount.n / amount.d;
    if (whole === 0n && amount.n > 0n) return '<$1';
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(Number(whole));
  }

  function takingOrders(raw, options = {}) {
    return takeNormalizedOrders(normalizeOrders(raw, options));
  }

  function takeNormalizedOrders(orders) {
    return orders.map(order => {
      if (order.money) {
        const implied = {n: order.money.implied.d - order.money.implied.n, d: order.money.implied.d};
        return {...order, probability: String(Number(implied.n) / Number(implied.d)), p: Number(implied.n) / Number(implied.d),
          odds: order.opposite_odds, opposite_odds: order.odds,
          stake_usd: order.opposite_stake_usd, opposite_stake_usd: order.stake_usd,
          money: {...order.money, implied, stake: order.money.opposite, opposite: order.money.stake}};
      }
      const probability = complementProbability(order.probability);
      const p = fraction(probability);
      const value = Number(p.n) / Number(p.d);
      return {probability, p: value, contracts: order.contracts, payout_divisor: order.payout_divisor, payout_usd: order.payout_usd,
        stake_usd: value * order.payout_usd, odds: americanFromFraction(p)};
    }).sort((a, b) => {
      const x = a.money?.implied || fraction(a.probability), y = b.money?.implied || fraction(b.probability);
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

  function normalizeOrders(raw, options = {}) {
    const provider = providerFor(options);
    if (!Array.isArray(raw) || raw.length > provider.maxLevels) return [];
    const orders = [];
    for (const order of raw) {
      if (!order || typeof order !== 'object') return [];
      if (provider.book === 'px') {
        // ProphetX reports USD available to take, not contracts or original maker stake.
        const take = impliedFraction(order.opposite_odds), available = fraction(order.opposite_stake_usd);
        if (!take || !available || available.n <= 0n || Number(available.n) / Number(available.d) > Number.MAX_SAFE_INTEGER) return [];
        const implied = {n: take.d - take.n, d: take.d};
        const stake = {n: available.n * (take.d - take.n), d: available.d * take.n};
        const payout = {n: available.n * take.d, d: available.d * take.n};
        const p = Number(implied.n) / Number(implied.d);
        if (![p, Number(stake.n) / Number(stake.d), Number(payout.n) / Number(payout.d)].every(Number.isFinite)) return [];
        const odds = Number(order.opposite_odds);
        orders.push({probability: String(p), p, odds: Math.abs(odds) === 100 ? 100 : -odds,
          opposite_odds: odds, stake_usd: Number(stake.n) / Number(stake.d),
          opposite_stake_usd: Number(available.n) / Number(available.d), payout_usd: Number(payout.n) / Number(payout.d),
          money: {implied, stake, opposite: available, payout}});
        continue;
      }
      const probability = fraction(order.probability);
      const contracts = typeof order.contracts === 'number' ? order.contracts : Number(order.contracts);
      const quantity = fraction(order.contracts);
      if (!probability || probability.n <= 0n || probability.n >= probability.d || !quantity || quantity.n <= 0n || !Number.isFinite(contracts) || contracts <= 0 || contracts > Number.MAX_SAFE_INTEGER || (provider.book === 'nv' && !Number.isSafeInteger(contracts))) return [];
      const p = Number(probability.n) / Number(probability.d);
      if (!Number.isFinite(p) || p <= 0 || p >= 1) return [];
      const payout = contracts / provider.divisor;
      orders.push({probability: String(order.probability), p, contracts: provider.book === 'kal' ? String(order.contracts) : contracts, payout_divisor: provider.divisor, payout_usd: payout, stake_usd: p * payout, opposite_stake_usd: (1 - p) * payout, odds: americanFromFraction(probability), opposite_odds: americanFromProbability(complementProbability(order.probability))});
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
      const p = order.money?.implied || fraction(order.probability);
      return implied && p && p.n * implied.d > implied.n * p.d;
    });
    const contracts = matching.reduce((sum, order) => sum + Number(order.contracts || 0), 0);
    const makerStake = matching.reduce((sum, order) => sum + order.stake_usd, 0);
    const oppositeStake = matching.reduce((sum, order) => sum + order.opposite_stake_usd, 0);
    const totalPayout = matching.reduce((sum, order) => sum + order.payout_usd, 0);
    const weightedProbability = totalPayout ? makerStake / totalPayout : null;
    const exactStake = stakeFraction(matching), exactThreshold = fraction(threshold);
    const payout = sumFractions(matching.map(payoutFraction));
    const weightedOdds = payout.n ? americanFromFraction({n: exactStake.n * payout.d, d: exactStake.d * payout.n}) : null;
    const substantial = matching.length > 0 && exactThreshold && exactStake.n * exactThreshold.d >= exactThreshold.n * exactStake.d;
    return {matching, contracts, makerStake, oppositeStake, weightedProbability, weightedOdds, substantial: Boolean(substantial), threshold};
  }

  const lazy = {token: undefined, generation: 0, cache: new Map(), pending: new Map(), errors: new Map()};
  const accessToken = () => typeof ACCESS_TOKEN === 'string' ? ACCESS_TOKEN : '';
  const accessIdentity = () => JSON.stringify([accessToken(), typeof CURR_USER === 'object' ? CURR_USER?.id : null,
    typeof CURR_USER === 'object' ? CURR_USER?.tier : null]);
  function syncAccess() {
    const token = accessToken(), access = accessIdentity();
    if (access !== lazy.access) {
      for (const request of lazy.pending.values()) request.controller.abort();
      lazy.cache.clear(); lazy.pending.clear(); lazy.errors.clear();
      lazy.token = token; lazy.access = access; lazy.generation++;
      hidePreview();
      if (state.dialog) {
        close();
        state.dialog.querySelector('#novig-depth-content').replaceChildren();
      }
    }
    return token;
  }
  function remember(map, key, value) {
    map.delete(key); map.set(key, value);
    while (map.size > 48) map.delete(map.keys().next().value);
  }
  function freezeEntry(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeEntry);
      Object.freeze(value);
    }
    return value;
  }
  function manifestContext(row, payload, options = {}) {
    if (!options.discover && !Object.prototype.hasOwnProperty.call(payload || {}, 'depthAvailable')) return null;
    const provider = providerFor(options), now = options.now ?? Date.now();
    const denied = reason => ({loadable: false, reason, provider});
    if (options.discover && (options.book || options.exchange) && !['nv', 'novig', 'kal', 'kalshi', 'px', 'prophetx'].includes(options.book || options.exchange)) return denied('Full depth is unavailable for this exchange.');
    const market = scorerMarket(row);
    if (!market || row.blurred || !row.game || !row.player) return denied('Depth is unavailable for this selection.');
    const manifest = payload.depthAvailable?.[row.game]?.[row.player]?.[provider.book];
    const start = payload.times?.[row.game];
    const observed = timestamp(manifest?.updated), expires = timestamp(manifest?.expires_at), starts = timestamp(start);
    if (![now, starts].every(Number.isFinite) || starts <= now) return denied('Depth does not match an upcoming game start.');
    if (!options.discover && (!manifest || typeof manifest !== 'object')) return denied(`No current ${provider.name} order book.`);
    if (!options.discover && (![observed, expires].every(Number.isFinite) || observed > now || observed >= starts
        || expires <= observed || expires > starts || expires <= now || now - observed > provider.maxAge)) {
      return denied(`${provider.name} depth expired or the game has started. Refresh for current data.`);
    }
    const date = row.dt || row.date;
    if (!date || date !== easternDate(starts) || (row.dt && row.date && row.dt !== row.date)) return denied('Depth does not match this game date.');
    const token = syncAccess();
    // Detail discovery and strict icons share one request/cache; each view applies its own freshness bounds.
    const key = JSON.stringify([market.sport, provider.book, row.game, row.player, start, token]);
    return {loadable: true, provider, market, manifest, start, observed: options.discover ? -Infinity : observed,
      expires: options.discover ? Infinity : expires, key, token, generation: lazy.generation};
  }

  function inspect(row, payload, options = {}) {
    syncAccess();
    const adapter = adapterFor(row);
    if (adapter) return inspectAdapter(row, payload, options, adapter);
    const context = manifestContext(row, payload, options);
    if (context) {
      const side = options.side || (row?.under ? 'under' : 'over');
      if (!context.loadable) return {available: false, side, ...context};
      if (options.discover) {
        const inline = inspectEntry(row, payload, options, payload?.[context.provider.field]?.[row.game]?.[row.player]);
        if (inline.available) return inline;
      }
      const cached = lazy.cache.get(context.key);
      if (cached && cached.expires > (options.now ?? Date.now()) && timestamp(cached.entry.updated) >= context.observed) {
        const result = inspectEntry(row, payload, options, cached.entry);
        if (result.available) return result;
        lazy.cache.delete(context.key);
      }
      const error = lazy.errors.get(context.key);
      const status = lazy.pending.has(context.key) ? 'loading' : error ? 'error' : 'idle';
      return {available: false, loadable: true, provider: context.provider, side, status,
        reason: error || (status === 'loading' ? `Loading ${context.provider.name} order book…` : `${context.provider.name} order book has not been loaded.`)};
    }
    return inspectEntry(row, payload, options, payload?.[providerFor(options).field]?.[row?.game]?.[row?.player]);
  }

  function load(row, payload, options = {}) {
    syncAccess();
    const adapter = adapterFor(row);
    if (adapter) return adapter.load(row, payload, providerFor(options).book, options).then(() => inspect(row, payload, options));
    const current = inspect(row, payload, options);
    if (current.available || !current.loadable) return Promise.resolve(current);
    const context = manifestContext(row, payload, options);
    if (lazy.pending.has(context.key)) return lazy.pending.get(context.key).promise.then(() => inspect(row, payload, options));
    if (current.status === 'error' && !options.retry) return Promise.resolve(current);
    if (lazy.pending.size >= 8) {
      remember(lazy.errors, context.key, 'Other order books are loading. Try again.');
      return Promise.resolve(inspect(row, payload, options));
    }
    lazy.errors.delete(context.key);
    const controller = new AbortController();
    const request = {controller, promise: null};
    const timer = root.setTimeout(() => controller.abort(), 15000);
    request.promise = Promise.resolve().then(async () => {
      const base = typeof API_BASE === 'string' ? API_BASE : root.location?.origin;
      const url = new URL(context.market.endpoint, base);
      for (const [key, value] of Object.entries({book: context.provider.book, game: row.game, player: row.player, start: context.start})) url.searchParams.set(key, value);
      const response = await root.fetch(url.toString(), {headers: {Authorization: `Bearer ${context.token}`}, signal: controller.signal});
      if (!response.ok) {
        const error = new Error('Unable to load this order book. Try again.');
        if (response.status === 404) error.message = 'This order book is no longer available. Refresh the table and try again.';
        if (response.status === 401 || response.status === 403) error.message = 'Sign in again to load this order book.';
        throw error;
      }
      const result = await response.json();
      const entry = result?.entry;
      if (result?.schemaVersion !== 1 || (result.sport ?? 'nhl') !== context.market.sport || result.book !== context.provider.book || result.game !== row.game
          || result.player !== row.player || timestamp(result.start) !== timestamp(context.start)
          || !entry || timestamp(entry.updated) < context.observed || !inspectEntry(row, payload, options, entry).available) {
        throw new Error('This order book does not match the current selection. Refresh the table and try again.');
      }
      syncAccess();
      const fresh = manifestContext(row, payload, {...options, discover: true});
      if (lazy.generation === context.generation && fresh?.loadable && fresh.key === context.key) {
        remember(lazy.cache, context.key, {entry: freezeEntry(entry), expires: timestamp(entry.expires_at)});
      }
    }).catch(error => {
      syncAccess();
      if (lazy.generation === context.generation) {
        const reason = error?.name === 'AbortError' ? 'The order book request timed out. Try again.' :
          /^This order book|^Sign in again/.test(error?.message || '') ? error.message : 'Unable to load this order book. Try again.';
        remember(lazy.errors, context.key, reason);
      }
    }).finally(() => {
      root.clearTimeout(timer);
      if (lazy.pending.get(context.key) === request) lazy.pending.delete(context.key);
    }).then(() => inspect(row, payload, options));
    lazy.pending.set(context.key, request);
    return request.promise;
  }

  function inspectEntry(row, payload, options, entry) {
    const provider = providerFor(options);
    const now = options.now ?? Date.now();
    const side = options.side === 'under' || options.side === 'over' ? options.side : row?.under ? 'under' : 'over';
    const unavailable = reason => ({available: false, reason, side});
    const market = scorerMarket(row);
    if (!market || row.blurred || !row.game || !row.player) return unavailable('Depth is unavailable for this selection.');
    if (!entry || entry.schema_version !== 1 || typeof entry.market_id !== 'string' || !entry.market_id || !Array.isArray(entry.sides)) return unavailable(`No current ${provider.name} resting orders.`);
    const observed = timestamp(entry.updated), expires = timestamp(entry.expires_at), starts = timestamp(entry.starts_at);
    if (![now, observed, expires, starts].every(Number.isFinite) || observed > now || observed >= starts || expires <= observed || expires > starts || now - observed > provider.maxAge || expires <= now || starts <= now) return unavailable(`${provider.name} depth expired or the game has started. Refresh for current data.`);
    const date = row.dt || row.date;
    if (!date || date !== easternDate(starts) || (row.dt && row.date && row.dt !== row.date)) return unavailable('Depth does not match this game date.');
    const feedStart = payload?.times?.[row.game];
    if (feedStart !== undefined) {
      const expected = timestamp(feedStart);
      if (!Number.isFinite(expected) || expected <= now || easternDate(expected) !== date || Math.abs(expected - starts) > 20 * 60 * 1000) return unavailable('Depth does not match this game start.');
    }
    if (entry.sides.length !== 2 || new Set(entry.sides.map(item => item?.side)).size !== 2 || !entry.sides.every(item => ['over', 'under'].includes(item?.side))) return unavailable(`No valid ${provider.name} depth for this market.`);
    const selected = entry.sides.find(item => item.side === side);
    const opposed = entry.sides.find(item => item.side === opposite(side));
    const orders = normalizeOrders(selected?.orders, options);
    const anyOrders = entry.sides.some(item => normalizeOrders(item.orders, options).length > 0);
    if (!anyOrders) return unavailable(`No current ${provider.name} resting orders.`);
    const quote = bestBook(row, options.updated || payload.updated, side, now);
    const availableBooks = ['over', 'under'].map(outcome => {
      const source = entry.sides.find(item => item.side === opposite(outcome));
      return {side: outcome, orders: takingOrders(source.orders, options), truncated: source.truncated === true,
        quote: bestBook(row, options.updated || payload.updated, outcome, now)};
    });
    return {available: true, side, entry, provider, market, maxLevels: provider.maxLevels, orders, takingOrders: takingOrders(opposed.orders, options), takingTruncated: opposed.truncated === true,
      availableBooks, truncated: selected.truncated === true, quote, comparison: compareOrders(orders, quote), now};
  }

  function pagePayload() {
    return typeof RES !== 'undefined' && RES ? RES : {};
  }

  function pageUpdated(payload) {
    return typeof UPDATED !== 'undefined' && typeof PAGE !== 'undefined' && UPDATED?.[PAGE] ? UPDATED[PAGE] : payload.updated;
  }

  const state = {dialog: null, row: null, opener: null, book: 'nv', side: 'over', mode: 'available', timer: null, iconTimer: null, observer: null, generation: 0};
  const icon = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 16V9m5 7V4m5 12V7m4 9H1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const preview = {element: null, trigger: null, row: null, showTimer: null, hideTimer: null, suppressFocus: false, generation: 0};

  function hidePreview() {
    preview.generation++;
    root.clearTimeout(preview.showTimer);
    root.clearTimeout(preview.hideTimer);
    preview.showTimer = preview.hideTimer = null;
    const trigger = preview.trigger;
    if (trigger) {
      const ids = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'orderbook-preview');
      if (ids.length) trigger.setAttribute('aria-describedby', ids.join(' '));
      else trigger.removeAttribute('aria-describedby');
    }
    if (preview.element) preview.element.hidden = true;
    preview.trigger = preview.row = null;
  }

  function deferHidePreview() {
    root.clearTimeout(preview.showTimer);
    root.clearTimeout(preview.hideTimer);
    preview.hideTimer = root.setTimeout(hidePreview, 160);
  }

  function positionPreview() {
    const rect = preview.trigger.getBoundingClientRect();
    const box = preview.element.getBoundingClientRect();
    const margin = 8, gap = 6;
    const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - box.width / 2, root.innerWidth - box.width - margin));
    const below = rect.bottom + gap;
    const top = below + box.height <= root.innerHeight - margin ? below : Math.max(margin, rect.top - box.height - gap);
    preview.element.style.left = `${left}px`;
    preview.element.style.top = `${top}px`;
  }

  function refreshPreview() {
    const trigger = preview.trigger;
    if (!trigger || !preview.element || preview.element.hidden) return;
    const rect = trigger.getBoundingClientRect();
    if (!trigger.isConnected || trigger.disabled || !rect.width || !rect.height || rect.bottom <= 0 || rect.top >= root.innerHeight || state.dialog?.open) return hidePreview();
    const payload = pagePayload();
    const row = currentRow(payload, preview.row);
    const current = trigger.novigDepthRow?.();
    if (!current || currentRow({data: [current]}, preview.row) === null) return hidePreview();
    const result = inspect(row, payload, {book: trigger.dataset.depthBook, updated: pageUpdated(payload)});
    if (preview.trigger !== trigger) return;
    if (!result.available && !result.loadable) return hidePreview();
    const html = result.available ? renderPreview(result, row) : renderLoading(result, true);
    if (preview.element.innerHTML !== html) preview.element.innerHTML = html;
    positionPreview();
  }

  function showPreview(trigger) {
    hidePreview();
    if (!trigger.isConnected || trigger.disabled || state.dialog?.open) return;
    if (!preview.element) {
      preview.element = document.createElement('div');
      preview.element.id = 'orderbook-preview';
      preview.element.setAttribute('role', 'tooltip');
      preview.element.addEventListener('pointerenter', () => root.clearTimeout(preview.hideTimer));
      preview.element.addEventListener('pointerleave', () => {
        if (!preview.trigger?.matches(':focus-visible')) deferHidePreview();
      });
      document.body.appendChild(preview.element);
    }
    preview.trigger = trigger;
    preview.row = trigger.novigDepthRow?.() || null;
    preview.element.hidden = false;
    const generation = ++preview.generation, token = accessToken();
    load(currentRow(pagePayload(), preview.row), pagePayload(), {book: trigger.dataset.depthBook}).then(() => {
      if (generation === preview.generation && token === accessToken()) refreshPreview();
    });
    refreshPreview();
    if (preview.trigger) {
      const ids = new Set((trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add('orderbook-preview');
      trigger.setAttribute('aria-describedby', [...ids].join(' '));
    }
  }

  function queuePreview(trigger) {
    hidePreview();
    preview.showTimer = root.setTimeout(() => showPreview(trigger), 180);
  }

  function createTrigger(getRow, options = {}) {
    const provider = providerFor(options);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nv-depth-trigger';
    button.setAttribute('aria-label', `View ${provider.name} order book for ${getRow().player || getRow().game}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = icon;
    button.novigDepthRow = getRow;
    button.dataset.depthBook = provider.book;
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch' && root.matchMedia('(any-hover: hover)').matches) queuePreview(button);
    });
    button.addEventListener('pointerleave', () => { if (!button.matches(':focus-visible')) deferHidePreview(); });
    button.addEventListener('focus', () => { if (!preview.suppressFocus && button.matches(':focus-visible')) queuePreview(button); });
    button.addEventListener('blur', () => { if (!button.matches(':hover') && !preview.element?.matches(':hover')) deferHidePreview(); });
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(getRow(), button, {book: provider.book}); });
    if (!state.iconTimer) state.iconTimer = root.setInterval(() => {
      const payload = pagePayload();
      document.querySelectorAll('.nv-depth-trigger').forEach(trigger => {
        const provider = providerFor({book: trigger.dataset.depthBook});
        const result = inspect(currentRow(payload, trigger.novigDepthRow?.() || null), payload, {book: provider.book});
        trigger.disabled = !result.available && !result.loadable;
        if (!trigger.disabled) trigger.removeAttribute('title');
        else trigger.title = result.reason;
      });
      refreshPreview();
    }, 1000);
    return button;
  }

  // Cards do not use Tabulator formatters. Add the same shortcut to each book tile.
  function enhanceCards() {
    const containers = ['card-container', 'card-modal-inner'].map(id => document.getElementById(id)).filter(Boolean);
    if (!containers.length) return;
    if (!state.observer) state.observer = new MutationObserver(enhanceCards);
    for (const container of containers) state.observer.observe(container, {childList: true, subtree: true});
    const payload = pagePayload();
    containers.flatMap(container => [...container.querySelectorAll('.data-card')]).forEach(card => {
      const row = card.playerLinesData;
      for (const provider of Object.values(PROVIDERS)) {
        const options = {book: provider.book};
        const previous = card.querySelector(`.nv-depth-trigger[data-depth-book="${provider.book}"]`);
        const result = inspect(row, payload, options);
        if (!result.available && !result.loadable) { previous?.remove(); continue; }
        if (previous) continue;
        const book = card.querySelector(`.book-logo-small[alt="${provider.book}"]`)?.closest('.book-odd-item');
        const target = book || card.querySelector('.card-header');
        if (!target) continue;
        const trigger = createTrigger(() => card.playerLinesData, options);
        trigger.classList.add('nv-depth-card-trigger');
        if (!book) trigger.insertAdjacentHTML('beforeend', `<span>${provider.book.toUpperCase()} depth</span>`);
        target.appendChild(trigger);
      }
    });
  }

  function formatter(baseFormatter, options = {}) {
    return function (cell, params, onRendered) {
      const original = baseFormatter(cell, params, onRendered);
      const row = cell.getRow().getData();
      const result = inspect(row, pagePayload(), options);
      if ((!result.available && !result.loadable) || params?.blurOdds) return original;
      const wrapper = document.createElement('div');
      wrapper.className = 'nv-depth-cell';
      const odds = document.createElement('div');
      odds.className = 'nv-depth-existing-odds';
      if (original instanceof root.Node) odds.appendChild(original);
      else odds.innerHTML = original ?? '';
      const button = createTrigger(() => cell.getRow().getData(), options);
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
    dialog.addEventListener('click', event => { if (event.target.closest('[data-depth-retry]')) requestModal(true); });
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
      state.generation++;
      // Native dialog focus restoration can queue a preview before this event fires.
      hidePreview();
      root.clearInterval(state.timer); state.timer = null;
      const opener = state.opener; state.opener = null;
      preview.suppressFocus = true;
      if (opener?.isConnected) opener.focus({preventScroll: true});
      preview.suppressFocus = false;
    });
    document.body.appendChild(dialog);
    state.dialog = dialog;
    root.addEventListener('odds-rendered', refresh);
    return dialog;
  }

  function currentRow(payload, previous = state.row) {
    if (!previous || !Array.isArray(payload.data)) return null;
    return payload.data.find(row => row && row.game === previous.game && row.player === previous.player && row.prop === previous.prop && Boolean(row.under) === Boolean(previous.under) && Number(row.handicap) === Number(previous.handicap) && (row.dt || row.date) === (previous.dt || previous.date)
      && (!row.gameId || !previous.gameId || row.gameId === previous.gameId) && (!row.sport || !previous.sport || row.sport === previous.sport)) || null;
  }

  function quoteLink(quote, side) {
    // Scorer feed links are saved Yes selections, even on Under rows.
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
    const payout = sumFractions(orders.map(payoutFraction));
    if (!payout.n) return null;
    const amount = stakeFraction(orders);
    return americanFromFraction({n: amount.n * payout.d, d: amount.d * payout.n});
  }

  function renderAvailable(result) {
    const books = result.availableBooks;
    const maximum = Math.max(0, ...books.flatMap(book => book.orders.map(order => order.stake_usd)));
    const panels = books.map(({side, orders, quote, truncated}) => {
      const label = outcomeName(side, result.market);
      const rows = orders.map(order => {
        const width = maximum ? order.stake_usd / maximum * 100 : 0;
        const value = wholeStake([order]);
        return `<li class="nv-depth-chart-row" aria-label="${label} ${american(order.odds)}, ${escape(value)} available"><span class="nv-depth-chart-odds">${american(order.odds)}</span><span class="nv-depth-chart-track"><span class="nv-depth-chart-fill" aria-hidden="true" style="--depth-width:${width.toFixed(4)}%"></span><span class="nv-depth-chart-amount" title="${escape(dollars(order.stake_usd))}">${escape(compactStake([order]))}</span></span></li>`;
      }).join('');
      const average = availableAverage(orders);
      return `<section class="nv-depth-book" data-book-side="${side}" aria-label="${label} ${escape(sideName(side, result.market))} order book"><header class="nv-depth-book-header"><h3>${label}</h3><span>${escape(sideName(side, result.market))}</span></header><p class="nv-depth-book-caption">Available to take</p>${orders.length ? `<ol class="nv-depth-chart" aria-label="${label} prices and available stakes">${rows}</ol>` : `<p class="nv-depth-chart-empty">No ${label} liquidity available</p>`}<div class="nv-depth-book-total"><span>Total available</span><strong>${escape(wholeStake(orders))}</strong>${average !== null ? `<span class="nv-depth-book-average">at <b>${label} ${american(average)}</b> avg</span>` : ''}</div><p class="nv-depth-book-quote nv-depth-best">${quote ? `<span>Best sportsbook</span>${bookPrice(quote, side)}` : 'No fresh sportsbook price'}</p>${truncated ? `<p class="nv-depth-note">Top ${result.maxLevels || 20} price levels shown.</p>` : ''}</section>`;
    }).join('');
    return `<div class="nv-depth-books" style="--depth-rows:${Math.max(1, ...books.map(book => book.orders.length))}">${panels}</div><p class="nv-depth-chart-key">Bars use the same dollar scale on both sides. Average odds cover the displayed liquidity.</p>${observedFooter(result.entry)}`;
  }

  function renderPreview(result, row) {
    if (!result.available) return '';
    const books = result.availableBooks.map(book => ({...book, orders: book.orders.slice(0, 3)}));
    const maximum = Math.max(0, ...books.flatMap(book => book.orders.map(order => order.stake_usd)));
    return `<header class="nv-depth-preview-header"><strong>${escape(row.player || row.game)}</strong><span>${escape(result.provider?.name || 'Novig')} · ${escape(result.market?.title || '')} · Available to take</span></header><div class="nv-depth-preview-books">${books.map(({side, orders}) =>
      `<section class="nv-depth-preview-side" data-preview-side="${side}" aria-label="${outcomeName(side, result.market)} ${escape(sideName(side, result.market))}"><h3>${outcomeName(side, result.market)} <small>${escape(sideName(side, result.market))}</small></h3>${orders.length ? `<ol>${orders.map(order => `<li class="nv-depth-preview-level"><b class="nv-depth-preview-odds">${american(order.odds)}</b><span class="nv-depth-preview-size" style="--preview-fill:${(maximum ? order.stake_usd / maximum * 100 : 0).toFixed(3)}%">${escape(compactStake([order]))}</span></li>`).join('')}</ol><p class="nv-depth-preview-total">Shown <strong>${escape(wholeStake(orders))}</strong></p>` : '<p class="nv-depth-preview-empty">No liquidity</p>'}</section>`
    ).join('')}</div><footer>Top 3 prices per side · Before fees<br>Click icon for full book</footer>`;
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
      summary = `<p class="nv-depth-best">Best fresh ${escape(sideName(side, result.market).toLowerCase())} price: ${book} <span>(${percent(quote.probability)} implied)</span></p>`;
      if (comparison.matching.length) {
        summary += `<p class="nv-depth-comparison ${comparison.substantial ? 'nv-depth-comparison-strong' : ''}">Better price than resting orders · ${escape(wholeStake(comparison.matching))} maker stake${comparison.substantial ? '' : ` · below ${dollars(comparison.threshold)} highlight threshold`}</p><div class="nv-depth-metrics"><div><span>Matching maker stake · ${escape(sideName(side, result.market))}</span><strong>${escape(wholeStake(comparison.matching))}</strong></div><div><span>Opposite taker stake · ${escape(sideName(other, result.market))}</span><strong>${escape(wholeStake(comparison.matching, true))}</strong></div><div><span>Average requested odds</span><strong>${american(comparison.weightedOdds)} <small>${percent(comparison.weightedProbability)}</small></strong></div></div>`;
      } else summary += '<p>No sportsbook price is better than these resting-order prices.</p>';
    }
    const rows = orders.map(order => `<tr${matching.has(order) ? ' class="nv-depth-matching"' : ''}><td>${american(order.odds)}<small>${escape(order.probability)} probability</small></td><td>${escape(wholeStake([order]))}</td><td><div class="nv-depth-bar" aria-hidden="true" style="--depth-width:${Math.max(1, order.opposite_stake_usd / maxStake * 100).toFixed(2)}%"></div><span>${american(order.opposite_odds)}</span><strong>${escape(wholeStake([order], true))}</strong></td></tr>`).join('');
    return `<section class="nv-depth-summary">${summary}</section><p class="nv-depth-explainer">These resting bids want <strong>${escape(sideName(side, result.market))}</strong>. Taking them backs <strong>${escape(sideName(other, result.market))}</strong>. Maker stake and opposite taker stake are different amounts.</p><div class="nv-depth-totals"><span>Displayed maker stake <strong>${escape(wholeStake(orders))}</strong></span><span>Opposite taker stake <strong>${escape(wholeStake(orders, true))}</strong></span></div>${orders.length ? `<div class="nv-depth-table-wrap"><table class="nv-depth-table"><thead><tr><th scope="col">Maker wants<br>${escape(sideName(side, result.market))} odds</th><th scope="col">Maker<br>stake</th><th scope="col">Available to take · ${escape(sideName(other, result.market))}<br>Odds / taker stake</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="nv-depth-empty">No resting orders want ${escape(sideName(side, result.market).toLowerCase())} in this snapshot.</p>`}<p class="nv-depth-note">Bars show opposite taker stake. Amounts are shown in whole dollars, rounded down; calculations use full precision. ${result.truncated ? `Only the top ${result.maxLevels || 20} price levels are shown. ` : ''}Amounts and prices are before fees. Orders may change before a fill.</p><footer class="nv-depth-footer"><span>Observed ${escape(new Date(timestamp(entry.updated)).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'}))}</span><p>Pending orders are not completed bets or fair value. ${result.market?.outcomes ? "Links open only the saved row selection." : "Yes links open the saved sportsbook selection; No links are unavailable."} This view places no bets.</p></footer>`;
  }

  function renderLoading(result, compact = false) {
    const waiting = result.status === 'loading';
    return `<div class="nv-depth-unavailable" role="status" aria-live="polite"><p>${escape(result.reason)}</p>${waiting ? '' :
      compact ? '<p>Open the order book to try again.</p>' : '<button type="button" data-depth-retry>Retry</button>'}</div>`;
  }

  function requestModal(retry = false) {
    const generation = ++state.generation, token = accessToken();
    const payload = pagePayload();
    load(currentRow(payload), payload, {book: state.book, retry}).then(() => {
      if (state.dialog?.open && generation === state.generation && token === accessToken()) refresh();
    });
    refresh();
  }

  function refresh() {
    if (!state.dialog?.open || !state.row) return;
    const payload = pagePayload();
    const row = currentRow(payload);
    const result = inspect(row, payload, {book: state.book, side: state.side, updated: pageUpdated(payload)});
    const dialog = state.dialog;
    if (!dialog.open) return;
    const provider = providerFor({book: state.book});
    const market = result.market || displayMarket(state.row, payload) || {};
    dialog.querySelector('.nv-depth-eyebrow').textContent = `${provider.name.toUpperCase()} · ORDER BOOK`;
    dialog.querySelector('.nv-depth-close').setAttribute('aria-label', `Close ${provider.name} depth`);
    dialog.querySelector('#novig-depth-title').textContent = state.row.player || state.row.game;
    dialog.querySelector('#novig-depth-subtitle').textContent = [state.row.game, state.row.dt || state.row.date, market.title].filter(Boolean).join(' · ');
    dialog.querySelectorAll('[data-depth-side]').forEach(button => {
      const side = button.dataset.depthSide;
      button.textContent = market.outcomes ? sideName(side, market) : `${outcomeName(side)} · ${sideName(side, market)}`;
      button.setAttribute('aria-pressed', String(side === state.side));
    });
    dialog.querySelectorAll('[data-depth-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.depthMode === state.mode)));
    dialog.querySelector('.nv-depth-tabs').hidden = state.mode === 'available';
    const content = dialog.querySelector('#novig-depth-content');
    const html = result.loadable ? renderLoading(result) : renderResult(result, state.mode);
    if (content.innerHTML !== html) {
      const hadFocus = content.contains(document.activeElement);
      content.innerHTML = html;
      if (hadFocus) dialog.querySelector(state.mode === 'resting' ? `[data-depth-side="${state.side}"]` : '[data-depth-mode="available"]').focus({preventScroll: true});
    }
  }

  function open(row, opener, options = {}) {
    syncAccess();
    hidePreview();
    const dialog = ensureDialog();
    state.row = row;
    state.book = providerFor(options).book;
    state.side = row.under ? 'under' : 'over';
    state.mode = 'available';
    state.opener = opener || document.activeElement;
    if (!dialog.open) dialog.showModal();
    requestModal(true);
    dialog.querySelector('.nv-depth-close').focus({preventScroll: true});
    root.clearInterval(state.timer);
    state.timer = root.setInterval(refresh, 1000);
  }

  if (typeof document !== 'undefined') {
    root.addEventListener('odds-rendered', enhanceCards);
    root.addEventListener('odds-rendered', refreshPreview);
    root.addEventListener('scroll', event => { if (event.target !== preview.element) hidePreview(); }, true);
    root.addEventListener('resize', hidePreview);
    document.addEventListener('pointerdown', hidePreview);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hidePreview(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (preview.trigger || preview.showTimer)) {
        hidePreview();
      }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceCards, {once: true});
    else enhanceCards();
  }
  const api = {scorerMarket, MAX_AGE_MS, MIN_SIGNAL_STAKE_USD, formatter, open, close, refresh, inspect, load, normalizeOrders, compareOrders, bestBook, safeLink, quoteLink, timestamp, easternDate, impliedFraction,
    complementProbability, takingOrders, wholeStake, americanFromProbability, renderResult, renderPreview};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovigDepth = api;
})(typeof window !== 'undefined' ? window : globalThis);
