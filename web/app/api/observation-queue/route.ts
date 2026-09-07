import {NextResponse} from 'next/server';
import {adminClient} from '../../../lib/supabase';
import {categoryPathOf,listingDocument} from '../../../lib/genericSimilarity';
import {INTEREST_MATCHER_VERSION,latestObservationExtra} from '../../../lib/interestSuppression';

function metadataOf(row:any){return row?.metadata&&typeof row.metadata==='object'&&!Array.isArray(row.metadata)?row.metadata:{}}
function nextMetadata(row:any,status:'active'|'dismissed'|'not_interested'){
 const current=metadataOf(row);const now=new Date().toISOString();
 return {...current,observation_queue_status:status,observation_queue_decided_at:status==='active'?null:now,interest_decision:status==='not_interested'?'not_interested':current.interest_decision??null,interest_decided_at:status==='not_interested'?now:(status==='active'?null:current.interest_decided_at??null)};
}

async function createSuppression(db:any,row:any){
 const {data:obs}=await db.from('observations').select('*').eq('listing_uuid',row.id).order('captured_at',{ascending:false}).limit(1).maybeSingle();
 const extra=latestObservationExtra(obs);const category=categoryPathOf(row);const signature=listingDocument(row,extra)||String(row.title||row.listing_id||row.id);
 const snapshot={title:row.title||null,metadata:metadataOf(row),category_path:category,extra};
 const {error}=await db.from('interest_suppressions').upsert({source_listing_uuid:row.id,scope:'similar',matcher_version:INTEREST_MATCHER_VERSION,signature_text:signature,category_path:category,reference_snapshot:snapshot,threshold:.70,active:true},{onConflict:'source_listing_uuid,scope'});
 if(error)throw error;
}

export async function PATCH(req:Request){
 try{
  const body=await req.json();const listingIds=Array.isArray(body?.listingIds)?body.listingIds.filter(Boolean):[];const action=String(body?.action||'').toLowerCase();
  if(!listingIds.length)return NextResponse.json({error:'Select at least one listing.'},{status:400});
  if(!['dismiss','restore','not_interested'].includes(action))return NextResponse.json({error:'Invalid observation queue action.'},{status:400});
  const db=adminClient();
  const {data:rows,error}=await db.from('listings').select('*').in('id',listingIds);if(error)throw error;
  const target=action==='dismiss'?'dismissed':action==='not_interested'?'not_interested':'active';let updated=0,skipped=0;
  for(const row of rows||[]){
   if(row.product_id&&target!=='active'){skipped++;continue;}
   if(target==='not_interested'){
    await createSuppression(db,row);
    const {error:updateError}=await db.from('listings').update({active:false,next_observation_at:null,cadence_reason:'user marked not interested in tracking',metadata:nextMetadata(row,'not_interested')}).eq('id',row.id);if(updateError)throw updateError;
   }else if(target==='active'){
    await db.from('interest_suppressions').update({active:false}).eq('source_listing_uuid',row.id).eq('scope','similar');
    const {error:updateError}=await db.from('listings').update({active:true,next_observation_at:new Date().toISOString(),cadence_reason:'restored by user',metadata:nextMetadata(row,'active')}).eq('id',row.id);if(updateError)throw updateError;
   }else{
    const {error:updateError}=await db.from('listings').update({metadata:nextMetadata(row,'dismissed')}).eq('id',row.id);if(updateError)throw updateError;
   }
   updated++;
  }
  return NextResponse.json({ok:true,status:target,updated,skipped});
 }catch(e:any){return NextResponse.json({error:e?.message||'Unable to update observation queue.'},{status:500});}
}

export async function DELETE(req:Request){
 try{
  const body=await req.json();const listingId=String(body?.listingId||'');if(!listingId)return NextResponse.json({error:'listingId is required'},{status:400});
  const db=adminClient();const {data:row,error}=await db.from('listings').select('id,product_id,metadata').eq('id',listingId).maybeSingle();if(error)throw error;if(!row)return NextResponse.json({error:'Listing not found'},{status:404});
  if(row.product_id)return NextResponse.json({error:"This listing is linked to 'My Products'. Remove/archive that product relationship before deleting the listing."},{status:409});
  const {error:deleteError}=await db.from('listings').delete().eq('id',listingId);if(deleteError)throw deleteError;
  return NextResponse.json({ok:true,deleted:listingId});
 }catch(e:any){return NextResponse.json({error:e?.message||'Unable to delete listing.'},{status:500});}
}
