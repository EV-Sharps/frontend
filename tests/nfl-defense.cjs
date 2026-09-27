const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../nfl-defense.js');
const shared = require('node:fs').readFileSync(require.resolve('../shared.js'), 'utf8');
globalThis.addSuffix = require('node:vm').runInNewContext(`(${shared.match(/function addSuffix\(num\) \{[\s\S]*?\n\}/)[0]})`);

function fixture() {
  const row = {opp:'lac',pos:'TE',prop:'rec_yd',dvpAllowed:64.5,dvpRank:27,dvpGames:2};
  const feed = {data:[row],defenseVsPosition:{as_of:'2026-09-26',partial:false,
    team_aliases:{wsh:'was'},position_aliases:{FB:'RB'},
    prop_metrics:{rec_yd:'rec_yd',rush_att:'rush_att',attd:'attd',cmp:'pass_cmp'},
    context_metrics:{ftd:'attd','2+td':'attd'},
    data:{lac:{TE:{games:2,ranked_teams:32,per_game:{rec_yd:64.5,attd:0},ranks:{rec_yd:27,attd:1}}},
      was:{RB:{games:3,ranked_teams:31,per_game:{rush_att:24},ranks:{rush_att:30}}}}}};
  D.setFeed(feed);
  return {row,feed};
}

test('rank is compact and keeps position and sample in its details', () => {
  const {row}=fixture();
  assert.match(D.render(row,'dvpRank'), /<strong>27th<\/strong>/);
  assert.doesNotMatch(D.render(row,'dvpRank'), /<small>|TE · 2 games/);
  assert.match(D.render(row,'dvpAllowed'), /64.5<\/strong><small>rec yd\/g/);
  assert.match(D.description(row), /all opposing players/);
  assert.match(D.description(row), /Small sample/);
  assert.match(D.description(row), /1 means fewest/);
});

test('rank delegates colors to the shared opponent rank palette', () => {
  const {row}=fixture();
  const previous=globalThis.getTDsOppRankColor;
  const ranks=[];
  globalThis.getTDsOppRankColor=rank=>{ranks.push(rank);return '#33cc66';};
  try {
    assert.match(D.render(row,'dvpRank'), /<strong style="color:#33cc66">27th<\/strong>/);
    assert.match(D.render({...row,under:true},'dvpRank'), /<strong style="color:#33cc66">27th<\/strong>/);
    D.render(row,'dvpAllowed');
    D.render({...row,blurred:true},'dvpRank');
    assert.deepEqual(ranks,[27,27]);
  } finally {
    if (previous===undefined) delete globalThis.getTDsOppRankColor;
    else globalThis.getTDsOppRankColor=previous;
  }
});

test('zero, missing and blurred stay distinct without hidden tooltip leakage', () => {
  const {row}=fixture();
  assert.match(D.render({...row,dvpAllowed:0},'dvpAllowed'), /<strong>0<\/strong>/);
  for (const value of [null,undefined,NaN,Infinity,'']) {
    assert.equal(D.render({...row,dvpAllowed:value},'dvpAllowed'), '<span class="nfl-defense-empty">-</span>');
  }
  const blurred = D.render({...row,blurred:true},'dvpAllowed');
  assert.doesNotMatch(blurred, /64.5|title|aria-label|button/);
  assert.doesNotMatch(D.description({...row,blurred:true}), /64.5|Rank 27/);
});

test('TD market context is visible and cannot imply first/2+ hit rates', () => {
  const {row}=fixture();
  for (const prop of ['ftd','ltd','2+td','3+td']) {
    const context={...row,prop,dvpAllowed:0.667};
    assert.match(D.render(context,'dvpAllowed'), /0.67<\/strong><small>TD context/);
    assert.match(D.description(context), /general TD context only/);
    assert.match(D.description(context), /passing TDs are excluded/);
  }
  assert.equal(D.render({...row,under:true},'dvpRank'), D.render(row,'dvpRank'));
});

test('prepared shared lookup fallback resolves aliases and does not invent unsupported metrics', () => {
  const {feed}=fixture();
  feed.data = [{opp:'wsh',pos:'FB',prop:'rush_att'}, {opp:'lac',pos:'TE',prop:'longest_rec'},
    {opp:'lac',pos:'TE',prop:'attd'}, {opp:'lac',pos:'TE',prop:'attd',blurred:true},
    {opp:'lac',pos:'TE',prop:'rec_yd',dvpAllowed:null}];
  D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,24);
  assert.match(D.render(feed.data[0],'dvpRank'), /<strong>30th<\/strong>/);
  assert.equal(feed.data[1].dvpAllowed,undefined);
  assert.equal(feed.data[2].dvpAllowed,0);
  assert.equal(feed.data[3].dvpAllowed,undefined);
  assert.equal(feed.data[4].dvpAllowed,null);
  D.setFeed({data:[]});
  assert.equal(D.info(feed.data[0]).teams,null);
});

test('numeric sorting leaves missing samples last in both directions', () => {
  const {row}=fixture();
  const values=[{...row,id:'a',dvpAllowed:10},{...row,id:'zero',dvpAllowed:0},
    {...row,id:'missing',dvpAllowed:null},{...row,id:'b',dvpAllowed:2}];
  for (const [dir,expected] of [['asc',['zero','b','a','missing']],['desc',['a','b','zero','missing']]]) {
    const sorted=[...values].sort((a,b)=>D.compare(a,b,'dvpAllowed',dir)*(dir==='asc'?1:-1));
    assert.deepEqual(sorted.map(r=>r.id),expected);
  }
});

test('new column defaults migrate once and respect later hiding and reordering', () => {
  const user={metadata:{nfl:['ev','player']}};
  D.migrateProfile(user,'nfl');
  assert.deepEqual(user.metadata.nfl,['ev','player','dvpRank']);
  user.metadata.nfl=user.metadata.nfl.filter(k=>k!=='dvpRank');
  D.migrateProfile(user,'nfl');
  assert(!user.metadata.nfl.includes('dvpRank'));
  const customized={metadata:{tds:['player','dvpAllowed']}};
  D.migrateProfile(customized,'tds');
  assert(customized.metadata.tds.includes('dvpAllowed'));
  const order=D.columnOrder(['player','opp','book'],['player','opp','book',...D.keys]);
  assert.deepEqual(order,['player','opp',...D.keys,'book']);
  assert.deepEqual(D.columnOrder(order,order),order);
  assert.deepEqual(D.items().map(item=>item.cols[0].visible),[true,false,false]);
});

test('untrusted names are escaped in formatter markup', () => {
  const {row}=fixture();
  const rendered=D.render({...row,opp:'<img src=x onerror=alert(1)>',pos:'<script>'},'dvpRank');
  assert.doesNotMatch(rendered, /<img|<script/);
  assert.match(rendered,/&lt;/);
});
