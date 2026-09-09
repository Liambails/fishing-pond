"""One-time buyer-signal refresh for existing active COBALT listings.

Uses the normal Playwright collector and normal save path. It does not bypass challenges,
rotate identities, or alter independent-observation rules. A capture inside the 3h evidence
window remains history but cannot manufacture an extra velocity window.

Usage:
  python3 backfill_buyer_signals.py --limit 50
  python3 backfill_buyer_signals.py --all
"""
import argparse, time
from dotenv import load_dotenv
from collector import collect_listing
from db import client, save_success, save_failure

load_dotenv()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--limit',type=int,default=50)
    ap.add_argument('--all',action='store_true')
    ap.add_argument('--delay',type=float,default=3.0,help='fixed pause between normal page loads')
    ap.add_argument('--headed',action='store_true')
    args=ap.parse_args()
    db=client()
    q=db.table('listings').select('*').eq('active',True).order('last_observed_at')
    if not args.all:q=q.limit(max(1,args.limit))
    rows=q.execute().data or []
    print(f'BUYER SIGNAL REFRESH: {len(rows)} active listings')
    ok=failed=watch_visible=bid_visible=sold=0
    for i,l in enumerate(rows,1):
        print(f'[{i}/{len(rows)}] {l.get("listing_id")} {str(l.get("title") or "")[:70]}')
        try:
            raw=collect_listing(l['url'],headless=not args.headed)
            save_success(l,raw); ok+=1
            if raw.get('watchers') is not None:watch_visible+=1
            if raw.get('bids') is not None:bid_visible+=1
            if raw.get('sold_detected'):sold+=1
            print(f'  views={raw.get("views")} watchers={raw.get("watchers")} bids={raw.get("bids")} sold={raw.get("sold_detected")}')
        except Exception as e:
            failed+=1
            try:save_failure(l,e)
            except Exception:pass
            print(f'  FAILED: {type(e).__name__}: {str(e)[:240]}')
        if i<len(rows):time.sleep(max(0,args.delay))
    print(f'DONE ok={ok} failed={failed} watcher_counts={watch_visible} bid_counts={bid_visible} sold={sold}')

if __name__=='__main__':main()
