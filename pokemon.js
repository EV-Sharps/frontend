(() => {
PAGE="pokemon";
"use strict";
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => value == null ? "—" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
const date = value => value ? new Date(value).toLocaleString('en-US',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}) : "No prices yet";
const rateNumber = value => Number(value.toFixed(8));
const countRate = rate => Object.hasOwn(rate, 'expected_per_pack');
const percentText = value => `${Number(value>0 && value<.01?value.toPrecision(2):value.toFixed(2))}%`;
const countText = value => value<=1?`${percentText(value*100)} avg`:`${Number(value.toFixed(4))} cards/pack`;
const rateText = rate => countRate(rate) ? countText(rate.expected_per_pack) : percentText(100/rate.one_in);
const rateTitle = rate => countRate(rate)?'Average pulls per 100 packs when shown as % avg; this is not the chance of at least one hit when multiple hits can occur.':'Per-pack hit probability.';
function compactRates(config) {
  const frequency=rate=>countRate(rate)?rate.expected_per_pack:1/rate.one_in;
  const rows=[...config.rates].sort((a,b)=>frequency(a)-frequency(b)).slice(0,4);
  const shown=rows.map(row=>`<span class="rate-preview" title="${esc(rateTitle(row))}">${esc(rarityLabels[row.label || row.rarity] || row.label || row.rarity)} ${rateText(row)}</span>`).join('');
  const extra=config.rates.length-rows.length;
  return shown+(extra?`<button type="button" class="rates-more" data-edit="${config.group_id}" title="Show all ${config.rates.length} rates">+${extra} more</button>`:'');
}
function rateSource(row) {
  const url=row.source_url || '';
  const source=url.startsWith('https://pullrates.com/set/')?'PullRates':url.startsWith('https://www.thepricedex.com/set/')?'PriceDex':'';
  return source?` · <a href="${esc(url)}" target="_blank" rel="noreferrer">${source} ↗</a>`:'';
}
const cardNumberOrder = new Intl.Collator('en', {numeric:true, sensitivity:'base'});
function compareCardNumbers(a,b) {
  const left=String(a.number ?? '').split('/')[0].trim(), right=String(b.number ?? '').split('/')[0].trim();
  return Number(!left)-Number(!right) || cardNumberOrder.compare(left,right);
}
const rarityLabels = {"Special Illustration Rare":"SIR","Illustration Rare":"IR","Hyper Rare":"Hyper","Ultra Rare":"Ultra","Double Rare":"Double"};
let state, selected = null, dataset = null, draft = null, dirty = false, polling = false;
const productSelections=new Map();
function error(message = "") { $("#request-error").textContent = message; $("#request-error").hidden = !message; }
let sessionToken='', sessionUser='', authVersion=0, draftRevision='', allowed=false;
let localOwner=false;
const controllers=new Set();
function clearPrivate() {
  productSelections.clear();
  state=null; selected=null; dataset=null; draft=null; dirty=false; allowed=false;
  $("#workbook").hidden=true; $("#access-panel").hidden=false;
  $("#rankings").replaceChildren(); $("#editor").replaceChildren(); $("#editor").hidden=true;
  $("#catalog").replaceChildren(); $("#pool-dialog")?.remove();
  cardPopupVersion++; $("#top-cards-dialog")?.remove();
}
async function request(path,body) {
  if(!sessionToken && !localOwner)throw new Error('Sign in to view your workbook.');
  const version=authVersion, controller=new AbortController(); controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const headers=sessionToken?{Authorization:`Bearer ${sessionToken}`} : {};
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(`${API_BASE}/api/pokemon${path.replace(/^\/api/,'')}`,{
      method:body===undefined?'GET':'POST',headers,cache:'no-store',signal:controller.signal,
      ...(body===undefined?{}:{body:JSON.stringify({...body,revision:body.revision ?? state?.revision})})});
    if(version!==authVersion)throw new DOMException('Session changed','AbortError');
    if(!response.ok) {
      const data=await response.json().catch(()=>({}));
      if(version!==authVersion)throw new DOMException('Session changed','AbortError');
      if([401,403].includes(response.status)){localOwner=false;clearPrivate();$("#access-message").textContent=data.error || 'Access denied.';}
      throw new Error(data.error || 'Unable to load your private workbook.');
    }
    const data=path.startsWith('/api/export/')?await response.blob():await response.json();
    if(version!==authVersion)throw new DOMException('Session changed','AbortError');
    return data;
  } finally {clearTimeout(timer);controllers.delete(controller);}
}
const api=request;

let cardPopupVersion=0, cardPopupView='table', favoriteQueue=Promise.resolve();
try {const view=localStorage.getItem('pokemon.cardView');if(['table','small','medium','large'].includes(view))cardPopupView=view;}catch{}
function favoriteButton(card, disabled=false) {
  const label=`${card.is_chase?'Remove':'Add'} ${card.name} ${card.number || ''} ${card.is_chase?'from':'to'} favorites`;
  return `<button type="button" class="favorite-toggle" data-favorite="${card.product_id}" aria-pressed="${!!card.is_chase}" aria-label="${esc(label)}" title="${esc(label)}" ${disabled?'disabled':''}><span aria-hidden="true">${card.is_chase?'★':'☆'}</span></button>`;
}
function saveFavorite(groupId, productId, favorite, cards) {
  const sessionVersion=authVersion;
  const operation=favoriteQueue.then(async()=>{
    if(sessionVersion!==authVersion)throw new DOMException('Session changed','AbortError');
    // Merge only this star into the latest workbook; revision checking protects concurrent edits.
    const latest=await api('/api/state'), settings=structuredClone(latest.settings);
    const config=settings.sets.find(c=>c.group_id===groupId);
    if(!config)throw new Error('This set is no longer tracked. Refresh the page.');
    const ids=new Set(config.chase_ids || []);
    if(favorite)ids.add(productId);else ids.delete(productId);
    config.chase_ids=[...ids].sort((a,b)=>a-b);
    const saved=await api('/api/settings',{...settings,revision:latest.revision});
    state={...latest,settings,revision:saved.revision};
    const item=state.sets.find(s=>s.group_id===groupId);
    const favorites=cards.filter(c=>ids.has(c.product_id)).map(c=>({...c,is_chase:true}));
    item.chase_count=favorites.length;
    item.chase_cards=favorites.sort((a,b)=>(b.market ?? -1)-(a.market ?? -1) || a.product_id-b.product_id).slice(0,5);
    item.featured_cards=item.featured_cards.map(c=>({...c,is_chase:ids.has(c.product_id)}));
    if(draft && draftRevision===latest.revision) {
      if(draft.group_id===groupId)draft.chase_ids=[...config.chase_ids];
      draftRevision=saved.revision;
    }
    renderBoard();
    $('#top-cards-dialog')?.dispatchEvent(new Event('favoritesupdated'));
  });
  favoriteQueue=operation.catch(()=>{});
  return operation;
}
function cardArt(card,extraClass='',large=false,interactive=false,disabled=false) {
  let url='';
  try {const parsed=new URL(card.image_url);if(parsed.protocol==='https:' && parsed.hostname==='tcgplayer-cdn.tcgplayer.com' && parsed.pathname.startsWith('/product/'))url=parsed.href;}catch{}
  const source=large?url.replace(/_200w\.(jpg|png)(?=\?|$)/,'_400w.$1'):url;
  return `<span class="card-art ${extraClass} ${url?'has-image':''}"><span class="art-fallback" aria-hidden="true">◇<small>Image unavailable</small></span>${interactive?favoriteButton(card,disabled):card.is_chase?'<span class="chase-marker" title="Favorite card" aria-label="Favorite card">★</span>':''}${url?`<img class="card-image" src="${esc(source)}" ${source!==url?`data-fallback-src="${esc(url)}"`:''} alt="${esc(card.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
document.addEventListener('error',event=>{
  if(event.target.matches?.('img.card-image')){
    const fallback=event.target.dataset.fallbackSrc;
    if(fallback){delete event.target.dataset.fallbackSrc;event.target.src=fallback;return;}
    event.target.closest('.card-art').classList.add('image-failed');event.target.hidden=true;
  }
},true);
const cardFrequency = card => card.per_card_expected_count ?? (card.per_card_one_in?1/card.per_card_one_in:Infinity);
function estimatedOdds(card) {
  const count=card.per_card_expected_count, oneIn=card.per_card_one_in;
  if(Number.isFinite(count) && count>=0)return `Est. ${countText(count)}${count<=1?' / pack':''}`;
  if(Number.isFinite(oneIn) && oneIn>=1)return `Est. ${percentText(100/oneIn)} / pack · 1 in ${Math.round(oneIn).toLocaleString()}`;
  return 'Rate unavailable';
}
function estimatedOddsTitle(card) {
  if(Number.isFinite(card.per_card_expected_count) && card.per_card_expected_count>=0)return 'Average copies of this card per pack. % avg means average copies per 100 packs, not the probability of at least one. Assumes equal frequency within its modeled pool.';
  if(Number.isFinite(card.per_card_one_in) && card.per_card_one_in>=1)return 'Estimated per-pack chance for this specific card, assuming equal frequency within its modeled pool. One-in-N is rounded.';
  return 'No reliable card-level rate is available from the configured pools.';
}
async function openTopCards(id, onlyChases=false) {
  const item=state?.sets.find(s=>s.group_id===id);
  if(!item)return;
  $('#top-cards-dialog')?.remove();
  const version=++cardPopupVersion, sessionVersion=authVersion;
  const dialog=document.createElement('dialog');dialog.id='top-cards-dialog';dialog.className='top-cards-dialog';
  dialog.setAttribute('aria-labelledby','top-cards-title');
  dialog.innerHTML=`<div class="top-cards-head"><div><h2 id="top-cards-title">${esc(item.name)}</h2><p id="top-cards-meta" class="help">Loading…</p></div><button type="button" class="modal-close" aria-label="Close cards" autofocus>×</button></div><div class="top-cards-toolbar"><div class="card-view-toggle" role="group" aria-label="Card view"><button type="button" data-card-view="table" aria-pressed="true">Table</button><button type="button" data-card-view="small" aria-pressed="false">Small</button><button type="button" data-card-view="medium" aria-pressed="false">Medium</button><button type="button" data-card-view="large" aria-pressed="false">Large</button></div><input id="top-cards-search" type="search" placeholder="Filter cards" aria-label="Filter cards"><label>Sort <select id="top-cards-sort"><option value="value">Price</option><option value="rarity">Rarity</option><option value="number">No.</option><option value="chase">Favorites first</option></select></label><label class="check"><input id="top-cards-chases" type="checkbox" ${onlyChases?"checked":""}><span id="top-favorites-label">Favorites only (${item.chase_count || 0})</span></label><span id="top-cards-status" role="status">Loading…</span><span id="favorite-save-status" role="status"></span><button id="top-cards-configure" type="button">Edit set</button></div><p id="favorite-error" class="error" role="alert" hidden></p><div id="top-cards-grid" class="top-cards-grid" aria-busy="true"><table id="top-cards-table"><thead><tr><th>#</th><th title="Favorite">★</th><th></th><th>Card</th><th>No.</th><th>Rarity</th><th>Print</th><th>Market $</th><th title="Hit odds or average cards per pack; equal frequency within each pool">Est. hit / pack</th><th title="% avg means average pulls per 100 packs, not the chance of at least one when multiple pulls can occur">Pool / pack</th></tr></thead><tbody id="top-cards-rows"></tbody></table><div id="top-cards-gallery" class="large-card-grid" hidden></div></div>`;
  document.body.append(dialog);
  let redraw, savingFavorite=false;
  function setView(view) {
    cardPopupView=view;
    try {localStorage.setItem('pokemon.cardView',view);}catch{}
    dialog.querySelectorAll('[data-card-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cardView===view)));
    $('#top-cards-table').hidden=view!=='table';
    $('#top-cards-gallery').hidden=view==='table';
    $('#top-cards-gallery').dataset.cardSize=view==='table'?'large':view;
    redraw?.();
    $('#top-cards-grid').scrollTop=0;
    $('#top-cards-grid').scrollLeft=0;
  }
  dialog.querySelectorAll('[data-card-view]').forEach(button=>button.onclick=()=>setView(button.dataset.cardView));
  setView(cardPopupView);
  dialog.querySelector('.modal-close').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.target===dialog && (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom))dialog.close();});
  dialog.addEventListener('close',()=>{cardPopupVersion++;dialog.remove();document.querySelector(`#rankings [data-view="${id}"]`)?.focus({preventScroll:true});});
  $('#top-cards-configure').onclick=()=>{dialog.close();openEditor(id).catch(e=>error(e.message));};
  dialog.showModal();
  try {
    const data=await api(`/api/set/${id}`);
    if(version!==cardPopupVersion || sessionVersion!==authVersion || !dialog.open)return;
    const cards=data.highlights || [];
    const names=new Map(state.catalog.map(s=>[s.group_id,s.name]));
    $('#top-cards-meta').textContent=`${cards.length} cards · ${date(data.source_updated_at)}`;
    function draw() {
      const sort=$('#top-cards-sort').value, query=$('#top-cards-search').value.trim().toLowerCase();
      const sorted=cards.filter(c=>!$('#top-cards-chases').checked || c.is_chase).filter(c=>`${c.name} ${c.number} ${c.rarity} ${c.pool_label}`.toLowerCase().includes(query)).sort((a,b)=>(sort==='number'?compareCardNumbers(a,b):sort==='rarity'?cardFrequency(a)-cardFrequency(b):sort==='chase'?Number(b.is_chase)-Number(a.is_chase):0) || (b.market ?? -1)-(a.market ?? -1) || a.product_id-b.product_id);
      $('#top-cards-status').textContent=`${sorted.length}/${cards.length}`;
      $('#top-favorites-label').textContent=`Favorites only (${cards.filter(c=>c.is_chase).length})`;
      if(cardPopupView!=='table') {
        $('#top-cards-rows').replaceChildren();
        $('#top-cards-gallery').innerHTML=sorted.map(card=>`<article class="large-card">${cardArt(card,'',cardPopupView!=='small',true,savingFavorite)}<div class="large-card-meta"><span class="large-card-number">No. ${esc(card.number || '—')}</span><strong class="large-card-market" title="Market price">${money(card.market)}</strong><h3>${esc(card.name)}</h3><span class="large-card-odds" title="${esc(estimatedOddsTitle(card))}">${esc(estimatedOdds(card))}</span></div></article>`).join('') || '<p class="empty">No cards</p>';
        $('#top-cards-grid').setAttribute('aria-busy','false');
        return;
      }
      $('#top-cards-gallery').replaceChildren();
      $('#top-cards-rows').innerHTML=sorted.map((card,index)=>`<tr class="chase-card"><td class="chase-rank">${index+1}</td><td class="favorite-cell">${favoriteButton(card,savingFavorite)}</td><td class="chase-art">${cardArt({...card,is_chase:false})}</td><td><h3>${esc(card.name)}${card.presale?'<span class="presale-badge">Presale</span>':''}</h3>${card.group_id!==id?`<div class="chase-source">${esc(names.get(card.group_id) || 'Gallery')}</div>`:''}</td><td class="chase-number">${esc(card.number || '—')}</td><td class="chase-rarity">${esc(card.pool_label || card.rarity || '—')}</td><td>${esc(card.variant)}</td><td class="chase-price number">${money(card.market)}</td><td class="chase-odds number" title="${esc(estimatedOddsTitle(card))}">${esc(estimatedOdds(card))}</td><td class="pool-rate number" title="% avg means average pulls per 100 packs">${card.pool_expected_per_pack!=null?countText(card.pool_expected_per_pack):card.pool_one_in?percentText(100/card.pool_one_in):'—'}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">No cards</td></tr>';
      $('#top-cards-grid').setAttribute('aria-busy','false');
    }
    dialog.addEventListener('favoritesupdated',()=>{
      const ids=new Set(state?.settings.sets.find(c=>c.group_id===id)?.chase_ids || []);
      cards.forEach(c=>{c.is_chase=ids.has(c.product_id);});
      draw();
    });
    dialog.addEventListener('click',async event=>{
      const button=event.target.closest('[data-favorite]');
      if(!button || savingFavorite)return;
      const card=cards.find(c=>c.product_id===Number(button.dataset.favorite));
      if(!card)return;
      const desired=!card.is_chase;
      savingFavorite=true;
      $('#favorite-error').hidden=true;
      $('#favorite-save-status').textContent='Saving…';
      dialog.querySelectorAll('[data-favorite]').forEach(b=>{b.disabled=true;});
      try {
        await saveFavorite(id,card.product_id,desired,cards);
        if(version!==cardPopupVersion || sessionVersion!==authVersion || !dialog.open)return;
        $('#favorite-save-status').textContent='Saved';
      }catch(e){
        if(version!==cardPopupVersion || sessionVersion!==authVersion || !dialog.open)return;
        $('#favorite-save-status').textContent='';
        $('#favorite-error').textContent=e.message;
        $('#favorite-error').hidden=false;
      }finally{
        savingFavorite=false;
        if(version===cardPopupVersion && sessionVersion===authVersion && dialog.open) {
          draw();
          (dialog.querySelector(`[data-favorite="${card.product_id}"]`) || $('#top-cards-chases')).focus({preventScroll:true});
        }
      }
    });
    $('#top-cards-sort').onchange=draw;
    $('#top-cards-search').oninput=draw;
    $('#top-cards-chases').onchange=draw;
    redraw=draw;
    draw();
  }catch(e){
    if(version!==cardPopupVersion || sessionVersion!==authVersion || !dialog.open)return;
    $('#top-cards-status').textContent=e.message;
    $('#top-cards-meta').textContent='Unavailable';
    $('#top-cards-grid').setAttribute('aria-busy','false');
  }
}

function catalog() {
  if (!state) return;
  const previous = $("#catalog").value;
  const query = $("#set-search").value.toLowerCase();
  const tracked = new Set(state.settings.sets.map(x => x.group_id));
  const available = state.catalog.filter(x => !tracked.has(x.group_id) && x.name.toLowerCase().includes(query)).sort((a,b) => a.name.localeCompare(b.name));
  $("#catalog").innerHTML = available.map(x => `<option value="${x.group_id}">${esc(x.name)}</option>`).join("") || '<option value="">No matching sets</option>';
  if (available.some(x => String(x.group_id) === previous)) $("#catalog").value = previous;
}
function selectedProduct(item,kind) {
  const rows=item.sealed_products?.[kind] || [], selectedId=productSelections.get(`${item.group_id}:${kind}`);
  return rows.find(p=>p.product_id===selectedId) || rows[0] || null;
}
function productCell(item,kind) {
  const rows=item.sealed_products?.[kind] || [], chosen=selectedProduct(item,kind);
  if(!chosen)return '<td class="number sealed-price">—</td>';
  const label=p=>`${money(p.market)} / ${p.pack_count || '?'} pk`;
  const description=p=>`${p.name}; ${p.pack_count?`${p.pack_count} packs, ${money(p.cost_per_pack)}/pack`:p.pack_count_issue}; ${date(p.source_updated_at)}. Pack contents only; promos/accessories excluded.`;
  const variants=rows.length>1?`<select class="sealed-select" data-product-kind="${kind}" data-product-set="${item.group_id}" aria-label="${esc(item.name)} ${kind==='etb'?'ETB':'booster bundle'} variant" title="${esc(description(chosen))}">${rows.map(p=>`<option value="${p.product_id}" ${p.product_id===chosen.product_id?'selected':''}>${label(p)} · ${esc(p.name)}</option>`).join('')}</select>`:`<span title="${esc(description(chosen))}">${label(chosen)}</span>`;
  return `<td class="number sealed-price" data-kind="${kind}">${variants}</td>`;
}
function comparison(item) {
  const basis=$('#product-basis').value, unit=$('#value-unit').value;
  const product=basis==='pack'?{...item,pack_count:1,cost_per_pack:item.pack_cost}:selectedProduct(item,basis);
  if(!product)return {eligible:false,issues:[`No ${basis} price`],availability_issue:`No ${basis==='etb'?'ETB':'bundle'}`,gross_ev:null,net_profit:null,roi:null,pack_cost:null,return_percent:null,break_even_buy:null,expected_loss_per_pack:null};
  const divisor=unit==='pack'?(product.pack_count || 1):1;
  return {...product,pack_cost:product.cost_per_pack,
    break_even_buy:product.break_even_buy==null?null:product.break_even_buy/divisor,
    gross_ev:product.gross_ev==null?null:product.gross_ev/divisor,
    net_profit:product.net_profit==null?null:product.net_profit/divisor};
}
function compactStatus(item,config) {
  if(item.availability_issue)return item.availability_issue;
  if(item.eligible)return 'Ready';
  const flags=[];
  if(!item.source_updated_at)flags.push('No prices');
  if(item.issues.some(s=>s.includes('48 hours')))flags.push('Stale');
  if(item.pack_count_issue)flags.push(item.pack_count_issue==='Mixed-set packs'?'Mixed packs':'Pack count');
  else if(item.pack_cost===null)flags.push('Pack $');
  if(!config.reviewed || item.issues.some(s=>s.includes('review the pools again')))flags.push('Review');
  if(!config.rates.length || config.unspecified_rarities?.length)flags.push('Rates');
  if(config.coverage_issues?.length)flags.push('Gaps');
  if(item.issues.some(s=>/missing|priced|mapping|overlap|presale/i.test(s)))flags.push('Pools');
  return [...new Set(flags)].join(', ') || 'Check';
}
function renderBoard() {
  if(!state)return;
  const key=$('#sort').value, query=$('#filter-sets').value.trim().toLowerCase();
  const basis=$('#product-basis').value, unit=$('#value-unit').value;
  const unitLabel=unit==='pack' || basis==='pack'?'pack':basis==='etb'?'ETB':'bundle';
  $('#ev-heading').textContent=`EV / ${unitLabel}`;
  $('#net-heading').textContent=`Net / ${unitLabel}`;
  $('#breakeven-heading').textContent=`Break-even / ${unitLabel}`;
  const compare=(a,b)=>{
    const left=key==='chase_count'?a.item.chase_count:a.metrics[key],right=key==='chase_count'?b.item.chase_count:b.metrics[key];
    const difference=left==null?right==null?0:1:right==null?-1:key==='expected_loss_per_pack'?left-right:right-left;
    return Number(b.metrics.eligible)-Number(a.metrics.eligible) || difference || a.item.name.localeCompare(b.item.name);
  };
  const sorted=state.sets.map(item=>({item,metrics:comparison(item)})).sort(compare);
  let rank=0;
  const visible=sorted.filter(({item})=>item.name.toLowerCase().includes(query) && (!$('#chase-sets-only').checked || item.chase_count>0));
  $('#rankings').innerHTML=visible.map(({item,metrics})=>{
    const config=state.settings.sets.find(x=>x.group_id===item.group_id), featured=($('#chase-sets-only').checked?item.chase_cards:item.featured_cards) || [];
    const rates=compactRates(config);
    const detail=esc(metrics.issues.join(' '));
    const packTitle=item.pack_cost_source==='market'?`TCGplayer market: ${item.market_pack.name}; ${date(item.market_pack.source_updated_at)}. Excludes tax/shipping.`:item.pack_cost_source==='manual'?'Your pack price override':'No standard booster price; enter a pack cost in Edit.';
    const value=(v,roi=false)=>v==null?'—':`${metrics.eligible?'':'~'}${roi?v.toFixed(1)+'%':money(v)}`;
    return `<tr data-set="${item.group_id}"><td class="rank">${metrics.eligible?++rank:'—'}</td><td class="setname"><button type="button" class="set-open" data-view="${item.group_id}" aria-label="View cards in ${esc(item.name)}" aria-haspopup="dialog" title="${$('#chase-sets-only').checked?'Your favorites by market price':'Top 5 by market price'}"><span class="card-fan" aria-hidden="true">${featured.map(c=>`<span class="main-card-preview" title="${esc(c.name)} / ${esc(c.variant)} / ${money(c.market)}" data-market="${c.market}">${cardArt(c,'mini-card')}<span class="preview-price">${money(c.market)}</span></span>`).join('')}</span><span class="set-title">${esc(item.name)}</span></button></td><td class="number" title="${esc(date(item.source_updated_at))}">${item.card_count}</td><td class="number chase-count">${item.chase_count?`<button type="button" class="chases-open" data-chases="${item.group_id}" title="View your favorite cards">★ ${item.chase_count}</button>`:"—"}</td><td class="rate-values">${rates || '—'}</td><td class="number pack-cost" data-source="${item.pack_cost_source || ''}" title="${esc(packTitle)}">${money(item.pack_cost)}</td>${productCell(item,'etb')}${productCell(item,'bundle')}<td class="number unit-cost">${money(metrics.pack_cost)}</td><td class="number return-value" title="${detail}">${value(metrics.return_percent,true)}</td><td class="number break-even" title="${detail}">${value(metrics.break_even_buy)}</td><td class="number expected-loss" title="${detail}">${value(metrics.expected_loss_per_pack)}</td><td class="number ${metrics.eligible?'':'provisional'}" title="${detail}">${value(metrics.gross_ev)}</td><td class="number ${metrics.eligible?(metrics.net_profit>=0?'positive':'negative'):'provisional'}" title="${detail}">${value(metrics.net_profit)}</td><td class="number" title="${detail}">${value(metrics.roi,true)}</td><td class="status-cell" title="${detail}">${esc(compactStatus(metrics,config))}</td><td><button data-edit="${item.group_id}" type="button">Edit</button></td></tr>`;
  }).join('') || '<tr><td colspan="17" class="empty">No sets</td></tr>';
  const cutoffs=[...new Set(state.settings.sets.map(c=>c.min_sale_price ?? 0))];
  $('#sale-cutoff').textContent=cutoffs.length===1?(cutoffs[0]>0?`Sell ≥ ${money(cutoffs[0])}`:'All card prices'):'Sale cutoffs vary';
  $('#set-count').textContent=`${visible.length}/${state.sets.length} sets · ${state.settings.sets.reduce((n,s)=>n+s.rates.length,0)} rates · ${state.sets.reduce((n,s)=>n+(s.chase_count || 0),0)} favorites`;
  $('#sync-status').textContent=`Saved ${date(state.published_at)}`;
  $('#refresh').disabled=state.status.running;
  if(state.status.errors.length)error(state.status.errors.join('\n'));
  catalog();
}

async function reload() {
  state = await api("/api/state");
  allowed=true; $("#workbook").hidden=false; $("#access-panel").hidden=true;
  renderBoard();
}
function options(values, chosen) {
  return [...new Set([...values, chosen].filter(Boolean))].sort().map(value => `<option ${value === chosen ? "selected" : ""} value="${esc(value)}">${esc(value)}</option>`).join("");
}
function renderRates() {
  const rarities = dataset ? dataset.cards.map(x => x.rarity).filter(Boolean) : [];
  $("#rates").innerHTML = draft.rates.map((row,index) => {
    const custom = Array.isArray(row.product_ids) || !!row.label;
    const variants = dataset ? dataset.cards.filter(x => (custom ? row.product_ids?.includes(x.product_id) : x.rarity === row.rarity) && x.variant !== "Unknown").map(x => x.variant) : [];
    const percent = draft.rate_unit !== "one_in";
    const count=countRate(row), countPercent=count && percent && row.expected_per_pack<=1;
    const value = count ? row.expected_per_pack===""?"":countPercent?rateNumber(row.expected_per_pack*100):row.expected_per_pack : row.one_in ? (percent ? rateNumber(100 / row.one_in) : row.one_in) : "";
    const poolCell = custom ? `<strong>${esc(row.label || row.rarity)}</strong><small class="help rate-equivalent">${row.mapping_status === "pending" ? "Mapping required" : `${(row.product_ids || []).length} selected cards`}</small><button type="button" class="quiet small" data-pool="${index}">Pool</button>` : `<select aria-label="Rarity" data-field="rarity">${options(rarities,row.rarity)}</select>`;
    return `<tr data-row="${index}"><td>${poolCell}</td><td><select aria-label="Printing" data-field="variant">${options(variants,row.variant)}</select></td><td><select aria-label="Rate type" data-field="rate_kind"><option value="chance" ${count?"":"selected"}>Hit chance</option><option value="count" ${count?"selected":""}>${countPercent?"Avg pulls (%/pack)":"Avg cards/pack"}</option></select><input aria-label="${countPercent ? "Average pulls per 100 packs (%)" : count ? "Average cards per pack" : percent ? "Per-pack percentage" : "One in N packs"}" data-field="rate_value" data-count-percent="${countPercent}" type="number" min="${countPercent ? ".0000001" : count ? ".000000001" : percent ? ".000001" : "1"}" ${countPercent ? 'max="2000"' : count ? 'max="20"' : percent ? 'max="100"' : ""} step="any" value="${esc(value)}" required><small class="help rate-equivalent">${countPercent ? "%/pack avg" : count ? "cards/pack" : rateEquivalent(row.one_in,percent)}</small></td><td><input aria-label="Pack slot" class="slot" data-field="slot" value="${esc(row.slot)}" maxlength="100"></td><td><button type="button" class="quiet small" data-remove="${index}" aria-label="Remove rate">×</button></td></tr>`;
  }).join("") || '<tr><td colspan="5" class="empty">No odds assumed. Add your first hit rate below.</td></tr>';
}
function rateEquivalent(oneIn, percent) {
  if (!oneIn || !Number.isFinite(oneIn)) return "";
  return percent ? `≈ 1 in ${Number(oneIn.toFixed(2))} packs` : `${rateNumber(100 / oneIn)}% per pack`;
}
function openPool(index) {
  if (!dataset) return;
  let dialog = $("#pool-dialog");
  if (!dialog) {dialog=document.createElement("dialog"); dialog.id="pool-dialog"; document.body.append(dialog);}
  const rate = draft.rates[index];
  const selectedIds = new Set(rate.product_ids || []);
  const candidates = dataset.cards.filter(card => card.variant === rate.variant || card.variant === "Unknown");
  const names = new Map(state.catalog.map(item => [item.group_id,item.name]));
  dialog.innerHTML = `<form id="pool-form"><h2>${esc(rate.label || rate.rarity)}</h2><div class="pooltools"><input id="pool-search" type="search" aria-label="Filter pool cards" placeholder="Card name, number, or rarity…"><label class="check"><input id="pool-selected-only" type="checkbox" ${selectedIds.size ? "checked" : ""}> Selected only</label></div><p id="pool-count" class="help"></p><p id="pool-error" class="error" hidden></p><div class="pool-list" id="pool-cards"></div><div class="actions"><button type="submit">Use selected cards</button><button id="pool-cancel" type="button" class="quiet">Cancel</button></div></form>`;
  function draw() {
    const query=$("#pool-search").value.toLowerCase();
    $("#pool-count").textContent=`${selectedIds.size} cards selected. `;
    $("#pool-cards").innerHTML=candidates.filter(card => (!$("#pool-selected-only").checked || selectedIds.has(card.product_id)) && `${card.name} ${card.number} ${card.rarity}`.toLowerCase().includes(query)).map(card => `<label class="pool-card"><input type="checkbox" data-pool-card="${card.product_id}" ${selectedIds.has(card.product_id) ? "checked" : ""}><span>${esc(card.name)} <span class="muted">#${esc(card.number)}</span><small>${esc(card.rarity)} · ${esc(names.get(card.group_id) || "Main set")} · ${money(card.market)}</small></span></label>`).join("") || '<p class="help">No matching cards.</p>';
  }
  $("#pool-search").oninput=draw;
  $("#pool-selected-only").onchange=draw;
  $("#pool-cards").onchange=event => {const id=Number(event.target.dataset.poolCard); if(!id)return; if(event.target.checked)selectedIds.add(id);else selectedIds.delete(id);$("#pool-count").textContent=`${selectedIds.size} cards selected. `;};
  $("#pool-cancel").onclick=()=>dialog.close();
  $("#pool-form").onsubmit=event => {
    event.preventDefault();
    if (!selectedIds.size) {$("#pool-error").hidden=false;$("#pool-error").textContent="Select at least one card.";return;}
    rate.product_ids=[...selectedIds].sort((a,b)=>a-b);rate.mapping_status="mapped";rate.rarity="";
    if(!(rate.mapping_note || "").includes("Pool edited in private workbook."))rate.mapping_note=(rate.mapping_note || "")+" Pool edited in private workbook.";
    draft.reviewed=false;$("[name=reviewed]").checked=false;
    renderRates();markDirty();dialog.close();
  };
  draw();dialog.showModal();
}
function renderCards() {
  const query = $("#card-search").value.toLowerCase();
  const rows = dataset?.cards || [];
  const excluded = new Set(draft.excluded_ids);
  $("#cards").innerHTML = [...rows].filter(x => `${x.name} ${x.number} ${x.rarity} ${x.variant}`.toLowerCase().includes(query)).sort((a,b) => (b.market ?? -1)-(a.market ?? -1)).map(card => `<tr class="${excluded.has(card.product_id) ? "excluded" : ""}"><td><input type="checkbox" aria-label="Include ${esc(card.name)}" data-card="${card.product_id}" ${excluded.has(card.product_id) ? "" : "checked"}></td><td>${esc(card.name)} <span class="muted">${esc(card.number)}</span>${card.presale ? ' <span class="negative">Presale</span>' : ""}</td><td>${esc(card.rarity)}</td><td>${esc(card.variant)}</td><td class="number">${money(card.market)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">No matching cards.</td></tr>';
}
async function openEditor(id, scroll = true) {
  if (dirty && !window.confirm("Discard your unsaved edits?")) return;
  const item = state.sets.find(x => x.group_id === id);
  if (!item) return;
  selected = id;
  draftRevision=state.revision;
  draft = structuredClone(state.settings.sets.find(x => x.group_id === id));
  dataset = item.source_updated_at ? await api(`/api/set/${id}`) : null;
  if(selected!==id)return;
  if (draft.review_signature !== dataset?.pool_signature) draft.reviewed = false;
  dirty = false;
  const fields = [["pack_cost","Pack $",draft.pack_cost,"0.01"],["selling_fee_percent","Fee %",draft.selling_fee_percent,"0"],["cost_per_pack","Costs $",draft.cost_per_pack,"0"],["bulk_ev","Bulk $",draft.bulk_ev,"0"],["min_sale_price","Sell ≥ $",draft.min_sale_price ?? 0,"0"]];
  $("#editor").innerHTML = `<div class="sectionhead"><div><h2 id="editor-title">${esc(item.name)}</h2></div><button id="close-editor" class="quiet">Close ×</button></div><p class="help">Source: ${esc(date(dataset?.source_updated_at))} · Downloaded: ${esc(date(dataset?.fetched_at))}</p><form id="config-form"><div class="fields">${fields.map(([key,label,value,min]) => `<label>${label}<input name="${key}" type="number" min="${min}" ${key === "selling_fee_percent" ? 'max="100"' : ""} step="any" value="${esc(value)}" ${key === "pack_cost" ? "" : "required"}></label>`).join("")}</div><h3>Hit rates</h3><div class="tablewrap"><table class="rates"><thead><tr><th>Rarity</th><th>Printing</th><th>1 in N packs</th><th>Slot</th><th></th></tr></thead><tbody id="rates"></tbody></table></div><div class="ratefooter"><button id="add-rate" type="button" class="quiet small" ${dataset ? "" : "disabled"}>+ Add a hit rate</button></div><details class="source-notes"><summary>Notes</summary><label class="help"><textarea name="notes" maxlength="4000" placeholder="Where your rates came from, packs sampled, and any assumptions…">${esc(draft.notes)}</textarea></label></details><details><summary>Cards & prices · ${dataset?.cards.length || 0} printings</summary><div class="pooltools"><input id="card-search" type="search" placeholder="Find a card, rarity, or printing…" aria-label="Search cards">${dataset ? `<a id="download-prices" href="#">Download prices as CSV ↓</a>` : ""}</div><div class="cardswrap"><table><thead><tr><th>Include</th><th>Card</th><th>Rarity</th><th>Printing</th><th>Market</th></tr></thead><tbody id="cards"></tbody></table></div></details><label class="check"><input name="reviewed" type="checkbox" ${draft.reviewed ? "checked" : ""}><span>Pools reviewed; equal odds within each pool.</span></label><div class="actions"><button class="save" type="submit">Save</button><span id="save-status" class="help" role="status"></span><button id="untrack" type="button" class="quiet">Remove set</button></div></form><details open><summary>EV breakdown</summary><p class="help">${esc(item.issues.join(" "))}</p><div class="metricline"><div><span>SELLABLE CARD VALUE</span><strong>${money(item.gross_ev)}</strong></div><div><span>AFTER FEES & OTHER COSTS</span><strong>${money(item.net_proceeds)}</strong></div><div><span>NET PROFIT / PACK</span><strong>${money(item.net_profit)}</strong></div></div><div class="tablewrap"><table><thead><tr><th>Pool</th><th>Priced cards</th><th>Sellable</th><th>Average sale value</th><th>Per-pack rate</th><th>EV contribution</th></tr></thead><tbody>${item.breakdown.map(row => `<tr><td>${esc(row.rarity)} / ${esc(row.variant)}</td><td>${row.priced} / ${row.cards}</td><td>${row.sellable_cards ?? "—"}</td><td>${money(row.average)}</td><td title="${esc(rateTitle(row))}">${rateText(row)}</td><td>${money(row.contribution)}</td></tr>`).join("")}</tbody></table></div></details>`;
  const packInput=$('[name=pack_cost]'), marketPack=dataset?.market_pack;
  packInput.placeholder=marketPack?`Market ${money(marketPack.market)}`:'Enter price';
  packInput.title='Leave blank to use the saved booster-pack market price. Enter your price to override it.';
  if(marketPack) {
    $('.fields').insertAdjacentHTML('afterend',`<button id="use-market-pack" type="button" class="quiet small" title="${esc(marketPack.name)}; ${esc(date(marketPack.source_updated_at))}. Excludes tax/shipping.">Use market ${money(marketPack.market)}</button>`);
    $('#use-market-pack').onclick=()=>{packInput.value='';markDirty();};
  }
  const minimumInput=$('[name=min_sale_price]'), bulkInput=$('[name=bulk_ev]');
  minimumInput.title='Cards below this market price contribute $0 to EV but remain in the pull pool. Exactly this price counts. Set 0 to count all prices.';
  const syncBulk=()=>{bulkInput.readOnly=Number(minimumInput.value)>0;bulkInput.title=bulkInput.readOnly?'Bulk allowance is excluded while a sale cutoff is set.':'Optional value for unmodeled bulk.';};
  minimumInput.addEventListener('input',syncBulk);syncBulk();
  draft.rate_unit = draft.rate_unit || "percent";
  const rateLabel = document.createElement("label");
  rateLabel.className = "rate-unit";
  rateLabel.innerHTML = `Units <select id="rate-unit"><option value="percent">% per pack</option><option value="one_in">1 in N</option></select>`;
  $(".rates").closest(".tablewrap").before(rateLabel);
  $("#rate-unit").value = draft.rate_unit;
  $(".rates th:nth-child(3)").textContent = "Per-pack rate";
  $("#rate-unit").onchange = event => {draft.rate_unit=event.target.value; renderRates(); markDirty();};
  const sourcedRates = draft.rates.filter(row => row.source_url || row.mapping_note);
  if (sourcedRates.length) {
    const provenance=document.createElement("details");
    provenance.innerHTML=`<summary>Sources</summary>${sourcedRates.map(row => `<p class="help"><strong>${esc(row.label || row.rarity)}</strong>${rateSource(row)}<br>${esc(row.mapping_note)}</p>`).join("")}`;
    $(".ratefooter").after(provenance);
  }
  if (dataset?.related_group_ids?.length) {
    const related=document.createElement("p");related.className="help";
    related.textContent="Catalogs: "+dataset.related_group_ids.map(id=>state.catalog.find(item=>item.group_id===id)?.name || id).join("; ");
    $(".ratefooter").after(related);
  }
  document.querySelectorAll("#editor > details:last-child tbody tr").forEach((row,index)=> {const rate=item.breakdown[index];row.firstElementChild.textContent=`${rate.label || rate.rarity} / ${rate.variant}`;});
  if (item.unmodeled_special_rarities?.length) {
    const coverage = document.createElement("p");
    coverage.className = "notice";
    coverage.textContent = `Unmodeled: ${item.unmodeled_special_rarities.join(", ")}`;
    $(".ratefooter").after(coverage);
  }
  const unknownRarities = [...new Set([...(draft.unspecified_rarities || []), ...(draft.not_applicable_rarities || [])])];
  if (unknownRarities.length) {
    const unresolved = document.createElement("div");
    unresolved.className = "notice";
    unresolved.innerHTML = `<strong>Missing rates; mark absent if not in pack:</strong>${unknownRarities.map(rarity => `<label class="check"><input type="checkbox" name="not_applicable" value="${esc(rarity)}" ${(draft.not_applicable_rarities || []).includes(rarity) ? "checked" : ""}><span>${esc(rarity)} does not occur in this pack.</span></label>`).join("")}`;
    $(".ratefooter").after(unresolved);
  }
  $("#editor").hidden = false;
  renderRates(); renderCards();
  $("#download-prices")?.addEventListener('click',async event=>{
    event.preventDefault();
    try {const blob=await request(`/api/export/${id}`);const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=`pokemon-${id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){if(e.name!=='AbortError')error(e.message);}
  });
  $("#card-search").addEventListener("input", renderCards);
  $("#config-form").addEventListener("input", event => { if (event.target.id !== "card-search") markDirty(); });
  $("#rates").addEventListener("change", event => {
    const row = event.target.closest("tr[data-row]");
    const field = event.target.dataset.field;
    if (!row || !field) return;
    const rate = draft.rates[Number(row.dataset.row)];
    if (field === "rate_value") {
      const value = Number(event.target.value);
      if(countRate(rate))rate.expected_per_pack=event.target.dataset.countPercent==='true'?value/100:value;
      else rate.one_in = value > 0 ? (draft.rate_unit === "one_in" ? value : 100 / value) : "";
      row.querySelector("[data-field=rate_value] + .rate-equivalent").textContent = countRate(rate)?event.target.dataset.countPercent==='true'?"%/pack avg":"cards/pack":rateEquivalent(rate.one_in,draft.rate_unit !== "one_in");
    } else if(field === "rate_kind") {
      if(event.target.value==='count') {rate.expected_per_pack=rate.one_in?1/rate.one_in:"";delete rate.one_in;}
      else {rate.one_in=rate.expected_per_pack>0 && rate.expected_per_pack<=1?1/rate.expected_per_pack:"";delete rate.expected_per_pack;}
      renderRates();
    } else {
      rate[field] = event.target.value;
    }
    if (field === "rarity") {
      const variants = [...new Set(dataset.cards.filter(x => x.rarity === event.target.value).map(x => x.variant))];
      draft.rates[Number(row.dataset.row)].variant = variants.includes("Holofoil") ? "Holofoil" : variants[0];
      renderRates();
    }
    markDirty();
  });
  $("#rates").addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) {draft.rates.splice(Number(button.dataset.remove),1); renderRates(); markDirty();} const pool=event.target.closest("[data-pool]"); if(pool)openPool(Number(pool.dataset.pool)); });
  $("#add-rate").onclick = () => {
    const existing = new Set(draft.rates.map(x => x.rarity + "|" + x.variant));
    const candidate = [...dataset.cards].sort((a,b) => Number(b.variant === "Holofoil") - Number(a.variant === "Holofoil")).find(x => !existing.has(x.rarity + "|" + x.variant) && x.rarity && x.variant !== "Unknown");
    if (!candidate) return;
    draft.rates.push({rarity:candidate.rarity,variant:candidate.variant,one_in:"",slot:"main"}); renderRates(); markDirty();
  };
  $("#cards").addEventListener("change", event => {
    if (!event.target.dataset.card) return;
    const id = Number(event.target.dataset.card);
    draft.excluded_ids = draft.excluded_ids.filter(x => x !== id);
    if (!event.target.checked) draft.excluded_ids.push(id);
    renderCards(); markDirty();
  });
  $("#close-editor").onclick = () => { if (!dirty || window.confirm("Discard your unsaved edits?")) {$("#editor").hidden = true; selected = null; dirty = false;} };
  $("#untrack").onclick = async () => {
    if (!window.confirm("Remove this set from the watchlist? Saved price history is retained.")) return;
    try {await api("/api/settings",{sets:state.settings.sets.filter(x => x.group_id !== selected)}); selected=null; dirty=false; $("#editor").hidden=true; await reload();} catch(e) {error(e.message);}
  };
  $("#config-form").onsubmit = async event => {
    event.preventDefault();
    const saveButton = event.target.querySelector("button.save");
    saveButton.disabled = true;
    $("#save-status").textContent = "Saving…";
    const form = new FormData(event.target);
    for (const key of ["pack_cost","selling_fee_percent","cost_per_pack","bulk_ev","min_sale_price"]) draft[key] = form.get(key) === "" ? null : Number(form.get(key));
    draft.notes = form.get("notes"); draft.reviewed = form.has("reviewed");
    draft.not_applicable_rarities = form.getAll("not_applicable");
    draft.unspecified_rarities = unknownRarities.filter(rarity => !draft.not_applicable_rarities.includes(rarity));
    draft.review_signature = draft.reviewed ? (dataset?.pool_signature || "") : "";
    try {
      await api("/api/settings", {sets:state.settings.sets.map(x => x.group_id === selected ? draft : x),revision:draftRevision});
      error(); dirty=false; await reload(); await openEditor(selected,false); $("#save-status").textContent="Saved.";
    } catch(e) {if(e.name!=="AbortError")error(e.message); if($("#save-status"))$("#save-status").textContent=e.message;}
    finally {saveButton.disabled = false;}
  };
  if (scroll) $("#editor").scrollIntoView({behavior:"smooth",block:"start"});
}
function markDirty(){dirty=true; if ($("#save-status")) $("#save-status").textContent="Unsaved changes";}
$("#rankings").addEventListener("click", event => {
  const chase=event.target.closest('[data-chases]');
  if(chase){openTopCards(Number(chase.dataset.chases),true);return;}
  const edit=event.target.closest('[data-edit]');
  if(edit){openEditor(Number(edit.dataset.edit)).catch(e=>error(e.message));return;}
  const row=event.target.closest('tr[data-set]');
  if(row && !event.target.closest('a,input,select'))openTopCards(Number(row.dataset.set));
});
$("#sort").onchange = renderBoard;
$("#product-basis").onchange = renderBoard;
$("#value-unit").onchange = renderBoard;
$("#rankings").addEventListener("change", event=>{
  const select=event.target.closest("[data-product-kind]");
  if(!select)return;
  productSelections.set(`${select.dataset.productSet}:${select.dataset.productKind}`,Number(select.value));
  renderBoard();
});
$("#filter-sets").oninput = renderBoard;
$("#chase-sets-only").onchange = renderBoard;
$("#set-search").oninput = catalog;
$("#refresh").onclick = async () => {try {error(); await reload();} catch(e){error(e.message);}};
$("#add-set").onsubmit = async event => {
  event.preventDefault(); const id=Number($("#catalog").value); if (!id) return;
  try {await api("/api/settings",{sets:[...state.settings.sets,{group_id:id,pack_cost:null,bulk_ev:0,min_sale_price:5,selling_fee_percent:0,cost_per_pack:0,rates:[],excluded_ids:[],reviewed:false,notes:""}]}); await reload();} catch(e){error(e.message);}
};
window.addEventListener("beforeunload", event => {if(dirty){event.preventDefault();event.returnValue="";}});

function setSession(session) {
  const token=session?.access_token || '', user=session?.user?.id || '';
  if(token===sessionToken)return;
  const changedUser=user!==sessionUser;
  sessionToken=token;sessionUser=user;authVersion++;
  controllers.forEach(c=>c.abort());controllers.clear();
  if(changedUser || !token)clearPrivate();
  $("#account-link").textContent=token?'My account':'Sign in';
  $("#access-message").textContent=token?'Checking workbook access…':'Sign in with the owner account to open this workbook.';
  error();
  if(token)reload().catch(e=>{if(e.name!=='AbortError')error(e.message);});
}
async function boot() {
  ['account-link','access-login'].forEach(id=>{$('#'+id).href=`profile${HTML}`;});
  if(IS_LOCALHOST) {
    try {
      const response=await fetch(`${API_BASE}/api/pokemon/access`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(response.ok && (await response.json()).mode==='local-owner') {
        localOwner=true;
        $(".local").textContent='Local';
        $("#account-link").textContent='My account';
        await reload();
        return;
      }
    }catch(e){
      clearPrivate();
      $("#access-message").textContent='The local workbook could not load.';
      error(`Check that the API is running at ${API_BASE}, then reload this page. ${e.message}`);
      return;
    }
  }
  try {
    if(!SB)throw new Error('Sign-in service unavailable. Reload the page to try again.');
    SB.auth.onAuthStateChange((_event,session)=>queueMicrotask(()=>setSession(session)));
    const {data,error:authError}=await SB.auth.getSession();if(authError)throw authError;
    if(!data.session)$("#access-message").textContent='Sign in with the owner account to open this workbook.';
    setSession(data.session);
  }catch(e){clearPrivate();error('Sign-in service unavailable. Reload the page to try again.');}
}
setInterval(async()=>{
  if(!allowed || (!sessionToken && !localOwner) || polling || document.hidden)return;
  polling=true;
  try {await reload();}catch(e){if(e.name!=='AbortError')error(e.message);}finally{polling=false;}
},60000);
boot();
})();
