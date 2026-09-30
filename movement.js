(() => {
  'use strict';
  PAGE = 'movement';
  const $ = id => document.getElementById(id);
  const url = new URL(window.location.href);
  const supported = [...$('sport-select').options].map(option => option.value);
  SPORT = supported.includes(url.searchParams.get('sport')) ? url.searchParams.get('sport') : 'mlb';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const odds = value => finite(value) ? `${Number(value) >= 0 ? '+' : '-'}${Math.round(Math.abs(Number(value))).toLocaleString('en-US')}` : '—';
  const percent = value => finite(value) ? `${(Number(value) * 100).toFixed(2)}%` : '—';
  const move = value => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)} pp` : '—';
  const title = value => String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const bookNames = { circa: 'Circa', pn: 'Pinnacle', fd: 'FanDuel', dk: 'DraftKings', b365: 'bet365', mgm: 'BetMGM', cz: 'Caesars', br: 'BetRivers', espn: 'ESPN BET', fn: 'Fanatics', hr: 'Hard Rock', bv: 'Bovada', bol: 'BetOnline', nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', kambi: 'Kambi' };
  const propNames = { hr: 'Home runs', h: 'Hits', r: 'Runs', rbi: 'RBIs', tb: 'Total bases', so: 'Strikeouts', k: 'Strikeouts', attd: 'Anytime touchdown', anytime_td: 'Anytime touchdown', td: 'Touchdowns', atgs: 'Anytime goalscorer', g: 'Goals', goals: 'Goals', sog: 'Shots on goal', shots: 'Shots on goal', pts: 'Points', points: 'Points', reb: 'Rebounds', ast: 'Assists', pass_yd: 'Passing yards', rush_yd: 'Rushing yards', rec_yd: 'Receiving yards', rec: 'Receptions', ml: 'Moneyline', spread: 'Spread', total: 'Total' };
  const bookName = key => bookNames[key] || title(key);
  const propName = key => propNames[key] || title(key);
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '—';
  const gameTime = value => value && Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}, ${time(value)} ET` : '—';
  const easternDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = (value = Date.now()) => { const parts = Object.fromEntries(easternDayFormat.formatToParts(new Date(value)).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
  const notice = (id, message) => { $(id).textContent = message; $(id).hidden = !message; };
  const colors = ['#78b7fa', '#efbc77', '#b49ae9', '#f18cb2', '#68cbd0', '#d1ca7f', '#a1b8ca', '#e89970'];
  const selectedProps = new Set((url.searchParams.get('props') || '').split(',').filter(Boolean));
  const hiddenBooks = new Set();
  let catalog = null, detail = null, selectedId = '', offset = 0, day = dayOf(), ready = false;
  let summaryController = null, detailController = null, summaryVersion = 0, detailVersion = 0, debounceTimer, midnightTimer;
  let plottedKey = '';
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
    const hasLine = row.handicap !== '' && row.handicap !== null && row.handicap !== undefined;
    const line = String(row.prop).includes('spread') && Number(row.side) === 1 && finite(row.handicap) ? -Number(row.handicap) : row.handicap;
    return `${propName(row.prop)} · ${title(sideName(row))}${hasLine ? ` ${line}` : ''}`;
  }
  function referenceName() { return $('reference-select').value === 'consensus' ? 'Sportsbook consensus' : bookName($('reference-select').value); }
  function rowStatus(row) {
    if (row.start && Date.parse(row.start) <= Date.now()) return 'started';
    if (row.last_at && Date.now() - Date.parse(row.last_at) > (catalog?.max_age_minutes || 60) * 60000) return 'stale';
    return row.status || 'ok';
  }
  function usableMove(row) { return ['started', 'stale'].includes(rowStatus(row)) ? null : row.change_pp; }
  function statusLabel(row) {
    const status = rowStatus(row);
    if (status === 'started') return 'Game started';
    if (status === 'stale') return 'Capture out of date';
    if (finite(row.change_pp)) return Number(row.change_pp) > 0 ? 'Shortening' : Number(row.change_pp) < 0 ? 'Drifting' : 'Unchanged';
    return Number(row.point_count) < 2 ? 'Awaiting next capture' : 'Fair value unavailable';
  }
  function moveClass(row) { const value = usableMove(row); return finite(value) && Number(value) > 0 ? 'shortening' : finite(value) && Number(value) < 0 ? 'drifting' : 'unchanged'; }
  function syncURL() {
    const next = new URL(window.location.href);
    const values = { sport: SPORT, query: $('player-search').value.trim(), props: [...selectedProps].join(','), side: $('side-select').value, reference: $('reference-select').value, direction: $('direction-select').value };
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'side' && value === '0') && !['consensus', 'all'].includes(value)) next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    }
    history.replaceState(null, '', next);
  }
  function params(id) {
    const query = new URLSearchParams({ sport: SPORT, side: $('side-select').value, reference: $('reference-select').value });
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
    detail = null; plottedKey = '';
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
      const response = await fetch(`${API_BASE}/api/line-movement?${query}`, { signal: controller.signal, headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
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
  function renderRows() {
    if (!catalog) return;
    const rows = (catalog.rows || []).filter(row => $('direction-select').value === 'all' || finite(usableMove(row)));
    $('catalog-rows').innerHTML = rows.map(row => `<tr data-id="${esc(row.id)}" class="${row.id === selectedId ? 'is-selected' : ''}"><td><strong>${esc(title(row.player || row.game))}</strong><small>${esc(marketName(row))}</small><small>${esc(String(row.game || '').toUpperCase())} · ${esc(gameTime(row.start))}</small></td><td><strong>${odds(row.first_fair)}</strong><small>${percent(row.first_probability)}</small></td><td><strong>${odds(row.current_fair)}</strong><small>${percent(row.current_probability)}</small></td><td class="${moveClass(row)}"><strong>${move(usableMove(row))}</strong><small>${esc(statusLabel(row))}</small></td><td>${esc(time(row.first_at))} → ${esc(time(row.last_at))}<small>${Number(row.point_count) || 0} captured points</small></td><td><button class="chart-row" type="button" aria-label="Chart ${esc(title(row.player || row.game))}, ${esc(marketName(row))}" aria-pressed="${row.id === selectedId}">Chart</button></td></tr>`).join('');
    $('catalog-wrap').hidden = rows.length === 0;
    const filtered = $('player-search').value.trim() || selectedProps.size || $('direction-select').value !== 'all' || $('side-select').value !== '0';
    notice('empty-slate', rows.length ? '' : filtered ? 'No captured selections match these filters. Try another player, prop or side.' : 'No pre-game prices captured today yet. History begins with the first scheduled capture; it is not backfilled.');
    $('catalog-count').textContent = `${Number(catalog.total) || 0} selections`;
    $('pagination').hidden = !(catalog.total > limit || offset > 0);
    $('previous-page').disabled = offset === 0;
    $('next-page').disabled = offset + limit >= catalog.total;
    $('page-range').textContent = `${rows.length ? offset + 1 : 0}–${offset + rows.length} of ${catalog.total}`;
  }
  function renderMetrics(row) {
    $('selection-metrics').hidden = false;
    $('selection-metrics').innerHTML = `<div><span>First captured fair</span><strong>${odds(row.first_fair)}</strong><small>${percent(row.first_probability)} · ${esc(time(row.first_at))} ET</small></div><div><span>Latest captured fair</span><strong>${odds(row.current_fair)}</strong><small>${percent(row.current_probability)} · ${esc(time(row.last_at))} ET</small></div><div><span>Fair probability move</span><strong class="${moveClass(row)}">${move(usableMove(row))}</strong><small>${esc(statusLabel(row))}</small></div>`;
  }
  function implied(value) { return finite(value) && Math.abs(Number(value)) >= 100 ? (Number(value) > 0 ? 100 / (Number(value) + 100) : -Number(value) / (-Number(value) + 100)) : null; }
  function fairFromProbability(p) { return p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p; }
  function renderChart() {
    if (!detail?.selection) return;
    const row = detail.selection;
    $('chart-title').textContent = title(row.player || row.game);
    $('chart-subtitle').textContent = `${marketName(row)} · ${String(row.game || '').toUpperCase()} · ${gameTime(row.start)} · ${referenceName()}`;
    renderMetrics(row);
    const points = (detail.points || []).filter(point => dayOf(point.ts) === day);
    const books = [...new Set(points.flatMap(point => Object.keys(point.prices || {})))].sort();
    $('book-options').innerHTML = books.map((book, index) => `<label><input type="checkbox" value="${esc(book)}"${hiddenBooks.has(book) ? '' : ' checked'}><span class="book-swatch" style="background:${colors[index % colors.length]}"></span>${esc(bookName(book))}</label>`).join('');
    $('book-picker').hidden = !books.length;
    const cohort = row.reference_books || [];
    let message = '';
    if (rowStatus(row) === 'started') message = 'Game started. Showing captured pre-game history; this selection is no longer ranked as a current mover.';
    else if (rowStatus(row) === 'stale') message = 'These captures are out of date. Showing recorded history; this selection is no longer ranked as a current mover.';
    else if (!points.some(point => finite(point.probability))) message = 'Fair value unavailable: paired prices are missing, or consensus has fewer than two matched sportsbooks. Available book prices are shown below.';
    else if (Number(row.point_count) < 2) message = 'First capture recorded. Movement appears after a second capture.';
    notice('chart-status', message);
    if (!points.length) { $('movement-chart').hidden = true; notice('chart-status', 'No recorded prices for this selection today.'); return; }
    const probabilityScale = $('chart-scale').value === 'probability';
    const x = points.map(point => Date.parse(point.ts));
    const times = points.map(point => `${time(point.ts)} ET`);
    const traces = books.filter(book => !hiddenBooks.has(book)).map(book => ({
      type: 'scatter', mode: 'lines+markers', name: bookName(book), x,
      y: points.map(point => { const p = implied(point.prices?.[book]); return p === null ? null : p * 100; }),
      customdata: points.map((point, index) => [times[index], odds(point.prices?.[book])]),
      line: { color: colors[books.indexOf(book) % colors.length], width: 1.7, shape: 'hv' }, marker: { size: 4 }, connectgaps: false,
      hovertemplate: `%{customdata[0]}<br>${esc(bookName(book))}: %{customdata[1]}${probabilityScale ? '<br>Implied: %{y:.2f}%' : ''}<extra></extra>`,
    }));
    if (points.some(point => finite(point.probability))) traces.push({
      type: 'scatter', mode: 'lines+markers', name: `${referenceName()} fair`, x,
      y: points.map(point => finite(point.probability) ? Number(point.probability) * 100 : null),
      customdata: points.map((point, index) => [times[index], odds(point.fair)]),
      line: { color: '#8dedb4', width: 3.5, shape: 'hv' }, marker: { size: 6 }, connectgaps: false,
      hovertemplate: '%{customdata[0]}<br>Fair: %{customdata[1]}<br>Fair probability: %{y:.2f}%<extra></extra>',
    });
    $('chart-footnote').hidden = false;
    $('chart-footnote').textContent = `Bold green is fair value after removing the margin${cohort.length ? ` (${cohort.map(bookName).join(', ')})` : ''}. Other lines are quoted book prices${probabilityScale ? ', shown as implied probability including margin' : ''}. Gaps mean a usable quote was unavailable. Times are Eastern.`;
    if (!traces.length) { $('movement-chart').hidden = true; notice('chart-status', 'Select a sportsbook to display its captured prices.'); return; }
    if (!window.Plotly) { notice('chart-status', 'The chart could not load. Refresh this page to try again.'); return; }
    const yValues = traces.flatMap(trace => trace.y).filter(finite);
    if (!yValues.length) { $('movement-chart').hidden = true; notice('chart-status', 'No captured prices for this side at the selected books. Try another side or sportsbook.'); return; }
    const low = Math.max(.01, Math.min(...yValues) - 3), high = Math.min(99.99, Math.max(...yValues) + 3);
    const oddsTicks = [10000, 5000, 2500, 1500, 1000, 750, 500, 400, 300, 250, 200, 150, 125, 100, -125, -150, -200, -250, -300, -400, -500, -750, -1000, -1500, -2500, -5000, -10000];
    let ticks = oddsTicks.map(value => ({ p: implied(value) * 100, label: odds(value) })).filter(tick => tick.p >= low && tick.p <= high);
    if (ticks.length < 3) ticks = Array.from({ length: 5 }, (_, index) => { const p = low + (high - low) * index / 4; return { p, label: odds(fairFromProbability(p / 100)) }; });
    const tickIndexes = [...new Set(Array.from({ length: Math.min(6, points.length) }, (_, index) => Math.round(index * (points.length - 1) / Math.max(1, Math.min(6, points.length) - 1))))];
    $('movement-chart').hidden = false;
    const chartKey = `${SPORT}:${row.id}:${row.side}:${$('reference-select').value}:${day}:${probabilityScale}`;
    Plotly.react($('movement-chart'), traces, {
      width: $('movement-chart').clientWidth, height: $('movement-chart').clientHeight,
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#b7c8d2', family: 'Inter, system-ui, sans-serif', size: 11 },
      margin: { l: 67, r: 20, t: 18, b: 66 }, showlegend: false, hovermode: 'closest', dragmode: 'pan', uirevision: chartKey,
      xaxis: { type: 'linear', tickvals: tickIndexes.map(index => x[index]), ticktext: tickIndexes.map(index => time(points[index].ts)), title: { text: 'Capture time · Eastern', standoff: 16 }, gridcolor: '#303b42', zeroline: false, ...(x.length === 1 ? { range: [x[0] - 900000, x[0] + 900000] } : {}) },
      yaxis: { title: { text: probabilityScale ? 'Probability (%)' : 'American odds', standoff: 12 }, gridcolor: '#303b42', zeroline: false, ...(probabilityScale ? { ticksuffix: '%' } : { tickvals: ticks.map(tick => tick.p), ticktext: ticks.map(tick => tick.label) }), ...(plottedKey !== chartKey ? { range: [low, high] } : {}) },
    }, { responsive: true, displaylogo: false, scrollZoom: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'], toImageButtonOptions: { filename: 'line-movement' } });
    plottedKey = chartKey;
  }
  async function loadDetail(id, force = false) {
    if (!id || !ready) return;
    const existing = detail?.selection;
    if (!force && existing?.id === id) return;
    detailController?.abort();
    const version = ++detailVersion, controller = new AbortController();
    detailController = controller;
    selectedId = id;
    if (existing?.id !== id) clearChart('Loading price history...');
    renderRows();
    try {
      const data = await request(params(id), controller);
      if (version !== detailVersion || !data) return;
      if (resetDay() || data.day !== day || data.sport !== SPORT) { clearChart('Waiting for today’s captures.'); return; }
      detail = data;
      if (!data.selection) { clearChart('No recorded prices for this selection today.'); return; }
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
    if (!ACCESS_TOKEN) { access(401); return; }
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
      if (data.day !== day || data.sport !== SPORT) { clearRows('Waiting for today’s captures.'); clearChart('Waiting for today’s captures.'); notice('request-status', 'Today’s capture file is not available yet.'); return; }
      const previousUpdate = catalog?.updated;
      catalog = data;
      renderOptions(data); renderRows();
      $('updated').textContent = data.updated ? `Latest capture ${time(data.updated)} ET` : 'Waiting for first capture';
      const interval = Number(data.interval_minutes) || 30;
      $('day-note').textContent = `Today only · Resets at midnight Eastern · Pre-game captures about every ${interval} minutes`;
      $('capture-methodology').textContent = `History starts with the first observed pre-game capture today, not a sportsbook’s official opening price. New captures are recorded about every ${interval} minutes. Each handicap is tracked separately. History resets at midnight Eastern. Captures older than ${Number(data.max_age_minutes) || 60} minutes and started games are excluded from current mover rankings; their recorded charts remain available today.`;
      notice('request-status', data.status === 'stale' ? 'The latest capture is out of date. Showing recorded history while waiting for a new capture.' : data.status === 'awaiting_today' ? 'Waiting for today’s first capture. Yesterday’s history has been cleared.' : '');
      const rows = data.rows || [];
      const chosen = rows.find(row => row.id === selectedId) || rows[0];
      if (chosen) await loadDetail(chosen.id, previousUpdate !== data.updated || !detail || detail.selection?.id !== chosen.id);
      else { selectedId = ''; detailVersion++; detailController?.abort(); clearChart('Search another player or prop, or return after the first capture.'); }
    } catch (error) {
      if (version !== summaryVersion) return;
      if (error.status === 401 || error.status === 403) { access(error.status); return; }
      notice('request-status', error.name === 'AbortError' ? 'Movement refresh timed out. Try Refresh.' : error.message);
      if (!catalog) { $('movement-content').hidden = false; clearRows('Movement could not be loaded. Use Refresh to try again.'); clearChart('Price history is unavailable until the slate loads.'); }
    } finally { if (version === summaryVersion) { summaryController = null; $('refresh').disabled = false; } }
  }
  function filterChanged(delay = 0) {
    cancelRequests(); clearTimeout(debounceTimer); offset = 0;
    clearRows(); clearChart('Loading matching selections...');
    syncURL();
    debounceTimer = setTimeout(refresh, delay);
  }
  $('sport-select').addEventListener('change', () => {
    SPORT = $('sport-select').value; selectedId = ''; selectedProps.clear();
    $('side-select').value = '0'; $('reference-select').value = 'consensus';
    renderOptions({ props: [], books: [] });
    document.title = `${SPORT.toUpperCase()} line movement | +EV Sharps`;
    filterChanged();
  });
  $('player-search').addEventListener('input', () => filterChanged(250));
  ['side-select', 'reference-select', 'direction-select'].forEach(id => $(id).addEventListener('change', () => filterChanged()));
  $('prop-options').addEventListener('change', event => {
    if (!event.target.matches('input')) return;
    if (event.target.checked) selectedProps.add(event.target.value); else selectedProps.delete(event.target.value);
    $('prop-summary').textContent = selectedProps.size ? [...selectedProps].map(propName).join(', ') : 'All props';
    filterChanged();
  });
  $('all-props').addEventListener('click', () => { selectedProps.clear(); $('prop-options').querySelectorAll('input').forEach(input => { input.checked = false; }); $('prop-summary').textContent = 'All props'; filterChanged(); });
  document.addEventListener('click', event => { if (!$('prop-picker').contains(event.target)) $('prop-picker').open = false; });
  $('catalog-rows').addEventListener('click', event => {
    const row = event.target.closest('tr[data-id]');
    if (row) { loadDetail(row.dataset.id); $('chart-title').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  $('book-options').addEventListener('change', event => { if (!event.target.matches('input')) return; if (event.target.checked) hiddenBooks.delete(event.target.value); else hiddenBooks.add(event.target.value); renderChart(); });
  $('chart-scale').addEventListener('change', renderChart);
  if (window.ResizeObserver) new ResizeObserver(() => {
    const chart = $('movement-chart');
    if (!chart.hidden && chart.data && window.Plotly && (chart._fullLayout?.width !== chart.clientWidth || chart._fullLayout?.height !== chart.clientHeight)) {
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
  setDayLabel(); scheduleMidnight(); boot();
})();
