import {computeListingSignals} from './intelligence';

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
function latestPrice(l:any){const o=latestObs(l);return o?.buy_now_nzd??o?.asking_price_nzd??o?.current_bid_nzd??null}
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
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const sim=pairSimilarity(rows[i],rows[j]);if(sim>=0.58)join(i,j)}
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
function standaloneQualification(l:any){
 const s=l.signal||{}; const independent=Number(s.independentObservationCount||0); const span=Number(s.evidenceDetails?.spanHours||0);
 const velocity=Number(s.velocity||0); const interval=Number(s.velocityIntervalHours||0); const confidence=Number(s.confidence||0); const intent=Number(s.engagementScore||0);
 const watchers=Number(s.watchers||0); const bids=Number(s.bids||0); const purchaseQs=Number(s.purchaseIntentQuestions||0); const sold=Boolean(s.soldDetected);
 const enoughHistory=independent>=4&&span>=30&&interval>=12&&confidence>=60;
 const strongBehaviour=sold||bids>=1||watchers>=3||purchaseQs>=1||intent>=55||velocity>=12;
 const qualifies=enoughHistory&&velocity>=6&&strongBehaviour;
 if(!qualifies)return {qualifies:false};
 const demandScore=Math.min(100,Math.round(Math.min(42,velocity*3)+Math.min(28,intent*.35)+Math.min(12,watchers*2.5)+Math.min(12,bids*6)+Math.min(9,purchaseQs*3)+(sold?15:0)));
 const strong=independent>=5&&span>=48&&confidence>=72&&velocity>=8&&(sold||bids>=2||intent>=65||velocity>=14)&&demandScore>=72;
 return {qualifies:true,strength:strong?'STRONG':'EMERGING',demandScore,independent,span,velocity,interval,confidence,intent,watchers,bids,purchaseQs,sold};
}

export async function scanOpportunities(db:any){
 const {data:listings,error}=await db.from('listings').select('*').order('last_observed_at',{ascending:false}).limit(500);if(error)throw error;
 const ids=(listings||[]).map((x:any)=>x.id); const {data:obs,error:oe}=ids.length?await db.from('observations').select('*').in('listing_uuid',ids).order('captured_at',{ascending:false}).limit(15000):{data:[],error:null};if(oe)throw oe;
 const recentCutoff=Date.now()-14*86400000;
 const base=(listings||[]).filter((l:any)=>String(l?.metadata?.observation_queue_status||'active')!=='dismissed').filter((l:any)=>l.active||Date.parse(l.last_observed_at||l.last_seen||'')>=recentCutoff).map((l:any)=>({...l,observations:(obs||[]).filter((o:any)=>o.listing_uuid===l.id).slice(0,50)}));
 const signals=computeListingSignals(base);const scored=base.map((l:any,i:number)=>({...l,signal:signals[i]})).filter((l:any)=>Number(l.signal?.independentObservationCount||0)>=2&&Number(l.signal?.velocity||0)>0);
 const rawClusters=unionClusters(scored); const clusters=rawClusters.filter(g=>g.length>=3); let upserts=0,notifications=0,standaloneUpdated=0;
 const corroboratedListingIds=new Set<string>();
 for(const group of clusters){
  const positive=group.filter(l=>['WATCHING','GOOD','MUST_HAVE','MUST HAVE'].includes(String(l.signal?.label||''))&&Number(l.signal?.velocity||0)>0);
  if(positive.length<3)continue;
  const velocities=positive.map(l=>Number(l.signal.velocity)).filter(Number.isFinite); const med=median(velocities); if(med==null||med<3.5)continue;
  group.forEach((l:any)=>corroboratedListingIds.add(String(l.id)));
  const prices=group.map(latestPrice).filter((x:any)=>Number.isFinite(Number(x))).map(Number); const conf=median(positive.map(l=>Number(l.signal?.confidence||0)))||0;
  const intentScores=group.map(l=>Number(l.signal?.engagementScore)).filter(Number.isFinite); const medIntent=median(intentScores)||0;
  const purchaseQs=group.reduce((n,l)=>n+Number(l.signal?.purchaseIntentQuestions||0),0); const questionCount=group.reduce((n,l)=>n+Number(l.signal?.questionCount||0),0);
  const watcherCount=group.reduce((n,l)=>n+Number(l.signal?.watchers||0),0); const bidCount=group.reduce((n,l)=>n+Number(l.signal?.bids||0),0); const soldCount=group.filter(l=>l.signal?.soldDetected).length;
  const times=group.flatMap(l=>(l.observations||[]).map((o:any)=>Date.parse(o.captured_at)).filter(Number.isFinite)); const span=times.length?(Math.max(...times)-Math.min(...times))/3600000:0;
  const family=familyIdentity(group); const demandScore=Math.min(100,Math.round((Math.min(20,med*2.3)+Math.min(20,positive.length*3)+Math.min(20,medIntent*.35)+Math.min(15,purchaseQs*3)+Math.min(15,bidCount*4)+Math.min(10,soldCount*10))));
  const strength=(positive.length>=5&&med>=6&&conf>=45)||(positive.length>=4&&demandScore>=70&&med>=3.5)?'STRONG':'EMERGING'; const key=familyKey(group);
  const metrics={opportunity_type:'corroborated',comparable_listings:group.length,positive_listings:positive.length,independent_listings:positive.length,median_velocity:Number(med.toFixed(2)),price_min:prices.length?Math.min(...prices):null,price_max:prices.length?Math.max(...prices):null,evidence_window_hours:Number(span.toFixed(1)),median_confidence:Number(conf.toFixed(1)),marketplace_demand_score:demandScore,median_buyer_intent_score:Number(medIntent.toFixed(1)),question_count:questionCount,purchase_intent_questions:purchaseQs,watchers:watcherCount,bids:bidCount,sold_confirmations:soldCount};
  const reason=`Positive attention is occurring across ${positive.length} comparable listings rather than one unusually active listing${purchaseQs||bidCount||soldCount?`; stronger buyer-intent evidence is also present (${purchaseQs} purchase-intent questions, ${bidCount} bids, ${soldCount} explicit sold confirmations)`:''}.`;
  const recommendation=strength==='STRONG'?'Supplier research warranted. Continue observing marketplace attention while sourcing.':'Keep watching. The cross-listing pattern is promising but still developing.';
  const {data:existing}=await db.from('opportunities').select('*').eq('family_key',key).maybeSingle(); const now=new Date().toISOString();
  let opp:any;
  if(!existing){const {data,error:e}=await db.from('opportunities').insert({family_key:key,opportunity_type:'corroborated',title:family.title,category:family.identity.category,product_type:family.identity.product_type,identity:family.identity,identity_confidence:family.identityConfidence,signal_strength:strength,status:'new',metrics,reason,recommendation,first_detected_at:now,last_detected_at:now,last_notified_at:now}).select().single();if(e)throw e;opp=data;upserts++;const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:opp.id,event_type:'detected',title:`${strength} product signal`,message:`${family.title} is showing consistent positive attention across ${positive.length} comparable listings.`,payload:{opportunity_type:'corroborated',strength,metrics},notification_key:`${opp.id}:detected`});if(!ne)notifications++;}
  else {const material=existing.signal_strength!==strength||Number(metrics.positive_listings)>=Number(existing.metrics?.positive_listings||0)+3||Number(metrics.median_velocity)>=Number(existing.metrics?.median_velocity||0)*1.5;const patch:any={opportunity_type:'corroborated',title:family.title,category:family.identity.category,product_type:family.identity.product_type,identity:family.identity,identity_confidence:family.identityConfidence,signal_strength:strength,metrics,reason,recommendation,last_detected_at:now};if(material&&existing.status!=='dismissed')patch.last_notified_at=now;const {data,error:e}=await db.from('opportunities').update(patch).eq('id',existing.id).select().single();if(e)throw e;opp=data;upserts++;if(material&&existing.status!=='dismissed'){const k=`${existing.id}:${strength}:${metrics.positive_listings}:${Math.round(metrics.median_velocity)}`;const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:existing.id,event_type:'strengthened',title:`${family.title} signal strengthened`,message:`Now ${strength}: ${positive.length} positive comparable listings at a median ${med.toFixed(1)} views/day.`,payload:{opportunity_type:'corroborated',strength,metrics},notification_key:k});if(!ne)notifications++;}}
  const existingIds=new Set((await db.from('opportunity_listings').select('listing_uuid').eq('opportunity_id',opp.id)).data?.map((x:any)=>x.listing_uuid)||[]); for(const l of group){const ev={signal:l.signal?.label,velocity:l.signal?.velocity,confidence:l.signal?.confidence,engagement_score:l.signal?.engagementScore,watchers:l.signal?.watchers,bids:l.signal?.bids,question_count:l.signal?.questionCount,purchase_intent_questions:l.signal?.purchaseIntentQuestions,sold_detected:l.signal?.soldDetected,similarity_to_family:1};if(existingIds.has(l.id))await db.from('opportunity_listings').update({evidence:ev,last_seen_at:now}).eq('opportunity_id',opp.id).eq('listing_uuid',l.id);else await db.from('opportunity_listings').insert({opportunity_id:opp.id,listing_uuid:l.id,evidence:ev,last_seen_at:now});}
  // If one of these listings previously stood alone, the corroborated family now takes precedence.
  // Preserve the standalone history but clear its unread alert so the operator does not see duplicate opportunities.
  for(const l of group){const sk=standaloneKey(l);const {data:priorStandalone}=await db.from('opportunities').select('*').eq('family_key',sk).maybeSingle();if(priorStandalone){const priorMetrics={...(priorStandalone.metrics||{}),superseded_by_family_key:key,superseded_at:now};await db.from('opportunities').update({status:priorStandalone.status==='sourcing'?'sourcing':'watching',metrics:priorMetrics,read_at:now,reason:`This listing is now represented by the corroborated opportunity ${family.title}. The standalone history is retained for provenance.`}).eq('id',priorStandalone.id);await db.from('opportunity_notifications').update({read_at:now}).eq('opportunity_id',priorStandalone.id).is('read_at',null);}}
 }

 // Standalone opportunities are intentionally stricter than corroborated family opportunities.
 // They surface unusual products without pretending one listing proves a broad market.
 const standaloneCandidates=scored.filter((l:any)=>!corroboratedListingIds.has(String(l.id)));
 for(const l of standaloneCandidates){
  const q:any=standaloneQualification(l); if(!q.qualifies)continue;
  const identity=deriveOpportunityIdentity(l); const key=standaloneKey(l); const price=latestPrice(l); const now=new Date().toISOString();
  const metrics={opportunity_type:'standalone',comparable_listings:0,positive_listings:1,independent_listings:1,independent_observation_windows:q.independent,median_velocity:Number(q.velocity.toFixed(2)),price_min:price==null?null:Number(price),price_max:price==null?null:Number(price),evidence_window_hours:Number(q.span.toFixed(1)),median_confidence:Number(q.confidence.toFixed(1)),marketplace_demand_score:q.demandScore,median_buyer_intent_score:Number(q.intent.toFixed(1)),question_count:Number(l.signal?.questionCount||0),purchase_intent_questions:q.purchaseQs,watchers:q.watchers,bids:q.bids,sold_confirmations:q.sold?1:0,latest_velocity_interval_hours:Number(q.interval.toFixed(1))};
  const title=standaloneTitle(l); const reason=`This listing has unusually strong sustained evidence despite no reliable comparable product family being available yet. COBALT has ${q.independent} independent evidence windows across ${q.span.toFixed(1)} hours, trusted velocity of ${q.velocity.toFixed(1)} views/day${q.watchers||q.bids||q.purchaseQs||q.sold?`, plus stronger buyer-intent evidence (${q.watchers} watchers, ${q.bids} bids, ${q.purchaseQs} purchase-intent questions${q.sold?', explicit sold evidence':''})`:''}.`;
  const recommendation=q.strength==='STRONG'?'Investigate sourcing, but treat this as higher uncertainty than a corroborated product-family signal. Continue observation while sourcing.':'Keep watching. This standalone listing is unusually promising, but there is not yet enough comparable-market evidence to claim broad demand.';
  const identityConfidence=Math.min(88,Math.max(45,Math.round(45+(identity.make?7:0)+(identity.model?7:0)+(identity.product_type?8:0)+(identity.chassis_codes?.length?8:0)+(identity.part_numbers?.length?10:0))));
  const {data:existing}=await db.from('opportunities').select('*').eq('family_key',key).maybeSingle(); let opp:any;
  if(!existing){
   const {data,error:e}=await db.from('opportunities').insert({family_key:key,opportunity_type:'standalone',title,category:identity.category,product_type:identity.product_type,identity,identity_confidence:identityConfidence,signal_strength:q.strength,status:'new',metrics,reason,recommendation,first_detected_at:now,last_detected_at:now,last_notified_at:now}).select().single();if(e)throw e;opp=data;upserts++;standaloneUpdated++;
   const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:opp.id,event_type:'detected',title:`${q.strength} standalone product signal`,message:`${title} has unusually strong standalone evidence, but no reliable comparable family yet.`,payload:{opportunity_type:'standalone',strength:q.strength,metrics},notification_key:`${opp.id}:detected`});if(!ne)notifications++;
  }else{
   const old=existing.metrics||{}; const material=existing.signal_strength!==q.strength||q.independent>=Number(old.independent_observation_windows||0)+2||q.demandScore>=Number(old.marketplace_demand_score||0)+12||q.bids>=Number(old.bids||0)+1||q.purchaseQs>=Number(old.purchase_intent_questions||0)+2||(!old.sold_confirmations&&q.sold);
   const patch:any={opportunity_type:'standalone',title,category:identity.category,product_type:identity.product_type,identity,identity_confidence:identityConfidence,signal_strength:q.strength,metrics,reason,recommendation,last_detected_at:now};if(material&&existing.status!=='dismissed')patch.last_notified_at=now;
   const {data,error:e}=await db.from('opportunities').update(patch).eq('id',existing.id).select().single();if(e)throw e;opp=data;upserts++;standaloneUpdated++;
   if(material&&existing.status!=='dismissed'){const k=`${existing.id}:standalone:${q.strength}:${q.independent}:${q.demandScore}:${q.bids}:${q.purchaseQs}:${q.sold?1:0}`;const {error:ne}=await db.from('opportunity_notifications').insert({opportunity_id:existing.id,event_type:'strengthened',title:`${title} standalone signal strengthened`,message:`Standalone evidence is now ${q.strength}: ${q.independent} independent windows, ${q.velocity.toFixed(1)} views/day and buyer-intent score ${q.intent.toFixed(0)}/100.`,payload:{opportunity_type:'standalone',strength:q.strength,metrics},notification_key:k});if(!ne)notifications++;}
  }
  const ev={signal:l.signal?.label,velocity:l.signal?.velocity,confidence:l.signal?.confidence,engagement_score:l.signal?.engagementScore,watchers:l.signal?.watchers,bids:l.signal?.bids,question_count:l.signal?.questionCount,purchase_intent_questions:l.signal?.purchaseIntentQuestions,sold_detected:l.signal?.soldDetected,standalone:true};
  const {data:existingLink}=await db.from('opportunity_listings').select('listing_uuid').eq('opportunity_id',opp.id).eq('listing_uuid',l.id).maybeSingle();
  if(existingLink)await db.from('opportunity_listings').update({evidence:ev,last_seen_at:now}).eq('opportunity_id',opp.id).eq('listing_uuid',l.id);else await db.from('opportunity_listings').insert({opportunity_id:opp.id,listing_uuid:l.id,evidence:ev,last_seen_at:now});
 }
 return {ok:true,scoredListings:scored.length,clusters:clusters.length,opportunitiesUpdated:upserts,standaloneOpportunitiesUpdated:standaloneUpdated,notificationsCreated:notifications};
}

export function supplierResearchFromOpportunity(opp:any){
 const i=opp.identity||{}; const chassis=(i.chassis_codes||[]).map((x:any)=>x.value||x).filter(Boolean); const parts=(i.part_numbers||[]).map((x:any)=>x.value||x).filter(Boolean);
 const base=[i.make,i.model,...chassis.slice(0,2),i.product_type].filter(Boolean).join(' ');
 const search_terms=[base,...parts.slice(0,3).map((p:string)=>`${p} ${i.product_type||''}`.trim()),`${base} aftermarket`,`${base} supplier`].filter(Boolean);
 const refs=[chassis.length?`Platform / model codes: ${chassis.join(', ')}`:null,parts.length?`Observed part/reference numbers: ${parts.join(', ')}`:null].filter(Boolean).join('\n');
 const message=`Hello,\n\nWe're sourcing ${i.product_type||opp.title} for the New Zealand market.\n\nReference information:\n${i.make||i.model?`Vehicle / product family: ${[i.make,i.model].filter(Boolean).join(' ')}\n`:''}${refs}${refs?'\n':''}\nCould you please confirm:\n• Exact compatible models / variants\n• Manufacturer and OEM/reference numbers\n• Available versions / colours / specifications\n• MOQ\n• Unit pricing at 5 / 10 / 25 / 50 units\n• Sample pricing\n• Product photos and packaging\n• Lead time\n• Shipping options to New Zealand\n\nPlease do not assume compatibility from the codes above; confirm the exact variant for each item you quote.\n\nThank you.`;
 return {search_terms:[...new Set(search_terms)],message,generated_at:new Date().toISOString(),identity_snapshot:i};
}
