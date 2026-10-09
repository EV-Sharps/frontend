(() => {
  'use strict';
  PAGE = 'atgs-grades'; SPORT = 'nhl';
  const $ = id => document.getElementById(id);
  const grades = ['A', 'B', 'C', 'D', 'U'];
  const books = { fd: 'FanDuel', dk: 'DraftKings', pn: 'Pinnacle', circa: 'Circa', nv: 'Novig',
    px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket', mgm: 'BetMGM', b365: 'bet365',
    cz: 'Caesars', br: 'BetRivers', bv: 'Bovada', bol: 'BetOnline', fn: 'Fanatics',
    espn: 'theScore Bet', hr: 'Hard Rock', hr_az: 'Hard Rock AZ', hr_oh: 'Hard Rock OH',
    kambi: 'Kambi', re: 'Rebet', fl: 'Fliff', mb: 'Matchbook' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
  const number = (value, places = 1) => numeric(value) ? Number(value).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }) : '—';
  const pct = value => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${number(value)}%` : '—';
  const money = value => numeric(value) ? `$${number(value, 0)}` : 'Unknown';
  const odds = value => numeric(value) ? `${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}` : '—';
  const title = value => String(value || '').replace(/\b[a-z]/g, c => c.toUpperCase());
  const bookName = book => books[book] || String(book || '').toUpperCase();
  const grade = row => grades.includes(row?.grade) ? row.grade : 'U';
  const badge = value => `<span class="ag-grade ag-${value}" aria-label="Grade ${value}">${value}</span>`;
  const signClass = value => numeric(value) ? Number(value) > 0 ? 'ag-positive' : Number(value) < 0 ? 'ag-negative' : '' : '';
  const dateTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time unavailable';
  const safeLink = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch (_) { return null; } };
  const array = value => Array.isArray(value) ? value : [];
  let report = null, controller = null, version = 0, ready = false, visibleLimit = 50;
  let chosenBook = new URLSearchParams(location.search).get('book') || 'best';
  const openDetails = new Set();
  const offerKey = offer => [offer.date, offer.game, offer.player, offer.book].join('|');
  const maxAge = () => numeric(report?.policy?.max_age_minutes) && Number(report.policy.max_age_minutes) > 0 ? Math.min(10, Number(report.policy.max_age_minutes)) : 10;
  function notice(id, value) { $(id).textContent = value; $(id).hidden = !value; }
  function cancel() {
    version++; if (controller) controller.abort(); controller = null;
    $('refresh').disabled = false; $('report-content').setAttribute('aria-busy', 'false');
  }
  function clear() {
    report = null;
    $('report-content').hidden = true;
    $('offers').replaceChildren(); $('records').replaceChildren();
    $('access-panel').hidden = true; $('unpublished-panel').hidden = true;
  }
  function access(status) {
    clear(); notice('request-status', '');
    $('access-panel').hidden = false;
    $('access-title').textContent = status === 401 ? 'Sign in to view ATGS grades' : 'ATGS grades are included with Analyst and Sharp';
    $('access-message').textContent = status === 401 ? 'Sign in to view current grades and grade records.' : 'Your current account does not include this page. Analyst and Sharp include access.';
    $('generated').textContent = 'Account access required';
  }
  function fresh(value, now) {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) && stamp <= now && now - stamp <= maxAge() * 60000;
  }
  function currentOffers(now) {
    if (!report || !fresh(report.current?.generated_at || report.generated_at, now)) return [];
    return array(report.current?.offers).filter(offer => offer && fresh(offer.quote_updated, now)
      && Number.isFinite(Date.parse(offer.start)) && Date.parse(offer.start) > now
      && [...array(offer.sharp_references), ...array(offer.market_references)].every(ref => fresh(ref?.quote_updated, now)));
  }
  const compareText = (a, b) => String(a).localeCompare(String(b));
  function compareOffers(a, b) {
    return grades.indexOf(grade(a)) - grades.indexOf(grade(b))
      || (numeric(b.score) ? Number(b.score) : -Infinity) - (numeric(a.score) ? Number(a.score) : -Infinity)
      || (numeric(b.net_decimal) ? Number(b.net_decimal) : -Infinity) - (numeric(a.net_decimal) ? Number(a.net_decimal) : -Infinity)
      || compareText(a.book, b.book);
  }
  function scopedOffers(offers) {
    if (chosenBook !== 'best') return offers.filter(offer => offer.book === chosenBook).sort(compareOffers);
    const selections = new Map();
    [...offers].sort(compareOffers).forEach(offer => {
      const key = [offer.date, offer.game, offer.player].join('|');
      if (!selections.has(key)) selections.set(key, offer);
    });
    return [...selections.values()];
  }
  function liquidityLabel(value) {
    if (Array.isArray(value)) return `${money(value[0])} Yes / ${money(value[1])} No`;
    if (value && typeof value === 'object') return `${money(value.yes ?? value.over)} Yes / ${money(value.no ?? value.under)} No`;
    return numeric(value) ? `${money(value)} minimum side depth` : 'Depth unavailable';
  }
  function referenceItem(ref, market) {
    return `<li><strong>${esc(bookName(ref.book))}</strong>: ${esc(pct(ref.ev))} EV${numeric(ref.probability) ? ` / ${esc(number(Number(ref.probability) * 100))}% fair probability` : ''}${market ? `<br>${esc(liquidityLabel(ref.liquidity))}` : ref.inferred ? '<br>Missing opposite price estimated at 7% vig' : '<br>Both reference prices quoted'}<br><small>Updated ${esc(dateTime(ref.quote_updated))}</small></li>`;
  }
  function renderOffer(offer) {
    const sharp = array(offer.sharp_references), market = array(offer.market_references), reasons = array(offer.reasons);
    const key = offerKey(offer), link = safeLink(offer.link), value = grade(offer);
    const price = `<strong>${esc(odds(offer.odds))}</strong><small>${esc(bookName(offer.book))}</small>`;
    return `<tr data-book="${esc(offer.book)}" data-grade="${value}"><td class="ag-offer-grade">${badge(value)}</td><td class="ag-player"><strong>${esc(title(offer.player))}</strong><small>${esc(String(offer.game || '').toUpperCase())}</small><small>${esc(dateTime(offer.start))}</small></td><td class="ag-price">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${price}</a>` : price}<small>${numeric(offer.liquidity) ? `${esc(money(offer.liquidity))} available` : 'Stake limit unverified'}</small></td><td class="ag-sharp" data-label="Sharp EV"><strong class="${signClass(offer.sharp_ev)}">${esc(pct(offer.sharp_ev))}</strong><small>${sharp.length} ${sharp.length === 1 ? 'reference' : 'references'}</small></td><td class="ag-market" data-label="Liquid market EV"><strong class="${signClass(offer.market_ev)}">${esc(pct(offer.market_ev))}</strong><small>${market.length} ${market.length === 1 ? 'market' : 'markets'}</small></td><td class="ag-evidence"><details data-key="${esc(key)}" ${openDetails.has(key) ? 'open' : ''}><summary>${value === 'U' ? 'Why unrated' : 'Grade evidence'} / ${esc(pct(offer.score))} score</summary><p>Offer updated ${esc(dateTime(offer.quote_updated))}. Lowest included reference EV: ${esc(pct(offer.reference_floor_ev))}.</p>${sharp.length ? `<strong>Sharp references</strong><ul>${sharp.map(ref => referenceItem(ref, false)).join('')}</ul>` : '<p>No qualifying sharp reference.</p>'}${market.length ? `<strong>Prediction markets</strong><ul>${market.map(ref => referenceItem(ref, true)).join('')}</ul>` : '<p>No qualifying prediction market with verified depth on both sides.</p>'}${reasons.length ? `<ul>${reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}</details></td></tr>`;
  }
  function renderCurrent() {
    if (!report) return;
    const now = Date.now(), freshOffers = currentOffers(now), scoped = scopedOffers(freshOffers);
    const filter = $('grade-filter').value, shown = scoped.filter(offer => filter === 'all' || grade(offer) === filter);
    $('current-count').textContent = number(scoped.length, 0);
    $('graded-count').textContent = number(scoped.filter(offer => grade(offer) !== 'U').length, 0);
    $('a-count').textContent = number(scoped.filter(offer => grade(offer) === 'A').length, 0);
    $('current-caption').textContent = `${number(shown.length, 0)} matching ${chosenBook === 'best' ? 'selections' : 'offers'}${shown.length > visibleLimit ? ` / first ${visibleLimit} shown` : ''}. EV includes fees; quotes expire after ${maxAge()} minutes.`;
    $('offers').innerHTML = shown.slice(0, visibleLimit).map(renderOffer).join('');
    $('offers').querySelectorAll('details').forEach(el => el.addEventListener('toggle', () => {
      if (!el.isConnected) return;
      if (el.open) openDetails.add(el.dataset.key); else openDetails.delete(el.dataset.key);
    }));
    $('offers-empty').hidden = shown.length > 0;
    $('offers-wrap').hidden = shown.length === 0;
    $('show-more').hidden = shown.length <= visibleLimit;
    const excluded = array(report.current?.offers).length - freshOffers.length;
    notice('freshness-status', excluded > 0 ? `${number(excluded, 0)} saved offers hidden because their quotes expired, reference timestamps could not be verified, or the game started. Historical records remain available.` : '');
  }
  function renderRecord(row) {
    const settled = numeric(row.settled) ? Number(row.settled) : 0;
    const interval = array(row.roi_interval);
    const ci = interval.length === 2 && interval.every(numeric) ? `${pct(interval[0])} to ${pct(interval[1])}` : 'Not enough independent dates';
    return `<tr data-grade="${grade(row)}"><td>${badge(grade(row))}</td><td>${settled ? `${number(row.wins, 0)}–${number(row.losses, 0)}` : '—'}${Number(row.pushes) > 0 ? `<small>${number(row.pushes, 0)} pushes</small>` : ''}</td><td class="${settled ? signClass(row.roi_pct) : ''}"><strong>${settled ? esc(pct(row.roi_pct)) : '—'}</strong></td><td>${settled ? `${esc(number(row.profit_units, 2))}u` : '—'}</td><td>${esc(number(row.settled, 0))} / ${esc(number(row.selected, 0))}</td><td>${esc(number(row.pending, 0))} / ${esc(number(row.ungraded, 0))}</td><td>${esc(number(row.days, 0))} / ${esc(number(row.games, 0))}</td><td>${chosenBook === 'best' ? esc(ci) : 'Best-available scope only'}</td></tr>`;
  }
  function renderRecords() {
    if (!report) return;
    const source = $('record-source').value, block = report[source], isHistory = source === 'historical';
    const split = isHistory ? $('split-filter').value : 'all', filter = $('grade-filter').value;
    $('split-label').hidden = !isHistory;
    const records = array(block?.records).filter(row => row.scope === chosenBook && (row.split || 'all') === split
      && (filter === 'all' || grade(row) === filter)).sort((a, b) => grades.indexOf(grade(a)) - grades.indexOf(grade(b)));
    $('records').innerHTML = records.map(renderRecord).join('');
    const hasSelections = records.some(row => Number(row.selected) > 0);
    $('records-wrap').hidden = !hasSelections;
    $('records-empty').hidden = hasSelections;
    $('records-empty-message').textContent = isHistory && !block ? 'The historical backtest has not been built yet. Historical records will appear after the next completed report.' : isHistory ? 'No historical records match this book and period.' : 'Forward tracking starts with the first fully rateable A–D selection successfully published before its game. The grade, betting book and price are frozen then. Unrated observations do not reserve a record; results refresh every 30 minutes.';
    const window = block?.window;
    $('record-window').textContent = isHistory ? window?.start && window?.end ? `${window.start} through ${window.end}` : 'Dated archive snapshots' : `Selections published before their games${block?.generated_at ? ` / results updated ${dateTime(block.generated_at)}` : ''}`;
    if (isHistory) {
      const start = block?.split?.evaluation_start;
      const period = split === 'evaluation' ? `Later chronological evaluation${start ? ` from ${start}` : ''}. ` : split === 'development' ? 'Earlier chronological period. ' : 'All archived dates, including the earlier period and later evaluation. ';
      const evaluation = array(block?.records).filter(row => row.scope === chosenBook && row.split === 'evaluation');
      const rated = evaluation.filter(row => grade(row) !== 'U').reduce((sum, row) => sum + (Number(row.settled) || 0), 0);
      const positive = evaluation.filter(row => ['A', 'B', 'C'].includes(grade(row))).reduce((sum, row) => sum + (Number(row.settled) || 0), 0);
      const aSettled = evaluation.filter(row => grade(row) === 'A').reduce((sum, row) => sum + (Number(row.settled) || 0), 0);
      const sample = evaluation.length ? `Later evaluation in this book scope: ${number(rated, 0)} rated settled selections; ${number(positive, 0)} in A–C and ${number(aSettled, 0)} in A. ` : '';
      $('record-context').textContent = `${period}${sample}Grade cutoffs are fixed before outcome review. Archive quote times are unverified, and unknown required depth remains unrated. This is historical context, not proof the grade will be profitable.`;
    } else {
      $('record-context').textContent = 'Forward tracking freezes the first fully rateable A–D selection successfully published before the game, including its book, price and evidence. Unrated observations do not reserve a record. Later grade changes do not rewrite this record; results refresh every 30 minutes.';
    }
    $('scope-note').textContent = chosenBook === 'best' ? 'Best available chooses the strongest grade, then EV score and price, once per player and game. The record does not combine alternative books.' : `${bookName(chosenBook)} only. Alternative books are separate records on overlapping players and must not be added together.`;
  }
  function coverageMarkup(value, depth = 0) {
    if (!value || typeof value !== 'object') return '<p>No coverage details published.</p>';
    const entries = Object.entries(value).filter(([, entry]) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry));
    const nested = depth < 2 ? Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object' && !Array.isArray(entry)) : [];
    return (entries.length ? `<dl class="ag-coverage-grid">${entries.map(([key, entry]) => `<div><dt>${esc(title(key.replaceAll('_', ' ')))}:</dt><dd>${esc(entry === null ? 'Unknown' : entry === false ? 'No' : entry === true ? 'Yes' : entry)}</dd></div>`).join('')}</dl>` : '')
      + nested.map(([key, entry]) => `<h4 class="ag-coverage-heading">${esc(title(key.replaceAll('_', ' ')))}</h4>${coverageMarkup(entry, depth + 1)}`).join('')
      || '<p>No coverage counts published.</p>';
  }
  function populate(data) {
    report = data;
    const names = new Set(array(data.current?.offers).map(offer => offer.book));
    [data.historical, data.prospective].forEach(block => array(block?.records).forEach(row => { if (row.scope && row.scope !== 'best') names.add(row.scope); }));
    if (chosenBook !== 'best') names.add(chosenBook);
    $('book-filter').innerHTML = '<option value="best">Best available / one per player</option>' + [...names].filter(book => typeof book === 'string' && book).sort((a, b) => bookName(a).localeCompare(bookName(b))).map(book => `<option value="${esc(book)}">${esc(bookName(book))}</option>`).join('');
    $('book-filter').value = chosenBook;
    const policy = data.policy || {};
    $('depth-amount').textContent = money(policy.min_reference_liquidity ?? policy.stake ?? 100);
    $('policy-label').textContent = `Policy ${policy.version || 'atgs-grade-v1'}`;
    $('policy-label').title = policy.policy_id || '';
    $('generated').textContent = `Published ${dateTime(data.generated_at)}`;
    $('policy-detail').textContent = `Model stake: ${money(policy.stake ?? 100)}. Prediction markets need at least ${money(policy.min_reference_liquidity ?? policy.stake ?? 100)} of quoted stake depth on each side. Each family's EV uses the mean of its reference fair probabilities; the score is the lower of the two family EVs. EV uses the ${policy.method || 'worst'} devig method and fee-adjusted returns, without an EV cap. Sharp references may estimate a missing opposite price using 7% vig; prediction market evidence requires both quoted sides. The betting book is excluded from its own reference evidence.`;
    const notes = [...array(data.notes), ...array(data.historical?.notes), ...array(data.prospective?.notes)];
    $('coverage').innerHTML = `<h3 class="ag-coverage-heading">Current offers</h3>${coverageMarkup(data.current?.coverage)}<h3 class="ag-coverage-heading">Historical archives</h3>${coverageMarkup(data.historical?.coverage)}<h3 class="ag-coverage-heading">Forward tracking</h3>${coverageMarkup(data.prospective?.coverage)}${notes.length ? `<ul>${[...new Set(notes)].map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}`;
    $('report-content').hidden = false; $('access-panel').hidden = true; $('unpublished-panel').hidden = true;
    renderCurrent(); renderRecords();
  }
  function syncURL() {
    const url = new URL(location.href);
    [['book', chosenBook], ['grade', $('grade-filter').value], ['source', $('record-source').value], ['split', $('split-filter').value]].forEach(([key, value]) => url.searchParams.set(key, value));
    history.replaceState(null, '', url);
  }
  async function refresh() {
    if (!ready) return;
    cancel(); clear();
    if (!ACCESS_TOKEN && !IS_LOCALHOST) { access(401); return; }
    const requestVersion = version, active = new AbortController(); controller = active;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; active.abort(); }, 20000);
    $('refresh').disabled = true; $('report-content').setAttribute('aria-busy', 'true');
    notice('request-status', 'Loading published grades and records...');
    try {
      const response = await fetch(`${API_BASE}/api/atgs-grades`, { headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}, signal: active.signal, cache: 'no-store' });
      if (requestVersion !== version) return;
      if ([401, 403].includes(response.status)) { access(response.status); return; }
      let data;
      try { data = await response.json(); } catch (_) { throw new Error('The grade report could not load. Try refreshing.'); }
      if (requestVersion !== version) return;
      if (response.status === 503 && data.code === 'not_published') {
        notice('request-status', ''); $('unpublished-panel').hidden = false; $('generated').textContent = 'Awaiting first report'; return;
      }
      if (!response.ok) throw new Error('The grade report is temporarily unavailable. Try refreshing.');
      if (data?.version !== 1 || !Array.isArray(data.current?.offers) || !data.policy || typeof data.policy !== 'object') throw new Error('The published grade report has an unsupported format. Refresh after the next report is published.');
      populate(data); notice('request-status', '');
    } catch (error) {
      if (requestVersion !== version) return;
      clear(); $('generated').textContent = 'Report unavailable';
      notice('request-status', timedOut ? 'The grade report took too long to load. Try refreshing.' : error.message || 'The grade report could not load. Try refreshing.');
    } finally {
      clearTimeout(timeout);
      if (requestVersion === version) { controller = null; $('refresh').disabled = false; $('report-content').setAttribute('aria-busy', 'false'); }
    }
  }
  ['book-filter', 'grade-filter', 'record-source', 'split-filter'].forEach(id => $(id).addEventListener('change', () => {
    chosenBook = $('book-filter').value; visibleLimit = 50; syncURL(); renderCurrent(); renderRecords();
  }));
  $('show-more').addEventListener('click', () => { visibleLimit += 50; renderCurrent(); });
  $('refresh').addEventListener('click', refresh);
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  async function sessionChanged(session) {
    const token = session?.access_token || '';
    if (ready && token === ACCESS_TOKEN) return;
    cancel(); clear(); ACCESS_TOKEN = token; ready = true;
    $('account-link').textContent = token ? 'My account' : 'Sign in';
    await refresh();
  }
  async function boot() {
    const query = new URLSearchParams(location.search);
    if (['all', ...grades].includes(query.get('grade'))) $('grade-filter').value = query.get('grade');
    if (['historical', 'prospective'].includes(query.get('source'))) $('record-source').value = query.get('source');
    if (['all', 'development', 'evaluation'].includes(query.get('split'))) $('split-filter').value = query.get('split');
    if (!/^(?:best|[a-z0-9_]{1,30})$/.test(chosenBook)) chosenBook = 'best';
    if (IS_LOCALHOST) { await sessionChanged(null); return; }
    try {
      if (!SB) throw new Error();
      SB.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => sessionChanged(session)); });
      const { data, error } = await SB.auth.getSession();
      if (error) throw error;
      await sessionChanged(data.session);
    } catch (_) { clear(); notice('request-status', 'The sign-in service is unavailable. Reload to try again.'); }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden') renderCurrent(); }, 10000);
  setInterval(() => { if (document.visibilityState !== 'hidden' && !controller) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') { renderCurrent(); refresh(); } });
  window.refreshATGSGrades = refresh;
  boot();
})();
