import {adminClient} from '../../../../lib/supabase';

export const dynamic='force-dynamic';

const TABLES=[
 'ai_analyses','collection_errors','collection_runs','daily_briefs','listings',
 'observations','own_listings','price_recommendations','product_listings',
 'products','scheduler_runs','supplier_quotes','suppliers','system_events'
];

function parseDetails(v:any){
 if(Array.isArray(v))return v;
 if(typeof v==='string'){try{return JSON.parse(v)}catch{return []}}
 return [];
}

export async function GET(){
 const db=adminClient();
 const generatedAt=new Date();

 const countPairs=await Promise.all(TABLES.map(async table=>{
   const {count,error}=await db.from(table).select('*',{count:'exact',head:true});
   return [table,error?null:(count??0),error?.message||null] as const;
 }));
 const counts=Object.fromEntries(countPairs.map(([table,count])=>[table,count]));
 const countErrors=countPairs.filter(([,count])=>count==null).map(([table,,error])=>({table,error}));

 const [runsRes,obsRes,listingsRes,schedulerRes]=await Promise.all([
   db.from('collection_runs').select('*').order('started_at',{ascending:false}).limit(80),
   db.from('observations').select('id,listing_uuid,captured_at,views,bids,watchers,raw_snapshot').order('captured_at',{ascending:false}).limit(120),
   db.from('listings').select('id,listing_id,title,url,marketplace,active,last_success_source,next_observation_at,last_observed_at,consecutive_failures,last_error,cadence_reason').limit(1000),
   db.from('scheduler_runs').select('*').order('started_at',{ascending:false}).limit(100),
 ]);
 const runs=runsRes.data||[]; const obs=obsRes.data||[]; const listings=listingsRes.data||[];
 // If migration 010 has not been applied yet, keep the status endpoint usable.
 const schedulerRuns=schedulerRes.error?[]:(schedulerRes.data||[]);

 const listingMap=new Map((listings||[]).map((l:any)=>[l.id,l]));
 const runRows=(runs||[]).filter((r:any)=>!String(r.source||'').startsWith('scheduler-check/')).map((r:any)=>({
   kind:'worker',source:r.source,started_at:r.started_at,finished_at:r.finished_at,
   attempted:r.listings_attempted||0,succeeded:r.listings_succeeded||0,failed:r.listings_failed||0,
   details:parseDetails(r.details),worker_run_id:r.id,
 }));
 const schedulerRows=(schedulerRuns||[]).map((r:any)=>({
   kind:'scheduler',source:`scheduler/${r.github_event_name||'unknown'}`,started_at:r.started_at,finished_at:r.finished_at,
   attempted:r.listings_attempted||0,succeeded:r.listings_succeeded||0,failed:r.listings_failed||0,
   status:r.status,stage:r.stage,due_count:r.due_count,selected_count:r.selected_count,
   oldest_overdue_seconds:r.oldest_overdue_seconds,github_run_id:r.github_run_id,
   github_run_attempt:r.github_run_attempt,github_sha:r.github_sha,cobalt_version:r.cobalt_version,
   error_type:r.error_type,error_message:r.error_message,
   details:[{event:'scheduler',due:Number(r.due_count||0)>0,due_count:r.due_count||0,candidate_listing_ids:r.candidate_listing_ids||[],stage:r.stage,status:r.status,error:r.error_message||null}],
 }));

 const manualRows=(obs||[]).flatMap((o:any)=>{
   const raw=o.raw_snapshot&&typeof o.raw_snapshot==='object'?o.raw_snapshot:{};
   const source=String(raw.capture_source||'');
   if(!source.toLowerCase().includes('manual')&&!source.toLowerCase().includes('extension'))return [];
   const l:any=listingMap.get(o.listing_uuid);
   return [{kind:'manual',source:source||'extension-manual',started_at:o.captured_at,finished_at:o.captured_at,
     attempted:1,succeeded:1,failed:0,details:[{ok:true,listing_id:l?.listing_id||null,title:l?.title||null,url:l?.url||null,views:o.views}]}];
 });

 const activity=[...schedulerRows,...runRows,...manualRows]
   .sort((a:any,b:any)=>Date.parse(b.started_at)-Date.parse(a.started_at)).slice(0,150);

 const active=listings.filter((l:any)=>l.active!==false);
 const due=active.filter((l:any)=>l.next_observation_at&&Date.parse(l.next_observation_at)<=generatedAt.getTime());
 const overdueSorted=[...due].sort((a:any,b:any)=>Date.parse(a.next_observation_at)-Date.parse(b.next_observation_at));
 const oldestDue=overdueSorted[0]?.next_observation_at||null;
 const oldestOverdueSeconds=oldestDue?Math.max(0,Math.floor((generatedAt.getTime()-Date.parse(oldestDue))/1000)):0;
 const lastScheduler=schedulerRuns[0]||null;
 const lastWorker=(runs||[]).find((r:any)=>String(r.source||'').includes('github-actions')||String(r.source||'').includes('worker'))||null;
 const lastSuccessfulWorker=(runs||[]).find((r:any)=>Number(r.listings_succeeded||0)>0)||null;
 const schedulerAgeSec=lastScheduler?.started_at?Math.max(0,Math.floor((generatedAt.getTime()-Date.parse(lastScheduler.started_at))/1000)):null;
 const expectedHeartbeatSec=10*60;
 let healthState='UNKNOWN';
 if(lastScheduler){
   if(schedulerAgeSec!=null&&schedulerAgeSec<=25*60&&lastScheduler.status!=='failed')healthState=due.length>0&&oldestOverdueSeconds>45*60?'DEGRADED':'HEALTHY';
   else if(schedulerAgeSec!=null&&schedulerAgeSec<=45*60)healthState='DEGRADED';
   else healthState='CRITICAL';
 }
 const missedWindows=schedulerAgeSec==null?null:Math.max(0,Math.floor(schedulerAgeSec/expectedHeartbeatSec)-1);

 return Response.json({
   ok:true,generated_at:generatedAt.toISOString(),counts,count_errors:countErrors,activity,listings:listings||[],
   scheduler_table_available:!schedulerRes.error,
   scheduler_table_error:schedulerRes.error?.message||null,
   automation_health:{
     state:healthState,expected_heartbeat_seconds:expectedHeartbeatSec,
     last_scheduler_at:lastScheduler?.started_at||null,last_scheduler_status:lastScheduler?.status||null,last_scheduler_stage:lastScheduler?.stage||null,
     last_scheduler_run_id:lastScheduler?.github_run_id||null,last_scheduler_commit:lastScheduler?.github_sha||null,last_scheduler_version:lastScheduler?.cobalt_version||null,
     scheduler_age_seconds:schedulerAgeSec,missed_expected_windows:missedWindows,
     last_worker_at:lastWorker?.started_at||null,last_successful_worker_at:lastSuccessfulWorker?.started_at||null,
     active_listings:active.length,due_listings:due.length,oldest_due_at:oldestDue,oldest_overdue_seconds:oldestOverdueSeconds,
     overdue_listing_ids:overdueSorted.slice(0,50).map((l:any)=>l.listing_id),
   }
 });
}
