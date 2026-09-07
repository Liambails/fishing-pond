#!/usr/bin/env python3
"""Recheck one Trade Me listing and repair unsafe view observations.

Usage:
  cd worker
  python3 recheck_listing.py 6108372920
  python3 recheck_listing.py 6108372920 --dry-run

The script never invents a historical view count. Any observation captured by the retired
whole-page fallback is quarantined by setting views=NULL, then a fresh trusted observation is
collected and saved through the normal worker path.
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from collector import collect_listing
from db import client, save_success

load_dotenv()


def view_source(raw):
    return str((((raw or {}).get('_sources') or {}).get('views') or {}).get('source') or '')


def trusted(raw):
    src = view_source(raw)
    return raw.get('views') is not None and bool(src) and not src.startswith('page-text:')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('listing_id', help='Trade Me listing ID, e.g. 6108372920')
    ap.add_argument('--dry-run', action='store_true', help='Collect and report only; do not change Supabase')
    ap.add_argument('--headful', action='store_true', help='Show Chromium while collecting')
    args = ap.parse_args()

    db = client()
    rows = (db.table('listings').select('*').eq('marketplace', 'Trade Me').eq('listing_id', str(args.listing_id)).limit(1).execute().data or [])
    if not rows:
        raise SystemExit(f'Listing {args.listing_id} not found in COBALT')
    listing = rows[0]

    print(f"Rechecking Trade Me #{args.listing_id}")
    print(f"URL: {listing['url']}")

    captures = []
    for i in range(2):
        raw = collect_listing(listing['url'], headless=not args.headful)
        captures.append(raw)
        print(f"capture {i+1}: views={raw.get('views')} source={view_source(raw) or 'NONE'} version={raw.get('collector_version')}")
        if i == 0:
            time.sleep(2)

    valid = [r for r in captures if trusted(r)]
    if not valid:
        raise SystemExit('No trusted views value was found. No database changes made.')
    values = [int(r['views']) for r in valid]
    if max(values) - min(values) > 3:
        raise SystemExit(f'Trusted captures disagree too much ({values}). No database changes made.')
    fresh = valid[-1]

    obs = (db.table('observations').select('id,captured_at,views,raw_snapshot').eq('listing_uuid', listing['id']).order('captured_at').execute().data or [])
    bad = []
    for o in obs:
        raw = o.get('raw_snapshot') or {}
        src = view_source(raw)
        if src.startswith('page-text:') and o.get('views') is not None:
            bad.append(o)

    print(f"Unsafe historical view rows found: {len(bad)}")
    for o in bad:
        print(f"  observation {o['id']} {o['captured_at']} views={o.get('views')} source={view_source(o.get('raw_snapshot') or {})}")

    if args.dry_run:
        print('DRY RUN: no rows changed.')
        return

    for o in bad:
        raw = dict(o.get('raw_snapshot') or {})
        old = raw.get('views')
        raw['views'] = None
        raw['_view_repair'] = {
            'repaired_at': datetime.now(timezone.utc).isoformat(),
            'old_views': old,
            'reason': 'retired whole-page view fallback produced an untrusted count',
            'replacement': 'fresh trusted observation saved separately'
        }
        db.table('observations').update({'views': None, 'raw_snapshot': raw}).eq('id', o['id']).execute()

    save_success(listing, fresh)
    print(f"Saved fresh trusted observation: views={fresh.get('views')} source={view_source(fresh)}")
    print('Repair complete. Historical unsafe values were quarantined rather than rewritten with a later count.')


if __name__ == '__main__':
    main()
