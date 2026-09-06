import {NextResponse} from 'next/server';
import {adminClient} from '../../../lib/supabase';

function nextMetadata(row:any,status:'active'|'dismissed'){
 const current=row?.metadata&&typeof row.metadata==='object'&&!Array.isArray(row.metadata)?row.metadata:{};
 const decidedAt=status==='dismissed'?new Date().toISOString():null;
 return {...current,observation_queue_status:status,observation_queue_decided_at:decidedAt};
}

export async function PATCH(req:Request){
 try{
  const body=await req.json();
  const listingIds=Array.isArray(body?.listingIds)?body.listingIds.filter(Boolean):[];
  const action=String(body?.action||'').toLowerCase();
  if(!listingIds.length)return NextResponse.json({error:'Select at least one listing.'},{status:400});
  if(!['dismiss','restore'].includes(action))return NextResponse.json({error:'Invalid observation queue action.'},{status:400});
  const db=adminClient();
  const {data:rows,error}=await db.from('listings').select('id,product_id,metadata').in('id',listingIds);
  if(error)throw error;
  const target=action==='dismiss'?'dismissed':'active';
  let updated=0,skipped=0;
  for(const row of rows||[]){
   if(row.product_id){skipped++;continue;}
   const {error:updateError}=await db.from('listings').update({metadata:nextMetadata(row,target)}).eq('id',row.id);
   if(updateError)throw updateError;
   updated++;
  }
  return NextResponse.json({ok:true,status:target,updated,skipped});
 }catch(e:any){
  return NextResponse.json({error:e?.message||'Unable to update observation queue.'},{status:500});
 }
}
