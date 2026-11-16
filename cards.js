(() => {
'use strict';
PAGE='cards';
const $=s=>document.querySelector(s),esc=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number.isFinite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v):'—';
const date=v=>v?new Date(/^\d{4}-\d{2}-\d{2}$/.test(v)?v+'T12:00:00':v).toLocaleDateString('en-US'):'No date';
const uid=()=>crypto.randomUUID(),number=v=>v===''?null:Number(v),day=v=>v?v.slice(0,10):'';
const quoteTime=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString():'No timestamp';
const retailerQuote=p=>p?.price_basis==='retailer_asking';
const staleQuote=p=>{
  const at=Date.parse(p.price_as_of),now=Date.now();
  return Boolean(p.stale) || !Number.isFinite(at) || at>now+5*60*1000 || now-at>24*60*60*1000;
};
const purchasePrice=p=>!retailerQuote(p) || (p.availability==='in_stock' && !staleQuote(p))?p?.market ?? null:null;
const sportsName=v=>({mma:'MMA / UFC',f1:'Formula 1','multi-sport':'Multi-sport'}[v] || String(v).replace(/\b\w/g,c=>c.toUpperCase()));
const imageUrl=value=>{try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && u.href.length<=1000?u.href:'';}catch{return '';}};
const mergeCard=(source={},saved={})=>({...source,...saved,image_url:imageUrl(saved.image_url) || imageUrl(source.image_url)});
const sealedProducts=row=>row.reference_only?'<span title="Published checklist and odds only; no matching sealed-product price feed.">Reference only</span>':
  Number.isInteger(row.product_count) && row.product_count>=0?`<span title="${row.product_count===0?'No sealed products supplied by the price source.':'Sealed products supplied by the price source.'}">${row.product_count}</span>`:
  '<span title="The price source did not report a sealed-product count.">Unknown</span>';
const artwork=(card,small=false)=>{const url=imageUrl(card.image_url);return `<span class="card-art ${small?'small-art':''}">${url?`<img class="card-image" src="${esc(url)}" alt="${esc(card.name)}" loading="lazy" referrerpolicy="no-referrer">`:''}<span class="no-art" ${url?'hidden':''}>No image</span></span>`;};
function productRow(product) {
  const retail=retailerQuote(product),url=imageUrl(product.source_url);
  const availability={in_stock:'In stock',out_of_stock:'Out of stock',unknown:'Availability unknown'}[product.availability] || 'Availability unknown';
  const status=retail?`${availability}${staleQuote(product)?' · Stale quote':''}`:'Not reported';
  const source=product.source_name || 'Price source';
  return `<tr data-product="${esc(product.id)}"><td>${esc(product.name)}${product.notes?`<div class="help">${esc(product.notes)}</div>`:''}</td><td>${product.packs_per_box ?? '—'}</td><td>${money(product.market)}<div class="help">${retail?'Retailer asking price':'Source price'}</div></td><td>${esc(status)}</td><td>${url?`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(source)} ↗</a>`:esc(source)}</td><td>${retail?`<time datetime="${esc(product.price_as_of || '')}">${esc(quoteTime(product.price_as_of))}</time>`:esc(date(product.price_as_of))}</td><td><button data-format="${esc(product.id)}">Model this format</button></td></tr>`;
}
let state=null,token='',user='',version=0,draft=null,dirty=false,draftRevision='',dialogVersion=0,saving=false,editVersion=0;
const requests=new Set(),sets=new Map();
const featured=new Map(),featuredQueued=new Map();
let featuredObserver=null,featuredQueue=[],featuredActive=0,featuredEpoch=0,featuredExpiryTimer=null;
const featuredTtl=60*60*1000;
function featuredMarkup(row,detail=false) {
  if(!row.featured_available)return '<span class="help">No recent-sales preview</span>';
  const entry=featured.get(row.id);
  if(!entry || entry.state==='loading')return '<span class="help" role="status">Loading recent prices…</span>';
  if(entry.state==='expired')return `<span class="help" role="status">Preview expired.</span> <button type="button" data-featured-retry="${esc(row.id)}">Refresh preview</button>`;
  if(entry.error)return `<span class="help" role="status">${esc(entry.error)}</span> <button type="button" data-featured-retry="${esc(row.id)}">Retry</button>`;
  const data=entry.data,cards=(Array.isArray(data.cards)?data.cards:[]).filter(card=>Number.isFinite(card.raw_price) && card.raw_price>=0).slice(0,5);
  if(!cards.length)return `<span class="help" role="status">${esc(data.reason || 'No eligible recent sales found.')}</span>${['unavailable','rate_limited','busy','unverified_filters'].includes(data.status)?` <button type="button" data-featured-retry="${esc(row.id)}">Retry</button>`:''}`;
  const count=Number.isInteger(data.matched_sales)?`${data.matched_sales} matched sales`:'';
  const priced=Number.isInteger(data.priced_cards)?`${data.priced_cards} priced cards`:'';
  return `<div class="featured-cards">${cards.map(card=>{
    const identity=[card.name,card.number?`#${card.number}`:'',card.subset,card.parallel].filter(Boolean).join(' · ');
    const details=[identity,`${card.sale_count || 0} ${card.sale_count===1?'sale':'sales'}`,date(card.price_as_of),'Median from recent matched auctions'].join(' · ');
    if(detail) {
      const source=imageUrl(card.source_url);
      return `<article class="featured-card" title="${esc(details)}">${artwork(card)}<h4>${esc(card.name)}</h4><p class="featured-identity">${esc([card.number?`#${card.number}`:'',card.subset,card.parallel].filter(Boolean).join(' · '))}</p><p class="featured-price"><strong>${money(card.raw_price)}</strong> <span>Median raw sale</span></p><p class="help">${esc(card.sale_count || 0)} ${card.sale_count===1?'sale':'sales'} · Latest ${esc(date(card.price_as_of))}</p>${source?`<a href="${esc(source)}" target="_blank" rel="noreferrer">Sale source ↗</a>`:''}</article>`;
    }
    return `<button type="button" class="featured-card" data-open="${esc(row.id)}" title="${esc(details)}" aria-label="${esc(identity)}: ${money(card.raw_price)}. Open ${esc(row.name)}">${artwork(card,true)}<span class="featured-card-name">${esc(card.name)}</span><strong>${money(card.raw_price)}</strong></button>`;
  }).join('')}</div><div class="help featured-coverage" title="${esc([data.notice,count,priced].filter(Boolean).join(' · '))}">From recent matched sales · Partial coverage${priced?` · ${priced}`:''}${detail && count?` · ${count}`:''}</div>`;
}
function featuredCells(id) {return [...document.querySelectorAll('[data-featured-id]')].filter(cell=>cell.dataset.featuredId===id);}
function paintFeatured(id) {
  const row=state?.catalog.find(item=>item.id===id);
  if(!row)return;
  featuredCells(id).forEach(cell=>{
    cell.innerHTML=featuredMarkup(row,cell.dataset.featuredView==='detail');
    cell.querySelectorAll('img').forEach(img=>{
      const failed=()=>{img.hidden=true;img.nextElementSibling.hidden=false;};
      img.addEventListener('error',failed,{once:true});if(img.complete && !img.naturalWidth)failed();
    });
  });
}
function resetFeatured() {
  featuredEpoch++;featured.clear();featuredQueue=[];featuredQueued.clear();featuredObserver?.disconnect();clearTimeout(featuredExpiryTimer);
}
function scheduleFeaturedExpiry() {
  clearTimeout(featuredExpiryTimer);
  const now=Date.now();let next=Infinity;
  featured.forEach((entry,id)=>{
    if(!entry.at)return;
    const remaining=entry.at+featuredTtl-now;
    if(remaining<=0){featured.set(id,{state:'expired'});paintFeatured(id);}
    else next=Math.min(next,remaining);
  });
  if(Number.isFinite(next))featuredExpiryTimer=setTimeout(scheduleFeaturedExpiry,next);
}
function pumpFeatured() {
  while(featuredActive<2 && featuredQueue.length) {
    const job=featuredQueue.shift();
    if(job.epoch!==featuredEpoch || job.session!==version || !featuredCells(job.id).length) {
      if(featuredQueued.get(job.id)===job.epoch)featuredQueued.delete(job.id);
      continue;
    }
    featuredActive++;featured.set(job.id,{state:'loading'});paintFeatured(job.id);
    api(`/set/${encodeURIComponent(job.id)}/featured`).then(data=>{
      if(job.epoch===featuredEpoch && job.session===version)featured.set(job.id,{state:'ready',at:Date.now(),data});
    }).catch(error=>{
      if(job.epoch===featuredEpoch && job.session===version)featured.set(job.id,{state:'ready',at:Date.now(),error:error.name==='AbortError'?'Recent-price preview timed out.':error.message});
    }).finally(()=>{
      featuredActive--;if(featuredQueued.get(job.id)===job.epoch)featuredQueued.delete(job.id);
      if(job.epoch===featuredEpoch && job.session===version){paintFeatured(job.id);scheduleFeaturedExpiry();}
      pumpFeatured();
    });
  }
}
function queueFeatured(id) {
  const entry=featured.get(id);
  if(entry?.state==='loading' || (entry?.at && Date.now()-entry.at<featuredTtl) || featuredQueued.has(id))return;
  if(!state?.catalog.some(row=>row.id===id && row.featured_available))return;
  featuredQueued.set(id,featuredEpoch);featuredQueue.push({id,epoch:featuredEpoch,session:version});pumpFeatured();
}
function watchFeatured() {
  featuredObserver?.disconnect();
  const cells=[...document.querySelectorAll('#rows [data-featured-id]')];
  cells.forEach(cell=>paintFeatured(cell.dataset.featuredId));
  if(typeof IntersectionObserver==='undefined'){cells.slice(0,2).forEach(cell=>queueFeatured(cell.dataset.featuredId));return;}
  featuredObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){featuredObserver.unobserve(entry.target);queueFeatured(entry.target.dataset.featuredId);}}));
  cells.forEach(cell=>featuredObserver.observe(cell));
}
const error=(message='')=>{$('#error').textContent=message;$('#error').hidden=!message;};
async function api(path,body,blob=false) {
  const current=version,controller=new AbortController();requests.add(controller);
  const timer=setTimeout(()=>controller.abort(),60000);
  try {
    const response=await fetch(`${API_BASE}/api/cards${path}`,{method:body===undefined?'GET':'POST',cache:'no-store',signal:controller.signal,
      headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(current!==version)throw new DOMException('Session changed','AbortError');
    const data=blob && response.ok?await response.blob():await response.json();
    if(current!==version)throw new DOMException('Session changed','AbortError');
    if(!response.ok)throw new Error(data.error || 'Unable to load cards.');
    return data;
  }finally{clearTimeout(timer);requests.delete(controller);}
}
const fail=e=>{if(e.name!=='AbortError')error(e.message);};
function selectSports() {
  const rows=$('#view').value==='models'?state.settings.entries:state.catalog;
  const selected=$('#sport').value,values=[...new Set(rows.map(x=>x.sport).filter(Boolean))].sort();
  $('#sport').innerHTML='<option value="">All sports</option>'+values.map(s=>`<option value="${esc(s)}">${esc(sportsName(s))}</option>`).join('');
  $('#sport').value=values.includes(selected)?selected:'';
}
async function load() {
  const result=await api('/state');state=result;render();
  const focused=result.catalog_scope?.id==='main-topps';
  const scope=focused?`${result.catalog_scope.label || 'Main Topps sets'}: recent flagship and Chrome sets for baseball, basketball and football, plus Bowman baseball. Older saved sets remain available in My models.`:'';
  $('#view option[value="catalog"]').textContent=focused?(result.catalog_scope.label || 'Main Topps sets'):'Set catalog';
  const pricedSets=result.catalog.filter(row=>!row.reference_only);
  const withProducts=pricedSets.filter(row=>Number.isInteger(row.product_count) && row.product_count>0).length;
  const unknown=pricedSets.filter(row=>!Number.isInteger(row.product_count) || row.product_count<0).length;
  const coverage=pricedSets.length?`${result.source.name || 'The price source'} lists sealed products for ${withProducts} of ${pricedSets.length} ${focused?'shown ':''}source sets.${unknown?` Product counts are not reported for ${unknown} ${unknown===1?'set':'sets'}.`:''} These counts do not include individual cards or published pull-rate formats.`:'';
  $('#source-status').textContent=[scope,result.source.warning,coverage,result.source.notice].filter(Boolean).join(' ');
}
function render() {
  if(!state)return;
  selectSports();
  featuredObserver?.disconnect();
  const query=$('#search').value.trim().toLowerCase(),sport=$('#sport').value,unit=$('#unit').value,sort=$('#sort').value;
  const matches=row=>(!sport || row.sport===sport) && `${row.name || row.set_name} ${row.format_name || ''} ${row.year || ''}`.toLowerCase().includes(query);
  const models=$('#view').value==='models';
  $('#unit').disabled=!models;
  $('#sort').querySelectorAll('option').forEach(o=>{o.disabled=!models && !['year','name'].includes(o.value);});
  if(!models && !['year','name'].includes(sort))$('#sort').value='year';
  if(models) {
    const rows=state.entries.filter(matches).sort((a,b)=>{
      if(sort==='year')return Number(b.set_name.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0)-Number(a.set_name.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0) || a.set_name.localeCompare(b.set_name);
      if(sort==='name')return a.set_name.localeCompare(b.set_name) || a.format_name.localeCompare(b.format_name);
      const left=a[unit][sort],right=b[unit][sort];
      return (left==null?right==null?0:1:right==null?-1:right-left) || a.set_name.localeCompare(b.set_name);
    });
    $('#head').innerHTML=`<tr><th>Set / format</th><th>Sport</th><th>Packs / box</th><th>Buy $ / ${unit}</th><th>EV / ${unit}</th><th>Break-even</th><th>Return %</th><th>Net</th><th>ROI</th><th>Status</th><th></th></tr>`;
    $('#rows').innerHTML=rows.map(row=>{
      const metric=row[unit],prefix=row.eligible?'':'~ ';
      return `<tr data-model="${esc(row.id)}"><td><strong>${esc(row.set_name)}</strong><div class="help">${esc(row.format_name)}</div></td><td>${esc(sportsName(row.sport))}</td><td>${row.pack_count ?? '—'}</td><td>${money(metric.cost)}</td><td>${metric.gross_ev==null?'—':prefix+money(metric.gross_ev)}</td><td>${money(metric.break_even_buy)}</td><td>${metric.return_percent==null?'—':prefix+metric.return_percent.toFixed(1)+'%'}</td><td>${money(metric.net_profit)}</td><td>${metric.roi==null?'—':metric.roi.toFixed(1)+'%'}</td><td class="model-summary" title="${esc(row.issues.join(' '))}">${row.eligible?'Reviewed':esc(row.issues[0] || 'Check inputs')}</td><td><span class="row-actions"><button data-edit="${esc(row.id)}">Edit</button><button data-open="${esc(row.set_id)}">Cards</button></span></td></tr>`;
    }).join('') || `<tr><td colspan="11" class="empty">No saved models. Open a set from the catalog and choose a pack format.${token?'':' Sign in to save your work.'}</td></tr>`;
    $('#count').textContent=`${rows.length} models`;
  }else {
    const rows=state.catalog.filter(matches).sort((a,b)=>$('#sort').value==='name'?a.name.localeCompare(b.name):(b.year || 0)-(a.year || 0) || a.name.localeCompare(b.name));
    $('#head').innerHTML='<tr><th>Set</th><th>Sport</th><th>Year</th><th title="Sealed products supplied by the price source, such as hobby boxes and blasters. Not individual cards or published pull-rate formats.">Sealed products</th><th title="Highest raw auction medians among recent matched sales; not a complete set ranking or sales-volume ranking.">Highest recent prices</th><th>My formats</th><th></th></tr>';
    $('#rows').innerHTML=rows.map(row=>`<tr><td><button class="set-link" data-open="${esc(row.id)}">${esc(row.name)}</button>${row.reference_only?'<div class="help">Published odds + base checklist</div>':''}</td><td>${esc(sportsName(row.sport))}</td><td>${row.year || '—'}</td><td>${sealedProducts(row)}</td><td class="featured-preview" ${row.featured_available?`data-featured-id="${esc(row.id)}"`:''}>${featuredMarkup(row)}</td><td>${state.settings.entries.filter(e=>e.set_id===row.id).length || '—'}</td><td><button data-open="${esc(row.id)}">Open</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No matching sets. Try another search or refresh the catalog.</td></tr>';
    $('#count').textContent=`${rows.length} sets`;
    watchFeatured();
  }
}
async function save(settings,revision=state.revision) {
  if(!token)throw new Error('Sign in to save your models and favorites.');
  const result=await api('/settings',{...settings,revision});
  state={...state,...result,catalog:state.catalog,source:state.source};render();return result;
}
function favoriteButton(card) {
  const on=state.settings.favorites.includes(card.id);
  return `<button type="button" class="favorite-toggle" data-star="${esc(card.id)}" aria-label="${on?'Remove':'Add'} ${esc(card.name)} ${on?'from':'to'} favorites" aria-pressed="${on}" ${!token || saving?'disabled':''} title="${token?'Save to your favorites':'Sign in to save favorites'}">${on?'★':'☆'}</button>`;
}
async function openSet(id) {
  $('#cards-dialog')?.remove();const current=++dialogVersion,session=version;
  const dialog=document.createElement('dialog');dialog.id='cards-dialog';dialog.className='cards-dialog';
  dialog.innerHTML='<div class="sectionhead"><h2 id="cards-title">Loading set…</h2><button class="close-dialog" aria-label="Close cards">×</button></div><div id="set-content"><p role="status">Loading products and raw cards…</p></div>';
  dialog.setAttribute('aria-labelledby','cards-title');document.body.append(dialog);dialog.querySelector('.close-dialog').onclick=()=>dialog.close();
  dialog.onclose=()=>{dialog.remove();dialogVersion++;};dialog.showModal();
  try {
    let data;
    try{data=sets.get(id) || await api(`/set/${encodeURIComponent(id)}`);sets.set(id,data);}catch(e){
      if(e.name==='AbortError')throw e;
      const saved=state.settings.entries.find(x=>x.set_id===id);
      if(!saved)throw e;
      data={set:{id,name:saved.set_name,sport:saved.sport},products:[],cards:[],warning:e.message};
    }
    if(current!==dialogVersion || session!==version)return;
    $('#cards-title').textContent=data.set.name;
    const own=state.settings.entries.filter(e=>e.set_id===id).flatMap(e=>e.pools.flatMap(p=>p.cards));
    const merged=new Map(data.cards.map(c=>[c.id,{...c}]));
    for(const card of own)merged.set(card.id,mergeCard(merged.get(card.id),card));
    const cards=[...merged.values()];
    const quoteCards=new Set((data.references?.cards || []).map(card=>card.id));
    const liveQuotes=new Map();let quoteBusy=false;
    const canQuote=card=>data.live_pricing?.enabled===true && quoteCards.has(card.id);
    const livePrice=card=>{
      if(!canQuote(card))return '';
      const quote=liveQuotes.get(card.id),url=imageUrl(quote?.source_url);
      let detail='';
      if(quote?.loading)detail='Checking recent sales…';
      else if(quote?.error)detail=esc(quote.error);
      else if(quote && Number.isFinite(quote.raw_price) && quote.raw_price>=0 && quote.sale_count>0)
        detail=`Recent raw auction median: <strong>${money(quote.raw_price)}</strong> · ${esc(quote.sale_count)} ${quote.sale_count===1?'sale':'sales'} · ${esc(date(quote.price_as_of))}${url?` · <a href="${esc(url)}" target="_blank" rel="noreferrer">Sale source ↗</a>`:''}`;
      else if(quote)detail=esc(quote.reason || 'No eligible recent raw auction sales.');
      return `<div class="live-price"><button type="button" data-live-quote="${esc(card.id)}" aria-label="Check live price for ${esc(card.name)}" ${quoteBusy?'disabled':''}>Check live price</button><div class="help live-quote-result" role="status">${detail}</div></div>`;
    };
    $('#set-content').innerHTML=`<p class="notice">${esc(data.warning || 'Source cards are a partial catalog, not a complete pack checklist. Verify product contents and raw prices before using them in a model.')}</p><div class="tablewrap"><table id="sealed-prices"><thead><tr><th>Pack format</th><th>Packs / box</th><th>Quoted box $</th><th>Availability</th><th>Source</th><th>Price checked / dated</th><th></th></tr></thead><tbody>${data.products.map(productRow).join('') || '<tr><td colspan="7" class="empty">No sealed products available from the source.</td></tr>'}</tbody></table></div><div class="actions"><button id="custom-format">Add a pack format</button><a href="https://www.topps.com/pages/odds" target="_blank" rel="noreferrer">Official pack odds ↗</a></div><h3>Raw cards · ${cards.length}</h3><div class="toolbar"><input id="card-search" type="search" placeholder="Search cards" aria-label="Search cards"><label>Sort <select id="card-sort"><option value="price">Price</option><option value="name">Name</option><option value="number">Number</option></select></label><label>View <select id="card-view"><option value="table">Table</option><option value="gallery">Gallery</option></select></label><label><input id="favorites-only" type="checkbox">Favorites only</label></div><p id="favorite-message" class="help" role="status"></p><div id="raw-cards"></div>`;
    const coverage=data.coverage || {},sourceCards=data.cards;
    const baseChecklist=quoteCards.size>0 && sourceCards.length>0 && sourceCards.every(card=>quoteCards.has(card.id));
    if(baseChecklist && cards.every(card=>quoteCards.has(card.id)))$('#set-content h3').textContent=`Base checklist · ${cards.length}`;
    const count=(key,fallback)=>Number.isInteger(coverage[key]) && coverage[key]>=0?coverage[key]:fallback;
    const coverageLine=document.createElement('p');coverageLine.id='source-coverage';coverageLine.className='help';
    coverageLine.textContent=`${baseChecklist?'Base checklist coverage':'Source coverage'}: ${count('priced_cards',sourceCards.filter(c=>Number.isFinite(c.raw_price)).length)} / ${sourceCards.length} raw cards priced · ${count('card_images',sourceCards.filter(c=>imageUrl(c.image_url)).length)} with images · ${count('priced_products',data.products.filter(p=>Number.isFinite(p.market)).length)} / ${data.products.length} boxes priced. ${baseChecklist && data.live_pricing?.enabled?'Base-card quotes are available individually with Check live price.':sourceCards.length?'Missing prices remain unavailable.':'The price source returned no matching raw cards.'}`;
    $('#set-content .notice').after(coverageLine);
    if(data.products.some(retailerQuote)) {
      const retailNote=document.createElement('p');retailNote.className='help';retailNote.id='retail-price-note';
      retailNote.textContent='Retailer asking prices exclude shipping and tax. Confirm availability before buying. Out-of-stock, unknown-availability and stale quotes leave the model purchase price blank.';
      coverageLine.after(retailNote);
    }
    if(state.catalog.some(row=>row.id===id && row.featured_available)) {
      const section=document.createElement('section');section.id='set-featured';section.className='set-featured';
      section.setAttribute('aria-labelledby','set-featured-title');
      section.innerHTML=`<h3 id="set-featured-title">Highest recent prices · Top 5</h3><p class="help">Highest median prices found in recent raw-card auctions, including inserts, autographs and parallels. Coverage is partial; base checklist prices are shown separately below.</p><div data-featured-id="${esc(id)}" data-featured-view="detail"></div>`;
      $('#sealed-prices').closest('.tablewrap').before(section);
      section.onclick=event=>{
        const retry=event.target.closest('[data-featured-retry]');
        if(retry){featured.delete(id);queueFeatured(id);}
      };
      paintFeatured(id);queueFeatured(id);
    }
    renderReferences(data.references,$('#custom-format').parentElement);
    const models=state.settings.entries.filter(e=>e.set_id===id);
    const modelLabel=document.createElement('label');
    modelLabel.innerHTML=`Odds model <select id="card-odds-model">${models.map(e=>`<option value="${esc(e.id)}">${esc(e.format_name)}</option>`).join('')}<option value="">No model</option></select>`;
    $('#card-sort').parentElement.after(modelLabel);
    const draw=()=>{
      const query=$('#card-search').value.toLowerCase(),sort=$('#card-sort').value;
      const model=models.find(e=>e.id===$('#card-odds-model').value),details=new Map(model?.pools.flatMap(p=>p.cards.map(c=>[c.id,c])) || []);
      const visible=cards.map(c=>mergeCard(c,details.get(c.id))).filter(c=>(!$('#favorites-only').checked || state.settings.favorites.includes(c.id)) && `${c.name} ${c.number} ${c.parallel}`.toLowerCase().includes(query)).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='number'?String(a.number).localeCompare(String(b.number),undefined,{numeric:true}):(b.raw_price ?? -1)-(a.raw_price ?? -1));
      const average=card=>{
        const pools=model?.pools.filter(p=>p.cards.some(c=>c.id===card.id)) || [];
        if(pools.length!==1 || pools[0].expected_per_pack==null || pools[0].pool_size!==pools[0].cards.length || !pools[0].pool_size)return '—';
        return Number((100*pools[0].expected_per_pack/pools[0].pool_size).toPrecision(4))+' avg / 100 packs';
      };
      const source=c=>c.source_url?`<a href="${esc(c.source_url)}" target="_blank" rel="noreferrer">Source ↗</a>`:'';
      if($('#card-view').value==='gallery')$('#raw-cards').innerHTML=`<div class="raw-gallery">${visible.map(c=>`<article>${favoriteButton(c)}${artwork(c)}<p><strong>${esc(c.name)}</strong></p><p>${esc(c.number)} · ${esc(c.parallel || 'Parallel unspecified')}</p><p>${money(c.raw_price)} · ${date(c.price_as_of)}</p>${source(c)}${livePrice(c)}</article>`).join('')}</div>`;
      else $('#raw-cards').innerHTML=`<div class="tablewrap"><table><thead><tr><th>★</th><th>Image</th><th>Card</th><th>No.</th><th>Parallel</th><th>Raw $</th><th>Price date</th><th></th></tr></thead><tbody>${visible.map(c=>`<tr><td>${favoriteButton(c)}</td><td>${artwork(c,true)}</td><td class="source-card-name">${esc(c.name)}</td><td>${esc(c.number)}</td><td>${esc(c.parallel || 'Unspecified')}</td><td>${money(c.raw_price)}${livePrice(c)}</td><td>${date(c.price_as_of)}</td><td>${source(c)}</td></tr>`).join('')}</tbody></table></div>`;
      $('#raw-cards').querySelectorAll('img').forEach(img=>{const failed=()=>{img.hidden=true;img.nextElementSibling.hidden=false;};img.addEventListener('error',failed,{once:true});if(img.complete && !img.naturalWidth)failed();});
      if(!visible.length)$('#raw-cards').innerHTML='<p class="empty">No raw cards available for this selection. You can enter verified cards in a format model.</p>';
      else if($('#card-view').value==='gallery')$('#raw-cards').querySelectorAll('article').forEach((article,i)=>{
        const p=document.createElement('p');p.className='help';p.textContent=average(visible[i]);p.title='Estimated average copies, assuming equal frequency within this format’s pool. Not the probability of at least one hit.';article.append(p);
      });
      else {
        $('#raw-cards thead tr').insertAdjacentHTML('beforeend','<th title="Estimated average copies, assuming equal frequency within this format’s pool. Not the probability of at least one hit.">Est. pulls</th>');
        $('#raw-cards').querySelectorAll('tbody tr').forEach((row,i)=>{const td=document.createElement('td');td.textContent=average(visible[i]);row.append(td);});
      }
    };
    for(const selector of ['#card-search','#card-sort','#card-view','#card-odds-model','#favorites-only'])$(selector).addEventListener(selector==='#card-search'?'input':'change',draw);
    $('#raw-cards').onclick=async event=>{
      const live=event.target.closest('[data-live-quote]');
      if(live) {
        const card=cards.find(item=>item.id===live.dataset.liveQuote);
        if(!card || !canQuote(card) || quoteBusy)return;
        quoteBusy=true;liveQuotes.set(card.id,{loading:true});draw();
        try {
          const result=await api(`/set/${encodeURIComponent(id)}/quotes`,{card_ids:[card.id]});
          if(current!==dialogVersion || session!==version)return;
          const quote=result.quotes?.find(item=>item.id===card.id);
          if(!quote)throw new Error('No price result was returned. Try again.');
          liveQuotes.set(card.id,quote);
        }catch(e){
          if(current===dialogVersion && session===version)liveQuotes.set(card.id,{error:e.name==='AbortError'?'Price check timed out. Try again.':e.message});
        }finally{
          quoteBusy=false;if(current===dialogVersion && session===version)draw();
        }
        return;
      }
      const star=event.target.closest('[data-star]');if(!star || saving || !token)return;
      saving=true;draw();const before=state.revision;
      try {
        const latest=await api('/state'),favorites=new Set(latest.settings.favorites);
        if(favorites.has(star.dataset.star))favorites.delete(star.dataset.star);else favorites.add(star.dataset.star);
        await save({...latest.settings,favorites:[...favorites]},latest.revision);
        if(draft && draftRevision===before && latest.revision===before)draftRevision=state.revision;
        if(current===dialogVersion)$('#favorite-message').textContent='Favorite saved.';
      }catch(e){if(current===dialogVersion)$('#favorite-message').textContent=e.message;}
      finally{saving=false;if(current===dialogVersion && session===version)draw();}
    };
    dialog.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>{
      const product=data.products.find(p=>p.id===button.dataset.format);if(startModel(data.set,product))dialog.close();
    });
    $('#custom-format').onclick=()=>{if(startModel(data.set))dialog.close();};draw();
  }catch(e){if(current===dialogVersion && e.name!=='AbortError')$('#set-content').textContent=e.message;}
}
function renderReferences(reference,after) {
  const section=document.createElement('section');section.id='published-odds';section.className='published-odds';after.after(section);
  if(!reference?.formats?.length){section.innerHTML='<p class="help">Published pull rates are not loaded for this set. Add verified format-specific rates to a model to calculate individual-card estimates.</p>';return;}
  const links=[['Odds PDF',reference.odds_url],['Checklist',reference.checklist_url]].filter(([,url])=>imageUrl(url));
  section.innerHTML=`<details><summary>Published Topps pull rates · ${reference.formats.length} formats</summary><p class="help">${esc(reference.title || '')}${reference.retrieved_at?` · Retrieved ${esc(date(reference.retrieved_at))}`:''}</p><div class="toolbar"><label>Exact pack format <select id="published-odds-format">${reference.formats.map(format=>`<option value="${esc(format.id)}">${esc(format.label)}${format.sku?` · SKU ${esc(format.sku)}`:''}</option>`).join('')}</select></label><input id="published-odds-search" type="search" placeholder="Find a parallel or insert" aria-label="Find a parallel or insert">${links.map(([label,url])=>`<a href="${esc(url)}" target="_blank" rel="noreferrer">${label} ↗</a>`).join('')}</div><p class="help">These are the published pool odds for this format. Individual-card estimates need a matched checklist. A dash means no published rate for that format.</p>${reference.source_note?`<p class="help">${esc(reference.source_note)}</p>`:''}${reference.coverage_note?`<p class="help">${esc(reference.coverage_note)}</p>`:''}<div class="tablewrap"><table><thead><tr><th>Card pool / parallel</th><th>Published odds</th></tr></thead><tbody id="published-odds-rows"></tbody></table></div><p class="help" id="published-odds-count"></p></details>`;
  const draw=()=>{
    const format=reference.formats.find(f=>f.id===$('#published-odds-format').value),query=$('#published-odds-search').value.trim().toLowerCase();
    const rows=(format?.rates || []).filter(row=>String(row.label).toLowerCase().includes(query));
    $('#published-odds-rows').innerHTML=rows.map(row=>{
      const unclear=['ambiguous','unparsed'].includes(row.status);
      const odds=unclear?`Unclear (${row.odds || 'unknown'})`:row.odds || '—';
      return `<tr><td>${esc(row.label)}</td><td${unclear?' title="This published value could not be interpreted reliably. Check the source PDF; it is not used as a pull-rate estimate."':''}>${esc(odds)}</td></tr>`;
    }).join('') || '<tr><td colspan="2">No matching published rates.</td></tr>';
    $('#published-odds-count').textContent=`${rows.length} / ${format?.rates.length || 0} published pools`;
  };
  $('#published-odds-format').onchange=draw;$('#published-odds-search').oninput=draw;draw();
}
function startModel(set,product) {
  if(saving){error('Wait for the current save to finish.');return false;}
  if(dirty && !confirm('Discard your unsaved model changes?'))return false;
  const existing=product && state.settings.entries.find(e=>e.set_id===set.id && e.format_id===product.id);
  draft=structuredClone(existing || {id:uid(),set_id:set.id,set_name:set.name,sport:set.sport,format_id:product?.id || uid(),format_name:product?.name || 'Custom format',
    pack_count:product?.packs_per_box ?? null,box_cost:purchasePrice(product),pack_cost:null,fee_percent:0,cost_per_pack:0,min_sale_price:0,odds_url:'',reviewed:false,complete:false,notes:product?.notes || '',pools:[]});
  draftRevision=state.revision;dirty=false;renderEditor();$('#editor').scrollIntoView({behavior:'smooth'});return true;
}
function field(label,name,value,type='number',attrs='') {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value ?? '')}" ${type==='number'?'min="0" step="any"':''} ${attrs}></label>`;
}
function renderEditor() {
  editVersion++;
  const editor=$('#editor');editor.hidden=false;
  editor.innerHTML=`<div class="sectionhead"><h2 id="editor-title">${esc(draft.set_name)} · ${esc(draft.format_name)}</h2><button id="close-editor">Close ×</button></div><p class="help">Model one exact format. Hobby and retail odds are different. Use raw prices, and keep each parallel in one pool. ~ means provisional.</p><form id="model-form"><div class="fields model-fields">${field('Format','format_name',draft.format_name,'text','required maxlength="160"')}${field('Packs / box','pack_count',draft.pack_count,'number','min="1" step="1"')}${field('Box purchase $','box_cost',draft.box_cost)}${field('Pack purchase $ (optional)','pack_cost',draft.pack_cost)}${field('Selling fee %','fee_percent',draft.fee_percent,'number','max="100"')}${field('Other costs / pack $','cost_per_pack',draft.cost_per_pack)}${field('Sell cards ≥ $','min_sale_price',draft.min_sale_price)}${field('Odds source URL','odds_url',draft.odds_url,'url','placeholder="https://…"')}</div><p class="help">Blank pack price uses box price ÷ packs. Box EV scales this format’s per-pack pools; include bonus packs only if they share the same odds, otherwise model them separately.</p><div id="pools"></div><div class="actions"><button id="add-pool" type="button">Add card pool</button><label>Import card pools (CSV) <input id="import-csv" type="file" accept=".csv,text/csv"></label></div><details class="import-help"><summary>CSV columns</summary><p class="help">pool, expected_per_pack, pool_size, card_id, name, number, parallel, raw_price, price_as_of, source_url, image_url (optional). Use one row per exact card printing. Prices are dollars; price dates use YYYY-MM-DD. An import replaces this draft’s pools.</p></details><label class="check"><input name="complete" type="checkbox" ${draft.complete?'checked':''}>All pack contents are accounted for</label><label class="check"><input name="reviewed" type="checkbox" ${draft.reviewed?'checked':''}>I reviewed the checklist, format-specific rates, and equal-frequency assumptions within each pool</label><label class="help">Notes<textarea name="notes" maxlength="4000">${esc(draft.notes)}</textarea></label><div id="model-result" class="model-result" aria-live="polite"></div><div class="actions model-actions"><button type="submit">Calculate</button><button id="save-model" type="button" ${!token?'disabled':''}>Save to my profile</button><button id="export-model" type="button" ${!token || !state.settings.entries.some(e=>e.id===draft.id)?'disabled':''}>Export saved CSV</button><button id="delete-model" type="button" ${!token || !state.settings.entries.some(e=>e.id===draft.id)?'disabled':''}>Remove saved model</button><span id="save-status" role="status">${token?'':'Sign in to save; calculations are available without signing in.'}</span></div></form>`;
  renderPools();
  $('#model-form').oninput=event=>{if(event.target.id==='import-csv')return;editVersion++;dirty=true;if(!['reviewed','notes'].includes(event.target.name))$('#model-form [name=reviewed]').checked=false;$('#save-status').textContent='Unsaved changes';$('#model-result').replaceChildren();};
  $('#close-editor').onclick=()=>{if(saving)return;if(!dirty || confirm('Discard your unsaved changes?')){editVersion++;draft=null;dirty=false;editor.hidden=true;}};
  $('#add-pool').onclick=()=>{readDraft();draft.pools.push({id:uid(),label:'New pool',expected_per_pack:null,pool_size:null,cards:[]});editVersion++;dirty=true;draft.reviewed=false;$('#model-form [name=reviewed]').checked=false;$('#model-result').replaceChildren();renderPools();};
  $('#import-csv').onchange=importPools;
  $('#model-form').onsubmit=async event=>{event.preventDefault();try{readDraft();const current=editVersion,result=await api('/preview',draft);if(draft && current===editVersion)showResult(result);}catch(e){fail(e);}};
  $('#save-model').onclick=async()=>{
    if(saving || !$('#model-form').reportValidity())return;saving=true;
    const controls=[...$('#model-form').querySelectorAll('input,select,textarea,button')].filter(c=>!c.disabled);
    try {
      readDraft();controls.forEach(c=>c.disabled=true);const next=state.settings.entries.filter(e=>e.id!==draft.id);next.push(draft);
      await save({...state.settings,entries:next},draftRevision);draftRevision=state.revision;dirty=false;
      showResult(state.entries.find(e=>e.id===draft.id));$('#save-status').textContent='Saved to your profile.';
      $('#export-model').disabled=false;$('#delete-model').disabled=false;
    }catch(e){fail(e);}finally{saving=false;controls.forEach(c=>c.disabled=false);if($('#save-model'))$('#save-model').disabled=!token;}
  };
  $('#export-model').onclick=async()=>{try{const blob=await api(`/export/${encodeURIComponent(draft.id)}`,undefined,true),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='topps-cards.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){fail(e);}};
  $('#delete-model').onclick=async()=>{if(saving || !confirm('Remove this saved format model?'))return;try{await save({...state.settings,entries:state.settings.entries.filter(e=>e.id!==draft.id)},draftRevision);draft=null;dirty=false;editor.hidden=true;}catch(e){fail(e);}};
}
function renderPools() {
  $('#pools').innerHTML=draft.pools.map((pool,index)=>`<section class="pool-editor" data-pool="${index}"><div class="pool-header"><label>Pool / parallel<input class="pool-label" data-p="label" value="${esc(pool.label)}" maxlength="160" required></label><label>Average cards / pack<input data-p="expected_per_pack" type="number" min="0" max="100" step="any" value="${pool.expected_per_pack ?? ''}"></label><label>Full checklist size<input data-p="pool_size" type="number" min="1" max="10000" step="1" value="${pool.pool_size ?? ''}"></label><button type="button" data-remove-pool="${index}">Remove pool</button></div><p class="help">For 1 in N packs enter 1 ÷ N. For one guaranteed card per 24-pack box enter 1 ÷ 24. Missing checklist cards keep EV unavailable.</p><div class="tablewrap"><table><thead><tr><th>Name</th><th>No.</th><th>Parallel</th><th>Raw $</th><th>Price date</th><th>Price source</th><th>Image URL (optional)</th><th></th></tr></thead><tbody>${pool.cards.map((card,i)=>`<tr data-card="${i}"><td><input class="card-name" data-c="name" value="${esc(card.name)}" required maxlength="160"></td><td><input class="card-number" data-c="number" value="${esc(card.number)}" maxlength="50"></td><td><input data-c="parallel" value="${esc(card.parallel)}" maxlength="160"></td><td><input data-c="raw_price" type="number" min="0" step="any" value="${card.raw_price ?? ''}"></td><td><input data-c="price_as_of" type="date" value="${day(card.price_as_of)}"></td><td><input class="card-source" data-c="source_url" type="url" placeholder="https://…" value="${esc(card.source_url)}"></td><td><input class="card-source" data-c="image_url" type="url" placeholder="https://…" value="${esc(card.image_url)}"></td><td><button type="button" data-remove-card="${i}" aria-label="Remove ${esc(card.name || 'card')}">×</button></td></tr>`).join('')}</tbody></table></div><div class="actions"><button type="button" data-add-card="${index}">Add card</button><button type="button" data-source-cards="${index}">Copy available source cards</button><span class="help">${pool.cards.length} entered / ${pool.pool_size ?? '?'} in full pool</span></div></section>`).join('') || '<p class="empty">Add pools for base cards, inserts, autographs, and each parallel you want to model.</p>';
  $('#pools').onclick=event=>{
    const button=event.target.closest('button');if(!button)return;readDraft();
    const poolIndex=Number(button.closest('[data-pool]').dataset.pool),pool=draft.pools[poolIndex];
    if(button.hasAttribute('data-add-card'))pool.cards.push({id:uid(),name:'',number:'',parallel:pool.label,raw_price:null,price_as_of:null,source_url:'',image_url:''});
    if(button.hasAttribute('data-remove-card'))pool.cards.splice(Number(button.dataset.removeCard),1);
    if(button.hasAttribute('data-remove-pool')){if(pool.cards.length && !confirm('Remove this pool and its cards?'))return;draft.pools.splice(poolIndex,1);}
    if(button.hasAttribute('data-source-cards')){
      const cards=sets.get(draft.set_id)?.cards || [];
      if(!cards.length){error('No raw source cards available. Open this set’s Cards view first, or enter verified cards manually.');return;}
      const existing=new Set(draft.pools.flatMap(p=>p.cards.map(c=>c.id)));
      pool.cards.push(...cards.filter(c=>!existing.has(c.id)).map(c=>({...c})));
      error('Source cards have unspecified parallels. Verify each printing and complete the pool checklist before calculating.');
    }
    editVersion++;dirty=true;draft.reviewed=false;$('#model-form [name=reviewed]').checked=false;$('#model-result').replaceChildren();renderPools();
  };
}
function readDraft() {
  const form=new FormData($('#model-form'));
  for(const key of ['pack_count','box_cost','pack_cost','fee_percent','cost_per_pack','min_sale_price'])draft[key]=number(form.get(key));
  for(const key of ['format_name','odds_url','notes'])draft[key]=form.get(key);
  draft.reviewed=form.has('reviewed');draft.complete=form.has('complete');
  document.querySelectorAll('#pools [data-pool]').forEach(section=>{
    const pool=draft.pools[Number(section.dataset.pool)];
    section.querySelectorAll('[data-p]').forEach(input=>pool[input.dataset.p]=input.dataset.p==='label'?input.value:number(input.value));
    section.querySelectorAll('[data-card]').forEach(row=>{
      const card=pool.cards[Number(row.dataset.card)];
      row.querySelectorAll('[data-c]').forEach(input=>card[input.dataset.c]=input.dataset.c==='raw_price'?number(input.value):input.dataset.c==='price_as_of'?input.value || null:input.value);
    });
  });
}
function showResult(result) {
  const unit=$('#unit').value,metric=result[unit],prefix=result.eligible?'':'~ ';
  $('#model-result').innerHTML=`<h3>${unit==='box'?'Box':'Pack'} estimate ${result.eligible?'':'· provisional'}</h3><div class="metricline"><div><span>GROSS EV</span><strong>${metric.gross_ev==null?'—':prefix+money(metric.gross_ev)}</strong></div><div><span>AFTER FEES / COSTS</span><strong>${money(metric.net_proceeds)}</strong></div><div><span>NET PROFIT</span><strong>${money(metric.net_profit)}</strong></div><div><span>RETURN</span><strong>${metric.return_percent==null?'—':metric.return_percent.toFixed(1)+'%'}</strong></div></div>${result.issues.length?`<ul class="help">${result.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:''}<div class="tablewrap"><table><thead><tr><th>Pool</th><th>Priced / checklist</th><th>Avg cards / pack</th><th>Mean sellable value</th><th>EV / pack</th></tr></thead><tbody>${result.breakdown.map(p=>`<tr><td>${esc(p.label)}</td><td>${p.priced}/${p.pool_size ?? '?'}</td><td>${p.expected_per_pack ?? '—'}</td><td>${money(p.average)}</td><td>${money(p.contribution)}</td></tr>`).join('')}</tbody></table></div>`;
}
function parseCSV(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===',' && !quoted){row.push(cell);cell='';}
    else if((c==='\n' || c==='\r') && !quoted){if(c==='\r' && text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV has an unclosed quoted field.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
async function importPools(event) {
  const file=event.target.files[0];if(!file)return;
  const current=editVersion;
  try {
    if(file.size>2*1024*1024)throw new Error('Use a CSV under 2 MB.');
    const rows=parseCSV((await file.text()).replace(/^\uFEFF/,'')),headers=rows.shift()?.map(v=>v.trim());
    if(!headers || !['pool','name','raw_price','pool_size','expected_per_pack'].every(k=>headers.includes(k)))throw new Error('CSV is missing required pool/card columns.');
    if(new Set(headers).size!==headers.length)throw new Error('CSV has duplicate column names.');
    const pools=new Map();
    for(const row of rows){
      if(row.length!==headers.length)throw new Error('A CSV row has the wrong number of columns.');
      const c=Object.fromEntries(headers.map((key,i)=>[key,row[i].trim()])),label=c.pool;
      if(!pools.has(label))pools.set(label,{id:uid(),label,expected_per_pack:number(c.expected_per_pack),pool_size:number(c.pool_size),cards:[]});
      const pool=pools.get(label);
      if(pool.expected_per_pack!==number(c.expected_per_pack) || pool.pool_size!==number(c.pool_size))throw new Error(`Inconsistent rate or checklist size for ${label}.`);
      pool.cards.push({id:c.card_id || uid(),name:c.name,number:c.number || '',parallel:c.parallel || '',raw_price:number(c.raw_price),price_as_of:c.price_as_of || null,source_url:c.source_url || '',image_url:c.image_url || ''});
    }
    if(!pools.size)throw new Error('The CSV has no cards.');
    const next={...draft,pools:[...pools.values()],reviewed:false};await api('/preview',next);
    if(!draft || editVersion!==current)throw new Error('The draft changed during import. Import the file again.');
    if(draft.pools.length && !confirm('Replace this draft’s card pools with the imported CSV?'))return;
    readDraft();draft.pools=next.pools;draft.reviewed=false;dirty=true;renderEditor();$('#save-status').textContent='Imported into draft. Review before saving.';
  }catch(e){fail(e);}finally{if($('#import-csv'))$('#import-csv').value='';}
}
function sessionChanged(session) {
  const next=session?.access_token || '',nextUser=session?.user?.id || '';
  if(next===token)return;
  const different=nextUser!==user;token=next;user=nextUser;version++;
  resetFeatured();
  requests.forEach(c=>c.abort());requests.clear();dialogVersion++;$('#cards-dialog')?.remove();
  if(different || !token){editVersion++;state=null;draft=null;dirty=false;saving=false;$('#editor').hidden=true;$('#editor').replaceChildren();$('#rows').replaceChildren();}
  $('#account-link').textContent=token?'My account':'Sign in';$('#account-status').textContent=token?'Your private models and favorites':'Sign in to save your models and favorites';
  error();load().catch(fail);
}
$('#account-link').href=`profile${HTML}`;
$('#rows').onclick=event=>{
  const retry=event.target.closest('[data-featured-retry]');if(retry){featured.delete(retry.dataset.featuredRetry);queueFeatured(retry.dataset.featuredRetry);return;}
  const open=event.target.closest('[data-open]');if(open){openSet(open.dataset.open);return;}
  const edit=event.target.closest('[data-edit]');if(edit){const entry=state.settings.entries.find(e=>e.id===edit.dataset.edit);startModel({id:entry.set_id,name:entry.set_name,sport:entry.sport},{id:entry.format_id});}
};
for(const id of ['sport','view','unit','sort'])$('#'+id).onchange=()=>{render();if(id==='unit' && draft)$('#model-result').replaceChildren();};
$('#search').oninput=render;
$('#refresh').onclick=()=>{error();sets.clear();resetFeatured();load().catch(fail);};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
load().catch(fail);
if(typeof SB!=='undefined' && SB){SB.auth.onAuthStateChange((_event,session)=>queueMicrotask(()=>sessionChanged(session)));SB.auth.getSession().then(({data,error:authError})=>{if(!authError)sessionChanged(data.session);}).catch(()=>{});}
})();
