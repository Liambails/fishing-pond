import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {buildIdf,genericListingSimilarity,isTrustedComparable,listingDocument} from '../../../../lib/genericSimilarity';
import {latestObservationExtra} from '../../../../lib/interestSuppression';
import {computeListingSignals} from '../../../../lib/intelligence';

export async function GET(req:Request){
 try{
  const id=new URL(req.url).searchParams.get('listingId');if(!id)return NextResponse.json({error:'listingId is required'},{status:400});
  const db=adminClient();
  const [{data:source,error:se},{data:listings,error:le}]=await Promise.all([db.from('listings').select('*').eq('id',id).maybeSingle(),db.from('listings').select('*').limit(300)]);if(se)throw se;if(le)throw le;if(!source)return NextResponse.json({error:'Listing not found'},{status:404});
  const ids=(listings||[]).map((x:any)=>x.id);const {data:obs,error:oe}=await db.from('observations').select('*').in('listing_uuid',ids).order('captured_at',{ascending:false}).limit(6000);if(oe)throw oe;
  const latest=new Map<string,any>();for(const o of obs||[])if(!latest.has(o.listing_uuid))latest.set(o.listing_uuid,o);
  const sourceExtra=latestObservationExtra(latest.get(source.id));const docs=(listings||[]).map((l:any)=>listingDocument(l,latestObservationExtra(latest.get(l.id))));const idf=buildIdf(docs);
  const scored=(listings||[]).filter((l:any)=>l.id!==source.id).map((l:any)=>({listing:l,match:genericListingSimilarity(source,l,idf,sourceExtra,latestObservationExtra(latest.get(l.id)))})).filter((x:any)=>isTrustedComparable(x.match)).sort((a:any,b:any)=>b.match.score-a.match.score).slice(0,30);
  const chosen=[source,...scored.map((x:any)=>x.listing)];const withObs=chosen.map((l:any)=>({...l,observations:(obs||[]).filter((o:any)=>o.listing_uuid===l.id).slice(0,40)}));const signals=computeListingSignals(withObs);const signalById=new Map(withObs.map((l:any,i:number)=>[l.id,signals[i]]));
  return NextResponse.json({ok:true,source:{...source,signal:signalById.get(source.id)},matches:scored.map((x:any)=>({...x.listing,signal:signalById.get(x.listing.id),similarity:x.match}))});
 }catch(e:any){return NextResponse.json({error:e?.message||'Unable to find similar listings.'},{status:500});}
}
