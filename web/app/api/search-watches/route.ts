import {NextResponse} from 'next/server';
import {adminClient} from '../../../lib/supabase';
import {fetchPaged} from '../../../lib/pagedQuery';

export const dynamic='force-dynamic';

export async function GET(){
 try{
  const db=adminClient();
  const [{data:watches,error:we},{data:runs,error:re}]=await Promise.all([
   db.from('search_watches').select('*').order('created_at',{ascending:false}).limit(500),
   db.from('search_watch_runs').select('*').order('started_at',{ascending:false}).limit(250)
  ]);
  if(we)throw we;if(re)throw re;
  return NextResponse.json({watches:watches||[],runs:runs||[]},{headers:{'Cache-Control':'no-store, max-age=0'}});
 }catch(e:any){const msg=e?.message||'Unable to load Search Watches.';const missing=/search_watches|search_watch_runs/i.test(msg)&&/does not exist|schema cache|relation/i.test(msg);return NextResponse.json({error:missing?'Search Terms tables are not available yet. Apply migrations 020 and 021, then refresh.':msg},{status:missing?503:500});}
}

export async function POST(req:Request){
 try{
  const body=await req.json();
  const incoming=Array.isArray(body?.searchTerms)?body.searchTerms:[body?.searchTerm];
  const requested:string[]=[];const requestedKeys=new Set<string>();
  for(const raw of incoming){const t=String(raw||'').trim().replace(/\s+/g,' ');const k=t.toLocaleLowerCase();if(t.length>=2&&!requestedKeys.has(k)){requestedKeys.add(k);requested.push(t)}}
  if(!requested.length)return NextResponse.json({ok:true,added:0,skipped:0,watches:[]});
  const marketplace=String(body?.marketplace||'Trade Me');const category=String(body?.category||'').trim()||null;
  const db=adminClient();
  const existing=await fetchPaged(()=>db.from('search_watches').select('id,search_term,marketplace,category').eq('marketplace',marketplace),1000,10000);
  const existingKeys=new Set(existing.filter((x:any)=>(x.category||null)===category).map((x:any)=>String(x.search_term||'').trim().replace(/\s+/g,' ').toLocaleLowerCase()));
  const unique=requested.filter(t=>!existingKeys.has(t.toLocaleLowerCase()));
  if(!unique.length)return NextResponse.json({ok:true,added:0,skipped:requested.length,watches:[]});
  const now=new Date().toISOString();
  const common={marketplace,name:null,category,interval_hours:Math.max(1,Math.min(168,Number(body?.intervalHours)||6)),max_pages:Math.max(1,Math.min(20,Number(body?.maxPages)||3)),rows_per_page:Math.max(1,Math.min(500,Number(body?.rowsPerPage)||100)),active:true,next_run_at:now};
  const rows=unique.map(search_term=>({...common,search_term}));
  const {data,error}=await db.from('search_watches').insert(rows).select('*');
  if(error){if((error as any)?.code==='23505')return NextResponse.json({ok:true,added:0,skipped:requested.length,watches:[]});throw error}
  return NextResponse.json({ok:true,added:(data||[]).length,skipped:requested.length-(data||[]).length,watches:data||[],watch:(data||[])[0]||null});
 }catch(e:any){return NextResponse.json({error:e?.message||'Unable to create Search Watch.'},{status:500});}
}

export async function PATCH(req:Request){
 try{
  const body=await req.json();const id=String(body?.id||'');const action=String(body?.action||'');if(!id)return NextResponse.json({error:'Watch ID is required.'},{status:400});
  const db=adminClient();let patch:any={};
  if(action==='run_now')patch={next_run_at:new Date().toISOString(),active:true};
  else if(action==='pause')patch={active:false};
  else if(action==='resume')patch={active:true,next_run_at:new Date().toISOString()};
  else if(action==='update')patch={search_term:String(body?.searchTerm||'').trim(),category:String(body?.category||'').trim()||null,interval_hours:Math.max(1,Math.min(168,Number(body?.intervalHours)||6)),max_pages:Math.max(1,Math.min(20,Number(body?.maxPages)||3)),rows_per_page:Math.max(1,Math.min(500,Number(body?.rowsPerPage)||100))};
  else return NextResponse.json({error:'Invalid action.'},{status:400});
  const {data,error}=await db.from('search_watches').update(patch).eq('id',id).select('*').single();if(error)throw error;return NextResponse.json({ok:true,watch:data});
 }catch(e:any){return NextResponse.json({error:e?.message||'Unable to update Search Watch.'},{status:500});}
}

export async function DELETE(req:Request){
 try{const body=await req.json();const id=String(body?.id||'');if(!id)return NextResponse.json({error:'Watch ID is required.'},{status:400});const db=adminClient();const {error}=await db.from('search_watches').delete().eq('id',id);if(error)throw error;return NextResponse.json({ok:true});}
 catch(e:any){return NextResponse.json({error:e?.message||'Unable to delete Search Watch.'},{status:500});}
}
