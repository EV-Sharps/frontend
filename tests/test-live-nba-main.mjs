import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = name => fs.readFileSync(path.join(dir, name), 'utf8');
const shared = source('shared.js'), card = source('card.js'), live = source('live.html');
const slice = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} source block exists`);
  return source.slice(a, b);
};
const helpers = slice(shared, '// Live NFL pairs keep', 'const propFormatter =');
let html = '', renderedIds = [], queryRows = [], previousRows = [];
const collapsed = { innerHTML: '', classList: { toggle() {}, contains() { return false; } } };
const header = { set innerHTML(value) { html = value; } };
const fakeCard = () => ({ dataset: { uniqueId: 'fixture' }, style: {}, classList: { toggle() {} },
  querySelector(selector) { return selector === '.card-header' ? header : collapsed; } });
const context = vm.createContext({ PAGE: 'live', SPORT: 'nba', PLAYER: '', MOBILE: false,
  window: {}, mountCardGameLogs: () => {},
  DEVIG: '', PREVIOUS_DATA: previousRows, CURRENT_CARD_INDEX: 0, CARDS_PER_LOAD: 20,
  ALL_CARD_DATA: [], CURR_USER: null, MASTER_DATA: [], IS_LOADING_CARDS: false,
  localStorage: { getItem() { return null; } }, setTimeout() {},
  title: value => String(value || '').replace(/\b[a-z]/g, x => x.toUpperCase()),
  getGameImgs: () => ['AWAY_LOGO', 'HOME_LOGO'],
  getTeamImg: (sport, team) => `[${sport}:${team}]`,
  playerLinesName: (data, label) => label, createWatchlistStar: () => null,
  evCardFormatter: () => '', plusFormatter: x => x, addPlus: x => Number(x) > 0 ? `+${x}` : x,
  renderAllBooks: () => '', formatKellyValue: () => '', kellyFractionLabel: () => '',
  resolveOppRankValue: () => null, getTDsOppRankColor: () => '', addSuffix: () => '',
  renderTrends: () => '', cardHitRates: () => [], renderCardRecord: () => '',
  document: { createDocumentFragment: () => ({ appendChild() {} }),
    getElementById: id => id === 'player-search' ? { value: 'ny' }
      : id === 'handicap-filter' ? { value: '' }
      : id === 'card-container' ? { appendChild() {}, scrollHeight: 100, clientHeight: 50 }
      : id === 'card-modal-overlay' ? { classList: { add() {} } }
      : { querySelectorAll: () => [], appendChild() {} } },
  createNewCard: (data, id) => { renderedIds.push(id); return { querySelector: () => null }; },
  renderCards: data => { queryRows = data; },
});
vm.runInContext(helpers, context);
vm.runInContext(slice(card, 'function cardStateKey(', 'function clearCardOpenState('), context);
vm.runInContext(slice(card, 'function loadMoreCards(', 'function handleScroll('), context);
vm.runInContext(slice(card, 'function showCardModal(', 'function createNewCard('), context);
vm.runInContext(slice(card, 'function applyFilters(', 'const debouncedApplyFilters'), context);
vm.runInContext(slice(card, 'function updateExistingCard(', 'function renderCards('), context);
vm.runInContext(slice(shared, 'const basePlayerFormatter =', 'function getGoalieColor(') + '\nthis.basePlayerFormatter = basePlayerFormatter;', context);
vm.runInContext(slice(shared, 'const percentFormatter =', 'const decimalFormatter =')
  + '\nthis.percentFormatter = percentFormatter; this.percentFormatterLYR = percentFormatterLYR;', context);
vm.runInContext(slice(shared, 'const rankingFormatter =', 'const plusMinusFormatter =')
  + '\nthis.rankingFormatter = rankingFormatter;', context);
vm.runInContext(slice(shared, 'function renderGameLogChart(', 'const chartFormatter ='), context);
const lineSection = live.slice(live.indexOf('field: "handicap"'));
const lineCode = slice(lineSection, 'formatter: function(cell) {', '\n\t\t\t\t\t\theaderFilter:').replace(/^formatter: /, '').trim().replace(/,$/, '');
context.lineFormatter = vm.runInContext(`(${lineCode})`, context);
const row = (prop, under = false, extra = {}) => ({ sport: 'nba', player: '', game: 'bos @ ny',
  team: under ? 'ny' : 'bos', opp: under ? 'bos' : 'ny', prop, under, ouIdx: under ? 1 : 0,
  handicap: prop === 'ml' ? '0' : prop === 'spread' ? '-3.5' : '45.5', book: 'fd',
  bookOdds: { fd: '-110/-110' }, line: '-110', ev: '1.0', fairVal: -105, implied: 50,
  ...extra });
const cell = data => ({ getRow: () => ({ getData: () => data }), getValue: () => data.handicap,
  getTable: () => ({ element: { id: 'table' } }) });
let assertions = 0;
function eq(actual, expected) { assert.equal(actual, expected); assertions++; }

for (const [prop, under, expectedName, expectedLine] of [
  ['ml', false, 'BOS', 'ML'], ['ml', true, 'NY', 'ML'],
  ['spread', false, 'BOS', '-3.5'], ['spread', true, 'NY', '+3.5'],
  ['total', false, 'BOS @ NY', 'o45.5'], ['total', true, 'BOS @ NY', 'u45.5'],
  ['away_total', false, 'BOS', 'o45.5'], ['away_total', true, 'BOS', 'u45.5'],
  ['home_total', false, 'NY', 'o45.5'], ['home_total', true, 'NY', 'u45.5'],
]) {
  const data = row(prop, under);
  const display = context.liveNflMainMarket(data);
  eq(display.player, expectedName); eq(display.line, expectedLine);
  eq(context.lineFormatter(cell(data)), expectedLine);
  const desktop = context.basePlayerFormatter(cell(data), { sport: 'nba', noProp: true, fullName: true });
  assert.ok(desktop.includes(expectedName)); assertions++;
  context.updateExistingCard(fakeCard(), data);
  assert.ok(html.includes(`<span class="player-name">${expectedName}</span>`)); assertions++;
  assert.ok(html.includes(`<span class="prop-line">${expectedLine}</span>`)); assertions++;
  assert.ok(!collapsed.innerHTML.includes('Opp Rank') && !collapsed.innerHTML.includes('Trends')
    && !collapsed.innerHTML.includes('undefined') && !collapsed.innerHTML.includes('nullth')); assertions++;
}
eq(context.liveNflMainMarket(row('spread', true, { handicap: '0' })).line, '0');
eq(context.liveNflMainMarket(row('spread', true, { handicap: '3.5' })).line, '-3.5');
eq(context.liveNflMainMarket(row('pass_yds', false, { player: 'josh allen' })), null);
eq(context.liveNflMainMarket(row('ml', false, { sport: 'nhl' })), null);
eq(context.lineFormatter(cell(row('attd', false, { player: 'james cook', handicap: '0.5' }))), '');
eq(context.lineFormatter(cell(row('pass_yds', true, { player: 'josh allen', handicap: '220.5' }))), 'u220.5');
assert.notEqual(context.liveNflMainIdentity(row('ml')), context.liveNflMainIdentity(row('ml', false, { sport: 'nfl' }))); assertions++;
const base = row('ml'), otherGame = row('ml', false, { game: 'lal @ gs' });
const missing = { getRow: () => ({ getData: () => base }), getValue: () => undefined, getField: () => 'oppRank' };
eq(context.percentFormatter(missing), ''); eq(context.percentFormatterLYR(missing), '');
eq(context.rankingFormatter(missing, {}), ''); eq(context.renderGameLogChart(undefined, base), '');
assert.notEqual(context.cardStateKey(base), context.cardStateKey(otherGame)); assertions++;
assert.notEqual(context.liveNflMainIdentity(base), context.liveNflMainIdentity(row('ml', true))); assertions++;
assert.notEqual(context.liveNflMainIdentity(row('spread')), context.liveNflMainIdentity(row('spread', false, { handicap: '-4.5' }))); assertions++;
eq(context.liveNflMainIdentity(base), context.liveNflMainIdentity({ ...base, line: '+120', ev: '3.5' }));
context.ALL_CARD_DATA = [base, otherGame]; context.CURRENT_CARD_INDEX = 0;
context.loadMoreCards();
eq(renderedIds.length, 2); assert.notEqual(renderedIds[0], renderedIds[1]); assertions++;
context.showCardModal(base);
eq(renderedIds[2], `modal-${renderedIds[0]}`);
context.MASTER_DATA = [base, otherGame]; context.applyFilters();
eq(queryRows.length, 1); eq(queryRows[0].game, 'bos @ ny');
context.PREVIOUS_DATA = [row('ml', false, { ev: '0' })];
const updated = fakeCard(); context.updateExistingCard(updated, base);
eq(updated.style.backgroundColor, 'rgba(100, 181, 246, 0.3)');
context.PAGE = 'main';
eq(context.liveNflMainMarket(base), null);
eq(context.liveNflMainIdentity(base), '');
context.updateExistingCard(fakeCard(), row('spread', true, { handicap: '3.5' }));
assert.ok(html.includes('<span class="prop-line">+3.5</span>')); assertions++;
context.PAGE = 'live'; context.SPORT = 'nhl';
const hockey = row('atgs', false, { sport: 'nhl', player: 'jack hughes', handicap: '0.5' });
eq(context.liveNflMainIdentity(hockey), '');
eq(context.cardStateKey(hockey), 'cardOpen:jack hughes|atgs|O|0.5');
context.updateExistingCard(fakeCard(), hockey);
assert.ok(html.includes('<span class="prop-line">o0.5</span>')); assertions++;

// Backend supplies the selected-side link already; cards must not reverse it again.
context.cardBookOrder = odds => Object.keys(odds);
context.resolveLink = url => url;
vm.runInContext(slice(card, 'function renderAllBooks(', 'function renderCardRecord('), context);
const quotes = context.renderAllBooks({ fd: '-110/-105' }, 'fd', { fd: 'https://example.test/home-spread' }, { fd: [150, 250] });
assert.ok(quotes.includes('href="https://example.test/home-spread"')); assertions++;
assert.ok(quotes.includes('$150/$250')); assertions++;

// Parse every inline script, including the actual table-column formatter.
for (const match of live.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/\bsrc\s*=/.test(match[1]) && match[2].trim()) new vm.Script(match[2]);
}
console.log(`${assertions} assertions passed: desktop/mobile main markets, both sides, identities, search, refresh, legacy pages and inline syntax.`);

// An ended NBA slate must clear the mobile model and DOM as well as Tabulator.
let applyLiveData, headerRefreshes = 0, desktopRows = ['stale'];
const nodes = new Map();
const getNode = id => {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: 'stale', value: '', dataset: {}, addEventListener() {} });
  return nodes.get(id);
};
const emptyContext = vm.createContext({ SPORT: 'nba', PAGE: 'live', UPDATED: {}, RES: null,
  GAME: '', PROP: '', PRETTY: undefined, IMP: undefined, MASTER_DATA: [{ ev: 1 }],
  ALL_CARD_DATA: [{ ev: 1 }], PREVIOUS_DATA: [{ ev: 1 }], CURRENT_CARD_INDEX: 20,
  TABLE: { options: {}, async replaceData(rows) { desktopRows = rows; }, redraw() {} },
  document: { getElementById: getNode, querySelector: () => getNode('table-container') },
  createDataRefresh: (url, apply) => { applyLiveData = apply; }, refreshDataTimestamps() {},
  createOption() {}, restoreChkddState() {}, updateHeaders() { headerRefreshes++; },
  changeFilter() { throw new Error('Empty snapshot should clear directly'); },
  loadMoreCards() {}, handleScroll() {},
});
vm.runInContext(slice(card, 'function initializeCards(', 'const debouncedApplyFilters'), emptyContext);
vm.runInContext(card.slice(card.indexOf('function renderCards(')), emptyContext);
vm.runInContext(slice(live, 'const fetchProps = createDataRefresh(', 'const LIVE_DEFAULT_COL_ORDER'), emptyContext);
await applyLiveData({ data: [], games: [], props: [], times: {}, updated: {} });
assert.equal(desktopRows.length, 0);
for (const key of ['MASTER_DATA', 'ALL_CARD_DATA', 'PREVIOUS_DATA']) assert.equal(emptyContext[key].length, 0);
assert.equal(emptyContext.CURRENT_CARD_INDEX, 0);
assert.equal(getNode('card-container').innerHTML, '');
assert.equal(headerRefreshes, 1);
assert.equal(emptyContext.TABLE.options.placeholder, 'No live markets available.');
console.log('NBA empty refresh passed: desktop, mobile DOM, stored card rows and book timestamps clear.');
