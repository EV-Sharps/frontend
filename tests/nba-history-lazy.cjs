const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../player-history.js'), 'utf8');
const key = n => n.toString(16).padStart(64, '0');
const payload = value => ({key:value, playerId:'42', prop:'pts', before:'2026-10-23', opp:'bos',
  careerLogs:[0,10,20], bvtLogs:[0,10], awayLogs:[], homeLogs:[20]});
const response = value => ({ok:true,json:async()=>payload(value)});
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
function setup(fetch, options={}) {
  const context = vm.createContext({window:{fetch}, URL, AbortController, setTimeout, clearTimeout,
    API_BASE:'https://api.example.test', ACCESS_TOKEN:'fixture-token'});
  vm.runInContext(source, context);
  return {context, load:context.createNbaHistoryLoader(context.window, options)};
}

test('initial script does not fetch; identical content keys deduplicate and reuse frozen history', async () => {
  const waiting=deferred(), requests=[];
  const {load}=setup((...args)=>{requests.push(args);return waiting.promise;});
  assert.equal(requests.length,0);
  const first=load(key(1)), alternate=load(key(1));
  assert.equal(first,alternate);
  await Promise.resolve();
  assert.equal(requests.length,1);
  assert.equal(requests[0][0],`https://api.example.test/api/nba-history?key=${key(1)}`);
  assert.equal(requests[0][1].headers.Authorization,'Bearer fixture-token');
  waiting.resolve(response(key(1)));
  const result=await first;
  assert.deepEqual(Array.from(result.careerLogs),[0,10,20]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.careerLogs));
  assert.equal(await load(key(1)),result);
  assert.equal(requests.length,1);
  assert.deepEqual(Object.keys(result).sort(),['awayLogs','bvtLogs','careerLogs','homeLogs']);
});

test('changed keys reload and completed history cache has a bounded LRU', async () => {
  const calls=[];
  const {load}=setup(async url=>{const value=new URL(url).searchParams.get('key');calls.push(value);return response(value);},{maxEntries:2});
  await load(key(1)); await load(key(2)); await load(key(1)); await load(key(3));
  await load(key(1)); await load(key(2));
  assert.deepEqual(calls,[key(1),key(2),key(3),key(2)]);
});

test('pending requests are bounded, and rejected busy requests can be retried', async () => {
  const waits=[];
  const {load}=setup(url=>{const wait=deferred();waits.push({wait,key:new URL(url).searchParams.get('key')});return wait.promise;},{maxPending:2});
  const a=load(key(1)), b=load(key(2));
  await assert.rejects(load(key(3)),/busy/);
  assert.equal(waits.length,2);
  waits[0].wait.resolve(response(waits[0].key)); await a;
  const c=load(key(3)); await Promise.resolve();
  waits[1].wait.resolve(response(waits[1].key));
  waits[2].wait.resolve(response(waits[2].key));
  await Promise.all([b,c]);
});

test('HTTP, transport, identity and malformed-series failures never become cached empty histories', async () => {
  const failures=[()=>({ok:false,status:404}),()=>({ok:false,status:503}),()=>{throw new Error('network');},
    ()=>({ok:true,json:async()=>payload(key(2))}),
    ()=>({ok:true,json:async()=>({...payload(key(1)),careerLogs:[null]})}),
    ()=>({ok:true,json:async()=>({...payload(key(1)),homeLogs:[false]})}),
    ()=>({ok:true,json:async()=>({...payload(key(1)),bvtLogs:[Infinity]})}),
    ()=>({ok:true,json:async()=>({...payload(key(1)),awayLogs:undefined})})];
  for(const fail of failures) {
    let count=0;
    const {load}=setup(async()=>++count===1?fail():response(key(1)));
    await assert.rejects(load(key(1)));
    assert.deepEqual(Array.from((await load(key(1))).careerLogs),[0,10,20]);
    assert.equal(count,2);
  }
});

test('invalid keys cause no request and do not expose raw input in the error', async () => {
  let count=0;
  const {load}=setup(()=>{count++;});
  for(const value of [null,'private-token','a'.repeat(63),'A'.repeat(64),'../../history']) {
    await assert.rejects(load(value),/^Error: Invalid history key$/);
  }
  assert.equal(count,0);
});

test('missing immutable history distinguishes a stale table from a network failure', async () => {
  const {load}=setup(async()=>({ok:false,status:404}));
  await assert.rejects(load(key(1)),error=>error.code==='history_not_found');
  const network=setup(async()=>({ok:false,status:503}));
  await assert.rejects(network.load(key(1)),error=>error.code===undefined);
});

test('request timeout aborts and permits another attempt', async () => {
  let count=0;
  const {load}=setup((url,{signal})=>++count===1?new Promise((resolve,reject)=>
    signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})):Promise.resolve(response(key(1))),{timeoutMs:10});
  await assert.rejects(load(key(1)),/aborted/);
  await load(key(1));
  assert.equal(count,2);
});

test('an authentication change clears cache and old in-flight results cannot replace the new request', async () => {
  const old=deferred(), calls=[];
  const {context,load}=setup((url,options)=>{
    calls.push(options.headers.Authorization);
    return calls.length===1?old.promise:Promise.resolve(response(key(1)));
  });
  const oldRequest=load(key(1)); await Promise.resolve();
  context.ACCESS_TOKEN='new-fixture-token';
  const current=await load(key(1));
  old.resolve(response(key(1))); await oldRequest;
  assert.equal(await load(key(1)),current);
  assert.deepEqual(calls,['Bearer fixture-token','Bearer new-fixture-token']);
});
