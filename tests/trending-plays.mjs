// node tests/trending-plays.mjs /path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE public.profiles (id text PRIMARY KEY, metadata jsonb);');
  const migration = await readFile(new URL('../supabase/trending-plays.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const dt = '2026-11-04';
  const play = {player:'test player', sport:'nba', page:'nba', prop:'pts', dt,
    quote:{handicap:25.5,under:false,game:'bos @ ny',book:'fd',odds:125}};
  const rebound = {...play, prop:'reb', quote:{...play.quote,handicap:8.5,under:true}};
  const profiles = [
    {watchlist:[play,{...play,page:'outliers'},rebound], bets:[{...play,...play.quote}]},
    {watchlist:[{...play,player:' TEST PLAYER ',quote:{...play.quote,handicap:'25.5',book:'dk',odds:150}}],
      bets:[{...play,...play.quote,book:'dk',odds:150}, {...play,...play.quote,under:true}]},
    {watchlist:[{...play,quote:{...play.quote,handicap:26.5}},{...play,quote:{...play.quote,under:true}},
      {...play,quote:{...play.quote,game:'bos @ mia'}}, {...play,sport:'wnba'},
      {player:'legacy hitter',dt}, {...play,player:'old player',dt:'2026-11-03'},
      {player:'unknown line',sport:'nhl',page:'nhl',prop:'sog',dt,quote:{handicap:'NaN',under:null}},
      {player:'zero line',sport:'ncaab',page:'ncaab',prop:'spread',dt,quote:{handicap:'0',under:false}}]},
    {watchlist:null,bets:{}}, {watchlist:'bad array'},
  ];
  for (let i=0;i<profiles.length;i++) await db.query('INSERT INTO profiles VALUES ($1,$2)', [String(i),profiles[i]]);
  await db.exec('SET ROLE anon');
  const result = (await db.query('SELECT * FROM public.popular_watchlist_plays($1,$2)',[50,dt])).rows;
  const top = result[0];
  assert.deepEqual({...top,count:Number(top.count),handicap:Number(top.handicap)},
    {player:'test player',sport:'nba',page:'nba',prop:'pts',handicap:25.5,under:false,game:'bos @ ny',count:2});
  assert.equal(result.length,9);
  assert.equal(result.find(row=>row.player==='legacy hitter').prop,'hr');
  assert.equal(result.find(row=>row.player==='legacy hitter').handicap,null);
  assert.equal(result.find(row=>row.player==='unknown line').under,null);
  assert.equal(Number(result.find(row=>row.player==='zero line').handicap),0);
  assert(!result.some(row=>row.player==='old player'));
  assert(result.every(row=>!Object.hasOwn(row,'profile_id') && !Object.hasOwn(row,'quote')));
  const bets = (await db.query('SELECT * FROM public.popular_bet_plays($1,$2)',[15,dt])).rows;
  assert.equal(bets.length,2);
  assert.equal(Number(bets[0].count),2);
  assert.equal(bets[0].under,false);
  assert.equal(bets[1].under,true);
  assert.equal((await db.query('SELECT * FROM public.popular_watchlist_plays($1,$2)',[1,dt])).rows.length,1);
  assert.equal((await db.query('SELECT * FROM public.popular_watchlist_plays($1,$2)',[15,'2026-11-05'])).rows.length,0);
  await assert.rejects(db.query('SELECT * FROM public.profiles'), /permission denied/);
  console.log('PostgreSQL passed: migration rerun, exact plays, distinct-user counts, both lists, dates, legacy/malformed records, zero lines and aggregate-only access.');
} finally {
  await db.close();
}
