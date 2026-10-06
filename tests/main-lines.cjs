const assert = require('node:assert/strict');
const { canOpen, collect, availableProps, mainMarketLabel, open } = require('../player-lines.js');

const game = { mode: 'game' };
// Main-feed pairs retain away/home order on both rows; the home handicap is negated.
const selected = { prop: 'spread', game: 'atl @ no', team: 'no', opp: 'atl',
	handicap: '-1.5', under: true, gameId: 'game-1', date: '2026-10-05', dt: '2026-10-05', sport: 'nfl' };
const row = changes => ({ ...selected, bookOdds: { fd: '-115/-111' }, ...changes });
let checks = 0;
function test(name, callback) { callback(); console.log(`ok ${++checks} - ${name}`); }

test('main triggers accept game markets, partial markets and empty players only', () => {
	for (const prop of ['ml', 'spread', 'total', 'away_total', 'home_total', '1h_ml', '1q_spread',
		'2h_total', '1h_home_total', '1p_away_total', 'f5_spread', 'rfi', 'gift', 'giff']) {
		assert.equal(canOpen('main', row({ prop })), true, prop);
	}
	for (const changes of [{ blurred: true }, { player: 'test player' }, { prop: 'rec_yd' },
		{ prop: 'separator' }, { prop: '' }, { game: '' }, { game: 'atl @ ' }, { game: 'atl' }]) {
		assert.equal(canOpen('main', row(changes)), false);
	}
	assert.equal(canOpen('main', null), false);
});

test('opposite spread rows merge by away handicap without reversing prices or liquidity', () => {
	const home = row({ bookOdds: { fd: '-115/-111', px: '/+105' }, liquidity: { px: [999, 250] } });
	const away = row({ team: 'atl', opp: 'no', handicap: '1.5', under: false,
		bookOdds: { fd: '-115/-111', px: '-107/+105' }, liquidity: { px: [120, 250] } });
	const opposite = row({ handicap: '1.5', bookOdds: { fd: '+180/-220' } });
	const before = JSON.stringify([home, away, opposite]);
	const result = collect(home, [home, away, opposite], game);
	assert.deepEqual(result.lines.map(entry => entry.line), [-1.5, 1.5]);
	assert.deepEqual(result.lines[1].prices.get('fd'), [-115, -111]);
	assert.deepEqual(result.lines[1].prices.get('px'), [-107, 105]);
	assert.deepEqual(result.lines[1].liquidity.get('px'), [120, 250]);
	assert.deepEqual(result.lines[0].prices.get('fd'), [180, -220]);
	assert.equal(JSON.stringify([home, away, opposite]), before);
});

test('spread normalization includes partial markets and zero handicaps', () => {
	for (const prop of ['spread', '1h_spread', '1p_spread', 'f5_spread']) {
		const result = collect(row({ prop }), [row({ prop }), row({ prop, under: false, handicap: '1.5' }),
			row({ prop, handicap: '0' }), row({ prop, handicap: '-0.0', under: false })], game);
		assert.deepEqual(result.lines.map(entry => entry.line), [0, 1.5]);
	}
});

test('game identity excludes other events, dates, sports, players and periods', () => {
	const changes = [{ game: 'atl @ car' }, { game: 'atl-gm2 @ no-gm2' }, { gameId: 'game-2' },
		{ date: '2026-10-06' }, { dt: '2026-10-06' }, { sport: 'nhl' }, { player: 'test player' },
		{ prop: '1h_spread' }, { blurred: true }];
	const result = collect(selected, [row({}), ...changes.map(change => row({ ...change, handicap: -99.5 }))], game);
	assert.deepEqual(result.lines.map(entry => entry.line), [1.5]);
});

test('the game menu includes both team totals and periods, while collection keeps them separate', () => {
	const home = row({ prop: 'home_total', handicap: '23.5', bookOdds: { fd: '-120/+100' } });
	const rows = [home, row({ prop: 'away_total', handicap: '23.5', bookOdds: { fd: '+200/-250' } }),
		row({ prop: '1h_home_total', handicap: '10.5' }), row({ prop: 'total', handicap: '48.5' }),
		row({ prop: 'ml' }), row({ prop: 'ml', blurred: true }), row({ prop: 'rec', player: 'test player' }),
		row({ gameId: 'different', prop: 'f5_ml' }), row({ prop: 'unsupported' })];
	assert.deepEqual(availableProps(home, rows, game), ['home_total', 'away_total', '1h_home_total', 'total', 'ml']);
	const result = collect(home, rows, game);
	assert.deepEqual(result.lines.map(entry => entry.line), [23.5]);
	assert.deepEqual(result.lines[0].prices.get('fd'), [-120, 100]);
	assert.equal(mainMarketLabel('away_total', selected), 'ATL team total');
	assert.equal(mainMarketLabel('1h_home_total', selected), '1H NO team total');
	assert.equal(mainMarketLabel('f5_ml', selected), 'F5 Moneyline');
});

test('total unders keep their positive line and over/under order', () => {
	const total = row({ prop: 'total', handicap: '48.5', bookOdds: { kal: '+120/-140' }, liquidity: { kal: [45, 500] } });
	const result = collect(total, [total, { ...total, under: false }], game);
	assert.deepEqual(result.lines.map(entry => entry.line), [48.5]);
	assert.deepEqual(result.lines[0].prices.get('kal'), [120, -140]);
	assert.deepEqual(result.lines[0].liquidity.get('kal'), [45, 500]);
});

test('locked Circa quotes stay hidden across duplicate rows and market switches', () => {
	const masked = row({ circa_blurred: true });
	const rows = [row({ bookOdds: { circa: '+120/-140', fd: '-110/-110' } }),
		row({ prop: 'total', handicap: 48.5, bookOdds: { circa: '+150/-180', dk: '+110/-130' } })];
	assert.deepEqual(collect(masked, rows, game).books, ['fd']);
	assert.deepEqual(collect({ ...masked, prop: 'total' }, rows, game).books, ['dk']);
	assert.deepEqual(collect(selected, [row({ circa_blurred: true, bookOdds: { circa: '+120/-140' } })], game).books, []);
});

test('unexpected three-way quotes never turn a draw price into the home price', () => {
	const ml = row({ prop: 'ml', handicap: '0.5', bookOdds: { fd: '+200/+240/+140', dk: '+110/-130' } });
	assert.deepEqual(collect(ml, [ml], game).books, ['dk']);
});

// Minimal document adapter exercises the generated dialog content and change listener.
// Browser coverage separately checks the real dialog, controls, focus and scrolling.
function withDialog(callback) {
	const original = global.document;
	const nodes = new Map();
	const node = selector => {
		if (!nodes.has(selector)) nodes.set(selector, {
			value: '', innerHTML: '', textContent: '', listeners: {},
			addEventListener(type, listener) { this.listeners[type] = listener; },
		});
		return nodes.get(selector);
	};
	const dialog = { innerHTML: '', open: false, querySelector: node,
		style: { setProperty() {} }, showModal() { this.open = true; }, close() { this.open = false; } };
	global.document = { getElementById: () => dialog };
	try { callback(dialog, node); } finally { global.document = original; }
}

test('a clicked home spread highlights its normalized pair and uses team price labels', () => withDialog((dialog, node) => {
	open(selected, [row({}), row({ handicap: '-2.5' })], { ...game, player: 'ATL @ NO', formatOdds: String });
	const html = node('.player-lines-content').innerHTML;
	assert.match(dialog.innerHTML, /aria-label="Market for ATL @ NO"/);
	assert.match(html, /ATL above \/ NO below/);
	assert.match(html, /Selected line ATL \+1\.5 \/ NO -1\.5/);
	assert.match(html, /title="ATL \+1\.5">\+1\.5/);
	assert.match(html, /title="NO -1\.5">-1\.5/);
	assert.match(html, /title="NO · Highest listed price"/);
	assert.equal((html.match(/class="is-selected"/g) || []).length, 1);
}));

test('moneyline displays ML, market switching removes highlight, and returning restores it', () => withDialog((dialog, node) => {
	const ml = row({ prop: 'ml', handicap: '0.5' });
	const total = row({ prop: 'total', handicap: '48.5' });
	open(ml, [ml, total], { ...game, player: 'ATL @ NO', formatOdds: String });
	assert.match(node('.player-lines-content').innerHTML, />ML<\/th>/);
	assert.doesNotMatch(node('.player-lines-content').innerHTML, />0\.5<\/th>/);
	assert.match(node('.player-lines-content').innerHTML, /ATL above \/ NO below/);
	const selector = node('#player-lines-prop');
	selector.value = 'total'; selector.listeners.change();
	assert.match(node('.player-lines-content').innerHTML, /Over above \/ under below/);
	assert.doesNotMatch(node('.player-lines-content').innerHTML, /class="is-selected"/);
	selector.value = 'ml'; selector.listeners.change();
	assert.match(node('.player-lines-content').innerHTML, /class="is-selected"/);
	assert.equal(ml.prop, 'ml');
}));

console.log(`${checks} main line comparison checks passed.`);
