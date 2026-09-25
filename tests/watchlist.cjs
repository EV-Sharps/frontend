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

	const count = saves.length;
	await context.toggleWatchlist(event, '');
	context.CURR_SESSION = null;
	await context.toggleWatchlist(event, 'signed out');
	assert.equal(saves.length, count, 'Blank players and signed-out clicks do not write');
	console.log('Watchlist prop/page isolation, persistence, concurrent saves, sport identity, legacy entries, errors and retry passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
