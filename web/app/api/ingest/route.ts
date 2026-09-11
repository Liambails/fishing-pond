import { adminClient } from '../../../lib/supabase';
import { detectMarketplace } from '../../../lib/marketplaces';
import { matchListingIncrementally } from '../../../lib/comparableMatcher';
import { detectNewIdRelist } from '../../../lib/relistMatcher';
import { normalizeMarketplaceCloseDate } from '../../../lib/closeDate';
import {scoreAgainstProfiles} from '../../../lib/interestSuppression';

function asNum(v: unknown) { if (v === null || v === undefined || v === '') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function asIso(v: unknown) { if (!v) return null; const d=new Date(String(v)); return Number.isNaN(d.getTime())?null:d.toISOString(); }
function trustedViewSource(raw:any){
  const source=String(raw?._sources?.views?.source||raw?.raw_sources_json?.views?.source||'');
  if(!source)return true; // older trusted collectors may not include provenance
  return !source.startsWith('page-text:');
}
function quarantineUnsafeViews(raw:any){
  if(asNum(raw?.views)==null||trustedViewSource(raw))return raw;
  const source=String(raw?._sources?.views?.source||raw?.raw_sources_json?.views?.source||'unknown');
  return {...raw,views:null,extraction_quality:{...(raw?.extraction_quality||{}),warnings:[...new Set([...(raw?.extraction_quality?.warnings||[]),'unsafe_view_source'])]},_view_guard:{quarantined:true,source,reason:'whole-page view fallback is not trusted'}};
}
function effectiveEnded(raw:any){
  if(Boolean(raw?.listing_ended))return true;
  const close=normalizeMarketplaceCloseDate(raw?.close_date);
  if(!close)return false;
  const t=Date.parse(close);
  return Number.isFinite(t)&&t<=Date.now()-2*60_000;
}

function sameIdRelistEvidence(existing:any,raw:any,previous:any){
  if(!existing||effectiveEnded(raw))return {detected:false,evidence:{}};
  const now=Date.now();
  const previousClose=previous?.close_date?Date.parse(String(previous.close_date)):NaN;
  const currentIso=normalizeMarketplaceCloseDate(raw?.close_date);
  const currentClose=currentIso?Date.parse(currentIso):NaN;
  const elapsedPrevious=Number.isFinite(previousClose)&&previousClose<=now-2*60_000;
  const futureCurrent=Number.isFinite(currentClose)&&currentClose>=now+10*60_000;
  const closeAdvanced=Number.isFinite(previousClose)&&Number.isFinite(currentClose)&&currentClose>previousClose+30*60_000;
  const reset=(before:any,after:any,minDrop:number)=>{const a=asNum(before),b=asNum(after);return a!=null&&b!=null&&a-b>=minDrop&&b<=Math.max(2,a*.6)};
  const stateReopened=['relist_watch','terminal_closed','relisted'].includes(String(existing.lifecycle_state||''));
  const evidence={same_marketplace_id:true,prior_state:String(existing.lifecycle_state||'active'),previous_close_date:previous?.close_date||null,current_close_date:currentIso,previous_close_elapsed:elapsedPrevious,current_close_future:futureCurrent,close_date_advanced:closeAdvanced,views_reset:reset(previous?.views,raw?.views,3),bids_reset:reset(previous?.bids,raw?.bids,1),watchers_reset:reset(previous?.watchers,raw?.watchers,2),previous_views:asNum(previous?.views),current_views:asNum(raw?.views)};
  return {detected:Boolean((stateReopened&&futureCurrent)||(elapsedPrevious&&futureCurrent&&closeAdvanced)||(elapsedPrevious&&(futureCurrent||stateReopened)&&evidence.views_reset)),evidence};
}

function activity(rows:any[]){
  const a=[...rows].filter(x=>x.captured_at).sort((x,y)=>Date.parse(x.captured_at)-Date.parse(y.captured_at));
  if(!a.length)return {observation_count:0,span_hours:0,views_per_day:null,view_delta:null,bid_delta:null,watcher_delta:null,independent_intervals:[],recent_view_gains:[]};
  const f=a[0],l=a[a.length-1],span=Math.max(0,(Date.parse(l.captured_at)-Date.parse(f.captured_at))/3600000);
  const delta=(x:any,y:any)=>x==null||y==null?null:Number(y)-Number(x);
  const vd=delta(f.views,l.views),bd=delta(f.bids,l.bids),wd=delta(f.watchers,l.watchers);
  const independent:any[]=[];
  for(const row of a){if(row.views==null)continue;if(!independent.length){independent.push(row);continue;}const gap=(Date.parse(row.captured_at)-Date.parse(independent[independent.length-1].captured_at))/3600000;if(gap>=3)independent.push(row);else independent[independent.length-1]=row;}
  const intervals=independent.slice(1).map((row,i)=>{const prev=independent[i];const hours=Math.max(0,(Date.parse(row.captured_at)-Date.parse(prev.captured_at))/3600000);const gain=Math.max(0,Number(row.views)-Number(prev.views));return {hours:Number(hours.toFixed(2)),gain};});
  const recent=intervals.slice(-2);
  return {observation_count:a.length,span_hours:Number(span.toFixed(2)),views_per_day:vd!=null&&vd>=0&&span>=1?Number((vd/span*24).toFixed(2)):null,view_delta:vd!=null&&vd>=0?vd:null,bid_delta:bd,watcher_delta:wd,latest_views:l.views,latest_bids:l.bids,latest_watchers:l.watchers,independent_count:independent.length,independent_intervals:intervals,recent_view_gains:recent.map(x=>x.gain)};
}
function cadence(listing:any,rows:any[]){
  const a=activity(rows),own=String(listing?.metadata?.ownership||'').toLowerCase()==='own';
  const gains=(a.recent_view_gains||[]) as number[];const last=gains.length?gains[gains.length-1]:0;const prior=gains.length>=2?gains[gains.length-2]:0;const two=gains.length>=2;
  const b=Math.max(0,Number(a.bid_delta||0)),w=Math.max(0,Number(a.watcher_delta||0));
  if(Number(a.observation_count||0)<=1)return {hours:.5,reason:'learning burst · first follow-up in 30 minutes',evidence:a};
  if(Number(a.independent_count||0)<=1)return {hours:3,reason:'learning · establish the first reliable 3h window',evidence:a};
  if(Number(a.independent_count||0)===2)return {hours:last>=4?2:6,reason:last>=4?'heating up · strong gain in the latest reliable window':'learning · confirm the early pattern',evidence:a};
  if((two&&last>=3&&prior>=3)||(last>=5&&b>=1)||b>=2)return {hours:2,reason:'hot · repeated strong gains across reliable checks',evidence:a};
  if((two&&last+prior>=4&&last>=1&&prior>=1)||last>=3||b>=1||w>=2)return {hours:4,reason:'warm · sustained marketplace attention',evidence:a};
  if(last>=1||own)return {hours:8,reason:own?'normal · own listing tracking':'normal · some recent movement',evidence:a};
  if(two&&last===0&&prior===0)return {hours:18,reason:'cold · no new views across two reliable checks',evidence:a};
  return {hours:12,reason:'normal · waiting for a clearer pattern',evidence:a};
}
function closeAwareHours(baseHours:number,closeIso:string|null){
  if(!closeIso)return {hours:baseHours,reason:''};
  const closeMs=Date.parse(closeIso);if(!Number.isFinite(closeMs)||closeMs<=Date.now())return {hours:baseHours,reason:''};
  const left=(closeMs-Date.now())/3600000;let cap:number|null=null;
  if(left<=3)cap=.5;else if(left<=6)cap=1;else if(left<=12)cap=2;else if(left<=24)cap=4;
  return cap!=null&&baseHours>cap?{hours:cap,reason:`closing soon · ${left.toFixed(1)}h left`}:{hours:baseHours,reason:''};
}

const REQUIRED_CAPTURE_WARNINGS = new Set(['missing_listing_id','missing_title','missing_price','missing_views','missing_seller','missing_description']);
function captureQuality(raw:any){
  const q=raw?.extraction_quality||{};
  const warnings=Array.isArray(q.warnings)?q.warnings.map(String):[];
  const pricePresent=[raw?.buy_now_nzd,raw?.asking_price_nzd,raw?.starting_price_nzd,raw?.current_bid_nzd,raw?.sold_price_nzd].some(v=>asNum(v)!=null);
  const derived:string[]=[];
  if(!raw?.listing_id)derived.push('missing_listing_id');
  if(!raw?.listing_title)derived.push('missing_title');
  if(!pricePresent)derived.push('missing_price');
  if(asNum(raw?.views)==null)derived.push('missing_views');
  if(!raw?.seller)derived.push('missing_seller');
  if(!raw?.description)derived.push('missing_description');
  const relevant=[...new Set([...warnings.filter((w:string)=>REQUIRED_CAPTURE_WARNINGS.has(w)),...derived])];
  return {complete:relevant.length===0,warnings:relevant,score:q.score??raw?.extraction_score??null};
}
function observationProvesComplete(o:any){
  const raw=o?.raw_snapshot||{};
  if(raw?.extraction_quality)return captureQuality(raw).complete;
  const flags=Array.isArray(o?.quality_flags)?o.quality_flags.map(String):[];
  if(flags.some((w:string)=>REQUIRED_CAPTURE_WARNINGS.has(w)))return false;
  const pricePresent=[o?.buy_now_nzd,o?.asking_price_nzd,o?.starting_price_nzd,o?.current_bid_nzd,o?.sold_price_nzd].some(v=>asNum(v)!=null);
  return Number(o?.extraction_score)===100&&pricePresent&&asNum(o?.views)!=null&&Boolean(o?.seller);
}
function metadataCaptureComplete(metadata:any){return metadata?.initial_capture_complete===true;}

function listingCaptureSummary(raw:any,capturedAt:string){
  const keys=['collector_version','listing_title','description','listing_mode','buy_now_nzd','asking_price_nzd','starting_price_nzd','current_bid_nzd','sold_price_nzd','views','watchers','bids','close_date','close_remaining','listing_status','listing_ended','listing_end_reason','sold_detected','condition','location','seller','seller_feedback_pct','seller_feedback_count','seller_in_trade','seller_address_verified','seller_member_since','shipping_options','pickup_available','q_and_a','question_count','buy_now_available','offer_available','stock_quantity','category_path','breadcrumbs','primary_image_url','marketplace_attributes','marketplace_attribute_map','extraction_quality','_sources'];
  const out:any={captured_at:capturedAt};for(const k of keys)if(raw?.[k]!==undefined)out[k]=raw[k];return out;
}

const MANUAL_CAPTURE_EPISODE_MS=3*60*1000;
function captureSourceKind(value:any){
  const s=String(value||'').toLowerCase();
  if(s.startsWith('extension'))return 'extension-manual';
  if(s.startsWith('worker'))return 'worker-auto';
  return s||'unknown';
}
function compactCaptureSample(raw:any,capturedAt:string){
  return {captured_at:capturedAt,views:asNum(raw?.views),watchers:asNum(raw?.watchers),bids:asNum(raw?.bids),capture_source:String(raw?.capture_source||'unknown')};
}
function authorized(req:Request){
  const expected=process.env.COBALT_INGEST_TOKEN||process.env.FISHING_POND_INGEST_TOKEN;
  const got=req.headers.get('x-cobalt-token')||req.headers.get('x-fishing-pond-token');
  return Boolean(expected&&got===expected);
}

function closureTimingEvidence(rows:any[],capturedAt:string,soldDetected:boolean){
  const closed=Date.parse(capturedAt); let scheduled:number|null=null;
  if(!Number.isFinite(closed))return {scheduled_close_date:null,observed_closed_at:capturedAt,closed_before_scheduled_close:false,sold_early:false,minutes_early:0,early_close_is_demand_signal:false};
  const ordered=[...(rows||[])].sort((a,b)=>Date.parse(b.captured_at||'')-Date.parse(a.captured_at||''));
  for(const row of ordered){
    const seen=Date.parse(row?.captured_at||''),close=Date.parse(row?.close_date||'');
    if(!Number.isFinite(seen)||!Number.isFinite(close)||seen>=closed-1000)continue;
    if(close>closed+5*60_000){scheduled=close;break;}
  }
  const early=scheduled!=null&&closed<scheduled-5*60_000;
  const minutesEarly=early&&scheduled!=null?Math.round(((scheduled-closed)/60000)*10)/10:0;
  return {scheduled_close_date:scheduled!=null?new Date(scheduled).toISOString():null,observed_closed_at:new Date(closed).toISOString(),closed_before_scheduled_close:early,sold_early:Boolean(early&&soldDetected),minutes_early:minutesEarly,early_close_is_demand_signal:Boolean(early&&soldDetected)};
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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


export async function GET(req: Request) {
  if(!authorized(req))return json({ok:false,error:'Unauthorized'},{status:401});
  const u=new URL(req.url);const marketplace=u.searchParams.get('marketplace')||'Trade Me';const listingId=u.searchParams.get('listing_id');
  if(!listingId)return json({ok:false,error:'listing_id is required'},{status:400});
  const db=adminClient();
  const {data:listing,error}=await db.from('listings').select('id,metadata').eq('marketplace',marketplace).eq('listing_id',listingId).maybeSingle();
  if(error)return json({ok:false,error:error.message},{status:500});
  if(!listing)return json({ok:true,exists:false,capture_complete:false});
  let complete=metadataCaptureComplete(listing.metadata);
  if(!complete){
    const {data:observations}=await db.from('observations').select('extraction_score,quality_flags,raw_snapshot,buy_now_nzd,asking_price_nzd,starting_price_nzd,current_bid_nzd,sold_price_nzd,views,seller').eq('listing_uuid',listing.id).order('captured_at',{ascending:false}).limit(20);
    complete=(observations||[]).some(observationProvesComplete);
  }
  return json({ok:true,exists:true,capture_complete:complete});
}

export async function POST(req: Request) {
  if(!authorized(req))return json({ok:false,error:'Unauthorized'},{status:401});
  const raw = quarantineUnsafeViews(await req.json());
  if (!raw?.url) return json({ok:false,error:'url is required'}, {status:400});
  let identity;
  try{identity=detectMarketplace(String(raw.url),raw.marketplace,raw.listing_id?String(raw.listing_id):null)}catch{return json({ok:false,error:'Invalid listing URL'},{status:400})}
  if(!identity.listingId)return json({ok:false,error:'Could not determine marketplace listing ID'},{status:400});

  const db=adminClient();
  const capturedAt=asIso(raw.captured_at) ?? new Date().toISOString();
  const {data:existing}=await db.from('listings').select('*').eq('marketplace',identity.marketplace).eq('listing_id',identity.listingId).maybeSingle();
  const isEnded=effectiveEnded(raw);
  const wasClosedState=Boolean(existing&&['relist_watch','terminal_closed','relisted'].includes(String(existing.lifecycle_state||'')));
  const {data:previousLifecycleObservation}=existing?await db.from('observations').select('captured_at,views,watchers,bids,close_date,lifecycle_episode').eq('listing_uuid',existing.id).eq('lifecycle_episode',Number(existing.lifecycle_episode||1)).order('captured_at',{ascending:false}).limit(1).maybeSingle():{data:null};
  const sameIdRelist=sameIdRelistEvidence(existing,raw,previousLifecycleObservation);
  const reopeningSameId=Boolean(existing&&!isEnded&&sameIdRelist.detected);
  const targetEpisode=Number(existing?.lifecycle_episode||1)+(reopeningSameId?1:0);
  const normalizedCloseDate=normalizeMarketplaceCloseDate(raw.close_date,new Date(capturedAt));
  const quality=captureQuality({...raw,listing_id:identity.listingId});
  let previouslyComplete=metadataCaptureComplete(existing?.metadata);
  if(existing&&!previouslyComplete){
    const {data:priorObservations}=await db.from('observations').select('extraction_score,quality_flags,raw_snapshot,buy_now_nzd,asking_price_nzd,starting_price_nzd,current_bid_nzd,sold_price_nzd,views,seller').eq('listing_uuid',existing.id).order('captured_at',{ascending:false}).limit(20);
    previouslyComplete=(priorObservations||[]).some(observationProvesComplete);
  }
  const captureComplete=previouslyComplete||quality.complete;
  const metadata={...(existing?.metadata||{}),template:raw.template??existing?.metadata?.template??null,category_path:raw.category_path??existing?.metadata?.category_path??null,primary_image_url:raw.primary_image_url??existing?.metadata?.primary_image_url??null,latest_capture:listingCaptureSummary(raw,capturedAt),initial_capture_complete:captureComplete,initial_capture_completed_at:existing?.metadata?.initial_capture_completed_at||(quality.complete?capturedAt:null),initial_capture_score:existing?.metadata?.initial_capture_score??(quality.complete?quality.score:null)};
  // User interest is an admission decision, not a demand signal. A listing already marked
  // not-interested stays suppressed, and newly discovered near-duplicates are rejected before
  // they enter the recurring observation queue. This matcher is category-agnostic.
  const existingQueueState=String(existing?.metadata?.observation_queue_status||'').toLowerCase();
  if(existingQueueState==='not_interested')return json({ok:true,suppressed:true,suppression_reason:'user_not_interested',marketplace:identity.marketplace,listing_id:identity.listingId,observation_saved:false});
  if(!existing){
    try{
      const {data:profiles}=await db.from('interest_suppressions').select('*').eq('active',true).eq('scope','similar').order('created_at',{ascending:false}).limit(250);
      if(profiles?.length){
        const candidate={title:raw.listing_title||null,metadata};
        const matches=scoreAgainstProfiles(candidate,raw,profiles);const best=matches[0];
        if(best?.suppress){
          await db.from('interest_suppression_hits').insert({suppression_id:best.profile.id,marketplace:identity.marketplace,marketplace_listing_id:identity.listingId,title:raw.listing_title||null,url:identity.canonicalUrl,score:best.match.score,evidence:{matcher_version:best.profile.matcher_version,cosine:best.match.cosine,token_overlap:best.match.tokenOverlap,category:best.match.category,identifier_overlap:best.match.identifierOverlap,reasons:best.match.reasons}});
          return json({ok:true,suppressed:true,suppression_reason:'user_not_interested_similar',matched_source_listing_uuid:best.profile.source_listing_uuid,similarity:best.match,marketplace:identity.marketplace,listing_id:identity.listingId,observation_saved:false});
        }
      }
    }catch(e){console.warn('[COBALT INTEREST] suppression unavailable; admitting listing',e)}
  }
  const listingPayload:any={
    marketplace:identity.marketplace,listing_id:identity.listingId,url:identity.canonicalUrl,source_url:raw.source_url||raw.url,
    title:raw.listing_title||existing?.title||null,seller:raw.seller||existing?.seller||null,active:!isEnded,
    last_seen:capturedAt,last_observed_at:capturedAt,metadata
  };
  const {data:listing,error:upErr}=await db.from('listings').upsert(listingPayload,{onConflict:'marketplace,listing_id'}).select('*').single();
  if(upErr||!listing)return json({ok:false,error:upErr?.message||'Listing upsert failed'},{status:500});

  const q=raw.extraction_quality||{};
  const observation:any={
    listing_uuid:listing.id,captured_at:capturedAt,lifecycle_episode:targetEpisode,collector_version:raw.collector_version||null,listing_mode:raw.listing_mode||null,
    buy_now_nzd:asNum(raw.buy_now_nzd),asking_price_nzd:asNum(raw.asking_price_nzd),starting_price_nzd:asNum(raw.starting_price_nzd),current_bid_nzd:asNum(raw.current_bid_nzd),sold_price_nzd:asNum(raw.sold_price_nzd),
    views:asNum(raw.views),watchers:asNum(raw.watchers),bids:asNum(raw.bids),close_date:normalizedCloseDate,close_remaining:raw.close_remaining||null,
    question_count:asNum(raw.question_count),purchase_intent_questions:asNum(raw.purchase_intent_questions),compatibility_questions:asNum(raw.compatibility_questions),condition_questions:asNum(raw.condition_questions),
    q_and_a:Array.isArray(raw.q_and_a)?raw.q_and_a:null,qa_identity_codes:Array.isArray(raw.qa_identity_codes)?raw.qa_identity_codes:null,
    buy_now_available:raw.buy_now_available??null,offer_available:raw.offer_available??null,stock_quantity:asNum(raw.stock_quantity),listing_status:raw.listing_status||null,sold_detected:raw.sold_detected??null,
    condition:raw.condition||null,location:raw.location||null,seller:raw.seller||null,seller_feedback_pct:asNum(raw.seller_feedback_pct),seller_feedback_count:asNum(raw.seller_feedback_count),
    seller_in_trade:raw.seller_in_trade??null,seller_address_verified:raw.seller_address_verified??null,seller_member_since:raw.seller_member_since||null,
    shipping_options:raw.shipping_options??null,pickup_available:raw.pickup_available??null,part_number:raw.part_number||null,part_number_candidates:raw.part_number_candidates??null,
    vehicle:raw.vehicle||null,chassis:raw.chassis||raw.chassis_code_label||null,years:raw.years||raw.vehicle_year_label||null,engine_code:raw.engine_code||raw.engine_code_label||null,part_type:raw.part_type||null,
    description:raw.description||null,category_path:Array.isArray(raw.category_path)?raw.category_path:null,primary_image_url:raw.primary_image_url||null,marketplace_attributes:Array.isArray(raw.marketplace_attributes)?raw.marketplace_attributes:[],
    extraction_score:q.score??raw.extraction_score??null,quality_flags:q.warnings??raw.quality_flags??[],raw_snapshot:raw
  };
  // Coalesce rapid duplicate/manual captures into one collection episode. We keep the
  // freshest observation value while retaining compact samples inside raw_snapshot for
  // diagnostics. This stops retries/refreshes seconds apart from advancing cadence or
  // creating fake market-velocity evidence. Different source families and state changes
  // are kept as separate rows.
  let observationCoalesced=false;
  let observationEpisodeCount=1;
  const {data:latestObservation}=await db.from('observations').select('*').eq('listing_uuid',listing.id).order('captured_at',{ascending:false}).limit(1).maybeSingle();
  const latestAt=latestObservation?.captured_at?Date.parse(latestObservation.captured_at):NaN;
  const currentAt=Date.parse(capturedAt);
  const sameSourceKind=latestObservation?captureSourceKind(latestObservation.raw_snapshot?.capture_source)===captureSourceKind(raw.capture_source):false;
  const sameEndedState=latestObservation?effectiveEnded(latestObservation.raw_snapshot||latestObservation)===isEnded:false;
  const sameLifecycleEpisode=latestObservation?Number(latestObservation.lifecycle_episode||1)===targetEpisode:false;
  const withinEpisode=Number.isFinite(latestAt)&&Number.isFinite(currentAt)&&currentAt>=latestAt&&(currentAt-latestAt)<=MANUAL_CAPTURE_EPISODE_MS;
  const canCoalesce=Boolean(latestObservation&&quality.complete&&sameSourceKind&&sameEndedState&&sameLifecycleEpisode&&withinEpisode);

  const repeatedClosedProbe=Boolean(isEnded&&existing&&wasClosedState);
  if(repeatedClosedProbe){
    observationEpisodeCount=0;
  }else if(canCoalesce){
    const previousEpisode=latestObservation.raw_snapshot?._capture_episode||{};
    const previousSamples=Array.isArray(previousEpisode.samples)?previousEpisode.samples:[];
    const firstCapturedAt=previousEpisode.first_captured_at||latestObservation.captured_at;
    const baseSamples=previousSamples.length?previousSamples:[compactCaptureSample(latestObservation.raw_snapshot||latestObservation,latestObservation.captured_at)];
    const samples=[...baseSamples,compactCaptureSample(raw,capturedAt)].slice(-12);
    observationEpisodeCount=Number(previousEpisode.count||1)+1;
    observation.raw_snapshot={...raw,_capture_episode:{coalesced:true,count:observationEpisodeCount,first_captured_at:firstCapturedAt,last_captured_at:capturedAt,window_seconds:Math.round((currentAt-Date.parse(firstCapturedAt))/1000),source_kind:captureSourceKind(raw.capture_source),samples}};
    const updateObservation={...observation}; delete updateObservation.listing_uuid;
    const {error:obsErr}=await db.from('observations').update(updateObservation).eq('id',latestObservation.id);
    if(obsErr)return json({ok:false,error:obsErr.message},{status:500});
    observationCoalesced=true;
  }else{
    observation.raw_snapshot={...raw,_capture_episode:{coalesced:false,count:1,first_captured_at:capturedAt,last_captured_at:capturedAt,window_seconds:0,source_kind:captureSourceKind(raw.capture_source),samples:[compactCaptureSample(raw,capturedAt)]}};
    const {error:obsErr}=await db.from('observations').upsert(observation,{onConflict:'listing_uuid,captured_at'});
    if(obsErr)return json({ok:false,error:obsErr.message},{status:500});
  }
  const {data:history}=await db.from('observations').select('captured_at,views,watchers,bids,close_date,sold_detected,lifecycle_episode').eq('listing_uuid',listing.id).eq('lifecycle_episode',targetEpisode).order('captured_at',{ascending:false}).limit(12);

  let next:string|null=null; let interval:number|null=null; let cadenceReason='listing finalized'; let finalVerdict:string|null=null;
  if(isEnded){
    const reason=String(raw.listing_end_reason||(normalizedCloseDate?'expired':'ended')); const f=finalise(history||[],reason);
    const timing=closureTimingEvidence(history||[],capturedAt,Boolean(raw.sold_detected));
    f.evidence={
      ...(f.evidence||{}),
      closure_timing:timing,
    } as typeof f.evidence & {
      closure_timing: ReturnType<typeof closureTimingEvidence>;
    };
    if(timing.sold_early){f.verdict='STRONG_EVIDENCE';f.score=Math.min(100,Math.max(Number(f.score||0),78)+12);}
    finalVerdict=f.verdict;
    const firstTransition=!wasClosedState;
    const checkCount=firstTransition?0:Number(existing?.relist_check_count||0)+1;
    const relistDelays=[1,6,18,48,96];
    const delayHours=relistDelays[Math.min(checkCount,relistDelays.length-1)];
    const watchUntil=existing?.relist_watch_until||new Date(Date.now()+10*86400_000).toISOString();
    const watchExpired=Date.parse(watchUntil)<=Date.now();
    const relistNext=watchExpired||checkCount>=relistDelays.length?null:new Date(Date.now()+delayHours*3600_000).toISOString();
    await db.from('listings').update({active:false,lifecycle_state:relistNext?'relist_watch':'terminal_closed',next_observation_at:relistNext,relist_check_count:checkCount,relist_watch_until:watchUntil,last_relist_checked_at:firstTransition?null:capturedAt,finalized_at:existing?.finalized_at||capturedAt,final_verdict:f.verdict,final_score:f.score,final_evidence:f.evidence,closure_reason:reason,cadence_reason:relistNext?(firstTransition?'ended · first relist check in 1h':`ended · relist watch check ${checkCount+1}/${relistDelays.length}`):'ended · relist watch complete',consecutive_failures:0,last_error:null,last_success_source:String(raw.capture_source||'extension-manual')}).eq('id',listing.id);
    if(firstTransition)await db.from('listing_lifecycle_events').insert({listing_uuid:listing.id,listing_family_id:listing.listing_family_id||listing.id,marketplace:listing.marketplace,marketplace_listing_id:listing.listing_id,episode:targetEpisode,event_type:'closed_relist_watch',occurred_at:capturedAt,reason:{closure_reason:reason,next_check:relistNext,effective_end_from_close_date:!Boolean(raw.listing_ended),closure_timing:timing}});
  }else{
    const c=cadence(listing,history||[]);const closing=closeAwareHours(c.hours,normalizedCloseDate);interval=closing.hours;cadenceReason=closing.reason?`${c.reason} · ${closing.reason}`:c.reason;
    let nextMs=Date.now()+interval*3600_000;
    if(normalizedCloseDate){const closeMs=Date.parse(normalizedCloseDate)+10*60_000;if(Number.isFinite(closeMs)&&closeMs>Date.now()&&closeMs<nextMs){nextMs=closeMs;interval=Math.max(.01,(nextMs-Date.now())/3600000);cadenceReason=`${cadenceReason} · closure confirmation 10m after expiry`;}}
    next=new Date(nextMs).toISOString();
    const own=String(listing?.metadata?.ownership||'').toLowerCase()==='own'; const priority=own?95:(interval<=.5?98:interval<=2?95:interval<=3?92:interval<=6?88:interval<=12?68:50);
    await db.from('listings').update({active:true,lifecycle_state:'active',lifecycle_episode:targetEpisode,next_observation_at:next,observation_interval_hours:interval,priority,cadence_reason:reopeningSameId?'relisted · same marketplace ID · new episode':cadenceReason,consecutive_failures:0,last_error:null,last_success_source:String(raw.capture_source||'extension-manual'),finalized_at:null,final_verdict:null,final_score:null,final_evidence:{},closure_reason:null,relist_check_count:0,relist_watch_until:null,last_relisted_at:reopeningSameId?capturedAt:(existing?.last_relisted_at||null),relist_match_confidence:reopeningSameId?1:(existing?.relist_match_confidence||null),relist_detection_method:reopeningSameId?'same_marketplace_id_reopened':(existing?.relist_detection_method||null)}).eq('id',listing.id);
    if(reopeningSameId)await db.from('listing_lifecycle_events').insert({listing_uuid:listing.id,listing_family_id:existing?.listing_family_id||listing.id,marketplace:listing.marketplace,marketplace_listing_id:listing.listing_id,episode:targetEpisode,event_type:'relisted_same_id',occurred_at:capturedAt,confidence:1,reason:{detected:'same marketplace ID began a new live lifecycle episode',counter_reset_is_new_episode:true,...sameIdRelist.evidence}});
  }

  // A successful manual capture is explicit recovery evidence for previous collection failures on this canonical listing.
  await db.from('collection_errors').update({status:'resolved',resolved_at:capturedAt,recovered_at:capturedAt,recovery_source:String(raw.capture_source||'extension-manual'),resolution_note:'Recovered by successful COBALT manual capture.'}).eq('listing_uuid',listing.id).eq('status','open');

  // If this is a newly-seen marketplace ID, check whether it is a relist of a recently closed offer from the same seller.
  let relistMatch:any=null;
  if(!existing&&!isEnded){try{relistMatch=await detectNewIdRelist(db,listing,{...observation,raw_snapshot:raw})}catch(e){console.error('[COBALT RELIST] detection failed',e)}}

  // Incremental comparable-market matching. This considers only blocked candidate products, not every product in the database.
  let comparableMatch={autoLinked:0,review:0};
  try{comparableMatch=await matchListingIncrementally(db,{...listing,metadata},{...observation,raw_snapshot:raw})}catch(e){console.error('Comparable matcher failed',e)}

  return json({ok:true,marketplace:identity.marketplace,listing_id:identity.listingId,continued:Boolean(existing),already_saved:previouslyComplete,capture_complete:captureComplete,capture_warnings:captureComplete?[]:quality.warnings,observation_saved:!repeatedClosedProbe,observation_coalesced:observationCoalesced,observation_episode_count:observationEpisodeCount,next_observation_at:next,observation_interval_hours:interval,cadence_reason:cadenceReason,final_verdict:finalVerdict,relist_match:relistMatch,comparable_match:comparableMatch});
}
