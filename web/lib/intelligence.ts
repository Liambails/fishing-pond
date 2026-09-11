import {buildIdf,genericListingSimilarity,listingDocument} from './genericSimilarity';
export type Obs = {
  captured_at?:string;
  views?:number|null;
  watchers?:number|null;
  bids?:number|null;
  asking_price_nzd?:number|null;
  buy_now_nzd?:number|null;
  current_bid_nzd?:number|null;
  sold_price_nzd?:number|null;
  starting_price_nzd?:number|null;
  close_date?:string|null;
  close_remaining?:string|null;
  question_count?:number|null; purchase_intent_questions?:number|null; compatibility_questions?:number|null; condition_questions?:number|null;
  buy_now_available?:boolean|null; offer_available?:boolean|null; stock_quantity?:number|null; listing_status?:string|null; sold_detected?:boolean|null;
  q_and_a?:any; qa_identity_codes?:any;
  lifecycle_episode?:number|null;
};

export type AcquisitionEvent = {occurred_at?:string|null;operation?:string|null;source?:string|null;status?:string|null;diagnostics?:any};

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
  acquisition_events?:AcquisitionEvent[];
  lifecycle_episode?:number|null;
  lifecycle_state?:string|null;
};

const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const median=(xs:number[])=>{ if(!xs.length)return null; const a=[...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const round=(n:number,d=1)=>Number(n.toFixed(d));
const DAY=86400000;
const HOUR=3600000;
const MIN_INDEPENDENT_GAP_HOURS=3;
const FULL_VELOCITY_TRUST_HOURS=12;
function behaviouralIntentScore(o?:Obs|null){
  if(!o)return null;
  const has=[o.watchers,o.bids,o.question_count,o.purchase_intent_questions,o.sold_detected].some(v=>v!==null&&v!==undefined);
  if(!has)return null;
  const watchers=Math.min(32,Math.max(0,Number(o.watchers||0))*5.5);
  const bids=Math.min(42,Math.max(0,Number(o.bids||0))*14);
  const purchaseQs=Math.min(30,Math.max(0,Number(o.purchase_intent_questions||0))*10);
  const otherQs=Math.min(14,Math.max(0,Number(o.question_count||0)-Number(o.purchase_intent_questions||0))*3.5);
  const sold=o.sold_detected?100:0;
  return clamp(sold?Math.max(88,watchers+bids+purchaseQs+otherQs):watchers+bids+purchaseQs+otherQs);
}
function qaSummary(o?:Obs|null){
  const total=Math.max(0,Number(o?.question_count||0));
  const purchase=Math.max(0,Number(o?.purchase_intent_questions||0));
  const compatibility=Math.max(0,Number(o?.compatibility_questions||0));
  const condition=Math.max(0,Number(o?.condition_questions||0));
  return {total,purchase,compatibility,condition,identityCodes:Array.isArray(o?.qa_identity_codes)?o!.qa_identity_codes:[]};
}
export function priceOf(o:Obs){ return o.sold_price_nzd ?? o.buy_now_nzd ?? o.asking_price_nzd ?? o.current_bid_nzd ?? null; }

function chronological(obs:Obs[]=[]){
  return [...obs].filter(x=>x.captured_at).sort((a,b)=>Date.parse(a.captured_at!)-Date.parse(b.captured_at!));
}
function observerEvents(events:AcquisitionEvent[]=[]){return [...events].filter((e:any)=>Boolean(e?.occurred_at)&&String(e?.operation||'')==='listing_detail'&&String(e?.status||'')==='success'&&String(e?.source||'').toLowerCase()==='playwright'&&e?.diagnostics?.observer_view_candidate===true)}
function observerVisitsBetween(events:AcquisitionEvent[]=[],start?:string|null,end?:string|null){if(!start||!end)return 0;const a=Date.parse(start),b=Date.parse(end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return 0;return observerEvents(events).filter((e:any)=>{const t=Date.parse(String(e.occurred_at||''));return Number.isFinite(t)&&t>a&&t<=b}).length}
function correctedViewDelta(a?:Obs,b?:Obs,events:AcquisitionEvent[]=[]){if(!a?.captured_at||!b?.captured_at||a.views==null||b.views==null)return null;const raw=Number(b.views)-Number(a.views);if(!Number.isFinite(raw)||raw<0)return null;const observer=observerVisitsBetween(events,a.captured_at,b.captured_at);return {rawDelta:raw,possibleObserverViews:observer,correctedDelta:Math.max(0,raw-Math.min(raw,observer))}}
function independentViewObservations(obs:Obs[]=[]){
  const a=chronological(obs).filter(x=>x.views!=null);
  if(a.length<=1)return a;
  // Work backwards so the freshest capture always wins. Any earlier capture less than
  // three hours away is still retained in history, but it is not a separate evidence
  // window for velocity/confidence. This prevents manual refresh bursts from turning
  // a tiny time slice into an exaggerated daily pace.
  const selected:Obs[]=[a[a.length-1]];
  let newestSelected=Date.parse(a[a.length-1].captured_at!);
  for(let i=a.length-2;i>=0;i--){
    const t=Date.parse(a[i].captured_at!);
    if((newestSelected-t)/HOUR>=MIN_INDEPENDENT_GAP_HOURS){
      selected.push(a[i]);
      newestSelected=t;
    }
  }
  return selected.reverse();
}

function intervalVelocityInfo(a?:Obs,b?:Obs,events:AcquisitionEvent[]=[]){
  if(!a?.captured_at||!b?.captured_at||a.views==null||b.views==null)return null;
  const hours=(Date.parse(b.captured_at)-Date.parse(a.captured_at))/HOUR;if(hours<=0)return null;
  const info=correctedViewDelta(a,b,events);if(!info)return null;const rawVelocity=info.correctedDelta/(hours/24);const marketplaceRawVelocity=info.rawDelta/(hours/24);
  const trust=hours>=FULL_VELOCITY_TRUST_HOURS?1:clamp(.35+.65*((hours-MIN_INDEPENDENT_GAP_HOURS)/(FULL_VELOCITY_TRUST_HOURS-MIN_INDEPENDENT_GAP_HOURS)),.35,1);
  return {velocity:round(rawVelocity*trust,2),rawVelocity:round(rawVelocity,2),marketplaceRawVelocity:round(marketplaceRawVelocity,2),hours:round(hours,2),trust:round(trust,2),delta:info.correctedDelta,rawViewDelta:info.rawDelta,possibleObserverViews:info.possibleObserverViews};
}
function intervalVelocity(a?:Obs,b?:Obs,events:AcquisitionEvent[]=[]){return intervalVelocityInfo(a,b,events)?.velocity??null}
export function listingVelocity(obs:Obs[]=[],events:AcquisitionEvent[]=[]){const a=independentViewObservations(obs);if(a.length<2)return null;return intervalVelocity(a[0],a[a.length-1],events)}
export function recentVelocity(obs:Obs[]=[],events:AcquisitionEvent[]=[]){const a=independentViewObservations(obs);if(a.length<2)return null;return intervalVelocity(a[a.length-2],a[a.length-1],events)}
export function previousVelocity(obs:Obs[]=[],events:AcquisitionEvent[]=[]){const a=independentViewObservations(obs);if(a.length<3)return null;return intervalVelocity(a[a.length-3],a[a.length-2],events)}
function viewsLast24Hours(obs:Obs[]=[],events:AcquisitionEvent[]=[]){const a=chronological(obs).filter(x=>x.views!=null);if(a.length<2)return null;const latest=a[a.length-1],cutoff=Date.parse(latest.captured_at!)-DAY;const candidates=a.slice(0,-1).filter(x=>Date.parse(x.captured_at!)<=cutoff+4*3600000);if(!candidates.length)return null;const base=candidates.reduce((best,x)=>Math.abs(Date.parse(x.captured_at!)-cutoff)<Math.abs(Date.parse(best.captured_at!)-cutoff)?x:best,candidates[0]);return correctedViewDelta(base,latest,events)?.correctedDelta??null}

function evidenceDetails(listing:Listing,obs:Obs[]){
  const independent=independentViewObservations(obs);
  const count=obs.length;
  const independentCount=independent.length;
  const spanHours=independentCount>=2?(Date.parse(independent[independentCount-1].captured_at||'')-Date.parse(independent[0].captured_at||''))/HOUR:0;
  const freshnessHours=listing.last_observed_at?Math.max(0,(Date.now()-Date.parse(listing.last_observed_at))/HOUR):999;
  const failures=Number(listing.consecutive_failures||0);
  return {count,independentCount,compressedCount:Math.max(0,count-independentCount),spanHours:round(Math.max(0,spanHours),1),freshnessHours:round(freshnessHours,1),failures};
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
  const independent=independentViewObservations(obs);
  const count=independent.length;
  const spanHours=count>=2?(Date.parse(independent[count-1].captured_at||'')-Date.parse(independent[0].captured_at||''))/HOUR:0;
  const freshnessHours=listing.last_observed_at?Math.max(0,(Date.now()-Date.parse(listing.last_observed_at))/HOUR):999;
  const failures=Number(listing.consecutive_failures||0);
  // Independent evidence deliberately grows more slowly than the old raw-count formula.
  // Four captures are useful, but they should not imply near-certainty when two happened
  // within the same short observation window.
  const countScore=count<=0?0:count===1?18:count===2?36:count===3?54:count===4?68:count===5?78:84;
  const spanScore=Math.min(10,Math.max(0,spanHours)/48*10);
  const freshnessBonus=freshnessHours<30?8:freshnessHours<54?4:0;
  return clamp(countScore+spanScore+freshnessBonus-failures*12);
}
function engagementScore(latest?:Obs){
  return behaviouralIntentScore(latest||null);
}

export function comparableKey(listing:Listing){
  // Legacy/export helper only. Peer corroboration no longer groups by vehicle-specific keys;
  // it uses category-agnostic TF-IDF similarity below.
  const category=(listing.metadata?.category_path||[]);
  const categoryText=Array.isArray(category)?category.join('>'):String(category||'');
  return `${categoryText}|${listingDocument(listing)}`;
}

function baseSignal(listing:Listing){
  const allObs=chronological(listing.observations||[]);
  const episode=Number(listing.lifecycle_episode||1);
  // A relist is a fresh measurement episode. Never calculate current velocity/evidence across a
  // marketplace counter reset (for example 27 views on episode 1 -> 2 views on episode 2).
  const episodeObs=allObs.filter((o:any)=>Number(o?.lifecycle_episode||1)===episode);
  const obs=episodeObs.length?episodeObs:allObs;
  const latest=obs[obs.length-1];
  const views=Number(latest?.views ?? 0);
  const watchers=latest?.watchers==null?null:Number(latest.watchers);
  const bids=latest?.bids==null?null:Number(latest.bids);
  const currentBid=latest?.current_bid_nzd==null?null:Number(latest.current_bid_nzd);
  const startingPrice=latest?.starting_price_nzd==null?null:Number(latest.starting_price_nzd);
  const independentObs=independentViewObservations(obs);
  const viewObs=obs.filter((o:any)=>o?.views!=null&&Number.isFinite(Number(o.views)));
  const watcherObs=obs.filter((o:any)=>o?.watchers!=null&&Number.isFinite(Number(o.watchers)));
  const bidObs=obs.filter((o:any)=>o?.bids!=null&&Number.isFinite(Number(o.bids)));
  const lastWatcherChange=watcherObs.length>=2?Math.max(0,Number(watcherObs.at(-1)!.watchers)-Number(watcherObs.at(-2)!.watchers)):null;
  const lastBidChange=bidObs.length>=2?Math.max(0,Number(bidObs.at(-1)!.bids)-Number(bidObs.at(-2)!.bids)):null;
  const acquisitionEvents=listing.acquisition_events||[];
  const lastViewDeltaInfo=viewObs.length>=2?correctedViewDelta(viewObs[viewObs.length-2],viewObs[viewObs.length-1],acquisitionEvents):null;
  const lastViewChange=lastViewDeltaInfo?.correctedDelta??null;
  const lastViewChangeHours=viewObs.length>=2?Math.max(0,(Date.parse(String(viewObs[viewObs.length-1].captured_at))-Date.parse(String(viewObs[viewObs.length-2].captured_at)))/3600000):null;
  const recentInfo=independentObs.length>=2?intervalVelocityInfo(independentObs[independentObs.length-2],independentObs[independentObs.length-1],acquisitionEvents):null;
  const velocity=recentInfo?.velocity??null;
  const priorVelocity=independentObs.length>=3?intervalVelocity(independentObs[independentObs.length-3],independentObs[independentObs.length-2],acquisitionEvents):null;
  const overallVelocity=listingVelocity(obs,acquisitionEvents);
  const latestPricedObs=[...obs].reverse().find((o:any)=>priceOf(o)!=null)||null;
  const price=latestPricedObs?priceOf(latestPricedObs):null;
  const priceCapturedAt=latestPricedObs?.captured_at||null;
  const priceIsLatest=Boolean(latestPricedObs&&latest&&String(latestPricedObs.captured_at)===String(latest.captured_at));
  const observationCount=obs.length;
  const independentObservationCount=independentObs.length;
  const evidence=evidenceScore(listing,obs);
  const engagement=engagementScore(latest);
  const close=validCloseDate(latest);
  const views24h=viewsLast24Hours(obs,acquisitionEvents);
  const evidenceDetailsValue=evidenceDetails(listing,obs);
  const qas=qaSummary(latest);
  return {obs,latest,views,watchers,bids,lastWatcherChange,lastBidChange,currentBid,startingPrice,velocity,priorVelocity,overallVelocity,price,priceCapturedAt,priceIsLatest,observationCount,independentObservationCount,lastViewChange:lastViewChange!=null&&lastViewChange>=0?lastViewChange:null,lastViewChangeHours,velocityIntervalHours:recentInfo?.hours??null,velocityTrust:recentInfo?.trust??null,rawRecentVelocity:recentInfo?.rawVelocity??null,marketplaceRawRecentVelocity:recentInfo?.marketplaceRawVelocity??null,rawLastViewChange:lastViewDeltaInfo?.rawDelta??null,possibleObserverViewsLastInterval:lastViewDeltaInfo?.possibleObserverViews??0,evidence,engagement,close,views24h,evidenceDetails:evidenceDetailsValue,qas,soldDetected:Boolean(latest?.sold_detected),soldPrice:latest?.sold_price_nzd==null?null:Number(latest.sold_price_nzd)};
}

export function computeListingSignals(listings:Listing[]){
  const bases=listings.map(l=>({listing:l,...baseSignal(l)}));
  const idf=buildIdf(bases.map(b=>listingDocument(b.listing)));

  return bases.map(b=>{
    const isOwn=b.listing.metadata?.ownership==='own';
    const peerGroup=bases.filter(x=>{
      if(x.listing.id===b.listing.id||x.velocity==null||(!isOwn&&x.listing.metadata?.ownership==='own'))return false;
      const similarity=genericListingSimilarity(b.listing,x.listing,idf);
      return similarity.score>=.64&&similarity.cosine>=.52&&(similarity.category>=.25||similarity.identifierOverlap);
    });
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
    const confidence=clamp(b.evidence + (relativeScore!=null?8:0) + (b.close?5:0),0,99);

    const peerPositive=peerGroup.filter(x=>(x.velocity||0)>=2).length;
    const peerPositiveShare=peerGroup.length?peerPositive/peerGroup.length:0;
    const corroborated=peerGroup.length>=2&&peerPositiveShare>=.5;
    const spanReady=b.evidenceDetails.spanHours>=20;
    const earlyStrong=b.independentObservationCount===2&&attention>=72&&b.velocity!=null;
    // GOOD requires repeated, temporally independent confirmation. Raw captures that land
    // inside the same <3h window remain visible history but cannot unlock stronger labels.
    const goodEvidenceReady=b.independentObservationCount>=4&&spanReady&&confidence>=55;
    const standaloneConfirmed=b.independentObservationCount>=4&&b.velocity!=null&&b.velocity>=6&&(b.velocityIntervalHours??0)>=FULL_VELOCITY_TRUST_HOURS;
    const corroboratedConfirmed=corroborated&&(b.velocityIntervalHours??0)>=6;

    let label='TOO EARLY';
    if(b.independentObservationCount>=2&&b.velocity!=null&&confidence>=42){
      if(attention>=88&&confidence>=80&&b.independentObservationCount>=4&&b.evidenceDetails.spanHours>=30&&corroboratedConfirmed&&(b.velocityIntervalHours??0)>=FULL_VELOCITY_TRUST_HOURS)label='MUST_HAVE';
      else if(attention>=72&&goodEvidenceReady&&(corroboratedConfirmed||standaloneConfirmed))label='GOOD';
      else if(attention>=50||earlyStrong)label='WATCHING';
      else label='LOW SIGNAL';
    }

    const statusPlain=label==='GOOD'?'Repeated marketplace attention is now strong enough to investigate':label==='WATCHING'?'Interest is developing, but COBALT is not ready to recommend sourcing it yet':label==='LOW SIGNAL'?'We have enough checks to see that attention is currently weak':label==='TOO EARLY'?'COBALT needs more checks before judging this listing':'Exceptional marketplace attention with repeated support from similar listings';
    const whyParts:string[]=[];
    // Explain the strongest evidence that actually exists. Buyer behaviour outranks another
    // repetitive view sentence; null counters are described as unavailable, never as zero.
    if(b.soldDetected) whyParts.push('Trade Me indicates this listing sold');
    if((b.lastBidChange??0)>0) whyParts.push(`bidding increased by ${b.lastBidChange} to ${b.bids} bid${b.bids===1?'':'s'}`);
    else if((b.bids??0)>0) whyParts.push(`${b.bids} bid${b.bids===1?'':'s'} show direct buyer activity`);
    if((b.lastWatcherChange??0)>0) whyParts.push(`${b.lastWatcherChange} new watchlist${b.lastWatcherChange===1?'':'s'} since the prior readable count (${b.watchers} total)`);
    else if((b.watchers??0)>0) whyParts.push(`${b.watchers} people have watchlisted it`);
    if((b.qas?.purchase||0)>0) whyParts.push(`${b.qas.purchase} public question${b.qas.purchase===1?'':'s'} suggest purchase intent`);
    else if((b.qas?.compatibility||0)>0) whyParts.push(`${b.qas.compatibility} buyer question${b.qas.compatibility===1?' checks':'s check'} compatibility`);
    if(corroborated) whyParts.push(`${peerPositive} of ${peerGroup.length} similar listings are also gaining attention`);
    else if(relativeRatio!=null&&relativeRatio>=1.4) whyParts.push('attention is rising faster than most similar listings');
    if((b.lastViewChange??0)>0 && whyParts.length<3) whyParts.push(`+${b.lastViewChange} view${b.lastViewChange===1?'':'s'} since the last check`);
    if(b.views24h!=null&&b.views24h!==0&&whyParts.length<3) whyParts.push(`${b.views24h>0?'+':''}${b.views24h} view${Math.abs(b.views24h)===1?'':'s'} in the last 24 hours`);
    if(label==='TOO EARLY'&&whyParts.length<2) whyParts.push(`only ${b.independentObservationCount} reliable check${b.independentObservationCount===1?'':'s'} so far`);
    if(label==='WATCHING'&&!whyParts.length&&b.velocity!=null) whyParts.push('attention is still arriving, but the pattern is not strong enough yet');
    if(label==='LOW SIGNAL'&&!whyParts.length) whyParts.push('recent checks are not showing much new attention');
    if(Number(b.listing.consecutive_failures||0)>0&&whyParts.length<4) whyParts.push(`collection has failed ${b.listing.consecutive_failures} time${b.listing.consecutive_failures===1?'':'s'} recently`);
    const plainReason=`${statusPlain}${whyParts.length?`: ${whyParts.slice(0,4).join('; ')}`:''}.`;
    const e=b.evidenceDetails;
    const confidenceReason=`COBALT has ${e.independentCount} reliable check${e.independentCount===1?'':'s'} across about ${Math.max(1,Math.round(e.spanHours))} hours${e.failures?`, with ${e.failures} recent collection failure${e.failures===1?'':'s'}`:''}.`;

    return {
      score:round(attention),confidence:round(confidence),label,
      price:b.price,priceCapturedAt:b.priceCapturedAt,priceIsLatest:b.priceIsLatest,views:b.views,views24h:b.views24h,watchers:b.watchers,bids:b.bids,watcherChange:b.lastWatcherChange,bidChange:b.lastBidChange,currentBid:b.currentBid,startingPrice:b.startingPrice,
      velocity:b.velocity,overallVelocity:b.overallVelocity,previousVelocity:b.priorVelocity,
      accelerationScore:aScore,closeScore,hoursToClose:b.close?.hoursToClose??null,closeDate:b.close?.closeDate??null,
      relativeVelocity:relativeRatio==null?null:round(relativeRatio,2),peerMedianVelocity:peerMedian==null?null:round(peerMedian,2),peerCount:peerGroup.length,peerPositive,peerPositiveShare:round(peerPositiveShare,2),corroborated,
      observationCount:b.observationCount,independentObservationCount:b.independentObservationCount,compressedObservationCount:b.evidenceDetails.compressedCount,lastViewChange:b.lastViewChange,lastViewChangeHours:b.lastViewChangeHours,velocityIntervalHours:b.velocityIntervalHours,velocityTrust:b.velocityTrust,rawRecentVelocity:b.rawRecentVelocity,marketplaceRawRecentVelocity:b.marketplaceRawRecentVelocity,rawLastViewChange:b.rawLastViewChange,possibleObserverViewsLastInterval:b.possibleObserverViewsLastInterval,evidenceScore:round(b.evidence),engagementScore:b.engagement==null?null:round(b.engagement),questionCount:b.qas?.total||0,purchaseIntentQuestions:b.qas?.purchase||0,compatibilityQuestions:b.qas?.compatibility||0,conditionQuestions:b.qas?.condition||0,qaIdentityCodes:b.qas?.identityCodes||[],soldDetected:b.soldDetected,
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
  const soldHistory=listings.filter(x=>!x.active).map(l=>({listing:l,obs:chronological(l.observations||[]).at(-1)})).filter((x:any)=>Boolean(x.obs?.sold_detected)) as {listing:any,obs:Obs}[];
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
  const intentEvidence=[...latestByListing,...soldHistory];
  const intentScores=intentEvidence.map(x=>behaviouralIntentScore(x.obs)).filter((x):x is number=>typeof x==='number');
  const buyerIntent=median(intentScores); const soldConfirmations=soldHistory.length+latestByListing.filter(x=>x.obs.sold_detected).length;
  const purchaseIntentQuestions=intentEvidence.reduce((n,x)=>n+Number(x.obs.purchase_intent_questions||0),0);
  const evidence=Math.min(100, active.length*8 + Math.min(30,latestByListing.length*3) + Math.min(20,velocities.length*5));
  const demand=clamp(28 + Math.min(32,(avgVelocity||0)*7) + Math.min(14,(medViews||0)*.5) + Math.min(8,active.length) + Math.min(12,(buyerIntent||0)*.12) + Math.min(6,purchaseIntentQuestions*1.5) + Math.min(12,soldConfirmations*6));
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
    medianViews:medViews,avgViewVelocity:avgVelocity==null?null:round(avgVelocity,2),buyerIntentScore:buyerIntent==null?null:round(buyerIntent),purchaseIntentQuestions,soldConfirmations,
    demand:round(demand),competition:round(competition),margin:round(margin),confidence:round(evidence),fitment:round(fitment),supplier:round(supplier),risk:round(risk),score:round(score),verdict,
    suggestedPrice:suggested,priceFloor:floor,priceRange:prices.length?{min:Math.min(...prices),max:Math.max(...prices)}:null
  };
}
