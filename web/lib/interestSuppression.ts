import {buildIdf,genericListingSimilarity,isStrongGenericMatch,listingDocument} from './genericSimilarity';

export const INTEREST_MATCHER_VERSION='generic-interest-v1';

export function latestObservationExtra(obs:any){
  if(!obs)return {};
  const raw=obs?.raw_snapshot&&typeof obs.raw_snapshot==='object'?obs.raw_snapshot:{};
  return {
    product_type:obs?.part_type??raw?.product_type??raw?.part_type,
    brand:raw?.brand??raw?.make_label,
    model:raw?.model??raw?.model_label,
    vehicle:obs?.vehicle??raw?.vehicle,
    chassis:obs?.chassis??raw?.chassis_code_label,
    years:obs?.years??raw?.vehicle_year_label,
    identifiers:[obs?.part_number,...(Array.isArray(obs?.part_number_candidates)?obs.part_number_candidates:[]),raw?.seller_sku].filter(Boolean),
  };
}

export function exclusionReference(profile:any){
  const snapshot=profile?.reference_snapshot&&typeof profile.reference_snapshot==='object'?profile.reference_snapshot:{};
  return {
    id:profile?.source_listing_uuid||profile?.id,
    title:profile?.signature_text||snapshot?.title||'',
    metadata:{category_path:profile?.category_path||snapshot?.category_path||[],...(snapshot?.metadata||{})}
  };
}

export function scoreAgainstProfiles(listing:any,extra:any,profiles:any[]){
  const refs=profiles.map(exclusionReference);
  const docs=[listingDocument(listing,extra),...refs.map((r:any)=>listingDocument(r))];
  const idf=buildIdf(docs);
  return profiles.map((profile:any,i:number)=>{
    const match=genericListingSimilarity(listing,refs[i],idf,extra,profile?.reference_snapshot?.extra||{});
    return {profile,match,suppress:isStrongGenericMatch(match)};
  }).sort((a,b)=>b.match.score-a.match.score);
}
