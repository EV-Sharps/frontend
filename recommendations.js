/* Published recommendations are screened again for freshness as the page stays open. */
(() => {
  'use strict';
  PAGE = 'recommendations';
  const $ = id => document.getElementById(id);
  const books = { pn: 'Pinnacle', circa: 'Circa', dk: 'DraftKings', fd: 'FanDuel',
    nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket', hr: 'Hard Rock',
    br: 'BetRivers', kambi: 'Kambi', b365: 'bet365', espn: 'theScore Bet',
    cz: 'Caesars', mgm: 'BetMGM', fn: 'Fanatics', bv: 'Bovada', bol: 'BetOnline',
    re: 'ReBet', fl: 'Fliff', mb: 'Matchbook', hr_az: 'Hard Rock', hr_oh: 'Hard Rock' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const numeric = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const pct = value => numeric(value) ? `${Number(value).toFixed(1)}%` : '—';
  const odds = value => numeric(value) ? oddsDisplay(`${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}`) : '—';
  const edge = value => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${pct(value)}` : '—';
  const dollars = value => numeric(value) ? `$${Math.round(Number(value)).toLocaleString()}` : 'Unknown';
  const bookName = book => books[book] || String(book || '').toUpperCase();
  function bookLogo(book) {
    if (!Object.hasOwn(books, book)) return `<span class="rec-book-fallback" aria-hidden="true">${esc(String(book || '?').slice(0, 3).toUpperCase())}</span>`;
    const asset = { hr_az: 'hr', hr_oh: 'hr', kambi: 'parx' }[book] || book;
    return `<img class="rec-book-logo" src="logos/${asset}.png" width="20" height="20" alt="">`;
  }
  const title = text => String(text || '').replace(/\b[a-z]/g, char => char.toUpperCase());
  const propLabels = { rec_yd: 'receiving yards', rush_yd: 'rushing yards', pass_yd: 'passing yards',
    pass_td: 'passing TDs', pass_att: 'pass attempts', pass_cmp: 'completions', pass_int: 'interceptions',
    rush_att: 'rush attempts', rec: 'receptions', hr: 'home runs', tb: 'total bases', k: 'strikeouts',
    h: 'hits', hits: 'hits allowed', r: 'runs', r_scored: 'runs scored', rbi: 'RBIs', bb: 'walks',
    sb: 'stolen bases', er: 'earned runs', outs: 'outs recorded', pts: 'points', reb: 'rebounds',
    ast: 'assists', '3ptm': 'threes', sot: 'shots on target', sog: 'shots on goal', pitcher_walks: 'walks allowed',
    rec_yds: 'receiving yards', rush_yds: 'rushing yards', pass_yds: 'passing yards',
    attd: 'anytime touchdown', atgs: 'anytime goalscorer', '2+td': '2+ touchdowns', '3+td': '3+ touchdowns' };
  const propLabel = prop => propLabels[prop] || String(prop || '').split('+').map(p => propLabels[p] || p.replaceAll('_', ' ')).join(' + ');
  function selectionLabel(pick) {
    if (!pick.player || ['attd', 'atgs', '2+td', '3+td'].includes(pick.prop)) return title(pick.selection);
    return `${title(pick.player)} ${pick.under ? 'under' : 'over'} ${pick.handicap} ${propLabel(pick.prop)}`;
  }
  let report = null, pending = null, authVersion = 0;
  const pageSize = 50;
  let visibleLimit = pageSize;
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
  function renderRow(pick, index, openKeys) {
    const row = document.createElement('tr'), detail = document.createElement('tr');
    row.className = 'rec-pick';
    row.dataset.key = [pick.sport, pick.game, pick.player, pick.prop, pick.handicap, pick.under, pick.book].join('|');
    detail.className = 'rec-detail-row';
    detail.id = `rec-detail-${index}`;
    const link = validLink(pick.link);
    const offer = `${bookLogo(pick.book)}<span class="rec-offer-copy"><strong>${esc(odds(pick.odds))}</strong><small>${esc(bookName(pick.book))}</small></span>${link ? '<span class="rec-offer-arrow" aria-hidden="true">↗</span>' : ''}`;
    const reasons = (pick.reasons || []).map(reason => `<li>${esc(reason)}</li>`).join('');
    const references = Object.entries(pick.reference_probabilities || {});
    const refs = references.map(([book, probability]) =>
      `<tr><td><span class="rec-reference-book">${bookLogo(book)}${esc(bookName(book))}</span></td><td>${esc(pct(Number(probability) * 100))}</td></tr>`).join('');
    const referenceLogos = references.map(([book, probability]) => {
      const label = `${bookName(book)}: ${pct(Number(probability) * 100)}`;
      return `<span class="rec-reference-logo" title="${esc(label)}">${bookLogo(book)}<span class="sr-only">${esc(label)}</span></span>`;
    }).join('');
    const history = pick.history ? `<p>Saved logs: <strong>${esc(pick.history.hits)}/${esc(pick.history.games)}</strong> hits at this line. Historical context only.</p>` : '';
    const heading = pick.player ? title(pick.player) : title(pick.selection);
    const line = pick.main ? (pick.prop === 'ml' ? 'ML' : title(pick.prop.replaceAll('_', ' ')))
      : numeric(pick.handicap) ? `${pick.under ? 'U' : 'O'}${pick.handicap}` : '—';
    row.innerHTML = `<td class="rec-rank-cell">${index + 1}</td>
      <td class="rec-ev-cell" data-label="EV"><strong class="rec-value">${esc(edge(pick.ev))}</strong><small title="Conservative estimated EV">Floor ${esc(edge(pick.floor_ev))}</small></td>
      <td class="rec-selection-cell"><strong>${esc(heading)}</strong><small>${esc(pick.main ? 'Main line' : title(propLabel(pick.prop)))}</small></td>
      <td class="rec-line-cell" data-label="Line"><strong>${esc(line)}</strong></td>
      <td class="rec-book-cell">${link ? `<a class="rec-offer" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(selectionLabel(pick))} at ${esc(bookName(pick.book))}">${offer}</a>` : `<span class="rec-offer">${offer}</span>`}</td>
      <td class="rec-fair-cell" data-label="Fair / Min."><span title="Fair odds">FV <strong>${esc(odds(pick.fair_odds))}</strong></span><small title="Minimum acceptable odds">Min ${esc(odds(pick.minimum_odds))}</small></td>
      <td class="rec-liquidity-cell" data-label="Liquidity"><strong title="${numeric(pick.liquidity) ? 'Recorded liquidity on this side' : 'Liquidity not provided'}">${numeric(pick.liquidity) ? esc(dollars(pick.liquidity)) : '—'}</strong></td>
      <td class="rec-game-cell"><span class="rec-match"><span class="rec-sport">${esc(String(pick.sport).toUpperCase())}</span>${esc(String(pick.game).toUpperCase())}</span><small>${esc(timeLabel(pick.start, report.criteria.timezone))}</small></td>
      <td class="rec-reference-cell"><span class="rec-reference-logos">${referenceLogos}</span><small>${esc(pick.reference_groups)} groups</small></td>
      <td class="rec-details-cell"><button class="rec-toggle" type="button" aria-expanded="false" aria-controls="${detail.id}" aria-label="Qualification details for ${esc(selectionLabel(pick))}">Details <span aria-hidden="true">⌄</span></button></td>`;
    detail.innerHTML = `<td colspan="10"><div class="rec-details"><section>
      <h2>Why it qualified <span>${esc(pick.reference_groups)} reference groups</span></h2>
      <ul>${reasons}</ul><p>Fair odds: <strong>${esc(odds(pick.fair_odds))}</strong>. Quote updated ${esc(timeLabel(pick.quote_updated, report.criteria.timezone))}.</p>
      ${history}${!link ? '<p>No direct selection link is available. Locate this exact market and side at the book.</p>' : ''}</section>
      ${refs ? `<table class="rec-ref-table"><caption>Reference estimates</caption><thead><tr><th scope="col">Book</th><th scope="col">Probability</th></tr></thead><tbody>${refs}</tbody></table>` : ''}
      </div></td>`;
    const toggle = row.querySelector('.rec-toggle');
    const setExpanded = open => {
      toggle.setAttribute('aria-expanded', String(open));
      row.classList.toggle('is-expanded', open);
      detail.hidden = !open;
    };
    toggle.addEventListener('click', () => setExpanded(detail.hidden));
    setExpanded(openKeys.has(row.dataset.key));
    const fragment = document.createDocumentFragment();
    fragment.append(row, detail);
    return fragment;
  }
  function render() {
    if (!report) return;
    const c = report.criteria, fresh = availablePicks();
    const sport = $('sport-filter').value, market = $('market-filter').value, book = $('book-filter').value;
    const shown = fresh.filter(p => (!sport || p.sport === sport) && (!book || p.book === book)
      && (!market || Boolean(p.main) === (market === 'main')));
    const visible = shown.slice(0, visibleLimit);
    const openKeys = new Set([...document.querySelectorAll('.rec-pick.is-expanded')].map(el => el.dataset.key));
    $('picks').replaceChildren(...visible.map((pick, i) => renderRow(pick, i, openKeys)));
    $('picks-table-wrap').hidden = shown.length === 0;
    $('pick-count').textContent = fresh.length;
    $('sport-count').textContent = new Set(fresh.map(p => p.sport)).size;
    $('edge-floor').textContent = pct(c.min_ev);
    $('list-caption').textContent = `${visible.length} of ${shown.length} matching plays · ${fresh.length} available · Ranked by conservative estimated value`;
    $('show-more').hidden = visible.length >= shown.length;
    $('show-more').textContent = `Show ${Math.min(pageSize, shown.length - visible.length)} more`;
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
    const coverage = (report.coverage || []).filter(entry => (!sport || entry.sport === sport)
      && (!book || entry.book === book) && (!market || entry.market === market));
    if (!shown.length && !stale && coverage.length && coverage.every(entry => entry.selected === 0)) {
      const counts = {};
      coverage.forEach(entry => Object.entries(entry.rejections || {}).forEach(([reason, count]) => {
        counts[reason] = (counts[reason] || 0) + Number(count);
      }));
      const labels = { insufficient_edge: 'below the EV or stress-EV minimum', odds_range: 'outside the odds range',
        insufficient_reference_support: 'too few eligible reference groups', reference_disagreement: 'reference prices disagree',
        different_date: 'not on the selected date', unsupported_settlement: 'unsupported settlement type',
        missing_selected_side_price: 'no price for this side', insufficient_or_unknown_liquidity: 'insufficient offer liquidity' };
      const reasons = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([reason, count]) => `${Number(count).toLocaleString()} ${labels[reason] || reason.replaceAll('_', ' ')}`).join('; ');
      const quoted = coverage.reduce((sum, entry) => sum + Number(entry.quoted_rows || 0), 0);
      $('empty-state').querySelector('h2').textContent = `No qualifying ${book ? bookName(book) + ' ' : ''}plays`;
      $('empty-state').querySelector('p').textContent = `${quoted.toLocaleString()} quote rows checked, including alternate lines. `
        + (reasons ? `Top exclusions: ${reasons}. ` : '')
        + `Minimums: ${pct(c.min_ev)} estimated EV and ${pct(c.min_floor_ev)} conservative EV.`;
    }
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
    const covered = [...report.picks, ...(report.coverage || [])];
    fillOptions('sport-filter', covered.map(p => p.sport), 'All sports');
    fillOptions('book-filter', covered.map(p => p.book), 'All books');
    $('report-date').textContent = new Date(`${data.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('generated').textContent = `Published ${timeLabel(data.generated_at, data.criteria.timezone)}`;
    const c = report.criteria;
    $('criteria').innerHTML = [
      [`${pct(c.min_ev)} estimated EV after fees`, `At least ${pct(c.min_floor_ev)} under the conservative estimate.`],
      [`${c.min_references}+ other reference groups`, c.require_anchor ? 'Includes Pinnacle or Circa. The offered book is excluded from its own estimate.' : 'The offered book is excluded from its own estimate.'],
      [`Quotes within ${c.max_age_minutes} minutes`, `Pregame only, at least ${c.min_minutes_to_start} minutes before the start.`],
      //[`${dollars(c.min_liquidity)}+ exchange liquidity`, 'The recorded amount on the selected side. Unknown exchange limits are excluded.'],
      [`${odds(c.min_odds)} to ${odds(c.max_odds)}`, `Reference estimates within ${Number(c.max_probability_spread * 100).toFixed(1)} percentage points of each other.`],
      [data.selection_mode === 'book_sport_market' ? `Up to ${c.limit} props + ${c.limit} main lines per book, per sport` : 'Limited repeated exposure',
        data.selection_mode === 'book_sport_market'
          ? `Each list allows up to ${c.max_per_game} per game, one per player and one main line per game. The same play at different books is an alternative place to bet.`
          : `Up to ${c.max_per_game} per game, one per player and one main line per game.`],
    ].map(([term, definition]) => `<div><dt>${esc(term)}</dt><dd>${esc(definition)}</dd></div>`).join('');
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
  ['sport-filter', 'market-filter', 'book-filter'].forEach(id => $(id).addEventListener('change', () => {
    visibleLimit = pageSize;
    render();
  }));
  $('show-more').addEventListener('click', () => {
    visibleLimit += pageSize;
    render();
  });
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
