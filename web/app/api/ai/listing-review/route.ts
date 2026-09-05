import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {computeListingSignals} from '../../../../lib/intelligence';
function extractText(j:any){if(typeof j.output_text==='string')return j.output_text;for(const o of j.output||[])for(const c of o.content||[])if(c.type==='output_text'&&c.text)return c.text;return ''}
export async function POST(req:Request){
 try{
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:'OPENAI_API_KEY is not configured'},{status:503});
  const {listingIds}=await req.json();if(!Array.isArray(listingIds)||!listingIds.length)return NextResponse.json({error:'Select listings first'},{status:400});
  const db=adminClient();const {data:listings,error}=await db.from('listings').select('*').eq('active',true).limit(250);if(error)throw error;
  const allIds=(listings||[]).map((x:any)=>x.id);const {data:obs}=allIds.length?await db.from('observations').select('listing_uuid,captured_at,views,watchers,bids,buy_now_nzd,asking_price_nzd,current_bid_nzd,close_date,close_remaining').in('listing_uuid',allIds).order('captured_at',{ascending:false}).limit(5000):{data:[] as any[]};
  const base=(listings||[]).map((l:any)=>({...l,observations:(obs||[]).filter((o:any)=>o.listing_uuid===l.id).slice(0,40)}));const signals=computeListingSignals(base);const scored=base.map((l:any,i:number)=>({...l,signal:signals[i]}));
  const evidence=scored.filter((l:any)=>listingIds.includes(l.id)).map((l:any)=>({listing_id:l.listing_id,title:l.title,seller:l.seller,url:l.url,signal:l.signal,observations:l.observations}));
  const prompt=`You are COBALT, Motera's cautious marketplace research analyst. Review these selected competitor listings BEFORE they become a Product. The deterministic attention score measures whether a listing is getting attention lately using recent view velocity, acceleration, close-date context, engagement, comparable-listing performance and evidence quality. Observation states are TOO EARLY, LOW SIGNAL, WATCHING, GOOD, and internal MUST_HAVE. Never claim a listing sold unless the data explicitly says so. Never invent fitment, costs or demand. Return ONLY JSON with keys: summary, reasons, risks, grouping, next_action, confidence. Keep each value concise plain English.\n\nDATA:\n${JSON.stringify(evidence)}`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input:prompt})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'OpenAI request failed');const text=extractText(j).trim();let analysis:any;try{analysis=JSON.parse(text.replace(/^```json\s*|```$/g,''))}catch{analysis={summary:text,reasons:'—',risks:'—',grouping:'—',next_action:'Review manually',confidence:50}};return NextResponse.json({ok:true,summary:analysis.summary,analysis});
 }catch(e:any){return NextResponse.json({error:e.message||'AI review failed'},{status:500})}
}
