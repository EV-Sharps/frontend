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
const config={...newSet(1),pack_cost:5,reviewed:true,review_signature:poolSignature(dataset.cards),
  rates:[{rarity:'Rare Ultra',variant:'Holofoil',one_in:10,slot:'main'}]};
const defaults={sets:[config]}, profiles=new Map();
const app=express();
registerPokemonRoutes(app,{ownerId:users.owner,localOwnerOrigin:'',json:express.json,
  supabase:{auth:{getUser:async token=>({data:{user:users[token]?{id:users[token]}:null}})}},
  storage:{
    snapshot:async()=>({schema_version:1,published_at:new Date().toISOString(),catalog:[{group_id:1,name:'Example set'}],datasets:{1:dataset}}),
    settings:async userId=>structuredClone(profiles.get(userId) || defaults),
    saveSettings:async(value,userId)=>profiles.set(userId,structuredClone(value))
  }
});
app.use(express.static(fileURLToPath(new URL('..',import.meta.url))));
const server=app.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
