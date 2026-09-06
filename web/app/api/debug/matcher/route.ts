import {adminClient} from '../../../../lib/supabase';

const pct=(v:any)=>v==null?'—':`${(Number(v)*100).toFixed(0)}%`;
const line=(x:any)=>`${new Date(x.occurred_at).toISOString()} | ${String(x.decision).padEnd(9)} | score ${(Number(x.score||0)*100).toFixed(1).padStart(5)}% | cosine ${(Number(x.cosine||0)*100).toFixed(1).padStart(5)}% | ${x.marketplace||'market'} #${x.marketplace_listing_id||'?'} | ${x.product_name||'product'}\n  fitment ${pct(x.components?.fitment)} · subtype ${pct(x.components?.subtype)} · role ${pct(x.components?.role)} · part ${pct(x.components?.partNumber)} · text ${pct(x.components?.text??x.cosine)} · price ${pct(x.components?.price??x.price_compatibility)}\n  ${Array.isArray(x.reasons)?x.reasons.join(' · '):''}`;
export async function GET(req:Request){
 const db=adminClient(); const u=new URL(req.url); const limit=Math.min(1000,Math.max(1,Number(u.searchParams.get('limit')||200)));
 const {data,error}=await db.from('matcher_debug_events').select('*').order('occurred_at',{ascending:false}).limit(limit); if(error)return Response.json({error:error.message},{status:500});
 if(u.searchParams.get('format')==='txt')return new Response(`# COBALT Comparable Matcher Trace\n# newest first · generated ${new Date().toISOString()}\n\n${(data||[]).map(line).join('\n\n')}\n`,{headers:{'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="cobalt_matcher_trace.txt"','cache-control':'no-store'}});
 return Response.json({ok:true,matcher:'hybrid-v2',count:data?.length||0,events:data||[]},{headers:{'cache-control':'no-store'}});
}
