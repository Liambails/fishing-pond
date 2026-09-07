"""Cheap idempotency guard for AWS -> GitHub workflow_dispatch.

EventBridge/Lambda delivery is intentionally retryable, so the worker must tolerate duplicate
workflow_dispatch events. This runs before pip/Chromium and skips a dispatch when another
workflow_dispatch heartbeat started less than eight minutes ago. The real EventBridge cadence
is ten minutes, leaving a two-minute safety margin.
"""
import json, os, urllib.parse, urllib.request
from datetime import datetime, timezone

URL=os.environ.get('SUPABASE_URL','').rstrip('/')
KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
WINDOW_SECONDS=int(os.environ.get('COBALT_DISPATCH_DEDUPE_SECONDS','480'))

def output(name,value):
    path=os.environ.get('GITHUB_OUTPUT')
    if path:
        with open(path,'a',encoding='utf-8') as f:f.write(f'{name}={value}\n')

def main():
    if not URL or not KEY:
        print('Dispatch guard: credentials unavailable; fail open.')
        output('duplicate','false');return
    q=urllib.parse.urlencode({'select':'started_at,github_run_id,status,stage','github_event_name':'eq.workflow_dispatch','order':'started_at.desc','limit':'1'})
    req=urllib.request.Request(f'{URL}/rest/v1/scheduler_runs?{q}',headers={'apikey':KEY,'Authorization':f'Bearer {KEY}','Accept':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=15) as res: rows=json.loads(res.read().decode('utf-8') or '[]')
        if not rows:
            output('duplicate','false');print('Dispatch guard: no prior workflow_dispatch heartbeat.');return
        prior=rows[0];t=datetime.fromisoformat(str(prior['started_at']).replace('Z','+00:00'));age=(datetime.now(timezone.utc)-t).total_seconds()
        duplicate=0<=age<WINDOW_SECONDS
        output('duplicate','true' if duplicate else 'false')
        print(f"Dispatch guard: prior run {prior.get('github_run_id')} age={age:.0f}s duplicate={duplicate}")
    except Exception as e:
        print(f'Dispatch guard unavailable ({e}); fail open.')
        output('duplicate','false')

if __name__=='__main__': main()
