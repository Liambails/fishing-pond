window.CobaltCollect = async function() {
  // COBALT Trade Me DOM Collector v1.5.3
  // Current manually-opened page only. No crawling, navigation, or remote fetches.
  const VERSION = "1.5.3";
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const clean = v => String(v ?? "").trim().replace(/\s+/g, " ");
  const txt = el => clean(el?.innerText ?? el?.textContent ?? "");
  const num = s => {
    const m=clean(s).replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const money = s => {
    const m=clean(s).replace(/,/g,"").match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    return m ? Number(m[1]) : null;
  };
  const first = (...sels) => {
    for (const s of sels) { const el=$(s); const v=txt(el); if(v) return {value:v,source:`selector:${s}`,el}; }
    return {value:null,source:null,el:null};
  };
  const meta = (selector) => $(selector)?.getAttribute('content') || null;
  const parseJsonLd = () => {
    const out=[];
    for(const el of $$('script[type="application/ld+json"]')) {
      try { const v=JSON.parse(el.textContent||''); Array.isArray(v)?out.push(...v):out.push(v); } catch {}
    }
    const flat=[]; const walk=v=>{ if(!v||typeof v!=='object')return; if(Array.isArray(v))return v.forEach(walk); flat.push(v); if(v['@graph'])walk(v['@graph']); };
    out.forEach(walk); return flat;
  };
  const waitForPage = async () => {
    // A short stabilization window prevents SPA route transitions from capturing stale metadata.
    const wanted=location.pathname.match(/\/listing\/(\d+)/)?.[1];
    const start=Date.now();
    while(Date.now()-start < 1800) {
      const h=txt($('h1.tm-motors-listing__title, h1.tm-marketplace-buyer-options__listing_title, h1'));
      const body=txt(document.body);
      if(wanted && h && body.includes(wanted)) return;
      // Listing ID is usually only at bottom; don't force it. Title + price/location is enough.
      if(wanted && h && /(?:Buy Now|Asking price|Place bid|Seller located)/i.test(body)) return;
      await new Promise(r=>setTimeout(r,90));
    }
  };
  await waitForPage();

  const pathname=location.pathname;
  const listingId=pathname.match(/\/listing\/(\d+)/)?.[1] || null;
  const canonicalUrl=location.origin + pathname;
  const isMotors=/^\/a\/motors\//.test(pathname);
  const isMarketplace=/^\/a\/marketplace\//.test(pathname);
  const ld=parseJsonLd();
  const product=ld.find(x=>['Product','Car','Motorcycle','Vehicle'].includes(x?.['@type'])) || null;
  const offer=Array.isArray(product?.offers)?product.offers[0]:product?.offers || null;
  const sources={}; const record={collector_version:VERSION,captured_at:new Date().toISOString(),marketplace:'Trade Me',template:isMotors?'motors':isMarketplace?'marketplace':'unknown',url:canonicalUrl,source_url:location.href,listing_id:listingId};
  sources.listing_id={source:'url',confidence:.99};
  const put=(k,v,source,confidence=.8)=>{ if(v===undefined||v==='')v=null; record[k]=v; sources[k]={source:source||null,confidence:v==null?0:confidence}; };

  // Title / description
  let t=first('h1.tm-motors-listing__title','h1.tm-marketplace-buyer-options__listing_title','h1');
  if(!t.value && product?.name)t={value:clean(product.name),source:'jsonld:name'};
  put('listing_title',t.value,t.source,t.source?.startsWith('selector')?.99:.92);
  let d=first('.tm-motors-listing-description__text','tm-motors-listing-description .tm-markdown',"[data-testid='tm-listing'] .tm-marketplace-listing__description",'tm-marketplace-listing-description','.tm-marketplace-listing__description');
  if(!d.value && product?.description)d={value:clean(product.description),source:'jsonld:description'};
  if(!d.value){const v=meta('meta[property="og:description"]')||meta('meta[name="description"]');if(v)d={value:clean(v),source:'meta:description'};}
  put('description',d.value,d.source,d.source?.startsWith('selector')?.97:.82);

  // Category: URL is authoritative for current SPA route; meta/JSON-LD become corroborating evidence.
  const routeParts=pathname.split('/').filter(Boolean);
  const aIndex=routeParts.indexOf('a'), listingIndex=routeParts.indexOf('listing');
  const routeCategory=(aIndex>=0 && listingIndex>aIndex)?routeParts.slice(aIndex+1,listingIndex):[];
  const metaCategory=$$('meta[name^="category-l"]').map(el=>({n:el.getAttribute('name'),v:el.getAttribute('content')})).sort((a,b)=>num(a.n)-num(b.n)).map(x=>x.v).filter(Boolean);
  const category=routeCategory.length?routeCategory:metaCategory;
  put('category_path',category,routeCategory.length?'url:path':'meta:category-l*',routeCategory.length?.99:.95);
  put('breadcrumbs',category,routeCategory.length?'url:path':'meta:category-l*',routeCategory.length?.95:.8);

  const pageText=txt(document.body);
  const priceArea=txt($('.tm-auction-pricing-box, tm-auction-pricing-box, tm-pricing-box, tm-marketplace-buyer-options, .tm-motors-contact-box__section')) || pageText;
  const matchMoney=(rx,...texts)=>{for(const s of texts){const m=clean(s).match(rx);if(m)return Number(m[1].replace(/,/g,''));}return null;};
  let buyNow=matchMoney(/Buy Now\s*\$([\d,]+(?:\.\d{1,2})?)/i,priceArea,pageText);
  let asking=matchMoney(/Asking price:?\s*\$([\d,]+(?:\.\d{1,2})?)/i,priceArea,pageText);
  let starting=matchMoney(/Starting price\s*\$([\d,]+(?:\.\d{1,2})?)/i,priceArea,pageText);
  let currentBid=matchMoney(/Current bid\s*\$([\d,]+(?:\.\d{1,2})?)/i,priceArea,pageText);
  if(buyNow==null&&asking==null&&currentBid==null&&offer?.price!=null){const p=Number(offer.price); if(isMarketplace||/Asking price/i.test(pageText))asking=p; else if(/Buy Now/i.test(pageText))buyNow=p; else currentBid=p;}
  const placeBid=/\bPlace bid\b/i.test(priceArea)||/\bStarting price\b/i.test(priceArea);
  const noReserve=/\bNo reserve\b/i.test(priceArea);
  const reserveNotMet=/reserve not met/i.test(priceArea);
  put('buy_now_nzd',buyNow,buyNow!=null?'pricing-dom/text':null,.96);
  put('asking_price_nzd',asking,asking!=null?'pricing-dom/jsonld':null,.96);
  put('starting_price_nzd',starting,starting!=null?'pricing-dom/text':null,.96);
  put('current_bid_nzd',currentBid,currentBid!=null?'pricing-dom/text':null,.94);
  put('no_reserve',noReserve,'pricing-text',.9); put('reserve_not_met',reserveNotMet,'pricing-text',.9);
  let mode=asking!=null?'classified':(placeBid&&buyNow!=null?'auction_buy_now':placeBid?'auction':buyNow!=null?'buy_now':null);
  put('listing_mode',mode,'derived:pricing',.95);

  // Close time: top summary > explicit title attribute > visible tm-closing-time > JSON-LD.
  let close=null, closeSource=null;
  const topClose=txt($('.tm-motors-date-city-watchlist__date'));
  if(topClose){close=topClose.replace(/^Closes:\s*/i,'');closeSource='selector:.tm-motors-date-city-watchlist__date';}
  if(!close){
    const closeInner=$('tm-listing-close-time tm-closing-time > div, tm-closing-time > div');
    const title=clean(closeInner?.getAttribute('title'));
    if(title && title.toLowerCase()!=='undefined'){close=title.replace(/^Closes:\s*/i,'');closeSource='tm-closing-time:title';}
    else {const visible=txt(closeInner); if(visible){close=visible.replace(/^Closes:\s*/i,'');closeSource='tm-closing-time:text';}}
  }
  if(!close && offer?.priceValidUntil){close=offer.priceValidUntil;closeSource='jsonld:priceValidUntil';}
  if(!close && offer?.availabilityEnds){close=offer.availabilityEnds;closeSource='jsonld:availabilityEnds';}
  put('close_date',close,closeSource,.97);
  const remaining=txt($('.tm-listing-close-time__remaining'))||null;
  put('close_remaining',remaining,remaining?'selector:.tm-listing-close-time__remaining':null,.9);
  const endedPattern=/(?:this listing|this auction|auction)\s+(?:has\s+)?(?:closed|ended)|listing\s+(?:has\s+)?expired|listing\s+(?:has\s+)?(?:been\s+)?withdrawn|listing\s+(?:has\s+)?(?:been\s+)?removed/i;
  const listingEnded=endedPattern.test(pageText);
  let listingEndReason=null;
  if(listingEnded){
    if(/withdrawn/i.test(pageText))listingEndReason='withdrawn';
    else if(/removed/i.test(pageText))listingEndReason='removed';
    else if(/expired/i.test(pageText))listingEndReason='expired';
    else if(/closed/i.test(pageText))listingEndReason='closed';
    else listingEndReason='ended';
  }
  put('listing_ended',listingEnded,listingEnded?'page-text:closed-state':null,.96);
  put('listing_end_reason',listingEndReason,listingEnded?'page-text:closed-state':null,.93);

  let loc=txt($('.tm-motors-date-city-watchlist__location'));
  if(loc)loc=loc.replace(/^Seller located in\s*/i,'');
  const addr=offer?.seller?.address||offer?.offeredBy?.address;
  if(!loc&&addr)loc=[addr.addressLocality,addr.addressRegion].filter(Boolean).join(', ');
  put('location',loc,loc?'dom/jsonld':null,.96);

  // Views: Trade Me renders this field asynchronously and uses more than one template.
  // Prefer known semantic containers, then conservative label/text fallbacks. Never infer a
  // view count from an arbitrary number unless the same string explicitly says "view(s)".
  const parseViewsText = (value) => {
    const v=clean(value); if(!v)return null;
    const patterns=[
      /Page\s+views?\s*:?\s*([\d,]+)/i,
      /Views?\s*:?\s*([\d,]+)/i,
      /([\d,]+)\s+(?:page\s+)?views?\b/i,
      /·\s*([\d,]+)\s+views?\b/i,
    ];
    for(const rx of patterns){const m=v.match(rx);if(m)return Number(m[1].replace(/,/g,''));}
    return null;
  };
  const readViews = () => {
    const knownSelectors=[
      '.tm-listing-id-views__views',
      '.tm-motors-date-city-watchlist__views-container',
      '[class*="listing-id-views"]',
      '[class*="views-container"]',
      '[data-testid*="views" i]',
      '[data-testid*="page-view" i]'
    ];
    for(const selector of knownSelectors){
      for(const el of $$(selector)){
        const rawText=txt(el);
        const labelled=parseViewsText(rawText);
        const n=labelled!=null?labelled:num(rawText);
        if(n!=null && n>=0)return {value:n,source:`selector:${selector}`};
      }
    }
    // Some templates expose the label through accessibility/title attributes.
    for(const el of $$('[aria-label],[title]')){
      const label=clean(el.getAttribute('aria-label')||el.getAttribute('title'));
      const n=parseViewsText(label); if(n!=null)return {value:n,source:'attribute:view-label'};
    }
    const bodyValue=parseViewsText(txt(document.body));
    return bodyValue!=null?{value:bodyValue,source:'page-text:view-label'}:{value:null,source:null};
  };
  const viewRead=readViews();
  let views=viewRead.value;
  put('views',views,viewRead.source,views!=null?.98:0);
  let watchers=null; let wm=pageText.match(/([\d,]+)\s+(?:people\s+)?watching\b|Watchers?:\s*([\d,]+)/i); if(wm)watchers=Number((wm[1]||wm[2]).replace(/,/g,''));
  put('watchers',watchers,watchers!=null?'page-text':null,.82);
  let bids=null; if(/\bNo bids\b/i.test(priceArea))bids=0; else {let bm=priceArea.match(/([\d,]+)\s+bids?\b|Bids?:\s*([\d,]+)/i);if(bm)bids=Number((bm[1]||bm[2]).replace(/,/g,''));}
  put('bids',bids,bids!=null?'pricing-text':null,.9);

  // Seller: exact semantic children, never whole-block prefix parsing unless final fallback.
  const member=$('tm-member-summary, .member-summary-box');
  let seller=clean($('tm-member-summary h3, .member-summary-box h3')?.textContent);
  if(!seller)seller=clean(offer?.seller?.name||offer?.offeredBy?.name||'');
  if(!seller){const block=txt(member);const m=block.match(/^(?:[A-Z]\s+)?([^\s]+)\s+\d+(?:\.\d+)?%\s+positive feedback/i);if(m)seller=m[1];}
  put('seller',seller||null,seller?'selector:h3/jsonld':null,.99);
  const feedback=txt($('.member-summary-box__profile-feedback'));
  const fp=feedback.match(/(\d+(?:\.\d+)?)%\s+positive feedback/i); const fc=feedback.match(/positive feedback\s*\(\s*([\d,]+)/i);
  put('seller_feedback_pct',fp?Number(fp[1]):null,fp?'feedback-dom':null,.99);
  put('seller_feedback_count',fc?Number(fc[1].replace(/,/g,'')):null,fc?'feedback-dom':null,.99);
  const sellerBlock=txt(member);
  put('seller_in_trade',/\bin trade\b/i.test(sellerBlock),'seller-dom',.95);
  put('seller_address_verified',/address verified/i.test(sellerBlock),'seller-dom',.95);
  let memberSince=null;
  for(const row of $$('tm-core-seller-details tg-rack-item, .seller-details .o-rack-item')){
    const label=txt($('.o-rack-item__primary-body, tg-rack-item-primary',row));
    if(/^Member since$/i.test(label)){memberSince=txt($('.o-rack-item__secondary, tg-rack-item-secondary',row));break;}
  }
  if(!memberSince){const m=sellerBlock.match(/Member since\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}\s+\w+\s+\d{4})/i);if(m)memberSince=m[1];}
  put('seller_member_since',memberSince,memberSince?'seller-details:label-value':null,.99);

  // Shipping
  const shipRoot=$('tm-listing-shipping-details')||$('.tm-payment-pricing__shipping-options');
  const shipRows=shipRoot?$$('tbody tr',shipRoot).map(r=>{const c=$$('td',r).map(txt);return {description:c[0]||null,price_text:c[1]||null,price_nzd:money(c[1])};}).filter(x=>x.description||x.price_text):[];
  const pickup=shipRows.some(x=>/pick-?up/i.test(x.description||''))||/Pick-?up available/i.test(txt(shipRoot));
  put('shipping_options',shipRows,shipRoot?'shipping-table':null,.97); put('pickup_available',pickup,shipRoot?'shipping-table':null,.97);

  // Condition: conservative explicit inference only.
  let condition=null, conditionSource=null;
  if(product?.itemCondition){condition=String(product.itemCondition).replace(/^https?:\/\/schema.org\//,'').replace(/Condition$/,'');conditionSource='jsonld:itemCondition';}
  const desc=record.description||'';
  if(!condition){const m=desc.match(/\bCondition\s*:?\s*(New|Used|Refurbished)\b/i);if(m){condition=m[1];conditionSource='description:label';}}
  if(!condition && /\b(?:second[- ]hand|used part|listed for sale is .* used|\bUsed\b)/i.test(desc)){condition='Used';conditionSource='description:explicit-used';}
  if(!condition && /condition as per photos/i.test(desc)){condition='Used';conditionSource='description:condition-as-photos';}
  put('condition',condition,conditionSource,.9);

  // Images and structured vehicle data.
  let image=Array.isArray(product?.image)?product.image[0]:product?.image; image=image||meta('meta[property="og:image"]');
  put('primary_image_url',image||null,image?'jsonld/meta:image':null,.96);
  if(product){put('schema_type',product['@type']||null,'jsonld:@type',.99);put('brand',product?.brand?.name||product?.brand||null,'jsonld:brand',.95);put('model',product?.model||null,'jsonld:model',.95);put('model_year',product?.vehicleModelDate||null,'jsonld:vehicleModelDate',.95);put('odometer_km',product?.mileageFromOdometer?.value??null,'jsonld:mileageFromOdometer',.95);put('engine_cc',product?.vehicleEngine?.engineDisplacement?.value??null,'jsonld:engineDisplacement',.95);}

  // Seller SKU / tag numbers. These are NOT OEM part numbers.
  let sellerSku=null; const skuPatterns=[/\bSKU\s*:\s*([A-Z0-9][A-Z0-9/_-]*)/i,/\bTag\s*(?:No\.?|Number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{1,})/i,/\bour\s+tag\s+number\s*:\s*([A-Z0-9][A-Z0-9/_-]*)/i,/\bTAG\s+([A-Z0-9][A-Z0-9/_-]{2,})\b/i];
  for(const rx of skuPatterns){const m=desc.match(rx);if(m){sellerSku=m[1].replace(/[\]\[()]/g,'');break;}}
  put('seller_sku',sellerSku,sellerSku?'description:sku/tag':null,.95);

  // Part number parser: parse within the SAME structural block as the label.
  // This prevents an empty "Part Number:" at the end of one paragraph from
  // consuming the first word of the next paragraph (e.g. "Please").
  const candidates=[];
  const addCandidate=v=>{
    v=clean(v).replace(/^\[|\]$/g,'').replace(/[),.;]+$/,'');
    if(!v)return;
    if(/^(?:vin|tag|number|no|part|comes|with|please)$/i.test(v))return;
    if(/^TAG[-_ ]?\d+$/i.test(v))return;                 // seller tag, not OEM/part number
    if(/^\d+\s*PINS?$/i.test(v))return;                 // connector specification
    if(!/\d/.test(v))return;                            // automotive part codes should contain a digit
    if(!/[A-Z0-9]/i.test(v)||v.length<4||v.length>40)return;
    if(!candidates.includes(v))candidates.push(v);
  };
  const descEl=d.el || $('.tm-motors-listing-description__text') || $('tm-motors-listing-description .tm-markdown');
  const blocks=descEl ? $$('p, td, dd',descEl).map(el=>String(el.innerText??el.textContent??'').trim()).filter(Boolean) : [];
  const parsePartLabels=(block)=>{
    const rx=/(?:\bOEM\b|\bP\/?N\b|\b(?:Notes\s*\/\s*)?Part\s*(?:Number|No\.?|#))\s*[:#-]?\s*([^\n\r]{0,90})/ig;
    let m;
    while((m=rx.exec(block))){
      let segment=clean(m[1]).split(/\b(?:Tag\s*(?:No\.?|Number|#)?|VIN|Chassis(?:\s*Code)?|Engine(?:\s*Code)?|Year|Make|Model|Notes)\s*[:#]/i)[0].trim();
      if(!segment)continue;
      const lead=segment.match(/^\[?([A-Z0-9][A-Z0-9._\/-]{3,})\]?/i);
      if(lead)addCandidate(lead[1]);
      // Parenthetical/bracket alternatives are useful only when code-like; addCandidate rejects "15 PIN" etc.
      [...segment.matchAll(/\[([^\]]+)\]|\(([^)]+)\)/g)].forEach(x=>addCandidate(x[1]||x[2]));
    }
  };
  if(blocks.length) blocks.forEach(parsePartLabels);
  else parsePartLabels(desc); // fallback for templates that do not expose paragraph structure

  // Conservative title fallback for code-like suffixes such as (PBT-GF30), never seller tags such as (TAG4018).
  if(!candidates.length){
    const tm=(record.listing_title||'').match(/\(([A-Z0-9][A-Z0-9._\/-]{4,})\)\s*$/i);
    if(tm)addCandidate(tm[1]);
  }
  put('part_number_candidates',candidates,candidates.length?'description/title:explicit-part-label':null,.96);
  put('part_number',candidates[0]||null,candidates.length?'description/title:explicit-part-label':null,.96);

  // Useful labeled vehicle signals for later enrichment. Accept common seller variants.
  const labeled=(labels)=>{
    for(const label of labels){
      const m=desc.match(new RegExp('\\b'+label+'\\s*:\\s*([A-Z0-9._/-]+)','i'));
      if(m)return m[1];
    }
    return null;
  };
  const yearLabel=labeled(['YEAR']);
  const makeLabel=labeled(['MAKE']);
  const modelLabel=labeled(['MODEL']);
  const chassisLabel=labeled(['CHASSIS\\s+CODE','CHASSIS']);
  const vinLabel=labeled(['VIN']);
  const engineLabel=labeled(['ENGINE\\s+CODE','ENGINE']);
  put('vehicle_year_label',yearLabel,yearLabel?'description:label':null,.95);
  put('make_label',makeLabel,makeLabel?'description:label':null,.95);
  put('model_label',modelLabel,modelLabel?'description:label':null,.95);
  put('chassis_code_label',chassisLabel,chassisLabel?'description:label':null,.95);
  put('vin_label',vinLabel,vinLabel?'description:label':null,.95);
  put('engine_code_label',engineLabel,engineLabel?'description:label':null,.95);

  const core=['listing_id','listing_title','description','seller','location','views'];
  const pricePresent=[buyNow,asking,starting,currentBid].some(v=>v!=null);
  const found=core.filter(k=>record[k]!=null&&record[k]!==''&&(!Array.isArray(record[k])||record[k].length)).length+(pricePresent?1:0);
  const warnings=[];
  if(!record.listing_id)warnings.push('missing_listing_id'); if(!record.listing_title)warnings.push('missing_title'); if(!pricePresent)warnings.push('missing_price'); if(record.views==null)warnings.push('missing_views'); if(!record.seller)warnings.push('missing_seller'); if(!record.description)warnings.push('missing_description');
  record.extraction_quality={core_fields_found:found,core_fields_total:core.length+1,score:Math.round(found/(core.length+1)*100),warnings};
  record._sources=sources;
  console.log('COBALT extracted:',record);
  return record;
};

// Backward-compatible alias for legacy worker/extension installs.
window.FishingPondCollect = window.CobaltCollect;
