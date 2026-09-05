#!/usr/bin/env python3
import csv, os, re, argparse
from datetime import datetime, timezone, timedelta
from supabase import create_client

def n(v):
    try:return float(v) if str(v).strip() else None
    except:return None

def main():
    ap=argparse.ArgumentParser();ap.add_argument('csv_path');args=ap.parse_args()
    db=create_client(os.environ['SUPABASE_URL'],os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    with open(args.csv_path,newline='',encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
    inserted=0
    for r in rows:
        listing_id=(r.get('listing_id') or '').strip()
        if not listing_id:continue
        url=re.sub(r'[?#].*$','',r.get('url') or r.get('source_url') or '')
        captured=r.get('last_seen') or r.get('first_seen') or datetime.now(timezone.utc).isoformat()
        lp={'marketplace':r.get('marketplace') or 'Trade Me','listing_id':listing_id,'url':url,'source_url':r.get('source_url') or url,'title':r.get('listing_title') or None,'seller':r.get('seller') or None,'first_seen':r.get('first_seen') or captured,'last_seen':captured,'last_observed_at':captured,'next_observation_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),'metadata':{'vehicle':r.get('vehicle'),'chassis':r.get('chassis'),'part_type':r.get('part_type'),'legacy_record_id':r.get('record_id')}}
        res=db.table('listings').upsert(lp,on_conflict='marketplace,listing_id').execute(); listing=res.data[0]
        raw={k:v for k,v in r.items() if v not in ('',None)}
        obs={'listing_uuid':listing['id'],'captured_at':captured,'collector_version':r.get('collector_version') or 'legacy-import','listing_mode':r.get('listing_mode') or None,'buy_now_nzd':n(r.get('buy_now_nzd')),'asking_price_nzd':n(r.get('asking_price_nzd')),'starting_price_nzd':n(r.get('starting_price_nzd')),'current_bid_nzd':n(r.get('current_bid_nzd')),'views':int(n(r.get('views')) or 0) if r.get('views') else None,'watchers':int(n(r.get('watchers')) or 0) if r.get('watchers') else None,'bids':int(n(r.get('bids')) or 0) if r.get('bids') else None,'close_remaining':r.get('close_remaining') or None,'condition':r.get('condition') or None,'location':r.get('location') or None,'seller':r.get('seller') or None,'part_number':r.get('part_number') or None,'vehicle':r.get('vehicle') or None,'chassis':r.get('chassis') or None,'years':r.get('years') or None,'engine_code':r.get('engine_code') or None,'part_type':r.get('part_type') or None,'extraction_score':int(n(r.get('extraction_score')) or 0) if r.get('extraction_score') else None,'quality_flags':[],'raw_snapshot':raw}
        db.table('observations').upsert(obs,on_conflict='listing_uuid,captured_at').execute();inserted+=1
    print(f'Imported {inserted} legacy listing snapshots.')
if __name__=='__main__':main()
