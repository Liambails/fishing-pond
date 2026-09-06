import json
import os
import sys
import urllib.parse
import urllib.request
import time
from datetime import datetime, timezone
from scheduler_telemetry import upsert, finish, local_log

url=os.environ.get('SUPABASE_URL','').rstrip('/')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
if not url or not key:
    local_log('preflight_credentials_missing',error_message='Missing Supabase credentials')
    raise SystemExit('Missing Supabase credentials')

def get_rows(path, timeout=25):
    req=urllib.request.Request(f'{url}{path}',headers={
        'apikey':key,'Authorization':f'Bearer {key}','Accept':'application/json','Prefer':'count=exact'})
    with urllib.request.urlopen(req,timeout=timeout) as res:
        rows=json.loads(res.read().decode('utf-8'))
        cr=res.headers.get('Content-Range','')
        total=None
        if '/' in cr:
            tail=cr.rsplit('/',1)[1]
            if tail.isdigit(): total=int(tail)
        return rows,total

def retry_get(path,label):
    last=None
    for attempt in range(1,5):
        try:
            rows,total=get_rows(path)
            return rows,total,attempt
        except Exception as e:
            last=e
            if attempt==4: raise
            delay=attempt*5
            print(f'{label} failed (attempt {attempt}/4): {e}; retrying in {delay}s',file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f'{label} failed: {last}')

started=datetime.now(timezone.utc)
now=started.isoformat()
try:
    active_query=urllib.parse.urlencode({
        'select':'id,listing_id,next_observation_at,priority',
        'active':'eq.true','limit':'1'})
    _,active_count,active_attempts=retry_get(f'/rest/v1/listings?{active_query}','Active-listing count query')

    due_query=urllib.parse.urlencode({
        'select':'id,listing_id,next_observation_at,priority',
        'active':'eq.true','next_observation_at':f'lte.{now}',
        'order':'priority.desc,next_observation_at.asc','limit':'100'})
    rows,due_count,due_attempts=retry_get(f'/rest/v1/listings?{due_query}','Due query')
    due_count=due_count if due_count is not None else len(rows)
    relist_query=urllib.parse.urlencode({'select':'id,listing_id,next_observation_at,priority','lifecycle_state':'eq.relist_watch','next_observation_at':f'lte.{now}','order':'next_observation_at.asc','limit':'100'})
    relist_rows,relist_count,relist_attempts=retry_get(f'/rest/v1/listings?{relist_query}','Relist-watch due query')
    relist_count=relist_count if relist_count is not None else len(relist_rows)
    seen={r.get('id') for r in rows}; rows=rows+[r for r in relist_rows if r.get('id') not in seen]; due_count+=relist_count
    due=due_count>0
    candidate=rows[0] if rows else None
    candidate_ids=[str(r.get('listing_id')) for r in rows[:50] if r.get('listing_id')]
    oldest=min((r.get('next_observation_at') for r in rows if r.get('next_observation_at')),default=None)
    overdue_seconds=None
    if oldest:
        try:
            oldest_dt=datetime.fromisoformat(str(oldest).replace('Z','+00:00'))
            overdue_seconds=max(0,int((started-oldest_dt).total_seconds()))
        except Exception: pass

    print(f'Active listings: {active_count}')
    print(f'Due listings: {due_count} (active + {relist_count} relist-watch)')
    print(f'Due listing exists: {due}')
    if candidate: print(f"Next due candidate: {candidate.get('listing_id')} due={candidate.get('next_observation_at')}")

    # Durable preflight state. Telemetry failure is deliberately non-fatal to collection.
    try:
        upsert('preflight_ok','running' if due else 'no_due',
            active_listing_count=active_count,due_count=due_count,
            selected_count=min(due_count,int(os.environ.get('MAX_LISTINGS_PER_RUN','12'))),
            oldest_due_at=oldest,oldest_overdue_seconds=overdue_seconds,
            candidate_listing_ids=candidate_ids,
            preflight_attempts=max(active_attempts,due_attempts,relist_attempts),
            diagnostics={'query_time_utc':now,'candidate_rows_captured':len(rows),'relist_watch_due':relist_count})
        if not due:
            finish('no_due','no_due',active_listing_count=active_count,due_count=0,
                   selected_count=0,candidate_listing_ids=[],preflight_attempts=max(active_attempts,due_attempts,relist_attempts))
    except Exception as telemetry_error:
        print(f'WARNING: scheduler telemetry unavailable: {telemetry_error}',file=sys.stderr)

    out=os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out,'a',encoding='utf-8') as f:
            f.write(f"due={'true' if due else 'false'}\n")
            f.write(f'due_count={due_count}\n')
except Exception as e:
    try: finish('failed','preflight_failed',error_type=e.__class__.__name__,error_message=str(e)[:1500])
    except Exception: pass
    raise
