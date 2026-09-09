import {fetchPaged} from './pagedQuery';
import {computeListingSignals} from './intelligence';
import {buildIdf,genericListingSimilarity,listingDocument} from './genericSimilarity';

const STOP=new Set('for with and the a an to of in on from fits fit compatible replacement genuine oem new used part parts car vehicle right left front rear set pair single power master electric electrical'.split(' '));
const MAKES=['toyota','holden','isuzu','mitsubishi','suzuki','honda','ford','mazda','nissan','subaru','hyundai','kia','bmw','mercedes','audi','volkswagen','vw','jeep','lexus','tesla'];
const MODELS=['vitz','yaris','aqua','prius','corolla','camry','rav4','rav 4','hiace','landcruiser','land cruiser','swift','outlander','colorado','dmax','d-max','jazz','fit'];
const PRODUCT_PATTERNS:[RegExp,string][]=[
 [/master\s+(?:power\s+)?window\s+switch/i,'Master power window switch'],
 [/(?:power\s+)?window\s+switch/i,'Power window switch'],
 [/combination\s+switch/i,'Combination switch'],
 [/ignition(?:\s+switch)?(?:\s+with\s+key)?/i,'Ignition with key'],
 [/wheel\s+speed\s+sensor|abs\s+sensor/i,'ABS wheel speed sensor'],
 [/head\s*light|headlamp/i,'Headlight'],[/tail\s*light|taillight/i,'Tail light'],
 [/door\s+mirror|wing\s+mirror|side\s+mirror/i,'Door mirror'],[/mirror\s+adjust/i,'Mirror adjuster'],
 [/door\s+handle/i,'Door handle'],[/wiper\s+switch/i,'Wiper switch'],[/boot|tailgate/i,'Boot / tailgate part'],
 [/barbie/i,'Barbie doll'],[/doll/i,'Doll'],[/laptop|notebook/i,'Laptop'],[/phone|iphone|galaxy/i,'Phone']
];

function norm(s:any){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function tokens(s:any){return [...new Set(norm(s).split(/\s+/).filter(x=>x.length>2&&!STOP.has(x)&&!/^20\d\d$/.test(x)))]}
function median(a:number[]){if(!a.length)return null;const x=[...a].sort((m,n)=>m-n);const i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2}
function latestObs(l:any){return [...(l.observations||[])].sort((a:any,b:any)=>Date.parse(b.captured_at)-Date.parse(a.captured_at))[0]||null}
function latestPrice(l:any){for(const o of [...(l.observations||[])].sort((a:any,b:any)=>Date.parse(b.captured_at)-Date.parse(a.captured_at))){const p=o?.buy_now_nzd??o?.asking_price_nzd??o?.starting_price_nzd??o?.current_bid_nzd??null;if(p!=null&&Number.isFinite(Number(p)))return Number(p)}return null}
function observedAgeHours(l:any){const latest=latestObs(l);const end=Date.parse(latest?.captured_at||l.last_observed_at||l.last_seen||'');const start=Date.parse(l.first_seen||l.created_at||'');if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;return Math.max(0,(end-start)/3600000)}
function categoryOf(l:any){const p=l?.metadata?.category_path;return Array.isArray(p)?p.join(' > '):String(p||'Marketplace')}
function modelOf(title:string){const n=norm(title);return MODELS.find(m=>n.includes(m.replace(' ',' ')))||null}
function makeOf(title:string){const n=norm(title);return MAKES.find(m=>n.includes(m))||null}
function productTypeOf(title:string){for(const [r,name] of PRODUCT_PATTERNS)if(r.test(title))return name;const ts=tokens(title);return ts.slice(-3).join(' ')||'Marketplace product'}
function chassisCodes(text:string){return [...new Set((String(text||'').toUpperCase().match(/\b[A-Z]{1,4}\d{1,4}[A-Z]{0,2}\b/g)||[]).filter(x=>!/^(?:NZD|USD|AUD)$/.test(x)&&!/^20\d\d$/.test(x)).slice(0,12))]}
function partNumbers(l:any){const vals:any[]=[];for(const o of l.observations||[]){if(o?.part_number)vals.push(o.part_number);if(Array.isArray(o?.part_number_candidates))vals.push(...o.part_number_candidates);const raw=o?.raw_snapshot;if(raw?.part_number)vals.push(raw.part_number);if(Array.isArray(raw?.part_number_candidates))vals.push(...raw.part_number_candidates)}return [...new Set(vals.map(v=>String(v).trim()).filter(Boolean))].slice(0,12)}
function jaccard(a:string[],b:string[]){const A=new Set(a),B=new Set(b);const inter=[...A].filter(x=>B.has(x)).length;const union=new Set([...A,...B]).size;return union?inter/union:0}

export function deriveOpportunityIdentity(l:any){
 const title=String(l.title||''); const latest=latestObs(l)||{}; const cat=categoryOf(l);
 const auto=/motors|car-parts|vehicle/i.test(cat)||Boolean(makeOf(title)||latest.vehicle||latest.chassis);
 const make=makeOf(title)||null; const model=modelOf(title)||null; const productType=productTypeOf(title);
 const qaCodes:string[]=[...new Set<string>((latest.qa_identity_codes||latest.raw_snapshot?.qa_identity_codes||[]).map((x:any)=>String(x).toUpperCase()).filter(Boolean))].slice(0,12);
 const chassis:string[]=[...new Set<string>([...(latest.chassis?[String(latest.chassis).toUpperCase()]:[]),...chassisCodes(`${title} ${latest.vehicle||''} ${latest.years||''}`),...qaCodes.filter((x:string)=>/^[A-Z]{1,4}\d{1,4}[A-Z]{0,2}$/.test(x))])].slice(0,8);
 const pns:string[]=partNumbers(l);
 return {domain:auto?'Automotive parts':cat.split(' > ').slice(0,2).join(' > ')||'Marketplace',category:cat,make,model,product_type:productType,chassis_codes:chassis,part_numbers:pns,qa_identity_codes:qaCodes,title_tokens:tokens(title)};
}

function pairSimilarity(a:any,b:any){
 const A=deriveOpportunityIdentity(a),B=deriveOpportunityIdentity(b);
 if(A.domain!==B.domain && A.category!==B.category)return 0;
 let s=jaccard(A.title_tokens,B.title_tokens)*0.45;
 if(A.product_type&&B.product_type&&norm(A.product_type)===norm(B.product_type))s+=0.28;
 if(A.model&&B.model&&A.model===B.model)s+=0.20;
 if(A.make&&B.make&&A.make===B.make)s+=0.08;
 if(A.chassis_codes.some((x:string)=>B.chassis_codes.includes(x)))s+=0.22;
 if(A.part_numbers.some((x:string)=>B.part_numbers.includes(x)))s+=0.35;
 if(A.qa_identity_codes?.some((x:string)=>B.qa_identity_codes?.includes(x)))s+=0.12;
 return Math.min(1,s);
}

function unionClusters(rows:any[]){
 const p=rows.map((_:any,i:number)=>i); const find=(x:number):number=>p[x]===x?x:(p[x]=find(p[x])); const join=(a:number,b:number)=>{a=find(a);b=find(b);if(a!==b)p[b]=a};
 const idf=buildIdf(rows.map((r:any)=>listingDocument(r)));
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const sim=genericListingSimilarity(rows[i],rows[j],idf);
  // Category-agnostic family grouping. Strong semantic similarity is required, with
  // category or identifier support where available so generic terms do not form giant clusters.
  const sameFamily=(sim.score>=.56&&sim.cosine>=.48&&(sim.category>=.20||sim.identifierOverlap))||(sim.cosine>=.82&&sim.tokenOverlap>=.48);
  if(sameFamily)join(i,j);
 }
 const groups=new Map<number,any[]>();rows.forEach((r,i)=>{const k=find(i);groups.set(k,[...(groups.get(k)||[]),r])});return [...groups.values()];
}
function familyIdentity(group:any[]){
 const ids=group.map(deriveOpportunityIdentity); const freq=(vals:any[])=>{const m=new Map<string,number>();vals.filter(Boolean).forEach(v=>m.set(String(v),1+(m.get(String(v))||0)));return [...m.entries()].sort((a,b)=>b[1]-a[1])};
 const make=freq(ids.map(x=>x.make))[0]?.[0]||null, model=freq(ids.map(x=>x.model))[0]?.[0]||null, product=freq(ids.map(x=>x.product_type))[0]?.[0]||'Marketplace product';
 const chassis=freq(ids.flatMap(x=>x.chassis_codes)).slice(0,6).map(([v,count])=>({value:v,count})); const parts=freq(ids.flatMap(x=>x.part_numbers)).slice(0,8).map(([v,count])=>({value:v,count}));
 const title=[make,model,product].filter(Boolean).join(' ').replace(/\b\w/g,c=>c.toUpperCase());
 const identityConfidence=Math.min(96,Math.round(50+(group.length>=5?12:6)+(model?10:0)+(product?8:0)+(chassis[0]?.count>=2?8:0)+(parts[0]?.count>=2?8:0)));
 const qaCodes=freq(ids.flatMap(x=>x.qa_identity_codes||[])).slice(0,8).map(([v,count])=>({value:v,count}));
 return {title,identity:{domain:ids[0]?.domain||'Marketplace',category:ids[0]?.category||'Marketplace',make,model,product_type:product,chassis_codes:chassis,part_numbers:parts,qa_identity_codes:qaCodes},identityConfidence};
}
function familyKey(group:any[]){const f=familyIdentity(group);const mainCode=f.identity.chassis_codes?.[0]?.value||'';return norm(`${f.identity.domain}|${f.identity.make||''}|${f.identity.model||''}|${mainCode}|${f.identity.product_type}`)}

function standaloneKey(l:any){return `standalone:${String(l.id)}`}
function standaloneTitle(l:any){
 const i=deriveOpportunityIdentity(l);
 const composed=[i.make,i.model,i.product_type].filter(Boolean).join(' ').replace(/\b\w/g,c=>c.toUpperCase());
 return composed||String(l.title||'Standalone marketplace product');
}
export function classifyStandaloneOpportunity(s:any){
 const independent=Number(s.independentObservationCount||0); const span=Number(s.evidenceDetails?.spanHours||s.spanHours||0);
 const velocity=Number(s.velocity||0); const interval=Number(s.velocityIntervalHours||0); const confidence=Number(s.confidence||0); const intent=Number(s.engagementScore||0);
 const watchers=Number(s.watchers||0); const bids=Number(s.bids||0); const purchaseQs=Number(s.purchaseIntentQuestions||0); const sold=Boolean(s.soldDetected);
 const views24=Number(s.views24h||0); const lastDelta=Number(s.lastViewChange||0);
 const buyerIntent=sold||bids>=1||watchers>=2||purchaseQs>=1||intent>=50;
 // V3.9.22: a sparse-but-well-spaced pair of checks can create an EARLY lead when the
 // movement is unmistakable. This is intentionally not enough for STRONG/SOURCE_NOW.
 const sparseEarly=independent>=2&&span>=8&&interval>=8&&confidence>=34&&lastDelta>=5&&velocity>=9;
 const normalEarly=independent>=3&&span>=10&&interval>=6&&confidence>=44&&(views24>=4||velocity>=5||lastDelta>=3)&&(buyerIntent||velocity>=7||views24>=6);
 const qualifies=sparseEarly||normalEarly;
 if(!qualifies)return {qualifies:false};
 const demandScore=Math.min(100,Math.round(Math.min(38,Math.max(0,views24)*3.5)+Math.min(26,Math.max(0,velocity)*2.1)+Math.min(18,intent*.28)+Math.min(10,watchers*2)+Math.min(10,bids*5)+Math.min(8,purchaseQs*3)+(sold?12:0)));
 const strong=independent>=3&&span>=16&&interval>=8&&demandScore>=52&&(views24>=8||velocity>=8||lastDelta>=5)&&(buyerIntent||independent>=4||velocity>=10);
 const sourceNow=independent>=4&&span>=24&&interval>=10&&demandScore>=62&&(views24>=14||velocity>=12)&&(sold||bids>=2||purchaseQs>=2||views24>=18||velocity>=15);
 const sourcingStage=sourceNow?'SOURCE_NOW':strong?'STRONG_LEAD':'EARLY_LEAD';
 return {qualifies:true,strength:sourcingStage==='EARLY_LEAD'?'EMERGING':'STRONG',sourcingStage,demandScore,independent,span,velocity,interval,confidence,intent,watchers,bids,purchaseQs,sold,views24,lastDelta,sparseEarly};
}
function standaloneQualification(l:any){return classifyStandaloneOpportunity(l.signal||{})}

export function classifyFamilyOpportunity(x:any){
 const positive=Number(x.positive||0),mature=Number(x.mature||0),span=Number(x.span||0),medianPace=Number(x.medianPace||0),total24=Number(x.total24||0),max24=Number(x.max24||0),demand=Number(x.demand||0);
 const watchers=Number(x.watchers||0),bids=Number(x.bids||0),purchaseQs=Number(x.purchaseQs||0),sold=Number(x.sold||0),medianAge=Number(x.medianAge||span),medianIndependent=Number(x.medianIndependent||0);
 if(positive<2||span<6||medianAge<6||(medianPace<1.25&&total24<4))return null;
 let stage:'EARLY_LEAD'|'STRONG_LEAD'|'SOURCE_NOW'='EARLY_LEAD';
 const buyerSignals=(watchers>=2?1:0)+bids+purchaseQs+sold;
 // Two corroborating listings can become STRONG with only two independent captures each
 // when those captures are well spaced and the family is moving quickly. Otherwise we wait
 // for three independent windows on both listings. This trades raw count for time + corroboration.
 const matureTwo=positive>=2&&mature>=2&&span>=12&&medianAge>=10&&demand>=45&&(medianPace>=2.25||total24>=8);
 const sparseButStrong=positive>=2&&medianIndependent>=2&&span>=14&&medianAge>=12&&demand>=50&&(medianPace>=4||total24>=12);
 const broadFamily=positive>=3&&mature>=2&&span>=10&&medianAge>=8&&demand>=43&&(medianPace>=2||total24>=9);
 const buyerBacked=positive>=2&&span>=8&&medianAge>=8&&demand>=50&&buyerSignals>0&&(medianPace>=1.5||total24>=6);
 if(matureTwo||sparseButStrong||broadFamily||buyerBacked)stage='STRONG_LEAD';
 const deepFamily=positive>=3&&mature>=3&&span>=20&&medianAge>=16&&demand>=68&&(medianPace>=4||total24>=18)&&(buyerSignals>0||max24>=8);
 const exceptionalPair=positive>=2&&mature>=2&&span>=24&&medianAge>=20&&demand>=76&&total24>=22&&max24>=10;
 // Trade Me often exposes view growth more reliably than watchers/bids on fixed-price listings.
 // A broad, mature family can therefore reach SOURCE_NOW on repeated independent view evidence
 // alone, but only after several related live listings have moved together for >1 day.
 const broadViewFamily=positive>=5&&mature>=4&&medianIndependent>=4&&span>=36&&medianAge>=30&&demand>=52&&total24>=24&&max24>=6&&medianPace>=1.5;
 if(deepFamily||exceptionalPair||broadViewFamily)stage='SOURCE_NOW';
 return stage;
}


export async function scanOpportunities(db:any){
 const listings=await fetchPaged(()=>db.from('listings').select('*').order('last_observed_at',{ascending:false}).order('id',{ascending:true}),1000,10000);
 // Fetch observations in pages rather than a single `.in(listing_uuid, huge-id-list)` request. This
 // avoids both PostgREST row caps and very large query URLs as COBALT grows beyond a few hundred listings.
 const allObs=await fetchPaged(()=>db.from('observations').select('*').order('captured_at',{ascending:false}).order('id',{ascending:false}),1000,100000);
 const wanted=new Set((listings||[]).map((x:any)=>String(x.id))); const obs=(allObs||[]).filter((o:any)=>wanted.has(String(o.listing_uuid)));
 const recentCutoff=Date.now()-30*86400000;
 const obsByListing=new Map<string,any[]>();for(const o of obs||[]){const k=String(o.listing_uuid);const a=obsByListing.get(k)||[];if(a.length<80){a.push(o);obsByListing.set(k,a)}}
 const base=(listings||[]).filter((l:any)=>String(l?.metadata?.observation_queue_status||'active')!=='dismissed').filter((l:any)=>l.active||Date.parse(l.finalized_at||l.last_observed_at||l.last_seen||'')>=recentCutoff).map((l:any)=>({...l,observations:obsByListing.get(String(l.id))||[]}));
 const signals=computeListingSignals(base);const scored=base.map((l:any,i:number)=>({...l,signal:signals[i]})).filter((l:any)=>Number(l.signal?.independentObservationCount||0)>=2&&(Number(l.signal?.velocity||0)>0||Number(l.signal?.views24h||0)>0));
 const rawClusters=unionClusters(scored); const clusters=rawClusters.filter(g=>g.length>=2); let upserts=0,notifications=0,standaloneUpdated=0; const audit:any[]=[];
 const corroboratedListingIds=new Set<string>();
 const endedAgeDays=(l:any)=>{const t=Date.parse(l.finalized_at||l.last_observed_at||l.last_seen||'');return Number.isFinite(t)?Math.max(0,(Date.now()-t)/86400000):999};
 const historyWeight=(l:any)=>l.active?0:endedAgeDays(l)<=7?1:endedAgeDays(l)<=30?.35:0;
 for(const group of clusters){
  const positive=group.filter(l=>Number(l.signal?.independentObservationCount||0)>=2&&(Number(l.signal?.views24h||0)>=2||Number(l.signal?.velocity||0)>=2));
  const livePositive=positive.filter((l:any)=>l.active&&String(l.lifecycle_state||'active')==='active');
  const historicalSupport=positive.filter((l:any)=>!l.active&&historyWeight(l)>0);
  if(livePositive.length<1)continue; // ended listings can corroborate, never create a current lead alone
  const supportWeight=historicalSupport.reduce((n:number,l:any)=>n+historyWeight(l),0);
  if(livePositive.length+supportWeight<2)continue;
  const velocities=livePositive.map(l=>Number(l.signal.velocity||0)).filter(Number.isFinite); const med=median(velocities)||0;
  const views24Values=livePositive.map(l=>Math.max(0,Number(l.signal?.views24h||0))); const totalViews24=views24Values.reduce((a,b)=>a+b,0); const maxViews24=Math.max(0,...views24Values);
  const maturePositive=livePositive.filter(l=>Number(l.signal?.independentObservationCount||0)>=3).length;
  const independentCounts=livePositive.map(l=>Number(l.signal?.independentObservationCount||0)); const medianIndependent=median(independentCounts)||0;
  const liveAges=livePositive.map(observedAgeHours); const medianAge=median(liveAges)||0;
  if(med<1.25&&totalViews24<4)continue;
  group.forEach((l:any)=>corroboratedListingIds.add(String(l.id)));
  const rawPrices=group.filter((l:any)=>l.active).map(latestPrice); const prices=rawPrices.filter((x:any)=>x!=null&&Number.isFinite(Number(x))).map(Number); const pricedListings=prices.length; const missingPriceListings=Math.max(0,group.filter((l:any)=>l.active).length-pricedListings); const conf=median(livePositive.map(l=>Number(l.signal?.confidence||0)))||0;
  const intentScores=group.filter((l:any)=>l.active).map(l=>Number(l.signal?.engagementScore)).filter(Number.isFinite); const medIntent=median(intentScores)||0;
  const purchaseQs=group.filter((l:any)=>l.active).reduce((n,l)=>n+Number(l.signal?.purchaseIntentQuestions||0),0); const questionCount=group.filter((l:any)=>l.active).reduce((n,l)=>n+Number(l.signal?.questionCount||0),0);
  const watcherCount=group.filter((l:any)=>l.active).reduce((n,l)=>n+Number(l.signal?.watchers||0),0); const bidCount=group.filter((l:any)=>l.active).reduce((n,l)=>n+Number(l.signal?.bids||0),0);
  // A confirmed sale normally makes a listing inactive, so sold evidence must come from the
  // recent ended side of the family rather than only the currently-live listings. Count each
  // confirmed recent conversion once; it strengthens confidence but never creates a family alone.
  const recentSoldListings=group.filter((l:any)=>Boolean(l.signal?.soldDetected)&&(!l.active?historyWeight(l)>0:true));
  const soldCount=recentSoldListings.length;
  const times=group.flatMap(l=>(l.observations||[]).map((o:any)=>Date.parse(o.captured_at)).filter(Number.isFinite)); const span=times.length?(Math.max(...times)-Math.min(...times))/3600000:0;
  if(span<6||medianAge<6)continue;
  const family=familyIdentity(group);
  const demandScore=Math.min(100,Math.round(Math.min(30,totalViews24*2.2)+Math.min(18,med*2.2)+Math.min(18,livePositive.length*4)+Math.min(12,supportWeight*4)+Math.min(14,medIntent*.25)+Math.min(8,watcherCount*1.5)+Math.min(10,purchaseQs*3)+Math.min(10,bidCount*4)+Math.min(10,soldCount*8)));
  const sourcingStage=classifyFamilyOpportunity({positive:livePositive.length,mature:maturePositive,span,medianPace:med,total24:totalViews24,max24:maxViews24,demand:demandScore,watchers:watcherCount,bids:bidCount,purchaseQs,sold:soldCount,medianAge,medianIndependent})||'EARLY_LEAD';
  const strength=sourcingStage==='EARLY_LEAD'?'EMERGING':'STRONG'; const key=familyKey(group);
  const metrics={opportunity_type:'corroborated',sourcing_stage:sourcingStage,comparable_listings:group.length,positive_listings:livePositive.length,independent_listings:maturePositive,recent_ended_support:historicalSupport.length,historical_support_weight:Number(supportWeight.toFixed(2)),median_velocity:Number(med.toFixed(2)),total_views_24h:totalViews24,max_views_24h:maxViews24,price_min:prices.length?Math.min(...prices):null,price_max:prices.length?Math.max(...prices):null,evidence_window_hours:Number(span.toFixed(1)),median_listing_age_hours:Number(medianAge.toFixed(1)),median_independent_observations:Number(medianIndependent.toFixed(1)),median_confidence:Number(conf.toFixed(1)),marketplace_demand_score:demandScore,median_buyer_intent_score:Number(medIntent.toFixed(1)),question_count:questionCount,purchase_intent_questions:purchaseQs,watchers:watcherCount,bids:bidCount,sold_confirmations:soldCount,priced_listings:pricedListings,missing_price_listings:missingPriceListings,pricing_status:pricedListings===0?'NO_PRICE_EVIDENCE':pricedListings<group.filter((l:any)=>l.active).length?'PARTIAL_PRICE_EVIDENCE':'COMPLETE_PRICE_EVIDENCE'};
  const historicalNote=historicalSupport.length?` ${historicalSupport.length} recently ended related listing${historicalSupport.length===1?' also supports':'s also support'} this pattern.`:'';
  const buyerEvidence:string[]=[];
  if(watcherCount>0)buyerEvidence.push(`${watcherCount} public watchlist${watcherCount===1?'':'s'}`);
  if(bidCount>0)buyerEvidence.push(`${bidCount} bid${bidCount===1?'':'s'}`);
  if(purchaseQs>0)buyerEvidence.push(`${purchaseQs} purchase-intent question${purchaseQs===1?'':'s'}`);
  if(soldCount>0)buyerEvidence.push(`${soldCount} confirmed sale${soldCount===1?'':'s'}`);
  const buyerNote=buyerEvidence.length?` Direct buyer evidence: ${buyerEvidence.join(', ')}.`:' Buyer-specific counters were unavailable or inactive on these listings, so this decision is based on repeated marketplace attention and corroboration.';
  const reason=`${livePositive.length} live similar listing${livePositive.length===1?' is':'s are'} moving together across ${Math.round(span)} hours. They gained ${totalViews24} view${totalViews24===1?'':'s'} in the last 24 hours; the strongest gained ${maxViews24}.${buyerNote}${historicalNote}`;
  const pricingNote=pricedListings===0?' No usable marketplace price has been captured yet; this does not weaken the demand signal, but COBALT will not infer a recommended price from this family.':missingPriceListings>0?` ${missingPriceListings} related listing${missingPriceListings===1?' has':'s have'} no usable price and ${missingPriceListings===1?'is':'are'} excluded from the price range.`:''; const recommendation=(sourcingStage==='SOURCE_NOW'?'Make supplier research a priority. This is still a marketplace-attention signal, so confirm cost, margin and exact product fit before buying stock.':sourcingStage==='STRONG_LEAD'?'Investigate Chinese supplier pricing now while COBALT keeps observing the market.':'This is worth a quick supplier search. Treat it as an early research lead while COBALT gathers more evidence.')+pricingNote;
  audit.push({kind:'family',title:family.title,stage:sourcingStage,positive_listings:livePositive.length,recent_ended_support:historicalSupport.length,total_views_24h:totalViews24,max_views_24h:maxViews24,priced_listings:pricedListings,missing_price_listings:missingPriceListings,demand_score:demandScore,reason}); const {data:existing}=await db.from('opportunities').select('*').eq('family_key',key).maybeSingle(); const now=new Date().toISOString();
  let opp:any;
  if(!existing){const {data,error:e}=await db.from('opportunities').insert({family_key:key,opportunity_type:'corroborated',title:family.title,category:family.identity.category,product_type:family.identity.product_type,identity:family.identity,identity_confidence:family.identityConfidence,signal_strength:strength,status:'new',metrics,reason,recommendation,first_detected_at:now,last_detected_at:now,last_notified_at:now}).select().single();if(e)throw e;opp=data;upserts++;const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:opp.id,event_type:'detected',title:`${sourcingStage.replaceAll('_',' ')} · ${family.title}`,message:`${livePositive.length} live similar listings are gaining attention. COBALT thinks this product is worth supplier research.`,payload:{opportunity_type:'corroborated',strength,sourcing_stage:sourcingStage,metrics},notification_key:`${opp.id}:detected`});if(!ne)notifications++;}
  else {const material=existing.signal_strength!==strength||String(existing.metrics?.sourcing_stage||'')!==sourcingStage||Number(metrics.positive_listings)>=Number(existing.metrics?.positive_listings||0)+1||Number(metrics.total_views_24h)>=Number(existing.metrics?.total_views_24h||0)+8;const patch:any={opportunity_type:'corroborated',title:family.title,category:family.identity.category,product_type:family.identity.product_type,identity:family.identity,identity_confidence:family.identityConfidence,signal_strength:strength,metrics,reason,recommendation,last_detected_at:now};if(material&&existing.status!=='dismissed')patch.last_notified_at=now;const {data,error:e}=await db.from('opportunities').update(patch).eq('id',existing.id).select().single();if(e)throw e;opp=data;upserts++;if(material&&existing.status!=='dismissed'){const k=`${existing.id}:${strength}:${metrics.positive_listings}:${Math.round(metrics.median_velocity)}`;const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:existing.id,event_type:'strengthened',title:`${family.title} signal strengthened`,message:`This lead is now ${sourcingStage.replaceAll('_',' ').toLowerCase()}: ${positive.length} similar listings gained ${totalViews24} views in the last 24 hours.`,payload:{opportunity_type:'corroborated',strength,sourcing_stage:sourcingStage,metrics},notification_key:k});if(!ne)notifications++;}}
  const existingIds=new Set((await db.from('opportunity_listings').select('listing_uuid').eq('opportunity_id',opp.id)).data?.map((x:any)=>x.listing_uuid)||[]); for(const l of group){const ev={signal:l.signal?.label,velocity:l.signal?.velocity,confidence:l.signal?.confidence,engagement_score:l.signal?.engagementScore,watchers:l.signal?.watchers,bids:l.signal?.bids,question_count:l.signal?.questionCount,purchase_intent_questions:l.signal?.purchaseIntentQuestions,sold_detected:l.signal?.soldDetected,similarity_to_family:1};if(existingIds.has(l.id))await db.from('opportunity_listings').update({evidence:ev,last_seen_at:now}).eq('opportunity_id',opp.id).eq('listing_uuid',l.id);else await db.from('opportunity_listings').insert({opportunity_id:opp.id,listing_uuid:l.id,evidence:ev,last_seen_at:now});}
  // If one of these listings previously stood alone, the corroborated family now takes precedence.
  // Preserve the standalone history but clear its unread alert so the operator does not see duplicate opportunities.
  for(const l of group){const sk=standaloneKey(l);const {data:priorStandalone}=await db.from('opportunities').select('*').eq('family_key',sk).maybeSingle();if(priorStandalone){const priorMetrics={...(priorStandalone.metrics||{}),superseded_by_family_key:key,superseded_at:now};await db.from('opportunities').update({status:priorStandalone.status==='sourcing'?'sourcing':'watching',metrics:priorMetrics,read_at:now,reason:`This listing is now represented by the corroborated opportunity ${family.title}. The standalone history is retained for provenance.`}).eq('id',priorStandalone.id);await db.from('opportunity_notifications').update({read_at:now}).eq('opportunity_id',priorStandalone.id).is('read_at',null);}}
 }

 // Standalone opportunities are intentionally stricter than corroborated family opportunities.
 // They surface unusual products without pretending one listing proves a broad market.
 const standaloneCandidates=scored.filter((l:any)=>l.active&&String(l.lifecycle_state||'active')==='active'&&!corroboratedListingIds.has(String(l.id)));
 for(const l of standaloneCandidates){
  const q:any=standaloneQualification(l); if(!q.qualifies)continue;
  const identity=deriveOpportunityIdentity(l); const key=standaloneKey(l); const price=latestPrice(l); const now=new Date().toISOString();
  const metrics={opportunity_type:'standalone',sourcing_stage:q.sourcingStage,comparable_listings:0,positive_listings:1,independent_listings:1,independent_observation_windows:q.independent,median_velocity:Number(q.velocity.toFixed(2)),views_24h:q.views24,last_view_change:q.lastDelta,price_min:price==null?null:Number(price),price_max:price==null?null:Number(price),evidence_window_hours:Number(q.span.toFixed(1)),median_confidence:Number(q.confidence.toFixed(1)),marketplace_demand_score:q.demandScore,median_buyer_intent_score:Number(q.intent.toFixed(1)),question_count:Number(l.signal?.questionCount||0),purchase_intent_questions:q.purchaseQs,watchers:q.watchers,bids:q.bids,sold_confirmations:q.sold?1:0,latest_velocity_interval_hours:Number(q.interval.toFixed(1)),priced_listings:price==null?0:1,missing_price_listings:price==null?1:0,pricing_status:price==null?'NO_PRICE_EVIDENCE':'COMPLETE_PRICE_EVIDENCE'};
  const title=standaloneTitle(l); const reason=`This listing gained ${q.lastDelta>0?`${q.lastDelta} view${q.lastDelta===1?'':'s'} since our last check and `:''}${q.views24} view${q.views24===1?'':'s'} in the last 24 hours. We do not yet have a reliable group of similar listings, so treat this as a higher-uncertainty sourcing lead.`;
  const priceNote=price==null?' No usable price was captured, so this listing can support demand detection but is excluded from market-price recommendations.':''; const recommendation=(q.sourcingStage==='SOURCE_NOW'?'Prioritise a supplier check, but do not buy stock until cost, margin and product fit are confirmed.':q.sourcingStage==='STRONG_LEAD'?'Investigate supplier pricing now while COBALT keeps looking for comparable marketplace evidence.':'Worth a quick supplier search while COBALT continues watching the listing.')+priceNote;
  audit.push({kind:'standalone',title,stage:q.sourcingStage,views_24h:q.views24,last_view_change:q.lastDelta,priced_listings:price==null?0:1,missing_price_listings:price==null?1:0,demand_score:q.demandScore,reason}); const identityConfidence=Math.min(88,Math.max(45,Math.round(45+(identity.make?7:0)+(identity.model?7:0)+(identity.product_type?8:0)+(identity.chassis_codes?.length?8:0)+(identity.part_numbers?.length?10:0))));
  const {data:existing}=await db.from('opportunities').select('*').eq('family_key',key).maybeSingle(); let opp:any;
  if(!existing){
   const {data,error:e}=await db.from('opportunities').insert({family_key:key,opportunity_type:'standalone',title,category:identity.category,product_type:identity.product_type,identity,identity_confidence:identityConfidence,signal_strength:q.strength,status:'new',metrics,reason,recommendation,first_detected_at:now,last_detected_at:now,last_notified_at:now}).select().single();if(e)throw e;opp=data;upserts++;standaloneUpdated++;
   const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:opp.id,event_type:'detected',title:`${q.sourcingStage.replaceAll('_',' ')} · ${title}`,message:`This listing is attracting enough attention to justify a quick supplier check, even though comparable evidence is still limited.`,payload:{opportunity_type:'standalone',strength:q.strength,sourcing_stage:q.sourcingStage,metrics},notification_key:`${opp.id}:detected`});if(!ne)notifications++;
  }else{
   const old=existing.metrics||{}; const material=existing.signal_strength!==q.strength||String(old.sourcing_stage||'')!==q.sourcingStage||q.independent>=Number(old.independent_observation_windows||0)+1||q.demandScore>=Number(old.marketplace_demand_score||0)+10||q.bids>=Number(old.bids||0)+1||q.purchaseQs>=Number(old.purchase_intent_questions||0)+1||(!old.sold_confirmations&&q.sold);
   const patch:any={opportunity_type:'standalone',title,category:identity.category,product_type:identity.product_type,identity,identity_confidence:identityConfidence,signal_strength:q.strength,metrics,reason,recommendation,last_detected_at:now};if(material&&existing.status!=='dismissed')patch.last_notified_at=now;
   const {data,error:e}=await db.from('opportunities').update(patch).eq('id',existing.id).select().single();if(e)throw e;opp=data;upserts++;standaloneUpdated++;
   if(material&&existing.status!=='dismissed'){const k=`${existing.id}:standalone:${q.strength}:${q.independent}:${q.demandScore}:${q.bids}:${q.purchaseQs}:${q.sold?1:0}`;const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:existing.id,event_type:'strengthened',title:`${title} standalone signal strengthened`,message:`This standalone lead is now ${q.sourcingStage.replaceAll('_',' ').toLowerCase()}. It gained ${q.views24} views in the last 24 hours.`,payload:{opportunity_type:'standalone',strength:q.strength,sourcing_stage:q.sourcingStage,metrics},notification_key:k});if(!ne)notifications++;}
  }
  const ev={signal:l.signal?.label,velocity:l.signal?.velocity,confidence:l.signal?.confidence,engagement_score:l.signal?.engagementScore,watchers:l.signal?.watchers,bids:l.signal?.bids,question_count:l.signal?.questionCount,purchase_intent_questions:l.signal?.purchaseIntentQuestions,sold_detected:l.signal?.soldDetected,standalone:true};
  const {data:existingLink}=await db.from('opportunity_listings').select('listing_uuid').eq('opportunity_id',opp.id).eq('listing_uuid',l.id).maybeSingle();
  if(existingLink)await db.from('opportunity_listings').update({evidence:ev,last_seen_at:now}).eq('opportunity_id',opp.id).eq('listing_uuid',l.id);else await db.from('opportunity_listings').insert({opportunity_id:opp.id,listing_uuid:l.id,evidence:ev,last_seen_at:now});
 }
 return {ok:true,scoredListings:scored.length,clusters:clusters.length,opportunitiesUpdated:upserts,standaloneOpportunitiesUpdated:standaloneUpdated,notificationsCreated:notifications,audit:audit.sort((a,b)=>Number(b.demand_score||0)-Number(a.demand_score||0)).slice(0,25)};
}

export function supplierResearchFromOpportunity(opp:any){
 const i=opp.identity||{}; const chassis=(i.chassis_codes||[]).map((x:any)=>x.value||x).filter(Boolean); const parts=(i.part_numbers||[]).map((x:any)=>x.value||x).filter(Boolean);
 const base=[i.make,i.model,...chassis.slice(0,2),i.product_type].filter(Boolean).join(' ');
 const search_terms=[base,...parts.slice(0,3).map((p:string)=>`${p} ${i.product_type||''}`.trim()),`${base} aftermarket`,`${base} supplier`].filter(Boolean);
 const refs=[chassis.length?`Platform / model codes: ${chassis.join(', ')}`:null,parts.length?`Observed part/reference numbers: ${parts.join(', ')}`:null].filter(Boolean).join('\n');
 const message=`Hello,\n\nWe're sourcing ${i.product_type||opp.title} for the New Zealand market.\n\nReference information:\n${i.make||i.model?`Product family / model: ${[i.make,i.model].filter(Boolean).join(' ')}\n`:''}${refs}${refs?'\n':''}\nCould you please confirm:\n• Exact product / model / variant this quote covers\n• Manufacturer and OEM/reference numbers\n• Available versions / colours / specifications\n• MOQ\n• Unit pricing at 5 / 10 / 25 / 50 units\n• Sample pricing\n• Product photos and packaging\n• Lead time\n• Shipping options to New Zealand\n\nPlease do not assume compatibility from the codes above; confirm the exact variant for each item you quote.\n\nThank you.`;
 return {search_terms:[...new Set(search_terms)],message,generated_at:new Date().toISOString(),identity_snapshot:i};
}
