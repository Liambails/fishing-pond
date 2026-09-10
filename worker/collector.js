window.CobaltCollect = async function() {
  // COBALT Trade Me DOM Collector v1.5.8
  // Current manually-opened page only. No crawling, navigation, or remote fetches.
  const VERSION = "1.5.9";
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

  // Close time. This value is lifecycle-critical: COBALT uses it to schedule a closure
  // confirmation and to distinguish normal expiry from early sale/relist behaviour. Trade Me
  // has several marketplace/motors templates, so use semantic fallbacks rather than one CSS class.
  let close=null, closeSource=null;
  const cleanClose=v=>clean(v).replace(/^(?:(?:auction|listing)\s+)?(?:closed|closing|closes?|ended|ending|ends?)\s*:?\s*/i,'').trim();
  const looksLikeClose=v=>{
    const s=clean(v);
    return Boolean(s && (/(?:today|tomorrow)\s*,?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i.test(s)||/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b.*\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i.test(s)||/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b.*\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(s)||/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i.test(s)));
  };
  const takeClose=(value,source)=>{if(close||!looksLikeClose(value))return false;close=cleanClose(value);closeSource=source;return true;};
  const closeSelectors=[
    '.tm-motors-date-city-watchlist__date',
    'tm-listing-close-time tm-closing-time',
    'tm-listing-close-time',
    'tm-closing-time',
    '[data-testid*=\"closing\" i]',
    '[data-testid*=\"close-time\" i]',
    '[class*=\"listing-close-time\" i]',
    '[class*=\"closing-time\" i]'
  ];
  for(const sel of closeSelectors){
    if(close)break;
    for(const el of $$(sel)){
      const attrs=['title','datetime','aria-label','data-date','data-datetime','data-close-date','data-closing-date'];
      for(const a of attrs){if(takeClose(el.getAttribute?.(a),`selector:${sel}@${a}`))break;}
      if(!close)takeClose(txt(el),`selector:${sel}:text`);
      if(close)break;
    }
  }
  if(!close && offer?.priceValidUntil){close=offer.priceValidUntil;closeSource='jsonld:priceValidUntil';}
  if(!close && offer?.availabilityEnds){close=offer.availabilityEnds;closeSource='jsonld:availabilityEnds';}
  // Structured application state sometimes carries a close timestamp even when the visible
  // web component is still hydrating. Only inspect explicit close/end keys, never arbitrary dates.
  if(!close){
    const keyRx=/[\"'](?:closeDate|closingDate|closeTime|closingTime|endDate|endTime|expiryDate|expiresAt|endAt)[\"']\s*:\s*[\"']([^\"']+)[\"']/ig;
    for(const script of $$('script')){let m;const body=script.textContent||'';while((m=keyRx.exec(body))){if(takeClose(m[1],'script:structured-close-key'))break;}if(close)break;}
  }
  // Last resort: an explicitly labelled Closes/Closing/Ends fragment in rendered page text.
  // This cannot accidentally pick up seller-member dates because the label is mandatory.
  if(!close){
    const labelled=pageText.match(/(?:Closes?|Closing|Ends?|Ending)\s*:?\s*((?:Today|Tomorrow)\s*,?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?|(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\s*,?\s*)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s*,?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if(labelled)takeClose(labelled[1],'page-text:explicit-close-label');
  }
  put('close_date',close,closeSource,closeSource?.startsWith('page-text:')?.88:.97);
  const remaining=txt($('.tm-listing-close-time__remaining, [data-testid*=\"remaining\" i]'))||null;
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
    // A pure counter is safe only inside a known views-specific DOM element. The old
    // whole-page fallback was able to pair the word "views" with unrelated numbers
    // elsewhere in flattened page text (for example a seller-member year such as 2023).
    const pureCount=(value)=>{const v=clean(value);return /^\d{1,3}(?:,\d{3})*$|^\d+$/.test(v)?Number(v.replace(/,/g,'')):null;};
    const knownSelectors=[
      '.tm-listing-id-views__views',
      '.tm-motors-date-city-watchlist__views-container',
      '[data-testid*="views" i]',
      '[data-testid*="page-view" i]'
    ];
    for(const selector of knownSelectors){
      for(const el of $$(selector)){
        const rawText=txt(el);
        const labelled=parseViewsText(rawText);
        const standalone=pureCount(rawText);
        const n=labelled!=null?labelled:standalone;
        if(n!=null && n>=0)return {value:n,source:`selector:${selector}`};
      }
    }
    // Broader class-name matches are accepted only when their own text explicitly labels
    // the number as views. We never extract an arbitrary first number from these elements.
    for(const selector of ['[class*="listing-id-views"]','[class*="views-container"]']){
      for(const el of $$(selector)){
        const n=parseViewsText(txt(el));
        if(n!=null && n>=0)return {value:n,source:`selector-labelled:${selector}`};
      }
    }
    // Some templates expose the label through accessibility/title attributes.
    for(const el of $$('[aria-label],[title]')){
      const label=clean(el.getAttribute('aria-label')||el.getAttribute('title'));
      const n=parseViewsText(label); if(n!=null)return {value:n,source:'attribute:view-label'};
    }
    // Marketplace templates such as Home & Living can render a plain footer row like
    // "Page views: 32" without a stable class/test-id. Inspect only small local elements whose
    // OWN text explicitly contains the label. This is intentionally not a whole-document
    // number fallback: the number and the word views must be in the same short element.
    for(const el of $$('span,p,li,div')){
      const own=txt(el); if(!own || own.length>90 || !/\b(?:page\s+)?views?\b/i.test(own))continue;
      const childText=[...el.children].map(txt).filter(Boolean).join(' ');
      // Avoid broad wrapper elements whose text is mainly inherited from many descendants.
      if(el.children.length>4 || (childText && own.length>childText.length+50))continue;
      const n=parseViewsText(own); if(n!=null && n>=0)return {value:n,source:'local-labelled-element:views'};
    }
    // Deliberately no document.body numeric fallback. Missing is safer than a fabricated counter.
    return {value:null,source:null};
  };
  const viewRead=readViews();
  let views=viewRead.value;
  put('views',views,viewRead.source,views!=null?.98:0);
  // Public buyer-behaviour counters. Absence is UNKNOWN, never zero. Trade Me currently
  // exposes watcher counts on some templates as "359 others watchlisted" and auction counts
  // as "54 bids so far". Fixed-price/category templates may expose neither.
  let watchers=null;
  const wm=pageText.match(/([\d,]+)\s+(?:other(?:s)?\s+)?watchlisted\b|([\d,]+)\s+(?:people\s+)?watching\b|Watchers?:\s*([\d,]+)/i);
  if(wm)watchers=Number((wm[1]||wm[2]||wm[3]).replace(/,/g,''));
  put('watchers',watchers,watchers!=null?'page-text:public-watch-count':null,.98);
  let bids=null;
  if(/\bNo bids\b/i.test(priceArea))bids=0;
  else {const bm=priceArea.match(/([\d,]+)\s+bids?(?:\s+so\s+far)?\b|Bids?:\s*([\d,]+)/i);if(bm)bids=Number((bm[1]||bm[2]).replace(/,/g,''));}
  put('bids',bids,bids!=null?(bids===0?'pricing-text:explicit-no-bids':'pricing-text:public-bid-count'):null,.98);
  const reserveMet=/\bReserve met\b/i.test(priceArea);
  put('reserve_met',reserveMet,'pricing-text:reserve-state',.94);

  // Additional marketplace intent signals. Only record values Trade Me exposes on the
  // listing page; never infer private offer counts or sales from views.
  const buyNowAvailable=buyNow!=null||/\bBuy Now\b/i.test(priceArea);
  const offerAvailable=/\b(?:Make|Place|Submit) an? offer\b|\bMake offer\b/i.test(pageText);
  put('buy_now_available',buyNowAvailable,'pricing-dom/text',.92);
  put('offer_available',offerAvailable,'page-text:offer-action',.86);
  let stockQuantity=null;
  const stockMatch=pageText.match(/(?:Quantity available|In stock|Stock)\s*:?\s*([\d,]+)/i);
  if(stockMatch)stockQuantity=Number(stockMatch[1].replace(/,/g,''));
  put('stock_quantity',stockQuantity,stockQuantity!=null?'page-text:stock-label':null,.82);

  // Public Q&A is valuable because questions encode buying intent, compatibility checks,
  // condition concerns and identifiers that may not appear in the seller description.
  const qa=[];
  for(const node of $$('tm-listing-member-question')){
    const comments=$$('tg-comment',node);
    if(!comments.length)continue;
    const readComment=(el)=>({
      text:txt($('tg-comment-text, .o-comment__text',el))||null,
      member:txt($('.tm-member-reputation__display-name',el))||null,
      note:txt($('tg-comment-note, .o-comment__note',el))||null
    });
    const question=readComment(comments[0]);
    const answer=comments[1]?readComment(comments[1]):null;
    if(question.text)qa.push({question,answer});
  }
  const qText=qa.map(x=>x.question?.text||'').join(' ');
  const purchaseIntentRx=/\b(?:offer|reserve|buy|buy now|take \$?|would you take|pick ?up (?:today|tonight|tomorrow)|can i collect|best price|lowest price|cash)\b/i;
  const compatibilityRx=/\b(?:fit|fits|compatible|part number|oem|model|chassis|engine|year|connector|pin|left|right|lh|rh)\b/i;
  const conditionRx=/\b(?:condition|work|working|fault|issue|problem|damage|damaged|crack|cracked|rust|leak|broken|repair|replace|replaced|missing|wear|worn)\b/i;
  const purchaseIntentQuestions=qa.filter(x=>purchaseIntentRx.test(x.question?.text||'')).length;
  const compatibilityQuestions=qa.filter(x=>compatibilityRx.test(x.question?.text||'')).length;
  const conditionQuestions=qa.filter(x=>conditionRx.test(x.question?.text||'')).length;
  const qaCodes=[...new Set((qText.toUpperCase().match(/\b[A-Z]{1,5}[-_]?[A-Z0-9]{2,12}(?:[-_/][A-Z0-9]{2,12})*\b/g)||[]).filter(x=>/\d/.test(x)&&x.length>=4&&x.length<=40))].slice(0,20);
  put('question_count',qa.length,qa.length?'selector:tm-listing-member-question':null,.99);
  put('q_and_a',qa,qa.length?'selector:tm-listing-member-question':null,.99);
  put('purchase_intent_questions',purchaseIntentQuestions,qa.length?'derived:q-and-a':null,.86);
  put('compatibility_questions',compatibilityQuestions,qa.length?'derived:q-and-a':null,.86);
  put('condition_questions',conditionQuestions,qa.length?'derived:q-and-a':null,.86);
  put('qa_identity_codes',qaCodes,qaCodes.length?'derived:q-and-a:identifier-pattern':null,.78);

  // Explicit conversion/status evidence only. A closed listing is NOT automatically sold.
  // Keep the phrases narrow because Trade Me's global footer itself contains text such as
  // "Sold Properties". Auction-specific evidence (won/winning bid/sold for) is decisive.
  const soldPatterns=[
    /\bthis (?:item|listing|auction) (?:has )?(?:been )?sold\b/i,
    /\bitem (?:has )?(?:been )?sold\b/i,
    /\bauction (?:has been |was )?won\b/i,
    /\byou won (?:this|the) auction\b/i,
    /\bwon by\b/i,
    /\bsold for \$[\d,]+(?:\.\d{1,2})?\b/i,
    /\bwinning bid(?:der)?\b/i
  ];
  const soldMatch=soldPatterns.find(rx=>rx.test(pageText))||null;
  const soldDetected=Boolean(soldMatch);
  const listingStatus=soldDetected?'sold':listingEnded?'ended':'active';
  put('sold_detected',soldDetected,soldDetected?'page-text:explicit-sale-outcome':null,.98);
  put('listing_status',listingStatus,'derived:explicit-page-state',.94);

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

  // Generic marketplace label/value facts. These deliberately avoid category-specific schemas.
  // COBALT stores the marketplace's own labels so a patio umbrella, laptop, toy or car part can
  // expose useful facts without pretending every listing has automotive fields.
  const marketplaceAttributes=[];
  const attrSeen=new Set();
  const addMarketplaceAttribute=(label,value,source)=>{
    label=clean(label).replace(/[:\s]+$/,''); value=clean(value);
    if(!label||!value||label.length>90||value.length>800)return;
    if(label.toLowerCase()===value.toLowerCase())return;
    const key=(label+'\u0000'+value).toLowerCase(); if(attrSeen.has(key))return; attrSeen.add(key);
    marketplaceAttributes.push({label,value,source});
  };
  for(const row of $$('dl')){
    const dts=$$('dt',row),dds=$$('dd',row);
    for(let i=0;i<Math.min(dts.length,dds.length);i++)addMarketplaceAttribute(txt(dts[i]),txt(dds[i]),'definition-list');
  }
  for(const row of $$('tg-rack-item, tm-core-seller-details tg-rack-item, [class*="listing-attribute"], [data-testid*="attribute" i]')){
    const label=txt($('.o-rack-item__primary-body, tg-rack-item-primary, [class*="label"], [data-testid*="label" i]',row));
    const value=txt($('.o-rack-item__secondary, tg-rack-item-secondary, [class*="value"], [data-testid*="value" i]',row));
    if(label&&value)addMarketplaceAttribute(label,value,'label-value-row');
  }
  for(const row of $$('table tr')){
    const cells=$$('th,td',row).map(txt).filter(Boolean);
    if(cells.length===2)addMarketplaceAttribute(cells[0],cells[1],'table-row');
  }
  const attributeMap={};
  for(const a of marketplaceAttributes){if(attributeMap[a.label]===undefined)attributeMap[a.label]=a.value;}
  put('marketplace_attributes',marketplaceAttributes,marketplaceAttributes.length?'generic:label-value':null,.96);
  put('marketplace_attribute_map',attributeMap,marketplaceAttributes.length?'derived:label-value-map':null,.94);
  const attrValue=(patterns)=>{for(const a of marketplaceAttributes){if(patterns.some(rx=>rx.test(a.label)))return a.value;}return null;};

  // Backfill generic fields only when the primary extractor did not find them.
  if(record.location==null){const v=attrValue([/^location$/i,/seller\s+location/i,/located\s+in/i]);if(v)put('location',v,'marketplace-attribute:location',.94);}
  if(record.condition==null){const v=attrValue([/^condition$/i,/item\s+condition/i]);if(v)put('condition',v,'marketplace-attribute:condition',.96);}
  if(record.views==null){const v=attrValue([/^page\s+views?$/i,/^views?$/i]);const n=v&&v.match(/[\d,]+/);if(n)put('views',Number(n[0].replace(/,/g,'')),'marketplace-attribute:views',.98);}
  if(record.watchers==null){const v=attrValue([/^watchers?$/i,/^watching$/i]);const n=v&&v.match(/[\d,]+/);if(n)put('watchers',Number(n[0].replace(/,/g,'')),'marketplace-attribute:watchers',.94);}
  if(record.bids==null){const v=attrValue([/^bids?$/i,/bid\s+count/i]);const n=v&&v.match(/[\d,]+/);if(n)put('bids',Number(n[0].replace(/,/g,'')),'marketplace-attribute:bids',.95);}
  if(record.close_date==null){const v=attrValue([/^closes?$/i,/closing\s+(?:date|time)/i,/^ends?$/i]);if(v)put('close_date',v,'marketplace-attribute:close',.95);}

  // Condition: conservative explicit inference only.
  let condition=record.condition, conditionSource=record.condition?'marketplace-attribute:condition':null;
  if(!condition && product?.itemCondition){condition=String(product.itemCondition).replace(/^https?:\/\/schema.org\//,'').replace(/Condition$/,'');conditionSource='jsonld:itemCondition';}
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
  if(!record.listing_id)warnings.push('missing_listing_id'); if(!record.listing_title)warnings.push('missing_title'); if(!pricePresent)warnings.push('missing_price'); if(record.views==null)warnings.push('missing_views'); if(!record.seller)warnings.push('missing_seller'); if(!record.description)warnings.push('missing_description'); if(record.close_date==null&&!record.listing_ended)warnings.push('missing_close_date');
  record.extraction_quality={core_fields_found:found,core_fields_total:core.length+1,score:Math.round(found/(core.length+1)*100),warnings};
  record._sources=sources;
  console.log('COBALT extracted:',record);
  return record;
};

// Backward-compatible alias for legacy worker/extension installs.
window.FishingPondCollect = window.CobaltCollect;
