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
  const selections = ['', '', '', ''];
  const sort = { key: 'average', direction: 'asc' };
  let catalog = null, result = null, refreshWork = null, quoteController = null, calculateTimer = null;
  let authVersion = 0, inputVersion = 0, quoteBusy = false;
  const notice = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
  const legSlots = () => selections.map(id => catalog?.legs.find(leg => leg.id === id));
  const selectedLegs = () => legSlots().filter(Boolean);
  function cancelCalculation() {
    inputVersion++;
    clearTimeout(calculateTimer);
    quoteController?.abort();
    quoteController = null;
    quoteBusy = false;
    $('calculate').textContent = 'Recalculate';
    $('results').removeAttribute('aria-busy');
  }
  function clearResult() {
    cancelCalculation();
    result = null;
    $('results').hidden = true;
    $('reference-rows').replaceChildren();
    $('price-rows').replaceChildren();
  }
  function selectionError() {
    const legs = selectedLegs();
    if (new Set(legs.map(leg => leg.player)).size !== legs.length) return 'Choose different players for every leg.';
    if (new Set(legs.map(leg => matchup(leg.game))).size !== legs.length) return 'Choose players from separate matchups. Same-game and doubleheader combinations are not supported.';
    if (legs.some(leg => Date.parse(leg.start) <= Date.now())) return 'A selected game has started. Refresh and choose another player.';
    return '';
  }
  function validate() {
    const error = selectionError();
    const count = selectedLegs().length;
    const ready = Boolean(catalog) && [2, 3, 4].includes(count) && count === selections.filter(Boolean).length && !error;
    notice('selection-status', error);
    $('calculate').disabled = quoteBusy || !ready;
    if (!quoteBusy && !result) $('calculation-status').textContent = count < 2 ? `Choose ${2 - count} more player${count === 1 ? '' : 's'} to calculate automatically.` : 'Prices calculate automatically.';
    return ready;
  }
  function scheduleCalculation(delay = 0) {
    cancelCalculation();
    if (validate()) {
      markUpdating();
      calculateTimer = setTimeout(calculate, delay);
    } else {
      clearResult();
      validate();
    }
  }
  function markUpdating() {
    $('calculation-status').textContent = 'Updating parlay prices...';
    if (result) {
      $('results').setAttribute('aria-busy', 'true');
      $('price-count').textContent = 'Updating prices...';
    }
  }
  function rememberScroll() {
    const x = window.scrollX, y = window.scrollY;
    const tables = [...document.querySelectorAll('.catalog-wrap, .table-wrap')].map(element => ({ element, left: element.scrollLeft, top: element.scrollTop }));
    return () => {
      tables.forEach(({ element, left, top }) => { element.scrollLeft = left; element.scrollTop = top; });
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' });
    };
  }
  const referenceBooks = new Set(['circa', 'pn']);
  const validPrice = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 100;
  const decimal = value => Number(value) > 0 ? 1 + Number(value) / 100 : 1 + 100 / -Number(value);
  const bookLabel = book => ({ circa: 'CIRCA', pn: 'PN', b365: 'B365' })[book] || book.toUpperCase();
  function bookLogo(book) {
    const asset = ({ hr_az: 'hr', hr_oh: 'hr', kambi: 'parx' })[book] || book;
    return /^[a-z0-9_]+$/.test(asset) ? `<img class="parlay-book-logo" src="logos/${asset}.png" width="16" height="16" alt="">` : '';
  }
  function priceStatus(quote, maxAge = catalog?.max_age_minutes ?? 10) {
    if (!quote) return 'No price';
    const age = (Date.now() - Date.parse(quote.updated_at)) / 60000;
    if (!Number.isFinite(age)) return 'Unknown update time';
    if (age > maxAge) return 'Stale prices';
    if (age < -1) return 'Update time is in the future';
    return quote.status || 'No price';
  }
  function currentOver(quote, maxAge) {
    return validPrice(quote?.over) && ['available', 'Missing under price'].includes(priceStatus(quote, maxAge)) ? Number(quote.over) : null;
  }
  function parlayPrices(data) {
    if (Array.isArray(data.prices)) return data.prices;
    // Older API responses still include every book's leg quotes, including over-only markets.
    return (data.references || []).flatMap(ref => {
      if (referenceBooks.has(ref.book) || ref.legs?.length !== data.legs.length) return [];
      const legs = data.legs.map(leg => ref.legs.find(quote => quote.id === leg.id));
      const overs = legs.map(leg => currentOver(leg, data.max_age_minutes));
      if (overs.some(over => over === null)) return [];
      const combined = overs.reduce((product, over) => product * decimal(over), 1);
      return [{ book: ref.book, name: ref.name, decimal: combined,
        odds: combined >= 2 ? (combined - 1) * 100 : -100 / (combined - 1),
        legs: legs.map((leg, index) => ({ id: leg.id, player: leg.player, over: overs[index], updated_at: leg.updated_at })) }];
    }).sort((a, b) => b.decimal - a.decimal || a.name.localeCompare(b.name));
  }
  function averageOver(leg, books) {
    const prices = books.map(book => currentOver(leg.quotes?.[book])).filter(price => price !== null);
    return prices.length ? prices.reduce((sum, price) => sum + decimal(price), 0) / prices.length : null;
  }
  function bestOffer(leg) {
    return Object.entries(leg.quotes || {}).reduce((best, [book, quote]) => {
      const price = currentOver(quote);
      return !referenceBooks.has(book) && price !== null && (!best || decimal(price) > decimal(best.price)) ? { book, price } : best;
    }, null);
  }
  function catalogBooks() {
    const keys = ['circa', 'pn', 'fd', 'dk', 'b365', ...Object.keys(catalog?.books || {})];
    return [...new Set(keys)].filter(book => Object.hasOwn(catalog?.books || {}, book)
      && (referenceBooks.has(book) || catalog.legs.some(leg => validPrice(leg.quotes?.[book]?.over))));
  }
  function disabledReason(leg) {
    if (selections.includes(leg.id)) return '';
    if (Date.parse(leg.start) <= Date.now()) return 'Game has started';
    const others = selectedLegs().filter(Boolean);
    if (others.some(other => other.player === leg.player)) return 'Player already selected';
    if (others.some(other => matchup(other.game) === matchup(leg.game))) return 'Matchup already selected';
    return selections.every(Boolean) ? 'Four legs selected; remove one to change it' : '';
  }
  function renderLegs() {
    $('selection-count').textContent = `${selections.filter(Boolean).length} / 4 selected`;
    $('leg-inputs').innerHTML = legSlots().map((leg, index) => {
      const book = $('betting-book').value;
      const price = leg && book ? currentOver(leg.quotes?.[book]) : null;
      const offer = leg ? (book ? (price === null ? null : { book, price }) : bestOffer(leg)) : null;
      return `<div class="leg-card${leg ? ' is-filled' : ''}"><span class="leg-number" aria-hidden="true">${index + 1}</span>
        <div class="leg-copy"><strong>${leg ? esc(title(leg.player)) : `Leg ${index + 1}${index >= 2 ? ' (optional)' : ''}`}</strong>
        <small>${leg ? `${esc(leg.game.toUpperCase())} / ${esc(time(leg.start))}` : index >= 2 ? `Add a ${index === 2 ? 'third' : 'fourth'} player anytime` : 'Add a player from the table'}</small>
        ${leg ? `<span class="leg-price">${offer ? `${bookLogo(offer.book)}<span>${esc(odds(offer.price))} <small>1+ HR${book ? '' : ' / best price'}</small></span>` : `No current ${esc(book ? catalog.books[book] : 'book')} price`}</span>` : ''}</div>
        ${leg ? `<button type="button" class="remove-leg" data-remove="${index}" aria-label="Remove ${esc(title(leg.player))}">&times;</button>` : ''}</div>`;
    }).join('');
  }
  function renderCatalogHead(books) {
    const heading = (key, label, name) => `<th scope="col" data-key="${esc(key)}" aria-sort="${sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}"><button type="button" data-sort="${esc(key)}" title="Sort by ${esc(name)}">${label}<span class="sort-arrow" aria-hidden="true">${sort.key === key ? sort.direction === 'asc' ? '&#9650;' : '&#9660;' : '&#8597;'}</span></button></th>`;
    $('catalog-head').innerHTML = `<tr><th scope="col" class="catalog-pick">Pick</th>${heading('player', 'Player / Game', 'player')}${heading('average', 'Avg', 'average current homer odds (lowest = most likely)')}${books.map(book => heading(`book:${book}`, `${bookLogo(book)}${esc(bookLabel(book))}`, `${catalog.books[book]} homer price`)).join('')}</tr>`;
  }
  function renderCatalog() {
    const restoreScroll = rememberScroll();
    const books = catalogBooks();
    if (sort.key.startsWith('book:') && !books.includes(sort.key.slice(5))) { sort.key = 'average'; sort.direction = 'asc'; }
    renderCatalogHead(books);
    const search = $('player-search').value.trim().toLowerCase(), game = $('game-filter').value;
    const legs = (catalog?.legs || []).filter(leg => (!game || leg.game === game) && `${leg.player} ${leg.game} ${leg.team || ''}`.toLowerCase().includes(search));
    const averages = new Map(legs.map(leg => [leg.id, averageOver(leg, books)]));
    legs.sort((a, b) => {
      let order;
      if (sort.key === 'player') order = a.player.localeCompare(b.player);
      else {
        const value = leg => {
          if (sort.key === 'average') return averages.get(leg.id);
          const price = currentOver(leg.quotes?.[sort.key.slice(5)]);
          return price === null ? null : decimal(price);
        };
        const first = value(a), second = value(b);
        if (first === null || second === null) return first === second ? a.player.localeCompare(b.player) : first === null ? 1 : -1;
        order = first - second;
      }
      return (sort.direction === 'asc' ? order : -order) || a.player.localeCompare(b.player);
    });
    $('catalog-count').textContent = `${legs.length} of ${catalog?.legs.length || 0} players`;
    $('catalog-rows').innerHTML = legs.map(leg => {
      const selected = selections.indexOf(leg.id), reason = disabledReason(leg), best = bestOffer(leg);
      const average = averages.get(leg.id);
      const averagePrice = average === null ? '-' : odds(average >= 2 ? (average - 1) * 100 : -100 / (average - 1));
      const action = selected >= 0 ? 'Remove' : 'Add';
      const prices = books.map(book => {
        const quote = leg.quotes?.[book], status = priceStatus(quote), over = currentOver(quote);
        const fresh = ['available', 'Missing under price', 'Missing over price'].includes(status);
        const highest = over !== null && best && !referenceBooks.has(book) && decimal(over) === decimal(best.price);
        const label = `${catalog.books[book]}: ${status === 'available' ? `Updated ${time(quote.updated_at)}` : status}`;
        return `<td class="catalog-price${highest ? ' best-price' : ''}" title="${esc(label)}">${fresh
          ? `<strong>${validPrice(quote.over) ? esc(odds(quote.over)) : '-'}</strong><small>${validPrice(quote.under) ? esc(odds(quote.under)) : '-'}</small>`
          : `<span class="price-unavailable">${status === 'Stale prices' ? 'Stale' : validPrice(quote?.over) ? 'Unavailable' : '-'}</span>`}</td>`;
      }).join('');
      return `<tr data-leg-row="${esc(leg.id)}" class="${selected >= 0 ? 'is-selected' : reason ? 'is-blocked' : ''}">
        <td class="catalog-pick"><button type="button" data-leg="${esc(leg.id)}" aria-label="${action} ${esc(title(leg.player))}${reason ? `: ${esc(reason)}` : ''}" aria-pressed="${selected >= 0}" ${reason ? 'disabled' : ''} title="${esc(reason || `${action} this player`)}">${selected >= 0 ? `&#10003; ${selected + 1}` : reason ? selections.every(Boolean) ? 'Full' : 'N/A' : '+ Add'}</button></td>
        <th scope="row" class="catalog-player"><strong>${esc(title(leg.player))}</strong><small>${esc(leg.game.toUpperCase())} <span>${esc(time(leg.start))}</span></small></th><td class="catalog-average" title="Average current 1+ HR price across books">${esc(averagePrice)}</td>${prices}</tr>`;
    }).join('') || `<tr><td class="catalog-empty" colspan="${books.length + 3}">${catalog?.legs.length ? 'No players match. Try another player or game.' : 'No upcoming players available.'}</td></tr>`;
    restoreScroll();
  }
  function renderSelections() { renderLegs(); renderCatalog(); validate(); }
  function toggleLeg(id) {
    const index = selections.indexOf(id), leg = catalog?.legs.find(item => item.id === id);
    if (!leg || (index < 0 && disabledReason(leg))) return;
    selections[index >= 0 ? index : selections.indexOf('')] = index >= 0 ? '' : id;
    renderSelections();
    scheduleCalculation();
  }
  $('catalog-rows').addEventListener('click', event => {
    const button = event.target.closest('button[data-leg]');
    if (!button) return;
    const id = button.dataset.leg;
    toggleLeg(id);
    $('catalog-rows').querySelector(`[data-leg="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  });
  $('leg-inputs').addEventListener('click', event => {
    const button = event.target.closest('button[data-remove]');
    if (!button) return;
    const id = selections[Number(button.dataset.remove)];
    toggleLeg(id);
    const add = $('catalog-rows').querySelector(`[data-leg="${CSS.escape(id)}"]`);
    (add || $('player-search')).focus({ preventScroll: true });
  });
  $('catalog-head').addEventListener('click', event => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    sort.direction = sort.key === key ? sort.direction === 'asc' ? 'desc' : 'asc' : key.startsWith('book:') ? 'desc' : 'asc';
    sort.key = key;
    renderCatalog();
    $('catalog-head').querySelector(`[data-sort="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  $('player-search').addEventListener('input', renderCatalog);
  $('game-filter').addEventListener('change', renderCatalog);
  renderLegs();
  function renderResult(data) {
    const restoreScroll = rememberScroll();
    const showUnavailable = $('show-unavailable').getAttribute('aria-expanded') === 'true';
    const prices = parlayPrices(data);
    result = { ...data, prices };
    const count = data.legs.length;
    const best = prices[0];
    const benchmarks = ['circa', 'pn'].map(book => {
      const ref = data.references.find(ref => ref.book === book);
      const probability = ref?.complete && Number.isFinite(ref.probability) && ref.probability > 0 && ref.probability < 1 ? ref.probability : null;
      return { book, name: book === 'pn' ? 'Pinnacle' : 'Circa', probability,
        fairOdds: probability === null ? null : ref.fair_odds };
    });
    $('best-parlay-price').innerHTML = best ? `${esc(odds(best.odds))} <span>${prices.filter(price => price.decimal === best.decimal).map(price => `${bookLogo(price.book)} ${esc(price.name)}`).join(' / ')}</span>` : 'No complete book prices';
    $('price-count').textContent = `${count} legs / ${prices.length} book${prices.length === 1 ? '' : 's'}`;
    $('price-head').innerHTML = `<tr><th scope="col">Book</th><th scope="col">Est. parlay odds</th>${benchmarks.map(ref => `<th scope="col" data-ev-reference="${ref.book}"><span class="book-name">${bookLogo(ref.book)}${ref.name} EV</span><small>Fair ${ref.probability === null ? '-' : esc(odds(ref.fairOdds))}</small></th>`).join('')}${data.legs.map(leg => `<th scope="col">${esc(title(leg.player))}</th>`).join('')}</tr>`;
    $('price-rows').innerHTML = prices.map(price => `<tr data-price-book="${esc(price.book)}" class="${price.decimal === best.decimal ? 'best-parlay' : ''}">
      <th scope="row"><span class="book-name">${bookLogo(price.book)}${esc(price.name)}</span>${price.decimal === best.decimal ? '<small class="best-label">Best price</small>' : ''}</th>
      <td class="parlay-total"><strong>${esc(odds(price.odds))}</strong></td>
      ${benchmarks.map(ref => {
        const ev = ref.probability !== null && Number.isFinite(price.decimal) && price.decimal > 1 ? 100 * (ref.probability * price.decimal - 1) : null;
        const display = ev === null ? null : Number(ev.toFixed(1));
        return `<td data-ev-book="${ref.book}" class="parlay-ev${display > 0 ? ' positive' : display < 0 ? ' negative' : ''}" title="${esc(ref.probability === null ? `${ref.name} needs current over/under prices for every leg` : `EV at ${odds(price.odds)} against ${ref.name} fair odds of ${odds(ref.fairOdds)}`)}">${display === null ? '-' : `${display > 0 ? '+' : ''}${display.toFixed(1)}%`}</td>`;
      }).join('')}
      ${price.legs.map(leg => `<td title="Updated ${esc(time(leg.updated_at))}">${esc(odds(leg.over))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${count + 4}">No book has current homer prices for every selected leg. Try another player or refresh prices.</td></tr>`;
    $('result-method').textContent = $('method').selectedOptions[0].textContent;
    $('result-selections').textContent = data.legs.map(leg => `${title(leg.player)} 1+ HR`).join(' + ');
    const evLabel = data.offered_odds === null ? 'EV at your price' : `EV at ${odds(data.offered_odds)}`;
    $('reference-head').innerHTML = `<tr><th scope="col">Reference book</th>${data.legs.map((leg, index) => `<th scope="col" title="${esc(title(leg.player))}">Leg ${index + 1} fair</th>`).join('')}<th scope="col">Fair parlay odds</th><th scope="col">Estimated hit chance</th><th scope="col">${esc(evLabel)}</th></tr>`;
    $('reference-rows').classList.toggle('four-legs', count === 4);
    $('reference-rows').classList.toggle('two-legs', count === 2);
    $('reference-rows').innerHTML = data.references.map(ref => {
      const isAnchor = ['pn', 'circa'].includes(ref.book);
      const legs = ref.legs.map((leg, index) => `<td class="reference-leg" data-label="Leg ${index + 1} fair">${leg.probability === null ? '-' : `<strong>${esc(odds(leg.fair_odds))}</strong>`}<small>O ${esc(odds(leg.over))} / U ${esc(odds(leg.under))}</small><small>${esc(leg.status === 'available' ? `Updated ${time(leg.updated_at)}` : leg.status)}</small></td>`).join('');
      return `<tr data-book="${esc(ref.book)}" ${!isAnchor && !ref.complete ? `data-unavailable="true"${showUnavailable ? '' : ' hidden'}` : ''} class="${isAnchor ? 'anchor ' : ''}${ref.complete ? '' : 'unavailable'}"><td><span class="book-name">${bookLogo(ref.book)}<strong>${esc(ref.name)}</strong></span>${isAnchor ? '<small>Reference only</small>' : ''}${ref.same_as_betting_book ? '<small>Your betting book; not an independent comparison</small>' : ''}</td>${legs}<td class="metric-fair" data-label="Fair parlay odds"><strong class="${ref.complete ? 'fair-total' : ''}">${esc(odds(ref.fair_odds))}</strong>${ref.complete ? '' : `<small>Needs all ${count} fresh O/U pairs</small>`}</td><td class="metric-chance" data-label="Hit chance">${ref.complete ? esc(pct(ref.probability)) : '-'}</td><td data-label="${esc(evLabel)}" class="metric-ev ${ref.ev === null ? '' : ref.ev > 0 ? 'positive' : 'negative'}">${ref.ev === null ? '-' : `${ref.ev > 0 ? '+' : ''}${ref.ev.toFixed(1)}%`}</td></tr>`;
    }).join('');
    const unavailable = $('reference-rows').querySelectorAll('[data-unavailable]').length;
    $('show-unavailable').hidden = unavailable === 0;
    $('show-unavailable').setAttribute('aria-expanded', String(showUnavailable));
    $('show-unavailable').textContent = `${showUnavailable ? 'Hide' : 'Show'} ${unavailable} unavailable books`;
    const complete = data.references.filter(ref => ref.complete).length;
    $('result-status').textContent = `${complete} reference book${complete === 1 ? '' : 's'} can devig all ${count} legs.${complete ? '' : ' Fair odds need current over and under prices for every leg.'}`;
    $('calculation-status').textContent = `${count}-leg parlay updated automatically.`;
    $('results').hidden = false;
    $('results').removeAttribute('aria-busy');
    restoreScroll();
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
    cancelCalculation();
    const version = inputVersion, auth = authVersion;
    const value = $('offered-odds').value.trim();
    if (value && (!/^[+-]?\d+(?:\.\d+)?$/.test(value) || Math.abs(Number(value)) < 100 || Math.abs(Number(value)) > 10000000)) {
      clearResult();
      notice('selection-status', 'Enter valid American parlay odds, such as +5000.');
      return;
    }
    const controller = new AbortController();
    quoteController = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    quoteBusy = true;
    validate();
    $('calculate').textContent = 'Calculating...';
    markUpdating();
    try {
      const response = await request('/api/parlays', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          legs: selections.filter(Boolean), method: $('method').value, betting_book: $('betting-book').value || null,
          offered_odds: value ? Number(value) : null,
        }) });
      if (version !== inputVersion || auth !== authVersion) return;
      if (response.denied) return accessDenied();
      renderResult(response.data);
      notice('request-status', '');
    } catch (error) {
      if (version === inputVersion && auth === authVersion) {
        clearResult();
        validate();
        notice('request-status', error.name === 'AbortError' ? 'Calculation timed out. Try again.' : error.message);
      }
    } finally {
      clearTimeout(timer);
      if (quoteController === controller) {
        quoteController = null;
        quoteBusy = false;
        $('calculate').textContent = 'Recalculate';
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
        cancelCalculation();
        catalog = data;
        let removed = false;
        selections.forEach((id, i) => { if (id && !data.legs.some(leg => leg.id === id)) { selections[i] = ''; removed = true; } });
        const book = $('betting-book').value;
        $('betting-book').replaceChildren(new Option('No book selected', ''));
        for (const [id, name] of Object.entries(data.books)) if (!['circa', 'pn'].includes(id)) $('betting-book').add(new Option(name, id));
        $('betting-book').value = book;
        const game = $('game-filter').value;
        $('game-filter').replaceChildren(new Option('All games', ''));
        [...new Set(data.legs.map(leg => leg.game))].sort().forEach(game => $('game-filter').add(new Option(game.toUpperCase(), game)));
        if ([...$('game-filter').options].some(option => option.value === game)) $('game-filter').value = game;
        renderSelections();
        $('slate-date').textContent = new Date(`${data.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        $('updated').textContent = `Checked ${time(data.generated_at)}`;
        $('empty-slate').hidden = data.legs.length !== 0;
        $('access-panel').hidden = true;
        $('calculator').hidden = false;
        notice('request-status', removed ? 'A selected player is no longer available. Choose a replacement.' : '');
        if (validate()) await calculate();
        else { clearResult(); validate(); }
        if (removed && result) notice('request-status', 'A selected player is no longer available. Review the remaining legs or choose a replacement.');
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
    renderSelections();
  });
  ['method', 'betting-book', 'offered-odds'].forEach(id => $(id).addEventListener(id === 'offered-odds' ? 'input' : 'change', () => { renderLegs(); scheduleCalculation(id === 'offered-odds' ? 300 : 0); }));
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
    const expired = [...result.references.filter(ref => ref.complete), ...(result.prices || [])].some(ref => ref.legs.some(leg => Date.now() - Date.parse(leg.updated_at) > result.max_age_minutes * 60000));
    if (expired || selectionError()) {
      clearResult();
      validate();
      notice('request-status', 'Prices or game availability changed. Refresh to recalculate.');
    }
  }, 10000);
  window.refreshParlays = refresh;
  boot();
})();
