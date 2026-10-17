(() => {
  'use strict';
  PAGE = 'parlays';
  const markets = {
    hr: { sport: 'mlb', name: 'homer', label: '1+ HR', under: 'no HR', unit: 'home run' },
    attd: { sport: 'nfl', name: 'ATTD', label: 'ATTD', under: 'no touchdown', unit: 'touchdown' },
    atgs: { sport: 'nhl', name: 'ATGS', label: '1+ Goal', under: 'no goal', unit: 'goal' },
  };
  const requestedMarket = new URLSearchParams(window.location.search).get('market');
  let market = Object.hasOwn(markets, requestedMarket) ? requestedMarket : 'hr';
  const currentMarket = () => markets[market];
  SPORT = currentMarket().sport;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const title = v => String(v).replace(/\b\w/g, c => c.toUpperCase());
  const odds = v => v === null || !Number.isFinite(Number(v)) ? '\u2014' : `${v >= 0 ? '+' : '-'}${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  const pct = v => `${(v * 100).toFixed(3)}%`;
  const time = v => v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Unknown';
  const gameTime = v => market !== 'hr' && v ? new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ' / ' + time(v) : time(v);
  const matchup = game => game.split(' @ ').map(t => t.replace(/-gm\d+$/, '')).sort().join('|');
  const selections = ['', '', '', ''];
  const sort = { key: 'ev', direction: 'desc' };
  let catalog = null, result = null, refreshWork = null, refreshController = null, quoteController = null, calculateTimer = null;
  let authVersion = 0, inputVersion = 0, marketVersion = 0, quoteBusy = false, sessionReady = false;
  const notice = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
  const legSlots = () => selections.map(id => catalog?.legs.find(leg => leg.id === id));
  const selectedLegs = () => legSlots().filter(Boolean);
  function renderMarket() {
    const config = currentMarket();
    SPORT = config.sport;
    document.title = `${market === 'hr' ? 'Homer' : market.toUpperCase()} parlay calculator | +EV Sharps`;
    $('parlay-market').value = market;
    $('market-title').textContent = `Build your ${config.name} parlay`;
    $('market-eyebrow').textContent = `${config.sport.toUpperCase()} / FAIR ODDS`;
    renderPickerHelp();
    $('empty-slate').textContent = `No upcoming ${config.name} markets are available${market === 'hr' ? ' for today' : ''}. Refresh when the next slate is posted.`;
    $('catalog-wrap').setAttribute('aria-label', `Choose ${config.name} parlay players and compare prices`);
    $('catalog-caption').textContent = `${config.name} players and sportsbook over/under prices`;
    $('price-caption').textContent = `Estimated parlay prices from each book's current ${config.name} odds`;
    $('reference-caption').textContent = `Devigged ${config.name} parlay prices`;
    $('fair-methodology').textContent = `For fair odds, we remove the margin from each player's over/under 0.5 ${config.unit} market, multiply the fair probabilities, then convert the result to American odds. The calculations use full precision before rounding the display.`;
    $('independence-methodology').textContent = `These estimates assume independent outcomes across different matchups. ${market === 'hr' ? 'Same-game and doubleheader combinations' : 'Same-game combinations'} are excluded. Fair odds are not offered parlay prices. Actual eligibility, starting-player requirements and void rules depend on the sportsbook.`;
    $('slate-date').textContent = market !== 'hr' ? `Upcoming ${config.sport.toUpperCase()} games` : "Today's slate";
  }
  function matchesMarket(data, requestedMarket) {
    const config = markets[requestedMarket];
    return data && (data.market === requestedMarket || (requestedMarket === 'hr' && data.market === undefined))
      && (data.sport === undefined || data.sport === config.sport);
  }
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
    $('parlay-book-prices').replaceChildren();
  }
  function selectionError() {
    const legs = selectedLegs();
    if (new Set(legs.map(leg => leg.player)).size !== legs.length) return 'Choose different players for every leg.';
    if (new Set(legs.map(leg => matchup(leg.game))).size !== legs.length) return `Choose players from separate matchups. ${market === 'hr' ? 'Same-game and doubleheader combinations' : 'Same-game combinations'} are not supported.`;
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
  const nonBettingBooks = new Set(['circa', 'pn']);
  const referenceStorageKey = 'ev_parlay_reference_books_v1';
  const defaultReferenceBooks = ['circa', 'pn'];
  let fairValueBooks = new Set(defaultReferenceBooks);
  try {
    const saved = JSON.parse(localStorage.getItem(referenceStorageKey));
    if (Array.isArray(saved) && saved.every(book => typeof book === 'string' && /^[a-z][a-z0-9_]*$/.test(book))) fairValueBooks = new Set(saved);
  } catch (_) { /* Storage may be unavailable in private browsing. */ }
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
    const highestFirst = (a, b) => b.decimal - a.decimal || a.name.localeCompare(b.name);
    if (Array.isArray(data.prices)) return [...data.prices].sort(highestFirst);
    // Older API responses still include every book's leg quotes, including over-only markets.
    return (data.references || []).flatMap(ref => {
      if (nonBettingBooks.has(ref.book) || ref.legs?.length !== data.legs.length) return [];
      const legs = data.legs.map(leg => ref.legs.find(quote => quote.id === leg.id));
      const overs = legs.map(leg => currentOver(leg, data.max_age_minutes));
      if (overs.some(over => over === null)) return [];
      const combined = overs.reduce((product, over) => product * decimal(over), 1);
      return [{ book: ref.book, name: ref.name, decimal: combined,
        odds: combined >= 2 ? (combined - 1) * 100 : -100 / (combined - 1),
        legs: legs.map((leg, index) => ({ id: leg.id, player: leg.player, over: overs[index], updated_at: leg.updated_at })) }];
    }).sort(highestFirst);
  }
  function averageOver(leg, books) {
    const prices = books.map(book => currentOver(leg.quotes?.[book])).filter(price => price !== null);
    return prices.length ? prices.reduce((sum, price) => sum + decimal(price), 0) / prices.length : null;
  }
  function bestOffer(leg) {
    return Object.entries(leg.quotes || {}).reduce((best, [book, quote]) => {
      const price = currentOver(quote);
      return !nonBettingBooks.has(book) && price !== null && (!best || decimal(price) > decimal(best.price)) ? { book, price } : best;
    }, null);
  }
  function catalogBooks() {
    const keys = ['circa', 'pn', 'fd', 'dk', 'b365', ...Object.keys(catalog?.books || {})];
    return [...new Set(keys)].filter(book => Object.hasOwn(catalog?.books || {}, book));
  }
  const referenceName = book => catalog?.books[book] || bookLabel(book);
  const selectedReferences = () => [...new Set([...catalogBooks(), ...fairValueBooks])].filter(book => fairValueBooks.has(book));
  function legReference(leg, book) {
    const quote = leg.quotes?.[book], probability = leg.fair_probabilities?.[book]?.[$('method').value];
    return priceStatus(quote) === 'available' && validPrice(quote.over) && validPrice(quote.under)
      && Number.isFinite(probability) && probability > 0 && probability < 1 ? { book, probability } : null;
  }
  function renderReferenceSummary() {
    const books = selectedReferences(), names = books.map(referenceName);
    $('fair-books-summary').textContent = books.length > 2 ? `${books.length} books` : names.join(' + ') || 'None selected';
    $('fair-books-summary').setAttribute('aria-label', `Fair value books: ${names.join(', ') || 'none selected'}`);
    $('fair-books-summary').title = names.join(', ') || 'Select books to calculate fair value';
  }
  function renderReferenceBooks() {
    const focused = document.activeElement?.dataset.referenceBook;
    const books = [...new Set([...catalogBooks(), ...fairValueBooks])];
    $('fair-books-options').innerHTML = books.map(book => {
      const count = (catalog?.legs || []).filter(leg => Date.parse(leg.start) > Date.now() && legReference(leg, book)).length;
      return `<label class="fair-book-option"><input type="checkbox" data-reference-book="${esc(book)}"${fairValueBooks.has(book) ? ' checked' : ''}>
        ${bookLogo(book)}<span>${esc(referenceName(book))}<small>${count ? `${count} paired markets` : 'No current pairs'}</small></span></label>`;
    }).join('');
    renderReferenceSummary();
    if (focused) $('fair-books-options').querySelector(`[data-reference-book="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }
  function referencesChanged() {
    try { localStorage.setItem(referenceStorageKey, JSON.stringify([...fairValueBooks])); } catch (_) { /* The selection still works for this visit. */ }
    renderReferenceSummary();
    sort.key = 'ev'; sort.direction = 'desc';
    renderCatalog();
    scheduleCalculation();
  }
  function pickerOffer(leg) {
    if (!Number.isFinite(Date.parse(leg.start)) || Date.parse(leg.start) <= Date.now()) return null;
    const book = $('picker-book').value;
    if (!book) return bestOffer(leg);
    const price = currentOver(leg.quotes?.[book]);
    return nonBettingBooks.has(book) || price === null ? null : { book, price };
  }
  function pickerEstimate(leg) {
    const offer = pickerOffer(leg);
    const references = selectedReferences().map(book => legReference(leg, book)).filter(Boolean);
    const probability = references.length ? Math.min(...references.map(ref => ref.probability)) : null;
    return { offer, references, probability, ev: offer && probability !== null ? 100 * (probability * decimal(offer.price) - 1) : null };
  }
  function renderPickerBooks() {
    const selected = $('picker-book').value;
    $('picker-book').replaceChildren(new Option('All books — best available price', ''));
    if (!catalog) return;
    for (const [book, name] of Object.entries(catalog.books)) {
      if (nonBettingBooks.has(book)) continue;
      const count = catalog.legs.filter(leg => Date.parse(leg.start) > Date.now() && currentOver(leg.quotes?.[book]) !== null).length;
      if (count || selected === book) $('picker-book').add(new Option(`${name} (${count ? count : 'no current prices'})`, book));
    }
    $('picker-book').value = Object.hasOwn(catalog.books, selected) && !nonBettingBooks.has(selected) ? selected : '';
  }
  function renderPickerHelp() {
    const book = $('picker-book').value, name = book ? catalog?.books[book] || book : 'the best available book';
    const refs = selectedReferences();
    const names = refs.length > 3 ? `${refs.length} selected books` : refs.map(referenceName).join(' + ');
    $('catalog-help').textContent = `Choose two to four players for ${currentMarket().label}. EV uses ${$('method').selectedOptions[0].textContent} at ${name}. ${refs.length ? `Fair value uses the lowest available probability from ${names}. Only fresh over/under pairs count.` : 'Choose fair value books to calculate EV.'} All book columns stay visible. Click EV, Avg or a book to sort.`;
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
        <small>${leg ? `${esc(leg.game.toUpperCase())} / ${esc(gameTime(leg.start))}` : index >= 2 ? `Add a ${index === 2 ? 'third' : 'fourth'} player anytime` : 'Add a player from the table'}</small>
        ${leg ? `<span class="leg-price">${offer ? `${bookLogo(offer.book)}<span>${esc(odds(offer.price))} <small>${currentMarket().label}${book ? '' : ' / best price'}</small></span>` : `No current ${esc(book ? catalog.books[book] : 'book')} price`}</span>` : ''}</div>
        ${leg ? `<button type="button" class="remove-leg" data-remove="${index}" aria-label="Remove ${esc(title(leg.player))}">&times;</button>` : ''}</div>`;
    }).join('');
  }
  function renderCatalogHead(books) {
    const heading = (key, label, name) => `<th scope="col" data-key="${esc(key)}"${key.startsWith('book:') && fairValueBooks.has(key.slice(5)) ? ' class="fair-reference"' : ''} aria-sort="${sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}"><button type="button" data-sort="${esc(key)}" title="Sort by ${esc(name)}${key.startsWith('book:') && fairValueBooks.has(key.slice(5)) ? ' / Used for fair value' : ''}">${label}<span class="sort-arrow" aria-hidden="true">${sort.key === key ? sort.direction === 'asc' ? '&#9650;' : '&#9660;' : '&#8597;'}</span></button></th>`;
    $('catalog-head').innerHTML = `<tr><th scope="col" class="catalog-pick">Pick</th>${heading('player', 'Player / Game', 'player')}${heading('ev', 'EV / Price', 'estimated EV at the selected book')}${heading('average', 'Avg', `average current ${currentMarket().name} odds (lowest = most likely)`)}${books.map(book => heading(`book:${book}`, `${bookLogo(book)}${esc(bookLabel(book))}`, `${catalog.books[book]} ${currentMarket().name} price`)).join('')}</tr>`;
  }
  function renderCatalog() {
    const restoreScroll = rememberScroll();
    const focused = document.activeElement;
    const focusKey = $('catalog-wrap').contains(focused) ? ['sort', 'leg'].find(key => focused.dataset[key]) : null;
    const focusValue = focusKey ? focused.dataset[focusKey] : null;
    const allBooks = catalogBooks(), books = allBooks;
    if (sort.key.startsWith('book:') && !books.includes(sort.key.slice(5))) { sort.key = 'ev'; sort.direction = 'desc'; }
    renderCatalogHead(books);
    renderPickerHelp();
    const search = $('player-search').value.trim().toLowerCase(), game = $('game-filter').value;
    const estimates = new Map((catalog?.legs || []).map(leg => [leg.id, pickerEstimate(leg)]));
    const legs = (catalog?.legs || []).filter(leg => (!game || leg.game === game) && `${leg.player} ${leg.game} ${leg.team || ''}`.toLowerCase().includes(search)
      && estimates.get(leg.id)?.offer);
    const averages = new Map(legs.map(leg => [leg.id, averageOver(leg, allBooks)]));
    legs.sort((a, b) => {
      let order;
      if (sort.key === 'player') order = a.player.localeCompare(b.player);
      else {
        const value = leg => {
          if (sort.key === 'ev') return estimates.get(leg.id)?.ev ?? null;
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
      const estimate = estimates.get(leg.id), ev = estimate?.ev;
      const displayEV = Number.isFinite(ev) ? Number(ev.toFixed(1)) : null;
      const refLabel = estimate?.references.map(ref => bookLabel(ref.book)).join(' + ');
      const evCell = `<td class="catalog-ev${displayEV > 0 ? ' positive' : displayEV < 0 ? ' negative' : ''}" title="${esc(refLabel ? `Reference: ${refLabel}${estimate.references.length > 1 ? ' (lower fair probability)' : ''}${estimate.references.some(ref => ref.book === estimate.offer.book) ? ' / Includes the betting book' : ''}` : 'Needs a fresh over/under pair at a selected fair value book')}">
        <strong>${displayEV === null ? '—' : `${displayEV > 0 ? '+' : ''}${displayEV.toFixed(1)}%`}</strong>
        <small class="ev-offer">${bookLogo(estimate.offer.book)} ${esc(bookLabel(estimate.offer.book))} ${esc(odds(estimate.offer.price))}</small>
        <small class="ev-reference">${refLabel ? `vs ${esc(refLabel)}` : 'No fair estimate'}</small></td>`;
      const action = selected >= 0 ? 'Remove' : 'Add';
      const prices = books.map(book => {
        const quote = leg.quotes?.[book], status = priceStatus(quote), over = currentOver(quote);
        const fresh = ['available', 'Missing under price', 'Missing over price'].includes(status);
        const highest = over !== null && best && !nonBettingBooks.has(book) && decimal(over) === decimal(best.price);
        const label = `${catalog.books[book]}: ${status === 'available' ? `Updated ${time(quote.updated_at)}` : status}`;
        return `<td class="catalog-price${highest ? ' best-price' : ''}" title="${esc(label)}">${fresh
          ? `<strong>${validPrice(quote.over) ? esc(odds(quote.over)) : '-'}</strong><small>${validPrice(quote.under) ? esc(odds(quote.under)) : '-'}</small>`
          : `<span class="price-unavailable">${status === 'Stale prices' ? 'Stale' : validPrice(quote?.over) ? 'Unavailable' : '-'}</span>`}</td>`;
      }).join('');
      return `<tr data-leg-row="${esc(leg.id)}" class="${selected >= 0 ? 'is-selected' : reason ? 'is-blocked' : ''}">
        <td class="catalog-pick"><button type="button" data-leg="${esc(leg.id)}" aria-label="${action} ${esc(title(leg.player))}${reason ? `: ${esc(reason)}` : ''}" aria-pressed="${selected >= 0}" ${reason ? 'disabled' : ''} title="${esc(reason || `${action} this player`)}">${selected >= 0 ? `&#10003; ${selected + 1}` : reason ? selections.every(Boolean) ? 'Full' : 'N/A' : '+ Add'}</button></td>
        <th scope="row" class="catalog-player"><strong>${esc(title(leg.player))}</strong><small>${esc(leg.game.toUpperCase())} <span>${esc(gameTime(leg.start))}</span></small></th>${evCell}<td class="catalog-average" title="Average current ${currentMarket().label} price across books">${esc(averagePrice)}</td>${prices}</tr>`;
    }).join('') || `<tr><td class="catalog-empty" colspan="${books.length + (market === 'atgs' ? 4 : 3)}">${catalog?.legs.length ? `No players match. Try another player, game${market === 'atgs' ? ' or book with current prices' : ''}.` : 'No upcoming players available.'}</td></tr>`;
    if (focusKey) $('catalog-wrap').querySelector(`[data-${focusKey}="${CSS.escape(focusValue)}"]`)?.focus({ preventScroll: true });
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
    sort.direction = sort.key === key ? sort.direction === 'asc' ? 'desc' : 'asc' : key.startsWith('book:') || key === 'ev' ? 'desc' : 'asc';
    sort.key = key;
    renderCatalog();
    $('catalog-head').querySelector(`[data-sort="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  $('player-search').addEventListener('input', renderCatalog);
  $('game-filter').addEventListener('change', renderCatalog);
  $('fair-books-options').addEventListener('change', event => {
    const input = event.target.closest('input[data-reference-book]');
    if (!input) return;
    if (input.checked) fairValueBooks.add(input.dataset.referenceBook);
    else fairValueBooks.delete(input.dataset.referenceBook);
    referencesChanged();
  });
  for (const [id, getBooks] of [
    ['fair-books-all', () => catalogBooks()], ['fair-books-clear', () => []],
    ['fair-books-reset', () => defaultReferenceBooks],
  ]) $(id).addEventListener('click', () => {
    fairValueBooks = new Set(getBooks());
    renderReferenceBooks();
    referencesChanged();
  });
  document.addEventListener('click', event => {
    if (!$('fair-books-picker').contains(event.target)) $('fair-books-picker').open = false;
  });
  $('fair-books-picker').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      $('fair-books-picker').open = false;
      $('fair-books-summary').focus({ preventScroll: true });
    }
  });
  $('picker-book').addEventListener('change', () => {
    $('betting-book').value = $('picker-book').value;
    sort.key = 'ev'; sort.direction = 'desc';
    renderSelections();
    scheduleCalculation();
  });
  renderLegs();
  function renderResult(data) {
    const restoreScroll = rememberScroll();
    const showUnavailable = $('show-unavailable').getAttribute('aria-expanded') === 'true';
    const count = data.legs.length;
    const benchmarks = selectedReferences().map(book => {
      const ref = data.references.find(ref => ref.book === book);
      const probability = ref?.complete && Number.isFinite(ref.probability) && ref.probability > 0 && ref.probability < 1 ? ref.probability : null;
      return { book, name: ref?.name || referenceName(book), probability,
        fairOdds: probability === null ? null : ref.fair_odds };
    });
    const availableReferences = benchmarks.filter(ref => ref.probability !== null);
    const probability = availableReferences.length ? Math.min(...availableReferences.map(ref => ref.probability)) : null;
    const prices = parlayPrices(data).map(price => ({ ...price,
      ev: probability !== null && Number.isFinite(price.decimal) && price.decimal > 1 ? 100 * (probability * price.decimal - 1) : null,
    })).sort((a, b) => {
      if (a.ev === null || b.ev === null) {
        if (a.ev !== b.ev) return a.ev === null ? 1 : -1;
      } else if (a.ev !== b.ev) return b.ev - a.ev;
      return b.decimal - a.decimal || a.name.localeCompare(b.name);
    });
    result = { ...data, prices };
    const best = prices[0], hasEV = best?.ev !== null && Number.isFinite(best?.ev);
    const isBestPrice = price => hasEV ? price.ev === best.ev : price.decimal === best.decimal;
    const method = $('method').selectedOptions[0].textContent;
    $('best-price-label').textContent = hasEV ? 'HIGHEST ESTIMATED EV' : 'BEST ESTIMATED PRICE';
    $('book-price-sort').textContent = hasEV ? `Highest EV first / ${method}` : 'EV unavailable / Highest odds first';
    $('parlay-book-prices').setAttribute('aria-label', hasEV ? 'Estimated parlay odds and EV by book, highest EV first' : 'Estimated parlay odds by book, highest odds first; EV unavailable');
    $('book-prices-help').textContent = `Estimated from each book's prices for all selected legs. ${probability === null ? benchmarks.length ? 'EV needs fresh over/under prices for every leg at a selected fair value book.' : 'Choose fair value books to calculate EV.' : `EV uses ${method} and ${availableReferences.length > 1 ? `the lowest complete parlay probability from ${availableReferences.map(ref => ref.name).join(' + ')}` : `${availableReferences[0].name}'s complete parlay probability`}.`} Final betslip odds may differ.`;
    $('best-parlay-price').innerHTML = best ? `${esc(odds(best.odds))} <span>${prices.filter(isBestPrice).map(price => `${bookLogo(price.book)} ${esc(price.name)}`).join(' / ')}</span>` : 'No complete book prices';
    $('price-count').textContent = `${count} legs / ${prices.length} book${prices.length === 1 ? '' : 's'}`;
    $('parlay-book-prices').innerHTML = prices.map(price => {
      const isBest = isBestPrice(price);
      const ev = price.ev === null ? null : Number(price.ev.toFixed(1));
      return `<li class="parlay-book-card${isBest ? ' is-best' : ''}" data-price-tile="${esc(price.book)}">
        <span class="parlay-book-name">${bookLogo(price.book)}<span>${esc(price.name)}</span></span>
        <strong class="parlay-book-odds">${esc(odds(price.odds))}</strong>
        <span class="parlay-book-ev${ev > 0 ? ' positive' : ev < 0 ? ' negative' : ''}">${ev === null ? 'EV —' : `${ev > 0 ? '+' : ''}${ev.toFixed(1)}% EV`}</span>
        ${isBest ? `<span class="book-price-best">${hasEV ? 'Best EV' : 'Best price'}</span>` : '<span class="book-price-note">Est. parlay</span>'}
      </li>`;
    }).join('');
    notice('book-prices-empty', prices.length ? '' : `No book has current ${currentMarket().name} prices for every selected leg. Try another player or refresh prices.`);
    $('price-head').innerHTML = `<tr><th scope="col">Book</th><th scope="col">Est. parlay odds</th>${benchmarks.map(ref => `<th scope="col" data-ev-reference="${esc(ref.book)}"><span class="book-name">${bookLogo(ref.book)}${esc(ref.name)} EV</span><small>Fair ${ref.probability === null ? '-' : esc(odds(ref.fairOdds))}</small></th>`).join('')}${data.legs.map(leg => `<th scope="col">${esc(title(leg.player))}</th>`).join('')}</tr>`;
    $('price-rows').innerHTML = prices.map(price => `<tr data-price-book="${esc(price.book)}" class="${isBestPrice(price) ? 'best-parlay' : ''}">
      <th scope="row"><span class="book-name">${bookLogo(price.book)}${esc(price.name)}</span>${isBestPrice(price) ? `<small class="best-label">${hasEV ? 'Best EV' : 'Best price'}</small>` : ''}</th>
      <td class="parlay-total"><strong>${esc(odds(price.odds))}</strong></td>
      ${benchmarks.map(ref => {
        const ev = ref.probability !== null && Number.isFinite(price.decimal) && price.decimal > 1 ? 100 * (ref.probability * price.decimal - 1) : null;
        const display = ev === null ? null : Number(ev.toFixed(1));
        return `<td data-ev-book="${ref.book}" class="parlay-ev${display > 0 ? ' positive' : display < 0 ? ' negative' : ''}" title="${esc(ref.probability === null ? `${ref.name} needs current over/under prices for every leg` : `EV at ${odds(price.odds)} against ${ref.name} fair odds of ${odds(ref.fairOdds)}`)}">${display === null ? '-' : `${display > 0 ? '+' : ''}${display.toFixed(1)}%`}</td>`;
      }).join('')}
      ${price.legs.map(leg => `<td title="Updated ${esc(time(leg.updated_at))}">${esc(odds(leg.over))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${count + 2 + benchmarks.length}">No book has current ${currentMarket().name} prices for every selected leg. Try another player or refresh prices.</td></tr>`;
    $('result-method').textContent = $('method').selectedOptions[0].textContent;
    $('result-selections').textContent = data.legs.map(leg => `${title(leg.player)} ${currentMarket().label}`).join(' + ');
    const evLabel = data.offered_odds === null ? 'EV at your price' : `EV at ${odds(data.offered_odds)}`;
    $('reference-head').innerHTML = `<tr><th scope="col">Reference book</th>${data.legs.map((leg, index) => `<th scope="col" title="${esc(title(leg.player))}">Leg ${index + 1} fair</th>`).join('')}<th scope="col">Fair parlay odds</th><th scope="col">Estimated hit chance</th><th scope="col">${esc(evLabel)}</th></tr>`;
    $('reference-rows').classList.toggle('four-legs', count === 4);
    $('reference-rows').classList.toggle('two-legs', count === 2);
    $('reference-rows').innerHTML = data.references.map(ref => {
      const isAnchor = fairValueBooks.has(ref.book);
      const legs = ref.legs.map((leg, index) => `<td class="reference-leg" data-label="Leg ${index + 1} fair">${leg.probability === null ? '-' : `<strong>${esc(odds(leg.fair_odds))}</strong>`}<small>O ${esc(odds(leg.over))} / U ${esc(odds(leg.under))}</small><small>${esc(leg.status === 'available' ? `Updated ${time(leg.updated_at)}` : leg.status)}</small></td>`).join('');
      return `<tr data-book="${esc(ref.book)}" ${!isAnchor && !ref.complete ? `data-unavailable="true"${showUnavailable ? '' : ' hidden'}` : ''} class="${isAnchor ? 'anchor ' : ''}${ref.complete ? '' : 'unavailable'}"><td><span class="book-name">${bookLogo(ref.book)}<strong>${esc(ref.name)}</strong></span>${isAnchor ? '<small>Used for EV</small>' : ''}${ref.same_as_betting_book ? '<small>Your betting book; not an independent comparison</small>' : ''}</td>${legs}<td class="metric-fair" data-label="Fair parlay odds"><strong class="${ref.complete ? 'fair-total' : ''}">${esc(odds(ref.fair_odds))}</strong>${ref.complete ? '' : `<small>Needs all ${count} fresh O/U pairs</small>`}</td><td class="metric-chance" data-label="Hit chance">${ref.complete ? esc(pct(ref.probability)) : '-'}</td><td data-label="${esc(evLabel)}" class="metric-ev ${ref.ev === null ? '' : ref.ev > 0 ? 'positive' : 'negative'}">${ref.ev === null ? '-' : `${ref.ev > 0 ? '+' : ''}${ref.ev.toFixed(1)}%`}</td></tr>`;
    }).join('');
    const unavailable = $('reference-rows').querySelectorAll('[data-unavailable]').length;
    $('show-unavailable').hidden = unavailable === 0;
    $('show-unavailable').setAttribute('aria-expanded', String(showUnavailable));
    $('show-unavailable').textContent = `${showUnavailable ? 'Hide' : 'Show'} ${unavailable} unavailable books`;
    const complete = availableReferences.length;
    $('result-status').textContent = `${complete} selected reference book${complete === 1 ? '' : 's'} can devig all ${count} legs.${complete ? '' : ' Choose fair value books with current over and under prices for every leg.'}`;
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
    if (!response.ok) throw new Error(data.error || `Unable to load ${currentMarket().name} prices. Try refreshing.`);
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
          market, legs: selections.filter(Boolean), method: $('method').value, betting_book: $('betting-book').value || null,
          offered_odds: value ? Number(value) : null,
        }) });
      if (version !== inputVersion || auth !== authVersion) return;
      if (response.denied) return accessDenied();
      if (!matchesMarket(response.data, market)) throw new Error('The response does not match this parlay market. Refresh to try again.');
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
    const auth = authVersion, generation = marketVersion, requestedMarket = market;
    const isCurrent = () => auth === authVersion && generation === marketVersion;
    const controller = new AbortController();
    refreshController = controller;
    $('refresh').disabled = true;
    refreshWork = (async () => {
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await request(`/api/parlays${requestedMarket !== 'hr' ? `?market=${requestedMarket}` : ''}`, { signal: controller.signal });
        if (!isCurrent()) return;
        if (response.denied) return accessDenied();
        const data = response.data;
        if (!matchesMarket(data, requestedMarket) || !Array.isArray(data.legs) || !data.books) throw new Error(`${markets[requestedMarket].name} prices are unavailable. Try refreshing.`);
        cancelCalculation();
        catalog = data;
        let removed = false;
        selections.forEach((id, i) => { if (id && !data.legs.some(leg => leg.id === id)) { selections[i] = ''; removed = true; } });
        const book = $('betting-book').value;
        $('betting-book').replaceChildren(new Option('No book selected', ''));
        for (const [id, name] of Object.entries(data.books)) if (!['circa', 'pn'].includes(id)) $('betting-book').add(new Option(name, id));
        $('betting-book').value = book;
        renderPickerBooks();
        renderReferenceBooks();
        const game = $('game-filter').value;
        $('game-filter').replaceChildren(new Option('All games', ''));
        [...new Set(data.legs.map(leg => leg.game))].sort().forEach(game => $('game-filter').add(new Option(game.toUpperCase(), game)));
        if ([...$('game-filter').options].some(option => option.value === game)) $('game-filter').value = game;
        renderSelections();
        $('slate-date').textContent = market !== 'hr' ? `Upcoming ${currentMarket().sport.toUpperCase()} games` : new Date(`${data.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        $('updated').textContent = `Checked ${time(data.generated_at)}`;
        $('empty-slate').hidden = data.legs.length !== 0;
        $('access-panel').hidden = true;
        $('calculator').hidden = false;
        notice('request-status', removed ? 'A selected player is no longer available. Choose a replacement.' : '');
        if (validate()) await calculate();
        else { clearResult(); validate(); }
        if (isCurrent() && removed && result) notice('request-status', 'A selected player is no longer available. Review the remaining legs or choose a replacement.');
      } catch (error) {
        if (!isCurrent()) return;
        clearResult();
        validate();
        notice('request-status', error.name === 'AbortError' ? 'Price refresh timed out. Try again.' : error.message);
      } finally {
        clearTimeout(timer);
        if (refreshController === controller) {
          $('refresh').disabled = false;
          refreshWork = null;
          refreshController = null;
        }
      }
    })();
    return refreshWork;
  }
  $('parlay-market').addEventListener('change', () => {
    const next = $('parlay-market').value;
    if (!Object.hasOwn(markets, next) || next === market) return;
    marketVersion++;
    market = next;
    refreshController?.abort();
    refreshController = null;
    refreshWork = null;
    catalog = null;
    selections.fill('');
    clearResult();
    $('player-search').value = '';
    $('game-filter').replaceChildren(new Option('All games', ''));
    $('betting-book').replaceChildren(new Option('No book selected', ''));
    $('picker-book').replaceChildren(new Option('All books — best available price', ''));
    $('offered-odds').value = '';
    $('calculator').hidden = true;
    $('access-panel').hidden = true;
    $('updated').textContent = 'Loading prices...';
    sort.key = 'ev'; sort.direction = 'desc';
    renderMarket();
    renderSelections();
    notice('request-status', '');
    const url = new URL(window.location.href);
    if (market !== 'hr') url.searchParams.set('market', market);
    else url.searchParams.delete('market');
    history.replaceState(null, '', url);
    if (sessionReady) refresh();
  });
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
  ['method', 'betting-book', 'offered-odds'].forEach(id => $(id).addEventListener(id === 'offered-odds' ? 'input' : 'change', () => {
    if (id !== 'offered-odds') {
      if (id === 'method') renderReferenceBooks();
      if (id === 'betting-book') {
        const book = $('betting-book').value;
        if (book && ![...$('picker-book').options].some(option => option.value === book)) $('picker-book').add(new Option(`${catalog.books[book]} (no current prices)`, book));
        $('picker-book').value = book;
      }
      sort.key = 'ev'; sort.direction = 'desc';
      renderCatalog();
    }
    renderLegs(); scheduleCalculation(id === 'offered-odds' ? 300 : 0);
  }));
  ['account-link', 'access-login'].forEach(id => { $(id).href = `profile${HTML}`; });
  $('access-pricing').href = `pricing${HTML}`;
  async function sessionChanged(session) {
    const token = session?.access_token || '';
    if (token === ACCESS_TOKEN) return;
    ACCESS_TOKEN = token;
    sessionReady = true;
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
      sessionReady = true;
      $('account-link').textContent = ACCESS_TOKEN ? 'My account' : 'Sign in';
      SB.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => sessionChanged(session)); });
      await refresh();
    } catch (_) { notice('request-status', 'Sign-in service unavailable. Reload to try again.'); }
  }
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 30000);
  setInterval(() => {
    if (catalog) { renderReferenceBooks(); renderCatalog(); }
    if (!result) return;
    const expired = [...result.references.filter(ref => ref.complete), ...(result.prices || [])].some(ref => ref.legs.some(leg => Date.now() - Date.parse(leg.updated_at) > result.max_age_minutes * 60000));
    if (expired || selectionError()) {
      clearResult();
      validate();
      notice('request-status', 'Prices or game availability changed. Refresh to recalculate.');
    }
  }, 10000);
  window.refreshParlays = refresh;
  renderMarket();
  boot();
})();
