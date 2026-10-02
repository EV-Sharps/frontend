/* Saved NHL offers are rechecked against the clock before every render. */
(() => {
  'use strict';
  PAGE = 'longshots';
  SPORT = 'nhl';
  const $ = id => document.getElementById(id);
  const timezone = 'America/New_York';
  const books = {fd: 'FanDuel', dk: 'DraftKings', fn: 'Fanatics', mgm: 'BetMGM', espn: 'theScore Bet',
    hr: 'Hard Rock', cz: 'Caesars', pn: 'Pinnacle', circa: 'Circa', bol: 'BetOnline',
    b365: 'bet365', br: 'BetRivers', bv: 'Bovada', kambi: 'Kambi', re: 'Rebet', fl: 'Fliff',
    nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket', mb: 'Matchbook'};
  const referenceOnly = new Set(['pn', 'circa']);
  const offeredBooks = data => [...new Set(data.books_checked)].filter(book => typeof book === 'string' && book && !referenceOnly.has(book));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
  const number = (value, places = 1) => numeric(value) ? Number(value).toFixed(places) : '-';
  const pct = value => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${number(value)}%` : '-';
  const odds = value => numeric(value) ? oddsDisplay(`${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}`) : '-';
  const title = value => String(value || '').replace(/\b[a-z]/g, c => c.toUpperCase());
  const bookName = book => books[book] || String(book || '').toUpperCase();
  const referenceName = value => String(value || '').split(';')[0].split('+').map(bookName).join(' + ');
  const localDay = now => new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
  const timeLabel = value => new Date(value).toLocaleTimeString('en-US', {timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short'});
  const gameTimeLabel = value => localDay(Date.parse(value)) === localDay(Date.now()) ? timeLabel(value)
    : new Date(value).toLocaleString('en-US', {timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'});
  const snapshotDay = data => data.slate_date || data.date || localDay(Date.parse(data.generated_at));
  const safeLink = value => {
    if (typeof value !== 'string' || /[{}]/.test(value)) return null;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  };
  const logo = book => Object.hasOwn(books, book) ? `<img class="rec-book-logo" src="logos/${esc(book)}.png" width="20" height="20" alt="">` : '';
  function position(value) {
    const key = String(value || '').toUpperCase().replace(/[ ._-]/g, '');
    return ({C: 'C', CENTER: 'C', CENTRE: 'C', LW: 'LW', LEFTWING: 'LW', LEFTWINGER: 'LW',
      RW: 'RW', RIGHTWING: 'RW', RIGHTWINGER: 'RW', F: 'F', FORWARD: 'F', W: 'W', WING: 'W', WINGER: 'W',
      D: 'D', DEFENSE: 'D', DEFENCE: 'D', DEFENSEMAN: 'D', DEFENCEMAN: 'D'})[key] || '';
  }
  function historyLabel(value) {
    const code = String(value || '').replace(/^all_positions_history_/, '');
    return ({positive_both_seasons_open_and_close: 'Both seasons positive at open & close',
      positive_both_seasons_open: 'Both seasons positive at open', positive_both_seasons_close: 'Both seasons positive at close',
      positive_both_seasons_small_sample: 'Positive seasons / small sample', mixed_or_negative: 'Mixed or negative',
      limited_season_coverage: 'Limited season coverage', small_sample: 'Small sample', unavailable: 'No matching history'})[code] || 'No matching history';
  }
  let report = null, pending = null, controller = null, authVersion = 0, sessionToken = '';
  let visibleLimit = 50;
  const openKeys = new Set(), openReferences = new Set();
  const keyOf = pick => [pick.game, pick.player, pick.book].join('|');
  function notice(id, message) { $(id).textContent = message; $(id).hidden = !message; }
  function ageLimit() { return Math.min(15, Number(report.criteria.max_age_minutes)); }
  function freshTimestamp(value, now) {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) && stamp <= now && now - stamp <= ageLimit() * 60000;
  }
  function freshComparison(comparison, now) {
    if (!comparison || typeof comparison !== 'object') return false;
    const components = String(comparison.reference || '').split(';')[0].split('+').filter(Boolean);
    return components.length > 0 && comparison.reference_updated && components.every(book => freshTimestamp(comparison.reference_updated[book], now));
  }
  function reportFresh(now) { return report && snapshotDay(report) === localDay(now) && freshTimestamp(report.generated_at, now); }
  function primaryOf(pick) { return (Array.isArray(pick.comparisons) ? pick.comparisons : []).find(c => c?.reference === pick.reference); }
  function availablePicks(now) {
    if (!reportFresh(now)) return [];
    const allowedBooks = new Set(offeredBooks(report));
    return report.picks.filter(pick => {
      if (!pick || !allowedBooks.has(pick.book) || !numeric(pick.price) || Number(pick.price) < 1000 || Number(pick.price) > 3000) return false;
      const primary = primaryOf(pick), start = Date.parse(pick.start);
      return freshTimestamp(pick.quote_updated, now) && Number.isFinite(start)
        && start > now + Math.max(5, Number(report.criteria.min_minutes_to_start)) * 60000
        && freshComparison(primary, now)
        && numeric(primary.ev) && Number(primary.ev) + 1e-9 >= Number(report.criteria.min_ev);
    });
  }
  function researchMatch(pick, now) {
    return pick.research_match === true && pick.book === 'fd' && pick.method === 'probit'
      && numeric(pick.teamTotal) && Number(pick.teamTotal) >= 3
      && pick.comparisons.some(c => c.reference === 'hr' && freshComparison(c, now) && numeric(c.ev) && Number(c.ev) >= Number(report.criteria.min_ev));
  }
  function historyTable(history) {
    const labels = report.history_metadata?.season_labels || {'2024': '2024-25', '2025': '2025-26'};
    const rows = ['open', 'close'].map(timing => {
      const cohort = history?.[timing];
      if (!cohort?.all) return `<tr><td>${timing === 'open' ? 'Opening' : 'Closing'}</td><td colspan="5">No matching sample</td></tr>`;
      return ['all', '2024', '2025'].map((season, index) => {
        const row = season === 'all' ? cohort.all : cohort.seasons?.[season];
        const label = season === 'all' ? 'All seasons' : labels[season] || season;
        const missing = !row || !numeric(row.n) || Number(row.n) === 0;
        return `<tr><td>${index === 0 ? timing === 'open' ? 'Opening' : 'Closing' : ''}</td><td>${esc(label)}</td><td>${missing ? '0' : esc(number(row.n, 0))}</td><td>${missing ? '-' : esc(number(row.wins, 0))}</td><td>${missing ? '-' : `${esc(number(row.profit))}u`}</td><td class="${!missing && Number(row.roi) < 0 ? 'ls-negative' : ''}">${missing ? '-' : esc(pct(row.roi))}</td></tr>`;
      }).join('');
    }).join('');
    return `<div class="rec-ref-wrap" role="region" aria-label="Historical opening and closing results" tabindex="0"><table class="ls-history-table"><caption>Stored history &middot; 1u per selection</caption><thead><tr><th scope="col">Snapshot</th><th scope="col">Season</th><th scope="col">Bets</th><th scope="col">Hits</th><th scope="col">Profit</th><th scope="col">ROI</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function comparisonDetails(pick, comparison, now) {
    if (!freshComparison(comparison, now)) return `<p class="ls-expired-reference">${esc(referenceName(comparison?.reference))}: reference expired; estimates hidden.</p>`;
    const refKey = `${keyOf(pick)}|${comparison.reference}`;
    const isPrimary = comparison.reference === pick.reference;
    const raw = Object.entries(comparison.reference_quotes || {}).map(([book, quote]) => {
      const values = String(quote).split('/').map(v => numeric(v) ? odds(v) : '-').join(' / ');
      return `<li>${esc(bookName(book))}: <strong>${esc(values)}</strong> <span>(Yes / No; ${esc(timeLabel(comparison.reference_updated[book]))})</span></li>`;
    }).join('');
    return `<details class="ls-comparison" data-ref-key="${esc(refKey)}" ${openReferences.has(refKey) || isPrimary && !openReferences.has(`${refKey}|closed`) ? 'open' : ''}>
      <summary><strong>${esc(referenceName(comparison.reference))}${isPrimary ? ' / primary' : ''}</strong><span class="${Number(comparison.ev) >= 0 ? 'ls-positive' : 'ls-negative'}">${esc(pct(comparison.ev))} EV</span><span>Fair ${esc(odds(comparison.fair_odds))}</span><small>${comparison.synthetic_reference ? 'Estimated No price' : 'Quoted Yes / No'} &middot; ${Number(comparison.ev) >= Number(report.criteria.min_ev) ? 'Meets EV minimum' : 'Below EV minimum'}</small></summary>
      <div class="ls-reference-grid"><div><ul class="ls-raw-quotes">${raw}</ul>
        <p>Probit EV ${esc(pct(comparison.probit_ev))}; worst-method EV ${esc(pct(comparison.worst_ev))}. Fair probability ${numeric(comparison.fair_probability) ? esc(number(Number(comparison.fair_probability) * 100, 2)) + '%' : '-'}.</p>
        <p>${comparison.synthetic_reference ? 'The missing No price is inferred using the model\'s overround assumption.' : 'Both reference sides were quoted.'}</p>
        <p>${esc(historyLabel(comparison.history_label))}. These stored cohorts include all positions and shot volumes.</p></div>${historyTable(comparison.history)}</div></details>`;
  }
  function renderRow(pick, index, now) {
    const row = document.createElement('tr'), detail = document.createElement('tr');
    const key = keyOf(pick), primary = primaryOf(pick), link = safeLink(pick.link);
    const research = researchMatch(pick, now), freshRefs = pick.comparisons.filter(c => freshComparison(c, now));
    const positiveRefs = freshRefs.filter(c => Number(c.ev) >= Number(report.criteria.min_ev)).length;
    row.className = 'rec-pick'; row.dataset.key = key;
    detail.className = 'rec-detail-row'; detail.id = `ls-detail-${index}`;
    const offer = `${logo(pick.book)}<span class="rec-offer-copy"><strong>${esc(odds(pick.price))}</strong><small>${esc(bookName(pick.book))}</small>${numeric(pick.net_price_estimate) && Number(pick.net_price_estimate) !== Number(pick.price) ? `<small>~${esc(odds(pick.net_price_estimate))} after fees</small>` : ''}</span>${link ? '<span class="rec-offer-arrow" aria-hidden="true">&#8599;</span>' : ''}`;
    const measuredSog = numeric(pick.avgSOG_L10) && numeric(pick.sogGames_L10) && Number(pick.sogGames_L10) >= 5;
    row.innerHTML = `<td class="ls-player-cell"><strong>${esc(title(pick.player))}</strong><small>${esc(String(pick.game || '').toUpperCase())} &middot; ${esc(gameTimeLabel(pick.start))}</small>${research ? '<span class="ls-tag">RESEARCH MATCH</span>' : ''}</td>
      <td class="rec-book-cell">${link ? `<a class="rec-offer" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(title(pick.player))} anytime goal at ${esc(bookName(pick.book))}">${offer}</a>` : `<span class="rec-offer">${offer}</span>`}</td>
      <td class="ls-reference-cell" data-label="Primary reference / EV"><span>${esc(referenceName(pick.reference))}</span><strong class="rec-value">${esc(pct(primary.ev))}</strong><small>Fair ${esc(odds(primary.fair_odds))} &middot; ${esc(pick.method)}${primary.synthetic_reference ? ' / est. No' : ''}</small></td>
      <td class="ls-position-cell" data-label="Position"><strong>${esc(position(pick.position) || '-')}</strong></td>
      <td class="ls-sog-cell" data-label="Last-10 SOG"><strong>${measuredSog ? esc(number(pick.avgSOG_L10, 2)) : '-'}</strong><small>${numeric(pick.sogGames_L10) ? `n = ${esc(number(pick.sogGames_L10, 0))}${measuredSog ? '' : ' / need 5'}` : 'No sample'}</small></td>
      <td class="ls-goals-cell" data-label="Est. team goals"><strong>${esc(number(pick.teamTotal, 2))}</strong></td>
      <td class="ls-history-cell" data-label="Historical context">${esc(historyLabel(primary.history_label))}<small>${positiveRefs} of ${freshRefs.length} fresh references meet EV minimum</small></td>
      <td class="rec-details-cell"><button class="rec-toggle" type="button" aria-controls="${detail.id}" aria-label="Offer details for ${esc(title(pick.player))} at ${esc(bookName(pick.book))}">Details <span aria-hidden="true">&#8964;</span></button></td>`;
    const warnings = Array.isArray(pick.warnings) ? pick.warnings.map(w => `<li>${esc(w)}</li>`).join('') : '';
    detail.innerHTML = `<td colspan="8"><div class="ls-details"><h2>${esc(title(pick.player))} &middot; anytime goal</h2>
      <div class="ls-detail-meta"><span>Offer updated ${esc(timeLabel(pick.quote_updated))}</span>${numeric(pick.liquidity) ? `<span>Available liquidity $${esc(number(pick.liquidity, 0))}</span>` : ''}<span>Average ice time ${esc(number(pick.avgTOI))} min</span><span>Power-play line ${esc(pick.ppLine ?? '-')}</span>${numeric(pick.suggested_units) ? `<span>Saved stake tier ${esc(number(pick.suggested_units))}u</span>` : ''}</div>
      <p>The primary reference is the first qualifying reference in the published order. Additional comparisons include model disagreements; opening and closing histories stay separate.</p>
      ${!link ? '<p>No direct selection link is available. Locate this player\'s full-game anytime goal market at the book.</p>' : ''}
      ${warnings ? `<ul>${warnings}</ul>` : ''}${pick.comparisons.map(c => comparisonDetails(pick, c, now)).join('')}</div></td>`;
    const toggle = row.querySelector('.rec-toggle');
    function expand(open) {
      toggle.setAttribute('aria-expanded', String(open)); detail.hidden = !open;
      row.classList.toggle('is-expanded', open);
      if (open) openKeys.add(key); else openKeys.delete(key);
    }
    toggle.addEventListener('click', () => expand(detail.hidden));
    detail.querySelectorAll('.ls-comparison').forEach(el => el.addEventListener('toggle', () => {
      if (!el.isConnected) return;
      if (el.open) { openReferences.add(el.dataset.refKey); openReferences.delete(`${el.dataset.refKey}|closed`); }
      else { openReferences.delete(el.dataset.refKey); openReferences.add(`${el.dataset.refKey}|closed`); }
    }));
    expand(openKeys.has(key));
    const fragment = document.createDocumentFragment(); fragment.append(row, detail); return fragment;
  }
  function render() {
    if (!report) return;
    const now = Date.now(), fresh = availablePicks(now), book = $('book-filter').value, pos = $('position-filter').value;
    const search = $('search-filter').value.trim().toLowerCase(), onlyResearch = $('research-filter').checked;
    const minEv = $('ev-filter').value, minSog = $('sog-filter').value, minGoals = $('goals-filter').value;
    const shown = fresh.filter(pick => (!book || pick.book === book)
      && (!pos || (pos === 'F' ? ['F', 'W', 'C', 'LW', 'RW'].includes(position(pick.position)) : position(pick.position) === pos))
      && (!search || `${pick.player} ${pick.game} ${pick.team || ''}`.toLowerCase().includes(search))
      && (!onlyResearch || researchMatch(pick, now))
      && (!numeric(minEv) || Number(primaryOf(pick).ev) >= Number(minEv))
      && (!numeric(minSog) || numeric(pick.avgSOG_L10) && numeric(pick.sogGames_L10) && Number(pick.sogGames_L10) >= 5 && Number(pick.avgSOG_L10) >= Number(minSog))
      && (!numeric(minGoals) || numeric(pick.teamTotal) && Number(pick.teamTotal) >= Number(minGoals)));
    const visible = shown.slice(0, visibleLimit);
    $('picks').replaceChildren(...visible.map((pick, index) => renderRow(pick, index, now)));
    $('picks-table-wrap').hidden = shown.length === 0;
    $('pick-count').textContent = fresh.length;
    $('research-count').textContent = fresh.filter(pick => researchMatch(pick, now)).length;
    $('book-count').textContent = offeredBooks(report).length;
    $('list-caption').textContent = `${visible.length} of ${shown.length} matching offers · ${fresh.length} fresh · Grouped by book, then published rank`;
    $('show-more').hidden = visible.length >= shown.length;
    $('show-more').textContent = `Show ${Math.min(50, shown.length - visible.length)} more`;
    $('empty-state').hidden = shown.length > 0;
    const expired = report.picks.length - fresh.length, stale = !reportFresh(now);
    notice('freshness-status', stale ? 'This saved watchlist is out of date. Expired offers are hidden while we wait for a new publication.'
      : expired ? `${expired} saved ${expired === 1 ? 'offer is' : 'offers are'} hidden because a price expired or the game is starting.` : '');
    $('empty-state').querySelector('h2').textContent = fresh.length ? 'No offers match these filters' : stale || expired ? 'Waiting for fresh offers' : 'No qualifying offers';
    $('empty-state').querySelector('p').textContent = fresh.length ? 'Try another book, position or context filter.'
      : 'A watchlist can be empty. The page checks for a new publication every minute while visible.';
  }
  function acceptReport(data) {
    const c = data?.criteria;
    if (data?.schema_version !== 1 || data.sport !== 'nhl' || data.market !== 'atgs' || !Array.isArray(data.picks)
      || !Array.isArray(data.books_checked) || !Number.isFinite(Date.parse(data.generated_at))
      || [data.date, data.slate_date].some(day => day != null && !/^\d{4}-\d{2}-\d{2}$/.test(day))
      || !c || !numeric(c.max_age_minutes) || Number(c.max_age_minutes) <= 0 || !numeric(c.min_minutes_to_start)
      || Number(c.min_minutes_to_start) < 0 || !numeric(c.min_ev) || Number(c.min_ev) < 0) throw new Error('The longshot snapshot is not available yet.');
    report = data;
    $('report-content').hidden = false; $('report-content').setAttribute('aria-busy', 'false'); $('access-panel').hidden = true;
    const previous = $('book-filter').value, availableBooks = offeredBooks(data);
    $('book-filter').replaceChildren(new Option('All books', ''));
    availableBooks.forEach(book => $('book-filter').add(new Option(bookName(book), book)));
    $('book-filter').value = availableBooks.includes(previous) ? previous : '';
    $('report-date').textContent = `Upcoming NHL games \u00b7 ${new Date(`${snapshotDay(data)}T12:00:00`).toLocaleDateString('en-US', {month: 'long', day: 'numeric', year: 'numeric'})}`;
    $('generated').textContent = `Published ${timeLabel(data.generated_at)} · refreshes about every ${numeric(data.refresh_minutes) ? Number(data.refresh_minutes) : 5} min`;
    $('criteria').innerHTML = [
      ['+1000 to +3000 anytime goal offers', `At least ${number(c.min_ev)}% estimated EV against a usable reference. Each offered book is excluded from its reference.`],
      [`${ageLimit()}-minute price limit`, `All upcoming games in the feed; more than ${Math.max(5, Number(c.min_minutes_to_start))} minutes before start. Timestamps describe the book feed, not verified updates to each market.`],
      [`Up to ${number(c.limit_per_book, 0)} offers per book`, 'The published order and probit screen match the default longshot scan. Use the book filter to see each book separately.'],
      ['Primary reference stays fixed', 'The first qualifying published reference supplies EV, fair odds and the row\'s history. Expand all comparisons to inspect disagreements.'],
      ['Reference-only books', 'Pinnacle and Circa are used for comparison. All other eligible books, including bet365, BetOnline and exchanges, can appear as offers.'],
      ['Estimated No prices are labeled', 'One-sided reference prices at or below 7% raw probability are excluded by the live screen. Other one-sided prices still depend on an assumed overround.'],
      ['No automatic position or SOG restriction', 'Last-10 SOG uses prior NHL games, with at least five valid observations. Zero is a measured value; a dash means the average is unavailable.']
    ].map(([term, definition]) => `<div><dt>${esc(term)}</dt><dd>${esc(definition)}</dd></div>`).join('');
    $('coverage').innerHTML = '<p>Counts describe the saved scan, before local filters and time expiry.</p><ul>' + availableBooks.map(book => {
      const counts = data.books_summary?.[book] || {};
      return `<li>${esc(bookName(book))}: ${esc(number(counts.quoted || 0, 0))} quoted; ${esc(number(counts.in_range || 0, 0))} in range; ${esc(number(counts.qualified || 0, 0))} qualifying; ${esc(number(counts.shown || 0, 0))} published</li>`;
    }).join('') + '</ul>';
    render();
  }
  function clearReport() {
    report = null; openKeys.clear(); openReferences.clear(); $('picks').replaceChildren();
    $('criteria').replaceChildren(); $('coverage').replaceChildren();
    ['pick-count', 'research-count', 'book-count'].forEach(id => { $(id).textContent = '-'; });
    $('report-content').hidden = true; $('picks-table-wrap').hidden = true; notice('freshness-status', '');
  }
  function refresh() {
    if (pending) return pending;
    const requestVersion = authVersion;
    $('refresh').disabled = true;
    controller = new AbortController();
    const requestController = controller, timer = setTimeout(() => requestController.abort(), 20000);
    pending = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/longshots`, {headers: sessionToken ? {Authorization: `Bearer ${sessionToken}`} : {}, cache: 'no-store', signal: requestController.signal});
        if (requestVersion !== authVersion) return;
        if ([401, 403].includes(response.status)) {
          clearReport(); $('access-panel').hidden = false; $('generated').textContent = 'Sharp membership'; notice('request-status', ''); return;
        }
        if (!response.ok) throw new Error('Unable to load the latest watchlist. Please try again.');
        const data = await response.json();
        if (requestVersion !== authVersion) return;
        acceptReport(data); notice('request-status', '');
      } catch (error) {
        if (requestVersion !== authVersion) return;
        notice('request-status', error.name === 'AbortError' ? 'The request timed out. Try refreshing the watchlist.' : error.message);
        $('report-content').setAttribute('aria-busy', 'false');
        if (report) render();
        else {
          $('generated').textContent = 'Watchlist unavailable';
          if ($('access-panel').hidden) { $('report-content').hidden = false; $('empty-state').hidden = false; }
        }
      } finally { clearTimeout(timer); $('refresh').disabled = false; pending = null; controller = null; }
    })();
    return pending;
  }
  refresh.requestLatest = () => pending ? pending.then(refresh) : refresh();
  window.refreshLongshots = refresh;
  $('refresh').addEventListener('click', refresh);
  ['book-filter', 'position-filter', 'research-filter'].forEach(id => $(id).addEventListener('change', () => { visibleLimit = 50; render(); }));
  ['search-filter', 'ev-filter', 'sog-filter', 'goals-filter'].forEach(id => $(id).addEventListener('input', () => { visibleLimit = 50; render(); }));
  $('show-more').addEventListener('click', () => { visibleLimit += 50; render(); });
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  function setSession(session) {
    const token = session?.access_token || '';
    if (token === sessionToken) return;
    sessionToken = token; ACCESS_TOKEN = token; authVersion++; controller?.abort(); clearReport();
    $('access-panel').hidden = Boolean(token); $('account-link').textContent = token ? 'My account' : 'Sign in';
    notice('request-status', ''); refresh.requestLatest();
  }
  async function boot() {
    try {
      if (!SB) throw new Error('No auth service');
      const {data, error} = await SB.auth.getSession();
      if (error) throw error;
      sessionToken = data.session?.access_token || ''; ACCESS_TOKEN = sessionToken;
      $('account-link').textContent = sessionToken ? 'My account' : 'Sign in';
      SB.auth.onAuthStateChange((_event, session) => queueMicrotask(() => setSession(session)));
      await refresh();
    } catch (_) { clearReport(); notice('request-status', 'Sign-in service unavailable. Reload the page to try again.'); $('generated').textContent = 'Unable to connect'; }
  }
  function tick() { if (document.visibilityState !== 'hidden') { render(); refresh(); } }
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', tick);
  boot();
})();
