// Run with Node: node tests/kalshi-fees.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
function load(page = 'nfl', sport) {
	const context = vm.createContext({ PAGE: page, SPORT: sport });
	vm.runInContext(source.slice(source.indexOf('function americanToDecimal('), source.indexOf('function rowClick(')), context);
	vm.runInContext(source.slice(source.indexOf('function watchlistQuoteNumber('), source.indexOf('function watchlistQuoteFromStar(')), context);
	return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
const touchdown = {
	player: 'saquon barkley', prop: 'attd', sport: 'nfl', book: 'kal', line: 104,
	handicap: 0.5, under: false, game: 'phi @ dal', bookOdds: { kal: '+104/-108' },
	links: { kal: 'https://kalshi.com/markets/kxnfltd/nfl-touchdowns/kxnfltd-26sep28phidal' },
};
const receptions = {
	player: 'dandre swift', prop: 'rec', book: 'kal', line: 456,
	handicap: 3.5, under: false, game: 'phi @ chi', bookOdds: { kal: '+456/-567' },
	links: { kal: 'https://kalshi.com/markets/kxnflrec/kxnflrec/kxnflrec-26sep28phichi' },
};

test('Swift receptions use the full NFL fee rather than the homer discount', () => {
	assert.equal(load('main').addKalshiFee('+456'), '440', 'The former half-rate calculation explains the reported +440');
	assert.equal(load('nfl').addKalshiFee('+456', receptions), '425');
	assert.equal(load('main').addKalshiFee('+456', { prop: 'rec', sport: 'nfl' }), '425');
	assert.equal(load('main', 'nfl').addKalshiFee('+456', { prop: 'rec' }), '425');
	assert.equal(load('main').addKalshiFee('+456', { prop: 'rec' }, 'nfl'), '425');
	assert.equal(load('nfl').addKalshiFee('+456', { prop: 'rec' }), '425', 'NFL rows without sport or links use their page context');
	assert.equal(load('main', 'nfl').addKalshiFee('+456', { prop: 'hr', sport: 'mlb' }), '440',
		'Explicit row sport takes precedence over a mixed page sport');
	assert.equal(load('nfl', 'nfl').addKalshiFee('+456', {
		links: { kal: 'https://kalshi.com/markets/kxmlbhr/mlb-home-runs/kxmlbhr-26sep28' },
	}), '440', 'A verified homer market retains its reduced fee across pages');
});

test('Every NFL prop series in the current feed carries its fee onto mixed pages', () => {
	const context = load('main', 'mlb');
	for (const series of ['KXNFLPASSYDS', 'KXNFLRSHYDS', 'KXNFLRECYDS', 'KXNFLREC', 'KXNFLPASSATT', 'KXNFLPASSCOMP']) {
		const links = { kal: `https://kalshi.com/markets/${series}/${series}-26SEP28PHICHI` };
		assert.equal(context.addKalshiFee('+456', { links }), '425', series);
	}
});

test('NFL prop Best Book and watchlist use the adjusted quote while raw prices remain intact', () => {
	const context = load('nfl');
	const original = JSON.stringify(receptions);
	const prices = Object.freeze({ kal: '+456/-567', fd: '+430/-550' });
	assert.deepEqual(plain(context.highestOver(prices, [], 0, '', false, receptions)),
		{ book: 'fd', value: 430, raw: '+430' }, 'FanDuel beats Kalshi after its full fee');
	assert.deepEqual(plain(context.highestOver(prices, [], 0, 'kal', false, receptions)),
		{ book: 'kal', value: 425, raw: '425' });
	assert.deepEqual(plain(context.displayedBestBookQuote(receptions)), { book: 'kal', line: 425 });
	assert.deepEqual(plain(context.watchlistQuote(receptions)),
		{ book: 'kal', odds: 425, under: false, handicap: 3.5, game: 'phi @ chi' });
	assert.equal(context.displayedBestBookQuote({ ...receptions, line: 425 }).line, 425,
		'Render an already-adjusted quote from the raw price without charging twice');
	assert.equal(context.watchlistQuote({ ...receptions, line: 425 }, 'nfl', false).odds, 425,
		'Mobile cards retain their displayed adjusted price');
	assert.deepEqual(prices, { kal: '+456/-567', fd: '+430/-550' });
	assert.equal(JSON.stringify(receptions), original);
});

test('Barkley touchdown quotes charge the full fee on both sides', () => {
	const context = load('tds');
	assert.equal(context.addKalshiFee('+104/-108', touchdown), '-104/-116');
	assert.equal(context.addKalshiFee('+104', touchdown), '-104');
	assert.equal(context.addKalshiFee('-108', touchdown), '-116');
});

test('Touchdown fees follow the market on other pages and page fallback on TDs', () => {
	const context = load('main');
	for (const prop of ['attd', 'ftd']) {
		assert.equal(context.addKalshiFee('+104/-108', { prop }), '-104/-116');
	}
	for (const kal of [touchdown.links.kal, 'https://kalshi.com/markets/KXNFLTD-26SEP28PHIDAL']) {
		assert.equal(context.addKalshiFee('+104/-108', { links: { kal } }), '-104/-116');
	}
	for (const page of ['tds', 'tds2']) {
		assert.equal(context.addKalshiFee('+104/-108', {}, page), '-104/-116');
		assert.equal(load(page).addKalshiFee('+104/-108'), '-104/-116');
	}
});

test('MLB home runs retain their reduced fee and legacy markets remain unchanged', () => {
	for (const page of ['dingers', 'dingers2', 'mlb']) {
		const context = load(page);
		assert.equal(context.addKalshiFee('+567', { prop: 'hr', sport: 'mlb' }), '547',
			'The 15-cent Tatis home-run quote stays approximately +547 after fees');
		assert.equal(context.addKalshiFee('+104/-108', { prop: 'hr', sport: 'mlb' }), '100/-112');
	}
	assert.equal(load('main').addKalshiFee('+104/-108'), '100/-112');
});

test('Empty and missing sides remain missing instead of manufacturing prices', () => {
	const context = load('tds');
	for (const [input, expected] of [['', ''], ['-', '-'], ['+104/', '-104/'], ['/-108', '/-116'], ['-/0', '-/0']]) {
		assert.equal(context.addKalshiFee(input, touchdown), expected);
	}
});

test('Best book selection compares after-fee prices before choosing a winner', () => {
	const context = load('tds');
	const prices = Object.freeze({ kal: '+104/-108', fd: '+100/-110' });
	assert.deepEqual(plain(context.highestOver(prices, [], 0, '', false, touchdown)),
		{ book: 'fd', value: 100, raw: '+100' });
	assert.deepEqual(plain(context.highestOver(prices, [], 0, '', true, touchdown)),
		{ book: 'fd', value: -110, raw: '-110' });
	assert.deepEqual(plain(load('nfl').highestOver(prices, [], 0, '', false, touchdown)),
		{ book: 'fd', value: 100, raw: '+100' }, 'The row market selects its fee outside the TD page');
	assert.equal(context.highestOver({ kal: '+130/-150', fd: '+100/-110' }, [], 0, '', false, touchdown).book, 'kal',
		'Kalshi still wins when its after-fee quote is higher');
	assert.deepEqual(prices, { kal: '+104/-108', fd: '+100/-110' }, 'Raw prices stay available for comparison and devigging');
});

test('Fee-aware best book selection respects exclusions, specific books, boosts, and unavailable unders', () => {
	const context = load('tds');
	const prices = { kal: '+104/-108', fd: '+100/-110' };
	assert.deepEqual(plain(context.highestOver(prices, ['fd'], 0, '', false, touchdown)),
		{ book: 'kal', value: -104, raw: '-104' });
	assert.deepEqual(plain(context.highestOver(prices, [], 0, 'kal', true, touchdown)),
		{ book: 'kal', value: -116, raw: '-116' });
	assert.deepEqual(plain(context.highestOver(prices, [], 20, '', false, touchdown)),
		{ book: 'fd', value: 120, raw: '+100' });
	assert.equal(context.highestOver(prices, [], 20, 'kal', false, touchdown).value,
		context.applyProfitBoost(-104, 20));
	assert.equal(context.highestOver({ kal: '+104', fd: '+100/-110' }, [], 0, '', true, touchdown).book, 'fd');
	assert.equal(context.highestOver({ kal: '+104' }, [], 0, '', true, touchdown).book, null);
});

test('Best Book and watchlist quotes use the same TD fee without changing the raw row', () => {
	const context = load('nfl');
	const original = JSON.stringify(touchdown);
	assert.deepEqual(plain(context.displayedBestBookQuote(touchdown)), { book: 'kal', line: -104 });
	assert.equal(context.displayedBestBookQuote({ ...touchdown, under: true }).line, -116);
	assert.deepEqual(plain(context.watchlistQuote(touchdown)),
		{ book: 'kal', odds: -104, under: false, handicap: 0.5, game: 'phi @ dal' });
	assert.equal(context.watchlistQuote({ ...touchdown, under: true }).odds, -116);
	assert.equal(context.displayedBestBookQuote({ ...touchdown, line: -104 }).line, -104,
		'An already-adjusted row is recomputed from its raw price, never charged twice');
	assert.equal(context.watchlistQuote({ ...touchdown, line: -104 }, 'nfl', false).odds, -104,
		'Mobile cards capture their displayed price without another fee');
	assert.equal(JSON.stringify(touchdown), original);
});

test('Explicit quote page and outlier book selection preserve their fee context', () => {
	const context = load('dingers');
	const outlier = { book: 'fd', line: 100, outlierBook: 'kal', outlierLine: 104,
		bookOdds: { fd: '+100/-110', kal: '+104/-108' } };
	assert.deepEqual(plain(context.displayedBestBookQuote(outlier, 'tds2')), { book: 'kal', line: -104 });
	assert.equal(context.watchlistQuote(outlier, 'tds2').odds, -104);
	assert.equal(context.displayedBestBookQuote({ book: 'kal', line: 567, prop: 'hr', bookOdds: { kal: '+567' } }, 'dingers').line, 547);
});
