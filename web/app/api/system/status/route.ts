import {adminClient} from '../../../../lib/supabase';

export const dynamic='force-dynamic';

const TABLES=[
 'ai_analyses','collection_errors','collection_runs','daily_briefs','listings',
 'observations','own_listings','price_recommendations','product_listings',
 'products','supplier_quotes','suppliers','system_events'
];

function parseDetails(v:any){
 if(Array.isArray(v))return v;
 if(typeof v==='string'){try{return JSON.parse(v)}catch{return []}}
 return [];
}

export async function GET(){
 const db=adminClient();

 const countPairs=await Promise.all(TABLES.map(async table=>{
   const {count,error}=await db.from(table).select('*',{count:'exact',head:true});
   return [table,error?null:(count??0),error?.message||null] as const;
 }));
 const counts=Object.fromEntries(countPairs.map(([table,count])=>[table,count]));
 const countErrors=countPairs.filter(([,count])=>count==null).map(([table,,error])=>({table,error}));

 const [{data:runs},{data:obs},{data:listings}]=await Promise.all([
   db.from('collection_runs').select('*').order('started_at',{ascending:false}).limit(80),
   db.from('observations').select('id,listing_uuid,captured_at,views,bids,watchers,raw_snapshot').order('captured_at',{ascending:false}).limit(120),
   db.from('listings').select('id,listing_id,title,url,marketplace,last_success_source,next_observation_at,consecutive_failures,last_error').limit(500),
 ]);

 const listingMap=new Map((listings||[]).map((l:any)=>[l.id,l]));
 const runRows=(runs||[]).map((r:any)=>({
   kind:String(r.source||'').startsWith('scheduler-check/')?'scheduler':'worker',
   source:r.source,
   started_at:r.started_at,
   finished_at:r.finished_at,
   attempted:r.listings_attempted||0,
   succeeded:r.listings_succeeded||0,
   failed:r.listings_failed||0,
   details:parseDetails(r.details),
 }));

 // Manual captures are not collection_runs, so surface explicit extension
 // observations alongside the automatic scheduler/worker records.
 const manualRows=(obs||[]).flatMap((o:any)=>{
   const raw=o.raw_snapshot&&typeof o.raw_snapshot==='object'?o.raw_snapshot:{};
   const source=String(raw.capture_source||'');
   if(!source.toLowerCase().includes('manual')&&!source.toLowerCase().includes('extension'))return [];
   const l:any=listingMap.get(o.listing_uuid);
   return [{
     kind:'manual',
     source:source||'extension-manual',
     started_at:o.captured_at,
     finished_at:o.captured_at,
     attempted:1,succeeded:1,failed:0,
     details:[{ok:true,listing_id:l?.listing_id||null,title:l?.title||null,url:l?.url||null,views:o.views}],
   }];
 });

 const activity=[...runRows,...manualRows]
   .sort((a:any,b:any)=>Date.parse(b.started_at)-Date.parse(a.started_at))
   .slice(0,100);

 return Response.json({
   ok:true,
   generated_at:new Date().toISOString(),
   counts,
   count_errors:countErrors,
   activity,
   listings:listings||[],
 });
}
