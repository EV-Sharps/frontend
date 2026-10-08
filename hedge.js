(() => {
  'use strict';
  PAGE = 'hedge';
  SPORT = '';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const money = value => finite(value) ? Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'Unknown';
  const odds = value => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toLocaleString('en-US')}` : '\u2014';
  const title = value => String(value ?? '').replace(/\b\w/g, char => char.toUpperCase());
  const marketNames = { hr: 'MLB home runs', atgs: 'NHL goalscorers', attd: 'NFL touchdowns' };
  const marketSides = { hr: ['1+ HR', 'No HR'], atgs: ['1+ goal', 'No goal'], attd: ['1+ TD', 'No TD'] };
  let names = {}, hedgeNames = {}, result = null, controller = null, version = 0, timer = null, ready = false;
  const selectedBooks = new Set(), selectedHedgeBooks = new Set();
  const notice = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
  const bookName = book => names[book] || hedgeNames[book] || String(book).toUpperCase();
  const time = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.valueOf()) ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Unknown update';
  };
  const startTime = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.valueOf()) ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ' / ' + time(value) : 'Start unavailable';
  };
  function logo(book) {
    const asset = ({ hr_az: 'hr', hr_oh: 'hr' })[book] || book;
    return /^[a-z0-9_]+$/.test(asset) ? `<img class="book-logo" src="logos/${asset}.png" width="19" height="19" alt="">` : '';
  }
  function marketLink(value, label) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">\u2197</span></a>`;
    } catch (_) { return ''; }
  }
  function clearResults() {
    result = null;
    $('hedge-results').hidden = true;
    $('book-groups').replaceChildren();
    $('book-jumps').replaceChildren();
  }
  function cancel() {
    version++;
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    $('refresh').disabled = false;
    $('hedge-results').setAttribute('aria-busy', 'false');
  }
  function access(status) {
    clearResults();
    $('access-panel').hidden = false;
    $('access-title').textContent = status === 403 ? 'Bonus bet hedges are included with Analyst and Sharp' : 'Sign in to find bonus bet hedges';
    $('access-message').textContent = status === 403 ? 'Choose a plan to compare the current hedge prices.' : 'Included with Analyst and Sharp.';
    $('access-login').hidden = status === 403;
    $('updated').textContent = 'Sign-in required';
    notice('request-status', '');
  }
  function readOptions() {
    if (!$('hedge-filters').checkValidity()) throw new Error('Enter a positive bonus amount, 1\u201350 plays per book, and valid conversion and cash limits.');
    const query = new URLSearchParams({ market: $('market-filter').value, amount: $('bonus-amount').value, limit: $('top-limit').value, min_conversion: $('min-conversion').value, liquidity: $('liquidity-filter').value });
    if (selectedBooks.size) query.set('books', [...selectedBooks].sort().join(','));
    if (selectedHedgeBooks.size) query.set('hedge_books', [...selectedHedgeBooks].sort().join(','));
    if ($('max-cash').value) query.set('max_cash', $('max-cash').value);
    return query;
  }
  function syncURL(query) {
    const url = new URL(window.location.href);
    ['market', 'amount', 'limit', 'min_conversion', 'liquidity', 'books', 'hedge_books', 'max_cash'].forEach(key => {
      if (query.has(key)) url.searchParams.set(key, query.get(key));
      else url.searchParams.delete(key);
    });
    history.replaceState(null, '', url);
  }
  function pickerSummary() {
    $('bonus-summary').textContent = selectedBooks.size ? [...selectedBooks].map(bookName).join(', ') : 'All books';
    $('hedge-summary').textContent = selectedHedgeBooks.size ? [...selectedHedgeBooks].map(bookName).join(', ') : 'All books';
  }
  function renderPicker(id, choices, selected) {
    const books = [...new Set([...Object.keys(choices), ...selected])].sort((a, b) => bookName(a).localeCompare(bookName(b)));
    $(id).innerHTML = books.map(book => `<label><input type="checkbox" value="${esc(book)}" ${selected.has(book) ? 'checked' : ''}>${esc(bookName(book))}</label>`).join('') || '<p class="muted">No books in the current feed.</p>';
  }
  function renderRow(play, index) {
    const sides = marketSides[play.market] || ['YES', 'NO'];
    const verified = play.liquidity_status === 'verified';
    const maxBonus = finite(play.max_bonus_amount) ? `<small>Approx. bonus capacity: ${esc(money(play.max_bonus_amount))}</small>` : '';
    const contracts = Number.isInteger(play.hedge_contracts) ? ` \u00b7 ${play.hedge_contracts.toLocaleString('en-US')} contracts` : '';
    return `<tr>
      <td class="hedge-player-cell"><div class="player-heading"><span class="rank">#${index + 1}</span><strong>${esc(title(play.player))}</strong></div><small class="market-label">${esc(play.label || marketNames[play.market] || play.market)} \u00b7 ${esc(String(play.game || '').toUpperCase())}</small><small>${esc(startTime(play.start))}</small></td>
      <td class="conversion" data-label="Conversion"><strong>${finite(play.conversion_pct) ? Number(play.conversion_pct).toFixed(2) + '%' : '\u2014'}</strong><small>${esc(money(play.retained_cash))} cash retained</small><small class="payouts">If YES: ${esc(money(play.cash_if_yes))}<br>If NO: ${esc(money(play.cash_if_no))}</small></td>
      <td class="bonus-cell" data-label="Bonus bet"><strong><span class="side-label">YES</span> ${esc(odds(play.bonus_odds))}</strong><small>${esc(money(play.bonus_amount))} bonus \u00b7 ${esc(sides[0])}</small><small>Updated ${esc(time(play.bonus_updated_at))}</small>${marketLink(play.bonus_link, 'Open market')}</td>
      <td class="hedge-cell" data-label="Cash hedge"><div class="hedge-book">${logo(play.hedge_book)}${esc(bookName(play.hedge_book))}</div><strong><span class="side-label">NO</span> ${esc(odds(play.hedge_odds))}</strong><small>${esc(sides[1])}</small><small>Updated ${esc(time(play.hedge_updated_at))}</small>${marketLink(play.hedge_link, 'Open market')}</td>
      <td class="cash-cell" data-label="Cash needed"><strong>${esc(money(play.hedge_cash))}</strong><small>Order: ${esc(money(play.hedge_order_stake))}${esc(contracts)}<br>Fee: ${esc(money(play.hedge_fee))}</small>${play.fee_note ? `<small class="fee-note">${esc(play.fee_note)}</small>` : ''}</td>
      <td class="liquidity-cell" data-label="Hedge capacity"><span class="liquidity-badge ${verified ? '' : 'unknown'}">${verified ? 'Quoted amount fits' : 'Limit unverified'}</span><small>${verified ? `${esc(money(play.hedge_liquidity))} quoted stake available` : 'Confirm the accepted stake'}</small>${maxBonus}${play.liquidity_note ? `<small>${esc(play.liquidity_note)}</small>` : ''}</td>
    </tr>`;
  }
  function render(data) {
    result = data;
    names = data.books || {};
    hedgeNames = data.hedge_books || {};
    renderPicker('bonus-book-options', names, selectedBooks);
    renderPicker('hedge-book-options', hedgeNames, selectedHedgeBooks);
    pickerSummary();
    const groups = (data.groups || []).filter(group => Array.isArray(group.plays) && group.plays.length);
    const shown = groups.reduce((sum, group) => sum + group.plays.length, 0);
    const qualified = groups.reduce((sum, group) => sum + (Number(group.total) || group.plays.length), 0);
    const amount = data.options?.amount ?? Number($('bonus-amount').value);
    const limit = data.options?.limit ?? Number($('top-limit').value);
    $('summary-amount').textContent = money(amount);
    $('summary-plays').textContent = Number(data.summary?.qualified ?? qualified).toLocaleString('en-US');
    $('summary-books').textContent = groups.length.toLocaleString('en-US');
    $('ranking-note').textContent = `Showing ${shown.toLocaleString('en-US')} plays, up to ${limit} per bonus book. Highest conversion first within each book, sized to ${money(amount)}.`;
    $('book-jumps').innerHTML = groups.map((group, index) => `<a href="#hedge-book-${index}">${logo(group.book)}${esc(bookName(group.book))}<span>${group.plays.length}</span></a>`).join('');
    $('book-groups').innerHTML = groups.map((group, index) => `<section class="hedge-group" id="hedge-book-${index}" aria-labelledby="hedge-heading-${index}"><div class="group-heading"><h2 id="hedge-heading-${index}">${logo(group.book)}${esc(bookName(group.book))} bonus</h2><p>Top ${group.plays.length} of ${Number(group.total ?? group.plays.length).toLocaleString('en-US')} matching plays</p></div><div class="hedge-table-wrap" role="region" aria-label="${esc(bookName(group.book))} hedge rankings" tabindex="0"><table class="hedge-table"><caption class="sr-only">${esc(bookName(group.book))} bonus bet hedges, highest conversion first</caption><thead><tr><th scope="col">Player / market</th><th scope="col">Conversion</th><th scope="col">Bonus bet \u00b7 YES</th><th scope="col">Cash hedge \u00b7 NO</th><th scope="col">Cash needed</th><th scope="col">Hedge capacity</th></tr></thead><tbody>${group.plays.map(renderRow).join('')}</tbody></table></div></section>`).join('');
    const coverage = data.coverage || [];
    const unavailable = coverage.filter(item => item.status !== 'available');
    notice('coverage-status', unavailable.length ? `Unavailable feeds: ${unavailable.map(item => marketNames[item.market] || item.market).join(', ')}. Rankings include only usable current feeds.` : '');
    $('coverage-detail').textContent = coverage.map(item => `${marketNames[item.market] || item.market}: ${item.status === 'available' ? `feed ${time(item.updated_at)}` : 'unavailable'}`).join(' \u00b7 ');
    $('unknown-warning').hidden = (data.options?.liquidity ?? $('liquidity-filter').value) !== 'any';
    $('empty-results').hidden = shown !== 0;
    $('empty-message').textContent = unavailable.length === coverage.length && coverage.length ? 'Current feeds are unavailable. Refresh after prices are published.' : 'Try a smaller bonus, a higher cash cap or more books. Unknown-limit hedges are available as an explicit filter option; their accepted stake still needs to be checked.';
    const exclusions = data.summary?.excluded || {};
    const exclusionLabels = { liquidity: 'insufficient or unknown liquidity', cash: 'cash cap', conversion: 'minimum conversion', stale_quotes: 'old quotes', event_time: 'started or unverified games', no_hedge: 'no opposite quote', conflicts: 'conflicting markets' };
    const counts = Object.entries(exclusionLabels).filter(([key]) => Number(exclusions[key]) > 0).map(([key, label]) => `${Number(exclusions[key]).toLocaleString('en-US')} ${label}`);
    $('excluded-note').textContent = counts.length ? `Filtered candidates: ${counts.join(' \u00b7 ')}.` : '';
    $('updated').textContent = `Checked ${time(data.generated_at)}`;
    $('access-panel').hidden = true;
    $('hedge-results').hidden = false;
  }
  async function refresh() {
    if (!ready) return;
    cancel();
    clearResults();
    if (!ACCESS_TOKEN && !IS_LOCALHOST) { access(401); return; }
    let query;
    try { query = readOptions(); } catch (error) { notice('request-status', error.message); $('updated').textContent = 'Check filters'; return; }
    syncURL(query);
    const requestVersion = version, active = new AbortController();
    controller = active;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; active.abort(); }, 20000);
    $('refresh').disabled = true;
    $('hedge-results').setAttribute('aria-busy', 'true');
    $('updated').textContent = 'Checking prices and capacity...';
    notice('request-status', 'Loading matching hedges...');
    try {
      const response = await fetch(`${API_BASE}/api/hedge?${query}`, { headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}, signal: active.signal, cache: 'no-store' });
      if (requestVersion !== version) return;
      if ([401, 403].includes(response.status)) { access(response.status); return; }
      let data;
      try { data = await response.json(); } catch (_) { throw new Error('Hedge prices could not load. Use Refresh to try again.'); }
      if (requestVersion !== version) return;
      if (!response.ok) throw new Error(response.status === 400 ? data.error || 'Check the filter values and try again.' : 'Hedge prices are unavailable. Use Refresh to try again.');
      if (!Array.isArray(data.groups) || !Array.isArray(data.coverage)) throw new Error('The hedge response is incomplete. Refresh to try again.');
      render(data);
      notice('request-status', '');
    } catch (error) {
      if (requestVersion !== version) return;
      clearResults();
      $('updated').textContent = 'Prices unavailable';
      notice('request-status', timedOut ? 'Price refresh timed out. Use Refresh to try again.' : error.message || 'Hedge prices could not load. Use Refresh to try again.');
    } finally {
      clearTimeout(timeout);
      if (requestVersion === version) { controller = null; $('refresh').disabled = false; $('hedge-results').setAttribute('aria-busy', 'false'); }
    }
  }
  function filterChanged(delay = 0) {
    cancel(); clearResults();
    $('updated').textContent = 'Filters changed';
    pickerSummary();
    try { syncURL(readOptions()); notice('request-status', 'Updating hedges for these filters...'); }
    catch (error) { notice('request-status', error.message); return; }
    timer = setTimeout(refresh, delay);
  }
  function restoreFilters() {
    const query = new URLSearchParams(window.location.search);
    const values = { amount: 'bonus-amount', limit: 'top-limit', min_conversion: 'min-conversion', max_cash: 'max-cash' };
    Object.entries(values).forEach(([key, id]) => { if (query.has(key)) $(id).value = query.get(key); });
    if (['all', 'hr', 'atgs', 'attd'].includes(query.get('market'))) $('market-filter').value = query.get('market');
    if (['verified', 'any'].includes(query.get('liquidity'))) $('liquidity-filter').value = query.get('liquidity');
    [['books', selectedBooks], ['hedge_books', selectedHedgeBooks]].forEach(([key, selected]) => { (query.get(key) || '').split(',').filter(book => /^[a-z0-9_]{1,30}$/.test(book)).forEach(book => selected.add(book)); });
    pickerSummary();
  }
  ['bonus-amount', 'top-limit', 'min-conversion', 'max-cash'].forEach(id => $(id).addEventListener('input', () => filterChanged(350)));
  ['market-filter', 'liquidity-filter'].forEach(id => $(id).addEventListener('change', () => filterChanged()));
  [['bonus-book-options', selectedBooks], ['hedge-book-options', selectedHedgeBooks]].forEach(([id, selected]) => $(id).addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
    filterChanged();
  }));
  [['all-bonus-books', 'bonus-book-options', selectedBooks], ['all-hedge-books', 'hedge-book-options', selectedHedgeBooks]].forEach(([id, target, selected]) => $(id).addEventListener('click', () => {
    selected.clear(); $(target).querySelectorAll('input').forEach(input => { input.checked = false; }); filterChanged();
  }));
  document.addEventListener('click', event => ['bonus-picker', 'hedge-picker'].forEach(id => { if (!$(id).contains(event.target)) $(id).open = false; }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') ['bonus-picker', 'hedge-picker'].forEach(id => { if ($(id).open) { $(id).open = false; $(id).querySelector('summary').focus(); } }); });
  document.addEventListener('error', event => { if (event.target.matches?.('img.book-logo')) event.target.hidden = true; }, true);
  $('hedge-filters').addEventListener('submit', event => { event.preventDefault(); refresh(); });
  $('refresh').addEventListener('click', refresh);
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  async function sessionChanged(session) {
    const token = session?.access_token || '';
    if (ready && token === ACCESS_TOKEN) return;
    cancel(); clearResults();
    ACCESS_TOKEN = token; ready = true;
    $('account-link').textContent = token ? 'My account' : 'Sign in';
    await refresh();
  }
  async function boot() {
    if (IS_LOCALHOST) { await sessionChanged(null); return; }
    try {
      if (!SB) throw new Error();
      SB.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => sessionChanged(session)); });
      const { data, error } = await SB.auth.getSession();
      if (error) throw error;
      await sessionChanged(data.session);
    } catch (_) { clearResults(); notice('request-status', 'Sign-in service unavailable. Reload to try again.'); }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden' && !controller) refresh(); }, 60000);
  setInterval(() => {
    if (!result) return;
    const now = Date.now(), age = (Number(result.max_age_minutes) || 10) * 60000;
    const expired = result.groups.some(group => group.plays.some(play => !finite(Date.parse(play.start)) || Date.parse(play.start) <= now || [play.bonus_updated_at, play.hedge_updated_at].some(value => !Number.isFinite(Date.parse(value)) || now - Date.parse(value) > age)));
    if (expired) { clearResults(); notice('request-status', 'A quote expired or a game started. Refreshing hedge availability...'); if (document.visibilityState !== 'hidden') refresh(); }
  }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refresh(); });
  window.refreshHedges = refresh;
  restoreFilters();
  boot();
})();
