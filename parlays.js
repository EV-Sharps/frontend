(() => {
  'use strict';
  PAGE = 'parlays';
  SPORT = 'mlb';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const title = v => String(v).replace(/\b\w/g, c => c.toUpperCase());
  const odds = v => v === null || !Number.isFinite(Number(v)) ? '\u2014' : `${v >= 0 ? '+' : '-'}${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  const pct = v => `${(v * 100).toFixed(3)}%`;
  const time = v => v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Unknown';
  const matchup = game => game.split(' @ ').map(t => t.replace(/-gm\d+$/, '')).sort().join('|');
  const selections = ['', '', ''];
  let catalog = null, result = null, refreshWork = null, quoteController = null;
  let authVersion = 0, inputVersion = 0, quoteBusy = false;
  const notice = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
  const selectedLegs = () => selections.map(id => catalog?.legs.find(leg => leg.id === id));
  function clearResult() {
    inputVersion++;
    quoteController?.abort();
    quoteController = null;
    quoteBusy = false;
    $('calculate').textContent = 'Calculate fair odds';
    result = null;
    $('results').hidden = true;
    $('reference-rows').replaceChildren();
  }
  function selectionError() {
    const legs = selectedLegs();
    if (legs.some(leg => !leg)) return '';
    if (new Set(legs.map(leg => leg.player)).size < 3) return 'Choose three different players.';
    if (new Set(legs.map(leg => matchup(leg.game))).size < 3) return 'Choose players from three separate matchups. Same-game and doubleheader combinations are not supported.';
    if (legs.some(leg => Date.parse(leg.start) <= Date.now())) return 'A selected game has started. Refresh and choose another player.';
    return '';
  }
  function validate() {
    const error = selectionError();
    notice('selection-status', error);
    $('calculate').disabled = !catalog || quoteBusy || selectedLegs().some(leg => !leg) || Boolean(error);
    return !error && selectedLegs().every(Boolean);
  }
  function fillLeg(index) {
    const select = $(`leg-${index}`), search = $(`search-${index}`).value.trim().toLowerCase();
    const others = selectedLegs().filter((leg, i) => leg && i !== index);
    select.replaceChildren(new Option('Choose a player', ''));
    for (const leg of catalog?.legs || []) {
      if (leg.id !== selections[index] && !`${leg.player} ${leg.game}`.includes(search)) continue;
      const option = new Option(`${title(leg.player)} / ${leg.game.toUpperCase()}`, leg.id);
      const conflict = others.some(other => other.player === leg.player || matchup(other.game) === matchup(leg.game));
      option.disabled = conflict;
      if (conflict) option.textContent += ' (matchup already selected)';
      select.add(option);
    }
    select.value = selections[index];
    const leg = selectedLegs()[index];
    $(`detail-${index}`).textContent = leg
      ? `${leg.game.toUpperCase()} / ${time(leg.start)} / ${Object.values(leg.quotes).filter(q => q.status === 'available').length} fresh two-sided reference books`
      : 'Search by player or team, then choose a player.';
  }
  for (let i = 0; i < 3; i++) {
    const div = document.createElement('div');
    div.className = 'leg-card';
    div.innerHTML = `<span class="leg-number" aria-hidden="true">${i + 1}</span><label for="search-${i}">Leg ${i + 1}: search players<input id="search-${i}" type="search" placeholder="Player or team" autocomplete="off"></label><label class="sr-only" for="leg-${i}">Leg ${i + 1} player</label><select id="leg-${i}" aria-describedby="detail-${i}"><option value="">Choose a player</option></select><p class="leg-detail" id="detail-${i}">Search by player or team, then choose a player.</p>`;
    $('leg-inputs').append(div);
    $(`search-${i}`).addEventListener('input', () => fillLeg(i));
    $(`leg-${i}`).addEventListener('change', event => {
      selections[i] = event.target.value;
      clearResult();
      [0, 1, 2].forEach(fillLeg);
      validate();
    });
  }
  function renderResult(data) {
    result = data;
    $('result-method').textContent = $('method').selectedOptions[0].textContent;
    $('result-selections').textContent = data.legs.map(leg => `${title(leg.player)} 1+ HR`).join(' + ');
    $('ev-heading').textContent = data.offered_odds === null ? 'EV at your price' : `EV at ${odds(data.offered_odds)}`;
    $('reference-rows').innerHTML = data.references.map(ref => {
      const isAnchor = ['pn', 'circa'].includes(ref.book);
      const legs = ref.legs.map((leg, index) => `<td data-label="Leg ${index + 1} fair">${leg.probability === null ? '\u2014' : `<strong>${esc(odds(leg.fair_odds))}</strong>`}<small>O ${esc(odds(leg.over))} / U ${esc(odds(leg.under))}</small><small>${esc(leg.status === 'available' ? `Updated ${time(leg.updated_at)}` : leg.status)}</small></td>`).join('');
      return `<tr data-book="${esc(ref.book)}" ${!isAnchor && !ref.complete ? 'data-unavailable="true" hidden' : ''} class="${isAnchor ? 'anchor ' : ''}${ref.complete ? '' : 'unavailable'}"><td><strong>${esc(ref.name)}</strong>${isAnchor ? '<small>Reference only</small>' : ''}${ref.same_as_betting_book ? '<small>Your betting book; not an independent comparison</small>' : ''}</td>${legs}<td data-label="Fair parlay odds"><strong class="${ref.complete ? 'fair-total' : ''}">${esc(odds(ref.fair_odds))}</strong><small>${ref.complete ? `Raw product ${esc(odds(ref.raw_product_odds))}` : 'Needs all three fresh O/U pairs'}</small></td><td data-label="Hit chance">${ref.complete ? esc(pct(ref.probability)) : '\u2014'}</td><td data-label="EV at ${esc(odds(data.offered_odds))}" class="${ref.ev === null ? '' : ref.ev > 0 ? 'positive' : 'negative'}">${ref.ev === null ? '\u2014' : `${ref.ev > 0 ? '+' : ''}${ref.ev.toFixed(1)}%`}</td></tr>`;
    }).join('');
    const unavailable = $('reference-rows').querySelectorAll('[data-unavailable]').length;
    $('show-unavailable').hidden = unavailable === 0;
    $('show-unavailable').setAttribute('aria-expanded', 'false');
    $('show-unavailable').textContent = `Show ${unavailable} unavailable books`;
    const complete = data.references.filter(ref => ref.complete).length;
    $('result-status').textContent = `${complete} reference book${complete === 1 ? '' : 's'} can price all three legs. ${complete ? 'Raw product multiplies standalone odds; it is not a confirmed sportsbook parlay quote.' : 'Choose other players or refresh when the missing markets update.'}`;
    $('results').hidden = false;
  }
  function accessDenied() {
    catalog = null;
    selections.fill('');
    clearResult();
    $('calculator').hidden = true;
    $('access-panel').hidden = false;
    $('updated').textContent = 'Analyst or Sharp membership';
    notice('request-status', '');
  }
  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...options,
      headers: { ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}), ...options.headers } });
    const data = await response.json();
    if ([401, 403].includes(response.status)) return { denied: true };
    if (!response.ok) throw new Error(data.error || 'Unable to load homer prices. Try refreshing.');
    return { data };
  }
  async function calculate() {
    if (!validate()) return;
    clearResult();
    const version = inputVersion, auth = authVersion;
    const value = $('offered-odds').value.trim();
    if (value && (!/^[+-]?\d+(?:\.\d+)?$/.test(value) || Math.abs(Number(value)) < 100 || Math.abs(Number(value)) > 10000000)) {
      notice('selection-status', 'Enter valid American parlay odds, such as +5000.');
      return;
    }
    const controller = new AbortController();
    quoteController = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    quoteBusy = true;
    validate();
    $('calculate').textContent = 'Calculating...';
    try {
      const response = await request('/api/parlays', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          legs: selections, method: $('method').value, betting_book: $('betting-book').value || null,
          offered_odds: value ? Number(value) : null,
        }) });
      if (version !== inputVersion || auth !== authVersion) return;
      if (response.denied) return accessDenied();
      renderResult(response.data);
      notice('request-status', '');
    } catch (error) {
      if (version === inputVersion && auth === authVersion) notice('request-status', error.name === 'AbortError' ? 'Calculation timed out. Try again.' : error.message);
    } finally {
      clearTimeout(timer);
      if (quoteController === controller) {
        quoteController = null;
        quoteBusy = false;
        $('calculate').textContent = 'Calculate fair odds';
        validate();
      }
    }
  }
  function refresh() {
    if (refreshWork) return refreshWork;
    const auth = authVersion;
    $('refresh').disabled = true;
    refreshWork = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await request('/api/parlays', { signal: controller.signal });
        if (auth !== authVersion) return;
        if (response.denied) return accessDenied();
        const data = response.data;
        if (!Array.isArray(data.legs) || !data.books) throw new Error('Homer prices are unavailable. Try refreshing.');
        const recalculate = Boolean(result);
        clearResult();
        catalog = data;
        let removed = false;
        selections.forEach((id, i) => { if (id && !data.legs.some(leg => leg.id === id)) { selections[i] = ''; removed = true; } });
        const book = $('betting-book').value;
        $('betting-book').replaceChildren(new Option('No book selected', ''));
        for (const [id, name] of Object.entries(data.books)) if (!['circa', 'pn'].includes(id)) $('betting-book').add(new Option(name, id));
        $('betting-book').value = book;
        [0, 1, 2].forEach(fillLeg);
        $('slate-date').textContent = new Date(`${data.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        $('updated').textContent = `Checked ${time(data.generated_at)}`;
        $('empty-slate').hidden = data.legs.length !== 0;
        $('access-panel').hidden = true;
        $('calculator').hidden = false;
        notice('request-status', removed ? 'A selected player is no longer available. Choose a replacement.' : '');
        if (validate() && recalculate) await calculate();
      } catch (error) {
        if (auth !== authVersion) return;
        clearResult();
        validate();
        notice('request-status', error.name === 'AbortError' ? 'Price refresh timed out. Try again.' : error.message);
      } finally {
        clearTimeout(timer);
        $('refresh').disabled = false;
        refreshWork = null;
      }
    })();
    return refreshWork;
  }
  $('parlay-form').addEventListener('submit', event => { event.preventDefault(); calculate(); });
  $('show-unavailable').addEventListener('click', () => {
    const show = $('show-unavailable').getAttribute('aria-expanded') !== 'true';
    const rows = $('reference-rows').querySelectorAll('[data-unavailable]');
    rows.forEach(row => { row.hidden = !show; });
    $('show-unavailable').setAttribute('aria-expanded', String(show));
    $('show-unavailable').textContent = `${show ? 'Hide' : 'Show'} ${rows.length} unavailable books`;
  });
  $('refresh').addEventListener('click', refresh);
  $('clear').addEventListener('click', () => {
    selections.fill('');
    clearResult();
    [0, 1, 2].forEach(i => { $(`search-${i}`).value = ''; fillLeg(i); });
    validate();
  });
  ['method', 'betting-book', 'offered-odds'].forEach(id => $(id).addEventListener(id === 'offered-odds' ? 'input' : 'change', () => { clearResult(); validate(); }));
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  async function sessionChanged(session) {
    const token = session?.access_token || '';
    if (token === ACCESS_TOKEN) return;
    ACCESS_TOKEN = token;
    authVersion++;
    catalog = null;
    selections.fill('');
    clearResult();
    $('calculator').hidden = true;
    $('account-link').textContent = token ? 'My account' : 'Sign in';
    if (refreshWork) await refreshWork;
    refresh();
  }
  async function boot() {
    try {
      if (!SB) throw new Error();
      const { data, error } = await SB.auth.getSession();
      if (error) throw error;
      ACCESS_TOKEN = data.session?.access_token || '';
      $('account-link').textContent = ACCESS_TOKEN ? 'My account' : 'Sign in';
      SB.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => sessionChanged(session)); });
      await refresh();
    } catch (_) { notice('request-status', 'Sign-in service unavailable. Reload to try again.'); }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 30000);
  setInterval(() => {
    if (!result) return;
    const expired = result.references.some(ref => ref.complete && ref.legs.some(leg => Date.now() - Date.parse(leg.updated_at) > result.max_age_minutes * 60000));
    if (expired || selectionError()) {
      clearResult();
      validate();
      notice('request-status', 'Prices or game availability changed. Refresh to recalculate.');
    }
  }, 10000);
  window.refreshParlays = refresh;
  boot();
})();
