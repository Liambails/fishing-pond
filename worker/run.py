import os,json
from datetime import datetime,timezone
from dotenv import load_dotenv
from collector import collect_listing
from db import client,due_listings,save_success,save_failure,log_collection_error
load_dotenv(); MAX=int(os.getenv('MAX_LISTINGS_PER_RUN','12')); HEADLESS=os.getenv('HEADLESS','true').lower() not in ('0','false','no')
def main():
 db=client(); run=db.table('collection_runs').insert({'source':'github-actions/playwright','started_at':datetime.now(timezone.utc).isoformat()}).execute().data[0]; attempted=ok=failed=0; details=[]; selected=due_listings(MAX); print(f'Due listings selected: {len(selected)}')
 for listing in selected:
  attempted+=1; print(f"Opening {listing['listing_id']} priority={listing.get('priority')} due={listing.get('next_observation_at')}")
  try:
   raw=collect_listing(listing['url'],HEADLESS); save_success(listing,raw); ok+=1; print(f"SUCCESS {listing['listing_id']} views={raw.get('views')}"); details.append({'listing_id':listing['listing_id'],'ok':True,'views':raw.get('views'),'price':raw.get('buy_now_nzd') or raw.get('asking_price_nzd')})
  except Exception as e:
   failed+=1; failures=save_failure(listing,e); print(f"FAILED {listing['listing_id']} [{getattr(e,'error_type',e.__class__.__name__)}] {e}")
   try: log_collection_error(listing,e,run['id'],failures)
   except Exception as log_e: print(f'WARNING: failed to write collection_errors row: {log_e}')
   details.append({'listing_id':listing['listing_id'],'ok':False,'error':str(e)})
 db.table('collection_runs').update({'finished_at':datetime.now(timezone.utc).isoformat(),'listings_attempted':attempted,'listings_succeeded':ok,'listings_failed':failed,'details':details}).eq('id',run['id']).execute(); print(json.dumps({'attempted':attempted,'succeeded':ok,'failed':failed,'details':details},indent=2))
if __name__=='__main__':main()
