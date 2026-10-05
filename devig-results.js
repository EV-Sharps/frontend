/* One reference/method per view; strategy comparisons are never pooled. */
(function (root) {
  'use strict';
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum'];
  const propOrder = ['atgs', 'sog', 'pts', 'ast', 'sv', 'saves', 'pp_pts', '2+goals', '3+goals', 'fgs', 'no_goal'];
  const compareProps = (a, b) => {
    const index = prop => propOrder.includes(prop) ? propOrder.indexOf(prop) : propOrder.length;
    return index(a) - index(b) || a.localeCompare(b);
  };
  function aggregate(cells) {
    const total = Object.fromEntries(metrics.map(key => [key, 0]));
    for (const cell of cells) for (const key of metrics) total[key] += number(cell[key]);
    total.settled = total.wins + total.losses + total.pushes;
    total.roi = total.settled ? 100 * total.profit_units / total.settled : null;
    return total;
  }
  function matches(cell, filters) {
    return (!filters.start || cell.date >= filters.start) && (!filters.end || cell.date <= filters.end)
      && (!filters.book || cell.book === filters.book) && (!filters.prop || cell.prop === filters.prop);
  }
  function group(cells, keys) {
    const groups = new Map();
    for (const cell of cells) {
      const key = JSON.stringify(keys.map(field => cell[field]));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cell);
    }
    return [...groups.values()].map(rows => ({ ...Object.fromEntries(keys.map(key => [key, rows[0][key]])), ...aggregate(rows) }));
  }
  function ranked(rows, minimum, profitableOnly) {
    return rows.filter(row => row.settled >= Math.max(1, number(minimum)) && (!profitableOnly || row.profit_units > 0))
      .sort((a, b) => b.roi - a.roi || b.settled - a.settled || b.profit_units - a.profit_units
        || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  function buildView(report, filters) {
    const scope = report.cells.filter(cell => matches(cell, filters));
    const chosen = scope.filter(cell => cell.reference === filters.reference && cell.method === filters.method);
    const rank = rows => ranked(rows, filters.minimum ?? 10, filters.profitableOnly);
    const byProp = [...new Set(scope.map(cell => cell.prop))].sort(compareProps).map(prop => {
      const rows = chosen.filter(cell => cell.prop === prop);
      const bookSamples = group(rows, ['book']), bandSamples = group(rows, ['odds_band']);
      return { prop, total: aggregate(rows), books: rank(bookSamples), bands: rank(bandSamples), bookSamples, bandSamples };
    });
    return {
      byProp,
      total: aggregate(chosen),
      strategies: rank(group(scope, ['reference', 'method'])),
      books: rank(group(chosen, ['book'])),
      bands: rank(group(chosen, ['odds_band'])),
      markets: rank(group(chosen, ['prop'])),
      days: group(chosen, ['date']).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
  function defaultStrategy(report) {
    const pairs = new Set(report.cells.map(cell => JSON.stringify([cell.reference, cell.method])));
    if (pairs.has(JSON.stringify(['pn;1', 'worst']))) return { reference: 'pn;1', method: 'worst', fallback: false };
    for (const reference of report.references) for (const method of report.methods) {
      if (pairs.has(JSON.stringify([reference.id, method.id]))) return { reference: reference.id, method: method.id, fallback: true };
    }
    return { reference: report.references[0]?.id || '', method: report.methods[0]?.id || '', fallback: true };
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  function dateRange(start, end) {
    if (!validDate(start) || !validDate(end) || end < start) return [];
    const days = [];
    for (let day = Date.parse(start + 'T12:00:00Z'); day <= Date.parse(end + 'T12:00:00Z') && days.length < 3660; day += 86400000) days.push(new Date(day).toISOString().slice(0, 10));
    return days;
  }
  function availableDates(data) {
    // Source filenames identify snapshots; event dates determine actual coverage.
    const missing = new Set(data.coverage?.missing_dates || []);
    const reported = data.coverage?.event_dates;
    const dates = Array.isArray(reported) ? reported : dateRange(data.window.start, data.window.end);
    return new Set(dates.filter(date => date >= data.window.start && date <= data.window.end && !missing.has(date)));
  }
  function validateReport(data) {
    if (data?.version !== 1 || data.sport !== 'nhl' || !validDate(data.window?.start) || !validDate(data.window?.end)
      || data.window.start > data.window.end || !Array.isArray(data.cells)
      || !Array.isArray(data.references) || !Array.isArray(data.methods)) throw new Error('The published report format is not supported. Refresh after the next report is published.');
    for (const cell of data.cells) {
      if (!validDate(cell.date) || cell.date < data.window.start || cell.date > data.window.end
        || ['book', 'prop', 'reference', 'method', 'odds_band'].some(key => typeof cell[key] !== 'string')
        || metrics.some(key => typeof cell[key] !== 'number' || !Number.isFinite(cell[key]))
        || ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded'].some(key => cell[key] < 0)) throw new Error('The published report contains invalid result rows. Please refresh after it is rebuilt.');
    }
    return data;
  }
  function csvField(value) {
    let text = String(value ?? '');
    // Keep spreadsheet programs from executing arbitrary string dimensions.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  function exportCSV(view, filters) {
    const headings = ['section', 'segment', 'reference', 'method', 'start', 'end', 'book_filter', 'market_filter', 'selected', 'settled', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'net_units', 'roi_percent', 'prop'];
    const line = (section, segment, row) => [section, segment, row.reference ?? filters.reference, row.method ?? filters.method,
      filters.start, filters.end, filters.book || 'all', filters.prop || 'all', row.selected, row.settled, row.wins, row.losses,
      row.pushes, row.pending, row.ungraded, row.profit_units, row.roi, row.prop || ''];
    const rows = [headings, line('summary', 'selected strategy', view.total)];
    for (const [section, key, data] of [['strategies', 'reference', view.strategies],
      ['markets', 'prop', view.markets], ['days', 'date', view.days]]) {
      for (const row of data) rows.push(line(section, row[key], row));
    }
    for (const { prop, books, bands } of view.byProp) {
      for (const row of books) rows.push(line('books', row.book, { ...row, prop }));
      for (const row of bands) rows.push(line('odds_ranges', row.odds_band, { ...row, prop }));
    }
    return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
  }
  const api = { aggregate, buildView, defaultStrategy, dateRange, availableDates, validateReport, exportCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DevigResults = api;
  if (typeof document === 'undefined') return;

  PAGE = 'devig-results';
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && new URLSearchParams(location.search).get('preview') === '1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const count = value => number(value).toLocaleString('en-US');
  const signed = (value, suffix = '') => value === null ? '—' : `${value > 0 ? '+' : ''}${number(value).toFixed(2)}${suffix}`;
  const percent = value => value === null ? '—' : signed(value, '%');
  const tone = value => value > 0 ? 'dv-positive' : value < 0 ? 'dv-negative' : '';
  const bookNames = { pn: 'Pinnacle', circa: 'Circa', dk: 'DraftKings', fd: 'FanDuel', nv: 'Novig', px: 'ProphetX', kal: 'Kalshi',
    poly: 'Polymarket', hr: 'Hard Rock', br: 'BetRivers', kambi: 'Kambi', b365: 'bet365', espn: 'theScore Bet', cz: 'Caesars',
    mgm: 'BetMGM', fn: 'Fanatics', bv: 'Bovada', bol: 'BetOnline', re: 'ReBet', fl: 'Fliff', mb: 'Matchbook' };
  const bookName = book => bookNames[book] || String(book).toUpperCase();
  const propNames = { atgs: 'ATGS (Anytime goalscorer)', no_goal: 'No goal (under 0.5)', fgs: 'First goal', '2+goals': '2+ goals', '3+goals': '3+ goals', sog: 'Shots on goal', saves: 'Goalie saves', sv: 'Goalie saves', pts: 'Points',
    ast: 'Assists', goals: 'Goals', assists: 'Assists', points: 'Points', ml: 'Moneyline', spread: 'Puck line', total: 'Game total', tt: 'Team total',
    blocks: 'Blocked shots', bs: 'Blocked shots', hits: 'Hits', 'sog+bs': 'Shots + blocks', home_total: 'Home team total', away_total: 'Away team total', pp_pts: 'Power-play points' };
  const propName = prop => {
    if (/^\d+\+goals$/.test(prop)) return prop.replace('+goals', '+ goals');
    if (prop.startsWith('goals_under_')) return `Under ${prop.slice('goals_under_'.length)} goals`;
    const period = /^([123])p_(.+)$/.exec(prop);
    return period ? `P${period[1]} · ${propNames[period[2]] || period[2].replaceAll('_', ' ')}` : propNames[prop] || String(prop).replaceAll('_', ' ');
  };
  const dayLabel = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const timestamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'Time unavailable';
  let report = null, view = null, authVersion = 0, controller = null, pending = null;
  const referenceName = id => { const reference = report?.references.find(item => item.id === id); return reference?.books?.length === 1 ? bookName(reference.books[0]) : reference?.name || id; };
  const methodName = id => report?.methods.find(item => item.id === id)?.name || id;
  function notice(id, text) { $(id).textContent = text; $(id).hidden = !text; }
  function filters() {
    return { start: $('date-start').value, end: $('date-end').value, book: $('book-filter').value, prop: $('market-filter').value,
      reference: $('reference-filter').value, method: $('method-filter').value, minimum: Math.max(1, Math.floor(number($('min-settled').value))), profitableOnly: $('profitable-only').checked };
  }
  function options(id, entries, placeholder, preferred) {
    const select = $(id), previous = preferred ?? select.value;
    select.replaceChildren();
    if (placeholder) select.add(new Option(placeholder, ''));
    for (const [value, label] of entries) select.add(new Option(label, value));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }
  function resetFilters() {
    if (!report) return;
    const strategy = defaultStrategy(report);
    $('date-start').value = report.window.start;
    $('date-end').value = report.window.end;
    $('book-filter').value = '';
    $('market-filter').value = '';
    $('reference-filter').value = strategy.reference;
    $('method-filter').value = strategy.method;
    $('min-settled').value = '10';
    $('profitable-only').checked = false;
    $('strategy-note').textContent = strategy.fallback ? 'Pinnacle / Worst-case unavailable; using the first available strategy.' : 'Default: Pinnacle / Worst-case';
    render();
  }
  function filterError(f) {
    if (!validDate(f.start) || !validDate(f.end) || f.start > f.end) return 'Choose a valid date range with From on or before Through.';
    if (f.start < report.window.start || f.end > report.window.end) return `The published report covers ${report.window.start} through ${report.window.end}. Choose dates inside that window.`;
    if (!$('min-settled').checkValidity()) return 'Minimum settled must be a whole number from 1 to 1,000,000.';
    return '';
  }
  function tableEmpty(id, columns) {
    $(id).innerHTML = `<tr><td colspan="${columns}" class="dv-table-empty">No groups meet these filters. Lower the minimum sample or turn off “Profitable only” to explore more results.</td></tr>`;
  }
  function renderRanks(id, rows, dimension, label) {
    if (!rows.length) return tableEmpty(id, 5);
    $(id).innerHTML = rows.map(row => `<tr><td>${esc(label(row[dimension]))}</td><td>${count(row.settled)}</td><td class="${tone(row.profit_units)}">${signed(row.profit_units)}u</td><td class="${tone(row.roi)}">${percent(row.roi)}</td><td>${count(row.pending)} / ${count(row.ungraded)}</td></tr>`).join('');
  }
  function renderPropRanks(id, dimension, label, f) {
    if (!view.byProp.length) return tableEmpty(id, 5);
    const isBook = dimension === 'book', kind = isBook ? 'books' : 'odds ranges';
    $(id).innerHTML = view.byProp.map(group => {
      const rows = isBook ? group.books : group.bands;
      const samples = isBook ? group.bookSamples : group.bandSamples;
      const smaller = ranked(samples, 1, f.profitableOnly).filter(row => row.settled < f.minimum);
      const total = group.total;
      const heading = `<tr class="dv-prop-group" data-prop="${esc(group.prop)}"><th colspan="5" scope="rowgroup"><button type="button" data-prop-filter="${esc(group.prop)}" title="Filter all results to ${esc(propName(group.prop))}">${esc(propName(group.prop))}</button><small>${count(total.settled)} settled offers · ${count(total.pending)} pending / ${count(total.ungraded)} ungraded</small></th></tr>`;
      const rankedRows = rows.map(row => `<tr data-prop="${esc(group.prop)}" data-segment="${esc(row[dimension])}"><td>${esc(label(row[dimension]))}</td><td>${count(row.settled)}</td><td class="${tone(row.profit_units)}">${signed(row.profit_units)}u</td><td class="${tone(row.roi)}">${percent(row.roi)}</td><td>${count(row.pending)} / ${count(row.ungraded)}</td></tr>`).join('');
      const empty = rows.length ? '' : `<tr><td colspan="5" class="dv-table-empty">${!total.selected ? 'No qualifying offers for this reference and method.' : !total.settled ? 'No settled offers yet.' : `No ${f.profitableOnly ? 'profitable ' : ''}${kind} reach ${count(f.minimum)} settled offers for this prop.`}</td></tr>`;
      const more = smaller.length ? `<tr class="dv-small-samples"><td colspan="5">${count(smaller.length)} ${kind} have fewer than ${count(f.minimum)} settled offers. <button type="button" data-small-samples="${esc(group.prop)}">View smaller samples</button></td></tr>` : '';
      return heading + rankedRows + empty + more;
    }).join('');
  }
  function coverageDates() { return availableDates(report); }
  function renderDaily(f) {
    const days = dateRange(f.start, f.end), available = coverageDates(), results = new Map(view.days.map(day => [day.date, day]));
    const maximum = Math.max(1, ...view.days.map(day => Math.abs(day.profit_units)));
    $('daily-chart').innerHTML = days.map(date => {
      const day = results.get(date), profit = day?.profit_units || 0, missing = !available.has(date);
      const label = missing ? 'No event data' : !day?.settled ? 'No settled offers' : signed(profit) + 'u';
      const description = `${dayLabel(date)}: ${label}${day?.settled ? `; ${count(day.settled)} settled offers` : ''}`;
      return `<div class="dv-day ${missing ? 'is-missing' : ''}" role="listitem" aria-label="${esc(description)}"><span>${esc(dayLabel(date))}</span><div class="dv-bar-track" aria-hidden="true"><span class="dv-bar ${profit < 0 ? 'is-negative' : ''}" style="width:${Math.abs(profit) / maximum * 49}%"></span></div><span class="${tone(profit)}">${esc(label)}</span></div>`;
    }).join('');
  }
  function renderCoverage(f) {
    const days = dateRange(f.start, f.end), available = coverageDates(), missing = days.filter(date => !available.has(date));
    const covered = days.length - missing.length, coverage = report.coverage || {};
    $('coverage-badge').textContent = `${covered} / ${days.length} days`;
    $('coverage-summary').textContent = covered ? `${covered} of ${days.length} selected event dates have usable archived offers.` : 'No usable archived offers are available for these event dates.';
    $('coverage-days').innerHTML = days.map(date => `<span class="dv-coverage-day ${available.has(date) ? '' : 'is-missing'}" title="${esc(date)}: ${available.has(date) ? 'Event data available' : 'Event data missing'}"><i aria-hidden="true"></i><span>${esc(dayLabel(date))}</span><span class="sr-only">${available.has(date) ? 'Event data available' : 'Event data missing'}</span></span>`).join('');
    $('coverage-caution').textContent = missing.length ? `Missing: ${missing.map(dayLabel).join(', ')}. Missing event data is not a zero-profit day.` : 'Event-date coverage does not guarantee every market or book was captured.';
    $('coverage-latest').textContent = coverage.latest_archive_date ? `Latest archive: ${coverage.latest_archive_date}. Dates use Eastern time.` : 'No latest archive date was reported. Dates use Eastern time.';
  }
  function render() {
    if (!report) return;
    const f = filters(), error = filterError(f);
    notice('filter-status', error);
    $('export').disabled = Boolean(error);
    if (error) {
      clearResults();
      $('empty-state').hidden = false;
      $('empty-message').textContent = error;
      return;
    }
    view = buildView(report, f);
    const total = view.total;
    $('selected-strategy').textContent = `${referenceName(f.reference)} / ${methodName(f.method)}`;
    $('selection-caption').textContent = `${dayLabel(f.start)}–${dayLabel(f.end)} · ${f.book ? bookName(f.book) : 'All books'} · ${f.prop ? propName(f.prop) : 'All markets'}`;
    $('summary-roi').textContent = percent(total.roi);
    $('summary-roi').className = tone(total.roi);
    $('summary-profit').textContent = signed(total.profit_units, 'u');
    $('summary-profit').className = tone(total.profit_units);
    $('summary-settled').textContent = count(total.settled);
    $('summary-record').textContent = `${count(total.wins)} W · ${count(total.losses)} L · ${count(total.pushes)} P`;
    $('summary-unresolved').textContent = `${count(total.pending)} / ${count(total.ungraded)}`;
    $('offer-note').textContent = f.book ? `${count(total.selected)} qualifying offers at ${bookName(f.book)} for this strategy.`
      : `${count(total.selected)} qualifying offers. The same bet at different books is an alternative offer, not a unique-bet portfolio. Books can qualify different selections.`;
    $('empty-state').hidden = total.selected > 0;
    $('empty-message').textContent = 'Try another date, market, betting book or strategy. Check coverage below for missing archives.';
    $('export').disabled = false;
    renderDaily(f);
    renderCoverage(f);
    $('strategy-count').textContent = `${count(view.strategies.length)} strategies`;
    if (!view.strategies.length) tableEmpty('strategy-rows', 6);
    else $('strategy-rows').innerHTML = view.strategies.map((row, index) => {
      const selected = row.reference === f.reference && row.method === f.method;
      return `<tr class="${selected ? 'is-selected' : ''}"><td><button type="button" class="dv-strategy-button" data-index="${index}" aria-pressed="${selected}">${esc(referenceName(row.reference))}<span>${esc(methodName(row.method))}${selected ? ' · Selected' : ''}</span></button></td><td>${count(row.settled)}</td><td>${count(row.wins)}–${count(row.losses)}–${count(row.pushes)}</td><td class="${tone(row.profit_units)}">${signed(row.profit_units)}u</td><td class="${tone(row.roi)}">${percent(row.roi)}</td><td>${count(row.pending)} / ${count(row.ungraded)}</td></tr>`;
    }).join('');
    renderPropRanks('odds-rows', 'odds_band', value => value, f);
    renderPropRanks('book-rows', 'book', bookName, f);
    renderRanks('market-rows', view.markets, 'prop', propName);
  }
  function renderMethodology() {
    const c = report.config || {}, coverage = report.coverage || {};
    $('config-note').textContent = `Archived NHL offers with estimated EV from ${c.min_ev ?? 0}% to ${c.max_ev ?? 25}%. `
      + `Recorded exchange liquidity minimum: $${c.min_liquidity ?? 50}. One-sided reference prices: ${c.one_sided === 'exclude' ? 'excluded' : c.one_sided || 'see report notes'}. `
      + `Fees: ${typeof c.fee_policy === 'string' ? c.fee_policy : 'exchange fee estimates are included where supported; see the report notes below'}.`;
    $('coverage-totals').textContent = `Full published window: ${count(coverage.raw_rows)} raw rows; ${count(coverage.valid_rows)} valid; ${count(coverage.graded_rows)} graded; ${count(coverage.unresolved_rows)} unresolved. Counts describe source rows, not sums across strategies.`;
    $('report-notes').replaceChildren(...(report.notes || []).map(note => { const li = document.createElement('li'); li.textContent = note; return li; }));
    const reasons = [['Archive', coverage.reasons || {}], ['Grading', coverage.grading_reasons || {}]];
    $('coverage-reasons').replaceChildren(...reasons.flatMap(([source, entries]) => Object.entries(entries).sort((a, b) => number(b[1]) - number(a[1])).map(([key, value]) => {
      const li = document.createElement('li'); li.textContent = `${source} · ${key.replaceAll('_', ' ')}: ${count(value)}`; return li;
    })));
    $('coverage-files').innerHTML = (coverage.files || []).map(file => `<tr><td>${esc(file.date)}</td><td>${esc(file.feed)}</td><td>${count(file.rows)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="dv-table-empty">No archived files in the report window.</td></tr>';
  }
  function acceptReport(data) {
    const previous = report ? filters() : null;
    report = validateReport(data);
    $('report-content').hidden = false;
    $('report-content').setAttribute('aria-busy', 'false');
    $('access-panel').hidden = true;
    $('report-window').textContent = `${dayLabel(report.window.start)}–${dayLabel(report.window.end)} · ${report.window.days || dateRange(report.window.start, report.window.end).length} days · ET`;
    $('generated').textContent = `Published ${timestamp(report.generated_at)}`;
    for (const id of ['date-start', 'date-end']) { $(id).min = report.window.start; $(id).max = report.window.end; }
    options('book-filter', [...new Set(report.cells.map(cell => cell.book))].sort().map(book => [book, bookName(book)]), 'All books · separate offers');
    options('market-filter', [...new Set(report.cells.map(cell => cell.prop))].sort(compareProps).map(prop => [prop, propName(prop)]), 'All markets');
    options('reference-filter', report.references.map(item => [item.id, referenceName(item.id)]));
    options('method-filter', report.methods.map(item => [item.id, item.name]));
    renderMethodology();
    if (!previous) resetFilters();
    else {
      $('date-start').value = previous.start >= report.window.start && previous.start <= report.window.end ? previous.start : report.window.start;
      $('date-end').value = previous.end >= report.window.start && previous.end <= report.window.end ? previous.end : report.window.end;
      if ($('date-start').value > $('date-end').value) $('date-start').value = report.window.start;
      render();
    }
  }
  function clearResults() {
    view = null;
    for (const id of ['summary-roi', 'summary-profit', 'summary-settled', 'summary-unresolved']) { $(id).textContent = '—'; $(id).className = ''; }
    for (const id of ['strategy-rows', 'odds-rows', 'book-rows', 'market-rows', 'daily-chart', 'coverage-days']) $(id).replaceChildren();
    for (const id of ['selected-strategy', 'selection-caption', 'strategy-count', 'coverage-badge', 'coverage-summary', 'coverage-caution', 'coverage-latest', 'offer-note', 'summary-record']) $(id).textContent = '';
    $('export').disabled = true;
  }
  function clearReport() {
    report = null;
    clearResults();
    $('report-content').hidden = true;
    $('report-content').setAttribute('aria-busy', 'false');
    for (const id of ['coverage-files', 'coverage-reasons', 'report-notes']) $(id).replaceChildren();
    for (const id of ['coverage-totals', 'config-note', 'strategy-note']) $(id).textContent = '';
    for (const id of ['book-filter', 'market-filter', 'reference-filter', 'method-filter']) $(id).replaceChildren();
    $('date-start').value = '';
    $('date-end').value = '';
    $('report-window').textContent = 'Last 7 complete days · ET';
    notice('filter-status', '');
  }
  function deny(status) {
    clearReport();
    $('access-panel').hidden = false;
    $('access-message').textContent = status === 403 ? 'Your account needs Sharp access to explore archived results.' : 'Sign in with your Sharp account to explore archived results.';
    $('generated').textContent = 'Sharp membership';
    notice('request-status', '');
  }
  function refresh() {
    if (pending) return pending;
    if (!ACCESS_TOKEN && !localPreview) { deny(401); return Promise.resolve(); }
    const version = authVersion;
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 20000);
    $('refresh').disabled = true;
    $('report-content').setAttribute('aria-busy', 'true');
    pending = (async () => {
      try {
        const response = await fetch(`${localPreview ? '' : API_BASE}/api/devig-results?sport=nhl`, { headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}, cache: 'no-store', signal: activeController.signal });
        if (version !== authVersion) return;
        if ([401, 403].includes(response.status)) { deny(response.status); return; }
        if (response.status === 404 || response.status === 503) throw new Error('No NHL devig report has been published yet. Results appear after the archived report is built.');
        if (!response.ok) throw new Error('Unable to load the published results. Please try again.');
        const data = await response.json();
        if (version !== authVersion) return;
        acceptReport(data);
        notice('request-status', '');
      } catch (error) {
        if (version !== authVersion) return;
        const message = error.name === 'AbortError' ? 'The request timed out. Please refresh to try again.' : error.message;
        notice('request-status', report ? `Showing the previously loaded report. ${message}` : message);
        if (!report) $('generated').textContent = 'Report unavailable';
      } finally {
        clearTimeout(timeout);
        if (version === authVersion) { pending = null; controller = null; $('refresh').disabled = false; $('report-content').setAttribute('aria-busy', 'false'); }
      }
    })();
    return pending;
  }
  function setSession(session) {
    const token = session?.access_token || '';
    if (token === ACCESS_TOKEN) return;
    authVersion++;
    controller?.abort();
    controller = null;
    pending = null;
    ACCESS_TOKEN = token;
    clearReport();
    $('account-link').textContent = token ? 'My account' : 'Sign in';
    $('refresh').disabled = false;
    refresh();
  }
  $('refresh').addEventListener('click', refresh);
  $('reset-filters').addEventListener('click', resetFilters);
  for (const id of ['date-start', 'date-end', 'book-filter', 'market-filter', 'reference-filter', 'method-filter', 'min-settled', 'profitable-only']) $(id).addEventListener('change', render);
  for (const id of ['odds-rows', 'book-rows']) $(id).addEventListener('click', event => {
    const prop = event.target.closest('[data-prop-filter]');
    if (prop) { $('market-filter').value = prop.dataset.propFilter; render(); return; }
    if (event.target.closest('[data-small-samples]')) { $('min-settled').value = '1'; render(); }
  });
  $('strategy-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-index]');
    const strategy = button && view?.strategies[Number(button.dataset.index)];
    if (!strategy) return;
    $('reference-filter').value = strategy.reference;
    $('method-filter').value = strategy.method;
    render();
  });
  $('export').addEventListener('click', () => {
    if (!view || !report) return;
    const f = filters(), url = URL.createObjectURL(new Blob([exportCSV(view, f)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `nhl-devig-results-${f.start}-${f.end}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const id of ['account-link', 'access-login']) $(id).href = `profile${HTML}`;
  $('access-pricing').href = `pricing${HTML}`;
  async function boot() {
    if (localPreview) { $('account-link').textContent = 'Local preview'; await refresh(); return; }
    try {
      if (typeof SB === 'undefined' || !SB) throw new Error('Sign-in unavailable');
      const { data, error } = await SB.auth.getSession();
      if (error) throw error;
      ACCESS_TOKEN = data.session?.access_token || '';
      $('account-link').textContent = ACCESS_TOKEN ? 'My account' : 'Sign in';
      SB.auth.onAuthStateChange((_event, session) => queueMicrotask(() => setSession(session)));
      await refresh();
    } catch (_) {
      clearReport();
      notice('request-status', 'Sign-in service unavailable. Reload the page to try again.');
      $('generated').textContent = 'Unable to connect';
    }
  }
  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
