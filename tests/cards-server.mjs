import express from '../../api/node_modules/express/index.js';
import { registerCardsRoutes } from '../../api/cards_route.mjs';
import { emptySettings } from '../../api/cards_model.mjs';
import { fileURLToPath } from 'node:url';

const profiles=new Map(),users={a:'11111111-1111-4111-8111-111111111111',b:'22222222-2222-4222-8222-222222222222'};
const catalog=[{id:'2026-topps-baseball',name:'2026 Topps Baseball',sport:'baseball',year:2026,product_count:2},
  {id:'2025-topps-basketball',name:'2025 Topps Basketball',sport:'basketball',year:2025,product_count:1}];
const app=express();
registerCardsRoutes(app,{json:express.json,
  supabase:{auth:{getUser:async token=>({data:{user:users[token]?{id:users[token]}:null}})}},
  storage:{settings:async id=>structuredClone(profiles.get(id) || emptySettings()),saveSettings:async(settings,id)=>profiles.set(id,structuredClone(settings))},
  source:{catalog:async()=>catalog,set:async id=>catalog.some(s=>s.id===id)?{set:catalog.find(s=>s.id===id),products:[
    {id:'hobby',name:'Hobby',packs_per_box:10,market:40,price_as_of:new Date().toISOString()},
    {id:'blaster',name:'Blaster',packs_per_box:7,market:25,price_as_of:new Date().toISOString()}],
    cards:[{id:'raw-1',name:'Player A',number:'1',parallel:'Gold',raw_price:100,price_as_of:new Date().toISOString(),source_url:'https://example.com/card/1'}],complete:false}:null}
});
app.use(express.static(fileURLToPath(new URL('..',import.meta.url))));
const server=app.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
