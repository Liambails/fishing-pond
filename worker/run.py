import os,json,time,traceback,urllib.request
from datetime import datetime,timezone
from dotenv import load_dotenv
from collector import collect_listing,marketplace_listing_id
from db import client,due_listings,save_success,save_failure,log_collection_error,register_explicit_relist,register_relist_successor,effective_ended
from relist import compare_relist,pick_best_relist
from scheduler_telemetry import upsert,finish,local_log

load_dotenv(); MAX=int(os.getenv('MAX_LISTINGS_PER_RUN','12')); HEADLESS=os.getenv('HEADLESS','true').lower() not in ('0','false','no')

def iso_now(): return datetime.now(timezone.utc).isoformat()


def collect_listing_preferred(listing,headless=True):
 return collect_listing(listing['url'],headless),'playwright'

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

def _candidate_listing(raw):
 return {
  'listing_id':str(raw.get('listing_id') or marketplace_listing_id(raw.get('final_url')) or ''),
  'url':raw.get('final_url') or raw.get('url'),
  'title':raw.get('listing_title'),
  'seller':raw.get('seller'),
  'metadata':{'category_path':raw.get('category_path') or []}
 }

def _latest_parent_observation(db,listing):
 rows=(db.table('observations').select('*').eq('listing_uuid',listing['id']).order('captured_at',desc=True).limit(1).execute().data or [])
 return rows[0] if rows else {'captured_at':listing.get('last_observed_at'),'raw_snapshot':{'listing_title':listing.get('title'),'seller':listing.get('seller')}}

def detect_relist_from_capture(listing,raw,db,headless,run_id=None):
 """Resolve redirect, marketplace-explicit, and conservative semantic relist evidence.

 Returns a diagnostic dict or None. A successor's first counters are always saved into the child
 episode, never as a negative delta on the ended parent.
 """
 parent_id=str(listing.get('listing_id') or '')
 observed_id=str(raw.get('listing_id') or marketplace_listing_id(raw.get('final_url')) or '')
 if observed_id and observed_id!=parent_id:
  child_raw=raw; child,created=register_relist_successor(listing,{**_candidate_listing(child_raw),'listing_id':observed_id},'marketplace_redirect',1.0,['old listing URL resolved to a different marketplace listing ID'])
  if child:
   save_success(child,child_raw); run_matcher_for_listing(child['id'])
   return {'listing_id':observed_id,'created':created,'source':'marketplace_redirect','confidence':1.0,'capture':'success','views':child_raw.get('views')}
  return {'listing_id':observed_id,'created':False,'source':'marketplace_redirect','capture':'rejected'}
 explicit=raw.get('explicit_relist')
 if not effective_ended(raw) and not explicit:
  return None
 candidates=list(raw.get('relist_candidates') or [])
 if explicit and not any(str(x.get('url'))==str(explicit.get('url')) for x in candidates): candidates.insert(0,explicit)
 if not candidates: return None
 parent_obs=_latest_parent_observation(db,listing); scored=[]; diagnostics=[]
 for cand in candidates[:6]:
  cid=str(cand.get('listing_id') or '')
  source=str(cand.get('source') or 'ended_page_candidate')
  if source=='marketplace_explicit_link' and cid and cid!=parent_id:
   # Trade Me itself naming a different successor is deterministic lineage evidence. Register
   # immediately; the first child capture can recover manually if the marketplace challenges us.
   child,created=register_explicit_relist(listing,cand)
   if not child: continue
   try:
    child_raw=collect_listing(child['url'],headless); actual=str(child_raw.get('listing_id') or marketplace_listing_id(child_raw.get('final_url')) or '')
    if actual and actual!=str(child.get('listing_id')):
     child,created=register_relist_successor(listing,{**_candidate_listing(child_raw),'listing_id':actual},'marketplace_redirect',1.0,['explicit relist link redirected to successor'])
    save_success(child,child_raw); run_matcher_for_listing(child['id'])
    return {'listing_id':child.get('listing_id'),'created':created,'source':'marketplace_explicit_link','confidence':1.0,'capture':'success','views':child_raw.get('views')}
   except Exception as e:
    failures=save_failure(child,e)
    try: log_collection_error(child,e,run_id,failures)
    except Exception: pass
    return {'listing_id':child.get('listing_id'),'created':created,'source':'marketplace_explicit_link','confidence':1.0,'capture':'manual_recovery','error_type':getattr(e,'error_type',e.__class__.__name__),'error':str(e)[:1000]}
  try:
   child_raw=collect_listing(cand['url'],headless); actual=str(child_raw.get('listing_id') or marketplace_listing_id(child_raw.get('final_url')) or '')
   if not actual or actual==parent_id: continue
   cl=_candidate_listing(child_raw); cl['listing_id']=actual
   match=compare_relist(cl,{**child_raw,'raw_snapshot':child_raw},listing,parent_obs,method='ended_page_semantic')
   scored.append(({'listing':cl,'raw':child_raw,'candidate':cand},match)); diagnostics.append({'listing_id':actual,**match.to_dict()})
  except Exception as e:
   diagnostics.append({'listing_id':cid or None,'error_type':getattr(e,'error_type',e.__class__.__name__),'error':str(e)[:500]})
 best,ranked=pick_best_relist(scored)
 if not best:
  return {'source':'ended_page_candidates','linked':False,'candidates':diagnostics[:6]}
 bundle,match=best; cl=bundle['listing']; child_raw=bundle['raw']
 child,created=register_relist_successor(listing,cl,'ended_page_semantic',match.score,match.reasons)
 if child:
  save_success(child,child_raw); run_matcher_for_listing(child['id'])
  return {'listing_id':child.get('listing_id'),'created':created,'source':'ended_page_semantic','confidence':match.score,'capture':'success','views':child_raw.get('views'),'reasons':match.reasons,'candidates':diagnostics[:6]}
 return {'source':'ended_page_candidates','linked':False,'candidates':diagnostics[:6]}


def detect_search_watch_relist(listing,raw,db):
 if str(listing.get('discovered_via') or '')!='browser_search' or listing.get('relisted_from'):
  return None
 seller=str(raw.get('seller') or listing.get('seller') or '').strip()
 if not seller:return None
 try:
  parents=(db.table('listings').select('*').eq('marketplace',listing.get('marketplace') or 'Trade Me').neq('id',listing['id']).in_('lifecycle_state',['relist_watch','terminal_closed','relisted']).order('finalized_at',desc=True).limit(120).execute().data or [])
 except Exception:
  return None
 matches=[]
 candidate={'listing_id':listing.get('listing_id'),'url':listing.get('url'),'title':raw.get('listing_title') or listing.get('title'),'seller':seller,'metadata':{'category_path':raw.get('category_path') or []}}
 candidate_obs={**raw,'raw_snapshot':raw}
 for parent in parents:
  if str(parent.get('seller') or '').strip().lower()!=seller.lower():continue
  parent_obs=_latest_parent_observation(db,parent)
  match=compare_relist(candidate,candidate_obs,parent,parent_obs,method='search_watch_semantic')
  matches.append((parent,match))
 best,ranked=pick_best_relist(matches)
 if not best:return None
 parent,match=best
 child,created=register_relist_successor(parent,candidate,'search_watch_semantic',match.score,match.reasons)
 if not child:return None
 listing.update(child)
 return {'listing_id':listing.get('listing_id'),'created':created,'source':'search_watch_semantic','confidence':match.score,'reasons':match.reasons}

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
    raw,acquisition_source=collect_listing_preferred(listing,HEADLESS)
    observed_id=str(raw.get('listing_id') or marketplace_listing_id(raw.get('final_url')) or '')
    relist_result=None
    if observed_id and observed_id!=str(listing.get('listing_id') or ''):
     # Detect the redirect before persistence: successor counters must never be written onto the
     # ended parent UUID.
     relist_result=detect_relist_from_capture(listing,raw,db,HEADLESS,run['id']); match_result=None
    else:
     search_relist=detect_search_watch_relist(listing,raw,db) if str(listing.get('discovered_via') or '')=='browser_search' else None
     save_success(listing,raw); match_result=run_matcher_for_listing(listing['id'])
     if str(listing.get('discovered_via') or '')=='browser_search':
      try:
       db.table('listings').update({'last_acquisition_status':'success','last_acquisition_error_type':None,'last_acquisition_event_at':iso_now()}).eq('id',listing['id']).execute()
       db.table('listing_acquisition_events').insert({'listing_uuid':listing['id'],'operation':'listing_detail','source':'playwright','status':'success','occurred_at':iso_now(),'duration_ms':int((time.monotonic()-item_started)*1000),'diagnostics':{'views':raw.get('views'),'price':raw.get('buy_now_nzd') or raw.get('asking_price_nzd')}}).execute()
      except Exception as acquisition_log_e: print(f'WARNING: acquisition telemetry write failed: {acquisition_log_e}')
     if search_relist: relist_result=search_relist
     # Persist the closure first, then inspect explicit/semantic successor candidates.
     if effective_ended(raw):
      relist_result=detect_relist_from_capture(listing,raw,db,HEADLESS,run['id'])
    ok+=1
    after=(db.table('listings').select('next_observation_at,observation_interval_hours,cadence_reason').eq('id',listing['id']).limit(1).execute().data or [{}])[0]
    duration_ms=int((time.monotonic()-item_started)*1000)
    print(f"SUCCESS {listing['listing_id']} source={acquisition_source} views={raw.get('views')} duration={duration_ms}ms")
    details.append({'listing_id':listing['listing_id'],'ok':True,'views':raw.get('views'),'price':raw.get('buy_now_nzd') or raw.get('asking_price_nzd'),'due_at_before':before_due,'next_observation_at_after':after.get('next_observation_at'),'interval_hours_after':after.get('observation_interval_hours'),'cadence_reason_after':after.get('cadence_reason'),'duration_ms':duration_ms,'acquisition_source':acquisition_source,'matcher':match_result,'explicit_relist':relist_result})
   except Exception as e:
    failed+=1; failures=save_failure(listing,e); duration_ms=int((time.monotonic()-item_started)*1000)
    after=(db.table('listings').select('next_observation_at,observation_interval_hours,cadence_reason,last_error').eq('id',listing['id']).limit(1).execute().data or [{}])[0]
    error_type=getattr(e,'error_type',e.__class__.__name__)
    if str(listing.get('discovered_via') or '')=='browser_search':
     try:
      db.table('listings').update({'last_acquisition_status':'failed','last_acquisition_error_type':error_type,'last_acquisition_event_at':iso_now()}).eq('id',listing['id']).execute()
      db.table('listing_acquisition_events').insert({'listing_uuid':listing['id'],'operation':'listing_detail','source':'playwright','status':'failed','occurred_at':iso_now(),'duration_ms':duration_ms,'error_type':error_type,'error_message':str(e)[:1500],'diagnostics':{'stage':getattr(e,'stage',None),'http_status':getattr(e,'http_status',None)}}).execute()
     except Exception as acquisition_log_e: print(f'WARNING: failed to write acquisition telemetry: {acquisition_log_e}')
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
