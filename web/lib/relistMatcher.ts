import {buildIdf,genericListingSimilarity,listingDocument} from './genericSimilarity';

const norm=(v:any)=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const tokens=(v:any)=>new Set(norm(v).split(/\s+/).filter(Boolean));
const jaccard=(a:Set<string>,b:Set<string>)=>{if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n)};
const price=(o:any)=>{for(const v of [o?.buy_now_nzd,o?.asking_price_nzd,o?.starting_price_nzd,o?.current_bid_nzd,o?.raw_snapshot?.buy_now_nzd,o?.raw_snapshot?.asking_price_nzd]){const n=Number(v);if(v!=null&&Number.isFinite(n))return n}return null};
const description=(o:any)=>String(o?.raw_snapshot?.description||'');
const category=(l:any,o:any)=>l?.metadata?.category_path||o?.raw_snapshot?.category_path||[];
const codeRx=/\b(?=[A-Z0-9._/-]{3,20}\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9]+(?:[-_/\.][A-Z0-9]+)*\b/gi;
function identifiers(l:any,o:any){const raw=o?.raw_snapshot||{};const vals:any[]=[];for(const src of [l,o,raw]){for(const k of ['part_number','seller_sku','chassis','chassis_code_label','engine_code','engine_code_label','model','model_label'])if(src?.[k])vals.push(src[k]);for(const k of ['part_number_candidates','qa_identity_codes'])if(Array.isArray(src?.[k]))vals.push(...src[k]);}for(const text of [l?.title,raw?.listing_title,raw?.description])vals.push(...(String(text||'').match(codeRx)||[]));return new Set(vals.map(v=>norm(v).replace(/\s/g,'')).filter(v=>v.length>=3&&!/^20\d\d$/.test(v)))}
function categoryListing(l:any,o:any){return {...l,metadata:{...(l?.metadata||{}),category_path:category(l,o)}}}
function parseIso(v:any){const n=Date.parse(String(v||''));return Number.isFinite(n)?n:null}

export type RelistComparison={match:boolean;score:number;reasons:string[];titleCosine:number;tokenOverlap:number;category:number;descriptionOverlap:number;identifierOverlap:string[];timingHours:number|null;ambiguous?:boolean};

export function compareRelist(candidateListing:any,candidateObs:any,closedListing:any,closedObs:any):RelistComparison{
 const reasons:string[]=[];
 const cs=norm(candidateListing?.seller||candidateObs?.seller||candidateObs?.raw_snapshot?.seller), ps=norm(closedListing?.seller||closedObs?.seller||closedObs?.raw_snapshot?.seller);
 if(!cs||!ps)return {match:false,score:0,reasons:['seller identity missing'],titleCosine:0,tokenOverlap:0,category:0,descriptionOverlap:0,identifierOverlap:[],timingHours:null};
 if(cs!==ps)return {match:false,score:0,reasons:['seller differs'],titleCosine:0,tokenOverlap:0,category:0,descriptionOverlap:0,identifierOverlap:[],timingHours:null};
 reasons.push('same seller');
 const a=categoryListing(candidateListing,candidateObs),b=categoryListing(closedListing,closedObs);const idf=buildIdf([listingDocument(a),listingDocument(b)]);const g=genericListingSimilarity(a,b,idf);
 const titleA=String(candidateListing?.title||candidateObs?.raw_snapshot?.listing_title||''),titleB=String(closedListing?.title||closedObs?.raw_snapshot?.listing_title||'');
 const tokenOverlap=jaccard(tokens(titleA),tokens(titleB));
 const descOverlap=jaccard(tokens(description(candidateObs)),tokens(description(closedObs)));
 const ai=identifiers(candidateListing,candidateObs),bi=identifiers(closedListing,closedObs);const overlap=[...ai].filter(x=>bi.has(x)).sort();
 let score=.30+g.cosine*.22+tokenOverlap*.16+g.category*.10+Math.min(.08,descOverlap*.08);
 if(g.cosine>=.65)reasons.push(`title similarity ${g.cosine.toFixed(2)}`);if(tokenOverlap>=.55)reasons.push(`title token overlap ${tokenOverlap.toFixed(2)}`);if(g.category>=.5)reasons.push(`category overlap ${g.category.toFixed(2)}`);if(descOverlap>=.55)reasons.push(`description overlap ${descOverlap.toFixed(2)}`);
 if(overlap.length){score+=.18;reasons.push(`shared identifier ${overlap.slice(0,3).join(', ')}`)}
 const ap=price(candidateObs),bp=price(closedObs);if(ap!=null&&bp!=null&&Math.max(ap,bp)>0){const diff=Math.abs(ap-bp)/Math.max(ap,bp);if(diff<=.15){score+=.05;reasons.push('price within 15%')}else if(diff>.65){score-=.04;reasons.push('large price change')}}
 const parentEnd=parseIso(closedListing?.finalized_at)||parseIso(closedObs?.close_date), childTime=parseIso(candidateObs?.captured_at)||Date.now();let timingHours:number|null=null;
 if(parentEnd!=null){timingHours=(childTime-parentEnd)/3600000;if(timingHours < -2)return {match:false,score:0,reasons:['candidate predates parent closure'],titleCosine:g.cosine,tokenOverlap,category:g.category,descriptionOverlap:descOverlap,identifierOverlap:overlap,timingHours};if(timingHours<=48){score+=.06;reasons.push('appeared within 48h of closure')}else if(timingHours<=14*24){score+=.03;reasons.push('appeared within 14 days of closure')}}
 score=Math.max(0,Math.min(1,score));const strongIdentity=overlap.length>0&&g.cosine>=.55&&(g.category>=.35||tokenOverlap>=.45);const match=score>=.82||(strongIdentity&&score>=.76);
 return {match,score:Number(score.toFixed(4)),reasons,titleCosine:Number(g.cosine.toFixed(4)),tokenOverlap:Number(tokenOverlap.toFixed(4)),category:Number(g.category.toFixed(4)),descriptionOverlap:Number(descOverlap.toFixed(4)),identifierOverlap:overlap,timingHours:timingHours==null?null:Number(timingHours.toFixed(2))};
}

export async function detectNewIdRelist(db:any,listing:any,obs:any){
 if(!listing?.seller)return null;const cutoff=new Date(Date.now()-14*86400_000).toISOString();
 const {data:closed}=await db.from('listings').select('*').eq('marketplace',listing.marketplace).eq('seller',listing.seller).neq('id',listing.id).in('lifecycle_state',['relist_watch','terminal_closed','relisted']).gte('finalized_at',cutoff).order('finalized_at',{ascending:false}).limit(40);
 const ranked:any[]=[];
 for(const old of closed||[]){const {data:oldObs}=await db.from('observations').select('*').eq('listing_uuid',old.id).eq('lifecycle_episode',Number(old.lifecycle_episode||1)).order('captured_at',{ascending:false}).limit(1).maybeSingle();if(!oldObs)continue;const match=compareRelist(listing,obs,old,oldObs);ranked.push({old,match});}
 ranked.sort((a,b)=>b.match.score-a.match.score);const best=ranked[0];if(!best)return null;const second=ranked[1];if(!best.match.match)return {linked:false,score:best.match.score,reasons:best.match.reasons};if(second&&second.match.score>=best.match.score-.08)return {linked:false,ambiguous:true,score:best.match.score,second_score:second.match.score,reasons:[...best.match.reasons,'ambiguous recent same-seller candidate']};
 const family=best.old.listing_family_id||best.old.id,episode=Number(best.old.lifecycle_episode||1)+1,now=new Date().toISOString();
 await db.from('listings').update({listing_family_id:family,relisted_from:best.old.id,lifecycle_episode:episode,lifecycle_state:'active',last_relisted_at:now,relist_check_count:0,relist_watch_until:null,relist_match_confidence:best.match.score,relist_detection_method:'semantic_new_id'}).eq('id',listing.id);
 await db.from('listings').update({active:false,lifecycle_state:'relisted',next_observation_at:null,relist_successor_uuid:listing.id,last_relist_checked_at:now,closure_reason:`relisted to #${listing.listing_id}`,cadence_reason:`relisted as marketplace listing ${listing.listing_id}`}).eq('id',best.old.id);
 await db.from('listing_lifecycle_events').insert({listing_uuid:listing.id,listing_family_id:family,marketplace:listing.marketplace,marketplace_listing_id:listing.listing_id,episode,event_type:'relisted_new_id',previous_listing_uuid:best.old.id,confidence:best.match.score,reason:{detection_method:'semantic_new_id',reasons:best.match.reasons,title_similarity:best.match.titleCosine,token_overlap:best.match.tokenOverlap,description_overlap:best.match.descriptionOverlap,category:best.match.category,identifier_overlap:best.match.identifierOverlap,counter_reset_is_new_episode:true}});
 return {linked:true,from:best.old.listing_id,score:best.match.score,reasons:best.match.reasons,episode};
}
