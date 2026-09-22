const assert = require('node:assert/strict');
const { collect, canOpen } = require('./player-lines.js');

const selected = { player: 'test player', prop: 'rec_yds', game: 'bal @ kc', gameId: 'game-1', date: '2026-09-21', sport: 'nfl', handicap: 49.5 };
const row = changes => ({ ...selected, bookOdds: { fd: '-110/-110' }, ...changes });
let checks = 0;
function test(name, callback) { callback(); console.log(`ok ${++checks} - ${name}`); }

test('comparison stays with the selected player, prop, game, date, and sport', () => {
	const unrelated = [{ player: 'other' }, { prop: 'rush_yds' }, { game: 'bal @ pit' }, { gameId: 'game-2' }, { date: '2026-09-22' }, { sport: 'nhl' }];
	const result = collect(selected, [row({}), ...unrelated.map(change => row({ ...change, handicap: 99.5 }))]);
	assert.deepEqual(result.lines.map(entry => entry.line), [49.5]);
});

test('duplicate over/under rows merge missing quotes and numeric-equivalent lines', () => {
	const rows = [row({ handicap: '49.50', bookOdds: { fd: '-110/', kal: '120/-140' } }), row({ under: true, bookOdds: { fd: '/-115', px: '130/-150' } }), row({ handicap: 9.5 }), row({ handicap: 100.5 })];
	const before = JSON.stringify(rows);
	const result = collect(selected, rows);
	assert.deepEqual(result.lines.map(entry => entry.line), [9.5, 49.5, 100.5]);
	assert.deepEqual(result.lines[1].prices.get('fd'), [-110, -115]);
	assert.deepEqual(result.books, ['kal', 'px', 'fd']);
	assert.equal(JSON.stringify(rows), before);
});

test('a single feed quote remains an over even when the selected row is under', () => {
	const result = collect(selected, [row({ under: true, bookOdds: { fd: '+250' } })]);
	assert.deepEqual(result.lines[0].prices.get('fd'), [250, null]);
});

test('locked rows and locked Circa quotes are excluded', () => {
	const result = collect(selected, [row({ blurred: true, handicap: 59.5, bookOdds: { dk: '+9999' } }), row({ circa_blurred: true, bookOdds: { circa: '+9999', fd: '-110/-110' } })]);
	assert.deepEqual(result.books, ['fd']);
	assert.deepEqual(result.lines.map(entry => entry.line), [49.5]);
});

test('all available books are included, including new books not in the preferred order', () => {
	const result = collect(selected, [row({ bookOdds: { new_book: '+200/-240', poly: '220/-250', nv: '-/-120' } })]);
	assert.deepEqual(result.books, ['nv', 'poly', 'new_book']);
	assert.deepEqual(result.lines[0].prices.get('nv'), [null, -120]);
});

test('malformed and missing prices stay missing, and invalid lines are not shown', () => {
	const result = collect(selected, [row({ bookOdds: { fd: 'null/-110', dk: 'NaN/Infinity', px: '+200oops/', kal: '0/0', pn: '-/ ' } }), row({ handicap: null }), row({ handicap: '' }), row({ handicap: 'bad' })]);
	assert.deepEqual(result.books, ['fd']);
	assert.deepEqual(result.lines[0].prices.get('fd'), [null, -110]);
	assert.equal(result.lines.length, 1);
});

test('highest payouts are compared independently for each side, including even-money ties', () => {
	const result = collect(selected, [row({ bookOdds: { fd: '+100/-110', dk: '-100/-105', pn: '-120/-105' } })]);
	assert.deepEqual(result.lines[0].best, [2, 1 + 100 / 105]);
});

test('prediction-market liquidity follows the over/under quote order, including zero and formatted amounts', () => {
	const data = row({ under: true, bookOdds: { kal: '+120/-140', nv: '+120/-140', px: '+120/-140', poly: '+120/-140', fd: '+120/-140' },
		liquidity: { kal: [0, '250'], nv: ['$1,200', 300], px: [125.5, 400], poly: [500, 600], fd: [700, 800] } });
	const before = JSON.stringify(data);
	const result = collect(selected, [data]).lines[0];
	assert.deepEqual(result.liquidity.get('kal'), [0, 250]);
	assert.deepEqual(result.liquidity.get('nv'), [1200, 300]);
	assert.deepEqual(result.liquidity.get('px'), [125.5, 400]);
	assert.deepEqual(result.liquidity.get('poly'), [500, 600]);
	assert.equal(result.liquidity.has('fd'), false);
	assert.equal(JSON.stringify(data), before);
});

test('duplicate rows fill liquidity only for the price being displayed and never for missing sides', () => {
	const result = collect(selected, [
		row({ bookOdds: { px: '+110/' }, liquidity: { px: [null, 999] } }),
		row({ bookOdds: { px: '+120/-150' }, liquidity: { px: [900, 250] } }),
		row({ bookOdds: { px: '+110/-150' }, liquidity: { px: [40, 300] } }),
		row({ handicap: 59.5, bookOdds: { px: '/-130' }, liquidity: { px: [999, 80] } }),
	]);
	assert.deepEqual(result.lines[0].prices.get('px'), [110, -150]);
	assert.deepEqual(result.lines[0].liquidity.get('px'), [40, 250]);
	assert.deepEqual(result.lines[1].liquidity.get('px'), [null, 80]);
});

test('missing or invalid liquidity remains unknown', () => {
	for (const amount of [null, undefined, '', ' ', '-', 'unknown', -1, Infinity, NaN, false, {}]) {
		const result = collect(selected, [row({ bookOdds: { kal: '+120/-140' }, liquidity: { kal: [amount, amount] } })]);
		assert.deepEqual(result.lines[0].liquidity.get('kal'), [null, null]);
	}
	const result = collect(selected, [row({ bookOdds: { kal: '+120/-140' }, liquidity: { kal: '500' } })]);
	assert.deepEqual(result.lines[0].liquidity.get('kal'), [null, null]);
});

test('only the three requested pages expose playable player names', () => {
	for (const page of ['mlb', 'nfl', 'nhl']) assert.equal(canOpen(page, selected), true);
	for (const page of ['dingers', 'tds', 'atgs', 'main']) assert.equal(canOpen(page, selected), false);
	assert.equal(canOpen('nfl', { ...selected, blurred: true }), false);
	assert.equal(canOpen('nfl', { ...selected, player: '' }), false);
});

console.log(`${checks} player line comparison checks passed.`);
