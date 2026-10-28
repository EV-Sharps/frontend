'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const depth = require('../prediction-depth.js');
const novig = require('../novig-depth.js');

const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
function fixture() {
  const selected = {player: 'test player', game: 'tor @ bos', sport: 'nhl', prop: 'atgs', handicap: '.5', dt: '2026-10-28', under: false};
  const row = {...selected, bookOdds: {nv: '1100/-1200', px: '1200/-1300', kal: '900/-1100', poly: '1000/-1250'},
    liquidity: {nv: [40, 90], px: [100, 120], kal: [25, 15], poly: [75, 80]}};
  const rows = [row, {...row, under: true}];
  const payload = {data: rows, times: {'tor @ bos': '2026-10-28T23:00:00Z'},
    updated: {nv: stamp(-60000), px: stamp(-60000), kal: stamp(-60000), poly: stamp(-60000)}};
  return {selected, row, rows, payload};
}
function inspect(f, options = {}) { return depth.collect(f.selected, f.rows, f.payload, {now: NOW, novigDepth: novig, ...options}); }
function withNovig(f) {
  const entry = {schema_version: 1, market_id: 'fixture-market', updated: stamp(-60000), expires_at: stamp(240000), starts_at: f.payload.times[f.row.game], sides: [
    {side: 'over', orders: [{probability: '0.075', contracts: 1407}], truncated: false},
    {side: 'under', orders: [{probability: '0.92', contracts: 9630}, {probability: '0.915', contracts: 98074}, {probability: '0.91', contracts: 100000}], truncated: true}
  ]};
  f.row.handicap = '0.5';
  f.rows[1].handicap = '0.5';
  f.payload.novigDepth = {[f.row.game]: {[f.row.player]: entry}};
  return entry;
}

test('top quotes sort by payout and duplicate Over/Under rows never double count liquidity', () => {
  const got = inspect(fixture());
  assert.equal(got.available, true);
  assert.deepEqual(got.lines, [.5]);
  assert.deepEqual(got.sides.over.levels.map(level => level.book), ['px', 'nv', 'poly', 'kal']);
  assert.deepEqual(got.sides.under.levels.map(level => level.book), ['kal', 'nv', 'poly', 'px']);
  assert.equal(got.sides.over.totalStake, 240);
  const payout = 100 * 13 + 40 * 12 + 75 * 11 + 25 * 10;
  assert.equal(got.sides.over.averageOdds, Math.round((payout / 240 - 1) * 100));
  assert.ok(got.sources.every(source => source.kind === 'top'));
});

test('collect only the exact player, prop, line, game, sport and date', () => {
  const f = fixture();
  for (const changes of [{player:'other'}, {game:'bos @ tor'}, {prop:'sog'}, {sport:'nba'}, {dt:'2026-10-29'}, {date:'2026-10-29'}, {blurred:true}]) {
    f.rows.push({...f.row, ...changes, bookOdds:{px:'9999/-10000'}, liquidity:{px:[9999,9999]}});
  }
  f.rows.push({...f.row, handicap:'1.5', bookOdds:{px:'5000'}, liquidity:{px:[1000]}});
  const got = inspect(f);
  assert.deepEqual(got.lines, [.5, 1.5]);
  assert.equal(got.sides.over.totalStake, 240);
  f.selected.handicap = '1.5';
  assert.deepEqual(inspect(f).sides.over.levels.map(level => level.odds), [5000]);
});

test('selected snapshots cannot survive removal or current access restrictions', () => {
  const f = fixture();
  f.rows = [];
  assert.equal(inspect(f).available, false);
  f.rows = [{...f.row, blurred:true}];
  assert.equal(inspect(f).available, false);
  f.rows = [f.row];
  f.selected.blurred = true;
  assert.equal(inspect(f).available, false);
});

test('missing one side stays missing and invalid odds or nonpositive sizes never invent levels', () => {
  const f = fixture();
  f.rows = [{...f.row, bookOdds:{nv:'200', px:'bad/250', kal:'0/0', poly:'300/-400/100'}, liquidity:{nv:[0,100],px:[100,50]}}];
  const got = inspect(f);
  assert.deepEqual(got.sides.over.levels, []);
  assert.deepEqual(got.sides.under.levels.map(level => [level.book, level.odds, level.stake]), [['px',250,50]]);
});

test('unknown liquidity stays unknown; formatted positive USD is parsed and never treated as contracts', () => {
  const f = fixture();
  f.rows = [{...f.row, liquidity:{nv:['$1,200', 100], px:[null,100], kal:['',100], poly:[true,100]}}];
  const got = inspect(f);
  assert.equal(got.sides.over.totalStake, 1200);
  assert.equal(got.sides.over.unknownSizes, 3);
  assert.equal(got.sides.over.levels.find(level => level.book === 'nv').stake, 1200);
  assert.equal(got.sides.over.levels.find(level => level.book === 'px').stake, null);
  assert.match(depth.renderSide(got, 'over'), /Size unknown/);
  assert.match(depth.renderSide(got, 'over'), /excluded from the total and average/);
});

test('duplicate rows can fill unknown size only for the exact displayed odds', () => {
  const f = fixture();
  f.rows = [{...f.row, bookOdds:{px:'200/-250'}, liquidity:{}},
    {...f.row, bookOdds:{px:'210/-250'}, liquidity:{px:[999,40]}},
    {...f.row, bookOdds:{px:'200/-250'}, liquidity:{px:[100,50]}}];
  const got = inspect(f);
  assert.deepEqual(got.sides.over.levels.map(level => [level.odds, level.stake]), [[200,100]]);
  assert.equal(got.sides.under.totalStake, 40);
});

test('known stale, future and started quotes are omitted; missing timestamps are explicitly unverified', () => {
  const f = fixture();
  f.payload.updated.nv = stamp(-depth.MAX_AGE_MS - 1);
  f.payload.updated.px = stamp(1);
  delete f.payload.updated.kal;
  f.payload.updated.poly = '2026-10-28T17:59:00'; // No timezone; do not guess.
  const got = inspect(f);
  assert.deepEqual(got.sides.over.levels.map(level => level.book), ['poly','kal']);
  assert.ok(got.sides.over.levels.every(level => level.time === 'unverified'));
  assert.match(depth.renderSide(got, 'over'), /Time unverified/);
  assert.match(depth.renderSide(got, 'over'), /more than 15 minutes old/);
  f.payload.times[f.row.game] = stamp(0);
  assert.equal(inspect(f).available, false);
  assert.match(inspect(f).reason, /started/);
});

test('fresh full NV executable depth replaces its top quote and complements the opposite maker side', () => {
  const f = fixture();
  withNovig(f);
  const got = inspect(f);
  const levels = got.sides.over.levels.filter(level => level.book === 'nv');
  assert.deepEqual(levels.map(level => level.odds), [1150,1076,1011]);
  assert.deepEqual(levels.map(level => level.probability), [.08,.085,.09]);
  assert.ok(Math.abs(levels[0].stake - 7.704) < 1e-9);
  assert.equal(levels.length, 3);
  assert.equal(got.sides.under.levels.filter(level => level.book === 'nv').length, 1);
  assert.deepEqual(got.sources.find(source => source.book === 'nv').truncated, {over: true, under: false});
  assert.match(depth.renderSide(got, 'over'), /Novig: top 20 levels/);
  assert.match(depth.renderSide(got, 'under'), /Novig: available depth/);
  assert.doesNotMatch(depth.renderSide(got, 'under'), /top 20 levels/);
});

test('empty executable NV side cannot fall back to same-side maker bids or its saved top quote', () => {
  const f = fixture();
  const entry = withNovig(f);
  entry.sides[1].orders = [];
  const got = inspect(f);
  assert.equal(got.sides.over.levels.some(level => level.book === 'nv'), false);
  assert.equal(got.sides.under.levels.some(level => level.book === 'nv'), true);
});

test('whole-dollar display corrects floating point dust while retaining real fractional stakes', () => {
  const f = fixture();
  const entry = withNovig(f);
  entry.sides[1].orders = [{probability:'0.71', contracts:10000}];
  f.rows = [{...f.row,bookOdds:{nv:'200'},liquidity:{nv:[29]}}];
  const markup = depth.renderSide(inspect(f), 'over');
  assert.match(markup, /\$29/);
  assert.doesNotMatch(markup, /\$28(?:<|\b)/);
  f.rows[0].bookOdds = {px:'200'};
  f.rows[0].liquidity = {px:[28.9999]};
  delete f.payload.novigDepth;
  assert.match(depth.renderSide(inspect(f), 'over'), /\$28/);
});

test('expired, invalid and unavailable NV depth blocks fallback to its old best quote', () => {
  for (const changes of [{expires_at:stamp(0)}, {schema_version:2}, {starts_at:stamp(0)}]) {
    const f = fixture();
    Object.assign(withNovig(f), changes);
    const got = inspect(f);
    assert.equal(got.sides.over.levels.some(level => level.book === 'nv'), false);
    assert.equal(got.sources.find(source => source.book === 'nv').kind, 'unavailable');
  }
  const f = fixture();
  withNovig(f);
  assert.equal(depth.collect(f.selected, f.rows, f.payload, {now:NOW,novigDepth:{}}).sides.over.levels.some(level => level.book === 'nv'), false);
});

test('ATGS depth must never be applied to alternate goal lines', () => {
  const f = fixture();
  withNovig(f);
  f.selected.handicap = '1.5';
  f.rows.push({...f.row, handicap:'1.5', bookOdds:{nv:'3000'}, liquidity:{nv:[20]}});
  const got = inspect(f);
  assert.deepEqual(got.sides.over.levels.map(level => [level.odds,level.stake,level.kind]), [[3000,20,'top']]);
});

test('fresh payload changes are recomputed without cached quote/depth flags or source mutation', () => {
  const f = fixture();
  withNovig(f);
  const before = JSON.stringify(f);
  inspect(f);
  assert.equal(JSON.stringify(f), before);
  f.rows = [{...f.row, bookOdds:{px:'800'},liquidity:{px:[35]}}];
  delete f.payload.novigDepth;
  const got = inspect(f);
  assert.deepEqual(got.sides.over.levels.map(level => [level.book,level.odds,level.stake]), [['px',800,35]]);
});

test('markup keeps source coverage, unknown size and before-fee meaning explicit', () => {
  const got = inspect(fixture());
  const markup = depth.renderSide(got, 'over');
  assert.match(markup, /best quote only/);
  assert.match(markup, /Before fees/);
  assert.match(markup, /Displayed liquidity/);
  assert.match(markup, /Average payout odds/);
  assert.doesNotMatch(markup, /sharps|executed volume|full depth available/i);
});

test('matching prices merge across exchanges with individual source stakes in stable book order', () => {
  const f = fixture();
  f.rows = [{...f.row, bookOdds:{kal:'300/-400', px:'300/-400', nv:'300/-400', poly:'600/-700'},
    liquidity:{nv:[40,90], px:[100,120], kal:[25,15], poly:[75,80]}}];
  const got = inspect(f);
  assert.deepEqual(got.sides.over.groups.map(group => group.odds), [600,300]);
  const group = got.sides.over.groups[1];
  assert.equal(group.stake, 165);
  assert.equal(group.unknownSizes, 0);
  assert.deepEqual(group.sources.map(source => [source.book,source.stake]), [['nv',40],['px',100],['kal',25]]);
  assert.equal(got.sides.over.levels.length, 4, 'Grouping must retain each raw exchange quote');
  assert.equal(got.sides.over.totalStake, 240);
  assert.deepEqual(got.sides.under.groups.map(group => group.odds), [-400,-700]);
  assert.equal(got.sides.under.groups[0].stake, 225, 'Over and Under sizes remain independent');
});

test('multiple raw levels from one book at the same displayed price remain intact and sum once', () => {
  const levels = [
    {book:'kal', odds:200, probability:.3337, stake:20, kind:'depth'},
    {book:'nv', odds:200, probability:.3336, stake:30, kind:'depth'},
    {book:'nv', odds:200, probability:.3332, stake:40, kind:'depth'},
    {book:'px', odds:200, probability:1/3, stake:50, kind:'top'},
  ];
  const groups = depth.groupLevels(levels);
  assert.equal(groups.length, 1);
  const group = groups[0];
  assert.equal(group.odds, 200);
  assert.equal(group.probability, .3332);
  assert.equal(group.stake, 140);
  assert.deepEqual(group.sources.map(source => [source.book,source.stake]), [['nv',70],['px',50],['kal',20]]);
  assert.equal(group.sources[0].levels.length, 2);
  assert.equal(group.sources[0].levels[0], levels[1]);
  assert.equal(group.sources[0].levels[1], levels[2]);
  assert.equal(group.sources.reduce((sum, source) => sum + source.levels.length, 0), levels.length);
});

test('even-money -100 and +100 quotes share a single +100 group', () => {
  const f = fixture();
  f.rows = [{...f.row, bookOdds:{nv:'-100/-120',px:'100/-120',kal:'+100/-120'}, liquidity:{nv:[20,30],px:[40,50],kal:[60,70]}}];
  const got = inspect(f);
  assert.deepEqual(got.sides.over.groups.map(group => [group.odds,group.stake]), [[100,120]]);
  assert.deepEqual(got.sides.over.levels.map(level => level.odds), [-100,100,100], 'Raw quoted signs are preserved');
  assert.equal(got.sides.over.averageOdds, 100);
});

test('fractional American quotes merge only when their rendered prices match', () => {
  const levels = [
    {book:'nv',odds:200.12341,probability:100/300.12341,stake:50},
    {book:'px',odds:200.12349,probability:100/300.12349,stake:70},
    {book:'kal',odds:200.12351,probability:100/300.12351,stake:80},
  ];
  const groups = depth.groupLevels(levels);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.odds.toLocaleString('en-US')), ['200.124','200.123']);
  assert.deepEqual(groups[1].sources.map(source => source.book), ['nv','px']);
  assert.equal(groups[1].stake, 120);
  assert.equal(groups[1].sources[0].levels[0].probability, levels[0].probability);
  assert.equal(groups[1].sources[1].levels[0].probability, levels[1].probability);
});

test('rounded matching depth prices retain exact probabilities for total payout and average', () => {
  const f = fixture();
  const entry = withNovig(f);
  entry.sides[1].orders = [{probability:'0.6662',contracts:27000}, {probability:'0.6671',contracts:3000}];
  f.rows = [{...f.row,bookOdds:{nv:'200',px:'301'},liquidity:{nv:[999],px:[100]}}];
  const got = inspect(f).sides.over;
  assert.deepEqual(got.groups.map(group => group.odds), [301,200]);
  assert.equal(got.groups[1].sources[0].levels.length, 2);
  assert.ok(Math.abs(got.groups[1].stake - 100.113) < 1e-10);
  assert.ok(Math.abs(got.totalStake - 200.113) < 1e-10);
  const exactPayout = got.levels.reduce((sum, level) => sum + level.stake / level.probability, 0);
  assert.ok(Math.abs(exactPayout - 701) < 1e-9);
  assert.equal(got.averageOdds, 250);
  const collapsedPayout = got.groups.reduce((sum, group) => sum + group.stake / group.probability, 0);
  assert.equal(Math.round(100 * (collapsedPayout / got.totalStake - 1)), 251,
    'Averaging using the best price of a merged group would incorrectly change the result');
});

test('unknown sizes stay unknown within merged books and never become zero liquidity', () => {
  const levels = [
    {book:'nv',odds:300,probability:.25,stake:null},
    {book:'nv',odds:300,probability:.25,stake:25},
    {book:'px',odds:300,probability:.25,stake:null},
    {book:'kal',odds:500,probability:1/6,stake:null},
    {book:'poly',odds:500,probability:1/6,stake:null},
  ];
  const groups = depth.groupLevels(levels);
  const mixed = groups.find(group => group.odds === 300), unknown = groups.find(group => group.odds === 500);
  assert.equal(mixed.stake, 25);
  assert.equal(mixed.unknownSizes, 2);
  assert.deepEqual(mixed.sources.map(source => [source.book,source.stake,source.unknownSizes]), [['nv',25,1],['px',null,1]]);
  assert.equal(unknown.stake, null);
  assert.equal(unknown.unknownSizes, 2);
  assert.ok(unknown.sources.every(source => source.stake === null));
});

test('grouping never mutates raw levels, their order, source price, or precise size', () => {
  const levels = Object.freeze([
    Object.freeze({book:'kal',odds:200,probability:.3332,stake:12.34567,kind:'depth'}),
    Object.freeze({book:'nv',odds:400,probability:.2,stake:67.89123,kind:'top'}),
    Object.freeze({book:'px',odds:200,probability:1/3,stake:null,kind:'top'}),
  ]);
  const before = JSON.stringify(levels);
  const groups = depth.groupLevels(levels);
  assert.equal(JSON.stringify(levels), before);
  assert.deepEqual(groups.map(group => group.odds), [400,200]);
  assert.equal(groups[1].sources.find(source => source.book === 'kal').stake, 12.34567);
  assert.equal(groups[0].sources[0].levels[0], levels[1]);
});

test('merged rows render one price and proportional per-book colored bar segments', () => {
  const f = fixture();
  f.rows = [{...f.row,bookOdds:{nv:'300',px:'300',kal:'300'},liquidity:{nv:[25],px:[50],kal:[25]}}];
  const html = depth.renderSide(inspect(f), 'over');
  assert.equal((html.match(/<li class="prediction-depth-level"/g) || []).length, 1);
  assert.equal((html.match(/class="prediction-depth-odds"/g) || []).length, 1);
  const segments = [...html.matchAll(/class="prediction-depth-segment" data-book="(nv|px|kal)" style="width:([\d.]+)%"/g)]
    .map(([,book,width]) => [book,Number(width)]);
  assert.deepEqual(segments, [['nv',25],['px',50],['kal',25]]);
  for (const book of ['nv','px','kal']) assert.match(html, new RegExp(`class="prediction-depth-source" data-book="${book}"`));
  assert.match(html, /Novig: \$25\.00/);
  assert.match(html, /ProphetX: \$50\.00/);
  assert.match(html, /Kalshi: \$25\.00/);
});

test('unknown source size is disclosed on a merged row without inventing a bar segment', () => {
  const f = fixture();
  f.rows = [{...f.row,bookOdds:{nv:'300',px:'300',kal:'300'},liquidity:{nv:[25],kal:[75]}}];
  const got = inspect(f);
  const group = got.sides.over.groups[0];
  assert.equal(group.stake, 100);
  assert.equal(group.unknownSizes, 1);
  assert.equal(got.sides.over.totalStake, 100);
  const html = depth.renderSide(got, 'over');
  assert.match(html, /class="prediction-depth-source" data-book="px"/);
  assert.match(html, /ProphetX: size unknown/);
  assert.match(html, /\$100 \+ \?/);
  assert.doesNotMatch(html, /class="prediction-depth-segment" data-book="px"/);
  assert.match(html, /class="prediction-depth-segment" data-book="nv" style="width:25(?:\.0+)?%"/);
  assert.match(html, /class="prediction-depth-segment" data-book="kal" style="width:75(?:\.0+)?%"/);
});
