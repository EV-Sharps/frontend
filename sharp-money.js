/* Saved price comparisons only. This page makes no requests to sportsbooks. */
(function (root) {
  'use strict';
  const MARKETS = {nhl: {prop: 'atgs', yes: 'Goal', no: 'No goal'}, nfl: {prop: 'attd', yes: 'Touchdown', no: 'No touchdown'}, mlb: {prop: 'hr', yes: 'Home run', no: 'No home run'}};
  const BOOKS = {fd: 'FanDuel', dk: 'DraftKings', fn: 'Fanatics', mgm: 'BetMGM', espn: 'theScore Bet', hr: 'Hard Rock', cz: 'Caesars', b365: 'bet365', bol: 'BetOnline', br: 'BetRivers', bv: 'Bovada', kambi: 'Kambi', fl: 'Fliff', re: 'Rebet', pn: 'Pinnacle', circa: 'Circa', nv: 'Novig', kal: 'Kalshi', px: 'ProphetX'};
  const REFERENCES = new Set(['pn', 'pinnacle', 'circa']);
  const EXCHANGES = new Set(['nv', 'kal', 'px']);
  const ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ESC[char]);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  const priceValid = price => finite(price) && Math.abs(price) >= 100;
  const decimal = price => price > 0 ? 1 + price / 100 : 1 - 100 / price;
  const american = p => p > 0 && p < 1 ? p <= .5 ? 100 * (1 - p) / p : -100 * p / (1 - p) : null;
  const odds = value => priceValid(value) ? `${value >= 0 || Math.round(Math.abs(value)) === 100 ? '+' : '-'}${Math.round(Math.abs(value)).toLocaleString('en-US')}` : '—';
  const dollars = value => finite(value) ? new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(Math.floor(value)) : '—';
  const percent = value => finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—';
  const name = book => BOOKS[book] || String(book || '').toUpperCase();
  const title = value => String(value || '').replace(/\b[a-z]/g, char => char.toUpperCase());
  const time = value => Number.isFinite(stamp(value)) ? new Date(value).toLocaleString('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}) : 'Unavailable';
  const localDay = value => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
  const safeLink = value => {
    if (typeof value !== 'string' || /[{}]/.test(value)) return null;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch (_) { return null; }
  };
  const rowKey = row => JSON.stringify([row.sport, row.prop, row.game, row.player, row.side, row.line, row.startsAt]);
  const venueCurrent = (venue, row, now, age) => EXCHANGES.has(venue?.book) && finite(venue.supportStake) && venue.supportStake > 0
    && finite(venue.oppositeStake) && venue.oppositeStake >= 0 && Number.isInteger(venue.levels) && venue.levels > 0
    && stamp(venue.updated) <= now && now - stamp(venue.updated) <= age && stamp(venue.expiresAt) > now
    && stamp(venue.expiresAt) <= stamp(row.startsAt);
  function currentReport(report, now) {
    return report?.schemaVersion === 1 && Array.isArray(report.data) && report.data.length <= 5000
      && Array.isArray(report.coverage) && Array.isArray(report.sports)
      && stamp(report.generatedAt) <= now && stamp(report.expiresAt) > now
      && now - stamp(report.generatedAt) <= 300000;
  }
  function validRow(row, now) {
    return !!row && Object.hasOwn(MARKETS, row.sport) && row.prop === MARKETS[row.sport].prop
      && ['over', 'under'].includes(row.side) && row.line === .5 && stamp(row.startsAt) > now
      && typeof row.game === 'string' && typeof row.player === 'string' && row.game && row.player
      && Array.isArray(row.offers);
  }
  function metricForOffer(row, offer, filters = {}, now = Date.now()) {
    const age = Math.min(300, Number(filters.freshness || 300)) * 1000;
    if (!(age > 0) || !offer || typeof offer.book !== 'string' || REFERENCES.has(offer.book.toLowerCase()) || EXCHANGES.has(offer.book)
      || !priceValid(offer.odds) || !Array.isArray(offer.venues) || stamp(offer.updated) > now
      || !(now - stamp(offer.updated) <= age) || !(stamp(offer.expiresAt) > now)
      || !(stamp(offer.expiresAt) <= stamp(row.startsAt))) return null;
    const venues = [], seen = new Set();
    for (const venue of offer.venues) {
      if (!venueCurrent(venue, row, now, age) || filters.exchange && venue.book !== filters.exchange) continue;
      if (seen.has(venue.book)) return null;
      seen.add(venue.book); venues.push(venue);
    }
    if (!venues.length) return null;
    const supportStake = venues.reduce((sum, venue) => sum + venue.supportStake, 0);
    const oppositeStake = venues.reduce((sum, venue) => sum + venue.oppositeStake, 0);
    const probability = supportStake / (supportStake + oppositeStake);
    const priceAdvantagePct = (decimal(offer.odds) * probability - 1) * 100;
    if (!finite(priceAdvantagePct) || priceAdvantagePct <= 0) return null;
    return {...offer, venues, supportStake, oppositeStake, weightedOdds: american(probability), priceAdvantagePct,
      observedAt: new Date(Math.min(stamp(offer.updated), ...venues.map(v => stamp(v.updated)))).toISOString()};
  }
  function selectRows(report, filters = {}, now = Date.now()) {
    if (!currentReport(report, now)) return [];
    const minSupport = Number(filters.support ?? 100), minAdvantage = Number(filters.advantage ?? 0);
    if (!Number.isFinite(minSupport) || minSupport < 0 || !Number.isFinite(minAdvantage) || minAdvantage < 0) return [];
    const merged = new Map(), search = String(filters.search || '').trim().toLowerCase();
    for (const row of report.data) {
      if (!validRow(row, now) || filters.sport && row.sport !== filters.sport
        || search && !`${row.player} ${row.game}`.toLowerCase().includes(search)) continue;
      const key = rowKey(row);
      if (!merged.has(key)) merged.set(key, {...row, offers: []});
      merged.get(key).offers.push(...row.offers);
    }
    const result = [];
    for (const row of merged.values()) {
      const offers = new Map();
      for (const raw of row.offers) {
        const offer = metricForOffer(row, raw, filters, now);
        if (offer && (!offers.has(offer.book) || stamp(offer.updated) > stamp(offers.get(offer.book).updated))) offers.set(offer.book, offer);
      }
      const alternatives = [...offers.values()].sort((a, b) => decimal(b.odds) - decimal(a.odds) || a.book.localeCompare(b.book));
      const qualifying = alternatives.filter(offer => (!filters.book || offer.book === filters.book)
        && offer.supportStake >= minSupport && offer.priceAdvantagePct + 1e-9 >= minAdvantage);
      if (qualifying.length) result.push({row, offer: qualifying[0], alternatives});
    }
    return result.sort((a, b) => b.offer.supportStake - a.offer.supportStake
      || b.offer.priceAdvantagePct - a.offer.priceAdvantagePct || a.row.player.localeCompare(b.row.player));
  }
  function historyPoints(history, now = Date.now()) {
    const points = Array.isArray(history?.points) ? history.points : [];
    return points.filter(point => stamp(point?.at) <= now && priceValid(point.odds)
      && finite(point.supportStake) && point.supportStake >= 0 && finite(point.priceAdvantagePct))
      .sort((a, b) => stamp(a.at) - stamp(b.at)).slice(-60);
  }
  root.SharpMoney = {selectRows, metricForOffer, historyPoints, safeLink, currentReport};
  if (!root.document) return;

  PAGE = 'sharp-money';
  // An explicit local preview can use the credential-free fixture server.
  // Never accept this override on a hosted page or point it at another host.
  if (IS_LOCALHOST) {
    const previewBase = new URLSearchParams(location.search).get('api');
    if (previewBase) try {
      const url = new URL(previewBase);
      if (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        && !url.username && !url.password && !url.search && !url.hash && ['/', '/api/sharp-money'].includes(url.pathname)) API_BASE = url.origin;
    } catch (_) { /* Invalid overrides never change the local API destination. */ }
  }
  SPORT = new URLSearchParams(location.search).get('sport') || '';
  if (!Object.hasOwn(MARKETS, SPORT)) SPORT = '';
  const $ = id => document.getElementById(id);
  $('sport-filter').value = SPORT;
  let report = null, pending = null, controller = null, authVersion = 0, sessionToken = '', visibleLimit = 50;
  let selectedKey = null, selectedGroup = null, detailSignature = '', detailVersion = 0, modalKey = null;
  const mobileLayout = root.matchMedia('(max-width: 900px)');
  const notice = (id, message) => { $(id).textContent = message; $(id).hidden = !message; };
  function filters() {
    const support = $('support-preset').value === 'custom' ? $('support-custom').value : $('support-preset').value;
    return {sport: $('sport-filter').value, book: $('book-filter').value, search: $('search-filter').value,
      support: support.trim() === '' ? NaN : Number(support), advantage: $('advantage-filter').value.trim() === '' ? NaN : Number($('advantage-filter').value),
      exchange: $('exchange-filter').value, freshness: Number($('freshness-filter').value)};
  }
  function offerMarkup(offer) {
    const label = `${esc(name(offer.book))} ${esc(odds(offer.odds))}`, url = report?.demo ? null : safeLink(offer.url);
    return url ? `<a class="rec-offer" data-offer-book="${esc(offer.book)}" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><strong>${label}</strong><span aria-hidden="true">↗</span></a>` : `<span class="rec-offer"><strong>${label}</strong></span>`;
  }
  function bookLogo(book) {
    if (!Object.hasOwn(BOOKS, book)) return `<span class="rec-book-fallback" aria-hidden="true">${esc(String(book).slice(0, 3).toUpperCase())}</span>`;
    return `<img class="rec-book-logo" src="logos/${book === 'kambi' ? 'parx' : book}.png" width="20" height="20" alt="" title="${esc(name(book))}">`;
  }
  const outcomeFor = row => MARKETS[row.sport][row.side === 'over' ? 'yes' : 'no'];
  const oppositeFor = row => MARKETS[row.sport][row.side === 'over' ? 'no' : 'yes'];
  const shortTime = value => new Date(value).toLocaleTimeString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'});
  const ageLabel = (value, now) => { const seconds = Math.max(0, Math.floor((now - stamp(value)) / 1000)); return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`; };
  const sourceLogos = venues => venues.map(venue => `<span title="${esc(name(venue.book))}">${bookLogo(venue.book)}<span class="sr-only">${esc(name(venue.book))}</span></span>`).join('');
  function chart(history, book, now) {
    const points = historyPoints(history, now);
    if (!points.length) return '<p class="sm-history-caption">No saved captures for this book yet.</p>';
    const first = stamp(points[0].at), last = stamp(points.at(-1).at), high = Math.max(1, ...points.map(point => point.supportStake));
    const x = point => points.length === 1 ? 275 : 45 + 465 * (stamp(point.at) - first) / Math.max(1, last - first);
    const y = point => 120 - 95 * point.supportStake / high;
    return `<svg class="sm-history-chart" viewBox="0 0 550 150" role="img" aria-label="Saved supporting-stake captures for ${esc(name(book))}"><line x1="45" y1="120" x2="520" y2="120"/><text x="5" y="28">${esc(dollars(high))}</text><text x="13" y="123">$0</text>${points.map(point => `<circle cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="3.5"><title>${esc(time(point.at))} · ${esc(odds(point.odds))} · ${esc(dollars(point.supportStake))} support · ${esc(percent(point.priceAdvantagePct))} price advantage</title></circle>`).join('')}<text x="45" y="143">${esc(new Date(first).toLocaleTimeString('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}))}</text><text x="520" y="143" text-anchor="end">${esc(new Date(last).toLocaleTimeString('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}))} ET</text></svg><p class="sm-history-caption">${points.length} saved all-exchange capture${points.length === 1 ? '' : 's'} for ${esc(name(book))}. Dots show observations, not continuous availability. Current filters do not recalculate history.</p>`;
  }
  function mountDepth(row, offer, book, opener) {
    modalKey = rowKey(row);
    setModalPayload(row, offer);
    root.NovigDepth?.open(RES.data[0], opener, {book});
  }
  function depthPayload(row, offer) {
    const sideOdds = row.side === 'under' ? `/${offer.odds}` : String(offer.odds);
    const selected = {sport: row.sport, prop: row.prop, game: row.game, player: row.player, handicap: .5,
      under: row.side === 'under', dt: localDay(stamp(row.startsAt)), bookOdds: {[offer.book]: sideOdds}, links: {[offer.book]: offer.url}};
    return {data: [selected], times: {[row.game]: row.startsAt}, updated: {[offer.book]: offer.updated},
      depthAvailable: {[row.game]: {[row.player]: Object.fromEntries(offer.venues.map(venue => [venue.book, {updated: venue.updated, expires_at: venue.expiresAt}]))}}};
  }
  function setModalPayload(row, offer) { RES = depthPayload(row, offer); }
  function renderRow(group, index, now) {
    const {row, offer} = group, key = rowKey(row), active = key === selectedKey;
    const main = document.createElement('article');
    main.className = `rec-pick sm-opportunity${active ? ' is-selected' : ''}`; main.dataset.key = key; main.dataset.book = offer.book;
    main.innerHTML = `<button type="button" class="rec-toggle sm-select" aria-controls="selection-panel" aria-pressed="${active}" aria-label="Details for ${esc(title(row.player))}, ${esc(outcomeFor(row))}">
      <span class="sm-card-head"><span class="sm-sport">${esc(row.sport.toUpperCase())}</span><span class="sm-game">${esc(row.game.toUpperCase())}</span><time class="sm-start" datetime="${esc(row.startsAt)}" title="${esc(time(row.startsAt))}">${esc(new Date(row.startsAt).toLocaleDateString('en-US', {timeZone:'America/New_York',month:'short',day:'numeric'}))} &middot; ${esc(shortTime(row.startsAt))} ET</time></span>
      <span class="sm-card-body"><span class="sm-support"><strong>${esc(dollars(offer.supportStake))}</strong><span>Supporting stake</span></span><span class="sm-card-selection">
      <span class="sm-player"><strong>${esc(title(row.player))}</strong><span class="sm-outcome">${esc(outcomeFor(row))}</span></span>
      <span class="sm-card-offer"><span class="sm-book">${bookLogo(offer.book)}<span>${esc(name(offer.book))}</span></span><strong class="sm-odds">${esc(odds(offer.odds))}</strong></span>
      <span class="sm-card-reference"><span>Resting ${row.side === 'under' ? 'No' : 'Yes'} orders</span><span class="sm-source-logos">${sourceLogos(offer.venues)}</span><strong>${esc(odds(offer.weightedOdds))} avg</strong></span></span></span>
      <span class="sm-card-foot"><span class="sm-advantage"><strong>${esc(percent(offer.priceAdvantagePct))}</strong> price advantage</span><span class="sm-age" title="Oldest included quote: ${esc(time(offer.observedAt))}">${esc(ageLabel(offer.observedAt, now))}</span><span aria-hidden="true">&#8594;</span></span></button>`;
    main.querySelector('.sm-select').addEventListener('click', () => {
      selectedKey = key;
      $('picks-table-wrap').classList.add('is-detail-open');
      render();
      if (mobileLayout.matches) { $('sm-detail-title')?.focus({preventScroll:true}); $('selection-panel').scrollIntoView({block:'start'}); }
    });
    return main;
  }
  function snapshotBars(offer) {
    const max = Math.max(1, ...offer.venues.map(venue => venue.supportStake));
    return `<div class="sm-depth-summary"><strong>Snapshot support by exchange</strong><span>${esc(dollars(offer.supportStake))} supporting stake</span></div><ul class="sm-support-bars">${offer.venues.map(venue => `<li class="sm-level"><span class="sm-level-sources" title="${esc(name(venue.book))}">${bookLogo(venue.book)}<span class="sr-only">${esc(name(venue.book))}</span></span><span class="sm-level-price" title="Average resting price">${esc(odds(american(venue.supportStake / (venue.supportStake + venue.oppositeStake))))}<small>avg</small></span><span class="sm-level-bar-track"><span class="sm-level-bar" style="width:${(100 * venue.supportStake / max).toFixed(3)}%"><span class="sm-level-segment" data-book="${venue.book}" style="width:100%"></span></span></span><strong class="sm-level-size">${esc(dollars(venue.supportStake))}</strong></li>`).join('')}</ul>`;
  }
  function renderDepth(group, version, retry = false) {
    if (!group || version !== detailVersion || !$('sm-depth-levels')) return;
    if (mobileLayout.matches && !$('picks-table-wrap').classList.contains('is-detail-open')) return;
    const {row, offer} = group, payload = depthPayload(row, offer), selected = payload.data[0], api = root.NovigDepth;
    const results = !report?.demo && api ? offer.venues.map(venue => ({book:venue.book, result:api.inspect(selected,payload,{book:venue.book,side:row.side})})) : [];
    const available = results.filter(item => item.result.available), merged = new Map();
    for (const {book, result} of available) {
      for (const order of result.comparison.matching) {
        const label = odds(order.opposite_odds);
        if (!merged.has(label)) merged.set(label,{odds:order.opposite_odds, amount:0, sources:new Map(), orders:[]});
        const level = merged.get(label);
        if (!level.sources.has(book)) level.sources.set(book,{book,amount:0,orders:[]});
        const source = level.sources.get(book);
        source.amount += order.opposite_stake_usd; source.orders.push(order);
        level.amount += order.opposite_stake_usd; level.orders.push(order);
      }
    }
    const levels = [...merged.values()].sort((a,b) => decimal(b.odds)-decimal(a.odds));
    const allOrders = levels.flatMap(level => level.orders), highest = Math.max(1,...levels.map(level => level.amount));
    let html = snapshotBars(offer);
    if (available.length) {
      const legend = available.map(({book}) => `<span data-book="${book}"><i aria-hidden="true"></i>${esc(name(book))}</span>`).join('');
      html = `<div class="sm-depth-summary"><div><strong>${esc(oppositeFor(row))}</strong><span>Available opposite-side stake</span></div><strong>${esc(api.wholeStake(allOrders,true))}</strong></div><div class="sm-depth-legend">${legend}</div>`;
      html += levels.length ? `<ul class="sm-ladder">${levels.slice(0,20).map(level => `<li class="sm-level" data-price="${esc(odds(level.odds))}"><span class="sm-level-sources">${[...level.sources.values()].map(source => `<span title="${esc(name(source.book))}">${bookLogo(source.book)}<span class="sr-only">${esc(name(source.book))}</span></span>`).join('')}</span><strong class="sm-level-price">${esc(odds(level.odds))}</strong><span class="sm-level-bar-track"><span class="sm-level-bar" style="width:${(100*level.amount/highest).toFixed(3)}%">${[...level.sources.values()].map(source => `<span class="sm-level-segment" data-book="${source.book}" style="width:${(100*source.amount/level.amount).toFixed(3)}%" title="${esc(name(source.book))}: ${esc(api.wholeStake(source.orders,true))}"></span>`).join('')}</span></span><strong class="sm-level-size">${esc(api.wholeStake(level.orders,true))}</strong></li>`).join('')}</ul>` : '<p class="sm-depth-note">No qualifying resting orders remain at this sportsbook price in the loaded books.</p>';
      html += `<p class="sm-depth-note">${levels.length > 20 ? `Showing the best 20 of ${levels.length} price levels. ` : ''}These ${esc(oppositeFor(row).toLowerCase())} offers are backed by orders on <strong>${esc(outcomeFor(row).toLowerCase())}</strong> accepting a shorter price than ${esc(odds(offer.odds))}. Bar amounts are opposite-side stake; the headline is supporting stake from the published snapshot.</p>`;
      html += `<p class="sm-depth-note">Depth observed ${available.map(({book,result}) => `${esc(name(book))} ${esc(time(result.entry.updated))}`).join(' &middot; ')}${available.some(({result})=>result.truncated) ? ' &middot; Some sources have more levels.' : ''}.</p>`;
    }
    if ($('sm-depth-levels').innerHTML !== html) $('sm-depth-levels').innerHTML = html;
    const requests = results.filter(({result}) => result.loadable && !result.available && (retry || result.status === 'idle'));
    const loading = requests.length > 0 || results.some(({result}) => result.status === 'loading');
    const failed = results.filter(({result}) => !result.available && !result.loadable || result.status === 'error');
    const status = report?.demo ? 'Demo shows aggregate support. Individual price levels load with live snapshots.'
      : loading ? 'Loading current price levels...'
      : failed.length ? `${failed.map(({book})=>name(book)).join(', ')} depth unavailable. ${available.length ? 'Only loaded exchanges are shown.' : 'Showing aggregate support from the snapshot.'}` : '';
    $('sm-depth-status').textContent = status;
    $('sm-depth-status').hidden = !status;
    $('sm-depth-retry').hidden = !failed.length || report?.demo === true;
    $('sm-depth-retry').disabled = loading;
    if (requests.length) {
      const access = authVersion;
      Promise.allSettled(requests.map(({book}) => api.load(selected,payload,{book,side:row.side,retry}))).then(() => {
        if (version !== detailVersion || access !== authVersion || !report || selectedKey !== rowKey(row)) return;
        if (!currentReport(report,Date.now()) || !metricForOffer(row,offer,filters())) { render(); return; }
        renderDepth(group,version);
      });
    }
  }
  function renderDetail(group, now) {
    if (!group) {
      selectedGroup = null; detailSignature = ''; detailVersion++;
      $('selection-content').replaceChildren(); $('selection-panel').hidden = true;
      $('picks-table-wrap').classList.remove('is-detail-open'); return;
    }
    selectedGroup = group;
    const {row,offer,alternatives} = group, signature = JSON.stringify([group,report.demo,filters().exchange,filters().freshness]);
    $('selection-panel').hidden = false;
    if (signature !== detailSignature) {
      const expanded = [...$('selection-content').querySelectorAll('details[open]')].map(element=>element.dataset.section);
      const focused = $('selection-content').contains(document.activeElement) ? document.activeElement : null;
      const focusTarget = focused ? {id:focused.id, book:focused.dataset.depthBook, offer:focused.dataset.offerBook,
        section:focused.matches('summary') ? focused.closest('details')?.dataset.section : null,
        featured:focused.classList.contains('sm-bet-link')} : null;
      detailSignature = signature; detailVersion++;
      const url = report.demo ? null : safeLink(offer.url);
      $('selection-content').innerHTML = `<div class="sm-detail"><div class="sm-detail-heading"><div class="sm-detail-support"><strong>${esc(dollars(offer.supportStake))}</strong><span>Supporting stake</span></div><div class="sm-detail-event"><span class="sm-sport">${esc(row.sport.toUpperCase())} &middot; ${esc(outcomeFor(row))}</span><h2 id="sm-detail-title" tabindex="-1">${esc(title(row.player))}</h2><p>${esc(row.game.toUpperCase())} &middot; ${esc(time(row.startsAt))}</p></div></div>
        <div class="sm-featured-offer"><div class="sm-featured-selection">${bookLogo(offer.book)}<div><strong>${esc(title(row.player))}</strong><span>${esc(outcomeFor(row))} &middot; ${esc(name(offer.book))}</span></div></div><div class="sm-featured-price"><strong>${esc(odds(offer.odds))}</strong><span>Book odds</span></div>${url ? `<a class="sm-bet-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open book <span aria-hidden="true">&#8599;</span></a>` : ''}</div>
        <div class="sm-detail-metrics"><div><strong>${esc(odds(offer.weightedOdds))}</strong><span>Resting orders avg</span></div><div class="sm-advantage"><strong>${esc(percent(offer.priceAdvantagePct))}</strong><span>Price advantage</span></div><div><strong>${offer.venues.length}</strong><span>Exchange${offer.venues.length === 1 ? '' : 's'} supporting</span></div></div>
        <section class="sm-orderbook" aria-labelledby="sm-depth-title"><div class="sm-depth-toolbar"><h3 id="sm-depth-title">Behind the price</h3><button id="sm-depth-retry" type="button" hidden>Retry depth</button></div><div id="sm-depth-levels"></div><p id="sm-depth-status" class="sm-depth-status" role="status" hidden></p><div class="sm-venue-actions">${report.demo ? '' : offer.venues.map(venue=>`<button type="button" data-depth-book="${venue.book}">${bookLogo(venue.book)}${esc(name(venue.book))} order book <span aria-hidden="true">&#8599;</span></button>`).join('')}</div></section>
        <details class="sm-detail-section" data-section="offers"><summary>Compare sportsbook offers <span>${alternatives.length}</span></summary><ul class="sm-offers">${alternatives.map(alternative=>`<li${alternative.book===offer.book ? ' class="is-selected"' : ''}><span class="sm-alternative-book">${bookLogo(alternative.book)}${offerMarkup(alternative)}</span><span class="sm-offer-context"><span>${esc(dollars(alternative.supportStake))} support</span><small>${esc(percent(alternative.priceAdvantagePct))} price advantage</small></span></li>`).join('')}</ul><p class="sm-detail-footnote">Fresh offers on this outcome. The highlighted book meets every active filter.</p></details>
        <details class="sm-detail-section sm-history" data-section="history"><summary>Support over time <span>${Number.isInteger(offer.history?.observations) ? offer.history.observations : 0} captures</span></summary>${chart(offer.history,offer.book,now)}</details>
        <p class="sm-detail-footnote">Snapshot observed ${esc(time(offer.observedAt))}. Pending orders, before fees. Price advantage is a payout comparison, not estimated EV.</p></div>`;
      for (const element of $('selection-content').querySelectorAll('details')) element.open = expanded.includes(element.dataset.section);
      $('selection-content').querySelectorAll('[data-depth-book]').forEach(button=>button.addEventListener('click',()=>mountDepth(row,offer,button.dataset.depthBook,button)));
      $('sm-depth-retry').addEventListener('click',()=>renderDepth(selectedGroup,detailVersion,true));
      if (focusTarget) {
        const candidates = [...$('selection-content').querySelectorAll('button, a, summary, [tabindex]')];
        const replacement = candidates.find(element => focusTarget.id ? element.id === focusTarget.id
          : focusTarget.book ? element.dataset.depthBook === focusTarget.book
          : focusTarget.offer ? element.dataset.offerBook === focusTarget.offer
          : focusTarget.section ? element.matches('summary') && element.closest('details')?.dataset.section === focusTarget.section
          : focusTarget.featured && element.classList.contains('sm-bet-link'));
        (replacement || $('sm-detail-title')).focus({preventScroll:true});
      }
    }
    renderDepth(group,detailVersion);
  }
  function render() {
    if (!report) return;
    const now = Date.now(), selected = filters(), groups = selectRows(report,selected,now);
    const all = selectRows(report,{support:0,advantage:0},now), visible = groups.slice(0,visibleLimit);
    const focused = document.activeElement?.closest('.sm-opportunity')?.dataset.key;
    const active = visible.find(group=>rowKey(group.row)===selectedKey) || visible[0];
    selectedKey = active ? rowKey(active.row) : null;
    $('picks').replaceChildren(...visible.map((group,index)=>renderRow(group,index,now)));
    if (focused) [...$('picks').querySelectorAll('.rec-pick')].find(row=>row.dataset.key===focused)?.querySelector('.rec-toggle')?.focus({preventScroll:true});
    $('row-count').textContent = groups.length;
    $('book-count').textContent = new Set(all.flatMap(group=>group.alternatives.map(offer=>offer.book))).size;
    $('venue-count').textContent = new Set(all.flatMap(group=>group.alternatives.flatMap(offer=>offer.venues.map(venue=>venue.book)))).size;
    $('picks-table-wrap').hidden = !groups.length; $('empty-state').hidden = !!groups.length;
    $('list-caption').textContent = `${visible.length} of ${groups.length} selections \u00b7 Best qualifying price${selected.book ? ` at ${name(selected.book)}` : ' across books'} \u00b7 Highest support first`;
    $('show-more').hidden = visible.length>=groups.length;
    $('show-more').textContent = `Show ${Math.min(50,groups.length-visible.length)} more`;
    const stale = !currentReport(report,now);
    notice('freshness-status',stale ? 'This publication has expired. Saved prices are hidden while we wait for a fresh snapshot.' : '');
    $('empty-state').querySelector('h2').textContent = stale ? 'Waiting for fresh prices' : 'No offers match these filters';
    renderDetail(active,now);
    if (modalKey) {
      const group = groups.find(group=>rowKey(group.row)===modalKey);
      if (group) setModalPayload(group.row,group.offer); else RES = {data:[]};
      root.NovigDepth?.refresh();
    }
  }
  function acceptReport(data) {
    if (data?.schemaVersion !== 1 || !Array.isArray(data.data) || data.data.length > 5000 || !Array.isArray(data.coverage)
      || !Array.isArray(data.sports) || !Number.isFinite(stamp(data.generatedAt)) || !Number.isFinite(stamp(data.expiresAt))) throw new Error('The Sharp Money snapshot is not available yet.');
    report = data;
    $('demo-status').hidden = data.demo !== true;
    const previous = $('book-filter').value;
    const books = new Set(data.data.flatMap(row => Array.isArray(row?.offers) ? row.offers.map(offer => offer?.book)
      .filter(book => typeof book === 'string' && book && !REFERENCES.has(book.toLowerCase()) && !EXCHANGES.has(book)) : []));
    $('book-filter').innerHTML = '<option value="">Best eligible book</option>' + [...books].sort((a,b) => name(a).localeCompare(name(b))).map(book => `<option value="${esc(book)}">${esc(name(book))}</option>`).join('');
    if (books.has(previous)) $('book-filter').value = previous;
    $('generated').textContent = `Published ${time(data.generatedAt)}`;
    $('coverage').innerHTML = '<p>Saved collection status before your filters. A sport may have no upcoming markets or current order books.</p><ul>' + data.coverage.map(item => `<li>${esc(String(item?.sport || '').toUpperCase())}: ${esc(item?.status || 'unavailable')}${Number.isInteger(item?.rows) && item.rows >= 0 ? ` · ${item.rows} selections` : ''}</li>`).join('') + '</ul>';
    $('report-content').hidden = false; $('report-content').setAttribute('aria-busy', 'false'); $('access-panel').hidden = true;
    render();
  }
  function clearReport() {
    report = null; RES = {data:[]}; modalKey = null; selectedKey = null; root.NovigDepth?.close(); renderDetail(null,Date.now());
    $('demo-status').hidden = true;
    $('picks').replaceChildren(); $('coverage').replaceChildren(); $('report-content').hidden = true;
    ['row-count','book-count','venue-count'].forEach(id => { $(id).textContent = '0'; });
    notice('freshness-status','');
  }
  function refresh() {
    if (pending) return pending;
    const version = authVersion;
    $('refresh').disabled = true; controller = new AbortController();
    const requestController = controller, timer = setTimeout(() => requestController.abort(), 15000);
    pending = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/sharp-money`, {headers: sessionToken ? {Authorization:`Bearer ${sessionToken}`} : {}, cache:'no-store', signal:requestController.signal});
        if (version !== authVersion) return;
        if ([401,403].includes(response.status)) { clearReport(); $('access-panel').hidden = false; $('generated').textContent = 'Sharp membership'; notice('request-status',''); return; }
        if (!response.ok) throw new Error('Unable to load Sharp Money. Try refreshing when the API is available.');
        const data = await response.json();
        if (version !== authVersion) return;
        acceptReport(data); notice('request-status','');
      } catch (error) {
        if (version !== authVersion) return;
        notice('request-status', error.name === 'AbortError' ? 'The request timed out. Try refreshing.'
          : error.name === 'TypeError' ? 'Unable to load Sharp Money. Try refreshing when the API is available.' : error.message);
        if (report) render(); else $('generated').textContent = 'Snapshot unavailable';
      } finally { clearTimeout(timer); $('refresh').disabled = false; controller = null; pending = null; }
    })();
    return pending;
  }
  const requestLatest = () => pending ? pending.then(refresh) : refresh();
  root.refreshSharpMoney = refresh;
  $('refresh').addEventListener('click',refresh);
  function changeFilters() { visibleLimit = 50; $('support-custom-label').hidden = $('support-preset').value !== 'custom'; render(); }
  ['sport-filter','book-filter','support-preset','exchange-filter','freshness-filter'].forEach(id => $(id).addEventListener('change',changeFilters));
  ['search-filter','support-custom','advantage-filter'].forEach(id => $(id).addEventListener('input',changeFilters));
  $('sport-filter').addEventListener('change',() => { SPORT = $('sport-filter').value; const url = new URL(location.href); if (SPORT) url.searchParams.set('sport',SPORT); else url.searchParams.delete('sport'); history.replaceState(null,'',url); });
  $('show-more').addEventListener('click',() => { visibleLimit += 50; render(); });
  $('back-to-list').addEventListener('click',() => {
    $('picks-table-wrap').classList.remove('is-detail-open');
    $('picks').querySelector('.is-selected .sm-select')?.focus({preventScroll:true});
    $('picks-table-wrap').scrollIntoView({block:'start'});
  });
  mobileLayout.addEventListener('change',render);
  ['account-link','access-login'].forEach(id => { $(id).href = `profile${HTML}`; }); $('access-pricing').href = `pricing${HTML}`;
  function setSession(session) {
    const token = session?.access_token || '';
    if (token === sessionToken) return;
    sessionToken = token; ACCESS_TOKEN = token; authVersion++; controller?.abort(); clearReport();
    $('account-link').textContent = token ? 'My account' : 'Sign in'; notice('request-status',''); requestLatest();
  }
  async function boot() {
    if (IS_LOCALHOST) { await refresh(); return; }
    try {
      if (!SB) throw new Error('No auth service');
      const {data,error} = await SB.auth.getSession(); if (error) throw error;
      sessionToken = data.session?.access_token || ''; ACCESS_TOKEN = sessionToken;
      $('account-link').textContent = sessionToken ? 'My account' : 'Sign in';
      SB.auth.onAuthStateChange((_event,session) => queueMicrotask(() => setSession(session)));
      await refresh();
    } catch (_) { clearReport(); $('generated').textContent = 'Sign-in unavailable'; notice('request-status','Sign-in service unavailable. Reload to try again.'); }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden') render(); },10000);
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); },60000);
  document.addEventListener('visibilitychange',() => { if (document.visibilityState !== 'hidden') { render(); refresh(); } });
  boot();
})(typeof globalThis === 'undefined' ? this : globalThis);
