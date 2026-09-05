import { adminClient } from '../../../lib/supabase';

function canonical(v: unknown) { return String(v ?? '').replace(/[?#].*$/, ''); }
function asNum(v: unknown) { if (v === null || v === undefined || v === '') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function asIso(v: unknown) { if (!v) return null; const d=new Date(String(v)); return Number.isNaN(d.getTime())?null:d.toISOString(); }

export async function POST(req: Request) {
  const expected = process.env.FISHING_POND_INGEST_TOKEN;
  const got = req.headers.get('x-fishing-pond-token');
  if (!expected || got !== expected) return Response.json({ ok:false,error:'Unauthorized' }, { status:401 });
  const raw = await req.json();
  if (!raw?.listing_id || !raw?.url) return Response.json({ok:false,error:'listing_id and url are required'}, {status:400});
  const db=adminClient();
  const capturedAt=asIso(raw.captured_at) ?? new Date().toISOString();
  const url=canonical(raw.url);
  const listingPayload:any={
    marketplace: raw.marketplace || 'Trade Me', listing_id:String(raw.listing_id), url, source_url:raw.source_url || raw.url,
    title: raw.listing_title || null, seller: raw.seller || null, active:true, last_seen:capturedAt, last_observed_at:capturedAt,
    metadata: { template: raw.template ?? null, category_path: raw.category_path ?? null, primary_image_url: raw.primary_image_url ?? null }
  };
  const { data: listing, error: upErr } = await db.from('listings').upsert(listingPayload,{onConflict:'marketplace,listing_id'}).select('id,observation_interval_hours').single();
  if (upErr || !listing) return Response.json({ok:false,error:upErr?.message || 'Listing upsert failed'}, {status:500});
  const intervalH=listing.observation_interval_hours || 24;
  const next=new Date(new Date(capturedAt).getTime()+intervalH*3600_000).toISOString();
  await db.from('listings').update({next_observation_at:next,consecutive_failures:0,last_error:null}).eq('id',listing.id);
  const q=raw.extraction_quality || {};
  const observation:any={
    listing_uuid:listing.id,captured_at:capturedAt,collector_version:raw.collector_version||null,listing_mode:raw.listing_mode||null,
    buy_now_nzd:asNum(raw.buy_now_nzd),asking_price_nzd:asNum(raw.asking_price_nzd),starting_price_nzd:asNum(raw.starting_price_nzd),current_bid_nzd:asNum(raw.current_bid_nzd),
    views:asNum(raw.views),watchers:asNum(raw.watchers),bids:asNum(raw.bids),close_date:asIso(raw.close_date),close_remaining:raw.close_remaining||null,
    condition:raw.condition||null,location:raw.location||null,seller:raw.seller||null,seller_feedback_pct:asNum(raw.seller_feedback_pct),seller_feedback_count:asNum(raw.seller_feedback_count),
    seller_in_trade:raw.seller_in_trade ?? null,seller_address_verified:raw.seller_address_verified ?? null,seller_member_since:raw.seller_member_since||null,
    shipping_options:raw.shipping_options ?? null,pickup_available:raw.pickup_available ?? null,part_number:raw.part_number||null,part_number_candidates:raw.part_number_candidates ?? null,
    vehicle:raw.vehicle||null,chassis:raw.chassis||raw.chassis_code_label||null,years:raw.years||raw.vehicle_year_label||null,engine_code:raw.engine_code||raw.engine_code_label||null,part_type:raw.part_type||null,
    extraction_score:q.score ?? raw.extraction_score ?? null,quality_flags:q.warnings ?? raw.quality_flags ?? [],raw_snapshot:raw
  };
  const { error: obsErr }=await db.from('observations').upsert(observation,{onConflict:'listing_uuid,captured_at'});
  if (obsErr) return Response.json({ok:false,error:obsErr.message},{status:500});
  return Response.json({ok:true,listing_id:String(raw.listing_id),next_observation_at:next});
}
