#!/usr/bin/env python3
"""One-off V3.10.12 reseed: only pull active due-times earlier when new cadence requires it."""
import argparse, os
from datetime import datetime, timezone, timedelta
from supabase import create_client
from cadence import adaptive_cadence_hours, close_aware_interval_hours
from close_date import normalize_close_date


def dt(v):
    if not v:return None
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except:return None


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');args=ap.parse_args()
    db=create_client(os.environ['SUPABASE_URL'],os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    rows=(db.table('listings').select('*').eq('active',True).order('last_observed_at',desc=True).limit(5000).execute().data or [])
    changed=[]; now=datetime.now(timezone.utc)
    for l in rows:
        obs=(db.table('observations').select('captured_at,views,bids,watchers,question_count,purchase_intent_questions,close_date,lifecycle_episode').eq('listing_uuid',l['id']).eq('lifecycle_episode',int(l.get('lifecycle_episode') or 1)).order('captured_at',desc=True).limit(12).execute().data or [])
        if not obs:continue
        events=[]
        try:events=(db.table('listing_acquisition_events').select('occurred_at,operation,source,status,diagnostics').eq('listing_uuid',l['id']).order('occurred_at',desc=True).limit(100).execute().data or [])
        except:pass
        hours,reason,_=adaptive_cadence_hours(l,obs,events)
        latest=obs[0]; close=normalize_close_date(latest.get('close_date'),latest.get('captured_at'))
        hours,suffix=close_aware_interval_hours(hours,close,now)
        if suffix:reason=f'{reason} · {suffix}'
        proposed=now+timedelta(hours=hours)
        if close:
            c=dt(close)
            if c and c>now:
                closure=c+timedelta(minutes=10)
                if closure<proposed:
                    proposed=closure;hours=max(.01,(proposed-now).total_seconds()/3600);reason=f'{reason} · closure confirmation 10m after expiry'
        existing=dt(l.get('next_observation_at'))
        if existing is None or proposed<existing-timedelta(minutes=1):
            changed.append((l,existing,proposed,hours,reason))
    print(f'COBALT V3.10.12 close-aware reseed — {"APPLY" if args.apply else "DRY RUN"}')
    print(f'Active listings pulled earlier: {len(changed)}')
    for l,old,new,hours,reason in changed[:100]:
        print(f"  #{l.get('listing_id')} {str(l.get('title') or '')[:58]} | {old} -> {new.isoformat()} | {hours:.2f}h | {reason}")
        if args.apply:
            db.table('listings').update({'next_observation_at':new.isoformat(),'observation_interval_hours':hours,'cadence_reason':reason,'priority':98 if hours<=.5 else 95 if hours<=2 else 92 if hours<=3 else 88 if hours<=6 else 68 if hours<=12 else 50}).eq('id',l['id']).execute()
    if not args.apply:print('No rows changed. Re-run with --apply after reviewing.')

if __name__=='__main__':main()
