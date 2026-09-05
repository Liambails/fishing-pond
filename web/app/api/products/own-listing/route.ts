import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {detectMarketplace} from '../../../../lib/marketplaces';

export async function POST(req:Request){
  try{
    const {productId,marketplace,listingUrl}=await req.json();
    if(!productId||!listingUrl)return NextResponse.json({error:'Product and marketplace listing URL are required.'},{status:400});
    let identity;
    try{identity=detectMarketplace(String(listingUrl).trim(),marketplace||null,null)}catch{return NextResponse.json({error:'Enter a valid marketplace listing URL.'},{status:400})}
    if(!identity.listingId)return NextResponse.json({error:`COBALT could not determine the ${identity.marketplace} listing ID from that URL.`},{status:400});

    const db=adminClient();
    const {data:product,error:productError}=await db.from('products').select('*').eq('id',productId).is('archived_at',null).single();
    if(productError||!product)return NextResponse.json({error:'Product not found.'},{status:404});

    let listingUuid:string|null=null;
    if(identity.collectorSupported){
      const existing=await db.from('listings').select('metadata').eq('marketplace',identity.marketplace).eq('listing_id',identity.listingId).maybeSingle();
      const listingPayload={
        marketplace:identity.marketplace,listing_id:identity.listingId,url:identity.canonicalUrl,source_url:String(listingUrl).trim(),product_id:productId,
        active:true,priority:85,observation_interval_hours:12,next_observation_at:new Date().toISOString(),
        metadata:{...(existing.data?.metadata||{}),ownership:'own',collector_key:identity.collectorKey}
      };
      const {data:listing,error:listingError}=await db.from('listings').upsert(listingPayload,{onConflict:'marketplace,listing_id'}).select().single();
      if(listingError)throw listingError;
      listingUuid=listing.id;
      const {error:relationError}=await db.from('product_listings').upsert({product_id:productId,listing_uuid:listing.id,role:'own'},{onConflict:'product_id,listing_uuid'});
      if(relationError)throw relationError;
    }

    const ownPayload:any={product_id:productId,marketplace:identity.marketplace,listing_url:identity.canonicalUrl,external_listing_id:identity.listingId,listing_uuid:listingUuid,active:true,metadata:{collector_key:identity.collectorKey,collector_supported:identity.collectorSupported},updated_at:new Date().toISOString()};
    let ownError:any=null;
    if(listingUuid){
      const existing=await db.from('own_listings').select('id').eq('listing_uuid',listingUuid).maybeSingle();
      if(existing.data?.id){({error:ownError}=await db.from('own_listings').update(ownPayload).eq('id',existing.data.id));}
      else {({error:ownError}=await db.from('own_listings').insert(ownPayload));}
    }else{
      const existing=await db.from('own_listings').select('id').eq('product_id',productId).eq('marketplace',identity.marketplace).eq('external_listing_id',identity.listingId).maybeSingle();
      if(existing.data?.id){({error:ownError}=await db.from('own_listings').update(ownPayload).eq('id',existing.data.id));}
      else {({error:ownError}=await db.from('own_listings').insert(ownPayload));}
    }
    if(ownError)throw ownError;

    const nextStatus=listingUuid?'tracking':'incomplete';
    const {error:updateError}=await db.from('products').update({status:nextStatus}).eq('id',productId);
    if(updateError)throw updateError;

    return NextResponse.json({ok:true,marketplace:identity.marketplace,listingUuid,scheduled:Boolean(listingUuid),collectorSupported:identity.collectorSupported,message:identity.collectorSupported?'Listing added to the COBALT observation queue.':`${identity.marketplace} identity stored; a marketplace collector adapter still needs to be enabled before automated observations can run.`});
  }catch(e:any){return NextResponse.json({error:e.message||'Unable to attach marketplace listing.'},{status:500})}
}
