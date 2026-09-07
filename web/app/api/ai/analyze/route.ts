import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {computeProductMetrics,computeListingSignals} from '../../../../lib/intelligence';
function extractText(j:any){if(typeof j.output_text==='string')return j.output_text;for(const o of j.output||[])for(const c of o.content||[])if(c.type==='output_text'&&c.text)return c.text;return ''}
export async function POST(req:Request){
 try{
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:'OPENAI_API_KEY is not configured'},{status:503});
  const {productId}=await req.json();const db=adminClient();
  const {data:p,error}=await db.from('products').select('*').eq('id',productId).single();if(error)throw error;
  const {data:links}=await db.from('product_listings').select('listing_uuid,role,match_score,match_method,match_reason').eq('product_id',productId);
  const ids=(links||[]).map((x:any)=>x.listing_uuid);
  const {data:listings}=ids.length?await db.from('listings').select('*').in('id',ids):{data:[] as any[]};
  const {data:obs}=ids.length?await db.from('observations').select('listing_uuid,captured_at,views,watchers,bids,buy_now_nzd,asking_price_nzd,current_bid_nzd,close_date,close_remaining,question_count,purchase_intent_questions,compatibility_questions,condition_questions,buy_now_available,offer_available,stock_quantity,listing_status,sold_detected,qa_identity_codes').in('listing_uuid',ids).order('captured_at',{ascending:false}).limit(1000):{data:[] as any[]};
  const ls=(listings||[]).map((l:any)=>({...l,observations:(obs||[]).filter((o:any)=>o.listing_uuid===l.id).slice(0,30)}));
  const roleById=new Map((links||[]).map((x:any)=>[x.listing_uuid,x.role]));
  const competitors=ls.filter((l:any)=>roleById.get(l.id)!=='own').map((l:any)=>({...l,comparableMatch:(links||[]).find((x:any)=>x.listing_uuid===l.id)||null}));
  const own=ls.filter((l:any)=>roleById.get(l.id)==='own');
  const signals=computeListingSignals(ls);const signalById=new Map(ls.map((l:any,i:number)=>[l.id,signals[i]]));
  const ownPrimary=own[0]||null;const ownSignal=ownPrimary?signalById.get(ownPrimary.id):null;
  if(!ownPrimary||(ownSignal?.observationCount||0)<3)return NextResponse.json({error:'Your own listing needs at least 3 observations before product analysis is enabled.'},{status:409});
  const metrics=computeProductMetrics(p,competitors);
  const snapshot={product:{id:p.id,name:p.display_name||p.part_type||'Product',status:p.status,supplier_name:p.supplier_name,supplier_status:p.supplier_status,landed_cost_nzd:p.landed_cost_nzd,crm_notes:p.crm_notes},marketMetrics:metrics,ownListing:{listing_id:ownPrimary.listing_id,title:ownPrimary.title,url:ownPrimary.url,signal:ownSignal,observations:ownPrimary.observations},competitors:competitors.map((l:any)=>({listing_id:l.listing_id,title:l.title,seller:l.seller,signal:signalById.get(l.id),observations:l.observations}))};
  const prompt=`You are COBALT, Motera's product CRM analyst. Explain the decision in plain English for a founder who is still learning marketplace and sales terminology. Compare MY OWN LISTING with the COMPETITOR MARKET EVIDENCE. Do not mix the user's own listing into competitor demand calculations. Never invent sales, fitment, sold status, costs, or demand. Views are attention, not confirmed purchases. If you use a technical term, explain it immediately in simple words. Return ONLY valid JSON with keys: summary, bull_case, bear_case, missing_evidence, next_action, pricing_reason, confidence (0-100). The summary should say what my listing is doing versus the market and what I should do next.\n\nDATA:\n${JSON.stringify(snapshot)}`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input:prompt})});
  const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'OpenAI request failed');const text=extractText(j).trim();let analysis:any;try{analysis=JSON.parse(text.replace(/^```json\s*|```$/g,''))}catch{analysis={summary:text,bull_case:'—',bear_case:'—',missing_evidence:'—',next_action:'Review evidence',pricing_reason:'—',confidence:50}};
  await db.from('ai_analyses').insert({product_id:productId,model:process.env.OPENAI_MODEL||'gpt-5.6-luna',source_snapshot:snapshot,analysis,summary:analysis.summary,confidence:analysis.confidence});
  await db.from('products').update({ai_summary:analysis.summary,ai_generated_at:new Date().toISOString(),ai_snapshot:snapshot}).eq('id',productId);
  return NextResponse.json({ok:true,summary:analysis.summary,analysis});
 }catch(e:any){return NextResponse.json({error:e.message||'AI analysis failed'},{status:500})}
}
