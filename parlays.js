(() => {
  'use strict';
  PAGE = 'parlays';
  const markets = {
    hr: { sport: 'mlb', name: 'homer', label: '1+ HR', under: 'no HR', unit: 'home run' },
    attd: { sport: 'nfl', name: 'ATTD', label: 'ATTD', under: 'no touchdown', unit: 'touchdown' },
    atgs: { sport: 'nhl', name: 'ATGS', label: '1+ Goal', under: 'no goal', unit: 'goal' },
    nba: { sport: 'nba', name: 'NBA props', label: 'NBA props' },
  };
  const requestedMarket = new URLSearchParams(window.location.search).get('market');
  let market = Object.hasOwn(markets, requestedMarket) ? requestedMarket : 'hr';
  const currentMarket = () => markets[market];
  SPORT = currentMarket().sport;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const title = v => String(v).replace(/\b\w/g, c => c.toUpperCase());
  const propNames = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', '3ptm': 'Threes', '3pt': 'Threes',
    'pts+reb+ast': 'Points + rebounds + assists', 'pts+reb': 'Points + rebounds', 'pts+ast': 'Points + assists',
    'reb+ast': 'Rebounds + assists', stl: 'Steals', blk: 'Blocks', 'stl+blk': 'Steals + blocks', 'blk+stl': 'Blocks + steals', to: 'Turnovers' };
  const legLabel = leg => market === 'nba' ? leg.market : currentMarket().label;
  const legSide = leg => leg?.side === 'under' ? 'under' : 'over';
  const odds = v => v === null || !Number.isFinite(Number(v)) ? '\u2014' : `${v >= 0 ? '+' : '-'}${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  const pct = v => `${(v * 100).toFixed(3)}%`;
  const time = v => v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Unknown';
  const gameTime = v => market !== 'hr' && v ? new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ' / ' + time(v) : time(v);
  const gameDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  const gameDay = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? gameDateFormat.format(date) : '';
  };
  const matchup = game => game.split(' @ ').map(t => t.replace(/-gm\d+$/, '')).sort().join('|');
  const selections = Array(8).fill('');
  const maxLegs = () => Math.min(8, Math.max(2, Number(catalog?.max_leg_count) || 8));
  let generatorBooks = null, generated = [], generationController = null, generatedTicket = null;
  const sort = { key: 'ev', direction: 'desc' };
  const pageSize = 100;
  let catalogPage = 0;
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
    $('prop-filter-label').hidden = market !== 'nba';
    $('side-filter-label').hidden = market !== 'nba';
    $('access-membership').textContent = market === 'nba' ? 'NBA props parlays are included with Sharp.' : 'Included with Analyst and Sharp.';
    renderPickerHelp();
    $('empty-slate').textContent = `No upcoming ${config.name} markets are available${market === 'hr' ? ' for today' : ''}. Refresh when the next slate is posted.`;
    $('catalog-wrap').setAttribute('aria-label', `Choose ${config.name} parlay players and compare prices`);
    $('catalog-caption').textContent = `${config.name} players and sportsbook over/under prices`;
    $('price-caption').textContent = `Estimated parlay prices from each book's current ${config.name} odds`;
    $('reference-caption').textContent = `Devigged ${config.name} parlay prices`;
    $('fair-methodology').textContent = market === 'nba'
      ? "For fair odds, we remove the margin from each player's over/under pair at the exact selected line and use the probability of your chosen side. We multiply those probabilities, then convert the result to American odds. NBA props use half-point lines so there is no push outcome. The calculations use full precision before rounding the display."
      : `For fair odds, we remove the margin from each player's over/under 0.5 ${config.unit} market, multiply the fair probabilities, then convert the result to American odds. The calculations use full precision before rounding the display.`;
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
    $('slip-empty').hidden = false;
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
    const ready = Boolean(catalog) && count >= 2 && count <= maxLegs() && count === selections.filter(Boolean).length && !error;
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
    const tables = [...document.querySelectorAll('.catalog-wrap, .table-wrap, .parlay-slip, .generated-parlays')].map(element => ({ element, left: element.scrollLeft, top: element.scrollTop }));
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
  function currentPrice(quote, side = 'over', maxAge) {
    const missingOther = side === 'under' ? 'Missing over price' : 'Missing under price';
    return validPrice(quote?.[side]) && ['available', missingOther].includes(priceStatus(quote, maxAge)) ? Number(quote[side]) : null;
  }
  function parlayPrices(data) {
    const highestFirst = (a, b) => b.decimal - a.decimal || a.name.localeCompare(b.name);
    const prices = Array.isArray(data.prices) ? [...data.prices] : [];
    const included = new Set(prices.map(price => price.book));
    // The API omits Circa/Pinnacle from betting destinations but includes their actual leg quotes.
    // Older responses supply all book prices through references instead of a prices array.
    const referencePrices = (data.references || []).flatMap(ref => {
      if (included.has(ref.book) || (Array.isArray(data.prices) && !nonBettingBooks.has(ref.book))
        || ref.legs?.length !== data.legs.length) return [];
      const legs = data.legs.map(leg => ref.legs.find(quote => quote.id === leg.id));
      const offers = legs.map((leg, index) => currentPrice(leg, legSide(data.legs[index]), data.max_age_minutes));
      if (offers.some(price => price === null)) return [];
      const combined = offers.reduce((product, price) => product * decimal(price), 1);
      return [{ book: ref.book, name: ref.name, decimal: combined,
        odds: combined >= 2 ? (combined - 1) * 100 : -100 / (combined - 1),
        legs: legs.map((leg, index) => ({ id: leg.id, player: leg.player, price: offers[index], updated_at: leg.updated_at })) }];
    });
    return [...prices, ...referencePrices].sort(highestFirst);
  }
  function averagePrice(leg, books) {
    const prices = books.map(book => currentPrice(leg.quotes?.[book], legSide(leg))).filter(price => price !== null);
    return prices.length ? prices.reduce((sum, price) => sum + decimal(price), 0) / prices.length : null;
  }
  function bestOffer(leg) {
    return Object.entries(leg.quotes || {}).reduce((best, [book, quote]) => {
      const price = currentPrice(quote, legSide(leg));
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
    invalidateGeneration();
    try { localStorage.setItem(referenceStorageKey, JSON.stringify([...fairValueBooks])); } catch (_) { /* The selection still works for this visit. */ }
    renderReferenceSummary();
    sort.key = 'ev'; sort.direction = 'desc';
    catalogPage = 0;
    renderCatalog();
    scheduleCalculation();
  }
  function pickerOffer(leg) {
    if (!Number.isFinite(Date.parse(leg.start)) || Date.parse(leg.start) <= Date.now()) return null;
    const book = $('picker-book').value;
    if (!book) return bestOffer(leg);
    const price = currentPrice(leg.quotes?.[book], legSide(leg));
    return nonBettingBooks.has(book) || price === null ? null : { book, price };
  }
  function invalidateGeneration() {
    generationController?.abort();
    generationController = null;
    generated = [];
    $('generate').disabled = false;
    $('generate').textContent = 'Generate parlays';
    $('generated-parlays').replaceChildren();
    $('generated-parlays').hidden = true;
    notice('generator-status', '');
  }
  function generatorBookKeys() {
    return catalogBooks().filter(book => !nonBettingBooks.has(book)
      && catalog.legs.some(leg => Date.parse(leg.start) > Date.now() && currentPrice(leg.quotes?.[book], legSide(leg)) !== null));
  }
  function renderGeneratorBooks() {
    const keys = [...new Set([...generatorBookKeys(), ...(generatorBooks || [])])];
    const selected = generatorBooks ? [...generatorBooks] : [];
    $('generate-books-summary').textContent = generatorBooks === null ? 'All books' : selected.length === 1
      ? referenceName(selected[0]) : selected.length ? `${selected.length} books` : 'Choose books';
    $('generate-books-summary').title = generatorBooks === null ? 'Compare whichever books cover every leg' : selected.map(referenceName).join(', ');
    $('generate-books-all').setAttribute('aria-pressed', String(generatorBooks === null));
    $('generate-books-options').innerHTML = keys.map(book => `<label class="fair-book-option"><input type="checkbox" data-generate-book="${esc(book)}"${generatorBooks?.has(book) ? ' checked' : ''}>${bookLogo(book)}<span>${esc(referenceName(book))}</span></label>`).join('');
  }
  function generatorLegs() {
    const refs = selectedReferences(), books = generatorBooks === null ? generatorBookKeys() : [...generatorBooks];
    return filteredLegs().filter(leg => Number.isFinite(Date.parse(leg.start)) && Date.parse(leg.start) > Date.now()).map(leg => ({
      id: leg.id, player: leg.player, game: matchup(leg.game),
      prices: Object.fromEntries(books.flatMap(book => {
        const price = currentPrice(leg.quotes?.[book], legSide(leg));
        return price === null ? [] : [[book, decimal(price)]];
      })),
      probabilities: Object.fromEntries(refs.flatMap(book => {
        const ref = legReference(leg, book);
        return ref ? [[book, ref.probability]] : [];
      })),
    }));
  }
  function renderGenerated() {
    $('generated-parlays').hidden = !generated.length;
    $('generated-parlays').innerHTML = generated.map((suggestion, index) => {
      const active = suggestion.ids.length === selectedLegs().length && suggestion.ids.every(id => selections.includes(id));
      const names = suggestion.ids.map(id => catalog.legs.find(leg => leg.id === id)).filter(Boolean)
        .map(leg => `${title(leg.player)} ${legLabel(leg)}`);
      return `<article class="generated-parlay${active ? ' is-active' : ''}">
        <div class="generated-copy"><strong>${bookLogo(suggestion.best.book)} ${esc(referenceName(suggestion.best.book))} <span>${esc(odds(suggestion.best.odds))}</span></strong><p title="${esc(names.join(' + '))}">${names.map(esc).join(' + ')}</p></div>
        <div class="generated-metrics"><span class="${suggestion.ev >= 0 ? 'positive' : 'negative'}">${suggestion.ev > 0 ? '+' : ''}${suggestion.ev.toFixed(1)}% EV</span>
        <small title="${esc(suggestion.gap === null ? 'Only one complete book' : `${referenceName(suggestion.worst.book)} ${odds(suggestion.worst.odds)} to ${referenceName(suggestion.best.book)} ${odds(suggestion.best.odds)} / increase in total payout`)}">${suggestion.gap === null ? 'Gap unavailable' : `+${suggestion.gap.toFixed(1)}% gap`} / ${suggestion.prices.length} book${suggestion.prices.length === 1 ? '' : 's'}</small></div>
        <button type="button" data-use-generated="${index}" aria-pressed="${active}" aria-label="Use suggested parlay ${index + 1}">${active ? 'Selected' : 'Use'}</button>
      </article>`;
    }).join('');
  }
  function useGenerated(index) {
    const suggestion = generated[index];
    if (!suggestion) return;
    // Recheck quote age and coverage at the point of use, including time spent reading suggestions.
    const byId = new Map(generatorLegs().map(leg => [leg.id, leg]));
    const legs = suggestion.ids.map(id => byId.get(id));
    const requiredBooks = generatorBooks === null ? [] : [...generatorBooks];
    const checked = legs.every(Boolean) && ParlayGenerator.evaluate(legs, {
      books: generatorBooks === null ? generatorBookKeys() : requiredBooks, requiredBooks, referenceBooks: selectedReferences(),
    });
    if (!checked || ($('generate-rank').value === 'gap' && checked.gap === null)) {
      invalidateGeneration();
      notice('generator-status', 'Prices or coverage changed. Refresh prices and generate again.');
      return;
    }
    const restoreScroll = rememberScroll();
    selections.fill('');
    suggestion.ids.forEach((id, i) => { selections[i] = id; });
    generatedTicket = { ids: [...suggestion.ids], requiredBooks };
    $('betting-book').value = checked.best.book;
    $('picker-book').value = checked.best.book;
    $('offered-odds').value = '';
    renderSelections();
    renderGenerated();
    scheduleCalculation();
    restoreScroll();
  }
  async function generateParlays() {
    invalidateGeneration();
    if (!catalog) return;
    const books = generatorBooks === null ? generatorBookKeys() : [...generatorBooks];
    const count = Number($('generate-count').value), refs = selectedReferences(), rank = $('generate-rank').value;
    if (!books.length) return notice('generator-status', 'Choose comparison books or All books.');
    if (rank === 'gap' && books.length < 2) return notice('generator-status', 'Price gaps need at least two books. Select another book or rank by Highest EV.');
    if (!refs.length) return notice('generator-status', 'Choose fair value books below so each generated parlay has an EV estimate.');
    const legs = generatorLegs();
    if (new Set(legs.map(leg => leg.game)).size < count) return notice('generator-status', `Need ${count} different matchups. Lower the leg count or broaden the table filters.`);
    const controller = new AbortController();
    generationController = controller;
    $('generate').disabled = true;
    $('generate').textContent = 'Finding parlays...';
    notice('generator-status', 'Comparing complete book prices and fair references...');
    try {
      const suggestions = await ParlayGenerator.generate({ legs, books, requiredBooks: generatorBooks === null ? [] : books,
        referenceBooks: refs, count, rank, signal: controller.signal });
      if (generationController !== controller) return;
      generated = suggestions;
      if (!generated.length) {
        notice('generator-status', 'No complete combinations found in this search. Try fewer legs, fewer comparison books, broader filters, or another fair value reference. Every reference needs fresh over/under pairs for all legs.');
        return;
      }
      notice('generator-status', `${generated.length} suggestions / ${count} legs / ${rank === 'ev' ? 'highest estimated EV' : 'largest payout gap'} first. First suggestion loaded. Gaps compare complete-book totals; they do not guarantee positive EV.`);
      useGenerated(0);
    } catch (error) {
      if (generationController === controller && error.name !== 'AbortError') notice('generator-status', 'Could not generate parlays. Refresh prices and try again.');
    } finally {
      if (generationController === controller) {
        generationController = null;
        $('generate').disabled = false;
        $('generate').textContent = 'Generate parlays';
      }
    }
  }
  $('generate').addEventListener('click', generateParlays);
  $('generated-parlays').addEventListener('click', event => {
    const button = event.target.closest('[data-use-generated]');
    if (button) useGenerated(Number(button.dataset.useGenerated));
  });
  ['generate-count', 'generate-rank'].forEach(id => $(id).addEventListener('change', invalidateGeneration));
  $('generate-books-options').addEventListener('change', event => {
    const input = event.target.closest('[data-generate-book]');
    if (!input) return;
    if (generatorBooks === null) generatorBooks = new Set();
    if (input.checked) generatorBooks.add(input.dataset.generateBook);
    else generatorBooks.delete(input.dataset.generateBook);
    invalidateGeneration(); renderGeneratorBooks();
    $('generate-books-options').querySelector(`[data-generate-book="${CSS.escape(input.dataset.generateBook)}"]`)?.focus({ preventScroll: true });
  });
  for (const [id, selection] of [['generate-books-all', null], ['generate-books-clear', []]]) $(id).addEventListener('click', () => {
    generatorBooks = selection === null ? null : new Set();
    invalidateGeneration(); renderGeneratorBooks();
  });
  document.addEventListener('click', event => {
    if (!$('generate-books-picker').contains(event.target)) $('generate-books-picker').open = false;
  });
  $('generate-books-picker').addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('generate-books-picker').open = false; $('generate-books-summary').focus({ preventScroll: true }); }
  });
  function pickerEstimate(leg) {
    const offer = pickerOffer(leg);
    const references = selectedReferences().map(book => legReference(leg, book)).filter(Boolean);
    const probability = references.length ? Math.min(...references.map(ref => ref.probability)) : null;
    return { offer, references, probability, ev: offer && probability !== null ? 100 * (probability * decimal(offer.price) - 1) : null };
  }
  function renderPickerBooks() {
    const selected = $('picker-book').value;
    $('picker-book').replaceChildren(new Option('All books - best available price', ''));
    if (!catalog) return;
    for (const [book, name] of Object.entries(catalog.books)) {
      if (nonBettingBooks.has(book)) continue;
      const count = catalog.legs.filter(leg => Date.parse(leg.start) > Date.now() && currentPrice(leg.quotes?.[book], legSide(leg)) !== null).length;
      if (count || selected === book) $('picker-book').add(new Option(`${name} (${count ? count : 'no current prices'})`, book));
    }
    $('picker-book').value = Object.hasOwn(catalog.books, selected) && !nonBettingBooks.has(selected) ? selected : '';
  }
  function renderPickerHelp() {
    const book = $('picker-book').value, name = book ? catalog?.books[book] || book : 'the best available book';
    const refs = selectedReferences();
    const names = refs.length > 3 ? `${refs.length} selected books` : refs.map(referenceName).join(' + ');
    $('catalog-help').textContent = `Pick 2-${maxLegs()} ${market === 'nba' ? 'props' : currentMarket().label + ' players'} from different games. ${$('method').selectedOptions[0].textContent} EV at ${name}. ${refs.length ? `Fair: lowest available probability from ${names}, using fresh O/U pairs.` : 'Choose fair value books for EV.'} Click EV, Avg or a book to sort.`;
  }
  function renderPropFilter() {
    const selected = $('prop-filter').value;
    $('prop-filter').replaceChildren(new Option('All props', ''));
    if (market !== 'nba') return;
    const props = [...new Set((catalog?.legs || []).map(leg => leg.prop).filter(Boolean))];
    const order = Object.keys(propNames);
    props.sort((a, b) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length) || a.localeCompare(b));
    props.forEach(prop => $('prop-filter').add(new Option(propNames[prop] || title(prop), prop)));
    if (props.includes(selected)) $('prop-filter').value = selected;
  }
  function disabledReason(leg) {
    if (selections.includes(leg.id)) return '';
    if (Date.parse(leg.start) <= Date.now()) return 'Game has started';
    const others = selectedLegs().filter(Boolean);
    if (others.some(other => other.player === leg.player)) return 'Player already selected';
    if (others.some(other => matchup(other.game) === matchup(leg.game))) return 'Matchup already selected';
    return selectedLegs().length >= maxLegs() ? `${maxLegs()} legs selected; remove one to change it` : '';
  }
  function renderLegs() {
    $('selection-count').textContent = `${selections.filter(Boolean).length} / ${maxLegs()} selected`;
    const slots = legSlots();
    const filled = slots.filter(Boolean).length;
    const emptySlots = slots.map((leg, index) => leg ? -1 : index).filter(index => index >= 0).slice(0, Math.max(2 - filled, filled < maxLegs() ? 1 : 0));
    $('leg-inputs').innerHTML = slots.map((leg, index) => {
      if (!leg && !emptySlots.includes(index)) return '';
      const book = $('betting-book').value;
      const price = leg && book ? currentPrice(leg.quotes?.[book], legSide(leg)) : null;
      const offer = leg ? (book ? (price === null ? null : { book, price }) : bestOffer(leg)) : null;
      return `<div class="leg-card${leg ? ' is-filled' : ''}"><span class="leg-number" aria-hidden="true">${index + 1}</span>
        <div class="leg-copy"><strong>${leg ? esc(title(leg.player)) : filled >= 2 ? 'Add another leg' : `Leg ${index + 1}`}</strong>
        ${leg && market === 'nba' ? `<span class="leg-market">${esc(legLabel(leg))}</span>` : ''}
        <small>${leg ? `${esc(leg.game.toUpperCase())} / ${esc(gameTime(leg.start))}` : filled >= 2 ? `Optional / up to ${maxLegs()} legs` : 'Add a player from the table'}</small>
        ${leg ? `<span class="leg-price">${offer ? `${bookLogo(offer.book)}<span>${esc(odds(offer.price))} <small>${market === 'nba' ? esc(bookLabel(offer.book)) : currentMarket().label}${book ? '' : ' / best price'}</small></span>` : `No current ${esc(book ? catalog.books[book] : 'book')} price`}</span>` : ''}</div>
        ${leg ? `<button type="button" class="remove-leg" data-remove="${index}" aria-label="Remove ${esc(title(leg.player))}">&times;</button>` : ''}</div>`;
    }).join('');
  }
  function renderCatalogHead(books) {
    const heading = (key, label, name) => `<th scope="col" data-key="${esc(key)}"${key.startsWith('book:') && fairValueBooks.has(key.slice(5)) ? ' class="fair-reference"' : ''} aria-sort="${sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}"><button type="button" data-sort="${esc(key)}" title="Sort by ${esc(name)}${key.startsWith('book:') && fairValueBooks.has(key.slice(5)) ? ' / Used for fair value' : ''}">${label}<span class="sort-arrow" aria-hidden="true">${sort.key === key ? sort.direction === 'asc' ? '&#9650;' : '&#9660;' : '&#8597;'}</span></button></th>`;
    $('catalog-head').innerHTML = `<tr><th scope="col" class="catalog-pick">Pick</th>${heading('player', 'Player / Game', 'player')}${heading('ev', 'EV / Price', 'estimated EV at the selected book')}${heading('average', 'Avg', `average current ${currentMarket().name} odds (lowest = most likely)`)}${books.map(book => heading(`book:${book}`, `${bookLogo(book)}${esc(bookLabel(book))}`, `${catalog.books[book]} ${currentMarket().name} price`)).join('')}</tr>`;
  }
  function filteredLegs() {
    const search = $('player-search').value.trim().toLowerCase(), game = $('game-filter').value;
    const prop = market === 'nba' ? $('prop-filter').value : '', side = market === 'nba' ? $('side-filter').value : '';
    const today = game === 'today' ? gameDay(Date.now()) : '';
    return (catalog?.legs || []).filter(leg => (!game || (game === 'today' ? gameDay(leg.start) === today : leg.game === game))
      && (!prop || leg.prop === prop) && (!side || legSide(leg) === side)
      && `${leg.player} ${leg.game} ${leg.team || ''} ${market === 'nba' ? leg.market : ''}`.toLowerCase().includes(search));
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
    const estimates = new Map((catalog?.legs || []).map(leg => [leg.id, pickerEstimate(leg)]));
    const legs = filteredLegs().filter(leg => estimates.get(leg.id)?.offer);
    const averages = new Map(legs.map(leg => [leg.id, averagePrice(leg, allBooks)]));
    legs.sort((a, b) => {
      let order;
      if (sort.key === 'player') order = a.player.localeCompare(b.player);
      else {
        const value = leg => {
          if (sort.key === 'ev') return estimates.get(leg.id)?.ev ?? null;
          if (sort.key === 'average') return averages.get(leg.id);
          const price = currentPrice(leg.quotes?.[sort.key.slice(5)], legSide(leg));
          return price === null ? null : decimal(price);
        };
        const first = value(a), second = value(b);
        if (first === null || second === null) return first === second ? a.player.localeCompare(b.player) : first === null ? 1 : -1;
        order = first - second;
      }
      return (sort.direction === 'asc' ? order : -order) || a.player.localeCompare(b.player);
    });
    $('catalog-count').textContent = `${legs.length} of ${catalog?.legs.length || 0} ${market === 'nba' ? 'selections' : 'players'}`;
    const paginated = market === 'nba' && legs.length > pageSize;
    catalogPage = paginated ? Math.min(catalogPage, Math.ceil(legs.length / pageSize) - 1) : 0;
    const first = catalogPage * pageSize;
    $('catalog-pagination').hidden = !paginated;
    $('catalog-prev').disabled = catalogPage === 0;
    $('catalog-next').disabled = first + pageSize >= legs.length;
    $('catalog-range').textContent = `${first + 1}\u2013${Math.min(first + pageSize, legs.length)} of ${legs.length}`;
    $('catalog-rows').innerHTML = (paginated ? legs.slice(first, first + pageSize) : legs).map(leg => {
      const selected = selections.indexOf(leg.id), reason = disabledReason(leg), best = bestOffer(leg);
      const average = averages.get(leg.id);
      const averagePrice = average === null ? '-' : odds(average >= 2 ? (average - 1) * 100 : -100 / (average - 1));
      const estimate = estimates.get(leg.id), ev = estimate?.ev;
      const displayEV = Number.isFinite(ev) ? Number(ev.toFixed(1)) : null;
      const refLabel = estimate?.references.map(ref => bookLabel(ref.book)).join(' + ');
      const evCell = `<td class="catalog-ev${displayEV > 0 ? ' positive' : displayEV < 0 ? ' negative' : ''}" title="${esc(refLabel ? `Reference: ${refLabel}${estimate.references.length > 1 ? ' (lower fair probability)' : ''}${estimate.references.some(ref => ref.book === estimate.offer.book) ? ' / Includes the betting book' : ''}` : 'Needs a fresh over/under pair at a selected fair value book')}">
        <strong>${displayEV === null ? '-' : `${displayEV > 0 ? '+' : ''}${displayEV.toFixed(1)}%`}</strong>
        <small class="ev-offer">${bookLogo(estimate.offer.book)} ${esc(bookLabel(estimate.offer.book))} ${esc(odds(estimate.offer.price))}</small>
        <small class="ev-reference">${refLabel ? `vs ${esc(refLabel)}` : 'No fair estimate'}</small></td>`;
      const action = selected >= 0 ? 'Remove' : 'Add';
      const prices = books.map(book => {
        const quote = leg.quotes?.[book], status = priceStatus(quote), price = currentPrice(quote, legSide(leg));
        const fresh = ['available', 'Missing under price', 'Missing over price'].includes(status);
        const highest = price !== null && best && !nonBettingBooks.has(book) && decimal(price) === decimal(best.price);
        const label = `${catalog.books[book]}: ${status === 'available' ? `Updated ${time(quote.updated_at)}` : status}`;
        const primary = legSide(leg), other = primary === 'under' ? 'over' : 'under';
        return `<td class="catalog-price${highest ? ' best-price' : ''}" title="${esc(label)}">${fresh
          ? `<strong>${validPrice(quote[primary]) ? esc(odds(quote[primary])) : '-'}</strong><small>${validPrice(quote[other]) ? esc(odds(quote[other])) : '-'}</small>`
          : `<span class="price-unavailable">${status === 'Stale prices' ? 'Stale' : validPrice(quote?.[primary]) ? 'Unavailable' : '-'}</span>`}</td>`;
      }).join('');
      return `<tr data-leg-row="${esc(leg.id)}" class="${selected >= 0 ? 'is-selected' : reason ? 'is-blocked' : ''}">
        <td class="catalog-pick"><button type="button" data-leg="${esc(leg.id)}" aria-label="${action} ${esc(title(leg.player))}${market === 'nba' ? ` ${esc(legLabel(leg))}` : ''}${reason ? `: ${esc(reason)}` : ''}" aria-pressed="${selected >= 0}" ${reason ? 'disabled' : ''} title="${esc(reason || `${action} this selection`)}">${selected >= 0 ? `&#10003; ${selected + 1}` : reason ? selectedLegs().length >= maxLegs() ? 'Full' : 'N/A' : '+ Add'}</button></td>
        <th scope="row" class="catalog-player"><strong>${esc(title(leg.player))}</strong>${market === 'nba' ? `<span class="leg-market">${esc(legLabel(leg))}</span>` : ''}<small>${esc(leg.game.toUpperCase())} <span>${esc(gameTime(leg.start))}</span></small></th>${evCell}<td class="catalog-average" title="Average current ${esc(legLabel(leg))} price across books">${esc(averagePrice)}</td>${prices}</tr>`;
    }).join('') || `<tr><td class="catalog-empty" colspan="${books.length + 4}">${catalog?.legs.length ? `No ${market === 'nba' ? 'selections' : 'players'} match. Try another filter or book with current prices.` : 'No upcoming players available.'}</td></tr>`;
    if (focusKey) $('catalog-wrap').querySelector(`[data-${focusKey}="${CSS.escape(focusValue)}"]`)?.focus({ preventScroll: true });
    restoreScroll();
  }
  function renderSelections() { renderLegs(); renderCatalog(); if (generated.length) renderGenerated(); validate(); }
  function toggleLeg(id) {
    if (generationController) invalidateGeneration();
    generatedTicket = null;
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
    catalogPage = 0;
    renderCatalog();
    $('catalog-head').querySelector(`[data-sort="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  const filterCatalog = () => { invalidateGeneration(); catalogPage = 0; renderCatalog(); $('catalog-wrap').scrollTop = 0; };
  $('player-search').addEventListener('input', filterCatalog);
  ['game-filter', 'prop-filter', 'side-filter'].forEach(id => $(id).addEventListener('change', filterCatalog));
  for (const [id, step] of [['catalog-prev', -1], ['catalog-next', 1]]) $(id).addEventListener('click', () => {
    catalogPage += step;
    renderCatalog();
    $('catalog-wrap').scrollTop = 0;
    $('catalog-wrap').focus({ preventScroll: true });
  });
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
    if (generationController) invalidateGeneration();
    $('betting-book').value = $('picker-book').value;
    sort.key = 'ev'; sort.direction = 'desc';
    catalogPage = 0;
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
    const worst = prices[prices.length - 1];
    const gap = prices.length > 1 ? 100 * (best.decimal / worst.decimal - 1) : null;
    $('parlay-price-summary').innerHTML = `<div><span>Fair parlay</span><strong>${probability === null ? '-' : esc(odds(ParlayGenerator.american(1 / probability)))}</strong><small>${probability === null ? 'Needs a complete reference' : `${pct(probability)} hit chance`}</small></div>
      <div><span>Book price gap</span><strong>${gap === null ? '-' : `+${gap.toFixed(1)}%`}</strong><small>${gap === null ? 'Needs two complete books' : `${esc(odds(worst.odds))} to ${esc(odds(best.odds))}`}</small></div>`;
    if (generatedTicket && generatedTicket.ids.join('|') === selections.filter(Boolean).join('|')) {
      const missing = generatedTicket.requiredBooks.filter(book => !prices.some(price => price.book === book));
      if (missing.length) {
        invalidateGeneration();
        generatedTicket = null;
        notice('generator-status', `Coverage changed at ${missing.map(referenceName).join(', ')}. Generate again to require every chosen book.`);
      }
    }
    $('parlay-book-prices').innerHTML = prices.map(price => {
      const isBest = isBestPrice(price);
      const shortfall = best ? 100 * (price.decimal / best.decimal - 1) : 0;
      const ev = price.ev === null ? null : Number(price.ev.toFixed(1));
      return `<li class="parlay-book-card${isBest ? ' is-best' : ''}" data-price-tile="${esc(price.book)}">
        <span class="parlay-book-name">${bookLogo(price.book)}<span>${esc(price.name)}</span></span>
        <strong class="parlay-book-odds">${esc(odds(price.odds))}</strong>
        <span class="parlay-book-ev${ev > 0 ? ' positive' : ev < 0 ? ' negative' : ''}">${ev === null ? 'EV -' : `${ev > 0 ? '+' : ''}${ev.toFixed(1)}% EV`}</span>
        ${isBest ? `<span class="book-price-best">${hasEV ? 'Best EV' : 'Best price'}</span>` : `<span class="book-price-note" title="Total payout difference versus the best complete book">${shortfall.toFixed(1)}% vs best</span>`}
      </li>`;
    }).join('');
    notice('book-prices-empty', prices.length ? '' : `No book has current ${currentMarket().name} prices for every selected leg. Try another player or refresh prices.`);
    $('price-head').innerHTML = `<tr><th scope="col">Book</th><th scope="col">Est. parlay odds</th>${benchmarks.map(ref => `<th scope="col" data-ev-reference="${esc(ref.book)}"><span class="book-name">${bookLogo(ref.book)}${esc(ref.name)} EV</span><small>Fair ${ref.probability === null ? '-' : esc(odds(ref.fairOdds))}</small></th>`).join('')}${data.legs.map(leg => `<th scope="col">${esc(title(leg.player))}${market === 'nba' ? `<small>${esc(legLabel(leg))}</small>` : ''}</th>`).join('')}</tr>`;
    $('price-rows').innerHTML = prices.map(price => `<tr data-price-book="${esc(price.book)}" class="${isBestPrice(price) ? 'best-parlay' : ''}">
      <th scope="row"><span class="book-name">${bookLogo(price.book)}${esc(price.name)}</span>${isBestPrice(price) ? `<small class="best-label">${hasEV ? 'Best EV' : 'Best price'}</small>` : ''}</th>
      <td class="parlay-total"><strong>${esc(odds(price.odds))}</strong></td>
      ${benchmarks.map(ref => {
        const ev = ref.probability !== null && Number.isFinite(price.decimal) && price.decimal > 1 ? 100 * (ref.probability * price.decimal - 1) : null;
        const display = ev === null ? null : Number(ev.toFixed(1));
        return `<td data-ev-book="${ref.book}" class="parlay-ev${display > 0 ? ' positive' : display < 0 ? ' negative' : ''}" title="${esc(ref.probability === null ? `${ref.name} needs current over/under prices for every leg` : `EV at ${odds(price.odds)} against ${ref.name} fair odds of ${odds(ref.fairOdds)}`)}">${display === null ? '-' : `${display > 0 ? '+' : ''}${display.toFixed(1)}%`}</td>`;
      }).join('')}
      ${data.legs.map((selection, index) => {
        const quote = price.legs.find(leg => leg.id === selection.id) || price.legs[index];
        return `<td title="${esc(legLabel(selection))} / Updated ${esc(time(quote?.updated_at))}">${esc(odds(quote?.price ?? quote?.[legSide(selection)] ?? null))}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${count + 2 + benchmarks.length}">No book has current ${currentMarket().name} prices for every selected leg. Try another player or refresh prices.</td></tr>`;
    $('result-method').textContent = $('method').selectedOptions[0].textContent;
    $('result-selections').textContent = data.legs.map(leg => `${title(leg.player)} ${legLabel(leg)}`).join(' + ');
    const evLabel = data.offered_odds === null ? 'EV at your price' : `EV at ${odds(data.offered_odds)}`;
    $('reference-head').innerHTML = `<tr><th scope="col">Reference book</th>${data.legs.map((leg, index) => `<th scope="col" title="${esc(title(leg.player))} ${esc(legLabel(leg))}">Leg ${index + 1} fair</th>`).join('')}<th scope="col">Fair parlay odds</th><th scope="col">Estimated hit chance</th><th scope="col">${esc(evLabel)}</th></tr>`;
    $('reference-rows').classList.toggle('four-legs', count >= 4);
    $('reference-rows').classList.toggle('two-legs', count === 2);
    $('reference-rows').innerHTML = data.references.map(ref => {
      const isAnchor = fairValueBooks.has(ref.book);
      const legs = ref.legs.map((leg, index) => `<td class="reference-leg" data-label="Leg ${index + 1} fair">${leg.probability === null ? '-' : `<strong>${esc(odds(leg.fair_odds))}</strong>`}${market === 'nba' ? `<small>${esc(legLabel(data.legs[index]))}</small>` : ''}<small>O ${esc(odds(leg.over))} / U ${esc(odds(leg.under))}</small><small>${esc(leg.status === 'available' ? `Updated ${time(leg.updated_at)}` : leg.status)}</small></td>`).join('');
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
    $('slip-empty').hidden = true;
    $('results').removeAttribute('aria-busy');
    restoreScroll();
  }
  function accessDenied() {
    invalidateGeneration();
    catalog = null;
    selections.fill('');
    clearResult();
    $('calculator').hidden = true;
    $('access-panel').hidden = false;
    $('updated').textContent = market === 'nba' ? 'Sharp membership' : 'Analyst or Sharp membership';
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
        invalidateGeneration();
        renderGeneratorBooks();
        [...$('generate-count').options].forEach(option => { option.disabled = Number(option.value) > maxLegs(); });
        if (Number($('generate-count').value) > maxLegs()) $('generate-count').value = String(maxLegs());
        let removed = false;
        selections.forEach((id, i) => { if (id && !data.legs.some(leg => leg.id === id)) { selections[i] = ''; removed = true; } });
        const book = $('betting-book').value;
        $('betting-book').replaceChildren(new Option('No book selected', ''));
        for (const [id, name] of Object.entries(data.books)) if (!['circa', 'pn'].includes(id)) $('betting-book').add(new Option(name, id));
        $('betting-book').value = book;
        renderPickerBooks();
        renderReferenceBooks();
        renderPropFilter();
        const game = $('game-filter').value;
        $('game-filter').replaceChildren(new Option('All games', ''), new Option('Today', 'today'));
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
    invalidateGeneration();
    marketVersion++;
    market = next;
    refreshController?.abort();
    refreshController = null;
    refreshWork = null;
    catalog = null;
    selections.fill('');
    clearResult();
    $('player-search').value = '';
    $('game-filter').replaceChildren(new Option('All games', ''), new Option('Today', 'today'));
    $('prop-filter').replaceChildren(new Option('All props', ''));
    $('side-filter').value = '';
    catalogPage = 0;
    $('betting-book').replaceChildren(new Option('No book selected', ''));
    $('picker-book').replaceChildren(new Option('All books - best available price', ''));
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
    if (generationController) invalidateGeneration();
    generatedTicket = null;
    selections.fill('');
    clearResult();
    renderSelections();
  });
  ['method', 'betting-book', 'offered-odds'].forEach(id => $(id).addEventListener(id === 'offered-odds' ? 'input' : 'change', () => {
    if (generationController) invalidateGeneration();
    if (id !== 'offered-odds') {
      if (id === 'method') { invalidateGeneration(); renderReferenceBooks(); }
      if (id === 'betting-book') {
        const book = $('betting-book').value;
        if (book && ![...$('picker-book').options].some(option => option.value === book)) $('picker-book').add(new Option(`${catalog.books[book]} (no current prices)`, book));
        $('picker-book').value = book;
      }
      sort.key = 'ev'; sort.direction = 'desc';
      catalogPage = 0;
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
    invalidateGeneration();
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
