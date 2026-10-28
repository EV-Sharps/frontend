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
  const openKeys = new Set();
  let modalKey = null;
  const notice = (id, message) => { $(id).textContent = message; $(id).hidden = !message; };
  function filters() {
    const support = $('support-preset').value === 'custom' ? $('support-custom').value : $('support-preset').value;
    return {sport: $('sport-filter').value, book: $('book-filter').value, search: $('search-filter').value,
      support: support.trim() === '' ? NaN : Number(support), advantage: $('advantage-filter').value.trim() === '' ? NaN : Number($('advantage-filter').value),
      exchange: $('exchange-filter').value, freshness: Number($('freshness-filter').value)};
  }
  function offerMarkup(offer) {
    const label = `${esc(name(offer.book))} ${esc(odds(offer.odds))}`, url = report?.demo ? null : safeLink(offer.url);
    return url ? `<a class="rec-offer" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><strong>${label}</strong><span aria-hidden="true">↗</span></a>` : `<span class="rec-offer"><strong>${label}</strong></span>`;
  }
  function persistence(history) {
    return Number.isInteger(history?.observations) && history.observations > 0 && Number.isFinite(stamp(history.firstSeen))
      ? `<strong>${history.observations} capture${history.observations === 1 ? '' : 's'}</strong><small>First ${esc(time(history.firstSeen))}</small>` : '<span>No saved history</span>';
  }
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
  function setModalPayload(row, offer) {
    const sideOdds = row.side === 'under' ? `/${offer.odds}` : String(offer.odds);
    const selected = {sport: row.sport, prop: row.prop, game: row.game, player: row.player, handicap: .5,
      under: row.side === 'under', dt: localDay(stamp(row.startsAt)), bookOdds: {[offer.book]: sideOdds}, links: {[offer.book]: offer.url}};
    RES = {data: [selected], times: {[row.game]: row.startsAt}, updated: {[offer.book]: offer.updated},
      depthAvailable: {[row.game]: {[row.player]: Object.fromEntries(offer.venues.map(venue => [venue.book, {updated: venue.updated, expires_at: venue.expiresAt}]))}}};
  }
  function renderRow(group, index, now) {
    const {row, offer, alternatives} = group, key = rowKey(row);
    const main = document.createElement('tr'), detail = document.createElement('tr');
    main.className = 'rec-pick'; main.dataset.key = key; main.dataset.book = offer.book;
    detail.className = 'rec-detail-row'; detail.id = `sm-detail-${index}`;
    const outcome = MARKETS[row.sport][row.side === 'over' ? 'yes' : 'no'];
    main.innerHTML = `<td class="sm-player"><strong>${esc(title(row.player))}</strong><small class="sm-outcome">${esc(row.sport.toUpperCase())} · ${esc(outcome)}</small><small>${esc(row.game.toUpperCase())} · ${esc(time(row.startsAt))}</small></td>
      <td class="sm-book" data-label="Book / price">${offerMarkup(offer)}</td>
      <td class="sm-support" data-label="Supporting stake"><strong>${esc(dollars(offer.supportStake))}</strong><small>Same-outcome resting stake</small></td>
      <td class="sm-advantage" data-label="Price advantage"><strong>${esc(percent(offer.priceAdvantagePct))}</strong><small>Orders average ${esc(odds(offer.weightedOdds))}</small></td>
      <td data-label="Exchanges"><div class="sm-venues">${offer.venues.map(venue => `<span class="sm-venue">${esc(name(venue.book))}</span>`).join('')}</div></td>
      <td data-label="Observed"><span>${esc(time(offer.observedAt))}</span><small>Oldest included quote</small></td>
      <td data-label="Saved captures">${persistence(offer.history)}</td>
      <td class="rec-details-cell"><button type="button" class="rec-toggle" aria-controls="${detail.id}" aria-label="Details for ${esc(title(row.player))} ${esc(outcome)}">Details <span aria-hidden="true">⌄</span></button></td>`;
    detail.innerHTML = `<td colspan="8"><div class="sm-detail"><h2>${esc(title(row.player))} · ${esc(outcome)}</h2><div class="sm-detail-grid"><section><h3>Other sportsbook offers</h3><p>Fresh offers on this outcome. Support uses the selected exchange filter. The highlighted offer meets every active filter.</p><ul class="sm-offers">${alternatives.map(alternative => `<li${alternative.book === offer.book ? ' class="is-selected"' : ''}>${offerMarkup(alternative)}<div class="sm-offer-context"><span>${esc(dollars(alternative.supportStake))} support · ${esc(percent(alternative.priceAdvantagePct))} price advantage</span><small>Quote ${esc(time(alternative.updated))}</small></div></li>`).join('')}</ul></section>
      <section><h3>Qualifying resting interest for ${esc(name(offer.book))} ${esc(odds(offer.odds))}</h3><ul class="sm-venue-list">${offer.venues.map(venue => `<li><div><strong>${esc(name(venue.book))}: ${esc(dollars(venue.supportStake))} supporting stake</strong><small>${esc(dollars(venue.oppositeStake))} opposite taker stake · ${venue.levels} qualifying level${venue.levels === 1 ? '' : 's'}</small><small>Updated ${esc(time(venue.updated))}</small></div>${report?.demo ? '' : `<button type="button" data-depth-book="${venue.book}">Full order book</button>`}</li>`).join('')}</ul><p>${report?.demo ? 'Full order books are available with live snapshots.' : 'Only orders accepting a shorter price than this sportsbook quote contribute. The full order book also includes nonqualifying levels.'}</p></section></div><section class="sm-history"><h3>Support captured over time</h3>${chart(offer.history, offer.book, now)}</section></div></td>`;
    const toggle = main.querySelector('.rec-toggle');
    const expand = open => { toggle.setAttribute('aria-expanded', String(open)); detail.hidden = !open; main.classList.toggle('is-expanded', open); if (open) openKeys.add(key); else openKeys.delete(key); };
    toggle.addEventListener('click', () => expand(detail.hidden)); expand(openKeys.has(key));
    detail.querySelectorAll('[data-depth-book]').forEach(button => button.addEventListener('click', () => mountDepth(row, offer, button.dataset.depthBook, button)));
    const fragment = document.createDocumentFragment(); fragment.append(main, detail); return fragment;
  }
  function render() {
    if (!report) return;
    const now = Date.now(), selected = filters(), groups = selectRows(report, selected, now);
    const all = selectRows(report, {support: 0, advantage: 0}, now), visible = groups.slice(0, visibleLimit);
    const focused = document.activeElement?.closest('tr')?.dataset.key;
    $('picks').replaceChildren(...visible.map((group, index) => renderRow(group, index, now)));
    if (focused) [...$('picks').querySelectorAll('.rec-pick')].find(row => row.dataset.key === focused)?.querySelector('.rec-toggle')?.focus({preventScroll:true});
    $('row-count').textContent = groups.length;
    $('book-count').textContent = new Set(all.flatMap(group => group.alternatives.map(offer => offer.book))).size;
    $('venue-count').textContent = new Set(all.flatMap(group => group.alternatives.flatMap(offer => offer.venues.map(venue => venue.book)))).size;
    $('picks-table-wrap').hidden = !groups.length; $('empty-state').hidden = !!groups.length;
    $('list-caption').textContent = `${visible.length} of ${groups.length} selections · One row per player, game and outcome · Best qualifying price${selected.book ? ` at ${name(selected.book)}` : ' across books'} · Sorted by supporting stake`;
    $('show-more').hidden = visible.length >= groups.length;
    $('show-more').textContent = `Show ${Math.min(50, groups.length - visible.length)} more`;
    const stale = !currentReport(report, now);
    notice('freshness-status', stale ? 'This publication has expired. Saved prices are hidden while we wait for a fresh snapshot.' : '');
    $('empty-state').querySelector('h2').textContent = stale ? 'Waiting for fresh prices' : 'No offers match these filters';
    if (modalKey) {
      const group = groups.find(group => rowKey(group.row) === modalKey);
      if (group) setModalPayload(group.row, group.offer); else RES = {data:[]};
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
    report = null; RES = {data:[]}; modalKey = null; root.NovigDepth?.close(); openKeys.clear();
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
