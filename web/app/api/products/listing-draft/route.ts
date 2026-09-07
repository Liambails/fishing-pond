import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';

function extractText(j:any){if(typeof j.output_text==='string')return j.output_text;for(const o of j.output||[])for(const c of o.content||[])if(c.type==='output_text'&&c.text)return c.text;return ''}
function parseJson(text:string){try{return JSON.parse(text.trim().replace(/^```json\s*|```$/g,''))}catch{return null}}

async function sourceSnapshot(db:any,productId:string){
 const {data:product,error}=await db.from('products').select('*').eq('id',productId).single();if(error)throw error;
 const {data:links}=await db.from('product_listings').select('*').eq('product_id',productId);
 const ids=(links||[]).map((x:any)=>x.listing_uuid);
 const {data:listings}=ids.length?await db.from('listings').select('*').in('id',ids):{data:[] as any[]};
 const {data:observations}=ids.length?await db.from('observations').select('*').in('listing_uuid',ids).order('captured_at',{ascending:false}).limit(2500):{data:[] as any[]};
 const evidence=(listings||[]).map((l:any)=>{
   const rows=(observations||[]).filter((o:any)=>o.listing_uuid===l.id).slice(0,20);
   const latest=rows[0]||{};const raw=latest.raw_snapshot||{};
   return {listing_id:l.listing_id,title:l.title,seller:l.seller,url:l.url,description:raw.description||null,condition:latest.condition||raw.condition||null,part_number:latest.part_number||raw.part_number||null,part_number_candidates:latest.part_number_candidates||raw.part_number_candidates||[],vehicle:latest.vehicle||raw.vehicle||null,chassis:latest.chassis||raw.chassis_code_label||null,years:latest.years||raw.vehicle_year_label||null,engine_code:latest.engine_code||raw.engine_code_label||null,brand:raw.brand||raw.make_label||null,model:raw.model||raw.model_label||null,q_and_a:latest.q_and_a||raw.q_and_a||[],qa_identity_codes:latest.qa_identity_codes||raw.qa_identity_codes||[],category_path:raw.category_path||l.metadata?.category_path||[],price:{buy_now:latest.buy_now_nzd,asking:latest.asking_price_nzd,current_bid:latest.current_bid_nzd},signals:{views:latest.views,watchers:latest.watchers,bids:latest.bids,questions:latest.question_count,purchase_intent_questions:latest.purchase_intent_questions,compatibility_questions:latest.compatibility_questions,condition_questions:latest.condition_questions,sold_detected:latest.sold_detected}};
 });
 return {product:{id:product.id,name:product.display_name||product.part_type||'Product',vehicle_make:product.vehicle_make,vehicle_model:product.vehicle_model,chassis:product.chassis,part_type:product.part_type},evidence};
}

export async function POST(req:Request){
 try{
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:'OPENAI_API_KEY is not configured'},{status:503});
  const {productId,field}=await req.json();if(!productId)return NextResponse.json({error:'Product ID is required'},{status:400});
  const allowed=new Set(['title','description','condition_text','item_specifics','all']);const target=field||'all';if(!allowed.has(target))return NextResponse.json({error:'Unsupported draft field'},{status:400});
  const db=adminClient();const snapshot=await sourceSnapshot(db,productId);
  const {data:existing}=await db.from('product_listing_drafts').select('*').eq('product_id',productId).eq('marketplace','Trade Me').maybeSingle();
  if(existing&&target==='all')return NextResponse.json({ok:true,draft:existing,generated:false});
  const fieldInstruction=target==='all'?'Generate title, description, condition_text, item_specifics and identity.':`Regenerate ONLY ${target}. Return the other keys too, but copy their CURRENT values exactly so they are not changed.`;
  const prompt=`You are COBALT's Trade Me listing writer. Create original seller copy from factual marketplace evidence. Do NOT copy the wording or sentence structure of competitor descriptions. Never invent compatibility, condition, included items, model numbers, part numbers, specifications, defects, warranties, stock or provenance. Preserve exact identifiers only when they are present in the evidence. Public Q&A may clarify identity or condition, but a buyer QUESTION is not a confirmed fact; only treat a seller answer as a claim and phrase uncertain facts cautiously. Write for a New Zealand Trade Me buyer. Keep the title concise and searchable. Description should be clear, useful and independently worded. item_specifics must contain only supported structured facts useful for this product category. identity should summarize the strongest supported identity anchors and confidence notes. ${fieldInstruction}\nReturn ONLY valid JSON with keys title, description, condition_text, item_specifics, identity.\n\nCURRENT DRAFT:\n${JSON.stringify(existing||{})}\n\nSOURCE EVIDENCE:\n${JSON.stringify(snapshot)}`;
  const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model,input:prompt})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'OpenAI request failed');const generated=parseJson(extractText(j));if(!generated)throw new Error('AI returned an invalid listing draft');
  const now=new Date().toISOString();const generations={...(existing?.field_generations||{})};for(const k of (target==='all'?['title','description','condition_text','item_specifics']:[target]))generations[k]={generation:Number(generations[k]?.generation||0)+1,generated_at:now};
  const row:any={product_id:productId,marketplace:'Trade Me',title:generated.title||existing?.title||null,description:generated.description||existing?.description||null,condition_text:generated.condition_text||existing?.condition_text||null,item_specifics:generated.item_specifics||existing?.item_specifics||{},identity:generated.identity||existing?.identity||{},source_snapshot:snapshot,field_generations:generations,model,prompt_version:'listing-draft-v1',generated_at:existing?.generated_at||now,updated_at:now};
  const {data:draft,error}=await db.from('product_listing_drafts').upsert(row,{onConflict:'product_id,marketplace'}).select().single();if(error)throw error;
  return NextResponse.json({ok:true,draft,generated:true,field:target});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to generate listing details'},{status:500})}
}
