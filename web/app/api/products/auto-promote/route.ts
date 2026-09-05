import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';

function infer(title=''){
 const t=title.toLowerCase();
 const make=t.includes('toyota')?'Toyota':null;
 const model=t.includes('aqua')?'Aqua':null;
 const chassis=(title.match(/\bNHP10\b/i)||[])[0]?.toUpperCase()||null;
 let part='Marketplace candidate';
 if(t.includes('master')&&t.includes('window'))part='Master Window Switch';
 else if(t.includes('window switch'))part='Window Switch';
 else if(t.includes('wiper'))part='Wiper Switch';
 else if(t.includes('combination'))part='Combination Switch';
 else if(t.includes('headlight'))part='Headlight Switch';
 else if(t.includes('ignition'))part='Ignition Switch';
 return {make,model,chassis,part};
}
const key=(x:any)=>[x.make||'',x.model||'',x.chassis||'',x.part||''].join('|').toLowerCase();

export async function POST(req:Request){
 try{
  const {listingIds}=await req.json();
  if(!Array.isArray(listingIds)||!listingIds.length)return NextResponse.json({ok:true,createdProducts:0,linkedListings:0});
  const db=adminClient();
  // Re-read product_id at write time. This makes repeat dashboard loads idempotent for already-promoted rows.
  const {data:rows,error}=await db.from('listings').select('*').in('id',listingIds).is('product_id',null).eq('active',true);
  if(error)throw error;
  const groups=new Map<string,{shape:any,rows:any[]}>();
  for(const row of rows||[]){const shape=infer(row.title||'');const k=key(shape);const g=groups.get(k)||{shape,rows:[]};g.rows.push(row);groups.set(k,g)}
  let createdProducts=0,linkedListings=0;
  for(const {shape,rows:groupRows} of groups.values()){
   if(!groupRows.length)continue;
   const {data:p,error:pe}=await db.from('products').insert({vehicle_make:shape.make,vehicle_model:shape.model,chassis:shape.chassis,part_type:shape.part,display_name:groupRows[0].title||'Marketplace product',source_listing_uuid:groupRows[0].id,status:'incomplete',priority:85}).select().single();
   if(pe)throw pe;
   createdProducts++;
   const links=groupRows.map((l:any)=>({product_id:p.id,listing_uuid:l.id,role:'competitor'}));
   const {error:le}=await db.from('product_listings').insert(links);if(le)throw le;
   const ids=groupRows.map((l:any)=>l.id);
   const {error:ue}=await db.from('listings').update({product_id:p.id}).in('id',ids);if(ue)throw ue;
   linkedListings+=ids.length;
  }
  return NextResponse.json({ok:true,createdProducts,linkedListings});
 }catch(e:any){return NextResponse.json({error:e.message||'Auto-promotion failed'},{status:500})}
}
