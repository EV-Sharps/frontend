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

test('only the three requested pages expose playable player names', () => {
	for (const page of ['mlb', 'nfl', 'nhl']) assert.equal(canOpen(page, selected), true);
	for (const page of ['dingers', 'tds', 'atgs', 'main']) assert.equal(canOpen(page, selected), false);
	assert.equal(canOpen('nfl', { ...selected, blurred: true }), false);
	assert.equal(canOpen('nfl', { ...selected, player: '' }), false);
});

console.log(`${checks} player line comparison checks passed.`);
