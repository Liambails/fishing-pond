import {NextResponse} from 'next/server';
import {adminClient} from '../../../lib/supabase';
import {supplierResearchFromOpportunity} from '../../../lib/opportunities';

export async function PATCH(req:Request){
 try{
  const {opportunityId,action,notificationId}=await req.json();const db=adminClient();const now=new Date().toISOString();
  if(action==='read_notification'&&notificationId){const {error}=await db.from('opportunity_notifications').update({read_at:now}).eq('id',notificationId);if(error)throw error;return NextResponse.json({ok:true});}
  if(!opportunityId)return NextResponse.json({error:'Opportunity ID is required.'},{status:400});
  const {data:opp,error}=await db.from('opportunities').select('*').eq('id',opportunityId).single();if(error)throw error;
  if(action==='read'){const {error:e}=await db.from('opportunities').update({read_at:now}).eq('id',opportunityId);if(e)throw e;await db.from('opportunity_notifications').update({read_at:now}).eq('opportunity_id',opportunityId).is('read_at',null);return NextResponse.json({ok:true});}
  if(action==='watch'){const {error:e}=await db.from('opportunities').update({status:'watching',read_at:now,dismissed_at:null}).eq('id',opportunityId);if(e)throw e;return NextResponse.json({ok:true,status:'watching'});}
  if(action==='dismiss'){const {error:e}=await db.from('opportunities').update({status:'dismissed',read_at:now,dismissed_at:now}).eq('id',opportunityId);if(e)throw e;await db.from('opportunity_notifications').update({read_at:now}).eq('opportunity_id',opportunityId).is('read_at',null);return NextResponse.json({ok:true,status:'dismissed'});}
  if(action==='source'){const research=supplierResearchFromOpportunity(opp);const {error:e}=await db.from('opportunities').update({status:'sourcing',read_at:now,sourcing_started_at:opp.sourcing_started_at||now,dismissed_at:null,supplier_research:research}).eq('id',opportunityId);if(e)throw e;return NextResponse.json({ok:true,status:'sourcing',supplierResearch:research});}
  if(action==='restore'){const {error:e}=await db.from('opportunities').update({status:'watching',dismissed_at:null}).eq('id',opportunityId);if(e)throw e;return NextResponse.json({ok:true,status:'watching'});}
  return NextResponse.json({error:'Invalid opportunity action.'},{status:400});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to update opportunity.'},{status:500})}
}
