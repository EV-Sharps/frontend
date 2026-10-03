/* Forward results use the saved first publication, never today's live-price filters. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const books = { fd: 'FanDuel', dk: 'DraftKings', fn: 'Fanatics', mgm: 'BetMGM',
    espn: 'theScore Bet', hr: 'Hard Rock', cz: 'Caesars', b365: 'bet365',
    nv: 'Novig', kal: 'Kalshi', px: 'ProphetX', poly: 'Polymarket', br: 'BetRivers',
    kambi: 'Kambi', bol: 'BetOnline', bv: 'Bovada', circa: 'Circa', pn: 'Pinnacle' };
  const bookName = book => books[book] || String(book || '').toUpperCase();
  const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const count = value => numeric(value) ? Number(value).toLocaleString() : '0';
  const signed = (value, suffix = '') => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}${suffix}` : '-';
  const pct = value => numeric(value) ? `${Number(value).toFixed(1)}%` : '-';
  const odds = value => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}` : '-';
  const title = value => String(value || '').replace(/\b[a-z]/g, c => c.toUpperCase());
  const reasons = {
    completion_buffer: 'Waiting until 8 hours after scheduled start',
    awaiting_verified_final: 'Waiting for a verified final result',
    awaiting_final_boxscore: 'Waiting for final player and team stats',
    recorded_result: 'Verified final result',
    unsupported_sport: 'Automatic grading is not available for this sport yet',
    unsupported_market_rules: 'This market needs a settlement-rule review',
    missing_event_identity: 'The game could not be identified',
    missing_scheduled_start: 'Scheduled start time is missing',
    scheduled_date_mismatch: 'The saved game date and start time do not match',
    ambiguous_final_result: 'Multiple games match; the result needs review',
    missing_handicap: 'The saved betting line is missing',
    unresolved_player_identity: 'The player could not be matched to the stats',
    ambiguous_player_game: 'Multiple player game records match',
    missing_player_game_or_DNP: 'Player stats are missing or the player did not play',
    team_mismatch: 'The recorded team does not match this offer',
    opponent_mismatch: 'The recorded opponent does not match this offer',
    participation_not_verified: 'Player participation has not been verified',
    missing_or_unverified_stat: 'The required stat is missing or unverified',
    invalid_recorded_stat: 'The recorded stat needs review',
    moneyline_tie_requires_book_rules: 'A tied result needs the book\'s settlement rules',
    missing_or_ambiguous_period_result: 'The period result is missing or ambiguous',
    missing_period_score: 'The period score is missing',
    missing_period_team_score: 'The team\'s period score is missing',
  };
  const reasonLabel = value => reasons[value] || String(value || '').replaceAll('_', ' ');
  const timestamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }) + ' ET' : '-';
  const record = stats => `${count(stats.wins)}-${count(stats.losses)}-${count(stats.pushes)}`;
  let data = null, token = '', initialized = false, version = 0, pending = null, controller = null;
  function message(text) {
    $('performance-status').textContent = text;
    $('performance-status').hidden = !text;
  }
  function clear() {
    data = null;
    $('performance-data').hidden = true;
    ['performance-results', 'performance-books', 'performance-sports', 'performance-markets', 'performance-summary'].forEach(id => $(id).replaceChildren());
    $('performance-policy').textContent = '';
    $('performance-period').textContent = '';
    $('performance-unique').textContent = '';
    $('performance-book').replaceChildren(new Option('All books (separate offers)', ''));
  }
  function deny(status) {
    version++;
    controller?.abort();
    pending = null;
    clear();
    message(status === 403 ? 'Performance is included with a Sharp subscription.' : 'Sign in with your Sharp account to view performance.');
    $('performance-refresh').disabled = false;
  }
  function breakdown(id, rows, field, label) {
    $(id).innerHTML = rows.map(row => `<tr><td>${esc(label(row[field]))}</td><td>${esc(record(row))}</td>
      <td class="${Number(row.profit_units) > 0 ? 'rec-result-positive' : Number(row.profit_units) < 0 ? 'rec-result-negative' : ''}">${esc(signed(row.profit_units, 'u'))}</td>
      <td>${esc(pct(row.roi_pct))}</td><td>${count(row.pending)} / ${count(row.ungraded)}</td></tr>`).join('')
      || '<tr><td colspan="5">No tracked offers yet.</td></tr>';
  }
  function render() {
    if (!data) return;
    const book = $('performance-book').value;
    const stats = book ? (data.by_book.find(row => row.book === book) || {}) : data.summary;
    $('performance-policy').textContent = (data.policy || 'First published offer per event, player, market and book. The initial price, line and side stay fixed.')
      + ' Grading starts 8 hours after scheduled start and requires a verified final result and the necessary stats.';
    $('performance-period').textContent = `All-time ${book ? bookName(book) : 'all-book'} offered bets since ${timestamp(data.tracking_started_at)}. Updated ${timestamp(data.updated)}. `
      + (book ? 'Cards and recent offers use this book; breakdowns below cover all books.' : 'The same selection at different books counts as separate offers, not independent plays.');
    $('performance-summary').innerHTML = [
      [signed(stats.profit_units, 'u'), 'Net profit after saved fees'], [pct(stats.roi_pct), 'ROI on settled stakes'],
      [record(stats), 'Wins - losses - pushes'], [pct(stats.hit_rate_pct), 'Hit rate (wins / settled decisions)'],
      [count(stats.tracked), 'Tracked offers'], [count(stats.pending), 'Pending'],
      [count(stats.ungraded), 'Ungraded'], [count(stats.void), 'Voids'],
    ].map(([value, label]) => `<div><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
    const unique = data.unique_summary;
    $('performance-unique').hidden = Boolean(book) || !unique;
    $('performance-unique').textContent = unique ? `One pick per market: ${count(unique.tracked)} unique selections, ${record(unique)} W-L-P, ${signed(unique.profit_units, 'u')}, ${pct(unique.roi_pct)} ROI. Uses the highest-ranked offer in the market's first publication; later prices, lines and sides do not replace it.` : '';
    breakdown('performance-books', data.by_book, 'book', bookName);
    breakdown('performance-sports', data.by_sport, 'sport', value => String(value || '').toUpperCase());
    breakdown('performance-markets', data.by_market, 'market', value => ({ props: 'Player props', main: 'Main lines' })[value] || title(value));
    const rows = data.rows.filter(row => !book || row.book === book)
      .slice().sort((a, b) => String(b.first_seen || b.date || '').localeCompare(String(a.first_seen || a.date || ''))).slice(0, 100);
    $('performance-recent-caption').textContent = `Showing ${rows.length} recent ${book ? bookName(book) + ' ' : ''}offers from the published history window (up to 90 days). All-time totals above include the full ledger. Pending and ungraded offers are not losses; voids do not count toward ROI.`;
    $('performance-results').innerHTML = rows.map(row => {
      const status = String(row.status || 'ungraded');
      const selection = row.selection || [row.player, row.under ? 'under' : 'over', row.handicap, row.prop].filter(value => value !== null && value !== undefined && value !== '').join(' ');
      const profit = ['win', 'loss', 'won', 'lost', 'push', 'void'].includes(status) ? signed(row.profit_units, 'u') : '-';
      return `<tr><td><strong>${esc(row.date)}</strong><small>${esc(String(row.sport || '').toUpperCase())} · ${esc(String(row.game || '').toUpperCase())}</small></td>
        <td><strong>${esc(title(selection))}</strong><small>First published ${esc(timestamp(row.first_seen))}</small></td>
        <td><strong>${esc(odds(row.odds))}</strong><small>${esc(bookName(row.book))}</small></td>
        <td>${esc(pct(row.ev))}</td><td><strong>${esc(title(status))}</strong>${row.reason ? `<small>${esc(reasonLabel(row.reason))}</small>` : ''}</td>
        <td class="${Number(row.profit_units) > 0 ? 'rec-result-positive' : Number(row.profit_units) < 0 ? 'rec-result-negative' : ''}">${esc(profit)}</td></tr>`;
    }).join('') || '<tr><td colspan="6">No tracked offers in this published history window.</td></tr>';
    $('performance-data').hidden = false;
  }
  async function refresh() {
    if (!initialized) return;
    if (pending) return pending;
    const requestVersion = version;
    const requestController = new AbortController();
    controller = requestController;
    const timer = setTimeout(() => requestController.abort(), 20000);
    $('performance-refresh').disabled = true;
    pending = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/recommendations/performance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', signal: requestController.signal,
        });
        if (requestVersion !== version) return;
        if ([401, 403].includes(response.status)) { deny(response.status); return; }
        if (!response.ok) throw new Error('Performance has not been published yet or is temporarily unavailable.');
        const payload = await response.json();
        if (requestVersion !== version) return;
        if (payload.version !== 1 || !payload.summary || !['by_book', 'by_sport', 'by_market', 'rows'].every(field => Array.isArray(payload[field]))) {
          throw new Error('The saved performance report could not be read.');
        }
        data = payload;
        const previous = $('performance-book').value;
        $('performance-book').replaceChildren(new Option('All books (separate offers)', ''));
        data.by_book.slice().sort((a, b) => bookName(a.book).localeCompare(bookName(b.book))).forEach(row => $('performance-book').add(new Option(bookName(row.book), row.book)));
        if ([...$('performance-book').options].some(option => option.value === previous)) $('performance-book').value = previous;
        render();
        const reportNotices = [];
        if (!Number(data.summary.tracked)) reportNotices.push('Tracking is ready. Results will appear as newly published recommendations finish.');
        if (Array.isArray(data.grading_errors) && data.grading_errors.length) reportNotices.push('Some result sources could not refresh. Showing saved results; unverified outcomes remain pending or ungraded.');
        message(reportNotices.join(' '));
      } catch (error) {
        if (requestVersion !== version) return;
        message((error.name === 'AbortError' ? 'The performance request timed out.' : error.message)
          + (data ? ' Showing the last loaded report with its saved update time.' : ' Try Refresh results shortly.'));
      } finally {
        clearTimeout(timer);
        if (requestVersion === version) { pending = null; controller = null; $('performance-refresh').disabled = false; }
      }
    })();
    return pending;
  }
  function setSession(value) {
    if (initialized && token === value) return;
    initialized = true;
    token = value;
    version++;
    controller?.abort();
    pending = null;
    clear();
    message('Loading performance...');
    refresh();
  }
  function show(performance) {
    $('performance-view').hidden = !performance;
    $('current-view').hidden = performance;
    $('performance-tab').setAttribute('aria-pressed', String(performance));
    $('current-tab').setAttribute('aria-pressed', String(!performance));
    if (performance && !data) refresh();
  }
  $('performance-tab').addEventListener('click', () => show(true));
  $('current-tab').addEventListener('click', () => show(false));
  $('performance-book').addEventListener('change', render);
  $('performance-refresh').addEventListener('click', refresh);
  setInterval(() => { if (!$('performance-view').hidden && document.visibilityState !== 'hidden') refresh(); }, 300000);
  window.RecommendationPerformance = { setSession, deny, refresh };
})();
