'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));

function harness() {
  const requests = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const context = vm.createContext({Date:Clock, URL, AbortController, setTimeout, clearTimeout,
    ACCESS_TOKEN:'fixture-token', API_BASE:'https://api.example', SPORT:'nba', CURR_USER:{id:'first',tier:'sharp'},
    fetch(url, options) { return new Promise(resolve => requests.push({url:new URL(url),options,resolve})); }});
  for (const filename of ['novig-depth.js','nba-prop-depth.js','main-depth.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',filename),'utf8'), context);
  return {context, requests, depth:context.NovigDepth, respond(index, result) {
    requests[index].resolve({ok:true,status:200,json:async()=>clone(result)});
  }};
}

function fixture(kind='nba', prop, under=false) {
  const main = kind === 'main';
  prop ||= main ? 'spread' : 'pts';
  const handicap = prop === 'ml' ? .5 : prop.includes('total') ? 5.5 : main ? (under ? 1.5 : -1.5) : 24.5;
  const line = String(prop === 'spread' && under ? -handicap : handicap);
  const row = {sport:main?'nhl':'nba',player:main?'':'jayson tatum',prop,game:main?'tor @ bos':'bos @ ny',
    team:main?(under?'bos':'tor'):'bos',opp:main?(under?'tor':'bos'):'ny',handicap,under,dt:'2026-10-28',
    bookOdds:{nv:'120/-140',kal:'120/-140',px:'120/-140',fd:'140/-160'}};
  const sides = main && ['spread','ml'].includes(prop) ? ['away','home'] : ['over','under'];
  const entry = {schema_version:1,market_id:'fixture',player:row.player,prop,line,updated:stamp(-60000),
    expires_at:stamp(240000),starts_at:stamp(18000000),sides:sides.map((side,index)=>({
      side,label:side,outcome_id:side,orders:[{probability:index?.6:.3,odds:index?-150:233,
        stake_usd:index?60:30,opposite_stake_usd:index?40:70,payout_usd:100}],truncated:false}))};
  const markers = Object.fromEntries(['nv','kal','px'].map(book=>[book,{updated:entry.updated,expires_at:entry.expires_at}]));
  const payload = {data:[row],times:{[row.game]:entry.starts_at},updated:{fd:entry.updated},
    ...(main?{mainDepthAvailable:{[row.game]:{[prop]:{[line]:markers}}}}
      :{propDepthAvailable:{[row.game]:{[prop]:{[row.player]:{[line]:markers}}}}})};
  const result = {schemaVersion:1,sport:row.sport,book:'nv',game:row.game,player:row.player,prop,line,start:entry.starts_at,entry};
  return {row,payload,result};
}

async function loaded(h, f, book='nv', changes={}) {
  const pending=h.depth.load(f.row,f.payload,{book});
  await Promise.resolve();
  h.respond(h.requests.length-1,{...f.result,book,...changes});
  return pending;
}

for(const kind of ['nba','main']) for(const book of ['nv','kal','px']) {
  test(`${kind} ${book}: shared UI preserves adapter identity, both sides and exact money`,async()=>{
    const h=harness(),f=fixture(kind,undefined,true),before=JSON.stringify(f.payload);
    const idle=h.depth.inspect(f.row,f.payload,{book});
    assert.equal(idle.loadable,true);assert.equal(h.requests.length,0);
    const got=await loaded(h,f,book);
    assert.equal(got.available,true);assert.equal(got.side,'under');
    assert.equal(h.requests[0].url.pathname,kind==='main'?'/api/main-depth':'/api/nba-prop-depth');
    assert.equal(h.requests[0].url.searchParams.get('line'),f.result.line);
    if(kind==='nba')assert.equal(h.requests[0].url.searchParams.get('player'),'jayson tatum');
    assert.equal(got.orders[0].stake_usd,60);
    assert.deepEqual(Array.from(got.availableBooks,b=>b.side),['over','under']);
    assert.deepEqual(Array.from(got.availableBooks,b=>b.orders[0].stake_usd),[40,70]);
    assert.deepEqual(Array.from(got.availableBooks,b=>b.orders[0].odds),[150,-233]);
    const html=h.depth.renderResult(got),preview=h.depth.renderPreview(got,f.row);
    for(const label of kind==='main'?['TOR -1.5','BOS +1.5']:['Over 24.5','Under 24.5']) {
      assert.ok(html.includes(label),label);assert.ok(preview.includes(label),label);
    }
    assert.equal((html.match(/class="nv-depth-book"/g)||[]).length,2);
    assert.ok(html.includes('$40'));assert.ok(html.includes('$70'));
    assert.ok(h.depth.renderResult(got,'resting').includes('not completed bets'));
    assert.equal(JSON.stringify(f.payload),before);
  });
}

for(const prop of ['pts','reb','ast','3ptm'])test(`shared NBA ${prop} keeps exact player and line`,async()=>{
  const h=harness(),f=fixture('nba',prop);await loaded(h,f);
  for(const changes of [{player:'jaylen brown'},{prop:'ml'},{handicap:25.5},{game:'ny @ bos'},{blurred:true}])
    assert.equal(h.depth.inspect({...f.row,...changes},f.payload,{book:'nv'}).available,false);
});

for(const prop of ['ml','total','away_total','home_total'])test(`shared main ${prop} uses correct labels and mapping`,async()=>{
  const h=harness(),f=fixture('main',prop,true),got=await loaded(h,f);
  assert.equal(got.available,true);assert.equal(got.side,'under');
  const labels=prop==='ml'?['TOR','BOS']:['Over 5.5','Under 5.5'];
  const html=h.depth.renderResult(got);
  labels.forEach(label=>assert.ok(html.includes(label)));
  assert.equal(got.availableBooks[0].orders[0].stake_usd,40);
});

test('shared adapters cannot reuse stale or other-line responses',async()=>{
  for(const kind of ['nba','main']) {
    const h=harness(),f=fixture(kind);await loaded(h,f);
    assert.equal(h.depth.inspect(f.row,f.payload,{book:'nv',now:NOW+240000}).available,false);
    assert.equal(h.depth.inspect({...f.row,handicap:77.5},f.payload,{book:'nv'}).available,false);
    const other=harness(),wrong=fixture(kind);
    assert.equal((await loaded(other,wrong,'nv',{line:'77.5'})).available,false);
  }
});

test('shared adapters clear cached orders on account or tier changes',async()=>{
  for(const kind of ['nba','main']) {
    const h=harness(),f=fixture(kind);await loaded(h,f);
    h.context.CURR_USER.id='second';
    assert.equal(h.depth.inspect(f.row,f.payload,{book:'nv'}).available,false);
    assert.equal(h.requests.length,1);
  }
});

test('shared adapter preserves fractional dollar stakes without manufacturing contracts',async()=>{
  const h=harness(),f=fixture('nba');
  Object.assign(f.result.entry.sides[0].orders[0],{probability:.4,stake_usd:5,opposite_stake_usd:7.5,payout_usd:12.5});
  const got=await loaded(h,f,'kal');
  assert.equal(got.availableBooks[1].orders[0].stake_usd,7.5);
  assert.equal(h.depth.wholeStake(got.availableBooks[1].orders),'$7');
});
