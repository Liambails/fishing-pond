import {NextResponse} from 'next/server';
import {adminClient} from '../../../lib/supabase';

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
  const body=await req.json();const searchTerm=String(body?.searchTerm||'').trim();
  if(searchTerm.length<2)return NextResponse.json({error:'Enter a search term.'},{status:400});
  const db=adminClient();
  const row={marketplace:String(body?.marketplace||'Trade Me'),name:String(body?.name||'').trim()||null,search_term:searchTerm,category:String(body?.category||'').trim()||null,interval_hours:Math.max(1,Math.min(168,Number(body?.intervalHours)||6)),max_pages:Math.max(1,Math.min(20,Number(body?.maxPages)||3)),rows_per_page:Math.max(1,Math.min(500,Number(body?.rowsPerPage)||100)),active:true,next_run_at:new Date().toISOString()};
  const {data,error}=await db.from('search_watches').insert(row).select('*').single();if(error)throw error;
  return NextResponse.json({ok:true,watch:data});
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
