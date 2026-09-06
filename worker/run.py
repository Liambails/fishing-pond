import os,json,time,traceback,urllib.request
from datetime import datetime,timezone
from dotenv import load_dotenv
from collector import collect_listing,marketplace_listing_id
from db import client,due_listings,save_success,save_failure,log_collection_error,register_explicit_relist
from scheduler_telemetry import upsert,finish,local_log

load_dotenv(); MAX=int(os.getenv('MAX_LISTINGS_PER_RUN','12')); HEADLESS=os.getenv('HEADLESS','true').lower() not in ('0','false','no')

def iso_now(): return datetime.now(timezone.utc).isoformat()

def run_matcher_for_listing(listing_uuid):
 url=os.getenv('COBALT_WEB_URL','https://fishing-pond-seven.vercel.app').rstrip('/')+'/api/products/reconcile'
 token=os.getenv('COBALT_INGEST_TOKEN') or os.getenv('FISHING_POND_INGEST_TOKEN')
 if not token:
  print('MATCHER SKIP: COBALT_INGEST_TOKEN is not configured for worker')
  return None
 body=json.dumps({'listingId':listing_uuid}).encode(); req=urllib.request.Request(url,data=body,method='POST',headers={'Content-Type':'application/json','X-Cobalt-Token':token})
 try:
  with urllib.request.urlopen(req,timeout=20) as r:
   result=json.loads(r.read().decode() or '{}'); print(f"MATCHER OK: autoLinked={result.get('autoLinked',0)} review={result.get('review',0)}")
   return result
 except Exception as e:
  print(f'MATCHER WARNING: live comparable reconciliation failed: {e}')
  return None

def main():
 started=iso_now(); db=client(); selected=[]; run=None
 try:
  selected=due_listings(MAX)
  selected_ids=[str(x.get('listing_id')) for x in selected]
  run=db.table('collection_runs').insert({
      'source':'github-actions/playwright','started_at':started,
      'details':[{'event':'worker-start','github_run_id':os.environ.get('GITHUB_RUN_ID'),'github_run_attempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'selected_listing_ids':selected_ids}]
  }).execute().data[0]
  try: upsert('collecting','running',selected_count=len(selected),candidate_listing_ids=selected_ids,worker_run_id=run['id'])
  except Exception as e: print(f'WARNING: scheduler telemetry start failed: {e}')

  attempted=ok=failed=0; details=[]
  print(f'Due listings selected: {len(selected)}')
  for listing in selected:
   attempted+=1; item_started=time.monotonic(); before_due=listing.get('next_observation_at')
   print(f"Opening {listing['listing_id']} priority={listing.get('priority')} due={before_due}")
   try:
    raw=collect_listing(listing['url'],HEADLESS); save_success(listing,raw); match_result=run_matcher_for_listing(listing['id'])
    relist_result=None
    explicit=raw.get('explicit_relist') if raw.get('listing_ended') else None
    if explicit:
     child=None; created=False; child_raw=None
     # Direct links can be registered before navigation. Semantic redirect links are first
     # resolved by ordinary Chromium navigation; the final URL/collector ID must prove a
     # different marketplace listing before lineage is created.
     if explicit.get('listing_id'):
      child,created=register_explicit_relist(listing,explicit)
     if not explicit.get('listing_id'):
      try:
       child_raw=collect_listing(explicit['url'],HEADLESS)
       resolved_id=str(child_raw.get('listing_id') or marketplace_listing_id(child_raw.get('final_url')) or '')
       if not resolved_id or resolved_id==str(listing.get('listing_id') or ''):
        raise RuntimeError('Explicit relist redirect did not resolve to a different marketplace listing ID')
       explicit={**explicit,'listing_id':resolved_id,'url':child_raw.get('final_url') or explicit['url'],'resolved_redirect':True}
       child,created=register_explicit_relist(listing,explicit)
      except Exception as resolve_e:
       resolved_id=marketplace_listing_id(getattr(resolve_e,'final_url',None))
       if resolved_id and resolved_id!=str(listing.get('listing_id') or ''):
        explicit={**explicit,'listing_id':resolved_id,'url':getattr(resolve_e,'final_url',None) or explicit['url'],'resolved_redirect':True}
        child,created=register_explicit_relist(listing,explicit)
        child_failures=save_failure(child,resolve_e)
        try: log_collection_error(child,resolve_e,run['id'],child_failures)
        except Exception as log_e: print(f'WARNING: failed to write relist redirect collection error: {log_e}')
        relist_result={'listing_id':resolved_id,'created':created,'source':'marketplace_explicit_link','capture':'manual_recovery','error_type':getattr(resolve_e,'error_type',resolve_e.__class__.__name__),'error':str(resolve_e)[:1000]}
        print(f"RELIST REDIRECT CHILD PAUSED {resolved_id} [{relist_result['error_type']}] {resolve_e}")
       else:
        # No validated successor ID means we do not create a possibly-wrong listing edge. Keep
        # the parent on sparse relist watch and record diagnostics in this run.
        relist_result={'listing_id':None,'created':False,'source':'marketplace_explicit_link','capture':'unresolved','error_type':getattr(resolve_e,'error_type',resolve_e.__class__.__name__),'error':str(resolve_e)[:1000]}
        print(f"RELIST REDIRECT UNRESOLVED {listing['listing_id']} [{relist_result['error_type']}] {resolve_e}")
     if child and relist_result is None:
      relist_result={'listing_id':child.get('listing_id'),'created':created,'source':'marketplace_explicit_link','resolved_redirect':bool(explicit.get('resolved_redirect'))}
      print(f"RELIST LINK {listing['listing_id']} -> {relist_result.get('listing_id')} created={created}")
     # If redirect resolution already collected the child, persist that exact capture. Otherwise
     # a newly registered direct successor gets one immediate normal collection attempt.
     if child and (created or child_raw is not None) and relist_result.get('capture')!='manual_recovery':
      try:
       if child_raw is None: child_raw=collect_listing(child['url'],HEADLESS)
       save_success(child,child_raw); run_matcher_for_listing(child['id'])
       relist_result['capture']='success'; relist_result['views']=child_raw.get('views')
       print(f"RELIST SUCCESS {child['listing_id']} views={child_raw.get('views')}")
      except Exception as child_e:
       child_failures=save_failure(child,child_e)
       try: log_collection_error(child,child_e,run['id'],child_failures)
       except Exception as log_e: print(f'WARNING: failed to write relist child collection error: {log_e}')
       relist_result.update({'capture':'manual_recovery','error_type':getattr(child_e,'error_type',child_e.__class__.__name__),'error':str(child_e)[:1000]})
       print(f"RELIST CHILD PAUSED {child['listing_id']} [{relist_result['error_type']}] {child_e}")
    ok+=1
    after=(db.table('listings').select('next_observation_at,observation_interval_hours,cadence_reason').eq('id',listing['id']).limit(1).execute().data or [{}])[0]
    duration_ms=int((time.monotonic()-item_started)*1000)
    print(f"SUCCESS {listing['listing_id']} views={raw.get('views')} duration={duration_ms}ms")
    details.append({'listing_id':listing['listing_id'],'ok':True,'views':raw.get('views'),'price':raw.get('buy_now_nzd') or raw.get('asking_price_nzd'),'due_at_before':before_due,'next_observation_at_after':after.get('next_observation_at'),'interval_hours_after':after.get('observation_interval_hours'),'cadence_reason_after':after.get('cadence_reason'),'duration_ms':duration_ms,'matcher':match_result,'explicit_relist':relist_result})
   except Exception as e:
    failed+=1; failures=save_failure(listing,e); duration_ms=int((time.monotonic()-item_started)*1000)
    after=(db.table('listings').select('next_observation_at,observation_interval_hours,cadence_reason,last_error').eq('id',listing['id']).limit(1).execute().data or [{}])[0]
    error_type=getattr(e,'error_type',e.__class__.__name__)
    print(f"FAILED {listing['listing_id']} [{error_type}] {e}")
    try: log_collection_error(listing,e,run['id'],failures)
    except Exception as log_e: print(f'WARNING: failed to write collection_errors row: {log_e}')
    details.append({'listing_id':listing['listing_id'],'ok':False,'error':str(e)[:2000],'error_type':error_type,'stage':getattr(e,'stage',None),'due_at_before':before_due,'next_observation_at_after':after.get('next_observation_at'),'cadence_reason_after':after.get('cadence_reason'),'duration_ms':duration_ms})

  finished=iso_now(); status='success' if failed==0 else ('partial' if ok>0 else 'failed')
  db.table('collection_runs').update({'finished_at':finished,'listings_attempted':attempted,'listings_succeeded':ok,'listings_failed':failed,'details':details}).eq('id',run['id']).execute()
  try: finish(status,'worker_complete',worker_run_id=run['id'],listings_attempted=attempted,listings_succeeded=ok,listings_failed=failed,selected_count=len(selected),candidate_listing_ids=selected_ids,diagnostics={'headless':HEADLESS,'max_listings_per_run':MAX})
  except Exception as e: print(f'WARNING: scheduler telemetry finish failed: {e}')
  print(json.dumps({'attempted':attempted,'succeeded':ok,'failed':failed,'details':details},indent=2))
  if failed and not ok: raise RuntimeError(f'All {failed} selected listing collections failed')
 except Exception as e:
  local_log('worker_fatal',error_type=e.__class__.__name__,error_message=str(e)[:1500])
  try: finish('failed','worker_failed',worker_run_id=run.get('id') if run else None,listings_attempted=0 if not run else None,error_type=e.__class__.__name__,error_message=str(e)[:1500],diagnostics={'traceback':traceback.format_exc()[-5000:]})
  except Exception: pass
  raise

if __name__=='__main__':main()
