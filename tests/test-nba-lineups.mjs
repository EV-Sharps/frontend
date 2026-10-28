import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = fs.readFileSync(path.join(root, 'shared.js'), 'utf8');
const card = fs.readFileSync(path.join(root, 'card.js'), 'utf8');
function slice(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} source block exists`);
  return source.slice(a, b);
}
let cardHtml = '';
const collapsed = { innerHTML: '', classList: { toggle() {}, contains: () => false } };
const header = { set innerHTML(value) { cardHtml = value; } };
const fakeCard = () => ({ dataset: { uniqueId: 'fixture' }, style: {}, classList: { toggle() {} },
  querySelector: selector => selector === '.card-header' ? header : collapsed });
const context = vm.createContext({ PAGE: 'nba', SPORT: 'nba', PLAYER: '', MOBILE: false,
  window: {},
  DEVIG: '', PREVIOUS_DATA: [], CURR_USER: null, TEAM: '',
  localStorage: { getItem: () => null }, setTimeout() {},
  title: value => String(value || '').replace(/\b[a-z]/g, x => x.toUpperCase()),
  getGameImgs: () => ['AWAY', 'HOME'], getTeamImg: (sport, team) => `[${sport}:${team}]`,
  playerLinesName: (data, name) => name, createWatchlistStar: () => null,
  liveNflMainMarket: () => null, liveNflMainIdentity: () => null,
  evCardFormatter: () => '', plusFormatter: x => x, propFormatter: () => '',
  renderAllBooks: () => '', formatKellyValue: () => '', kellyFractionLabel: () => '',
  resolveOppRankValue: () => null, getTDsOppRankColor: () => '', addSuffix: () => '',
  renderTrends: () => '', cardHitRates: () => [], renderCardRecord: () => '',
  cardStateKey: () => 'fixture',
  mountCardGameLogs: () => {},
});
vm.runInContext(slice(shared, 'function nbaLineupBadge(', 'function playerLinesName('), context);
vm.runInContext(slice(shared, 'const oppFormatter =', 'const feedPitcherFormatter =')
  + '\nthis.oppFormatter = oppFormatter;', context);
vm.runInContext(slice(shared, 'const basePlayerFormatter =', 'function getGoalieColor(')
  + '\nthis.basePlayerFormatter = basePlayerFormatter;', context);
vm.runInContext(slice(card, 'function updateExistingCard(', 'function renderCards('), context);
const row = extra => ({ sport: 'nba', player: 'jalen brunson', game: 'bos @ ny', team: 'ny',
  opp: 'bos', prop: 'pts', handicap: 25.5, line: -110, under: false, book: 'fd',
  bookOdds: { fd: '-110/-110' }, starting: true, lineupStatus: 'expected', confirmed: false,
  ...extra });
const cell = data => ({ getRow: () => ({ getData: () => data }), getValue: () => data.player,
  getTable: () => ({ element: { id: 'table' } }) });
let checks = 0;
const eq = (actual, expected) => { assert.equal(actual, expected); checks++; };
function includes(actual, expected) { assert.ok(actual.includes(expected), expected); checks++; }
function excludes(actual, expected) { assert.ok(!actual.includes(expected), `no ${expected}`); checks++; }

for (const [status, confirmed, label, background] of [
  ['expected', false, 'Expected starter', 'transparent'],
  ['confirmed', true, 'Confirmed starter', '#4ade80'],
]) {
  for (const page of ['nba', 'pts', 'threes', 'fb', 'kotc', 'outliers']) {
    context.PAGE = page;
    const data = row({ lineupStatus: status, confirmed, prop: page === 'fb' ? 'fb' : 'pts' });
    const badge = context.nbaLineupBadge(data);
    includes(badge, `title="${label}"`);
    includes(badge, `aria-label="${label}"`);
    includes(badge, `background:${background}`);
    const table = context.basePlayerFormatter(cell(data), { sport: 'nba', noProp: true, fullName: true });
    excludes(table, 'nba-lineup-badge');
    const opponent = context.oppFormatter({ ...cell(data), getValue: () => data.opp }, { is_pitcher: false });
    includes(opponent, 'nba-opp-lineup');
    includes(opponent, badge);
    context.updateExistingCard(fakeCard(), data);
    includes(cardHtml, badge);
  }
}

context.PAGE = 'nba';
for (const data of [row({ starting: false }), row({ starting: null }), row({ starting: undefined }),
  row({ starting: 'true' }), row({ lineupStatus: '' }), row({ lineupStatus: undefined }),
  row({ lineupStatus: 'unconfirmed' }), row({ sport: 'nhl' }), row({ sport: 'nfl' }),
  row({ sport: 'mlb' }), {}]) {
  eq(context.nbaLineupBadge(data), '');
  if (!data.player) continue;
  const table = context.basePlayerFormatter(cell(data), { sport: data.sport, noProp: true, fullName: true });
  excludes(table, 'nba-lineup-badge');
  excludes(context.oppFormatter({ ...cell(data), getValue: () => data.opp }, { is_pitcher: false }), 'nba-lineup-badge');
  context.updateExistingCard(fakeCard(), data);
  excludes(cardHtml, 'nba-lineup-badge');
}

// Feeds lacking an explicit row sport inherit the NBA page's sport.
includes(context.nbaLineupBadge(row({ sport: undefined }), 'nba'), 'Expected starter');
eq(context.nbaLineupBadge(row({ sport: 'nhl' }), 'nba'), '');
context.SPORT = 'nhl';
eq(context.nbaLineupBadge(row({ sport: undefined })), '');

// A refresh can remove a starter flag; cards must remove the former badge too.
context.PAGE = 'nba'; context.SPORT = 'nba';
const reusable = fakeCard();
context.updateExistingCard(reusable, row({ lineupStatus: 'confirmed', confirmed: true }));
includes(cardHtml, 'Confirmed starter');
context.updateExistingCard(reusable, row({ starting: null, lineupStatus: '', confirmed: null }));
excludes(cardHtml, 'nba-lineup-badge');

// Soccer's existing projected/confirmed indicator remains unchanged and independent.
context.PAGE = 'cup'; context.SPORT = 'soccer';
const soccer = row({ sport: 'soccer', prop: 'ast', team: '', starting: true, confirmed: true });
const table = context.basePlayerFormatter(cell(soccer), { sport: 'soccer', noProp: true, fullName: true });
includes(table, 'Confirmed - Starting');
excludes(table, 'nba-lineup-badge');
console.log(`NBA lineup badges: ${checks} checks passed`);
