export type Obs = {
  captured_at?:string;
  views?:number|null;
  watchers?:number|null;
  bids?:number|null;
  asking_price_nzd?:number|null;
  buy_now_nzd?:number|null;
  current_bid_nzd?:number|null;
  starting_price_nzd?:number|null;
  close_date?:string|null;
  close_remaining?:string|null;
};

export type Listing = {
  id:string;
  listing_id:string;
  title?:string|null;
  seller?:string|null;
  url:string;
  product_id?:string|null;
  active:boolean;
  first_seen?:string|null;
  last_observed_at?:string|null;
  next_observation_at?:string|null;
  consecutive_failures?:number;
  last_error?:string|null;
  metadata?:any;
  observations?:Obs[];
};

const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const median=(xs:number[])=>{ if(!xs.length)return null; const a=[...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const round=(n:number,d=1)=>Number(n.toFixed(d));
const DAY=86400000;
export function priceOf(o:Obs){ return o.buy_now_nzd ?? o.asking_price_nzd ?? o.current_bid_nzd ?? null; }

function chronological(obs:Obs[]=[]){
  return [...obs].filter(x=>x.captured_at).sort((a,b)=>Date.parse(a.captured_at!)-Date.parse(b.captured_at!));
}
function intervalVelocity(a?:Obs,b?:Obs){
  if(!a?.captured_at||!b?.captured_at||a.views==null||b.views==null)return null;
  const days=(Date.parse(b.captured_at)-Date.parse(a.captured_at))/DAY;
  if(days<=0)return null;
  const delta=Number(b.views)-Number(a.views);
  // Marketplace view counters are cumulative. A negative delta is a parser/reset anomaly, not negative demand.
  if(delta<0)return null;
  return round(delta/days,2);
}
export function listingVelocity(obs:Obs[]=[]){
  const a=chronological(obs).filter(x=>x.views!=null);
  if(a.length<2)return null;
  return intervalVelocity(a[0],a[a.length-1]);
}
export function recentVelocity(obs:Obs[]=[]){
  const a=chronological(obs).filter(x=>x.views!=null);
  if(a.length<2)return null;
  return intervalVelocity(a[a.length-2],a[a.length-1]);
}
export function previousVelocity(obs:Obs[]=[]){
  const a=chronological(obs).filter(x=>x.views!=null);
  if(a.length<3)return null;
  return intervalVelocity(a[a.length-3],a[a.length-2]);
}

function viewsLast24Hours(obs:Obs[]=[]){
  const a=chronological(obs).filter(x=>x.views!=null);
  if(a.length<2)return null;
  const latest=a[a.length-1]; const lt=Date.parse(latest.captured_at!); const cutoff=lt-DAY;
  const candidates=a.slice(0,-1).filter(x=>Date.parse(x.captured_at!)<=cutoff+4*3600000);
  if(!candidates.length)return null;
  const base=candidates.reduce((best,x)=>Math.abs(Date.parse(x.captured_at!)-cutoff)<Math.abs(Date.parse(best.captured_at!)-cutoff)?x:best,candidates[0]);
  const delta=Number(latest.views)-Number(base.views);
  return delta<0?null:delta;
}

function evidenceDetails(listing:Listing,obs:Obs[]){
  const count=obs.length;
  const spanHours=count>=2?(Date.parse(obs[count-1].captured_at||'')-Date.parse(obs[0].captured_at||''))/3600000:0;
  const freshnessHours=listing.last_observed_at?Math.max(0,(Date.now()-Date.parse(listing.last_observed_at))/3600000):999;
  const failures=Number(listing.consecutive_failures||0);
  return {count,spanHours:round(Math.max(0,spanHours),1),freshnessHours:round(freshnessHours,1),failures};
}

function validCloseDate(latest?:Obs){
  if(!latest?.captured_at||!latest?.close_date)return null;
  const captured=Date.parse(latest.captured_at);
  const close=Date.parse(latest.close_date);
  if(!Number.isFinite(captured)||!Number.isFinite(close))return null;
  // Trade Me listings are normally short-lived. Ignore clearly malformed parser dates.
  const hours=(close-captured)/3600000;
  if(hours < -24*30 || hours > 24*60)return null;
  return {closeDate:new Date(close).toISOString(),hoursToClose:round(hours,1)};
}

function velocityScore(v:number|null){
  if(v==null)return null;
  if(v<=0)return 0;
  return clamp(100*(1-Math.exp(-v/6)));
}
function accelerationScore(recent:number|null,previous:number|null){
  if(recent==null||previous==null)return null;
  if(recent<=0&&previous<=0)return 20;
  if(previous<=0)return recent>0?90:20;
  const ratio=recent/Math.max(previous,.25);
  if(ratio>=3)return 100;
  if(ratio>=2)return 85;
  if(ratio>=1.5)return 70;
  if(ratio>=1.15)return 58;
  if(ratio>=.85)return 50;
  if(ratio>=.6)return 35;
  if(ratio>=.3)return 20;
  return 5;
}
function evidenceScore(listing:Listing,obs:Obs[]){
  const count=obs.length;
  const spanHours=count>=2?(Date.parse(obs[count-1].captured_at||'')-Date.parse(obs[0].captured_at||''))/3600000:0;
  const freshnessHours=listing.last_observed_at?Math.max(0,(Date.now()-Date.parse(listing.last_observed_at))/3600000):999;
  const failures=Number(listing.consecutive_failures||0);
  return clamp(
    Math.min(60,count*16)+
    Math.min(20,Math.max(0,spanHours)/24*8)+
    (freshnessHours<30?20:freshnessHours<54?10:0)-
    failures*12
  );
}
function engagementScore(latest?:Obs){
  if(!latest)return null;
  const hasWatchers=latest.watchers!=null;
  const hasBids=latest.bids!=null;
  if(!hasWatchers&&!hasBids)return null;
  const watchers=Number(latest.watchers||0), bids=Number(latest.bids||0);
  return clamp(watchers*10+bids*22);
}

function inferPart(title=''){
  const t=title.toLowerCase();
  if(t.includes('master')&&t.includes('window'))return 'master-window-switch';
  if(t.includes('window switch'))return 'window-switch';
  if(t.includes('combination'))return 'combination-switch';
  if(t.includes('wiper'))return 'wiper-switch';
  if(t.includes('headlight'))return 'headlight-switch';
  if(t.includes('ignition'))return 'ignition-switch';
  if(t.includes('seat belt'))return 'seat-belt';
  if(t.includes('console')&&t.includes('switch'))return 'console-switch';
  return 'other';
}
export function comparableKey(listing:Listing){
  const md=listing.metadata&&typeof listing.metadata==='object'?listing.metadata:{};
  const title=listing.title||'';
  const t=title.toLowerCase();
  const make=(md.vehicle||t.includes('toyota')?'Toyota':'').toLowerCase();
  const model=(md.vehicle||t.includes('aqua')?'Aqua':'').toLowerCase();
  const chassis=String(md.chassis||(title.match(/\bNHP10\b/i)||[])[0]||'').toLowerCase();
  const part=String(md.part_type||inferPart(title)).toLowerCase().replace(/\s+/g,'-');
  return [make,model,chassis,part].join('|');
}

function baseSignal(listing:Listing){
  const obs=chronological(listing.observations||[]);
  const latest=obs[obs.length-1];
  const views=Number(latest?.views ?? 0);
  const watchers=latest?.watchers==null?null:Number(latest.watchers);
  const bids=latest?.bids==null?null:Number(latest.bids);
  const currentBid=latest?.current_bid_nzd==null?null:Number(latest.current_bid_nzd);
  const startingPrice=latest?.starting_price_nzd==null?null:Number(latest.starting_price_nzd);
  const velocity=recentVelocity(obs);
  const priorVelocity=previousVelocity(obs);
  const overallVelocity=listingVelocity(obs);
  const price=latest?priceOf(latest):null;
  const observationCount=obs.length;
  const evidence=evidenceScore(listing,obs);
  const engagement=engagementScore(latest);
  const close=validCloseDate(latest);
  const views24h=viewsLast24Hours(obs);
  const evidenceDetailsValue=evidenceDetails(listing,obs);
  return {obs,latest,views,watchers,bids,currentBid,startingPrice,velocity,priorVelocity,overallVelocity,price,observationCount,evidence,engagement,close,views24h,evidenceDetails:evidenceDetailsValue};
}

export function computeListingSignals(listings:Listing[]){
  const bases=listings.map(l=>({listing:l,...baseSignal(l),key:comparableKey(l)}));
  const groups=new Map<string,typeof bases>();
  for(const b of bases){const g=groups.get(b.key)||[];g.push(b);groups.set(b.key,g)}

  return bases.map(b=>{
    const isOwn=b.listing.metadata?.ownership==='own';
    const peerGroup=(groups.get(b.key)||[]).filter(x=>x.listing.id!==b.listing.id&&x.velocity!=null&&(isOwn||x.listing.metadata?.ownership!=='own'));
    const peerVelocities=peerGroup.map(x=>Number(x.velocity));
    const peerMedian=median(peerVelocities);
    const relativeRatio=b.velocity!=null&&peerMedian!=null&&peerMedian>.1?b.velocity/peerMedian:null;
    let relativeScore:number|null=null;
    if(relativeRatio!=null){
      relativeScore=clamp(relativeRatio>=4?100:relativeRatio>=3?90:relativeRatio>=2?78:relativeRatio>=1.5?65:relativeRatio>=1?50:relativeRatio>=.5?28:12);
    }

    const vScore=velocityScore(b.velocity);
    const aScore=accelerationScore(b.velocity,b.priorVelocity);
    let closeScore:number|null=null;
    if(b.close&&vScore!=null){
      const h=b.close.hoursToClose;
      const multiplier=h<=24?1.18:h<=72?1.10:h<=168?1.03:.95;
      closeScore=clamp(vScore*multiplier);
    }

    const components:[string,number,number|null][]=[
      ['velocity',40,vScore],
      ['close',20,closeScore],
      ['acceleration',10,aScore],
      ['engagement',10,b.engagement],
      ['relative',10,relativeScore],
      ['evidence',10,b.evidence]
    ];
    const usable=components.filter(([,w,s])=>w>0&&s!=null) as [string,number,number][];
    const totalWeight=usable.reduce((s,x)=>s+x[1],0)||1;
    const attention=clamp(usable.reduce((s,[,w,score])=>s+w*score,0)/totalWeight);
    const confidence=clamp(b.evidence + (relativeScore!=null?8:0) + (b.close?5:0));

    const peerPositive=peerGroup.filter(x=>(x.velocity||0)>=2).length;
    const peerPositiveShare=peerGroup.length?peerPositive/peerGroup.length:0;
    const corroborated=peerGroup.length>=2&&peerPositiveShare>=.5;
    const spanReady=b.evidenceDetails.spanHours>=20;
    const earlyStrong=b.observationCount===2&&attention>=72&&b.velocity!=null;
    // GOOD requires repeated confirmation. Comparable listings can corroborate the trend;
    // isolated listings need an extra observation before a strong verdict is allowed.
    const goodEvidenceReady=b.observationCount>=3&&spanReady&&confidence>=55;
    const standaloneConfirmed=b.observationCount>=4&&b.velocity!=null&&b.velocity>=6;

    let label='TOO EARLY';
    if(b.observationCount>=2&&b.velocity!=null&&confidence>=42){
      if(attention>=88&&confidence>=80&&b.observationCount>=4&&b.evidenceDetails.spanHours>=30&&corroborated)label='MUST_HAVE';
      else if(attention>=72&&goodEvidenceReady&&(corroborated||standaloneConfirmed))label='GOOD';
      else if(attention>=50||earlyStrong)label='WATCHING';
      else label='LOW SIGNAL';
    }

    const statusPlain=label==='GOOD'?'Strong attention confirmed by repeated evidence':label==='WATCHING'?(earlyStrong?'Strong early signal, but another observation is needed':'Promising, but not strong enough yet'):label==='LOW SIGNAL'?'Enough data, but attention is weak':label==='TOO EARLY'?'Not enough data yet':'Exceptional attention with repeated peer support';
    const whyParts:string[]=[];
    if(label==='TOO EARLY') whyParts.push(`only ${b.observationCount} observation${b.observationCount===1?'':'s'} so far`);
    if(b.views24h!=null) whyParts.push(`${b.views24h>=0?'+':''}${b.views24h} views in the last 24h`);
    else if(b.velocity!=null) whyParts.push(`${b.velocity>=0?'+':''}${b.velocity} views/day recently`);
    if(b.velocity!=null&&b.priorVelocity!=null&&b.priorVelocity>0){
      const ratio=round(b.velocity/b.priorVelocity,1);
      if(ratio>=1.2)whyParts.push(`attention is accelerating (${ratio}× the previous pace)`);
      else if(ratio<=.8)whyParts.push(`attention has slowed versus the previous interval`);
    }
    if(relativeRatio!=null&&relativeRatio>=1.4) whyParts.push(`moving ${round(relativeRatio,1)}× faster than comparable listings`);
    if(corroborated) whyParts.push(`corroborated by ${peerPositive} of ${peerGroup.length} comparable listings also gaining views`);
    else if(earlyStrong) whyParts.push('one strong interval so far; waiting for another observation to confirm it');
    if(b.close&&b.close.hoursToClose>=0&&b.close.hoursToClose<=72&&b.velocity!=null&&b.velocity>0) whyParts.push(`still attracting views with ${Math.round(b.close.hoursToClose)}h left`);
    if((b.bids||0)>0) whyParts.push(`${b.bids} bid${b.bids===1?'':'s'} recorded${b.currentBid!=null?` · current bid $${b.currentBid}`:''}`);
    else if((b.watchers||0)>0) whyParts.push(`${b.watchers} watcher${b.watchers===1?'':'s'} recorded`);
    if(Number(b.listing.consecutive_failures||0)>0) whyParts.push(`${b.listing.consecutive_failures} recent collection failure${b.listing.consecutive_failures===1?'':'s'} lowers reliability`);
    const e=b.evidenceDetails;
    const confidenceBits=[`${e.count} observation${e.count===1?'':'s'}`];
    if(e.spanHours>=20) confidenceBits.push(`${Math.round(e.spanHours)}h evidence span`);
    if(e.freshnessHours<=30) confidenceBits.push('recently refreshed');
    if(e.failures===0) confidenceBits.push('no current collection failures');
    const confidenceReason=`${round(confidence)}% confidence because we have ${confidenceBits.filter(Boolean).join(', ')}${relativeScore!=null?`, plus comparable-listing context`:''}.`;
    const plainReason=`${statusPlain}: ${whyParts.slice(0,4).join('; ') || 'waiting for stronger attention evidence'}.`;

    return {
      score:round(attention),confidence:round(confidence),label,
      price:b.price,views:b.views,views24h:b.views24h,watchers:b.watchers,bids:b.bids,currentBid:b.currentBid,startingPrice:b.startingPrice,
      velocity:b.velocity,overallVelocity:b.overallVelocity,previousVelocity:b.priorVelocity,
      accelerationScore:aScore,closeScore,hoursToClose:b.close?.hoursToClose??null,closeDate:b.close?.closeDate??null,
      relativeVelocity:relativeRatio==null?null:round(relativeRatio,2),peerMedianVelocity:peerMedian==null?null:round(peerMedian,2),peerCount:peerGroup.length,peerPositive,peerPositiveShare:round(peerPositiveShare,2),corroborated,
      observationCount:b.observationCount,evidenceScore:round(b.evidence),engagementScore:b.engagement==null?null:round(b.engagement),
      reason:plainReason,confidenceReason,
      components:Object.fromEntries(usable.map(([name,,score])=>[name,round(score)]))
    };
  });
}

export function computeListingSignal(listing:Listing, peers:Listing[]=[]){
  const all=[listing,...peers.filter(x=>x.id!==listing.id)];
  return computeListingSignals(all)[0];
}

function comparablePriceWeight(listing:any){
  const raw=Number(listing?.comparableMatch?.match_score);
  if(Number.isFinite(raw)){
    // Calibrated so ~98% match => 1.00, 91% => 0.82, 76% => 0.42.
    // Hard compatibility gates have already run in comparableMatcher; this only
    // controls how strongly an accepted comparable influences market pricing.
    return clamp((raw-.60)/.38,.25,1);
  }
  const method=String(listing?.comparableMatch?.match_method||'');
  if(method==='manual-accept')return .9;
  // Legacy/explicit product links without V3.9 provenance remain usable but do
  // not receive more weight than a high-confidence automatically matched peer.
  return .75;
}

function weightedQuantile(rows:{value:number,weight:number}[],q:number){
  if(!rows.length)return null;
  const sorted=[...rows].filter(x=>Number.isFinite(x.value)&&Number.isFinite(x.weight)&&x.weight>0).sort((a,b)=>a.value-b.value);
  if(!sorted.length)return null;
  const total=sorted.reduce((s,x)=>s+x.weight,0);
  const target=clamp(q,0,1)*total;
  let cumulative=0;
  for(const row of sorted){cumulative+=row.weight;if(cumulative>=target)return row.value;}
  return sorted.at(-1)!.value;
}

export function computeProductMetrics(product:any, listings:Listing[]){
  const active=listings.filter(x=>x.active);
  const latestByListing=active.map(l=>({listing:l,obs:chronological(l.observations||[]).at(-1)})).filter(x=>Boolean(x.obs)) as {listing:any,obs:Obs}[];
  const prices=latestByListing.map(x=>priceOf(x.obs)).filter((x):x is number=>typeof x==='number');
  const weightedPrices=latestByListing.map(x=>({value:priceOf(x.obs),weight:comparablePriceWeight(x.listing),score:Number(x.listing?.comparableMatch?.match_score)})).filter((x):x is {value:number,weight:number,score:number}=>typeof x.value==='number');
  const views=latestByListing.map(x=>x.obs.views).filter((x):x is number=>typeof x==='number');
  const velocities=active.map(l=>recentVelocity(l.observations)).filter((x):x is number=>x!=null);
  const sellers=new Set(active.map(x=>x.seller).filter(Boolean));
  const medPrice=median(prices);
  const weightedMarketPrice=weightedQuantile(weightedPrices,.50);
  const weightedLow=weightedQuantile(weightedPrices,.20);
  const weightedHigh=weightedQuantile(weightedPrices,.80);
  const medViews=median(views); const avgVelocity=velocities.length?velocities.reduce((a,b)=>a+b,0)/velocities.length:null;
  const evidence=Math.min(100, active.length*8 + Math.min(30,latestByListing.length*3) + Math.min(20,velocities.length*5));
  const demand=clamp(35 + Math.min(35,(avgVelocity||0)*8) + Math.min(20,(medViews||0)*.7) + Math.min(10,active.length));
  const competition=clamp(72 - Math.max(0,active.length-5)*4 + Math.min(18,sellers.size*3));
  const landed=Number(product.landed_cost_nzd ?? product.target_landed_cost_nzd ?? 0);
  const pricingAnchor=weightedMarketPrice ?? medPrice;
  const margin=pricingAnchor&&landed?clamp(((pricingAnchor-landed)/pricingAnchor)*115):50;
  const fitment=Number(product.fitment_score ?? 50);
  const supplier=Number(product.supplier_readiness_score ?? 20);
  const risk=Number(product.operational_risk_score ?? 25);
  const score=clamp(demand*.28+competition*.14+margin*.22+evidence*.16+fitment*.10+supplier*.10-risk*.08);
  const verdict=score>=80?'STRONG':score>=67?'PROMISING':score>=52?'WATCH':'WEAK';
  const suggested=pricingAnchor?round(pricingAnchor*.86,2):null;
  const floor=landed?round(landed/Math.max(.25,1-Number(product.marketplace_fee_pct||0)/100-.35),2):null;
  const pricedComparableCount=weightedPrices.length;
  const similarityScoredPriceCount=weightedPrices.filter(x=>Number.isFinite(x.score)).length;
  return {
    listingCount:active.length,sellerCount:sellers.size,
    medianPrice:medPrice,weightedMarketPrice:weightedMarketPrice==null?null:round(weightedMarketPrice,2),
    weightedPriceRange:weightedLow==null||weightedHigh==null?null:{min:round(weightedLow,2),max:round(weightedHigh,2)},
    pricingMethod:'similarity-weighted robust market',pricedComparableCount,similarityScoredPriceCount,
    medianViews:medViews,avgViewVelocity:avgVelocity==null?null:round(avgVelocity,2),
    demand:round(demand),competition:round(competition),margin:round(margin),confidence:round(evidence),fitment:round(fitment),supplier:round(supplier),risk:round(risk),score:round(score),verdict,
    suggestedPrice:suggested,priceFloor:floor,priceRange:prices.length?{min:Math.min(...prices),max:Math.max(...prices)}:null
  };
}
