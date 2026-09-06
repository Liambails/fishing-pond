import { adminClient } from '../../../lib/supabase';
import { detectMarketplace } from '../../../lib/marketplaces';
import { matchListingIncrementally } from '../../../lib/comparableMatcher';
import { detectNewIdRelist } from '../../../lib/relistMatcher';

function asNum(v: unknown) { if (v === null || v === undefined || v === '') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function asIso(v: unknown) { if (!v) return null; const d=new Date(String(v)); return Number.isNaN(d.getTime())?null:d.toISOString(); }
function activity(rows:any[]){
  const a=[...rows].filter(x=>x.captured_at).sort((x,y)=>Date.parse(x.captured_at)-Date.parse(y.captured_at));
  if(!a.length)return {observation_count:0,span_hours:0,views_per_day:null,view_delta:null,bid_delta:null,watcher_delta:null};
  const f=a[0],l=a[a.length-1],span=Math.max(0,(Date.parse(l.captured_at)-Date.parse(f.captured_at))/3600000);
  const delta=(x:any,y:any)=>x==null||y==null?null:Number(y)-Number(x);
  const vd=delta(f.views,l.views),bd=delta(f.bids,l.bids),wd=delta(f.watchers,l.watchers);
  return {observation_count:a.length,span_hours:Number(span.toFixed(2)),views_per_day:vd!=null&&span>=1?Number((vd/span*24).toFixed(2)):null,view_delta:vd,bid_delta:bd,watcher_delta:wd,latest_views:l.views,latest_bids:l.bids,latest_watchers:l.watchers};
}
function cadence(listing:any,rows:any[]){
  const a=activity(rows),own=String(listing?.metadata?.ownership||'').toLowerCase()==='own';

  // Initial learning ladder: capture #1 -> +6h -> #2 -> +6h -> #3 -> +12h -> #4.
  // This establishes early velocity and persistence before mature adaptive scheduling.
  if(a.observation_count<=1)return {hours:6,reason:'learning phase · second observation',evidence:a};
  if(a.observation_count===2)return {hours:6,reason:'learning phase · confirm early velocity',evidence:a};
  if(a.observation_count===3)return {hours:12,reason:'learning phase · establish first-day persistence',evidence:a};

  // Mature adaptive cadence. Raw view totals alone never determine performance.
  const v=a.views_per_day||0,b=a.bid_delta||0,w=a.watcher_delta||0;
  if(v>=12||b>=2)return {hours:6,reason:'high sustained view/bid activity',evidence:a};
  if(v>=6||b>=1||w>=2)return {hours:8,reason:'strong sustained activity',evidence:a};
  if(v>=2||w>=1||own)return {hours:12,reason:own?'own listing tracking':'active listing',evidence:a};
  return {hours:24,reason:'low recent activity',evidence:a};
}
function finalise(rows:any[],reason:string){
  const a=activity(rows),r=String(reason||'ended').toLowerCase(); let verdict='WEAK_EVIDENCE';
  if(r.includes('withdraw')||r.includes('remove'))verdict='WITHDRAWN_REMOVED';
  else if(a.observation_count<2||a.span_hours<6)verdict='INSUFFICIENT_EVIDENCE';
  else if((a.views_per_day||0)>=8||(a.bid_delta||0)>=2)verdict='STRONG_EVIDENCE';
  else if((a.views_per_day||0)>=3||(a.bid_delta||0)>=1||(a.watcher_delta||0)>=2)verdict='MODERATE_EVIDENCE';
  const score=Math.min(100,Math.round(20+Math.min(55,Math.max(0,a.views_per_day||0)*5)+Math.min(15,Math.max(0,a.bid_delta||0)*8)+Math.min(10,Math.max(0,a.watcher_delta||0)*3)));
  return {verdict,score,evidence:a};
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.trademe.co.nz',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Cobalt-Token, X-Fishing-Pond-Token',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const expected = process.env.COBALT_INGEST_TOKEN || process.env.FISHING_POND_INGEST_TOKEN;
  const got = req.headers.get('x-cobalt-token') || req.headers.get('x-fishing-pond-token');
  if (!expected || got !== expected) return json({ ok:false,error:'Unauthorized' }, { status:401 });
  const raw = await req.json();
  if (!raw?.url) return json({ok:false,error:'url is required'}, {status:400});
  let identity;
  try{identity=detectMarketplace(String(raw.url),raw.marketplace,raw.listing_id?String(raw.listing_id):null)}catch{return json({ok:false,error:'Invalid listing URL'},{status:400})}
  if(!identity.listingId)return json({ok:false,error:'Could not determine marketplace listing ID'},{status:400});

  const db=adminClient();
  const capturedAt=asIso(raw.captured_at) ?? new Date().toISOString();
  const {data:existing}=await db.from('listings').select('*').eq('marketplace',identity.marketplace).eq('listing_id',identity.listingId).maybeSingle();
  const metadata={...(existing?.metadata||{}),template:raw.template??existing?.metadata?.template??null,category_path:raw.category_path??existing?.metadata?.category_path??null,primary_image_url:raw.primary_image_url??existing?.metadata?.primary_image_url??null};
  const listingPayload:any={
    marketplace:identity.marketplace,listing_id:identity.listingId,url:identity.canonicalUrl,source_url:raw.source_url||raw.url,
    title:raw.listing_title||existing?.title||null,seller:raw.seller||existing?.seller||null,active:raw.listing_ended?false:true,
    last_seen:capturedAt,last_observed_at:capturedAt,metadata
  };
  const {data:listing,error:upErr}=await db.from('listings').upsert(listingPayload,{onConflict:'marketplace,listing_id'}).select('*').single();
  if(upErr||!listing)return json({ok:false,error:upErr?.message||'Listing upsert failed'},{status:500});

  const q=raw.extraction_quality||{};
  const observation:any={
    listing_uuid:listing.id,captured_at:capturedAt,lifecycle_episode:Number(existing?.lifecycle_episode||listing?.lifecycle_episode||1),collector_version:raw.collector_version||null,listing_mode:raw.listing_mode||null,
    buy_now_nzd:asNum(raw.buy_now_nzd),asking_price_nzd:asNum(raw.asking_price_nzd),starting_price_nzd:asNum(raw.starting_price_nzd),current_bid_nzd:asNum(raw.current_bid_nzd),
    views:asNum(raw.views),watchers:asNum(raw.watchers),bids:asNum(raw.bids),close_date:asIso(raw.close_date),close_remaining:raw.close_remaining||null,
    condition:raw.condition||null,location:raw.location||null,seller:raw.seller||null,seller_feedback_pct:asNum(raw.seller_feedback_pct),seller_feedback_count:asNum(raw.seller_feedback_count),
    seller_in_trade:raw.seller_in_trade??null,seller_address_verified:raw.seller_address_verified??null,seller_member_since:raw.seller_member_since||null,
    shipping_options:raw.shipping_options??null,pickup_available:raw.pickup_available??null,part_number:raw.part_number||null,part_number_candidates:raw.part_number_candidates??null,
    vehicle:raw.vehicle||null,chassis:raw.chassis||raw.chassis_code_label||null,years:raw.years||raw.vehicle_year_label||null,engine_code:raw.engine_code||raw.engine_code_label||null,part_type:raw.part_type||null,
    extraction_score:q.score??raw.extraction_score??null,quality_flags:q.warnings??raw.quality_flags??[],raw_snapshot:raw
  };
  const {error:obsErr}=await db.from('observations').upsert(observation,{onConflict:'listing_uuid,captured_at'});
  if(obsErr)return json({ok:false,error:obsErr.message},{status:500});
  const {data:history}=await db.from('observations').select('captured_at,views,watchers,bids').eq('listing_uuid',listing.id).order('captured_at',{ascending:false}).limit(12);

  const isEnded=Boolean(raw.listing_ended); let next:string|null=null; let interval:number|null=null; let cadenceReason='listing finalized'; let finalVerdict:string|null=null;
  if(isEnded){
    const reason=String(raw.listing_end_reason||'ended'); const f=finalise(history||[],reason); finalVerdict=f.verdict;
    const relistNext=new Date(Date.now()+6*3600_000).toISOString(); const watchUntil=new Date(Date.now()+7*86400_000).toISOString();
    await db.from('listings').update({active:false,lifecycle_state:'relist_watch',next_observation_at:relistNext,relist_check_count:0,relist_watch_until:watchUntil,finalized_at:capturedAt,final_verdict:f.verdict,final_score:f.score,final_evidence:f.evidence,closure_reason:reason,cadence_reason:'closed · relist check in 6h',consecutive_failures:0,last_error:null,last_success_source:String(raw.capture_source||'extension-manual')}).eq('id',listing.id);
    await db.from('listing_lifecycle_events').insert({listing_uuid:listing.id,listing_family_id:listing.listing_family_id||listing.id,marketplace:listing.marketplace,marketplace_listing_id:listing.listing_id,episode:Number(listing.lifecycle_episode||1),event_type:'closed_relist_watch',occurred_at:capturedAt,reason:{closure_reason:reason,next_check:relistNext}});
  }else{
    const c=cadence(listing,history||[]); interval=c.hours; cadenceReason=c.reason; next=new Date(Date.now()+c.hours*3600_000).toISOString();
    const own=String(listing?.metadata?.ownership||'').toLowerCase()==='own';
    const priority=own?95:(c.hours<=6?88:c.hours<=8?80:c.hours<=12?68:50);
    const wasRelistWatch=existing?.lifecycle_state==='relist_watch'; const episode=wasRelistWatch?Number(existing?.lifecycle_episode||1)+1:Number(existing?.lifecycle_episode||listing?.lifecycle_episode||1);
    await db.from('listings').update({active:true,lifecycle_state:'active',lifecycle_episode:episode,next_observation_at:next,observation_interval_hours:c.hours,priority,cadence_reason:wasRelistWatch?'relisted · same marketplace ID':c.reason,consecutive_failures:0,last_error:null,last_success_source:String(raw.capture_source||'extension-manual'),finalized_at:null,final_verdict:null,final_score:null,final_evidence:{},closure_reason:null,relist_check_count:0,relist_watch_until:null,last_relisted_at:wasRelistWatch?capturedAt:(existing?.last_relisted_at||null)}).eq('id',listing.id);
    if(wasRelistWatch)await db.from('listing_lifecycle_events').insert({listing_uuid:listing.id,listing_family_id:existing?.listing_family_id||listing.id,marketplace:listing.marketplace,marketplace_listing_id:listing.listing_id,episode,event_type:'relisted_same_id',occurred_at:capturedAt,confidence:1,reason:{detected:'previously closed URL is active again'}});
  }

  // A successful manual capture is explicit recovery evidence for previous collection failures on this canonical listing.
  await db.from('collection_errors').update({status:'resolved',resolved_at:capturedAt,recovered_at:capturedAt,recovery_source:String(raw.capture_source||'extension-manual'),resolution_note:'Recovered by successful COBALT manual capture.'}).eq('listing_uuid',listing.id).eq('status','open');

  // If this is a newly-seen marketplace ID, check whether it is a relist of a recently closed offer from the same seller.
  let relistMatch:any=null;
  if(!existing&&!isEnded){try{relistMatch=await detectNewIdRelist(db,listing,{...observation,raw_snapshot:raw})}catch(e){console.error('[COBALT RELIST] detection failed',e)}}

  // Incremental comparable-market matching. This considers only blocked candidate products, not every product in the database.
  let comparableMatch={autoLinked:0,review:0};
  try{comparableMatch=await matchListingIncrementally(db,{...listing,metadata},{...observation,raw_snapshot:raw})}catch(e){console.error('Comparable matcher failed',e)}

  return json({ok:true,marketplace:identity.marketplace,listing_id:identity.listingId,continued:Boolean(existing),observation_saved:true,next_observation_at:next,observation_interval_hours:interval,cadence_reason:cadenceReason,final_verdict:finalVerdict,relist_match:relistMatch,comparable_match:comparableMatch});
}
