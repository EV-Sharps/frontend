import express from '../../api/node_modules/express/index.js';
import { registerCardsRoutes } from '../../api/cards_route.mjs';
import { emptySettings } from '../../api/cards_model.mjs';
import { fileURLToPath } from 'node:url';

const profiles=new Map(),users={a:'11111111-1111-4111-8111-111111111111',b:'22222222-2222-4222-8222-222222222222',c:'33333333-3333-4333-8333-333333333333'};
const legacy={id:'legacy-model',set_id:'2018-topps-hockey',set_name:'2018 Topps Hockey',sport:'hockey',
  format_id:'legacy-hobby',format_name:'Older hobby',pack_count:10,pack_cost:null,box_cost:20,
  fee_percent:10,cost_per_pack:1,min_sale_price:0,reviewed:true,complete:true,
  odds_url:'https://example.com/legacy-odds',notes:'Saved before catalog focus.',
  pools:[{id:'legacy-pool',label:'Base',expected_per_pack:1,pool_size:1,cards:[{
    id:'legacy-card',name:'Saved Hockey Player',number:'18',parallel:'Base',raw_price:15,
    price_as_of:new Date().toISOString(),source_url:'https://example.com/legacy-card'}]}]};
profiles.set(users.c,{entries:[legacy],favorites:['legacy-card']});
const catalog=[{id:'2026-topps-baseball',name:'2026 Topps Baseball',sport:'baseball',year:2026,product_count:6,featured_available:true},
  {id:'2025-topps-basketball',name:'2025 Topps Basketball',sport:'basketball',year:2025,product_count:null},
  {id:'2024-topps-football',name:'2024 Topps Football',sport:'football',year:2024,product_count:0},
  {id:'2026-bowman-baseball',name:'2026 Bowman Baseball',sport:'baseball',year:2026,product_count:0,reference_only:true},
  {id:legacy.set_id,name:legacy.set_name,sport:'hockey',year:2018,product_count:1}];
const references={title:'Published manufacturer odds',odds_url:'https://example.com/official-odds.pdf',checklist_url:'https://example.com/checklist.pdf',retrieved_at:'2026-11-13',
  cards:[{id:'raw-1'}],
  source_note:'Fixture copy of manufacturer table.',formats:[
    {id:'hobby-6544',sku:'6544',label:'Hobby',rates:[{label:'Base Gold',odds:'1:87',expected_per_pack:1/87},{label:'Retail exclusive',odds:'—',expected_per_pack:null},{label:'Ambiguous source',odds:'1:15.282',expected_per_pack:null,status:'ambiguous'},{label:'Unparsed source',odds:'01:11:00',expected_per_pack:null,status:'unparsed'}]},
    {id:'jumbo-6545',sku:'6545',label:'Jumbo',rates:[{label:'Base Gold',odds:'1:7',expected_per_pack:1/7},{label:'Retail exclusive',odds:'—',expected_per_pack:null}]}]};
const app=express();
let quoteCalls=0;
let featuredCalls=0;
async function mockFeatured(setId) {
  if(setId!=='2026-topps-baseball')throw new Error('Unexpected featured request.');
  featuredCalls++;await new Promise(resolve=>setTimeout(resolve,150));
  if(featuredCalls===3)throw new Error('Featured source unavailable.');
  if(featuredCalls===4)return {cards:[],status:'rate_limited',reason:'Recent-price service is busy; try again later.'};
  const cards=featuredCalls===2?[]:[400,275,120,60,25].map((price,index)=>({
    id:'featured-'+index,name:'Chase '+String.fromCharCode(65+index),number:String(index+10),
    subset:index===0?'Autographs':'Base Set',parallel:index===1?'Gold':'',raw_price:price,
    sale_count:index+1,price_as_of:'2026-11-12T20:00:00.000Z',source_url:'https://example.com/sale/'+index,
    image_url:index===1?'https://images.example.test/manual.png':'https://images.example.test/source.png'}));
  return {cards,sample_records:250,matched_sales:90,priced_cards:40,complete:false,
    notice:'Highest medians among this recent auction sample, not a complete set ranking.',status:cards.length?'ready':'no_sales',
    reason:cards.length?'':'No eligible recent sales found.'};
}
async function mockQuotes(setId,ids) {
  if(setId!=='2026-topps-baseball' || JSON.stringify(ids)!==JSON.stringify(['raw-1']))
    throw new Error('Unexpected quote request.');
  quoteCalls++;
  await new Promise(resolve=>setTimeout(resolve,150));
  if(quoteCalls===3)throw new Error('Live price source is temporarily unavailable.');
  return {source:'CardSight AI',quotes:[{id:'raw-1',status:quoteCalls===2?'no_sales':'priced',
    raw_price:quoteCalls===2?null:777,sale_count:quoteCalls===2?0:3,
    price_as_of:new Date().toISOString(),source_url:'https://example.com/auction-sale',provider_id:'sample-provider-id'}]};
}
const retail={price_basis:'retailer_asking',source_name:'Steel City Collectibles',availability:'in_stock',
  source_url:'https://www.steelcitycollectibles.com/i/2026-topps-series-1-baseball-hobby-box',
  notes:'Includes 1 Silver Pack. Model its different odds separately.'};
registerCardsRoutes(app,{json:express.json,
  catalogSelection:rows=>rows.filter(row=>row.sport!=='hockey'),
  references:{catalog:()=>[],set:id=>id==='2026-topps-baseball'?references:null},
  livePrices:{enabled:true,quotes:mockQuotes,featured:mockFeatured},
  supabase:{auth:{getUser:async token=>({data:{user:users[token]?{id:users[token]}:null}})}},
  storage:{settings:async id=>structuredClone(profiles.get(id) || emptySettings()),saveSettings:async(settings,id)=>profiles.set(id,structuredClone(settings))},
  source:{catalog:async()=>catalog,set:async id=>id===legacy.set_id?{set:catalog.find(s=>s.id===id),products:[],cards:[]}:catalog.some(s=>s.id===id)?{set:catalog.find(s=>s.id===id),products:[
    {...retail,id:'hobby',name:'Hobby',packs_per_box:10,market:40,price_as_of:new Date().toISOString()},
    {id:'blaster',name:'Blaster',packs_per_box:7,market:25,price_as_of:new Date().toISOString()},
    {...retail,id:'retail-oos',name:'Unavailable retail',availability:'out_of_stock',packs_per_box:10,market:50,price_as_of:new Date().toISOString()},
    {...retail,id:'retail-unknown',name:'Unconfirmed retail',availability:'unknown',packs_per_box:10,market:60,price_as_of:new Date().toISOString()},
    {...retail,id:'retail-stale',name:'Cached retail',stale:true,packs_per_box:10,market:70,price_as_of:new Date().toISOString()},
    {...retail,id:'retail-aged',name:'Old retail',packs_per_box:10,market:80,price_as_of:'2020-01-01T12:00:00.000Z'}],
    cards:[{id:'raw-1',name:'Player A',number:'1',parallel:'Gold',raw_price:125,price_as_of:new Date().toISOString(),source_url:'https://example.com/card/1',image_url:'https://images.example.test/source.png'}],
    references,live_pricing:{enabled:id==='2026-topps-baseball'},coverage:{raw_cards:1,priced_cards:1,card_images:1,products:6,priced_products:6},complete:false}:null}
});
app.use(express.static(fileURLToPath(new URL('..',import.meta.url))));
const server=app.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
