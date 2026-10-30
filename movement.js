(() => {
  'use strict';
  PAGE = 'movement';
  const $ = id => document.getElementById(id);
  const url = new URL(window.location.href);
  const supported = [...$('sport-select').options].map(option => option.value);
  SPORT = supported.includes(url.searchParams.get('sport')) ? url.searchParams.get('sport') : 'mlb';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const odds = value => finite(value) ? `${Number(value) >= 0 ? '+' : '-'}${Math.round(Math.abs(Number(value))).toLocaleString('en-US')}` : '-';
  const percent = value => finite(value) ? `${(Number(value) * 100).toFixed(2)}%` : '-';
  const move = value => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)} pp` : '-';
  const title = value => String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const bookNames = { circa: 'Circa', pn: 'Pinnacle', fd: 'FanDuel', dk: 'DraftKings', b365: 'bet365', mgm: 'BetMGM', cz: 'Caesars', br: 'BetRivers', espn: 'ESPN BET', fn: 'Fanatics', hr: 'Hard Rock', bv: 'Bovada', bol: 'BetOnline', nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', kambi: 'Kambi', re: 'Rebet', fl: 'Fliff', poly: 'Polymarket', hr_az: 'Hard Rock AZ', hr_oh: 'Hard Rock OH' };
  const propNames = { hr: 'Home runs', h: 'Hits', r: 'Runs', rbi: 'RBIs', tb: 'Total bases', so: 'Strikeouts', k: 'Strikeouts', attd: 'Anytime touchdown', anytime_td: 'Anytime touchdown', td: 'Touchdowns', atgs: 'Anytime goalscorer', g: 'Goals', goals: 'Goals', sog: 'Shots on goal', shots: 'Shots on goal', pts: 'Points', points: 'Points', reb: 'Rebounds', ast: 'Assists', pass_yd: 'Passing yards', rush_yd: 'Rushing yards', rec_yd: 'Receiving yards', rec: 'Receptions', ml: 'Moneyline', spread: 'Spread', total: 'Total' };
  const bookName = key => bookNames[key] || title(key);
  const periodNames = { '1h': '1st half', '2h': '2nd half', '1q': '1st quarter', '2q': '2nd quarter', '3q': '3rd quarter', '4q': '4th quarter', '1p': '1st period', '2p': '2nd period', '3p': '3rd period' };
  const extraProps = { '3ptm': 'Threes made', '3pta': 'Three-point attempts', stl: 'Steals', blk: 'Blocks', to: 'Turnovers', fgm: 'Field goals made', fga: 'Field goal attempts', ftm: 'Free throws made', fta: 'Free throw attempts', oreb: 'Offensive rebounds', dreb: 'Defensive rebounds', 'pts+reb': 'Points + rebounds', 'pts+ast': 'Points + assists', 'reb+ast': 'Rebounds + assists', 'pts+reb+ast': 'Points + rebounds + assists', 'blk+stl': 'Blocks + steals', 'stl+blk': 'Steals + blocks', away_total: 'Team total', home_total: 'Team total', fb: 'First basket' };
  function propName(key) {
    const period = /^(1h|2h|1q|2q|3q|4q|1p|2p|3p)_/.exec(key);
    if (period) return `${periodNames[period[1]]} · ${propName(String(key).slice(period[0].length))}`;
    if (key === 'dd') return 'Double double';
    if (key === 'td' && ['nba', 'wnba', 'ncaab'].includes(SPORT)) return 'Triple double';
    return key === 'atgs' && SPORT === 'nhl' ? 'Anytime goalscorer (1+)' : extraProps[key] || propNames[key] || title(key);
  }
  function selectionName(row) {
    if (row.player) return title(row.player);
    const team = /(?:^|_)(away|home)_total$/.exec(row.prop);
    const teams = String(row.game || '').split(/\s*@\s*/);
    return String(team && teams.length === 2 ? teams[team[1] === 'home' ? 1 : 0] : row.game || '').toUpperCase();
  }
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '-';
  const gameTime = value => value && Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}, ${time(value)} ET` : '-';
  const easternDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = (value = Date.now()) => { const parts = Object.fromEntries(easternDayFormat.formatToParts(new Date(value)).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
  const notice = (id, message) => { $(id).textContent = message; $(id).hidden = !message; };
  const colors = ['#78b7fa', '#efbc77', '#b49ae9', '#f18cb2', '#68cbd0', '#e4d570', '#b5ccd9', '#f29669', '#d6a4ff', '#8acde8', '#edb5bb', '#9babf7', '#c8cc9c', '#df95c9', '#d4c4a1', '#65d7bb'];
  const bookOrder = Object.keys(bookNames);
  function bookStyle(book) {
    const known = bookOrder.indexOf(book);
    const index = known >= 0 ? known : [...book].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
    return { color: colors[index % colors.length], dash: ['solid', 'dash', 'dot'][Math.floor(index / colors.length) % 3] };
  }
  const selectedProps = new Set((url.searchParams.get('props') || '').split(',').filter(Boolean));
  const windows = ['1h', '3h', '6h', '12h', 'today'];
  let movementWindow = windows.includes(url.searchParams.get('window')) ? url.searchParams.get('window') : '6h';
  const windowName = () => movementWindow === 'today' ? 'Today' : `Last ${parseInt(movementWindow, 10)} ${movementWindow === '1h' ? 'hour' : 'hours'}`;
  const hiddenBooks = new Set();
  let catalog = null, detail = null, selectedId = '', offset = 0, day = dayOf(), ready = false;
  let summaryController = null, detailController = null, summaryVersion = 0, detailVersion = 0, debounceTimer, midnightTimer;
  let plottedKey = '', focusedBook = '', chartPoints = [], zoomedX = false, zoomedY = false;
  let snapshotPage = 0, snapshotBackdropPressed = false;
  const limit = 100;
  $('sport-select').value = SPORT;
  $('player-search').value = url.searchParams.get('query') || '';
  if (['0', '1', '2'].includes(url.searchParams.get('side'))) $('side-select').value = url.searchParams.get('side');
  if (['all', 'shortening', 'drifting'].includes(url.searchParams.get('direction'))) $('direction-select').value = url.searchParams.get('direction');
  if (url.searchParams.get('reference') && url.searchParams.get('reference') !== 'consensus') {
    const key = url.searchParams.get('reference');
    $('reference-select').add(new Option(bookName(key), key));
    $('reference-select').value = key;
  }
  function sideName(row) { return row.side_labels?.[row.side] || `Side ${Number(row.side || 0) + 1}`; }
  function marketName(row) {
    const binary = ['atgs', 'attd', 'anytime_td', 'dd'].includes(row.prop) || (row.prop === 'td' && ['nba', 'wnba', 'ncaab'].includes(SPORT));
    if (binary && finite(row.handicap) && Number(row.handicap) === .5 && [0, 1].includes(Number(row.side))) return `${propName(row.prop)} · ${Number(row.side) === 1 ? 'No' : 'Yes'}`;
    const hasLine = row.handicap !== '' && row.handicap !== null && row.handicap !== undefined;
    const line = String(row.prop).includes('spread') && Number(row.side) === 1 && finite(row.handicap) ? -Number(row.handicap) : row.handicap;
    return `${propName(row.prop)} · ${title(sideName(row))}${hasLine ? ` ${line}` : ''}`;
  }
  function visibleMarket(row) { return SPORT !== 'nhl' || row.prop !== 'atgs' || (finite(row.handicap) && Number(row.handicap) === .5); }
  function fairTime(row, endpoint) {
    const key = endpoint === 'first' ? 'first_fair_at' : 'current_fair_at';
    return key in row ? row[key] : finite(row[`${endpoint}_fair`]) ? row[endpoint === 'first' ? 'first_at' : 'last_at'] : null;
  }
  function fairBooks(row, endpoint) {
    const value = row[`${endpoint}_reference_books`];
    return Array.isArray(value) ? value : row.reference_books || [];
  }
  function fairCoverage(row, endpoint) {
    if (!finite(row[`${endpoint}_fair`])) return 'No paired quotes';
    const books = fairBooks(row, endpoint);
    return books.length === 1 ? `Single book · ${bookName(books[0])}` : books.length ? `${books.length} books · ${books.map(bookName).join(', ')}` : 'Reference unavailable';
  }
  function compactCoverage(row, endpoint) {
    const books = fairBooks(row, endpoint);
    return books.length > 1 && finite(row[`${endpoint}_fair`]) ? `${books.length} ${row.fair_comparable === false ? 'books · unmatched' : 'reference books'}` : fairCoverage(row, endpoint);
  }
  function referenceName() { return $('reference-select').value === 'consensus' ? 'Sportsbook consensus' : bookName($('reference-select').value); }
  function rowStatus(row) {
    if (row.start && Date.parse(row.start) <= Date.now()) return 'started';
    if (row.last_at && Date.now() - Date.parse(row.last_at) > (catalog?.max_age_minutes || 60) * 60000) return 'stale';
    return row.status || 'ok';
  }
  function singleFairCapture(row) { return !!row.first_fair_at && row.first_fair_at === row.current_fair_at; }
  function usableMove(row) { return singleFairCapture(row) || row.fair_comparable === false || ['started', 'stale'].includes(rowStatus(row)) ? null : row.change_pp; }
  function statusLabel(row) {
    const status = rowStatus(row);
    if (status === 'started') return 'Game started';
    if (status === 'stale') return 'Capture out of date';
    if (!finite(row.first_fair) && !finite(row.current_fair)) return 'Paired quotes unavailable';
    if (!finite(row.first_fair) || !finite(row.current_fair)) return 'Fair comparison unavailable';
    if (singleFairCapture(row)) return 'Awaiting next fair capture';
    if (row.fair_comparable === false) return 'No matched comparison';
    if (finite(row.change_pp)) return Number(row.change_pp) > 0 ? 'Shortening' : Number(row.change_pp) < 0 ? 'Drifting' : 'Unchanged';
    return Number(row.point_count) < 2 ? 'Awaiting next capture' : 'Fair comparison unavailable';
  }
  function moveClass(row) { const value = usableMove(row); return finite(value) && Number(value) > 0 ? 'shortening' : finite(value) && Number(value) < 0 ? 'drifting' : 'unchanged'; }
  function syncURL() {
    const next = new URL(window.location.href);
    const values = { sport: SPORT, query: $('player-search').value.trim(), props: [...selectedProps].join(','), side: $('side-select').value, reference: $('reference-select').value, direction: $('direction-select').value, window: movementWindow };
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'side' && value === '0') && !['consensus', 'all'].includes(value)) next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    }
    history.replaceState(null, '', next);
  }
  function params(id) {
    const query = new URLSearchParams({ sport: SPORT, side: $('side-select').value, reference: $('reference-select').value, window: movementWindow });
    if (id) query.set('id', id);
    else {
      query.set('query', $('player-search').value.trim());
      query.set('props', [...selectedProps].join(','));
      query.set('direction', $('direction-select').value);
      query.set('offset', offset);
      query.set('limit', limit);
    }
    return query;
  }
  function clearChart(message = 'Choose a selection from the slate.') {
    detail = null; plottedKey = ''; focusedBook = ''; chartPoints = []; zoomedX = zoomedY = false;
    $('chart-title').textContent = 'Choose a selection from the slate';
    $('chart-subtitle').textContent = '';
    $('selection-metrics').hidden = true;
    $('movement-chart').hidden = true;
    $('book-picker').hidden = true;
    $('chart-footnote').hidden = true;
    if (window.Plotly) Plotly.purge($('movement-chart'));
    notice('chart-status', message);
  }
  function clearRows(message = 'Loading today’s selections...') {
    catalog = null;
    $('open-slate-snapshot').disabled = true;
    closeSlateSnapshot();
    $('catalog-rows').replaceChildren();
    $('catalog-wrap').hidden = true;
    $('pagination').hidden = true;
    $('catalog-count').textContent = '';
    notice('empty-slate', message);
  }
  function cancelRequests() {
    summaryVersion++; detailVersion++;
    summaryController?.abort(); detailController?.abort();
    summaryController = null; detailController = null;
    $('refresh').disabled = false;
  }
  function resetDay() {
    const current = dayOf();
    if (current === day) return false;
    day = current;
    cancelRequests(); clearTimeout(debounceTimer);
    offset = 0; selectedId = '';
    $('reference-select').replaceChildren(new Option('Sportsbook consensus', 'consensus'));
    syncURL();
    clearRows('A new day has begun. Waiting for today’s first captures.');
    clearChart('History resets at midnight Eastern. Today’s captures will appear here.');
    $('updated').textContent = 'Waiting for today’s captures';
    setDayLabel();
    notice('request-status', '');
    return true;
  }
  function setDayLabel() {
    $('slate-date').textContent = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' }) + ' · Eastern';
  }
  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    const nextDayUTC = Date.parse(`${dayOf()}T00:00:00Z`) + 86400000;
    const nextDay = new Date(nextDayUTC).toISOString().slice(0, 10);
    const atFour = nextDayUTC + 4 * 3600000;
    const midnight = dayOf(atFour) === nextDay ? atFour : nextDayUTC + 5 * 3600000;
    midnightTimer = setTimeout(() => { resetDay(); scheduleMidnight(); if (document.visibilityState !== 'hidden') refresh(); }, Math.max(20, midnight - Date.now() + 20));
  }
  function access(status) {
    cancelRequests(); clearRows(); clearChart(); selectedId = '';
    $('movement-content').hidden = true;
    $('access-panel').hidden = false;
    $('access-message').textContent = status === 403 ? 'Your current plan does not include line movement. Upgrade to Sharp to explore today’s price history.' : 'Sign in to explore today’s price history.';
    notice('request-status', '');
  }
  async function request(query, controller) {
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_BASE}/api/line-movement?${query}`, { signal: controller.signal, headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {} });
      if (response.status === 401 || response.status === 403) { const error = new Error('Access required'); error.status = response.status; throw error; }
      if (response.status === 404) throw new Error('This selection is no longer available in today’s captures. Choose another row.');
      if (!response.ok) throw new Error('Unable to load movement. Please try Refresh.');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function renderOptions(data) {
    const props = [...new Set([...(data.props || []), ...selectedProps])].sort((a, b) => propName(a).localeCompare(propName(b)));
    $('prop-options').innerHTML = props.map(prop => `<label><input type="checkbox" value="${esc(prop)}"${selectedProps.has(prop) ? ' checked' : ''}>${esc(propName(prop))}</label>`).join('') || '<p class="muted">Props appear with the first capture.</p>';
    $('prop-summary').textContent = selectedProps.size ? [...selectedProps].map(propName).join(', ') : 'All props';
    const reference = $('reference-select').value;
    const books = [...new Set([...(Array.isArray(data.books) ? data.books : Object.keys(data.books || {})), ...(reference !== 'consensus' ? [reference] : [])])];
    $('reference-select').replaceChildren(new Option('Sportsbook consensus', 'consensus'), ...books.map(book => new Option(bookName(book), book)));
    $('reference-select').value = reference;
  }
  function renderWindow(data = catalog) {
    document.querySelectorAll('[data-window]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.window === movementWindow)));
    const bounds = data?.window_start && data?.window_end ? `${time(data.window_start)}–${time(data.window_end)} ET` : '';
    $('window-range').textContent = `${windowName()}${bounds ? ` · ${bounds}` : ''}`;
    notice('window-coverage', data?.history_truncated ? `Earlier history is unavailable. Showing retained captures from ${time(data.window_start)} ET; each day resets at midnight Eastern.` : '');
    $('chart-window-label').textContent = `${windowName()} · captured prices`;
    $('slate-title').textContent = movementWindow === 'today' ? "Today's movers" : 'Recent movers';
  }
  function bestCaptured(row) {
    if (['started', 'stale'].includes(rowStatus(row))) return null;
    return Object.entries(row.current_prices || {}).reduce((best, [book, price]) => {
      const probability = implied(price);
      return probability !== null && (!best || probability < best.probability) ? {book, price, probability} : best;
    }, null);
  }
  function bestMarkup(best) {
    if (!best) return '<strong>—</strong><small>No current quote</small>';
    const logo = best.book === 'kambi' ? 'parx' : best.book.startsWith('hr_') ? 'hr' : best.book;
    return `<strong>${odds(best.price)}</strong><small class="captured-book"><img src="logos/${encodeURIComponent(logo)}.png" alt="" width="14" height="14">${esc(bookName(best.book))}</small>`;
  }
  function slateRows() {
    return (catalog?.rows || []).filter(row => visibleMarket(row) && ($('direction-select').value === 'all' || finite(usableMove(row))));
  }
  function closeSlateSnapshot() {
    snapshotBackdropPressed = false;
    if ($('slate-snapshot-dialog').open) $('slate-snapshot-dialog').close();
    $('slate-snapshot-rows').replaceChildren();
    for (const id of ['slate-snapshot-context', 'slate-snapshot-filter-context', 'slate-snapshot-updated', 'slate-snapshot-note', 'slate-snapshot-range', 'slate-snapshot-page']) $(id).textContent = '';
    $('slate-snapshot-prev').disabled = $('slate-snapshot-next').disabled = true;
  }
  function snapshotFair(row, endpoint) {
    const value = row[`${endpoint}_fair`], probability = row[`${endpoint}_probability`];
    const captured = finite(value) ? time(fairTime(row, endpoint)) : '-';
    const carried = endpoint === 'first' && row.first_fair_carried;
    return `<td class="snapshot-fair" data-fair="${endpoint}" title="${esc(fairCoverage(row, endpoint))}"><strong>${odds(value)}</strong><small>${finite(value) ? percent(probability) : '-'}</small><small class="snapshot-capture">${esc(captured)}${captured !== '-' ? ' ET' : ''}${carried && finite(value) ? ' · carried' : ''}</small></td>`;
  }
  function renderSlateSnapshot() {
    if (!catalog) { closeSlateSnapshot(); return; }
    const rows = slateRows(), requested = $('slate-snapshot-limit').value;
    const pageSize = requested === 'all' ? Math.max(1, rows.length) : [10, 15, 25, 50].includes(Number(requested)) ? Number(requested) : 10;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    snapshotPage = Math.max(0, Math.min(snapshotPage, pages - 1));
    const start = snapshotPage * pageSize, shown = rows.slice(start, start + pageSize);
    const captureDay = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    const bounds = catalog.window_start && catalog.window_end ? ` · ${time(catalog.window_start)}–${time(catalog.window_end)} ET` : '';
    $('slate-snapshot-context').textContent = `${SPORT.toUpperCase()} · ${captureDay} · ${windowName()}${bounds} · ${referenceName()}`;
    const description = [selectedProps.size ? [...selectedProps].map(propName).join(', ') : 'All props', $('side-select').selectedOptions[0]?.textContent, $('direction-select').selectedOptions[0]?.textContent];
    const search = $('player-search').value.trim();
    if (search) description.push(`Search: ${search}`);
    $('slate-snapshot-filter-context').textContent = description.filter(Boolean).join(' · ');
    $('slate-snapshot-updated').textContent = catalog.updated ? `Latest capture ${gameTime(catalog.updated)}` : 'Capture time unavailable';
    $('slate-snapshot-page').textContent = `Page ${snapshotPage + 1} of ${pages}`;
    $('slate-snapshot-prev').disabled = snapshotPage === 0;
    $('slate-snapshot-next').disabled = snapshotPage >= pages - 1;
    const batchOffset = Math.max(0, Number(catalog.offset) || 0), total = Number(catalog.total) || rows.length;
    const batch = batchOffset || total > rows.length ? ` · Slate batch starts at ${batchOffset + 1} of ${total.toLocaleString('en-US')} matching selections` : '';
    $('slate-snapshot-range').textContent = `Rows ${shown.length ? start + 1 : 0}–${start + shown.length} of ${rows.length.toLocaleString('en-US')} loaded${batch}`;
    $('slate-snapshot-note').textContent = 'Fair prices exclude margin. Move = fair probability change in percentage points (pp); + shortens, − drifts. Captured prices, not live odds. “Carried” marks an earlier quote used at the window start.';
    $('slate-snapshot-rows').innerHTML = shown.map((row, index) => {
      const movement = finite(row.first_fair) && finite(row.current_fair) ? usableMove(row) : null;
      const color = finite(movement) ? moveClass(row) : 'unchanged';
      return `<tr data-id="${esc(row.id)}"><td class="snapshot-rank">${start + index + 1}</td><td class="snapshot-selection"><strong>${esc(selectionName(row))}</strong><small>${esc(marketName(row))}</small></td><td class="snapshot-game"><strong>${esc(String(row.game || '').toUpperCase())}</strong><small>${esc(gameTime(row.start))}</small></td><td class="snapshot-best">${bestMarkup(bestCaptured(row))}</td>${snapshotFair(row, 'first')}${snapshotFair(row, 'current')}<td class="snapshot-move ${color}"><strong>${move(movement)}</strong><small>${esc(statusLabel(row))}</small></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="snapshot-empty">No captured selections match this view.</td></tr>';
  }
  function renderRows() {
    if (!catalog) return;
    const rows = slateRows();
    $('open-slate-snapshot').disabled = rows.length === 0;
    const scrollTop = $('catalog-wrap').scrollTop;
    const focused = $('catalog-rows').contains(document.activeElement) ? document.activeElement.dataset.id : null;
    $('catalog-rows').innerHTML = rows.map(row => `<button type="button" data-id="${esc(row.id)}" class="movement-play${row.id === selectedId ? ' is-selected' : ''}" aria-pressed="${row.id === selectedId}" aria-label="Chart ${esc(selectionName(row))}, ${esc(marketName(row))}">
      <span class="play-heading"><span class="play-identity"><strong class="play-name">${esc(selectionName(row))}</strong><span class="play-market">${esc(marketName(row))}</span></span><span class="play-chevron" aria-hidden="true">${row.id === selectedId ? "&#10003;" : "&#8599;"}</span></span>
      <span class="play-context"><span>${esc(String(row.game || "").toUpperCase())}</span><span class="play-start">${esc(gameTime(row.start))}</span></span>
      <span class="play-metrics"><span class="play-price"><span>Best captured</span>${bestMarkup(bestCaptured(row))}</span><span title="${esc(fairCoverage(row, 'current'))}"><span>Current fair</span><strong>${odds(row.current_fair)}</strong><small>${percent(row.current_probability)}</small></span><span class="${moveClass(row)}"><span>${esc(movementWindow === 'today' ? 'Today' : movementWindow.toUpperCase())} move</span><strong>${move(usableMove(row))}</strong><small>${esc(statusLabel(row))}</small></span></span>
      <span class="play-baseline"><span>${row.fair_comparable === false ? 'No matched comparison' : `Baseline ${odds(row.first_fair)} → ${odds(row.current_fair)}`}</span><span>${esc(time(fairTime(row, 'first')))}–${esc(time(fairTime(row, 'current')))} ET</span></span>
    </button>`).join('');
    $('catalog-wrap').scrollTop = scrollTop;
    if (focused) [...$('catalog-rows').children].find(card => card.dataset.id === focused)?.focus({preventScroll: true});
    $('catalog-wrap').hidden = rows.length === 0;
    const filtered = $('player-search').value.trim() || selectedProps.size || $('direction-select').value !== 'all' || $('side-select').value !== '0';
    notice('empty-slate', rows.length ? '' : filtered ? 'No captured selections match these filters. Try another player, prop or side.' : movementWindow === 'today' ? 'No pre-game prices captured today yet. History begins with the first scheduled capture; it is not backfilled.' : 'No recorded selections in this window. Try a wider window or Today.');
    $('catalog-count').textContent = `${Number(catalog.total) || 0} selections`;
    $('pagination').hidden = !(catalog.total > limit || offset > 0);
    $('previous-page').disabled = offset === 0;
    $('next-page').disabled = offset + limit >= catalog.total;
    $('page-range').textContent = `${rows.length ? offset + 1 : 0}–${offset + rows.length} of ${catalog.total}`;
    if ($('slate-snapshot-dialog').open) renderSlateSnapshot();
  }
  function renderMetrics(row) {
    $('selection-metrics').hidden = false;
    $('selection-metrics').innerHTML = `<div class="metric-best"><span>Best captured price</span>${bestMarkup(bestCaptured(row))}</div><div title="${esc(fairCoverage(row, 'current'))}"><span>Current fair</span><strong>${odds(row.current_fair)}</strong><small>${percent(row.current_probability)} · ${esc(time(fairTime(row, 'current')))} ET</small><small class="fair-coverage">${esc(compactCoverage(row, 'current'))}</small></div><div><span>${esc(windowName())} move</span><strong class="${moveClass(row)}">${move(usableMove(row))}</strong><small>${esc(statusLabel(row))}</small></div><div title="${esc(fairCoverage(row, 'first'))}"><span>Window baseline</span><strong>${odds(row.first_fair)}</strong><small>${percent(row.first_probability)} · ${esc(time(fairTime(row, 'first')))} ET</small><small class="fair-coverage">${esc(compactCoverage(row, 'first'))}</small>${row.first_fair_carried ? '<small>Earlier recorded prices</small>' : ''}</div>`;
  }
  function implied(value) { return finite(value) && Math.abs(Number(value)) >= 100 ? (Number(value) > 0 ? 100 / (Number(value) + 100) : -Number(value) / (-Number(value) + 100)) : null; }
  function fairFromProbability(p) { return p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p; }
  function americanTicks(range) {
    const low = Math.max(.001, Math.min(...range)), high = Math.min(99.999, Math.max(...range));
    if (!(high > low)) return [];
    const count = window.innerWidth < 700 ? 6 : 8;
    // Join -100/+100 at zero for choosing round labels, while plotting in probability space.
    const coordinate = p => { const price = fairFromProbability(p / 100); return price > 0 ? price - 100 : price + 100; };
    const start = coordinate(high), end = coordinate(low);
    const rough = (end - start) / (count - 1);
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
    const step = [1, 2, 5, 10].map(value => value * magnitude).reduce((best, value) => Math.abs(value - rough) < Math.abs(best - rough) ? value : best);
    let prices = [];
    for (let value = Math.ceil(start / step) * step; value <= end + step * 1e-8; value += step) prices.push(value >= 0 ? value + 100 : value - 100);
    const ticksFor = values => [...new Set(values.map(Math.round))].map(value => ({ p: implied(value) * 100, label: odds(value) }))
      .filter(tick => tick.p >= low && tick.p <= high).sort((a, b) => a.p - b.p);
    let ticks = ticksFor(prices);
    // Very wide ranges need probability-spaced labels to avoid crowded favorites/longshots.
    if (ticks.length < 4 || ticks.some((tick, index) => index && tick.p - ticks[index - 1].p < (high - low) / (count * 2.2))) {
      prices = Array.from({ length: count + 2 }, (_, index) => {
        const price = fairFromProbability((low + (high - low) * index / (count + 1)) / 100);
        const amount = Math.abs(price);
        const rounding = amount < 200 ? 5 : amount < 500 ? 10 : amount < 1000 ? 25 : amount < 2500 ? 50 : 10 ** (Math.floor(Math.log10(amount)) - 1);
        return Math.sign(price) * Math.max(100, Math.round(amount / rounding) * rounding);
      });
      ticks = ticksFor(prices);
    }
    return ticks;
  }
  function updatePriceReadout(index = chartPoints.length - 1) {
    const point = chartPoints[index];
    $('book-price-time').textContent = point ? `${point.carried ? 'Earlier prices at window start' : index === chartPoints.length - 1 ? 'Latest capture' : 'Captured'} · ${time(point.ts)} ET` : '';
    $('book-options').querySelectorAll('.movement-book').forEach(item => {
      const price = point?.prices?.[item.dataset.book];
      const value = item.querySelector('.book-price');
      value.textContent = implied(price) === null ? '-' : odds(price);
      value.title = implied(price) === null ? 'No quote at this capture' : `${bookName(item.dataset.book)} at ${time(point.ts)} ET`;
    });
  }
  function applyBookFocus() {
    const chart = $('movement-chart');
    $('book-options').querySelectorAll('.movement-book').forEach(item => {
      const active = item.dataset.book === focusedBook;
      item.classList.toggle('is-focused', active);
      item.querySelector('.book-focus').setAttribute('aria-pressed', String(active));
    });
    if (chart.hidden || !chart.data?.length || !window.Plotly) return;
    Plotly.restyle(chart, {
      opacity: chart.data.map(trace => !focusedBook || trace.meta?.book === focusedBook ? 1 : trace.meta?.fair ? .55 : .18),
      'line.width': chart.data.map(trace => trace.meta?.fair ? 3.5 : trace.meta?.book === focusedBook ? 3.4 : 2),
      'marker.size': chart.data.map(trace => trace.meta?.fair ? 6 : trace.meta?.book === focusedBook ? 6 : 4)
    });
  }
  function refreshOddsTicks() {
    const chart = $('movement-chart');
    if (chart.hidden || !chart._fullLayout || $('chart-scale').value === 'probability') return;
    const ticks = americanTicks(chart._fullLayout.yaxis.range);
    const tickvals = ticks.map(tick => tick.p), ticktext = ticks.map(tick => tick.label);
    if (JSON.stringify(chart.layout.yaxis.tickvals) === JSON.stringify(tickvals)) return;
    Plotly.relayout(chart, { 'yaxis.tickvals': tickvals, 'yaxis.ticktext': ticktext });
  }
  function wirePriceChart(chart) {
    // Replace our handlers after react; never accumulate them during polling or book toggles.
    for (const [event, handler] of Object.entries(chart.movementHandlers || {})) chart.removeListener(event, handler);
    chart.movementHandlers = {
      plotly_hover: event => { const index = event.points?.[0]?.pointNumber; if (Number.isInteger(index)) updatePriceReadout(index); },
      plotly_unhover: () => updatePriceReadout(),
      plotly_relayout: event => {
        const keys = Object.keys(event);
        if ('xaxis.autorange' in event) zoomedX = false;
        else if (keys.some(key => key.startsWith('xaxis.range'))) zoomedX = true;
        if ('yaxis.autorange' in event) zoomedY = false;
        else if (keys.some(key => key.startsWith('yaxis.range'))) zoomedY = true;
        // Autoscale must retain the price-axis direction after a manual zoom.
        if (event['yaxis.autorange'] === true) { Plotly.relayout(chart, { 'yaxis.autorange': 'reversed' }); return; }
        if (keys.some(key => key.startsWith('yaxis.range') || key === 'yaxis.autorange' || key === 'width' || key === 'height')) refreshOddsTicks();
      }
    };
    for (const [event, handler] of Object.entries(chart.movementHandlers)) chart.on(event, handler);
  }
  function renderChart() {
    if (!detail?.selection) return;
    const row = detail.selection;
    $('chart-title').textContent = selectionName(row);
    $('chart-subtitle').textContent = `${marketName(row)} · ${String(row.game || '').toUpperCase()} · ${gameTime(row.start)} · ${referenceName()}`;
    renderMetrics(row);
    const windowStart = Date.parse(detail.window_start), windowEnd = Date.parse(detail.window_end);
    const points = (detail.points || []).filter(point => dayOf(point.ts) === day && (!Number.isFinite(windowStart) || Date.parse(point.ts) >= windowStart) && (!Number.isFinite(windowEnd) || Date.parse(point.ts) <= windowEnd));
    chartPoints = points;
    const books = [...new Set(points.flatMap(point => Object.keys(point.prices || {})))].sort();
    if (!books.includes(focusedBook) || hiddenBooks.has(focusedBook)) focusedBook = '';
    $('book-options').innerHTML = books.map(book => {
      const style = bookStyle(book), logo = book === 'kambi' ? 'parx' : book.startsWith('hr_') ? 'hr' : book;
      return `<div class="movement-book${hiddenBooks.has(book) ? ' is-hidden' : ''}${focusedBook === book ? ' is-focused' : ''}" data-book="${esc(book)}" style="--book-color:${style.color}"><label><input type="checkbox" value="${esc(book)}"${hiddenBooks.has(book) ? '' : ' checked'}><span class="book-swatch" style="border-top-style:${style.dash === 'solid' ? 'solid' : style.dash === 'dot' ? 'dotted' : 'dashed'}"></span><img class="book-logo" src="logos/${encodeURIComponent(logo)}.png" alt=""><span class="book-name">${esc(bookName(book))}</span><strong class="book-price"></strong></label><button type="button" class="book-focus" data-focus-book="${esc(book)}" aria-label="Focus ${esc(bookName(book))}" aria-pressed="${focusedBook === book}"${hiddenBooks.has(book) ? ' disabled' : ''}>Focus</button></div>`;
    }).join('');
    updatePriceReadout();
    $('book-picker').hidden = !books.length;
    const cohort = row.reference_books || [];
    let message = '';
    if (rowStatus(row) === 'started') message = 'Game started. Showing captured pre-game history; this selection is no longer ranked as a current mover.';
    else if (rowStatus(row) === 'stale') message = 'These captures are out of date. Showing recorded history; this selection is no longer ranked as a current mover.';
    else if (row.note) message = row.note;
    else if (!points.some(point => finite(point.probability))) message = finite(row.first_fair) || finite(row.current_fair)
      ? 'First and latest available fair values are shown above with their reference books. Fewer than two sportsbooks have matched paired prices, so no consensus movement is ranked or connected on the chart.'
      : 'Fair value unavailable: actual paired prices are missing. Available book prices are shown below; missing opposite-side quotes are never estimated.';
    else if (singleFairCapture(row)) message = 'First usable fair capture recorded. Movement appears after another capture with matching paired prices.';
    else if (Number(row.point_count) < 2) message = 'First capture recorded. Movement appears after a second capture.';
    if (row.note && message !== row.note) message = `${message} ${row.note}`.trim();
    notice('chart-status', message);
    if (!points.length) { $('movement-chart').hidden = true; notice('chart-status', movementWindow === 'today' ? 'No recorded prices for this selection today.' : 'No recorded prices for this selection in this window. Try a wider window or Today.'); return; }
    const probabilityScale = $('chart-scale').value === 'probability';
    const x = points.map(point => Date.parse(point.ts));
    const times = points.map(point => `${time(point.ts)} ET${point.carried ? ' · Earlier recorded prices' : ''}`);
    const traces = books.filter(book => !hiddenBooks.has(book)).map(book => ({
      type: 'scatter', mode: 'lines+markers', name: bookName(book), x, meta: { book },
      y: points.map(point => { const p = implied(point.prices?.[book]); return p === null ? null : p * 100; }),
      customdata: points.map((point, index) => [times[index], odds(point.prices?.[book])]),
      line: { ...bookStyle(book), width: focusedBook === book ? 3.4 : 2, shape: 'hv' }, marker: { size: focusedBook === book ? 6 : 4 }, connectgaps: false,
      opacity: !focusedBook || focusedBook === book ? 1 : .18,
      hovertemplate: `<b>${esc(bookName(book))} %{customdata[1]}</b><br>%{customdata[0]}${probabilityScale ? '<br>Implied: %{y:.2f}%' : ''}<extra></extra>`,
    }));
    if (points.some(point => finite(point.probability))) traces.push({
      type: 'scatter', mode: 'lines+markers', name: `${referenceName()} fair`, x, meta: { fair: true }, opacity: focusedBook ? .55 : 1,
      y: points.map(point => finite(point.probability) ? Number(point.probability) * 100 : null),
      customdata: points.map((point, index) => [times[index], odds(point.fair)]),
      line: { color: '#66d7ee', width: 3.5, shape: 'hv' }, marker: { size: 6 }, connectgaps: false,
      hovertemplate: '<b>Fair %{customdata[1]}</b><br>%{customdata[0]}<br>Fair probability: %{y:.2f}%<extra></extra>',
    });
    $('chart-footnote').hidden = false;
    $('chart-footnote').textContent = `${points.some(point => finite(point.probability)) ? `Bold cyan is fair value after removing the margin${cohort.length ? ` (${cohort.map(bookName).join(', ')})` : ''}. Other lines are` : 'Lines are'} captured book prices${probabilityScale ? ', shown as implied probability including margin' : ''}. Gaps mean a usable quote was unavailable. ${points.some(point => point.carried) ? 'The window starts with earlier recorded prices, not a new observation. ' : ''}${row.fair_comparable === false && $('reference-select').value === 'consensus' ? 'Endpoint fair values may use different books and are not connected as a consensus move. ' : ''}Captured about every ${Number(catalog?.interval_minutes) || 30} minutes; these are not live quotes. Times are Eastern.`;
    if (!traces.length) { $('movement-chart').hidden = true; notice('chart-status', 'Select a sportsbook to display its captured prices.'); return; }
    if (!window.Plotly) { notice('chart-status', 'The chart could not load. Refresh this page to try again.'); return; }
    const yValues = traces.flatMap(trace => trace.y).filter(finite);
    if (!yValues.length) { $('movement-chart').hidden = true; notice('chart-status', 'No captured prices for this side at the selected books. Try another side or sportsbook.'); return; }
    const padding = Math.max(.12, (Math.max(...yValues) - Math.min(...yValues)) * .12);
    const low = Math.max(.01, Math.min(...yValues) - padding), high = Math.min(99.99, Math.max(...yValues) + padding);
    const tickIndexes = [...new Set(Array.from({ length: Math.min(6, points.length) }, (_, index) => Math.round(index * (points.length - 1) / Math.max(1, Math.min(6, points.length) - 1))))];
    if (!$('play-detail').getClientRects().length) { $('movement-chart').hidden = true; return; }
    $('movement-chart').hidden = false;
    const chartKey = `${SPORT}:${row.id}:${row.side}:${$('reference-select').value}:${day}:${movementWindow}:${probabilityScale}`;
    if (plottedKey !== chartKey) zoomedX = zoomedY = false;
    const currentRange = zoomedY ? $('movement-chart')._fullLayout?.yaxis.range : null;
    const currentTimes = zoomedX ? $('movement-chart')._fullLayout?.xaxis.range : null;
    const ticks = americanTicks(currentRange || [high, low]);
    Plotly.react($('movement-chart'), traces, {
      width: $('movement-chart').clientWidth, height: $('movement-chart').clientHeight,
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#b7c8d2', family: 'Inter, system-ui, sans-serif', size: 11 },
      margin: { l: 72, r: 20, t: 18, b: 66 }, showlegend: false, hovermode: 'closest', dragmode: 'pan', uirevision: chartKey,
      hoverlabel: { bgcolor: '#111b22', bordercolor: '#708899', font: { color: '#edf3f7', size: 14 } },
      xaxis: { type: 'linear', tickvals: tickIndexes.map(index => x[index]), ticktext: tickIndexes.map(index => time(points[index].ts)), title: { text: 'Capture time · Eastern', standoff: 16 }, gridcolor: '#303b42', zeroline: false, showspikes: true, spikemode: 'across', spikesnap: 'data', spikecolor: '#71828d', spikethickness: 1, ...(currentTimes ? { range: currentTimes, autorange: false } : x.length === 1 ? { range: [x[0] - 900000, x[0] + 900000], autorange: false } : { autorange: true }) },
      yaxis: { title: { text: probabilityScale ? 'Probability (%)' : 'American odds', standoff: 12 }, gridcolor: '#303b42', zeroline: false, ...(probabilityScale ? { ticksuffix: '%' } : { tickvals: ticks.map(tick => tick.p), ticktext: ticks.map(tick => tick.label) }), range: currentRange || [high, low], autorange: false },
    }, { responsive: true, displaylogo: false, scrollZoom: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'], toImageButtonOptions: { filename: 'line-movement' } }).then(() => {
      if (plottedKey === chartKey && !$('movement-chart').hidden) wirePriceChart($('movement-chart'));
    });
    plottedKey = chartKey;
  }
  async function loadDetail(id, force = false) {
    if (!id || !ready) return;
    const existing = detail?.selection;
    if (!force && existing?.id === id) { renderChart(); return; }
    detailController?.abort();
    const version = ++detailVersion, controller = new AbortController();
    detailController = controller;
    selectedId = id;
    if (existing?.id !== id) clearChart('Loading price history...');
    renderRows();
    try {
      const data = await request(params(id), controller);
      if (version !== detailVersion || !data) return;
      if (resetDay() || data.day !== day || data.sport !== SPORT) { clearChart('Waiting for captures in this window.'); return; }
      if (data.window !== movementWindow) { clearChart('Chosen window is unavailable. Refresh after the movement service updates.'); return; }
      detail = data;
      if (!data.selection || !visibleMarket(data.selection)) { clearChart(`${movementWindow === 'today' ? 'No recorded prices for this selection today.' : 'No recorded prices for this selection in this window. Try a wider window or Today.'}${SPORT === 'nhl' ? ' NHL anytime goalscorer history includes only the 0.5 line (1+ goal).' : ''}`); return; }
      renderChart();
    } catch (error) {
      if (version === detailVersion) {
        if (error.status === 401 || error.status === 403) access(error.status);
        else notice('chart-status', error.name === 'AbortError' ? 'Price history timed out. Try Refresh.' : error.message);
      }
    } finally { if (version === detailVersion) detailController = null; }
  }
  async function refresh() {
    resetDay();
    if (!ready) return;
    if (!ACCESS_TOKEN && !IS_LOCALHOST) { access(401); return; }
    summaryController?.abort();
    const version = ++summaryVersion, controller = new AbortController();
    summaryController = controller;
    $('refresh').disabled = true;
    try {
      const data = await request(params(), controller);
      if (version !== summaryVersion || !data) return;
      if (resetDay()) return;
      $('access-panel').hidden = true;
      $('movement-content').hidden = false;
      if (data.day !== day || data.sport !== SPORT) { clearRows('Waiting for captures in this window.'); clearChart('Waiting for captures in this window.'); notice('request-status', 'Capture data for this window is not available yet.'); return; }
      if (data.window !== movementWindow) {
        const message = 'Chosen window is unavailable. Refresh after the movement service updates.';
        clearRows(message); clearChart(message); notice('request-status', message); return;
      }
      const previousUpdate = catalog?.updated;
      // Older API deployments may still return alternate ATGS lines. Keep their
      // server offsets for pagination; new payloads arrive filtered already.
      const originalRowCount = (data.rows || []).length;
      data.rows = (data.rows || []).filter(visibleMarket);
      if (!offset && data.total === originalRowCount) data.total = data.rows.length;
      catalog = data;
      renderOptions(data); renderRows(); renderWindow(data);
      $('updated').textContent = data.updated ? `Latest capture ${time(data.updated)} ET` : 'Waiting for first capture';
      const interval = Number(data.interval_minutes) || 30;
      $('day-note').textContent = `Captured pre-game prices · About every ${interval} minutes · Not live odds · Resets at midnight Eastern`;
      $('capture-methodology').textContent = `History starts with the first observed pre-game capture today, not a sportsbook’s official opening price. New captures are recorded about every ${interval} minutes. Each handicap is tracked separately; NHL anytime goalscorer includes only 0.5 (1+ goal). Fair timestamps mark usable paired prices, which may begin after the first raw capture. History resets at midnight Eastern. Captures older than ${Number(data.max_age_minutes) || 60} minutes and started games are excluded from current mover rankings; their recorded charts remain available today.`;
      notice('request-status', data.status === 'stale' ? 'The latest capture is out of date. Showing recorded history while waiting for a new capture.' : data.status === 'awaiting_today' ? 'Waiting for today’s first capture. Yesterday’s history has been cleared.' : '');
      const rows = data.rows || [];
      const chosen = rows.find(row => row.id === selectedId) || rows.find(row => finite(usableMove(row))) || rows[0];
      if (chosen) await loadDetail(chosen.id, previousUpdate !== data.updated || !detail || detail.selection?.id !== chosen.id
        || detail.window !== data.window || detail.window_start !== data.window_start || detail.window_end !== data.window_end);
      else { selectedId = ''; detailVersion++; detailController?.abort(); clearChart(movementWindow === 'today' ? 'Search another player or prop, or return after the first capture.' : 'No recorded prices in this window. Try a wider window or Today.'); }
    } catch (error) {
      if (version !== summaryVersion) return;
      if (error.status === 401 || error.status === 403) { access(error.status); return; }
      notice('request-status', error.name === 'AbortError' ? 'Movement refresh timed out. Try Refresh.' : error.message);
      if (!catalog) { $('movement-content').hidden = false; clearRows('Movement could not be loaded. Use Refresh to try again.'); clearChart('Price history is unavailable until the slate loads.'); }
    } finally { if (version === summaryVersion) { summaryController = null; $('refresh').disabled = false; } }
  }
  function filterChanged(delay = 0, keepDetail = false) {
    cancelRequests(); clearTimeout(debounceTimer); offset = 0;
    if (!keepDetail) $('movement-content').classList.remove('show-play-detail');
    clearRows(); clearChart('Loading matching selections...');
    syncURL(); renderWindow(null);
    debounceTimer = setTimeout(refresh, delay);
  }
  $('open-slate-snapshot').addEventListener('click', () => {
    if (resetDay() || !catalog || !slateRows().length) return;
    snapshotPage = 0;
    renderSlateSnapshot();
    $('slate-snapshot-dialog').showModal();
    $('slate-snapshot-dialog').querySelector('.slate-snapshot-scroll').scrollTop = 0;
    $('slate-snapshot-close').focus();
  });
  const changeSnapshotPage = delta => {
    snapshotPage += delta;
    renderSlateSnapshot();
    $('slate-snapshot-dialog').querySelector('.slate-snapshot-scroll').scrollTop = 0;
  };
  $('slate-snapshot-limit').addEventListener('change', () => { snapshotPage = 0; changeSnapshotPage(0); });
  $('slate-snapshot-prev').addEventListener('click', () => changeSnapshotPage(-1));
  $('slate-snapshot-next').addEventListener('click', () => changeSnapshotPage(1));
  $('slate-snapshot-close').addEventListener('click', closeSlateSnapshot);
  $('slate-snapshot-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSlateSnapshot(); });
  $('slate-snapshot-dialog').addEventListener('close', () => {
    closeSlateSnapshot();
    if (!$('open-slate-snapshot').disabled && !$('movement-content').hidden) $('open-slate-snapshot').focus({preventScroll: true});
  });
  const outsideSnapshot = event => {
    const bounds = $('slate-snapshot-dialog').getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  $('slate-snapshot-dialog').addEventListener('pointerdown', event => { snapshotBackdropPressed = event.button === 0 && event.target === $('slate-snapshot-dialog') && outsideSnapshot(event); });
  $('slate-snapshot-dialog').addEventListener('pointercancel', () => { snapshotBackdropPressed = false; });
  $('slate-snapshot-dialog').addEventListener('click', event => {
    if (snapshotBackdropPressed && event.target === $('slate-snapshot-dialog') && outsideSnapshot(event)) closeSlateSnapshot();
    snapshotBackdropPressed = false;
  });
  $('slate-snapshot-rows').addEventListener('error', event => { if (event.target.matches('img')) event.target.hidden = true; }, true);
  $('sport-select').addEventListener('change', () => {
    SPORT = $('sport-select').value; selectedId = ''; selectedProps.clear();
    $('side-select').value = '0'; $('reference-select').value = 'consensus';
    renderOptions({ props: [], books: [] });
    document.title = `${SPORT.toUpperCase()} line movement | +EV Sharps`;
    filterChanged();
  });
  $('player-search').addEventListener('input', () => filterChanged(250));
  $('toggle-filters').addEventListener('click', () => {
    const expanded = $('toggle-filters').getAttribute('aria-expanded') !== 'true';
    $('toggle-filters').setAttribute('aria-expanded', String(expanded));
    $('toggle-filters').closest('.filters').classList.toggle('filters-expanded', expanded);
    $('toggle-filters').innerHTML = `${expanded ? 'Fewer filters' : 'More filters'} <span aria-hidden="true">${expanded ? '−' : '+'}</span>`;
  });
  ['side-select', 'reference-select', 'direction-select'].forEach(id => $(id).addEventListener('change', () => filterChanged()));
  $('prop-options').addEventListener('change', event => {
    if (!event.target.matches('input')) return;
    if (event.target.checked) selectedProps.add(event.target.value); else selectedProps.delete(event.target.value);
    $('prop-summary').textContent = selectedProps.size ? [...selectedProps].map(propName).join(', ') : 'All props';
    filterChanged();
  });
  $('all-props').addEventListener('click', () => { selectedProps.clear(); $('prop-options').querySelectorAll('input').forEach(input => { input.checked = false; }); $('prop-summary').textContent = 'All props'; filterChanged(); });
  document.addEventListener('click', event => { if (!$('prop-picker').contains(event.target)) $('prop-picker').open = false; });
  document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.window === movementWindow) return;
    movementWindow = button.dataset.window;
    filterChanged(0, true);
  }));
  $('catalog-rows').addEventListener('click', event => {
    const row = event.target.closest('.movement-play[data-id]');
    if (row) {
      const mobile = window.matchMedia('(max-width: 850px)').matches;
      if (mobile) $('movement-content').classList.add('show-play-detail');
      loadDetail(row.dataset.id);
      if (mobile) {
        $('play-detail').scrollIntoView({behavior: 'smooth', block: 'start'});
        $('back-to-plays').focus({preventScroll: true});
      }
    }
  });
  $('catalog-rows').addEventListener('error', event => { if (event.target.matches('img')) event.target.hidden = true; }, true);
  $('selection-metrics').addEventListener('error', event => { if (event.target.matches('img')) event.target.hidden = true; }, true);
  $('back-to-plays').addEventListener('click', () => {
    $('movement-content').classList.remove('show-play-detail');
    $('slate-title').scrollIntoView({behavior: 'smooth', block: 'start'});
    [...$('catalog-rows').children].find(card => card.dataset.id === selectedId)?.focus({preventScroll: true});
  });
  $('book-options').addEventListener('change', event => { if (!event.target.matches('input')) return; if (event.target.checked) hiddenBooks.delete(event.target.value); else hiddenBooks.add(event.target.value); renderChart(); });
  $('book-options').addEventListener('click', event => {
    const button = event.target.closest('[data-focus-book]');
    if (!button || button.disabled) return;
    focusedBook = focusedBook === button.dataset.focusBook ? '' : button.dataset.focusBook;
    applyBookFocus();
  });
  $('book-options').addEventListener('error', event => { if (event.target.matches('img')) event.target.hidden = true; }, true);
  $('show-all-books').addEventListener('click', () => { hiddenBooks.clear(); focusedBook = ''; renderChart(); });
  $('hide-all-books').addEventListener('click', () => {
    $('book-options').querySelectorAll('input').forEach(input => hiddenBooks.add(input.value));
    focusedBook = ''; renderChart();
  });
  $('chart-scale').addEventListener('change', renderChart);
  window.matchMedia('(max-width: 850px)').addEventListener('change', () => { if (detail?.selection) renderChart(); });
  if (window.ResizeObserver) new ResizeObserver(() => {
    const chart = $('movement-chart');
    if (!chart.hidden && chart.getClientRects().length && chart.clientWidth > 0 && chart.clientHeight > 0 && chart.data && chart._fullLayout && window.Plotly && (chart._fullLayout.width !== chart.clientWidth || chart._fullLayout.height !== chart.clientHeight)) {
      Plotly.relayout(chart, { width: chart.clientWidth, height: chart.clientHeight });
    }
  }).observe($('movement-chart'));
  $('refresh').addEventListener('click', () => { detail = null; refresh(); });
  $('previous-page').addEventListener('click', () => { offset = Math.max(0, offset - limit); refresh(); });
  $('next-page').addEventListener('click', () => { offset += limit; refresh(); });
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  async function sessionChanged(session) {
    const token = session?.access_token || '';
    if (ready && token === ACCESS_TOKEN) return;
    cancelRequests(); ACCESS_TOKEN = token; ready = true; selectedId = '';
    clearRows(); clearChart(); $('movement-content').hidden = true;
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
    } catch (_) { notice('request-status', 'Sign-in service unavailable. Reload to try again.'); }
  }
  setInterval(() => {
    resetDay();
    if (document.visibilityState !== 'hidden') { renderRows(); if (detail?.selection) renderMetrics(detail.selection); refresh(); }
  }, 60000);
  document.addEventListener('visibilitychange', () => { resetDay(); if (document.visibilityState !== 'hidden') refresh(); });
  window.refreshMovement = refresh;
  renderWindow(null); setDayLabel(); scheduleMidnight(); boot();
})();
