#!/usr/bin/env python3
import argparse, os, json
from supabase import create_client

def main():
    ap=argparse.ArgumentParser();ap.add_argument('query',help='marketplace listing ID or title substring');args=ap.parse_args()
    db=create_client(os.environ['SUPABASE_URL'],os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    rows=(db.table('listings').select('*').order('last_observed_at',desc=True).limit(5000).execute().data or [])
    q=args.query.lower(); found=[r for r in rows if q==str(r.get('listing_id','')).lower() or q in str(r.get('title','')).lower()]
    if not found:raise SystemExit('No matching listing found')
    for l in found[:10]:
        print('\n',l.get('listing_id'),l.get('title'))
        print(' active=',l.get('active'),'state=',l.get('lifecycle_state'),'next=',l.get('next_observation_at'),'interval=',l.get('observation_interval_hours'),'reason=',l.get('cadence_reason'))
        obs=(db.table('observations').select('captured_at,views,watchers,bids,current_bid_nzd,starting_price_nzd,buy_now_nzd,asking_price_nzd,close_date,sold_detected').eq('listing_uuid',l['id']).order('captured_at',desc=True).limit(12).execute().data or [])
        for o in reversed(obs):
            print(' ',json.dumps(o,default=str))

if __name__=='__main__':main()
