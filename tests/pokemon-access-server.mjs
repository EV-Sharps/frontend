// In-memory API for the browser access regression; no production credentials/data.
import express from '../../api/node_modules/express/index.js';
import { registerPokemonRoutes } from '../../api/pokemon_route.mjs';
import { newSet, poolSignature } from '../../api/pokemon_model.mjs';
import { fileURLToPath } from 'node:url';

const users={owner:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222'};
const dataset={source_updated_at:new Date().toISOString(),cards:[
  {product_id:1,name:'Pikachu',number:'001',rarity:'Rare Ultra',variant:'Holofoil',market:100,presale:false},
  {product_id:2,name:'Eevee',number:'002',rarity:'Rare Ultra',variant:'Holofoil',market:20,presale:false}
]};
const ebayChecked=new Date().toISOString();
const ebayQuote=(price,extra={})=>({price,currency:'USD',checked_at:ebayChecked,source_url:'https://www.ebay.com/itm/123456789012',sample_count:3,...extra});
dataset.cards[0].ebay_prices={status:'ready',checked_at:ebayChecked,buy_now:ebayQuote(80,{shipping:5,total_price:85}),sold:ebayQuote(45,{last_sale_at:ebayChecked,window_days:30})};
dataset.cards[1].ebay_prices={status:'partial',checked_at:ebayChecked,buy_now:ebayQuote(20,{shipping:null,total_price:null}),sold:ebayQuote(90,{last_sale_at:'2026-11-16',window_days:30})};
const config={...newSet(1),pack_cost:5,reviewed:true,review_signature:poolSignature(dataset.cards),
  rates:[{rarity:'Rare Ultra',variant:'Holofoil',one_in:10,slot:'main'}]};
const defaults={sets:[config]}, profiles=new Map();
const app=express();
let gradedCalls=0;
app.get('/test/graded-calls',(_req,res)=>res.json({calls:gradedCalls}));
registerPokemonRoutes(app,{ownerId:users.owner,localOwnerOrigin:'',json:express.json,
  psaSource:{quotes:async()=>{
    gradedCalls++;
    const quote=price=>({price,currency:'USD',source:'Test auction sample',source_url:'https://example.com/sales',updated_at:new Date().toISOString(),sales:3});
    return {status:'partial',reason:'Some grades have no matched sales.',expires_at:new Date(Date.now()+3600000).toISOString(),quotes:[
      {group_id:1,product_id:1,variant:'Holofoil',graded_prices:{psa_10:quote(150),psa_9:quote(99),psa_8:quote(40)}},
      {group_id:1,product_id:2,variant:'Holofoil',graded_prices:{psa_10:quote(250),psa_8:quote(30)}}
    ]};
  }},
  supabase:{auth:{getUser:async token=>({data:{user:users[token]?{id:users[token]}:null}})}},
  storage:{
    snapshot:async()=>({schema_version:1,published_at:new Date().toISOString(),catalog:[{group_id:1,name:'Example set'}],datasets:{1:dataset}}),
    settings:async userId=>structuredClone(profiles.get(userId) || defaults),
    saveSettings:async(value,userId)=>profiles.set(userId,structuredClone(value))
  }
});
app.use(express.static(fileURLToPath(new URL('..',import.meta.url))));
const server=app.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
