#!/usr/bin/env python3
"""Backfill normalized close_date values from already-stored raw snapshots.

Safe/idempotent by default: dry-run only. Use --apply to update observations whose
close_date is NULL but whose raw_snapshot contains a parseable Trade Me close timestamp.
No observations are deleted and existing non-null close_date values are left untouched.
"""
from __future__ import annotations
import argparse, json
from db import client
from close_date import normalize_close_date


def raw_close(row):
    raw=row.get('raw_snapshot') or {}
    if isinstance(raw,str):
        try: raw=json.loads(raw)
        except Exception: return None
    return raw.get('close_date') if isinstance(raw,dict) else None


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--apply',action='store_true')
    ap.add_argument('--limit',type=int,default=100000)
    args=ap.parse_args()
    db=client(); offset=0; batch=1000; scanned=parsed=updated=failed=0; examples=[]
    while scanned < args.limit:
        end=min(offset+batch-1,args.limit-1)
        rows=(db.table('observations').select('id,captured_at,close_date,raw_snapshot').is_('close_date','null').range(offset,end).execute().data or [])
        if not rows: break
        # Because the query set shrinks while applying, keep offset at zero in apply mode.
        if not args.apply: offset += len(rows)
        for row in rows:
            scanned += 1
            raw=raw_close(row)
            iso=normalize_close_date(raw,row.get('captured_at')) if raw else None
            if not iso: continue
            parsed += 1
            if len(examples)<12: examples.append((row['id'],raw,iso))
            if args.apply:
                try:
                    db.table('observations').update({'close_date':iso}).eq('id',row['id']).is_('close_date','null').execute()
                    updated += 1
                except Exception as e:
                    failed += 1; print(f"FAILED {row['id']}: {e}")
        if len(rows)<batch: break
    print(f"scanned_null_close={scanned} parseable={parsed} updated={updated} failed={failed} mode={'APPLY' if args.apply else 'DRY_RUN'}")
    for rid,raw,iso in examples: print(f"  {rid}: {raw!r} -> {iso}")

if __name__=='__main__': main()
