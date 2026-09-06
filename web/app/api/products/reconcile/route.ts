import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {reconcileProduct,matchListingIncrementally} from '../../../../lib/comparableMatcher';

export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>({})); const db=adminClient();
  if(body.listingId){
    const expected=process.env.COBALT_INGEST_TOKEN||process.env.FISHING_POND_INGEST_TOKEN; const got=req.headers.get('x-cobalt-token')||req.headers.get('x-fishing-pond-token');
    if(!expected||got!==expected)return NextResponse.json({error:'Unauthorized'},{status:401});
    const {data:listing,error:le}=await db.from('listings').select('*').eq('id',body.listingId).single(); if(le||!listing)throw le||new Error('Listing not found');
    const {data:obs,error:oe}=await db.from('observations').select('*').eq('listing_uuid',listing.id).order('captured_at',{ascending:false}).limit(1).single(); if(oe||!obs)throw oe||new Error('Observation not found');
    const result=await matchListingIncrementally(db,listing,obs); return NextResponse.json({ok:true,matcher:'hybrid-v2',listingId:listing.id,...result});
  }
  let q=db.from('products').select('*').is('archived_at',null).order('priority',{ascending:false});
  if(body.productId)q=q.eq('id',body.productId);
  const {data:products,error}=await q.limit(body.productId?1:100); if(error)throw error;
  const results=[];for(const p of products||[])results.push({productId:p.id,name:p.display_name||p.part_type,...await reconcileProduct(db,p)});
  return NextResponse.json({ok:true,matcher:'hybrid-v2',results});
 }catch(e:any){return NextResponse.json({error:e.message||'Comparable reconciliation failed'},{status:500})}
}

export async function PATCH(req:Request){
 try{
  const {productId,listingId,action}=await req.json();
  if(!productId||!listingId||!['accept','reject'].includes(action))return NextResponse.json({error:'productId, listingId and accept/reject action are required.'},{status:400});
  const db=adminClient();
  const now=new Date().toISOString();
  const {data:candidate,error}=await db.from('product_match_candidates').select('*').eq('product_id',productId).eq('listing_uuid',listingId).maybeSingle();if(error)throw error;
  if(action==='accept'){
    const score=Number(candidate?.score||1);
    const reason=candidate?.reason||{reasons:['manually accepted in Product CRM']};
    await db.from('product_listings').upsert({product_id:productId,listing_uuid:listingId,role:'competitor',match_score:score,match_method:'manual-accept',match_reason:reason},{onConflict:'product_id,listing_uuid'});
    await db.from('listings').update({product_id:productId}).eq('id',listingId).is('product_id',null);
    await db.from('product_match_candidates').upsert({product_id:productId,listing_uuid:listingId,score, status:'accepted',method:candidate?.method||'manual',reason,manual_override:'accept',manual_override_at:now,updated_at:now},{onConflict:'product_id,listing_uuid'});
  }else{
    const score=Number(candidate?.score||0);
    const reason=candidate?.reason||{reasons:['manually rejected in Product CRM']};
    await db.from('product_match_candidates').upsert({product_id:productId,listing_uuid:listingId,score,status:'rejected',method:candidate?.method||'manual',reason,manual_override:'reject',manual_override_at:now,updated_at:now},{onConflict:'product_id,listing_uuid'});
    await db.from('product_listings').delete().eq('product_id',productId).eq('listing_uuid',listingId);
    await db.from('listings').update({product_id:null}).eq('id',listingId).eq('product_id',productId);
  }
  return NextResponse.json({ok:true,manualOverride:action});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to update match candidate'},{status:500})}
}
