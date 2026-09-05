import {adminClient} from '../lib/supabase';
import {computeProductMetrics,computeListingSignals} from '../lib/intelligence';
import Dashboard from '../components/Dashboard';
export const dynamic='force-dynamic';

function median(values:number[]){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function observationSpanHours(listing:any){
 const times=(listing?.observations||[]).map((o:any)=>Date.parse(o.captured_at)).filter(Number.isFinite).sort((a:number,b:number)=>a-b);
 if(times.length<2)return 0;
 return (times[times.length-1]-times[0])/3600000;
}

export default async function Page(){
 const db=adminClient();
 const [{data:products},{data:listings},{data:obs},{data:errors},{data:events},{data:links},{data:ownListings}]=await Promise.all([
  db.from('products').select('*').is('archived_at',null).order('priority',{ascending:false}).limit(100),
  db.from('listings').select('*').order('next_observation_at',{ascending:true}).limit(250),
  db.from('observations').select('listing_uuid,captured_at,views,watchers,bids,buy_now_nzd,asking_price_nzd,starting_price_nzd,current_bid_nzd,close_date,close_remaining').order('captured_at',{ascending:false}).limit(5000),
  db.from('collection_errors').select('*').order('occurred_at',{ascending:false}).limit(150),
  db.from('system_events').select('*').order('occurred_at',{ascending:false}).limit(150),
  db.from('product_listings').select('*'),
  db.from('own_listings').select('*').eq('active',true)
 ]);
 const baseLs=(listings||[]).map((l:any)=>({...l,observations:(obs||[]).filter((o:any)=>o.listing_uuid===l.id).slice(0,40)}));
 const signals=computeListingSignals(baseLs);
 const ls=baseLs.map((l:any,i:number)=>({...l,signal:signals[i]}));
 const ps=(products||[]).map((p:any)=>{
  const productLinks=(links||[]).filter((x:any)=>x.product_id===p.id);
  const competitorIds=new Set(productLinks.filter((x:any)=>x.role!=='own').map((x:any)=>x.listing_uuid));
  const ownIds=new Set(productLinks.filter((x:any)=>x.role==='own').map((x:any)=>x.listing_uuid));
  const competitorListings=ls.filter((l:any)=>competitorIds.has(l.id)||(!ownIds.has(l.id)&&l.product_id===p.id));
  const ownCanonicalListings=ls.filter((l:any)=>ownIds.has(l.id));
  const own=(ownListings||[]).filter((x:any)=>x.product_id===p.id);
  const marketMetrics=computeProductMetrics(p,competitorListings);
  const ownPrimary=ownCanonicalListings[0]||null;
  const ownObsCount=ownPrimary?.signal?.observationCount||0;
  const ownSpanHours=observationSpanHours(ownPrimary);
  const competitorVelocities=competitorListings.map((l:any)=>l.signal?.velocity).filter((v:any)=>typeof v==='number') as number[];
  const peerMedianVelocity=median(competitorVelocities);
  const ownVelocity=typeof ownPrimary?.signal?.velocity==='number'?Number(ownPrimary.signal.velocity):null;
  const enoughCompetitorContext=competitorListings.length>=1;
  const readyForScoring=Boolean(ownPrimary&&ownObsCount>=3&&ownSpanHours>=20&&enoughCompetitorContext&&ownVelocity!=null);
  let performanceScore:number|null=null;
  let performanceRatio:number|null=null;
  if(readyForScoring&&ownVelocity!=null){
    if(peerMedianVelocity!=null&&peerMedianVelocity>.1){
      performanceRatio=ownVelocity/peerMedianVelocity;
      performanceScore=Math.round(Math.max(0,Math.min(100,50+25*Math.log2(Math.max(.25,performanceRatio)))));
    }else{
      performanceScore=Math.round(Math.max(0,Math.min(100,ownPrimary?.signal?.score||50)));
    }
  }
  const verdict=performanceScore==null?null:performanceScore>=80?'STRONG':performanceScore>=65?'PROMISING':performanceScore>=50?'WATCH':'WEAK';
  const confidence=readyForScoring?Math.min(100,Math.round((ownPrimary?.signal?.confidence||0)*.7+marketMetrics.confidence*.3)):null;
  const sourceListing=ls.find((l:any)=>l.id===p.source_listing_uuid)||competitorListings[0]||null;
  const name=p.display_name||sourceListing?.title||[p.vehicle_make,p.vehicle_model,p.chassis,p.part_type].filter(Boolean).join(' ')||p.part_type||p.slug||'Untitled product';
  return {
    ...p,
    name,sourceListing,listings:competitorListings,ownListings:own,ownCanonicalListings,ownPrimary,
    ownObservationCount:ownObsCount,ownObservationSpanHours:ownSpanHours,readyForScoring,peerMedianVelocity,performanceRatio,
    metrics:{...marketMetrics,verdict,score:performanceScore,confidence}
  };
 });
 const enrichedErrors=(errors||[]).map((e:any)=>{const l=ls.find((x:any)=>x.id===e.listing_uuid)||ls.find((x:any)=>String(x.listing_id)===String(e.listing_id));return {...e,marketplace:l?.marketplace||null,listing_title:l?.title||null,consecutive_failures:l?.consecutive_failures||0,next_observation_at:l?.next_observation_at||null,cadence_reason:l?.cadence_reason||null};});
 return <Dashboard products={ps} listings={ls} interventions={enrichedErrors} systemEvents={events||[]} aiEnabled={Boolean(process.env.OPENAI_API_KEY)}/>;
}
