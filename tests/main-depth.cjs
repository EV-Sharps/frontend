'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const clone = obj => JSON.parse(JSON.stringify(obj));
function harness() {
  const requests = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
  const context = vm.createContext({Date:Clock, URL, AbortController, setTimeout, clearTimeout,
    ACCESS_TOKEN:'fixture-token', API_BASE:'https://api.example', SPORT:'nhl', CURR_USER:{id:'first',tier:'sharp'},
    fetch(url, options) { return new Promise(resolve => requests.push({url:new URL(url),options,resolve})); }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','main-depth.js'),'utf8'), context);
  return {context, requests, depth:context.MainDepth, respond(index, result, status=200) {
    requests[index].resolve({ok:status===200,status,json:async()=>clone(result)});
  }};
}
function fixture(prop='spread', handicap=-1.5, under=false, sport='nhl') {
  const row = {sport,prop,game:'tor @ bos',handicap,under,dt:'2026-10-28',bookOdds:{nv:'120/-140'}};
  const line = prop==='ml'?'0.5':String(prop==='spread'&&under?-handicap:handicap);
  const sides = ['ml','spread'].includes(prop)?['away','home']:['over','under'];
  const entry = {schema_version:1,market_id:'fixture',prop,line,updated:stamp(-60000),expires_at:stamp(240000),starts_at:stamp(18000000),sides:sides.map((side,index)=>({
    side,label:side,outcome_id:side,orders:[{probability:index?.6:.3,odds:index?-150:233,stake_usd:index?60:30,opposite_stake_usd:index?40:70,payout_usd:100}],truncated:false}))};
  const payload = {data:[row],times:{[row.game]:entry.starts_at},mainDepthAvailable:{[row.game]:{[prop]:{[line]:Object.fromEntries(['nv','kal','px'].map(book=>[book,{updated:entry.updated,expires_at:entry.expires_at}]))}}}};
  const result = {schemaVersion:1,sport,book:'nv',game:row.game,prop,line,start:entry.starts_at,entry};
  return {row,payload,result};
}
async function loaded(h,f,book='nv') {const p=h.depth.load(f.row,f.payload,book);await Promise.resolve();h.respond(h.requests.length-1,{...f.result,book});return p;}

test('away and home spread rows share one canonical identity and request',async()=>{
  const h=harness(),away=fixture(),home=fixture('spread',1.5,true);
  assert.equal(h.depth.identity(away.row,away.payload).line,'-1.5');
  assert.equal(h.depth.identity(home.row,home.payload).line,'-1.5');
  assert.deepEqual(Array.from(h.depth.identity(home.row,home.payload).labels),['TOR -1.5','BOS +1.5']);
  const first=h.depth.load(away.row,away.payload,'nv'),second=h.depth.load(home.row,home.payload,'nv');
  await Promise.resolve();assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url.pathname,'/api/main-depth');
  assert.equal(h.requests[0].url.searchParams.get('line'),'-1.5');
  assert.equal(h.requests[0].options.headers.Authorization,'Bearer fixture-token');
  h.respond(0,away.result);assert.equal((await first).available,true);assert.equal((await second).available,true);
});

for(const sport of ['nhl','nfl','nba','ncaaf','mlb','wnba']) test(`${sport} moneyline uses real teams and .5`,()=>{
  const h=harness(),f=fixture('ml',0,true,sport),id=h.depth.identity(f.row,f.payload);
  assert.equal(id.line,'0.5');assert.equal(id.selected,'home');assert.deepEqual(Array.from(id.labels),['TOR','BOS']);
});
for(const prop of ['total','home_total','away_total']) test(`${prop} keeps over/under identity and exact line`,()=>{
  const h=harness(),f=fixture(prop,'6.500',true),id=h.depth.identity(f.row,f.payload);
  assert.equal(id.line,'6.5');assert.equal(id.selected,'under');assert.deepEqual(Array.from(id.labels),['Over 6.5','Under 6.5']);
  assert.ok(id.title.includes(prop==='total'?'Game':prop==='home_total'?'BOS':'TOR'));
});
test('refuses unsupported periods, blurred rows, bad dates, absent starts and kickoff',()=>{
  const h=harness(),f=fixture();
  for(const changes of [{prop:'1p_spread'},{blurred:true},{date:'2026-10-29'},{dt:'2026-10-27'},{handicap:''},{game:'wrong'},{sport:'soccer'}])
    assert.equal(h.depth.identity({...f.row,...changes},f.payload),null);
  assert.equal(h.depth.identity(f.row,{times:{}}),null);
  assert.equal(h.depth.identity(f.row,f.payload,{now:Date.parse(f.result.start)}),null);
});
test('inspection is lazy and manifests enforce at most five-minute freshness',async()=>{
  const h=harness(),f=fixture();assert.equal(h.depth.inspect(f.row,f.payload,'nv').status,'idle');assert.equal(h.requests.length,0);
  for(const age of [300000,300001,-1000]) {
    const changed=clone(f.payload),marker=changed.mainDepthAvailable[f.row.game].spread['-1.5'].nv;
    marker.updated=stamp(-age);marker.expires_at=stamp(100000);
    assert.equal(h.depth.inspect(f.row,changed,'nv').loadable,false);
  }
  f.payload.mainDepthAvailable[f.row.game].spread['-1.5'].nv.expires_at=stamp(300000);
  assert.equal(h.depth.inspect(f.row,f.payload,'nv').loadable,false);
});
test('available stakes come only from opposite resting orders; duplicate rows never sum twice',async()=>{
  const h=harness(),f=fixture();f.payload.data.push({...f.row,under:true,handicap:1.5});await loaded(h,f);
  const take=h.depth.collect(f.row,f.payload,{book:'nv'}),rest=h.depth.collect(f.row,f.payload,{book:'nv',mode:'resting'});
  assert.equal(take.sides[0].total,40);assert.equal(take.sides[1].total,70);
  assert.equal(take.sides[0].levels[0].odds,150);
  assert.equal(rest.sides[0].total,30);assert.equal(rest.sides[1].total,60);
  assert.equal(take.sides[0].levels.length,1);
  assert.ok(h.depth.render(take).includes('TOR -1.5'));
  assert.ok(h.depth.render(rest,'resting').includes('not completed bets'));
});
test('aggregates venue stakes once and respects exchange selection',async()=>{
  const h=harness(),f=fixture();for(const book of ['nv','kal','px'])await loaded(h,f,book);
  const all=h.depth.collect(f.row,f.payload);assert.equal(all.sides[0].total,120);assert.equal(all.sides[1].total,210);
  assert.equal(h.depth.collect(f.row,f.payload,{book:'px'}).sides[0].total,40);
  assert.equal(h.requests.length,3);
});
test('invalid amounts, duplicated prices, and missing liquidity cannot inflate depth',()=>{
  const h=harness(),f=fixture(),ctx=h.depth.inspect(f.row,f.payload,'nv').market;
  const entry=f.result.entry;
  entry.sides[0].orders.push(clone(entry.sides[0].orders[0]),{probability:.4,stake_usd:40,payout_usd:100},
    {probability:.5,stake_usd:100,opposite_stake_usd:50,payout_usd:150},
    {probability:.6,stake_usd:'NaN',opposite_stake_usd:50,payout_usd:100});
  assert.equal(h.depth.normalize(entry,ctx).sides[0].orders.length,1);
  entry.sides=[entry.sides[0],entry.sides[0]];assert.equal(h.depth.normalize(entry,ctx),null);
});
test('scope mismatch, schema mismatch and stale responses are never cached',async()=>{
  for(const changes of [{line:'1.5'},{prop:'total'},{game:'bos @ tor'},{sport:'nba'},{book:'px'},{schemaVersion:2},{start:stamp(19000000)}]) {
    const h=harness(),f=fixture(),p=h.depth.load(f.row,f.payload,'nv');await Promise.resolve();h.respond(0,{...f.result,...changes});
    assert.equal((await p).available,false);assert.equal(h.depth.inspect(f.row,f.payload,'nv').status,'error');
  }
  const h=harness(),f=fixture();f.result.entry.updated=stamp(-300000);
  assert.equal((await loaded(h,f)).available,false);
});
test('cached depth expires even without a new table response',async()=>{
  const h=harness(),f=fixture();await loaded(h,f);
  assert.equal(h.depth.inspect(f.row,f.payload,'nv',{now:NOW+239999}).available,true);
  assert.equal(h.depth.inspect(f.row,f.payload,'nv',{now:NOW+240000}).available,false);
});
test('source start may differ by seven minutes while the response retains the requested schedule identity',async()=>{
  for (const minutes of [-7,7,-20,20]) {
    const h=harness(),f=fixture();
    f.result.entry.starts_at=new Date(Date.parse(f.result.start)+minutes*60000).toISOString();
    assert.equal((await loaded(h,f)).available,true,`Source offset ${minutes} minutes`);
    assert.equal(h.requests[0].url.searchParams.get('start'),f.result.start);
  }
});
test('source start rejects offsets beyond twenty minutes, naive timestamps and a different Eastern date',()=>{
  const h=harness(),f=fixture(),ctx=h.depth.inspect(f.row,f.payload,'nv').market;
  for(const start of [stamp(18000000+1200001),stamp(18000000-1200001),'2026-10-28T23:00:00','invalid']) {
    assert.equal(h.depth.normalize({...f.result.entry,starts_at:start},ctx),null);
  }
  // Ten minutes apart, but on opposite sides of midnight in New York.
  const schedule=Date.parse('2026-10-29T04:05:00Z');
  assert.equal(h.depth.normalize({...f.result.entry,starts_at:'2026-10-29T03:55:00Z'},
    {...ctx,start:'2026-10-29T04:05:00Z',starts:schedule}),null);
});
test('source and scheduled starts must both remain upcoming and both bound expiry',()=>{
  const h=harness(),f=fixture(),ctx=h.depth.inspect(f.row,f.payload,'nv').market;
  const near={...ctx,start:stamp(120000),starts:NOW+120000};
  assert.equal(h.depth.normalize({...f.result.entry,starts_at:stamp(-1000),expires_at:stamp(60000)},near),null);
  assert.equal(h.depth.normalize({...f.result.entry,starts_at:stamp(60000),expires_at:stamp(90000)},near),null);
  assert.equal(h.depth.normalize({...f.result.entry,starts_at:stamp(180000),expires_at:stamp(150000)},near),null);
  assert.ok(h.depth.normalize({...f.result.entry,starts_at:stamp(60000),expires_at:stamp(60000)},near));
});
test('token/account/tier change drops cache and ignores old in-flight results',async()=>{
  const h=harness(),f=fixture();await loaded(h,f);
  h.context.CURR_USER.tier='free';assert.equal(h.depth.inspect(f.row,f.payload,'nv').available,false);
  const p=h.depth.load(f.row,f.payload,'nv');await Promise.resolve();h.context.ACCESS_TOKEN='other-token';h.depth.resetAccess();h.respond(1,f.result);
  assert.equal((await p).available,false);assert.equal(h.depth.inspect(f.row,f.payload,'nv').available,false);
});
test('HTTP authorization failures do not leak old prices and explicit retry works',async()=>{
  const h=harness(),f=fixture();const first=h.depth.load(f.row,f.payload,'nv');await Promise.resolve();h.respond(0,{},403);
  assert.match((await first).reason,/Sharp access/);assert.equal((await h.depth.load(f.row,f.payload,'nv')).available,false);assert.equal(h.requests.length,1);
  const second=h.depth.load(f.row,f.payload,'nv',{retry:true});await Promise.resolve();h.respond(1,f.result);assert.equal((await second).available,true);
});
test('render escapes labels and reports truncated levels',async()=>{
  const h=harness(),f=fixture();f.result.entry.sides[0].truncated=true;await loaded(h,f);
  const result=h.depth.collect(f.row,f.payload,{book:'nv'});result.sides[0].label='<img src=x onerror=alert(1)>';
  const html=h.depth.render(result);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/top 20 levels/);
});
test('does not mutate live feed or add fetched orders to rows',async()=>{
  const h=harness(),f=fixture(),before=JSON.stringify(f.payload);await loaded(h,f);h.depth.collect(f.row,f.payload);assert.equal(JSON.stringify(f.payload),before);
});
