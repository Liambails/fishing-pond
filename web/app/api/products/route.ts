import {NextResponse} from 'next/server';
import {adminClient} from '../../../lib/supabase';

function infer(title=''){
 const t=title.toLowerCase();
 const make=t.includes('toyota')?'Toyota':null;
 const model=t.includes('aqua')?'Aqua':null;
 const chassis=(title.match(/\bNHP10\b/i)||[])[0]?.toUpperCase()||null;
 let part:string|null=null;
 if(t.includes('master')&&t.includes('window'))part='Master Window Switch';
 else if(t.includes('window switch'))part='Window Switch';
 else if(t.includes('wiper'))part='Wiper Switch';
 else if(t.includes('combination'))part='Combination Switch';
 return {make,model,chassis,part};
}

export async function POST(req:Request){
 try{
  const {listingIds}=await req.json();
  if(!Array.isArray(listingIds)||!listingIds.length)return NextResponse.json({error:'Select at least one listing'},{status:400});
  const db=adminClient();
  const {data:chosen,error:e}=await db.from('listings').select('*').in('id',listingIds);
  if(e)throw e;
  const source=chosen?.[0];
  if(!source)return NextResponse.json({error:'Selected listing was not found.'},{status:404});
  const x=infer(source.title||'');
  const {data:p,error}=await db.from('products').insert({
    vehicle_make:x.make,
    vehicle_model:x.model,
    chassis:x.chassis,
    part_type:x.part,
    display_name:source.title||`Marketplace product ${source.listing_id}`,
    source_listing_uuid:source.id,
    status:'incomplete',
    priority:60
  }).select().single();
  if(error)throw error;
  await db.from('product_listings').insert((chosen||[]).map((l:any)=>({product_id:p.id,listing_uuid:l.id,role:'competitor'})));
  await db.from('listings').update({product_id:p.id}).in('id',listingIds);
  return NextResponse.json({ok:true,product:p});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to create product'},{status:500})}
}

export async function PATCH(req:Request){
 try{
  const body=await req.json();
  const {productId,action}=body;
  if(!productId)return NextResponse.json({error:'Product ID is required.'},{status:400});
  const db=adminClient();

  if(action==='update_crm'){
   const allowedStatus=['incomplete','tracking','sourcing','sampling','sample','test_selling','selling','scale','hold','kill'];
   const allowedSupplier=['not_contacted','contacted','quoted','sample_ordered','sample_received','approved','rejected'];
   const patch:any={};
   if(body.status!=null){if(!allowedStatus.includes(body.status))return NextResponse.json({error:'Invalid product stage.'},{status:400});patch.status=body.status}
   if(body.supplierStatus!=null){if(!allowedSupplier.includes(body.supplierStatus))return NextResponse.json({error:'Invalid supplier status.'},{status:400});patch.supplier_status=body.supplierStatus}
   if(body.supplierName!=null)patch.supplier_name=String(body.supplierName).trim()||null;
   if(body.supplierContactName!=null)patch.supplier_contact_name=String(body.supplierContactName).trim()||null;
   if(body.supplierPlatform!=null)patch.supplier_platform=String(body.supplierPlatform).trim()||null;
   if(body.supplierProfileUrl!=null)patch.supplier_profile_url=String(body.supplierProfileUrl).trim()||null;
   if(body.supplierEmail!=null)patch.supplier_email=String(body.supplierEmail).trim()||null;
   if(body.supplierPhone!=null)patch.supplier_phone=String(body.supplierPhone).trim()||null;
   if(body.supplierMessaging!=null)patch.supplier_messaging=String(body.supplierMessaging).trim()||null;
   if(body.supplierQuoteCurrency!=null)patch.supplier_quote_currency=String(body.supplierQuoteCurrency).trim().toUpperCase()||'USD';
   if(body.supplierUnitCost!==undefined)patch.supplier_unit_cost=body.supplierUnitCost===''||body.supplierUnitCost==null?null:Number(body.supplierUnitCost);
   if(body.supplierMoq!==undefined)patch.supplier_moq=body.supplierMoq===''||body.supplierMoq==null?null:Number(body.supplierMoq);
   if(body.supplierSampleCost!==undefined)patch.supplier_sample_cost=body.supplierSampleCost===''||body.supplierSampleCost==null?null:Number(body.supplierSampleCost);
   if(body.supplierSampleShipping!==undefined)patch.supplier_sample_shipping=body.supplierSampleShipping===''||body.supplierSampleShipping==null?null:Number(body.supplierSampleShipping);
   if(body.supplierLeadTimeDays!==undefined)patch.supplier_lead_time_days=body.supplierLeadTimeDays===''||body.supplierLeadTimeDays==null?null:Number(body.supplierLeadTimeDays);
   if(body.crmNotes!=null)patch.crm_notes=String(body.crmNotes);
   if(body.landedCostNzd!==undefined)patch.landed_cost_nzd=body.landedCostNzd===''||body.landedCostNzd==null?null:Number(body.landedCostNzd);
   const {error}=await db.from('products').update(patch).eq('id',productId).is('archived_at',null);
   if(error)throw error;
   return NextResponse.json({ok:true});
  }

  if(action!=='archive')return NextResponse.json({error:'Invalid product action.'},{status:400});
  const {marketplaceClosedConfirmed}=body;
  const {data:own,error:ownError}=await db.from('own_listings').select('id,marketplace,listing_uuid,active').eq('product_id',productId).eq('active',true);
  if(ownError)throw ownError;
  const activeOwn=own||[];
  const marketplaces=[...new Set(activeOwn.map((x:any)=>x.marketplace).filter(Boolean))];
  if(activeOwn.length&&!marketplaceClosedConfirmed){return NextResponse.json({error:'Marketplace closure confirmation required.',requiresConfirmation:true,marketplaces},{status:409});}
  const archivedAt=new Date().toISOString();
  const {error:productError}=await db.from('products').update({archived_at:archivedAt}).eq('id',productId);
  if(productError)throw productError;
  if(activeOwn.length){
   const {error:disableOwnError}=await db.from('own_listings').update({active:false,updated_at:archivedAt}).eq('product_id',productId).eq('active',true);
   if(disableOwnError)throw disableOwnError;
   const listingIds=activeOwn.map((x:any)=>x.listing_uuid).filter(Boolean);
   if(listingIds.length){const {error:disableListingError}=await db.from('listings').update({active:false,next_observation_at:null}).in('id',listingIds);if(disableListingError)throw disableListingError;}
  }
  return NextResponse.json({ok:true,archivedAt});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to update product.'},{status:500})}
}
