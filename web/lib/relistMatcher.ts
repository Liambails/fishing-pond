import {cosineSimilarity, normalizePartFamily, listingShape} from './comparableMatcher';

const norm=(v:any)=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const money=(o:any)=>Number(o?.buy_now_nzd??o?.asking_price_nzd??o?.current_bid_nzd??NaN);
const description=(o:any)=>String(o?.raw_snapshot?.description||'');
const nums=(o:any)=>new Set([o?.part_number,...(Array.isArray(o?.part_number_candidates)?o.part_number_candidates:[])].filter(Boolean).map((x:any)=>norm(x).replace(/\s/g,'')));

export function compareRelist(candidateListing:any,candidateObs:any,closedListing:any,closedObs:any){
  const reasons:string[]=[];
  if(!candidateListing||!closedListing)return {match:false,score:0,reasons:['missing listing evidence']};
  if(norm(candidateListing.seller)!==norm(closedListing.seller))return {match:false,score:0,reasons:['seller differs']};
  let score=.28; reasons.push('same seller');
  const a=listingShape(candidateListing,candidateObs),b=listingShape(closedListing,closedObs);
  if(a.partFamily&&b.partFamily&&a.partFamily!==b.partFamily)return {match:false,score:0,reasons:['part family differs']};
  if(a.partFamily&&a.partFamily===b.partFamily){score+=.22;reasons.push('same part family')}
  if(a.chassis&&b.chassis&&a.chassis===b.chassis){score+=.14;reasons.push('same chassis')}
  if(a.model&&b.model&&a.model===b.model){score+=.08;reasons.push('same model')}
  const titleCos=cosineSimilarity(candidateListing.title||'',closedListing.title||'');
  const descCos=cosineSimilarity(description(candidateObs),description(closedObs));
  score+=Math.min(.14,titleCos*.14)+Math.min(.08,descCos*.08);
  if(titleCos>=.6)reasons.push(`title cosine ${titleCos.toFixed(2)}`);
  if(descCos>=.5)reasons.push(`description cosine ${descCos.toFixed(2)}`);
  const an=nums(candidateObs),bn=nums(closedObs); const overlap=[...an].filter(x=>bn.has(x));
  if(overlap.length){score+=.12;reasons.push(`part/reference overlap ${overlap.slice(0,2).join(', ')}`)}
  const ap=money(candidateObs),bp=money(closedObs);
  if(Number.isFinite(ap)&&Number.isFinite(bp)&&Math.max(ap,bp)>0){const diff=Math.abs(ap-bp)/Math.max(ap,bp);if(diff<=.15){score+=.06;reasons.push('price within 15%')}else if(diff>.5){score-=.05;reasons.push('large price change')}}
  const final=Math.max(0,Math.min(1,score));
  return {match:final>=.82,score:Number(final.toFixed(4)),titleCosine:Number(titleCos.toFixed(4)),descriptionCosine:Number(descCos.toFixed(4)),reasons};
}

export async function detectNewIdRelist(db:any,listing:any,obs:any){
  if(!listing?.seller)return null;
  const cutoff=new Date(Date.now()-14*86400_000).toISOString();
  const {data:closed}=await db.from('listings').select('*').eq('marketplace',listing.marketplace).eq('seller',listing.seller).neq('id',listing.id).in('lifecycle_state',['relist_watch','terminal_closed']).gte('finalized_at',cutoff).order('finalized_at',{ascending:false}).limit(25);
  let best:any=null;
  for(const old of closed||[]){
    const {data:oldObs}=await db.from('observations').select('*').eq('listing_uuid',old.id).order('captured_at',{ascending:false}).limit(1).maybeSingle();
    if(!oldObs)continue; const m=compareRelist(listing,obs,old,oldObs); if(!best||m.score>best.match.score)best={old,match:m};
  }
  if(!best?.match?.match)return best?{linked:false,score:best.match.score,reasons:best.match.reasons}:null;
  const family=best.old.listing_family_id||best.old.id; const episode=Number(best.old.lifecycle_episode||1)+1; const now=new Date().toISOString();
  await db.from('listings').update({listing_family_id:family,relisted_from:best.old.id,lifecycle_episode:episode,lifecycle_state:'active',last_relisted_at:now,relist_check_count:0,relist_watch_until:null}).eq('id',listing.id);
  await db.from('listing_lifecycle_events').insert({listing_uuid:listing.id,listing_family_id:family,marketplace:listing.marketplace,marketplace_listing_id:listing.listing_id,episode,event_type:'relisted_new_id',previous_listing_uuid:best.old.id,confidence:best.match.score,reason:{reasons:best.match.reasons,title_cosine:best.match.titleCosine,description_cosine:best.match.descriptionCosine}});
  return {linked:true,from:best.old.listing_id,score:best.match.score,reasons:best.match.reasons};
}
