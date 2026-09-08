#!/usr/bin/env python3
"""Make active COBALT listings whose last trusted close_date has passed due immediately.

Dry-run by default. This is intentionally conservative: it does not mark a listing ended from the
clock alone; it only schedules an immediate worker confirmation, which can then detect a relist.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name('.env'))
from db import client  # noqa: E402


def parse_dt(v):
    if not v:return None
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00')).astimezone(timezone.utc)
    except Exception:return None


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');args=ap.parse_args()
    db=client();now=datetime.now(timezone.utc)
    listings=(db.table('listings').select('*').eq('active',True).execute().data or [])
    due=[]
    for l in listings:
        rows=(db.table('observations').select('captured_at,close_date,lifecycle_episode').eq('listing_uuid',l['id']).eq('lifecycle_episode',int(l.get('lifecycle_episode') or 1)).order('captured_at',desc=True).limit(1).execute().data or [])
        if not rows:continue
        close=parse_dt(rows[0].get('close_date'))
        if close and close<=now:
            due.append((l,close))
    print(f"COBALT expired-listing due sweep — {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Expired active listings needing confirmation: {len(due)}")
    for l,close in sorted(due,key=lambda x:x[1]):
        print(f"  #{l.get('listing_id')} close={close.isoformat()} state={l.get('lifecycle_state')} next={l.get('next_observation_at')}")
        if args.apply:
            db.table('listings').update({'next_observation_at':now.isoformat(),'priority':max(96,int(l.get('priority') or 0)),'cadence_reason':'expiry passed · closure/relist confirmation due'}).eq('id',l['id']).execute()
    if not args.apply:print('No rows changed. Re-run with --apply after reviewing the list.')

if __name__=='__main__':main()
