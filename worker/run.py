import os, json
from datetime import datetime, timezone
from dotenv import load_dotenv
from collector import collect_listing
from db import client, due_listings, save_success, save_failure

load_dotenv()
MAX=int(os.getenv('MAX_LISTINGS_PER_RUN','3'))
HEADLESS=os.getenv('HEADLESS','true').lower() not in ('0','false','no')

def main():
    db=client(); started=datetime.now(timezone.utc).isoformat()
    run=db.table('collection_runs').insert({'source':'github-actions/playwright','started_at':started}).execute().data[0]
    attempted=ok=failed=0; details=[]
    for listing in due_listings(MAX):
        attempted+=1
        try:
            raw=collect_listing(listing['url'],HEADLESS); save_success(listing,raw); ok+=1
            details.append({'listing_id':listing['listing_id'],'ok':True,'views':raw.get('views'),'price':raw.get('buy_now_nzd') or raw.get('asking_price_nzd')})
        except Exception as e:
            failed+=1; save_failure(listing,str(e)); details.append({'listing_id':listing['listing_id'],'ok':False,'error':str(e)})
    db.table('collection_runs').update({'finished_at':datetime.now(timezone.utc).isoformat(),'listings_attempted':attempted,'listings_succeeded':ok,'listings_failed':failed,'details':details}).eq('id',run['id']).execute()
    print(json.dumps({'attempted':attempted,'succeeded':ok,'failed':failed,'details':details},indent=2))

if __name__=='__main__': main()
