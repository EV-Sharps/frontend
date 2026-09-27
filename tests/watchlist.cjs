// Run with Node: node tests/watchlist.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function run() {
	const saves = [], cached = [];
	let fail = false;
	const status = { setAttribute() {}, hidden: true };
	const context = vm.createContext({
		PAGE: 'nfl', SPORT: 'nfl', CURR_USER: { metadata: {} }, CURR_SESSION: { user: { id: 'test' } },
		BOOK_FEE_FUNCTIONS: { px: () => '+194/-204' },
		document: { querySelectorAll: () => [], getElementById: () => status },
		console: { error() {} }, setTimeout: () => 1, clearTimeout() {},
		cacheProfile: profile => cached.push(JSON.parse(JSON.stringify(profile))),
		SB: { from: () => ({ update: ({ metadata }) => ({ eq: async () => {
			if (fail) return { error: new Error('Save failed') };
			saves.push(JSON.parse(JSON.stringify(metadata)));
			return { error: null };
		} }) }) },
	});
	const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
	vm.runInContext(source.slice(source.indexOf('function _normPlayer'), source.indexOf('const evFormatter')), context);
	const event = { stopPropagation() {} };
	const plain = value => JSON.parse(JSON.stringify(value));
	const quotedRow = { player: 'quoted player', sport: 'nfl', prop: 'rec_yd', book: 'fd', line: 125,
		handicap: 49.5, under: false, game: 'buf @ mia', bookOdds: { fd: '+125/-145', dk: '+135/-155' } };
	assert.deepEqual(plain(context.watchlistQuote(quotedRow)),
		{ book: 'fd', odds: 125, handicap: 49.5, under: false, game: 'buf @ mia' },
		'The snapshot follows the displayed book, not another book with a higher price');
	assert.deepEqual(plain(context.watchlistQuote({ ...quotedRow, line: '-145', under: true })),
		{ book: 'fd', odds: -145, handicap: 49.5, under: true, game: 'buf @ mia' });
	assert.equal(context.watchlistQuote({ ...quotedRow, handicap: 0 }).handicap, 0, 'Zero is a valid line');
	assert.equal(context.watchlistQuote({ ...quotedRow, handicap: '49.5' }).handicap, 49.5);
	for (const row of [null, {}, { ...quotedRow, blurred: true }, { ...quotedRow, book: '' },
		{ ...quotedRow, line: 'not odds' }, { ...quotedRow, line: Infinity },
		{ ...quotedRow, line: 0 }, { ...quotedRow, line: true }, { ...quotedRow, line: 50 }]) {
		assert.equal(context.watchlistQuote(row), null, 'Unavailable or malformed prices must not become saved quotes');
	}
	for (const handicap of [null, undefined, 'bad line']) {
		const quote = context.watchlistQuote({ ...quotedRow, handicap });
		assert.equal(quote.odds, 125);
		assert.equal(quote.handicap, undefined, 'An unknown line is omitted, never coerced to zero');
	}
	const exchange = { ...quotedRow, book: 'px', line: 200, bookOdds: { px: '+200/-200' } };
	assert.equal(context.watchlistQuote(exchange).odds, 194, 'Fee-adjusted table prices are captured');
	assert.equal(context.watchlistQuote({ ...exchange, under: true }).odds, -204, 'Exchange under fee uses the under price');
	assert.equal(context.watchlistQuote(exchange, 'nfl', false).odds, 200, 'Raw card prices are captured when fees are not applied');
	assert.equal(context.watchlistQuote({ ...quotedRow, outlierBook: 'dk', outlierLine: 135 }, 'outliers').book, 'dk');
	assert.equal(context.watchlistQuote({ ...quotedRow, outlierBook: 'dk', outlierLine: 135 }, 'outliers').odds, 135);
	const tableStar = { dataset: { page: 'nfl', quote: JSON.stringify({ book: 'fd', odds: 110 }) },
		watchlistRow: { getData: () => quotedRow } };
	assert.equal(context.watchlistQuoteFromStar(tableStar).odds, 125, 'A table star reads its current row at click time');
	assert.equal(context.watchlistQuoteFromStar({ dataset: { quote: '{bad json' } }), null);
	assert.equal(context.watchlistQuoteFromStar({ dataset: { quote: JSON.stringify({ book: 'fd', odds: 110 }) } }).odds, 110,
		'A serialized card star retains its displayed quote');

	await Promise.all([
		context.toggleWatchlist(event, ' First Player ', 'nfl', 'buf'),
		context.toggleWatchlist(event, 'second player', 'nba', 'bos'),
	]);
	assert.equal(context.CURR_USER.metadata.watchlist.length, 2, 'Concurrent stars must both persist');
	assert.equal(saves[1].watchlist.length, 2);
	assert.equal(cached.at(-1).metadata.watchlist.length, 2, 'Navigation cache is updated');
	assert.equal(context.isWatchlisted('FIRST PLAYER', 'nfl'), true);
	assert.equal(context.isWatchlisted('first player', 'nba'), false);
	assert.equal(context._starColor('first player', 'nfl'), '#f59e0b');

	await context.toggleWatchlist(event, 'first player', 'nba', 'bos');
	await context.toggleWatchlist(event, 'first player', 'nfl');
	assert.equal(context.isWatchlisted('first player', 'nfl'), false);
	assert.equal(context.isWatchlisted('first player', 'nba'), true, 'Same name in another sport stays saved');

	const before = JSON.stringify(context.CURR_USER.metadata);
	fail = true;
	assert.equal(await context.toggleWatchlist(event, 'second player', 'nba'), false);
	assert.equal(JSON.stringify(context.CURR_USER.metadata), before, 'Failed saves leave favorites unchanged');
	assert.equal(status.hidden, false);
	fail = false;
	assert.equal(await context.toggleWatchlist(event, 'second player', 'nba'), true, 'A failed save can be retried');

	context.CURR_USER.metadata.watchlist.push({ player: 'legacy player', dt: new Date().toISOString().slice(0, 10) });
	assert.equal(context.isWatchlisted('legacy player', 'mlb', 'dingers'), true);
	assert.equal(context.isWatchlisted('legacy player', 'mlb', 'mlb'), false, 'Legacy MLB favorites stay on Dingers');
	context.CURR_USER.metadata.bets = [{ player: 'tracked player', sport: 'nfl' }, { player: '' }];
	assert.equal(context._starColor('tracked player', 'nfl'), '#3b82f6');
	assert.equal(context.isTracked('tracked player', 'nba'), false);
	assert.equal(context.isTracked(''), false, 'Blank team-market player fields are not tracked players');
	assert.equal(context.isWatchlisted(''), false);
	await context.toggleWatchlist(event, 'pitcher', 'k');
	assert.equal(context.isWatchlisted('pitcher', 'mlb'), true, 'Sport aliases match within the same page');
	assert.equal(context.CURR_USER.metadata.watchlist.at(-1).sport, 'mlb');

	// One player's stars are independent on each page, including rapid cross-page changes.
	await Promise.all([
		context.toggleWatchlist(event, 'same player', 'mlb', 'bal', 'dingers'),
		context.toggleWatchlist(event, 'same player', 'mlb', 'bal', 'mlb'),
	]);
	assert.equal(context.isWatchlisted('same player', 'mlb', 'dingers'), true);
	assert.equal(context.isWatchlisted('same player', 'mlb', 'mlb'), true);
	assert.equal(context.isWatchlisted('same player', 'mlb', 'strikeouts'), false);
	await context.toggleWatchlist(event, 'same player', 'mlb', 'bal', 'dingers');
	assert.equal(context.isWatchlisted('same player', 'mlb', 'dingers'), false);
	assert.equal(context.isWatchlisted('same player', 'mlb', 'mlb'), true);
	assert.equal(context.CURR_USER.metadata.watchlist.find(w => w.player === 'same player').page, 'mlb');
	await context.toggleWatchlist(event, 'legacy player', 'mlb', '', 'mlb');
	await context.toggleWatchlist(event, 'legacy player', 'mlb', '', 'dingers');
	assert.equal(context.isWatchlisted('legacy player', 'mlb', 'dingers'), false);
	assert.equal(context.isWatchlisted('legacy player', 'mlb', 'mlb'), true, 'Removing a legacy star does not remove its new page-specific favorite');
	await context.toggleWatchlist(event, 'touchdown player', 'nfl', '', 'tds');
	assert.equal(context.isWatchlisted('touchdown player', 'nfl', 'nfl'), false);
	assert.equal(context.isWatchlisted('touchdown player', 'nfl', 'tds'), true);

	// The same player's props have distinct save keys, including simultaneous clicks.
	const doubles = context.toggleWatchlist(event, ' Dylan Beavers ', 'mlb', 'bal', 'mlb', ' DOUBLE ');
	const duplicate = context.toggleWatchlist(event, 'dylan beavers', 'mlb', 'bal', 'mlb', 'double');
	const singles = context.toggleWatchlist(event, 'dylan beavers', 'mlb', 'bal', 'mlb', 'single');
	assert.deepEqual(await Promise.all([doubles, duplicate, singles]), [true, false, true]);
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'mlb', 'double'), true);
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'mlb', 'single'), true);
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'mlb', 'tb'), false);
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'dingers', 'double'), false);
	assert.equal(context._starColor('dylan beavers', 'mlb', 'mlb', 'double'), '#f59e0b');
	assert.equal(context._starColor('dylan beavers', 'mlb', 'mlb', 'tb'), '#6b7280');
	assert.deepEqual(saves.at(-1).watchlist.filter(w => w.player === 'dylan beavers').map(w => w.prop), ['double', 'single']);
	fail = true;
	assert.equal(await context.toggleWatchlist(event, 'dylan beavers', 'mlb', 'bal', 'mlb', 'double'), false);
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'mlb', 'double'), true);
	fail = false;
	await context.toggleWatchlist(event, 'dylan beavers', 'mlb', 'bal', 'mlb', 'double');
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'mlb', 'double'), false);
	assert.equal(context.isWatchlisted('dylan beavers', 'mlb', 'mlb', 'single'), true, 'Unstarring doubles preserves singles');
	await context.toggleWatchlist(event, 'touchdown player', 'nfl', '', 'tds', 'attd');
	assert.equal(context.isWatchlisted('touchdown player', 'nfl', 'tds', 'attd'), true);
	assert.equal(context.isWatchlisted('touchdown player', 'nfl', 'tds', 'ftd'), false);
	assert.equal(context.isWatchlisted('touchdown player', 'nfl', 'nfl', 'attd'), false);

	// Legacy favorites are retained, but missing props are never a wildcard.
	context.CURR_USER.metadata.watchlist.push(
		{ player: 'old hitter', sport: 'mlb', page: 'mlb' },
		{ player: 'old homer', sport: 'mlb', page: 'dingers' },
		{ player: 'old pitcher', sport: 'mlb', page: 'strikeouts' },
	);
	assert.equal(context.isWatchlisted('old hitter', 'mlb', 'mlb', 'double'), false);
	assert.equal(context.isWatchlisted('old hitter', 'mlb', 'mlb', 'single'), false);
	assert.equal(context.isWatchlisted('old homer', 'mlb', 'dingers', 'hr'), true);
	assert.equal(context.isWatchlisted('old homer', 'mlb', 'mlb', 'hr'), false);
	assert.equal(context.isWatchlisted('old pitcher', 'mlb', 'strikeouts', 'k'), true);
	await context.toggleWatchlist(event, 'old hitter', 'mlb', '', 'mlb', 'double');
	assert.equal(context.isWatchlisted('old hitter', 'mlb', 'mlb', 'double'), true);
	assert.equal(context.isWatchlisted('old hitter', 'mlb', 'mlb', 'tb'), false);
	await context.toggleWatchlist(event, 'old homer', 'mlb', '', 'dingers', 'hr');
	assert.equal(context.isWatchlisted('old homer', 'mlb', 'dingers', 'hr'), false, 'A legacy homer favorite can still be removed');

	// The queue captures values at click time, independently from mutable live rows and other stars.
	const untouchedBets = JSON.stringify(context.CURR_USER.metadata.bets);
	const firstQuote = context.watchlistQuote(quotedRow);
	const secondQuote = context.watchlistQuote({ ...quotedRow, book: 'dk', line: -155, handicap: 59.5, under: true });
	const firstSave = context.toggleWatchlist(event, 'quoted player', 'nfl', 'buf', 'nfl', 'rec_yd', firstQuote);
	const secondSave = context.toggleWatchlist(event, 'quoted player', 'nfl', 'buf', 'nfl', 'rec', secondQuote);
	firstQuote.odds = 900;
	firstQuote.handicap = 99.5;
	secondQuote.book = 'pn';
	quotedRow.line = 700;
	assert.deepEqual(await Promise.all([firstSave, secondSave]), [true, true]);
	const savedQuotes = context.CURR_USER.metadata.watchlist.filter(w => w.player === 'quoted player');
	assert.deepEqual(plain(savedQuotes.map(w => w.quote)), [
		{ book: 'fd', odds: 125, handicap: 49.5, under: false, game: 'buf @ mia' },
		{ book: 'dk', odds: -155, handicap: 59.5, under: true, game: 'buf @ mia' },
	]);
	assert.equal(JSON.stringify(context.CURR_USER.metadata.bets), untouchedBets, 'Starring never adds or changes a bet');
	await context.toggleWatchlist(event, 'without price', 'nfl', 'buf', 'nfl', 'rec', null);
	assert.equal(context.CURR_USER.metadata.watchlist.at(-1).quote ?? null, null, 'A favorite can still be saved without an available quote');
	assert.deepEqual(plain(saves.at(-1).watchlist.find(w => w.player === 'quoted player' && w.prop === 'rec_yd').quote), plain(savedQuotes[0].quote));

	const count = saves.length;
	await context.toggleWatchlist(event, '');
	context.CURR_SESSION = null;
	await context.toggleWatchlist(event, 'signed out');
	assert.equal(saves.length, count, 'Blank players and signed-out clicks do not write');
	console.log('Watchlist quote snapshots, fees, validation, prop/page isolation, concurrent saves, legacy entries, errors and retry passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
