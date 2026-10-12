/* One reference/method per view; strategy comparisons are never pooled. */
(function (root) {
  'use strict';
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum'];
  const reportCells = report => [...report.cells, ...(report.best_cells || [])];
  const propOrder = ['attd', 'atgs', 'sog', 'pts', 'ast', 'sv', 'saves', 'pp_pts', '2+goals', '3+goals', 'fgs', 'no_goal'];
  const supportedSports = ['nhl', 'nfl'];
  const sportFromSearch = search => new URLSearchParams(search).get('sport') === 'nfl' ? 'nfl' : 'nhl';
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
      && (filters.book ? cell.book === filters.book : cell.book !== 'best') && (!filters.prop || cell.prop === filters.prop);
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
    const scope = reportCells(report).filter(cell => matches(cell, filters));
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
  const shareBookOrder = ['fd', 'dk', 'b365', 'mgm', 'cz', 'hr', 'fn', 'br', 'espn'];
  const compareShareBooks = (a, b) => {
    const order = book => shareBookOrder.includes(book) ? shareBookOrder.indexOf(book) : shareBookOrder.length;
    return order(a) - order(b) || a.localeCompare(b);
  };
  const shareBuckets = [
    { id: 'short', label: 'Short EV', description: 'Odds below +400' },
    { id: 'mid', label: 'Mid EV', description: 'Odds +400 through +1000' },
    { id: 'long', label: 'Long EV', description: 'Odds above +1000' },
  ];
  const legacyBuckets = { 'Below -200': 'short', '-200 to -101': 'short', '+100 to +199': 'short',
    '+200 to +399': 'short', '+400 to +699': 'mid', '+700 to +999': 'mid' };
  function shareBucket(cell, report) {
    const legacy = legacyBuckets[cell.odds_band];
    if (report.share_odds_version !== 1) return legacy || null;
    const bucket = cell.share_odds_bucket;
    if (!shareBuckets.some(item => item.id === bucket)) return null;
    if (legacy) return bucket === legacy ? bucket : null;
    return cell.odds_band === '+1000 and above' && ['mid', 'long'].includes(bucket) ? bucket : null;
  }
  function validBestHit(cell) {
    const hit = cell.best_hit;
    if (!hit || cell.wins <= 0 || typeof hit.player !== 'string' || (!hit.player.trim() && (typeof hit.game !== 'string' || !hit.game.trim()))
      || !validDate(hit.date) || hit.date !== cell.date || hit.prop !== cell.prop
      || typeof hit.book !== 'string' || !hit.book || hit.book === 'best'
      || (cell.book !== 'best' && hit.book !== cell.book)
      || typeof hit.odds !== 'number' || !Number.isFinite(hit.odds) || Math.abs(hit.odds) < 100
      || typeof hit.profit_units !== 'number' || !Number.isFinite(hit.profit_units) || hit.profit_units <= 0
      || typeof hit.under !== 'boolean'
      || !['number', 'string'].includes(typeof hit.line) || !Number.isFinite(Number(hit.line)) || String(hit.line).trim() === '') return null;
    return { player: hit.player.trim(), player_id: typeof hit.player_id === 'string' ? hit.player_id : '',
      date: hit.date, game: typeof hit.game === 'string' ? hit.game : '', prop: hit.prop,
      line: hit.line, under: hit.under, odds: hit.odds, profit_units: hit.profit_units, book: hit.book };
  }
  function bestHit(rows, report, bucket = 'all') {
    const wins = rows.filter(cell => cell.wins > 0);
    if (!wins.length) return { best_hit: null, hit_status: 'none' };
    if (report.best_hit_version !== 1) return { best_hit: null, hit_status: 'rebuild' };
    const hits = wins.map(cell => {
      const hit = validBestHit(cell);
      const hitBucket = hit ? hit.odds < 400 ? 'short' : hit.odds <= 1000 ? 'mid' : 'long' : null;
      const cellBucket = shareBucket(cell, report);
      const legacyLong = report.share_odds_version !== 1 && cell.odds_band === '+1000 and above' && hit?.odds >= 1000;
      return hit && (hitBucket === cellBucket || bucket === 'all' && legacyLong) ? hit : null;
    });
    if (hits.some(hit => !hit)) return { best_hit: null, hit_status: 'unavailable' };
    hits.sort((a, b) => b.profit_units - a.profit_units
      || JSON.stringify([a.date, a.player, a.book, a.prop, a.line, a.under, a.odds]).localeCompare(JSON.stringify([b.date, b.player, b.book, b.prop, b.line, b.under, b.odds])));
    return { best_hit: hits[0], hit_status: 'available' };
  }
  function shareReferencePriority(reference) {
    const books = [...new Set(reference.books || reference.id.split(';')[0].split('+'))].sort();
    const key = books.join('+');
    const preferred = ['circa', 'pn', 'circa+pn', 'kal', 'nv', 'px', 'poly', 'mb'];
    const index = preferred.indexOf(key);
    return index >= 0 ? index : books.some(book => book === 'circa' || book === 'pn') ? 8 : 9;
  }
  function buildPerformers(report, filters = {}) {
    const method = filters.method || 'probit', bucket = filters.bucket || 'all';
    const columns = [...report.references].sort((a, b) => shareReferencePriority(a) - shareReferencePriority(b) || a.id.localeCompare(b.id));
    const cells = reportCells(report);
    const books = filters.book ? [filters.book] : [...new Set(cells.filter(cell => cell.book !== 'best'
      && (!filters.prop || cell.prop === filters.prop)).map(cell => cell.book))].sort(compareShareBooks);
    const combinations = new Map(), ambiguous = new Set();
    for (const cell of cells.filter(cell => matches(cell, filters) && cell.method === method)) {
      const cellBucket = shareBucket(cell, report), key = JSON.stringify([cell.book, cell.reference]);
      if (bucket !== 'all' && !cellBucket) {
        // Old +1000-and-above cells cannot reveal which offers were exactly
        // +1000. Never shift them into the wrong column or omit them silently.
        const affected = cell.odds_band === '+1000 and above' ? ['mid', 'long'] : shareBuckets.map(item => item.id);
        if (affected.includes(bucket)) ambiguous.add(key);
        continue;
      }
      if (bucket !== 'all' && cellBucket !== bucket) continue;
      if (!combinations.has(key)) combinations.set(key, []);
      combinations.get(key).push(cell);
    }
    return { method, bucket, columns, rows: books.map(book => ({ book, cells: columns.map(({ id: reference }) => {
      const key = JSON.stringify([book, reference]);
      if (ambiguous.has(key)) return { reference, row: null, reason: 'rebuild' };
      const rows = combinations.get(key) || [], total = aggregate(rows);
      if (!total.settled) return { reference, row: null, reason: 'empty' };
      if (filters.profitableOnly && total.profit_units <= 0) return { reference, row: null, reason: 'unprofitable' };
      return { reference, reason: null, row: { book, reference, method, bucket, ...total, ...bestHit(rows, report, bucket) } };
    }) })) };
  }
  function defaultStrategy(report) {
    const pairs = new Set(reportCells(report).map(cell => JSON.stringify([cell.reference, cell.method])));
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
  function chartDates(data, start, end) {
    const days = dateRange(start, end), available = availableDates(data);
    return days.length > 31 ? days.filter(day => available.has(day)) : days;
  }
  function easternDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(value => value.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function offsetDate(day, offset) { return new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10); }
  function presetRange(preset, data, now = new Date()) {
    const today = easternDate(now), end = offsetDate(today, -1);
    // Match Analysis's July 1 season boundary for NFL and NHL, including Jan-June.
    const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 7 ? 1 : 0);
    const seasonStart = `${year}-07-01`;
    const ranges = { yesterday: { start: end, end }, l7: { start: offsetDate(end, -6), end },
      season: { start: seasonStart, end }, published: { start: data.window.start, end: data.window.end } };
    const range = ranges[preset];
    if (!range) return null;
    return { ...range, available: range.start <= range.end && range.start >= data.window.start && range.end <= data.window.end };
  }
  function configDescription(c = {}, sport = 'nhl') {
    const ev = c.max_ev == null ? `EV ≥ ${c.min_ev ?? 0}%; no upper limit`
      : `EV from ${c.min_ev ?? 0}% to ${c.max_ev}%`;
    const oneSided = c.one_sided === 'site' ? 'missing opposite prices use the site’s 7% assumed vig'
      : c.one_sided === 'exclude' ? 'excluded' : 'see report notes';
    return `Archived ${sport.toUpperCase()} offers with estimated ${ev}. Recorded exchange liquidity minimum: $${c.min_liquidity ?? 50}. `
      + `One-sided reference prices: ${oneSided}. `
      + `Fees: ${typeof c.fee_policy === 'string' ? c.fee_policy : 'exchange fee estimates are included where supported; see the report notes below'}.`;
  }
  function validateReport(data, expectedSport) {
    if (data?.version !== 1 || !supportedSports.includes(data.sport) || !validDate(data.window?.start) || !validDate(data.window?.end)
      || data.window.start > data.window.end || !Array.isArray(data.cells)
      || (data.best_cells !== undefined && !Array.isArray(data.best_cells))
      || !Array.isArray(data.references) || !Array.isArray(data.methods)) throw new Error('The published report format is not supported. Refresh after the next report is published.');
    if (expectedSport && data.sport !== expectedSport) throw new Error(`The server returned a different sport. Refresh to load the ${expectedSport.toUpperCase()} report.`);
    if ((data.best_cells || []).some(cell => cell?.book !== 'best')) throw new Error('The published report contains invalid best-available result rows. Please refresh after it is rebuilt.');
    for (const cell of reportCells(data)) {
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
  const api = { aggregate, buildView, buildPerformers, shareBuckets, defaultStrategy, dateRange, availableDates, chartDates, easternDate, presetRange, sportFromSearch, configDescription, validateReport, exportCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DevigResults = api;
  if (typeof document === 'undefined') return;

  PAGE = 'devig-results';
  let sport = sportFromSearch(location.search);
  SPORT = sport;
  const localPreview = IS_LOCALHOST && new URLSearchParams(location.search).get('preview') === '1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const count = value => number(value).toLocaleString('en-US');
  const signed = (value, suffix = '') => value === null ? '-' : `${value > 0 ? '+' : ''}${number(value).toFixed(2)}${suffix}`;
  const percent = value => value === null ? '-' : signed(value, '%');
  const tone = value => value > 0 ? 'dv-positive' : value < 0 ? 'dv-negative' : '';
  const bookNames = { best: 'Best available', pn: 'Pinnacle', circa: 'Circa', dk: 'DraftKings', fd: 'FanDuel', nv: 'Novig', px: 'ProphetX', kal: 'Kalshi',
    poly: 'Polymarket', hr: 'Hard Rock', br: 'BetRivers', kambi: 'Kambi', b365: 'bet365', espn: 'theScore Bet', cz: 'Caesars',
    mgm: 'BetMGM', fn: 'Fanatics', bv: 'Bovada', bol: 'BetOnline', re: 'ReBet', fl: 'Fliff', mb: 'Matchbook' };
  const bookName = book => bookNames[book] || String(book).toUpperCase();
  const shareBookNames = { best: 'Best available', fd: 'FD', dk: 'DK', b365: 'bet365', mgm: 'MGM', cz: 'Caesars', hr: 'HR',
    fn: 'Fanatics', br: 'BetRivers', espn: 'theScore', pn: 'Pinnacle', circa: 'Circa', nv: 'Novig', px: 'ProphetX',
    kal: 'Kalshi', poly: 'Polymarket', bv: 'Bovada', bol: 'BetOnline', re: 'ReBet', fl: 'Fliff', mb: 'Matchbook' };
  const shareBookName = book => shareBookNames[book] || bookName(book);
  const sharePlayerName = name => name === name.toLowerCase() ? name.split(' ').map(word => {
    if (['aj', 'cj', 'dj', 'dk', 'jj', 'pj', 'tj', 'ii', 'iii', 'iv', 'vi'].includes(word)) return word.toUpperCase();
    return word.replace(/(^|[-'])[a-z]/g, letter => letter.toUpperCase()).replace(/^Mc([a-z])/, (_, letter) => 'Mc' + letter.toUpperCase());
  }).join(' ') : name;
  const propNames = { attd: 'ATTD (Anytime touchdown)', no_td: 'No touchdown (under 0.5)', ftd: 'First touchdown', '2+td': '2+ touchdowns', '3+td': '3+ touchdowns', pass_yds: 'Passing yards', rush_yds: 'Rushing yards', rec_yds: 'Receiving yards', rec: 'Receptions', pass_td: 'Passing touchdowns', atgs: 'ATGS (Anytime goalscorer)', no_goal: 'No goal (under 0.5)', fgs: 'First goal', '2+goals': '2+ goals', '3+goals': '3+ goals', sog: 'Shots on goal', saves: 'Goalie saves', sv: 'Goalie saves', pts: 'Points',
    ast: 'Assists', goals: 'Goals', assists: 'Assists', points: 'Points', ml: 'Moneyline', spread: 'Puck line', total: 'Game total', tt: 'Team total',
    blocks: 'Blocked shots', bs: 'Blocked shots', hits: 'Hits', 'sog+bs': 'Shots + blocks', home_total: 'Home team total', away_total: 'Away team total', pp_pts: 'Power-play points' };
  const propName = prop => {
    if (prop === 'spread' && sport === 'nfl') return 'Point spread';
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
  let performersModel = null, performersRevision = 0, performersPage = 0, performersDevigPage = 0, performersFilterKey = '';
  let performersBackdropPressed = false;
  const performerReferenceName = reference => {
    const books = reference.books || [];
    if (books.length === 1) return bookName(books[0]);
    if (books.length === 2 && books.includes('circa') && books.includes('pn') && reference.id.split(';')[1] === '1+1') return 'Circa + Pinnacle';
    return reference.name || reference.id;
  };
  function closePerformers() {
    performersBackdropPressed = false;
    performersRevision++;
    performersModel = null;
    performersPage = 0; performersDevigPage = 0; performersFilterKey = '';
    if ($('performers-dialog').open) $('performers-dialog').close();
    $('performers-rows').replaceChildren();
    $('performers-head').replaceChildren();
    for (const id of ['performers-subtitle', 'performers-period', 'performers-generated', 'performers-scope', 'performers-criteria', 'performers-status', 'performers-footnotes', 'performers-page', 'performers-description']) $(id).textContent = '';
    $('performers-copy').disabled = $('performers-download').disabled = true;
    $('performers-prev').disabled = $('performers-next').disabled = true;
    $('performers-devigs-prev').disabled = $('performers-devigs-next').disabled = true;
    $('performers-devigs-page').textContent = '';
  }
  function renderPerformers() {
    if (!report || filterError(filters())) { closePerformers(); return; }
    performersRevision++;
    const f = { ...filters(), method: $('performers-method').value || 'probit', bucket: $('performers-range').value || 'all' };
    const filterKey = JSON.stringify([f.start, f.end, f.book, f.prop, f.profitableOnly, f.method, f.bucket]);
    if (filterKey !== performersFilterKey) { performersPage = 0; performersDevigPage = 0; }
    performersFilterKey = filterKey;
    const matrix = buildPerformers(report, f), groups = matrix.rows, requested = $('performers-limit').value;
    const requestedColumns = Number($('performers-columns').value);
    const devigsPerPage = [4, 8, 12].includes(requestedColumns) ? requestedColumns : 8;
    const devigPageCount = Math.max(1, Math.ceil(matrix.columns.length / devigsPerPage));
    performersDevigPage = Math.max(0, Math.min(performersDevigPage, devigPageCount - 1));
    const columns = matrix.columns.slice(performersDevigPage * devigsPerPage, (performersDevigPage + 1) * devigsPerPage);
    const pageSize = [1, 3, 6].includes(Number(requested)) ? Number(requested) : Math.max(1, groups.length);
    const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
    performersPage = Math.max(0, Math.min(performersPage, pageCount - 1));
    const pageGroups = groups.slice(performersPage * pageSize, (performersPage + 1) * pageSize);
    const prettyDate = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    const windowName = $('date-preset').selectedOptions[0]?.textContent || 'Custom dates';
    const range = shareBuckets.find(item => item.id === f.bucket);
    const rangeLabel = range ? `${range.label} · ${range.description}` : 'All odds';
    const devigPageLabel = `Devigs ${matrix.columns.length ? performersDevigPage * devigsPerPage + 1 : 0}–${Math.min((performersDevigPage + 1) * devigsPerPage, matrix.columns.length)} of ${matrix.columns.length}`;
    const hitLabels = row => {
      const hit = row.best_hit;
      if (!hit) return { hitLabel: { rebuild: 'Rebuild report for best hits', none: 'No settled wins', unavailable: 'Best hit unavailable' }[row.hit_status] || 'Best hit unavailable', hitDetail: '' };
      const odds = `${hit.odds > 0 ? '+' : ''}${hit.odds}`;
      const market = hit.prop.replace(/^[123]p_/, '');
      const lineLabel = market === 'ml' ? '' : market === 'spread'
        ? ` ${Number(hit.line) > 0 ? '+' : ''}${hit.line}` : ` ${hit.under ? 'u' : 'o'}${hit.line}`;
      return { hitLabel: `${hit.player ? sharePlayerName(hit.player) : hit.game} ${odds}`, hitDetail: `${propName(hit.prop).replace(/ \(.*\)$/, '')}${lineLabel} · ${dayLabel(hit.date)}${row.book === 'best' ? ` · ${shareBookName(hit.book)}` : ''}` };
    };
    performersModel = {
      sport, method: f.method, bucket: f.bucket, title: 'Devig performance', subtitle: `${sport.toUpperCase()} · ${f.prop ? propName(f.prop) : 'All markets'} · ${windowName}`,
      period: (f.start === f.end ? prettyDate(f.start) : `${prettyDate(f.start)} – ${prettyDate(f.end)}`) + ' · ET',
      scope: `${f.book ? bookName(f.book) : 'All betting books'} · ${devigPageLabel}`,
      description: `${methodName(f.method)} · ${rangeLabel}`,
      criteria: `${groups.length ? `Books ${performersPage * pageSize + 1}–${Math.min((performersPage + 1) * pageSize, groups.length)} of ${groups.length}` : 'No books in this market'}${f.profitableOnly ? ' · Profitable only' : ''}`,
      generated: `Updated ${timestamp(report.generated_at)}`,
      pageNumber: performersPage + 1, pageCount, devigPageNumber: performersDevigPage + 1,
      pageLabel: `Book page ${performersPage + 1} of ${pageCount} · Devig page ${performersDevigPage + 1} of ${devigPageCount}`,
      columns: columns.map(column => ({ id: column.id, label: performerReferenceName(column) })),
      footnotes: [
        'Historical replay · 1u risk per settled offer · Modeled fees included.',
        'Each cell uses the selected method and odds range for that betting book and devig.',
        'Pending / ungraded offers are excluded from ROI. W–L–P includes pushes.',
        'Strategies can overlap and are not a combined betting record. Past results do not establish a future edge.',
      ],
      rows: pageGroups.map(group => ({ book: group.book, bookLabel: shareBookName(group.book), bookName: bookName(group.book),
        cells: columns.map(column => {
          const cell = group.cells.find(item => item.reference === column.id), row = cell.row;
          return { reference: column.id,
          emptyLabel: cell.reason === 'rebuild' ? 'Rebuild report' : '-',
          emptyDetail: cell.reason === 'rebuild' ? 'Rebuild report to separate +1000 from higher odds.'
            : cell.reason === 'unprofitable' ? 'Not profitable in this selection.' : 'No settled offers in this selection.',
          entry: row ? { ...row, referenceLabel: performerReferenceName(column), methodLabel: methodName(row.method),
            recordLabel: `${count(row.wins)}–${count(row.losses)}–${count(row.pushes)}`,
            profit: row.profit_units, profitLabel: signed(row.profit_units, 'u'), roiLabel: percent(row.roi),
            unresolvedLabel: `${count(row.pending + row.ungraded)} unresolved`, ...hitLabels(row) } : null,
        }; }),
      })),
    };
    for (const [id, key] of [['subtitle', 'subtitle'], ['period', 'period'], ['generated', 'generated'], ['scope', 'scope'], ['criteria', 'criteria'], ['description', 'description']]) $('performers-' + id).textContent = performersModel[key];
    $('performers-page').textContent = `Books: page ${performersPage + 1} of ${pageCount}`;
    $('performers-books-pagination').hidden = pageCount <= 1;
    $('performers-devigs-page').textContent = devigPageLabel;
    $('performers-devigs-prev').disabled = performersDevigPage === 0;
    $('performers-devigs-next').disabled = performersDevigPage >= devigPageCount - 1;
    $('performers-prev').disabled = performersPage === 0;
    $('performers-next').disabled = performersPage >= pageCount - 1;
    $('performers-card').style.setProperty('--dv-share-min-width', `${Math.max(760, 142 + columns.length * 132)}px`);
    $('performers-head').innerHTML = '<th scope="col">Betting book</th>' + performersModel.columns.map(column => `<th scope="col" data-reference="${esc(column.id)}">${esc(column.label)}</th>`).join('');
    $('performers-rows').innerHTML = performersModel.rows.map(group => `<tr data-book="${esc(group.book)}"><th scope="row"><strong>${esc(group.bookLabel)}</strong>${group.bookName !== group.bookLabel ? `<small>${esc(group.bookName)}</small>` : ''}</th>${group.cells.map(cell => {
      const row = cell.entry;
      return `<td data-reference="${esc(cell.reference)}">${row ? `<div class="dv-share-leader" data-reference="${esc(row.reference)}" data-method="${esc(row.method)}"><div class="dv-share-financials"><b class="${tone(row.profit)}">${esc(row.profitLabel)}</b><span class="${tone(row.roi)}">${esc(row.roiLabel)} ROI</span></div><small>${esc(row.recordLabel)} · ${count(row.settled)} settled</small><div class="dv-share-hit" title="${esc(row.hitDetail)}">Best hit: ${esc(row.hitLabel)}</div></div>`
        : `<p class="dv-share-missing" title="${esc(cell.emptyDetail)}">${esc(cell.emptyLabel)}</p>`}</td>`;
    }).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length + 1}" class="dv-share-empty">No betting books have archived offers for this market.</td></tr>`;
    $('performers-footnotes').replaceChildren(...performersModel.footnotes.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    $('performers-status').textContent = '';
    $('performers-copy').disabled = $('performers-download').disabled = !performersModel.rows.some(row => row.cells.some(cell => cell.entry));
  }
  function downloadPerformers(blob, filename) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportPerformers(copy) {
    if (!performersModel?.rows.some(row => row.cells.some(cell => cell.entry)) || !report || !$('performers-dialog').open) return;
    const revision = performersRevision, model = performersModel, f = filters();
    const current = () => revision === performersRevision && report && $('performers-dialog').open;
    $('performers-copy').disabled = $('performers-download').disabled = true;
    $('performers-status').textContent = 'Preparing image…';
    try {
      const canvas = root.DevigResultsShare.drawCard(model);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image unavailable')), 'image/png'));
      if (!current()) return;
      const filename = `${model.sport}-devigs-${model.method}-${model.bucket}-${f.start}-${f.end}-books-${model.pageNumber}-devigs-${model.devigPageNumber}.png`;
      if (copy) {
        try {
          if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard unavailable');
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          if (current()) $('performers-status').textContent = 'Image copied. Paste it into your post.';
        } catch (_) {
          if (!current()) return;
          downloadPerformers(blob, filename);
          $('performers-status').textContent = 'Clipboard unavailable; PNG downloaded.';
        }
      } else {
        downloadPerformers(blob, filename);
        $('performers-status').textContent = 'PNG downloaded.';
      }
    } catch (_) {
      if (current()) $('performers-status').textContent = 'Could not create the image. Try again or screenshot the table.';
    } finally {
      if (current()) $('performers-copy').disabled = $('performers-download').disabled = false;
    }
  }
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
    $('date-preset').value = 'published';
    const initialPreset = sport === 'nfl' ? 'season' : 'l7';
    const initialRange = presetRange(initialPreset, report);
    if (initialRange.available) {
      $('date-preset').value = initialPreset;
      $('date-start').value = initialRange.start;
      $('date-end').value = initialRange.end;
    }
    $('book-filter').value = '';
    $('market-filter').value = sport === 'nfl' ? 'attd' : '';
    $('reference-filter').value = strategy.reference;
    $('method-filter').value = strategy.method;
    $('min-settled').value = '10';
    $('profitable-only').checked = false;
    $('strategy-note').textContent = strategy.fallback ? 'Pinnacle / Worst-case unavailable; using the first available strategy.' : 'Default: Pinnacle / Worst-case';
    render();
  }
  function applyDatePreset() {
    if (!report) return;
    const range = presetRange($('date-preset').value, report);
    if (range) { $('date-start').value = range.start; $('date-end').value = range.end; }
    render();
  }
  function filterError(f) {
    if (!validDate(f.start) || !validDate(f.end) || f.start > f.end) return 'Choose a valid date range with From on or before Through.';
    if (f.start < report.window.start || f.end > report.window.end) return `The requested dates (${f.start} through ${f.end}) are not fully available. The published ${sport.toUpperCase()} report covers ${report.window.start} through ${report.window.end}. Choose Published window or dates inside that window.`;
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
    const days = chartDates(report, f.start, f.end), available = coverageDates(), results = new Map(view.days.map(day => [day.date, day]));
    const condensed = dateRange(f.start, f.end).length > 31;
    $('daily-caption').hidden = !condensed;
    $('daily-caption').textContent = condensed ? 'Long windows show every date with archived event data, including dates with no qualifying offers. See coverage for dates without event data.' : '';
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
    $('coverage-summary').textContent = covered ? `${covered} of ${days.length} calendar dates have archived event offers.` : 'No archived event offers are available for these calendar dates.';
    $('coverage-days').innerHTML = days.map(date => `<span class="dv-coverage-day ${available.has(date) ? '' : 'is-missing'}" title="${esc(date)}: ${available.has(date) ? 'Event data available' : 'Event data missing'}"><i aria-hidden="true"></i><span>${esc(dayLabel(date))}</span><span class="sr-only">${available.has(date) ? 'Event data available' : 'Event data missing'}</span></span>`).join('');
    $('coverage-caution').textContent = missing.length ? `Dates without archived offers (including off days): ${missing.map(dayLabel).join(', ')}. An absence of archived offers is not a zero-profit result.` : 'Event-date coverage does not guarantee every market or book was captured.';
    $('coverage-latest').textContent = coverage.latest_archive_date ? `Latest archive: ${coverage.latest_archive_date}. Dates use Eastern time.` : 'No latest archive date was reported. Dates use Eastern time.';
  }
  function render() {
    if (!report) return;
    const f = filters(), error = filterError(f);
    notice('filter-status', error);
    $('export').disabled = Boolean(error);
    $('best-performers').disabled = Boolean(error);
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
    $('offer-note').textContent = f.book === 'best' ? `${count(total.selected)} qualifying saved lines/sides, each counted once at the best payout after fees. Match reference, method, dates and book when comparing with Analysis.`
      : f.book ? `${count(total.selected)} qualifying offers at ${bookName(f.book)} for this strategy. Match reference, method, dates and book when comparing with Analysis.`
      : `${count(total.selected)} qualifying offers. The same bet at different books is an alternative offer, not a unique-bet portfolio. Books can qualify different selections.`;
    $('book-ranking-title').textContent = f.book === 'best' ? 'Best available by prop' : 'Best betting books by prop';
    $('book-ranking-caption').textContent = f.book === 'best' ? 'One highest net payout per saved line/side, after fees.'
      : 'Each prop is ranked separately. Qualifying selections differ by book.';
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
    if ($('performers-dialog').open) renderPerformers();
  }
  function renderMethodology() {
    const c = report.config || {}, coverage = report.coverage || {};
    $('config-note').textContent = configDescription(c, sport);
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
    report = validateReport(data, sport);
    $('report-content').hidden = false;
    $('report-content').setAttribute('aria-busy', 'false');
    $('access-panel').hidden = true;
    $('report-window').textContent = `${dayLabel(report.window.start)}–${dayLabel(report.window.end)} · ${report.window.days || dateRange(report.window.start, report.window.end).length} days · ET`;
    $('generated').textContent = `Published ${timestamp(report.generated_at)}`;
    for (const id of ['date-start', 'date-end']) { $(id).min = report.window.start; $(id).max = report.window.end; }
    const cells = reportCells(report);
    const books = [...new Set(cells.map(cell => cell.book))].sort((a, b) => a === 'best' ? -1 : b === 'best' ? 1 : a.localeCompare(b));
    options('book-filter', books.map(book => [book, bookName(book)]), 'All books · separate offers');
    const props = [...new Set([...(sport === 'nfl' ? ['attd'] : []), ...cells.map(cell => cell.prop)])].sort(compareProps);
    options('market-filter', props.map(prop => [prop, propName(prop)]), 'All markets');
    options('reference-filter', report.references.map(item => [item.id, referenceName(item.id)]));
    options('method-filter', report.methods.map(item => [item.id, item.name]));
    const shareMethod = previous ? $('performers-method').value || 'probit' : 'probit';
    const shareMethods = report.methods.map(item => [item.id, item.name]);
    for (const id of new Set(['probit', shareMethod])) {
      if (!shareMethods.some(item => item[0] === id)) shareMethods.push([id, `${id === 'probit' ? 'Probit' : id} (not in report)`]);
    }
    options('performers-method', shareMethods, null, shareMethod);
    if (!previous) $('performers-range').value = 'all';
    renderMethodology();
    if (!previous) resetFilters();
    else {
      // Retain custom dates exactly; a narrower replacement report must not silently clip them.
      $('date-start').value = previous.start;
      $('date-end').value = previous.end;
      applyDatePreset();
    }
  }
  function clearResults() {
    view = null;
    closePerformers();
    $('best-performers').disabled = true;
    for (const id of ['summary-roi', 'summary-profit', 'summary-settled', 'summary-unresolved']) { $(id).textContent = '-'; $(id).className = ''; }
    for (const id of ['strategy-rows', 'odds-rows', 'book-rows', 'market-rows', 'daily-chart', 'coverage-days']) $(id).replaceChildren();
    for (const id of ['selected-strategy', 'selection-caption', 'strategy-count', 'coverage-badge', 'coverage-summary', 'coverage-caution', 'coverage-latest', 'offer-note', 'summary-record']) $(id).textContent = '';
    $('daily-caption').textContent = '';
    $('daily-caption').hidden = true;
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
    $('report-window').textContent = sport === 'nfl' ? 'Current season · ET' : 'Last 7 complete days · ET';
    $('date-preset').value = 'published';
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
    if (!ACCESS_TOKEN && !IS_LOCALHOST) { deny(401); return Promise.resolve(); }
    const version = authVersion;
    const requestedSport = sport;
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 20000);
    $('refresh').disabled = true;
    $('report-content').setAttribute('aria-busy', 'true');
    pending = (async () => {
      try {
        const response = await fetch(`${localPreview ? '' : API_BASE}/api/devig-results?sport=${requestedSport}`, { headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}, cache: 'no-store', signal: activeController.signal });
        if (version !== authVersion) return;
        if ([401, 403].includes(response.status)) { deny(response.status); return; }
        if (response.status === 404 || response.status === 503) throw new Error(`No ${requestedSport.toUpperCase()} devig report has been published yet. Results appear after the archived report is built.`);
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
  function sportHeading() {
    SPORT = sport;
    $('sport-filter').value = sport;
    $('sport-label').textContent = sport.toUpperCase();
    $('page-title').textContent = `${sport.toUpperCase()} devig results`;
    document.title = `${sport.toUpperCase()} devig results | +EV Sharps`;
    $('report-window').textContent = sport === 'nfl' ? 'Current season · ET' : 'Last 7 complete days · ET';
  }
  function setSport(next) {
    if (!supportedSports.includes(next) || next === sport) return;
    authVersion++;
    controller?.abort();
    controller = null;
    pending = null;
    sport = next;
    clearReport();
    $('access-panel').hidden = true;
    notice('request-status', '');
    $('generated').textContent = 'Loading published results…';
    $('refresh').disabled = false;
    const url = new URL(location.href); url.searchParams.set('sport', sport);
    history.replaceState(null, '', url);
    sportHeading();
    refresh();
  }
  sportHeading();
  $('sport-filter').addEventListener('change', () => setSport($('sport-filter').value));
  window.addEventListener('popstate', () => setSport(sportFromSearch(location.search)));
  $('best-performers').addEventListener('click', () => {
    if (!report || filterError(filters())) return;
    renderPerformers();
    $('performers-dialog').showModal();
  });
  $('performers-limit').addEventListener('change', () => { performersPage = 0; renderPerformers(); });
  $('performers-columns').addEventListener('change', () => { performersDevigPage = 0; renderPerformers(); });
  $('performers-prev').addEventListener('click', () => { performersPage--; renderPerformers(); });
  $('performers-next').addEventListener('click', () => { performersPage++; renderPerformers(); });
  $('performers-devigs-prev').addEventListener('click', () => { performersDevigPage--; renderPerformers(); });
  $('performers-devigs-next').addEventListener('click', () => { performersDevigPage++; renderPerformers(); });
  for (const id of ['performers-method', 'performers-range']) $(id).addEventListener('change', renderPerformers);
  $('performers-close').addEventListener('click', closePerformers);
  $('performers-dialog').addEventListener('cancel', event => { event.preventDefault(); closePerformers(); });
  const outsidePerformers = event => {
    const dialog = $('performers-dialog'), rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  $('performers-dialog').addEventListener('pointerdown', event => { performersBackdropPressed = event.button === 0 && outsidePerformers(event); });
  $('performers-dialog').addEventListener('pointercancel', () => { performersBackdropPressed = false; });
  $('performers-dialog').addEventListener('click', event => {
    const dismiss = performersBackdropPressed && outsidePerformers(event);
    performersBackdropPressed = false;
    if (dismiss) closePerformers();
  });
  $('performers-copy').addEventListener('click', () => exportPerformers(true));
  $('performers-download').addEventListener('click', () => exportPerformers(false));
  $('refresh').addEventListener('click', refresh);
  $('reset-filters').addEventListener('click', resetFilters);
  $('date-preset').addEventListener('change', applyDatePreset);
  for (const id of ['date-start', 'date-end']) $(id).addEventListener('change', () => { $('date-preset').value = 'custom'; render(); });
  for (const id of ['book-filter', 'market-filter', 'reference-filter', 'method-filter', 'min-settled', 'profitable-only']) $(id).addEventListener('change', render);
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
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${sport}-devig-results-${f.start}-${f.end}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const id of ['account-link', 'access-login']) $(id).href = `profile${HTML}`;
  $('access-pricing').href = `pricing${HTML}`;
  async function boot() {
    if (IS_LOCALHOST) { $('account-link').textContent = localPreview ? 'Local preview' : 'Local development'; await refresh(); return; }
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
