#!/usr/bin/env python3
"""Probe one ended COBALT listing for a relist using the production collector.

Examples:
  python3 worker/recheck_relist.py 6110749863
  python3 worker/recheck_relist.py 6110749863 --candidate-url https://www.trademe.co.nz/a/.../listing/6121769780
  python3 worker/recheck_relist.py 6110749863 --candidate-url ... --apply

Dry-run is the default. --apply writes lineage only after deterministic redirect/explicit-link
proof or a conservative semantic match clears the production threshold.
"""
from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from dotenv import load_dotenv
from collector import collect_listing, marketplace_listing_id
from db import client, register_relist_successor, save_success, effective_ended
from relist import compare_relist


def latest_obs(db,lid):
    rows=(db.table('observations').select('*').eq('listing_uuid',lid).order('captured_at',desc=True).limit(1).execute().data or [])
    return rows[0] if rows else None


def candidate_listing(raw):
    return {'listing_id':str(raw.get('listing_id') or marketplace_listing_id(raw.get('final_url')) or ''),'url':raw.get('final_url') or raw.get('url'),'title':raw.get('listing_title'),'seller':raw.get('seller'),'metadata':{'category_path':raw.get('category_path') or []}}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('listing_id')
    ap.add_argument('--candidate-url')
    ap.add_argument('--apply',action='store_true',help='write confirmed lineage to Supabase')
    ap.add_argument('--headful',action='store_true')
    args=ap.parse_args()
    load_dotenv(HERE/'.env'); load_dotenv(HERE.parent/'web'/'.env.local')
    db=client(); rows=(db.table('listings').select('*').eq('listing_id',str(args.listing_id)).limit(1).execute().data or [])
    if not rows: raise SystemExit(f'Listing {args.listing_id} is not in COBALT')
    parent=rows[0]; old_obs=latest_obs(db,parent['id']) or {'captured_at':parent.get('last_observed_at'),'raw_snapshot':{}}
    print('COBALT RELIST PROBE')
    print('===================')
    print(f"Original listing: {parent.get('listing_id')}  {parent.get('title') or ''}")
    print(f"Lifecycle state:  {parent.get('lifecycle_state')}  episode={parent.get('lifecycle_episode') or 1}")
    print(f"Original URL:     {parent.get('url')}")
    raw=collect_listing(parent['url'],headless=not args.headful)
    observed=str(raw.get('listing_id') or marketplace_listing_id(raw.get('final_url')) or '')
    print(f"Observed URL:     {raw.get('final_url')}")
    print(f"Observed ID:      {observed}")
    if observed and observed!=str(parent.get('listing_id')):
        print('Decision:         RELIST CONFIRMED (marketplace redirect)')
        print('Confidence:       100% lineage confidence')
        print(f"Counter handling: old episode stays intact; new episode starts at views={raw.get('views')}")
        if args.apply:
            child,created=register_relist_successor(parent,candidate_listing(raw),'marketplace_redirect',1.0,['old listing URL resolved to a different marketplace listing ID'])
            save_success(child,raw)
            print(f"Applied:          yes · child #{child.get('listing_id')} · created={created}")
        else: print('Applied:          no (dry-run)')
        return

    print(f"Page ended:       {effective_ended(raw)}")
    explicit=raw.get('explicit_relist')
    if explicit:
        print(f"Explicit link:    {explicit.get('url')}  id={explicit.get('listing_id')}")
    candidates=raw.get('relist_candidates') or []
    if candidates: print(f"Page candidates:  {len(candidates)}")

    target_url=args.candidate_url or (explicit or {}).get('url')
    if not target_url:
        # Probe only the first few conservative page candidates. The production worker does the
        # same and then applies ambiguity protection across the scored set.
        target_url=(candidates[0].get('url') if candidates else None)
    if not target_url:
        print('Decision:         NO SUCCESSOR FOUND ON THIS CHECK')
        print('Next action:      keep sparse relist-watch checks; no lineage is guessed')
        return

    child_raw=collect_listing(target_url,headless=not args.headful)
    child=candidate_listing(child_raw); cid=child.get('listing_id')
    print(f"Candidate ID:     {cid}")
    print(f"Candidate title:  {child.get('title')}")
    print(f"Candidate seller: {child.get('seller')}")
    if explicit and str((explicit or {}).get('listing_id') or '')==str(cid) and cid!=str(parent.get('listing_id')):
        method='marketplace_explicit_link'; confidence=1.0; reasons=['marketplace explicitly linked successor']; matched=True; details={}
    else:
        m=compare_relist(child,{**child_raw,'raw_snapshot':child_raw},parent,old_obs,method='manual_probe')
        method='semantic_match'; confidence=m.score; reasons=m.reasons; matched=m.match; details=m.to_dict()
    print(f"Decision:         {'RELIST CONFIRMED' if matched else 'NOT AUTO-CONFIRMED'}")
    print(f"Confidence:       {confidence*100:.1f}%")
    for r in reasons: print(f"  - {r}")
    if details: print('Matcher evidence: '+json.dumps(details,ensure_ascii=False))
    print(f"Counter handling: old final views={old_obs.get('views')} are retained; child starts at views={child_raw.get('views')} with no negative delta")
    if matched and args.apply:
        row={**child,'listing_title':child.get('title')}
        linked,created=register_relist_successor(parent,row,method,confidence,reasons)
        save_success(linked,child_raw)
        print(f"Applied:          yes · child #{linked.get('listing_id')} · created={created}")
    else:
        print('Applied:          no'+(' (dry-run)' if matched else ''))

if __name__=='__main__': main()
