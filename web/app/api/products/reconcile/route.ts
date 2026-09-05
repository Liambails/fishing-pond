import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {reconcileProduct} from '../../../../lib/comparableMatcher';

export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>({})); const db=adminClient();
  let q=db.from('products').select('*').is('archived_at',null).order('priority',{ascending:false});
  if(body.productId)q=q.eq('id',body.productId);
  const {data:products,error}=await q.limit(body.productId?1:100); if(error)throw error;
  const results=[];for(const p of products||[])results.push({productId:p.id,name:p.display_name||p.part_type,...await reconcileProduct(db,p)});
  return NextResponse.json({ok:true,matcher:'hybrid-v1',results});
 }catch(e:any){return NextResponse.json({error:e.message||'Comparable reconciliation failed'},{status:500})}
}

export async function PATCH(req:Request){
 try{
  const {productId,listingId,action}=await req.json();
  if(!productId||!listingId||!['accept','reject'].includes(action))return NextResponse.json({error:'productId, listingId and accept/reject action are required.'},{status:400});
  const db=adminClient();
  const {data:candidate,error}=await db.from('product_match_candidates').select('*').eq('product_id',productId).eq('listing_uuid',listingId).maybeSingle();if(error)throw error;
  if(!candidate)return NextResponse.json({error:'Match candidate not found.'},{status:404});
  if(action==='accept'){
    await db.from('product_listings').upsert({product_id:productId,listing_uuid:listingId,role:'competitor',match_score:candidate.score,match_method:'manual-accept',match_reason:candidate.reason||{}},{onConflict:'product_id,listing_uuid'});
    await db.from('listings').update({product_id:productId}).eq('id',listingId).is('product_id',null);
    await db.from('product_match_candidates').update({status:'accepted',updated_at:new Date().toISOString()}).eq('product_id',productId).eq('listing_uuid',listingId);
  }else{
    await db.from('product_match_candidates').update({status:'rejected',updated_at:new Date().toISOString()}).eq('product_id',productId).eq('listing_uuid',listingId);
  }
  return NextResponse.json({ok:true});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to update match candidate'},{status:500})}
}
