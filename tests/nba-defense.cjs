const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../nba-defense.js');

function fixture() {
  const row = {opp:'gsw',pos:'PG',dvpPosition:'G',prop:'pts'};
  const feed = {data:[row],defenseVsPosition:{season:'2026-27',as_of:'2026-10-22',window:'season',season_type:'regular',
    position_basis:'source_groups',team_aliases:{gsw:'gs'},position_aliases:{PG:'G',SG:'G'},prop_metrics:{pts:'pts','3ptm':'3ptm'},
    data:{gs:{G:{games:2,per_game:{pts:26.5,'3ptm':0},ranks:{pts:3,'3ptm':1},ranked_teams_by_metric:{pts:4,'3ptm':4}}}}}};
  D.setFeed(feed);
  return {row,feed};
}

test('source cohort replaces fabricated five-position labels, with season and sample details', () => {
  const {row}=fixture();
  assert.equal(row.dvpPosition,'G');
  assert.equal(row.dvpRank,3);
  assert.match(D.description(row),/GS vs guards/);
  assert.doesNotMatch(D.description(row),/point guards/);
  assert.match(D.description(row),/26.5 allowed per game across 2 completed regular-season games/);
  assert.match(D.description(row),/Rank 3 of 4; 1 means fewest allowed. Ties share a rank/);
  assert.match(D.description(row),/all opposing players/);
  assert.match(D.description(row),/Early sample/);
  assert.match(D.description(row),/Season: 2026-27/);
  assert.match(D.render(row,'dvpRank'),/3rd/);
  assert.match(D.render(row,'dvpRank'),/G · 2g/);
  assert.match(D.render(row,'dvpRank'),/nba-defense-context nba-defense-early/);
  assert.doesNotMatch(D.render({...row,dvpGames:8},'dvpRank'),/nba-defense-early/);
});

test('zero allowed is real, missing and blurred data never become zero or leak details', () => {
  const {row,feed}=fixture();
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'3ptm'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,0);
  assert.match(D.render(feed.data[0],'dvpAllowed'),/<strong>0<\/strong>/);
  for (const invalid of [null,undefined,NaN,Infinity,'',false,-1]) {
    assert.equal(D.value({...row,dvpAllowed:invalid},'dvpRank'),null);
  }
  const blurred={...row,blurred:true};
  assert.doesNotMatch(D.render(blurred,'dvpRank'),/title|button|3rd|26.5/);
  assert.doesNotMatch(D.description(blurred),/26.5|Rank 3/);
  assert.equal(D.renderCard(blurred), '');
});

test('explicit missing data, unsupported markets, legacy ranks, and nonseason metadata stay unavailable', () => {
  const {row,feed}=fixture();
  const unsupported={...row,prop:'fb'};
  assert.equal(D.value(unsupported,'dvpRank'),null);
  assert.equal(D.value({opp:'gs',pos:'PG',prop:'pts',oppPosRank:20},'dvpRank'),null);
  feed.data=[{opp:'gs',pos:'PG',prop:'pts'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,undefined,'Legacy or ambiguous roster positions cannot reconstruct a withheld row');
  feed.data=[{opp:'gs',pos:'PG',prop:'pts',dvpAllowed:null}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,null);
  feed.data=[{opp:'gs',pos:'PG',prop:'pts'}];feed.defenseVsPosition.window='last_year';D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,undefined);
});

test('explicit position group wins over lineup or nominal player position', () => {
  const {row}=fixture();
  assert.equal(D.info({...row,dvpPosition:'C',pos:'PG',lineupPosition:'SG'}).position,'C');
});

test('source basis is required and metric-specific game counts remain authoritative', () => {
  const {row,feed}=fixture();
  feed.defenseVsPosition.position_basis='five_positions';D.setFeed(feed);
  assert.equal(D.value(row,'dvpRank'),null);
  feed.defenseVsPosition.position_basis='source_groups';
  feed.defenseVsPosition.data.gs.G.games_by_metric={pts:1};
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'pts'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpGames,1);
  feed.defenseVsPosition.data.gs.G.games_by_metric={pts:0};
  feed.data=[{opp:'gs',pos:'PG',dvpPosition:'G',prop:'pts'}];D.setFeed(feed);
  assert.equal(feed.data[0].dvpAllowed,undefined);
});

test('blocks plus steals respects the collector metric and its legacy alias', () => {
  const {row,feed}=fixture();
  feed.defenseVsPosition.prop_metrics['stl+blk']='blk+stl';D.setFeed(feed);
  assert.match(D.description({...row,prop:'stl+blk'}),/blocks \+ steals/);
  assert.match(D.description({...row,prop:'blk+stl'}),/blocks \+ steals/);
});

test('numeric sorting leaves missing at the bottom in both directions', () => {
  const {row}=fixture();
  const rows=[{...row,id:'zero',dvpAllowed:0},{...row,id:'ten',dvpAllowed:10},
    {...row,id:'missing',dvpAllowed:null},{...row,id:'two',dvpAllowed:2}];
  for (const [direction,expected] of [['asc',['zero','two','ten','missing']],['desc',['ten','two','zero','missing']]]) {
    const sorted=[...rows].sort((a,b)=>D.compare(a,b,'dvpAllowed',direction)*(direction==='asc'?1:-1));
    assert.deepEqual(sorted.map(row=>row.id),expected);
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
  assert.deepEqual(order,['player','dvpRank','opp','dvpAllowed','dvpGames','book']);
  assert.deepEqual(D.items().map(item=>item.cols[0].visible),[true,false,false]);
});

test('mobile honors selected fields and untrusted labels remain escaped', () => {
  const {row}=fixture();
  assert.equal(D.renderCard(row,[]),'');
  assert.doesNotMatch(D.renderCard(row,['dvpGames']),/26.5<|3rd/);
  assert.match(D.renderCard(row,['dvpGames']),/Defense sample games/);
  assert.doesNotMatch(D.render({...row,opp:'<img onerror=x>'},'dvpRank'),/<img/);
});
