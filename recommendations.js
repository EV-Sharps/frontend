/* Published recommendations are screened again for freshness as the page stays open. */
(() => {
  'use strict';
  PAGE = 'recommendations';
  const $ = id => document.getElementById(id);
  const books = { pn: 'Pinnacle', circa: 'Circa', dk: 'DraftKings', fd: 'FanDuel',
    nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket', hr: 'Hard Rock',
    br: 'BetRivers', kambi: 'Kambi', b365: 'bet365', espn: 'theScore Bet',
    cz: 'Caesars', mgm: 'BetMGM', fn: 'Fanatics', bv: 'Bovada', bol: 'BetOnline',
    re: 'ReBet', fl: 'Fliff', mb: 'Matchbook' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const numeric = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const pct = value => numeric(value) ? `${Number(value).toFixed(1)}%` : '—';
  const odds = value => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}` : '—';
  const dollars = value => numeric(value) ? `$${Math.round(Number(value)).toLocaleString()}` : 'Unknown';
  const bookName = book => books[book] || String(book || '').toUpperCase();
  const title = text => String(text || '').replace(/\b[a-z]/g, char => char.toUpperCase());
  const propLabels = { rec_yd: 'receiving yards', rush_yd: 'rushing yards', pass_yd: 'passing yards',
    pass_td: 'passing TDs', pass_att: 'pass attempts', pass_cmp: 'completions', pass_int: 'interceptions',
    rush_att: 'rush attempts', rec: 'receptions', hr: 'home runs', tb: 'total bases', k: 'strikeouts',
    h: 'hits', hits: 'hits allowed', r: 'runs', r_scored: 'runs scored', rbi: 'RBIs', bb: 'walks',
    sb: 'stolen bases', er: 'earned runs', outs: 'outs recorded', pts: 'points', reb: 'rebounds',
    ast: 'assists', '3ptm': 'threes', sot: 'shots on target', pitcher_walks: 'walks allowed' };
  function selectionLabel(pick) {
    if (!pick.player || ['attd', 'atgs', '2+td', '3+td'].includes(pick.prop)) return title(pick.selection);
    const prop = propLabels[pick.prop] || String(pick.prop).split('+').map(p => propLabels[p] || p.replaceAll('_', ' ')).join(' + ');
    return `${title(pick.player)} ${pick.under ? 'under' : 'over'} ${pick.handicap} ${prop}`;
  }
  let report = null, pending = null, authVersion = 0;
  const validLink = value => {
    if (typeof value !== 'string' || /[{}]/.test(value)) return null;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  };
  const localDay = (now, tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const timeLabel = (value, tz) => new Date(value).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  function notice(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }
  function availablePicks(now = Date.now()) {
    if (!report) return [];
    const c = report.criteria, generated = Date.parse(report.generated_at);
    if (report.date !== localDay(now, c.timezone) || generated > now) return [];
    return report.picks.filter(pick => {
      const quote = Date.parse(pick.quote_updated), start = Date.parse(pick.start);
      const elapsed = (now - generated) / 60000;
      const referenceAges = Object.values(pick.reference_age_minutes || {});
      return Number.isFinite(quote) && Number.isFinite(start) && quote <= now
        && (now - quote) / 60000 <= c.max_age_minutes
        && elapsed <= c.max_age_minutes
        && start > now + c.min_minutes_to_start * 60000
        && referenceAges.length >= c.min_references
        && referenceAges.every(age => numeric(age) && Number(age) >= 0 && Number(age) + elapsed <= c.max_age_minutes);
    });
  }
  function fillOptions(id, values, label) {
    const select = $(id), previous = select.value;
    select.replaceChildren(new Option(label, ''));
    [...new Set(values)].sort().forEach(value => {
      select.add(new Option(id === 'book-filter' ? bookName(value) : value.toUpperCase(), value));
    });
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }
  function renderCard(pick, index) {
    const li = document.createElement('li');
    li.className = 'rec-pick';
    li.dataset.key = [pick.sport, pick.game, pick.player, pick.prop, pick.handicap, pick.under, pick.book].join('|');
    const link = validLink(pick.link);
    const offer = `<strong>${esc(odds(pick.odds))}</strong><span>${esc(bookName(pick.book))}</span>`;
    const reasons = (pick.reasons || []).map(reason => `<li>${esc(reason)}</li>`).join('');
    const refs = Object.entries(pick.reference_probabilities || {}).map(([book, probability]) =>
      `<tr><td>${esc(bookName(book))}</td><td>${esc(pct(Number(probability) * 100))}</td></tr>`).join('');
    const history = pick.history ? `<p>Saved logs: <strong>${esc(pick.history.hits)}/${esc(pick.history.games)}</strong> hits at this line. Historical context only.</p>` : '';
    li.innerHTML = `<article>
      <div class="rec-pick-top"><span class="rec-rank">${index + 1}</span>
        <div><div class="rec-match"><span class="rec-sport">${esc(String(pick.sport).toUpperCase())}</span><span>${esc(String(pick.game).toUpperCase())}</span></div>
          <h2>${esc(selectionLabel(pick))}</h2><p class="rec-start">${esc(pick.main ? 'Main line' : 'Player prop')} · ${esc(timeLabel(pick.start, report.criteria.timezone))}</p></div>
        <div class="rec-quote">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(bookName(pick.book))} selection">${offer}</a>` : offer}</div>
      </div>
      <dl class="rec-stats"><div><dt>Estimated EV</dt><dd class="rec-value">${esc(pct(pick.ev))}</dd></div>
        <div><dt>Conservative EV</dt><dd class="rec-value">${esc(pct(pick.floor_ev))}</dd></div>
        <div><dt>Minimum odds</dt><dd>${esc(odds(pick.minimum_odds))}</dd></div>
        <div><dt>Liquidity</dt><dd>${esc(dollars(pick.liquidity))}</dd></div></dl>
      <details class="rec-details"><summary>Why it qualified · ${esc(pick.reference_groups)} reference groups</summary><div>
        <ul>${reasons}</ul><p>Fair odds: <strong>${esc(odds(pick.fair_odds))}</strong>. Quote updated ${esc(timeLabel(pick.quote_updated, report.criteria.timezone))}.</p>
        ${history}${refs ? `<table class="rec-ref-table"><thead><tr><th>Reference</th><th>Estimated probability</th></tr></thead><tbody>${refs}</tbody></table>` : ''}
        ${!link ? '<p>No direct selection link is available. Locate this exact market and side at the book.</p>' : ''}
      </div></details></article>`;
    return li;
  }
  function render() {
    if (!report) return;
    const c = report.criteria, fresh = availablePicks();
    const sport = $('sport-filter').value, market = $('market-filter').value, book = $('book-filter').value;
    const shown = fresh.filter(p => (!sport || p.sport === sport) && (!book || p.book === book)
      && (!market || Boolean(p.main) === (market === 'main')));
    const openKeys = new Set([...document.querySelectorAll('.rec-pick:has(details[open])')].map(el => el.dataset.key));
    $('picks').replaceChildren(...shown.map((pick, i) => {
      const card = renderCard(pick, i);
      if (openKeys.has(card.dataset.key)) card.querySelector('details').open = true;
      return card;
    }));
    $('pick-count').textContent = fresh.length;
    $('sport-count').textContent = new Set(fresh.map(p => p.sport)).size;
    $('edge-floor').textContent = pct(c.min_ev);
    $('list-caption').textContent = `${shown.length} of ${fresh.length} available plays · Ranked by conservative estimated value`;
    $('empty-state').hidden = shown.length > 0;
    const expired = report.picks.length - fresh.length;
    const age = (Date.now() - Date.parse(report.generated_at)) / 60000;
    const wrongDate = report.date !== localDay(Date.now(), c.timezone);
    const stale = wrongDate || age > c.max_age_minutes || age < 0;
    notice('freshness-status', stale ? 'This saved shortlist is out of date. Expired plays are hidden while we wait for a new publication.'
      : expired ? `${expired} saved ${expired === 1 ? 'play is' : 'plays are'} hidden because the price expired or the game is starting.` : '');
    $('empty-state').querySelector('h2').textContent = fresh.length ? 'No plays match these filters' : stale || expired ? 'Waiting for fresh recommendations' : 'No plays meet the criteria';
    $('empty-state').querySelector('p').textContent = fresh.length ? 'Try another sport, market or book.'
      : 'The shortlist can be empty. Refresh checks for the latest published recommendations.';
  }
  function acceptReport(data) {
    if (!data || !Array.isArray(data.picks) || !data.criteria || !Number.isFinite(Date.parse(data.generated_at))
        || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !numeric(data.criteria.max_age_minutes)
        || !numeric(data.criteria.min_minutes_to_start) || !numeric(data.criteria.min_references)) {
      throw new Error('The recommendation snapshot is not available yet.');
    }
    localDay(Date.now(), data.criteria.timezone); // Validate the timezone before installing.
    report = data;
    $('report-content').hidden = false;
    $('report-content').setAttribute('aria-busy', 'false');
    $('access-panel').hidden = true;
    fillOptions('sport-filter', report.picks.map(p => p.sport), 'All sports');
    fillOptions('book-filter', report.picks.map(p => p.book), 'All books');
    $('report-date').textContent = new Date(`${data.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('generated').textContent = `Published ${timeLabel(data.generated_at, data.criteria.timezone)}`;
    const c = report.criteria;
    $('criteria').innerHTML = [
      [`${pct(c.min_ev)} estimated EV after fees`, `At least ${pct(c.min_floor_ev)} under the conservative estimate.`],
      [`${c.min_references}+ other reference groups`, c.require_anchor ? 'Includes Pinnacle or Circa. The offered book is excluded from its own estimate.' : 'The offered book is excluded from its own estimate.'],
      [`Quotes within ${c.max_age_minutes} minutes`, `Pregame only, at least ${c.min_minutes_to_start} minutes before the start.`],
      [`${dollars(c.min_liquidity)}+ exchange liquidity`, 'The recorded amount on the selected side. Unknown exchange limits are excluded.'],
      [`${odds(c.min_odds)} to ${odds(c.max_odds)}`, `Reference estimates within ${Number(c.max_probability_spread * 100).toFixed(1)} percentage points of each other.`],
      ['Limited repeated exposure', `Up to ${c.max_per_game} per game, one per player and one main line per game.`],
    ].map(([term, definition]) => `<dt>${esc(term)}</dt><dd>${esc(definition)}</dd>`).join('');
    const feeds = Object.entries(data.feeds || {}), errors = Object.entries(data.errors || {});
    $('coverage').innerHTML = `<p>${feeds.length} feeds checked. ${esc(data.qualifying_offers || 0)} qualifying offers before selection limits.</p><ul>`
      + feeds.map(([feed, info]) => `<li>${esc(feed)}: ${esc(info.rows || 0)} rows, ${esc(info.fresh_books?.length || 0)} fresh books</li>`).join('')
      + errors.map(([feed]) => `<li>${esc(feed)}: unavailable</li>`).join('') + '</ul>';
    render();
  }
  function refresh() {
    if (pending) return pending;
    const requestVersion = authVersion;
    $('refresh').disabled = true;
    pending = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(`${API_BASE}/api/recommendations`, {
          headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {},
          cache: 'no-store', signal: controller.signal,
        });
        if (requestVersion !== authVersion) return;
        if ([401, 403].includes(response.status)) {
          report = null;
          $('picks').replaceChildren();
          $('report-content').hidden = true;
          $('access-panel').hidden = false;
          $('generated').textContent = 'Sharp membership';
          notice('freshness-status', '');
          notice('request-status', '');
          return;
        }
        if (!response.ok) throw new Error('Unable to load the latest shortlist. Please try again.');
        const data = await response.json();
        if (requestVersion !== authVersion) return;
        acceptReport(data);
        notice('request-status', Object.keys(data.errors || {}).length ? 'Some feeds were unavailable. The shortlist uses the feeds that loaded; see coverage below.' : '');
        registerOddsLiveRefresh(refresh, response.headers.get('X-Odds-Dataset'));
      } catch (error) {
        if (requestVersion !== authVersion) return;
        notice('request-status', error.name === 'AbortError' ? 'The request timed out. Try refreshing the shortlist.' : error.message);
        $('generated').textContent = report ? $('generated').textContent : 'Shortlist unavailable';
        $('report-content').setAttribute('aria-busy', 'false');
        if (report) render();
        else $('empty-state').hidden = false;
      } finally {
        clearTimeout(timer);
        $('refresh').disabled = false;
        pending = null;
      }
    })();
    return pending;
  }
  refresh.requestLatest = () => pending ? pending.then(refresh) : refresh();
  window.refreshRecommendations = refresh;
  registerOddsLiveRefresh(refresh, null);
  $('refresh').addEventListener('click', refresh);
  ['sport-filter', 'market-filter', 'book-filter'].forEach(id => $(id).addEventListener('change', render));
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  function setSession(session) {
    const token = session?.access_token || '';
    if (token === ACCESS_TOKEN) return;
    ACCESS_TOKEN = token;
    authVersion++;
    report = null;
    $('picks').replaceChildren();
    $('report-content').hidden = true;
    $('account-link').textContent = token ? 'My account' : 'Sign in';
    refresh.requestLatest();
  }
  async function boot() {
    try {
      if (!SB) throw new Error('Sign-in service unavailable. Reload the page to try again.');
      const { data, error } = await SB.auth.getSession();
      if (error) throw error;
      ACCESS_TOKEN = data.session?.access_token || '';
      $('account-link').textContent = ACCESS_TOKEN ? 'My account' : 'Sign in';
      SB.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => setSession(session)); });
      await refresh();
    } catch (_) {
      notice('request-status', 'Sign-in service unavailable. Reload the page to try again.');
      $('generated').textContent = 'Unable to connect';
    }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 30000);
  setInterval(() => { if (document.visibilityState !== 'hidden') render(); }, 15000);
  boot();
})();
