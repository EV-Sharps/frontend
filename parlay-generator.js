/* Shared, bounded candidate search. Inputs contain current, side-specific quotes only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParlayGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const american = value => value >= 2 ? (value - 1) * 100 : -100 / (value - 1);
  const validDecimal = value => Number.isFinite(value) && value > 1;
  const validProbability = value => Number.isFinite(value) && value > 0 && value < 1;

  function evaluate(legs, { books, requiredBooks = [], referenceBooks = [] }) {
    if (!legs.length || new Set(legs.map(leg => leg.player)).size !== legs.length
      || new Set(legs.map(leg => leg.game)).size !== legs.length) return null;
    const prices = books.flatMap(book => {
      if (!legs.every(leg => validDecimal(leg.prices[book]))) return [];
      const decimal = legs.reduce((product, leg) => product * leg.prices[book], 1);
      return Number.isFinite(decimal) ? [{ book, decimal, odds: american(decimal) }] : [];
    }).sort((a, b) => b.decimal - a.decimal || a.book.localeCompare(b.book));
    if (!prices.length || requiredBooks.some(book => !prices.some(price => price.book === book))) return null;
    const references = referenceBooks.flatMap(book => {
      if (!legs.every(leg => validProbability(leg.probabilities[book]))) return [];
      return [{ book, probability: legs.reduce((product, leg) => product * leg.probabilities[book], 1) }];
    });
    // A complete reference must price every leg. Never stitch different books' fair legs together.
    if (!references.length) return null;
    const probability = Math.min(...references.map(ref => ref.probability));
    const best = prices[0], worst = prices[prices.length - 1];
    return { ids: legs.map(leg => leg.id), prices, references, probability, fairOdds: american(1 / probability),
      best, worst, ev: 100 * (probability * best.decimal - 1),
      gap: prices.length > 1 ? 100 * (best.decimal / worst.decimal - 1) : null };
  }

  async function generate({ legs, books, requiredBooks = [], referenceBooks, count, rank = 'gap', limit = 5,
    signal, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
    if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('Choose 2 to 8 legs.');
    const options = { books: [...new Set(books)], requiredBooks, referenceBooks };
    const eligible = legs.filter(leg => requiredBooks.every(book => validDecimal(leg.prices[book])));
    const found = new Map();
    const check = () => { if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError'); };
    const compare = (a, b) => (rank === 'ev' ? b.ev - a.ev : b.gap - a.gap)
      || b.ev - a.ev || b.gap - a.gap || a.ids.join().localeCompare(b.ids.join());
    let rounds = 0;
    for (const reference of referenceBooks) {
      for (const target of options.books) {
        const comparisons = rank === 'gap' ? options.books.filter(book => book !== target) : [null];
        for (const comparison of comparisons) {
          check();
          if (++rounds % 6 === 0) { await yieldTask(); check(); }
          const candidates = eligible.filter(leg => validProbability(leg.probabilities[reference])
            && validDecimal(leg.prices[target]) && (!comparison || validDecimal(leg.prices[comparison])))
            .map(leg => ({ leg, score: Math.log(leg.prices[target])
              + (comparison ? -Math.log(leg.prices[comparison]) : Math.log(leg.probabilities[reference])) }))
            .sort((a, b) => b.score - a.score || a.leg.id.localeCompare(b.leg.id));
          // Search each book/reference combination, plus alternatives to its leading selections.
          // Work is bounded by books * references * slate size, not every possible parlay.
          const pick = excluded => {
            const chosen = [], games = new Set(), players = new Set();
            for (const { leg } of candidates) {
              if (leg.id === excluded || games.has(leg.game) || players.has(leg.player)) continue;
              chosen.push(leg); games.add(leg.game); players.add(leg.player);
              if (chosen.length === count) break;
            }
            if (chosen.length !== count) return [];
            const value = evaluate(chosen, options);
            if (value && (rank !== 'gap' || value.gap !== null)) {
              const key = [...value.ids].sort().join('|');
              if (!found.has(key)) found.set(key, value);
            }
            return chosen;
          };
          const first = pick(null);
          first.forEach(leg => pick(leg.id));
          // Retain only a small ranked shortlist between searches.
          if (found.size > 150) {
            const keep = [...found.entries()].sort((a, b) => compare(a[1], b[1])).slice(0, 40);
            found.clear(); keep.forEach(([key, value]) => found.set(key, value));
          }
        }
      }
    }
    check();
    return [...found.values()].sort(compare).slice(0, limit);
  }
  return { generate, evaluate, american };
});
