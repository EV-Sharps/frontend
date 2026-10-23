const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../nba-defense.js');

function fixture() {
  const row = {opp:'gsw',pos:'PG',dvpPosition:'G',prop:'pts'};
  const feed = {data:[row],defenseVsPosition:{schema_version:2,rank_basis:'per_36',season:'2026-27',as_of:'2026-10-22',window:'season',season_type:'regular',
    position_basis:'source_groups',team_aliases:{gsw:'gs'},position_aliases:{PG:'G',SG:'G'},prop_metrics:{pts:'pts','3ptm':'3ptm'},
    data:{gs:{G:{games:2,minutes:180,per_game:{pts:26.5,'3ptm':0},per_36:{pts:10.6,'3ptm':0},ranks:{pts:3,'3ptm':1},ranked_teams_by_metric:{pts:4,'3ptm':4}}}}}};
  D.setFeed(feed);
  return {row,feed};
}

test('source cohort replaces fabricated five-position labels, with season and sample details', () => {
  const {row}=fixture();
  assert.equal(row.dvpPosition,'G');
  assert.equal(row.dvpRank,3);
  assert.equal(row.dvpAllowed36,10.6);
  assert.equal(row.dvpAllowed,26.5);
  assert.equal(row.dvpMinutes,180);
  assert.equal(row.dvpRankBasis,'per_36');
  assert.match(D.description(row),/GS vs guards/);
  assert.doesNotMatch(D.description(row),/point guards/);
  assert.match(D.description(row),/26.5 allowed per game across 2 completed regular-season games/);
  assert.match(D.description(row),/10.6 allowed per 36 minutes/);
  assert.match(D.description(row),/Rank 3 of 4; 1 means fewest allowed per 36 minutes. Ties share a rank/);
  assert.match(D.description(row),/all opposing guards \/ their 180 combined actual minutes × 36/);
  assert.match(D.description(row),/display unit, not an assumed playing time/);
  assert.match(D.description(row),/Early sample/);
  assert.match(D.description(row),/Season: 2026-27/);
  assert.match(D.render(row,'dvpRank'),/3rd/);
  assert.doesNotMatch(D.render(row,'dvpRank'),/<small>|G · 2g/);
  assert.match(D.render(row,'dvpRank'),/nba-defense-context nba-defense-early/);
  assert.doesNotMatch(D.render({...row,dvpGames:8},'dvpRank'),/nba-defense-early/);
});

test('zero allowed is real, missing and blurred data never become zero or leak details', () => {
  const {row,feed}=fixture();
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'3ptm'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,0);
  assert.equal(feed.data[0].dvpAllowed36,0);
  assert.match(D.render(feed.data[0],'dvpAllowed36'),/<strong>0<\/strong>/);
  for (const field of ['dvpAllowed','dvpAllowed36','dvpMinutes']) for (const invalid of [null,undefined,NaN,Infinity,'',false,-1]) {
    for (const key of D.keys) assert.equal(D.value({...row,[field]:invalid},key),null);
  }
  for (const key of D.keys) assert.equal(D.value({...row,dvpMinutes:0},key),null);
  const blurred={...row,blurred:true};
  assert.doesNotMatch(D.render(blurred,'dvpAllowed36'),/title|button|10.6|26.5/);
  assert.doesNotMatch(D.description(blurred),/10.6|26.5|Rank 3/);
  assert.equal(D.renderCard(blurred), '');
});

test('explicit missing data, unsupported markets, legacy ranks, and nonseason metadata stay unavailable', () => {
  const {row,feed}=fixture();
  const unsupported={...row,prop:'fb'};
  assert.equal(D.value(unsupported,'dvpRank'),null);
  assert.equal(D.value({opp:'gs',pos:'PG',prop:'pts',oppPosRank:20},'dvpRank'),null);
  feed.data=[{opp:'gs',pos:'PG',prop:'pts'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,undefined,'Legacy or ambiguous roster positions cannot reconstruct a withheld row');
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'pts',dvpAllowed36:null}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed36,null);
  assert.equal(D.value(feed.data[0],'dvpRank'),null);
  feed.data=[{opp:'gs',pos:'PG',prop:'pts'}];feed.defenseVsPosition.window='last_year';D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,undefined);
});

test('explicit position group wins over lineup or nominal player position', () => {
  const {row}=fixture();
  assert.equal(D.info({...row,dvpPosition:'C',pos:'PG',lineupPosition:'SG'}).position,'C');
});

test('source basis is required and metric-specific game counts remain authoritative', () => {
  const {feed}=fixture();
  feed.defenseVsPosition.position_basis='five_positions';D.setFeed(feed);
  const unmarked={...feed.data[0],dvpRankBasis:undefined};
  assert.equal(D.value(unmarked,'dvpRank'),null);
  feed.defenseVsPosition.position_basis='source_groups';
  feed.defenseVsPosition.data.gs.G.games_by_metric={pts:1};
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'pts'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpGames,1);
  feed.defenseVsPosition.data.gs.G.games_by_metric={pts:0};
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'pts'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,undefined);
});

test('legacy per-game metadata and row fields cannot be relabeled as per-36 ranks', () => {
  for (const changes of [{schema_version:1},{schema_version:undefined},{rank_basis:'per_game'},
    {rank_basis:undefined},{window:'last_year'},{season_type:'playoffs'},{position_basis:'five_positions'}]) {
    const {feed}=fixture();
    Object.assign(feed.defenseVsPosition,changes);
    const legacy={opp:'gs',pos:'PG',dvpPosition:'G',prop:'pts',dvpRank:2,oppPosRank:2,dvpAllowed:26.5,dvpGames:2};
    feed.data=[legacy];D.setFeed(feed);
    assert.equal(legacy.dvpAllowed36,undefined);
    for (const key of D.keys) assert.equal(D.value(legacy,key),null);
    assert.doesNotMatch(D.description(legacy),/26.5|Rank 2/);
  }
});

test('valid metadata replaces unmarked old ranks while explicitly withheld new fields remain blank', () => {
  const {feed}=fixture();
  const legacy={opp:'gs',dvpPosition:'G',prop:'pts',dvpRank:29,dvpAllowed:999,dvpGames:8};
  feed.data=[legacy];D.setFeed(feed);
  assert.equal(legacy.dvpRank,3);
  assert.equal(legacy.dvpAllowed36,10.6);
  assert.equal(legacy.dvpAllowed,26.5);
  for (const override of [{dvpAllowed36:null},{dvpMinutes:null},{dvpMinutes:0},{dvpRankBasis:null},{dvpRankBasis:'per_game'}]) {
    const row={opp:'gs',dvpPosition:'G',prop:'pts',...override};
    feed.data=[row];D.setFeed(feed);
    assert.equal(D.value(row,'dvpRank'),null);
  }
});

test('explicit null metric counts never borrow overall games or ranked teams', () => {
  const {feed}=fixture();
  const sample=feed.defenseVsPosition.data.gs.G;
  for (const games of [null,undefined,0]) {
    sample.games_by_metric={pts:games};
    feed.data=[{opp:'gs',dvpPosition:'G',prop:'pts'}];D.setFeed(feed);
    assert.equal(feed.data[0].dvpAllowed36,undefined);
  }
  sample.games_by_metric={};sample.ranked_teams=30;
  for (const teams of [null,undefined,0]) {
    sample.ranked_teams_by_metric={pts:teams};
    feed.data=[{opp:'gs',dvpPosition:'G',prop:'pts'}];D.setFeed(feed);
    assert.equal(feed.data[0].dvpAllowed36,10.6);
    assert.equal(feed.data[0].dvpRank,null);
  }
});

test('explicit rate basis and positive sample minutes support annotated rows without compatible metadata', () => {
  const {row,feed}=fixture();
  for (const metadata of [undefined,{...feed.defenseVsPosition,schema_version:1},
    {...feed.defenseVsPosition,rank_basis:'per_game'}]) {
    D.setFeed({data:[row],defenseVsPosition:metadata});
    assert.equal(D.value(row,'dvpRank'),3);
    assert.equal(D.value(row,'dvpAllowed36'),10.6);
    assert.doesNotMatch(D.description(row),/of 4|Season: 2026-27/);
    assert.equal(D.value({...row,dvpRankBasis:undefined},'dvpRank'),null);
  }
});

test('missing or zero sample minutes prevent metadata hydration while positive minutes permit a true zero rate', () => {
  for (const minutes of [0,null,undefined,-1,'180',false,NaN,Infinity]) {
    const {feed}=fixture();
    feed.defenseVsPosition.data.gs.G.minutes=minutes;
    feed.data=[{opp:'gs',dvpPosition:'G',prop:'3ptm'}];D.setFeed(feed);
    assert.equal(feed.data[0].dvpAllowed36,undefined);
    assert.equal(D.value(feed.data[0],'dvpAllowed36'),null);
  }
  const {feed}=fixture();
  feed.data=[{opp:'gs',dvpPosition:'G',prop:'3ptm'}];D.setFeed(feed);
  assert.equal(D.value(feed.data[0],'dvpAllowed36'),0);
  assert.equal(D.value(feed.data[0],'dvpRank'),1);
});

test('every supported NBA stat and combination uses the supplied per-36 metric', () => {
  const metrics=['pts','reb','ast','3ptm','stl','blk','to','pts+reb','pts+ast','reb+ast','pts+reb+ast','blk+stl'];
  const {feed}=fixture();
  const sample=feed.defenseVsPosition.data.gs.G;
  for (const [index,metric] of metrics.entries()) {
    feed.defenseVsPosition.prop_metrics[metric]=metric;
    sample.per_game[metric]=index+20;
    sample.per_36[metric]=index+5;
    sample.ranks[metric]=index+1;
    sample.ranked_teams_by_metric[metric]=30;
  }
  feed.data=metrics.map(prop=>({opp:'gs',dvpPosition:'G',prop}));D.setFeed(feed);
  for (const [index,row] of feed.data.entries()) {
    assert.equal(D.value(row,'dvpAllowed36'),index+5);
    assert.equal(D.value(row,'dvpRank'),index+1);
    assert.match(D.render(row,'dvpAllowed36'),/\/36/);
  }
});

test('blocks plus steals respects the collector metric and its legacy alias', () => {
  const {row,feed}=fixture();
  feed.defenseVsPosition.prop_metrics['stl+blk']='blk+stl';D.setFeed(feed);
  assert.match(D.description({...row,prop:'stl+blk'}),/blocks \+ steals/);
  assert.match(D.description({...row,prop:'blk+stl'}),/blocks \+ steals/);
});

test('numeric rate and minutes sorting leaves missing at the bottom in both directions', () => {
  const {row}=fixture();
  for (const field of ['dvpAllowed36','dvpAllowed','dvpMinutes']) {
    const low=field==='dvpMinutes'?1:0;
    const rows=[{...row,id:'low',[field]:low},{...row,id:'ten',[field]:10},
      {...row,id:'missing',[field]:null},{...row,id:'two',[field]:2}];
    for (const [direction,expected] of [['asc',['low','two','ten','missing']],['desc',['ten','two','low','missing']]]) {
      const sorted=[...rows].sort((a,b)=>D.compare(a,b,field,direction)*(direction==='asc'?1:-1));
      assert.deepEqual(sorted.map(row=>row.id),expected);
    }
  }
});

test('migration preserves visibility choices and legacy saved rank ordering', () => {
  const user={metadata:{nba:['player','oppPosRank'],'nba-order':['player','oppPosRank','opp','book']}};
  D.migrateProfile(user,'nba');
  assert.deepEqual(user.metadata.nba,['player','dvpRank']);
  assert.deepEqual(user.metadata['nba-order'],['player','dvpRank','opp','book']);
  user.metadata.nba=['player'];D.migrateProfile(user,'nba');assert.deepEqual(user.metadata.nba,['player']);
  const hidden={metadata:{pts:['player']}};D.migrateProfile(hidden,'pts');assert.deepEqual(hidden.metadata.pts,['player']);
  const order=D.columnOrder(['player','oppPosRank','opp','book'],['player','opp',...D.keys,'book']);
  assert.deepEqual(order,['player','dvpRank','opp','dvpAllowed36','dvpAllowed','dvpGames','dvpMinutes','book']);
  assert.deepEqual(D.items().map(item=>item.cols[0].visible),[true,true,false,false,false]);
  assert.deepEqual(D.defaultKeys,['dvpRank','dvpAllowed36']);
  const fb={metadata:{fb:['player','oppPosRank']}};D.migrateProfile(fb,'fb');
  assert.deepEqual(fb.metadata,{fb:['player','oppPosRank']});
  assert.ok(!D.pages.includes('fb'));
});

test('mobile honors selected fields and untrusted labels remain escaped', () => {
  const {row}=fixture();
  assert.equal(D.renderCard(row,[]),'');
  assert.doesNotMatch(D.renderCard(row,['dvpGames']),/26.5<|3rd/);
  assert.match(D.renderCard(row,['dvpGames']),/Defense sample games/);
  assert.match(D.renderCard(row),/Allowed per 36 minutes vs position/);
  assert.match(D.renderCard(row,['dvpMinutes']),/Defense sample minutes/);
  assert.doesNotMatch(D.render({...row,opp:'<img onerror=x>'},'dvpRank'),/<img/);
});

test('KOTC table labels its rate basis and hides and sorts legacy or invalid ranks as missing', () => {
  const source=fs.readFileSync(path.join(__dirname,'../kotc.html'),'utf8');
  const start=source.indexOf('{title: "DvP Rank<br>By per-36 rate"');
  const end=source.indexOf('{field: "game"',start);
  assert.ok(start>=0 && end>start);
  const block=source.slice(start,end);
  const helper=/function kotcDefenseRank\(row\) \{[\s\S]*?\n\s*\}/.exec(source);
  assert.ok(helper);
  assert.match(source,/<label for="custom_oppPosRank">DvP rank by per-36 rate<\/label>/);
  const config=vm.runInNewContext(helper[0]+'\n('+block.trim().replace(/,$/,'')+');',{
    rankingFormatter:cell=>`${cell.getValue()}th`
  });
  const render=config.formatter;
  const cell=row=>({getRow:()=>({getData:()=>row}),getValue:()=>row.oppPosRank});
  const row={oppPosRank:8,dvpRankBasis:'per_36',dvpMinutes:180};
  assert.equal(render(cell(row)),'8th');
  const compare=(a,b,direction)=>config.sorter(a.oppPosRank,b.oppPosRank,{getData:()=>a},{getData:()=>b},null,direction);
  const missing=[{dvpRankBasis:undefined},{dvpRankBasis:'per_game'},{dvpMinutes:0},{dvpMinutes:null},{blurred:true},
    {oppPosRank:null},{oppPosRank:0},{oppPosRank:31},{oppPosRank:1.5}].map(change=>({...row,...change}));
  for (const invalid of missing) {
    assert.equal(render(cell(invalid)),'-');
    for (const direction of ['asc','desc']) {
      const multiplier=direction==='asc'?1:-1;
      assert.ok(compare(row,invalid,direction)*multiplier<0);
      assert.ok(compare(invalid,row,direction)*multiplier>0);
      assert.equal(compare(invalid,missing[0],direction),0);
    }
  }
  assert.equal(compare(row,{...row,oppPosRank:12},'asc'),-4);
  assert.equal(compare(row,{...row,oppPosRank:12},'desc'),-4);
});

test('generic cards label stamped rates, hide legacy NBA ranks and preserve other sports', () => {
  const source=fs.readFileSync(path.join(__dirname,'../card.js'),'utf8');
  const start=source.indexOf('\tconst dvp = rowData.');
  const end=source.indexOf('\tconst stadiumPill =',start);
  assert.ok(start>=0 && end>start);
  const render=(PAGE,rowData)=>vm.runInNewContext(source.slice(start,end)+'\ndvpPill;',{
    PAGE,rowData,window:{},getTDsOppRankColor:()=>'',addSuffix:value=>`${value}th`
  });
  const row={sport:'nba',oppPosRank:8,dvpRankBasis:'per_36',dvpMinutes:180};
  assert.match(render('kotc',row),/8th.*DvP Rank \(per-36 rate\)/s);
  for (const change of [{dvpRankBasis:undefined},{dvpRankBasis:'per_game'},{dvpMinutes:0},{dvpMinutes:null},{blurred:true}]) {
    assert.equal(render('kotc',{...row,...change}),'');
  }
  assert.equal(render('outliers',{sport:'nba',oppPosRank:8}),'');
  const football=render('nfl',{sport:'nfl',oppPosRank:8});
  assert.match(football,/8th.*DvP Rank/s);
  assert.doesNotMatch(football,/per-36/);
});
