(() => {
  'use strict';
  PAGE = 'arb'; SPORT = '';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const money = value => finite(value) ? Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'Unknown';
  const signedMoney = value => finite(value) ? `${Number(value) > 0 ? '+' : ''}${money(value)}` : '\u2014';
  const pct = value => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '\u2014';
  const odds = value => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toLocaleString('en-US')}` : '\u2014';
  const title = value => String(value ?? '').replace(/\b\w/g, char => char.toUpperCase());
  const notice = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
  const selectedBooks = new Set();
  let allBooks = true;
  const filterKeys = ['amount', 'type', 'sport', 'prop', 'books', 'limit', 'min_profit', 'liquidity'];
  let names = {}, result = null, controller = null, version = 0, timer = null, ready = false;
  let manualController = null, manualVersion = 0;
  const bookName = book => names[book] || ({ manual_over: 'Over sportsbook', manual_under: 'Under sportsbook' })[book] || String(book || 'Sportsbook').toUpperCase();
  const time = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.valueOf()) ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Update unavailable';
  };
  const startTime = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.valueOf()) ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ' / ' + time(value) : 'Start unavailable';
  };
  function logo(book) {
    const asset = ({ hr_az: 'hr', hr_oh: 'hr' })[book] || book;
    return /^[a-z0-9_]+$/.test(asset) && !String(asset).startsWith('manual') ? `<img class="book-logo" src="logos/${asset}.png" width="20" height="20" alt="">` : '';
  }
  function marketLink(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Open market <span aria-hidden="true">\u2197</span></a>`;
    } catch (_) { return ''; }
  }
  function clearResults() { result = null; $('arb-results').hidden = true; $('plays').replaceChildren(); }
  function cancel() {
    version++; controller?.abort(); controller = null; clearTimeout(timer);
    $('refresh').disabled = false; $('arb-results').setAttribute('aria-busy', 'false');
  }
  function access(status) {
    clearResults(); $('access-panel').hidden = false;
    $('access-title').textContent = status === 403 ? 'Live arbs and middles are included with Sharp' : 'Sign in to find live arbs and middles';
    $('access-message').textContent = status === 403 ? 'Choose Sharp to compare current prices. The manual calculator below is available to everyone.' : 'Live rankings are included with Sharp. You can also use the manual calculator below.';
    $('access-login').hidden = status === 403; $('updated').textContent = 'Sign-in required'; notice('request-status', '');
  }
  function readOptions() {
    if (!$('arb-filters').checkValidity()) throw new Error('Enter a budget of $1\u2013$100,000, 1\u2013200 opportunities, and a valid minimum return.');
    if (!allBooks && !selectedBooks.size) throw new Error('Select at least one betting book.');
    const query = new URLSearchParams({ amount: $('amount').value, type: $('type-filter').value, sport: $('sport-filter').value, prop: $('prop-filter').value, limit: $('limit').value, min_profit: $('min-profit').value, liquidity: $('liquidity-filter').value });
    if (!allBooks) query.set('books', [...selectedBooks].sort().join(','));
    return query;
  }
  function syncURL(query) {
    const url = new URL(window.location.href);
    filterKeys.forEach(key => { if (query.has(key)) url.searchParams.set(key, query.get(key)); else url.searchParams.delete(key); });
    history.replaceState(null, '', url);
  }
  function pickerSummary() { $('book-summary').textContent = allBooks ? 'All books' : selectedBooks.size ? [...selectedBooks].map(bookName).join(', ') : 'No books'; }
  function renderPicker() {
    const books = [...new Set([...Object.keys(names), ...selectedBooks])].sort((a, b) => bookName(a).localeCompare(bookName(b)));
    $('book-options').innerHTML = books.map(book => `<label><input type="checkbox" value="${esc(book)}" ${allBooks || selectedBooks.has(book) ? 'checked' : ''}>${esc(bookName(book))}</label>`).join('') || '<p class="muted">No books in the current feeds.</p>';
    pickerSummary();
  }
  function renderProps(props) {
    const selected = $('prop-filter').value, choices = new Map([['all', 'All props']]);
    (Array.isArray(props) ? props : []).forEach(item => { if (item && typeof item.value === 'string') choices.set(item.value, item.label || item.value); });
    if (!choices.has(selected)) choices.set(selected, title(selected.replace(/_/g, ' ')));
    $('prop-filter').innerHTML = [...choices].map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    $('prop-filter').value = selected;
  }
  function renderLeg(leg, manual) {
    const verified = leg.liquidity_status === 'verified';
    const hasCapacity = finite(leg.liquidity);
    const contracts = Number.isInteger(leg.contracts) ? ` \u00b7 ${leg.contracts.toLocaleString('en-US')} contracts` : '';
    return `<section class="leg" aria-label="${esc(title(leg.side))} bet">
      <div class="leg-book">${manual ? '' : logo(leg.book)}${esc(manual ? `${title(leg.side)} sportsbook` : bookName(leg.book))}</div>
      <div class="leg-selection"><strong>${esc(title(leg.side))} ${esc(leg.line)}</strong><span class="leg-odds">${esc(odds(leg.odds))}</span></div>
      <p class="leg-cash"><strong>${esc(money(leg.cash))}</strong> total cash</p>
      <small>Stake ${esc(money(leg.stake))}${esc(contracts)}<br>Fee ${esc(money(leg.fee))}</small>
      ${manual ? '<small>Manually entered price \u00b7 limit unknown</small>' : `<span class="liquidity-badge ${verified ? '' : 'unknown'}">${verified ? 'Quoted amount fits' : 'Limit unverified'}</span><small>${hasCapacity ? `${esc(money(leg.liquidity))} quoted stake available` : 'Confirm the accepted stake'}</small><small>Updated ${esc(time(leg.updated_at))}</small>${marketLink(leg.link)}`}
      ${leg.fee_note ? `<small>${esc(leg.fee_note)}</small>` : ''}
    </section>`;
  }
  function renderPlay(play, index, manual = false) {
    const middle = play.has_middle === true || play.type === 'middle';
    const outcomes = Array.isArray(play.outcomes) ? play.outcomes : [];
    const profit = finite(play.worst_profit) ? Number(play.worst_profit) : 0;
    const spent = finite(play.total_cash) ? Number(play.total_cash) : null;
    const unspent = finite(play.budget) && spent !== null ? Math.max(0, Number(play.budget) - spent) : 0;
    const heading = manual ? 'Your cash bet calculation' : title(play.player || play.label || 'Player prop');
    return `<article class="arb-play ${middle ? 'middle' : ''}">
      <div class="play-heading"><div><div class="play-title">${manual ? '' : `<span class="rank">#${index + 1}</span>`}<h2>${esc(heading)}</h2></div><p>${manual ? 'Manual prices \u00b7 whole-number outcomes' : `${esc(String(play.sport || '').toUpperCase())} \u00b7 ${esc(play.label || play.prop)} \u00b7 ${esc(String(play.game || '').toUpperCase())}<br>${esc(startTime(play.start))}`}</p></div><span class="play-kind">${middle ? profit > 0 ? 'Arb + middle' : 'Middle' : profit > 0 ? 'Arb' : 'Two-sided bet'}</span></div>
      <div class="play-body"><div class="profit-block"><div><span class="metric-label">Minimum modeled return</span><strong class="profit-pct ${profit < 0 ? 'negative' : ''}">${esc(pct(play.profit_pct))}</strong><span class="profit-money">${esc(signedMoney(play.worst_profit))} net profit</span></div>
        ${middle ? `<div class="middle-reward"><span class="metric-label">If both bets win</span><strong>${esc(signedMoney(play.best_profit))}</strong><small>${esc(play.middle_range || 'Inside the overlap')}<br>Conditional, not guaranteed</small></div>` : ''}
        <p class="cash-used">${esc(money(spent))} cash used${unspent >= .005 ? `<br>${esc(money(unspent))} budget unused` : ''}</p></div><div class="legs">${play.legs.map(leg => renderLeg(leg, manual)).join('')}</div></div>
      <details class="outcomes" ${manual ? 'open' : ''}><summary>Profit by outcome${middle ? ' \u00b7 including the middle and pushes' : ''}</summary><div class="outcome-grid">${outcomes.map(outcome => `<div class="outcome">${esc(outcome.label)}${outcome.over && outcome.under ? `<small>Over ${esc(outcome.over)} / under ${esc(outcome.under)}</small>` : ''}<strong class="${Number(outcome.profit) < 0 ? 'negative' : ''}">${esc(signedMoney(outcome.profit))}</strong></div>`).join('')}</div></details>
    </article>`;
  }
  function freshPlay(play, generated, maxAge) {
    const now = Date.now();
    const start = Date.parse(play.start), checked = Date.parse(generated);
    if (!Number.isFinite(start) || start <= now || !Number.isFinite(checked) || now - checked > maxAge || checked > now + 60000) return false;
    return Array.isArray(play.legs) && play.legs.length === 2 && play.legs.every(leg => {
      const updated = Date.parse(leg.updated_at);
      return Number.isFinite(updated) && now - updated <= maxAge && updated <= now + 60000;
    });
  }
  function render(data) {
    names = data.books || {}; renderPicker(); renderProps(data.props);
    const maxAge = Math.min(10, Math.max(.1, Number(data.max_age_minutes) || 10)) * 60000;
    const plays = data.plays.filter(play => freshPlay(play, data.generated_at, maxAge)).sort((a, b) => Number(b.profit_pct) - Number(a.profit_pct));
    result = { ...data, plays };
    $('summary-amount').textContent = money(data.options?.amount ?? $('amount').value);
    $('summary-plays').textContent = Number(data.summary?.qualified ?? plays.length).toLocaleString('en-US');
    $('ranking-note').textContent = `Showing ${plays.length.toLocaleString('en-US')} opportunities. Highest minimum modeled return first, using both cash stakes and fees.`;
    $('plays').innerHTML = plays.map((play, index) => renderPlay(play, index)).join('');
    $('middle-note').hidden = !plays.some(play => play.has_middle || play.type === 'middle') && $('type-filter').value === 'arb';
    const coverage = data.coverage || [], unavailable = coverage.filter(item => item.status !== 'available');
    const missingSports = [...new Set(unavailable.map(item => String(item.sport || item.dataset || '').toUpperCase()))];
    notice('coverage-status', missingSports.length ? `Some current feeds are unavailable: ${missingSports.join(', ')}. Results use only usable quotes.` : '');
    $('coverage-detail').textContent = coverage.map(item => `${String(item.sport || item.dataset || '').toUpperCase()}${item.dataset ? ` (${item.dataset})` : ''}: ${item.status === 'available' ? `feed ${time(item.updated_at)}` : 'unavailable'}`).join(' \u00b7 ');
    const exclusions = data.summary?.excluded || {};
    const labels = { liquidity: 'insufficient or unknown capacity', stale_quotes: 'old quotes', event_time: 'started or unverified games', conflicts: 'conflicting markets', min_profit: 'minimum return', settlement: 'unsupported settlement or sizing', identity: 'unverified player or game identity' };
    const counts = Object.entries(labels).filter(([key]) => Number(exclusions[key]) > 0).map(([key, label]) => `${Number(exclusions[key]).toLocaleString('en-US')} ${label}`);
    $('excluded-note').textContent = counts.length ? `Filtered candidates: ${counts.join(' \u00b7 ')}.` : '';
    $('empty-results').hidden = plays.length !== 0;
    $('empty-message').textContent = plays.length !== data.plays.length ? 'The returned prices have expired. Refresh for current opportunities.' : unavailable.length === coverage.length && coverage.length ? 'Current feeds are unavailable. Refresh after prices are published, or use the manual calculator below.' : $('type-filter').value === 'arb' ? 'Try more books or a smaller budget. You can also check middles, which may lose outside the overlap.' : 'Try more books, a smaller budget or a lower minimum return. Middles with a negative minimum return can lose outside the overlap.';
    $('updated').textContent = `Checked ${time(data.generated_at)}`;
    $('access-panel').hidden = true; $('arb-results').hidden = false;
  }
  async function refresh() {
    if (!ready) return;
    cancel(); clearResults();
    if (!ACCESS_TOKEN && !IS_LOCALHOST) { access(401); return; }
    let query;
    try { query = readOptions(); } catch (error) { notice('request-status', error.message); $('updated').textContent = 'Check filters'; return; }
    syncURL(query);
    const requestVersion = version, active = new AbortController(); controller = active;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; active.abort(); }, 20000);
    $('refresh').disabled = true; $('arb-results').setAttribute('aria-busy', 'true'); $('updated').textContent = 'Checking prices and capacity...';
    notice('request-status', 'Loading matching opportunities...');
    try {
      const response = await fetch(`${API_BASE}/api/arb?${query}`, { headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}, signal: active.signal, cache: 'no-store' });
      if (requestVersion !== version) return;
      if ([401, 403].includes(response.status)) { access(response.status); return; }
      let data;
      try { data = await response.json(); } catch (_) { throw new Error('Prices could not load. Use Refresh to try again.'); }
      if (requestVersion !== version) return;
      if (!response.ok) throw new Error(response.status === 400 ? data.error || 'Check the filters and try again.' : 'Prices are unavailable. Use Refresh to try again.');
      if (!Array.isArray(data.plays) || !Array.isArray(data.coverage)) throw new Error('The price response is incomplete. Refresh to try again.');
      render(data); notice('request-status', '');
    } catch (error) {
      if (requestVersion !== version) return;
      clearResults(); $('updated').textContent = 'Prices unavailable';
      notice('request-status', timedOut ? 'Price refresh timed out. Use Refresh to try again.' : error.message || 'Prices could not load. Use Refresh to try again.');
    } finally {
      clearTimeout(timeout);
      if (requestVersion === version) { controller = null; $('refresh').disabled = false; $('arb-results').setAttribute('aria-busy', 'false'); }
    }
  }
  function filterChanged(delay = 0) {
    cancel(); clearResults(); $('updated').textContent = 'Filters changed'; pickerSummary();
    try { syncURL(readOptions()); notice('request-status', 'Updating opportunities for these filters...'); }
    catch (error) { notice('request-status', error.message); return; }
    timer = setTimeout(refresh, delay);
  }
  function restoreFilters() {
    const query = new URLSearchParams(window.location.search);
    ['amount', 'limit', 'min_profit'].forEach(key => { if (query.has(key)) $(key.replace('_', '-')).value = query.get(key); });
    [['type', 'type-filter', ['arb', 'middle', 'all']], ['sport', 'sport-filter', ['all', 'mlb', 'nfl', 'nhl', 'nba', 'wnba', 'ncaaf']], ['liquidity', 'liquidity-filter', ['verified', 'any']]].forEach(([key, id, allowed]) => { if (allowed.includes(query.get(key))) $(id).value = query.get(key); });
    if (!query.has('min_profit') && $('type-filter').value !== 'arb') $('min-profit').value = '-10';
    if (/^[a-z0-9_+]{1,60}$/.test(query.get('prop') || '')) { const option = document.createElement('option'); option.value = query.get('prop'); option.textContent = title(option.value.replace(/_/g, ' ')); $('prop-filter').append(option); $('prop-filter').value = option.value; }
    if (query.get('books') !== 'all') (query.get('books') || '').split(',').filter(book => /^[a-z0-9_]{1,30}$/.test(book)).forEach(book => selectedBooks.add(book));
    allBooks = !selectedBooks.size;
    pickerSummary();
  }
  function cancelManual() {
    manualVersion++; manualController?.abort(); manualController = null;
    $('calculate').disabled = false; $('manual-result').hidden = true; $('manual-result').replaceChildren(); notice('manual-status', '');
  }
  async function calculate(event) {
    event?.preventDefault(); cancelManual();
    if (!$('manual-form').checkValidity()) { notice('manual-status', 'Enter valid lines, American odds and a budget of $1\u2013$100,000.'); return; }
    const overOdds = Number($('over-odds').value), underOdds = Number($('under-odds').value);
    if (Math.abs(overOdds) < 100 || Math.abs(underOdds) < 100) { notice('manual-status', 'American odds must be +100 or higher, or \u2212100 or lower.'); return; }
    const body = { amount: Number($('manual-amount').value), over: { line: Number($('over-line').value), odds: overOdds }, under: { line: Number($('under-line').value), odds: underOdds } };
    const requestVersion = manualVersion, active = new AbortController(); manualController = active;
    const timeout = setTimeout(() => active.abort(), 20000);
    $('calculate').disabled = true; notice('manual-status', 'Calculating both cash stakes...');
    try {
      const response = await fetch(`${API_BASE}/api/arb/calculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: active.signal, cache: 'no-store' });
      if (requestVersion !== manualVersion) return;
      const data = await response.json();
      if (requestVersion !== manualVersion) return;
      if (!response.ok) throw new Error(response.status === 400 ? data.error || 'Check the two lines and prices.' : 'Calculation unavailable. Try again.');
      if (!data.play || !Array.isArray(data.play.legs) || data.play.legs.length !== 2) throw new Error('The calculation response is incomplete. Try again.');
      $('manual-result').innerHTML = renderPlay(data.play, 0, true); $('manual-result').hidden = false; notice('manual-status', '');
    } catch (error) {
      if (requestVersion !== manualVersion) return;
      notice('manual-status', error.name === 'AbortError' ? 'Calculation timed out. Try again.' : error.message || 'Calculation unavailable. Try again.');
    } finally { clearTimeout(timeout); if (requestVersion === manualVersion) { manualController = null; $('calculate').disabled = false; } }
  }
  ['amount', 'limit', 'min-profit'].forEach(id => $(id).addEventListener('input', () => filterChanged(350)));
  ['prop-filter', 'liquidity-filter'].forEach(id => $(id).addEventListener('change', () => filterChanged()));
  $('type-filter').addEventListener('change', () => { $('min-profit').value = $('type-filter').value === 'arb' ? '0' : '-10'; filterChanged(); });
  $('sport-filter').addEventListener('change', () => { $('prop-filter').value = 'all'; filterChanged(); });
  $('book-options').addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    if (allBooks) Object.keys(names).forEach(book => selectedBooks.add(book));
    allBooks = false;
    if (event.target.checked) selectedBooks.add(event.target.value); else selectedBooks.delete(event.target.value);
    if (Object.keys(names).length && Object.keys(names).every(book => selectedBooks.has(book))) { allBooks = true; selectedBooks.clear(); }
    filterChanged();
  });
  $('all-books').addEventListener('click', () => { allBooks = true; selectedBooks.clear(); renderPicker(); filterChanged(); });
  document.addEventListener('click', event => { if (!$('book-picker').contains(event.target)) $('book-picker').open = false; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('book-picker').open) { $('book-picker').open = false; $('book-picker').querySelector('summary').focus(); } });
  document.addEventListener('error', event => { if (event.target.matches?.('img.book-logo')) event.target.hidden = true; }, true);
  $('arb-filters').addEventListener('submit', event => { event.preventDefault(); refresh(); }); $('refresh').addEventListener('click', refresh);
  $('manual-form').addEventListener('submit', calculate); $('manual-form').addEventListener('input', cancelManual);
  [['example-arb', [2.5, 240, 2.5, -120]], ['example-middle', [40, -110, 45, -110]]].forEach(([id, values]) => $(id).addEventListener('click', () => { cancelManual(); ['over-line', 'over-odds', 'under-line', 'under-odds'].forEach((field, index) => { $(field).value = values[index]; }); $('manual-amount').value = '100'; $('calculate').focus(); }));
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; }); $('access-pricing').href = `pricing${HTML}`;
  async function sessionChanged(session) {
    const token = session?.access_token || '';
    if (ready && token === ACCESS_TOKEN) return;
    cancel(); clearResults(); ACCESS_TOKEN = token; ready = true;
    $('account-link').textContent = token ? 'My account' : 'Sign in'; await refresh();
  }
  async function boot() {
    if (IS_LOCALHOST) { await sessionChanged(null); return; }
    try {
      if (!SB) throw new Error();
      SB.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => sessionChanged(session)); });
      const { data, error } = await SB.auth.getSession(); if (error) throw error; await sessionChanged(data.session);
    } catch (_) { clearResults(); notice('request-status', 'Sign-in service unavailable. Reload to try again. The manual calculator is still available.'); }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden' && !controller) refresh(); }, 60000);
  setInterval(() => {
    if (!result) return;
    const maxAge = Math.min(10, Math.max(.1, Number(result.max_age_minutes) || 10)) * 60000;
    if (result.plays.some(play => !freshPlay(play, result.generated_at, maxAge))) { clearResults(); notice('request-status', 'A quote expired or a game started. Refreshing availability...'); if (document.visibilityState !== 'hidden') refresh(); }
  }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refresh(); });
  window.refreshArbs = refresh; restoreFilters(); boot();
})();
