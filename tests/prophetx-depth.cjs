const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const depth = require('../novig-depth.js');
const prediction = require('../prediction-depth.js');
const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const options = {book:'px'};
// Only the available dollars and taker American odds are sizing authorities.
const order = (odds, value) => ({opposite_odds:odds, opposite_stake_usd:value,
  stake_usd:'999999', contracts:999999, payout_usd:'999999', probability:'0.001', odds:'-99999'});
function fixture() {
  const row = {player:'leon draisaitl', game:'edm @ utah', prop:'atgs', handicap:'0.5', dt:'2026-10-28',
    bookOdds:{px:'900/-1100',fd:'300/-400'}, liquidity:{px:[9999,8888]}};
  const entry = {schema_version:1,market_id:'1700082200',event_id:'1704703224',updated:stamp(-60000),
    expires_at:stamp(240000),starts_at:'2026-10-28T23:00:00Z',sides:[
      {side:'over',orders:[order('-350','210')],truncated:false},
      {side:'under',orders:[order('-121','121'),order('-122','159.22'),order('-345','207'),order('-355','3.55')],truncated:false}]};
  const payload={data:[row,{...row,under:true}],updated:{px:stamp(-60000),fd:stamp(-60000)},times:{[row.game]:entry.starts_at},prophetxDepth:{[row.game]:{[row.player]:entry}}};
  return {row,entry,payload};
}
const inspect = f => depth.inspect(f.row,f.payload,{...options,now:NOW});
const merged = f => prediction.collect(f.row,f.payload.data,f.payload,{now:NOW,novigDepth:depth});

test('ProphetX uses available USD and never the original stake or invented contracts',()=>{
  const [got]=depth.normalizeOrders([order('-121','121')],options);
  assert.equal(got.stake_usd,100);
  assert.equal(got.opposite_stake_usd,121);
  assert.equal(got.payout_usd,221);
  assert.equal(got.odds,121);
  assert.equal(got.opposite_odds,-121);
  assert.equal(Object.hasOwn(got,'contracts'),false);
  assert.equal(depth.wholeStake([got]),'$100');
  assert.equal(depth.wholeStake([got],true),'$121');
});

test('ProphetX full positive and fractional ladders preserve available dollars',()=>{
  const orders=depth.normalizeOrders([order('300','100'),order('-132','1387.08')],options);
  assert.equal(orders[0].stake_usd,300);
  assert.equal(orders[0].payout_usd,400);
  assert.equal(orders[1].opposite_stake_usd,1387.08);
  assert.ok(Math.abs(orders[1].stake_usd-1050.8181818181818)<1e-9);
  assert.equal(depth.wholeStake([orders[1]]),'$1,050');
  assert.equal(depth.wholeStake(depth.normalizeOrders([order('100','0.29'),order('100','0.71')],options)),'$1');
});

test('rational maker amount thresholds and American equality are exact',()=>{
  const orders=depth.normalizeOrders([order('-121','121')],options);
  assert.equal(depth.compareOrders(orders,{odds:121}).matching.length,0);
  assert.equal(depth.compareOrders(orders,{odds:122}).substantial,true);
  assert.equal(depth.compareOrders(orders,{odds:122},'100.000000000000000001').substantial,false);
  const other=depth.normalizeOrders([order('-132','1387.08')],options);
  assert.equal(depth.compareOrders(other,{odds:133},'1050.818181818181818181818181818').substantial,true);
  assert.equal(depth.compareOrders(other,{odds:133},'1050.818181818181818181818181819').substantial,false);
});

test('fourth executable level is retained with correct independent Yes and No books',()=>{
  const f=fixture(),before=JSON.stringify(f), result=inspect(f);
  assert.equal(result.available,true);
  assert.equal(result.provider.name,'ProphetX');
  assert.deepEqual(result.availableBooks[0].orders.map(o=>[o.odds,o.stake_usd]),[[-121,121],[-122,159.22],[-345,207],[-355,3.55]]);
  assert.deepEqual(result.availableBooks[1].orders.map(o=>[o.odds,o.stake_usd]),[[-350,210]]);
  assert.match(depth.renderResult(result),/\$490/);
  assert.match(depth.renderPreview(result,f.row),/ProphetX/);
  assert.match(depth.renderResult(result,'resting'),/before fees/);
  assert.equal(JSON.stringify(f),before);
});

test('full depth replaces duplicate top quotes in combined prediction markets',()=>{
  const f=fixture(), result=merged(f);
  assert.equal(result.sides.over.levels.filter(o=>o.book==='px').length,4);
  assert.equal(result.sides.under.levels.filter(o=>o.book==='px').length,1);
  assert.equal(result.sources.find(s=>s.book==='px').kind,'depth');
  assert.match(prediction.renderSide(result,'over'),/ProphetX: available depth/);
  f.entry.sides[1].truncated=true;
  assert.match(prediction.renderSide(merged(f),'over'),/ProphetX: top 100/);
});

test('invalid or expired explicit depth cannot revive top prices',()=>{
  for(const changes of [{updated:stamp(-300001)},{updated:stamp(1)},{expires_at:stamp(0)},{starts_at:stamp(0)},{schema_version:2}]) {
    const f=fixture(); Object.assign(f.entry,changes);
    assert.equal(inspect(f).available,false);
    assert.equal(merged(f).sides.over.levels.some(o=>o.book==='px'),false);
  }
  const f=fixture(); f.entry.sides[1].orders=[];
  assert.equal(merged(f).sides.over.levels.some(o=>o.book==='px'),false);
  assert.equal(merged(f).sides.under.levels.some(o=>o.book==='px'),true);
});

test('no alternate line, date or blurred row may use ATGS depth',()=>{
  for(const changes of [{handicap:'1.5'},{prop:'fgs'},{dt:'2026-10-29'},{blurred:true}]) {
    const f=fixture(); Object.assign(f.row,changes);
    assert.equal(inspect(f).available,false);
  }
  const f=fixture(); f.row.handicap='1.5';
  assert.equal(merged(f).sources.find(s=>s.book==='px').kind,'top');
});

test('no available money is inferred for malformed or missing source fields',()=>{
  for(const value of [undefined,null,true,'',0,-1,'NaN','Infinity','1e3']) {
    assert.deepEqual(depth.normalizeOrders([order('300',value)],options),[]);
  }
  for(const odds of [undefined,null,true,'',0,99,-99,'NaN']) {
    assert.deepEqual(depth.normalizeOrders([order(odds,'100')],options),[]);
  }
  assert.deepEqual(depth.normalizeOrders(Array(101).fill(order('300','100')),options),[]);
});

test('ATGS PX column uses shared formatter while retaining existing books',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../atgs.html'),'utf8');
  assert.match(html,/bookOdds_px[^\n]*NovigDepth\.formatter\(evOddsFormatter, \{book: 'px'\}\)/);
  assert.match(html,/bookOdds_kal[^\n]*NovigDepth\.formatter\(evOddsFormatter, \{book: 'kal'\}\)/);
});
