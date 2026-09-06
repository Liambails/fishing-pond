"""Dependency-free scheduler telemetry for COBALT GitHub Actions.

This module intentionally uses only the Python standard library so it can
record bootstrap failures before pip dependencies are installed.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL=os.environ.get('SUPABASE_URL','').rstrip('/')
KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
RUN_ID=os.environ.get('GITHUB_RUN_ID') or 'local'
RUN_ATTEMPT=int(os.environ.get('GITHUB_RUN_ATTEMPT') or 1)
LOG_PATH=Path(os.environ.get('COBALT_SCHEDULER_LOG','scheduler_debug.jsonl'))
VERSION=os.environ.get('COBALT_VERSION','3.9.11')


def now(): return datetime.now(timezone.utc).isoformat()

def local_log(event, **payload):
    row={'at':now(),'event':event,'github_run_id':RUN_ID,'github_run_attempt':RUN_ATTEMPT,**payload}
    try:
        with LOG_PATH.open('a',encoding='utf-8') as f:f.write(json.dumps(row,default=str)+'\n')
    except Exception: pass
    print('[scheduler]', json.dumps(row,default=str))
    return row

def request(method,path,body=None,prefer='return=representation'):
    if not URL or not KEY: raise RuntimeError('Missing Supabase credentials')
    data=None if body is None else json.dumps(body).encode('utf-8')
    req=urllib.request.Request(f'{URL}{path}',data=data,method=method,headers={
        'apikey':KEY,'Authorization':f'Bearer {KEY}','Accept':'application/json',
        'Content-Type':'application/json','Prefer':prefer})
    with urllib.request.urlopen(req,timeout=20) as res:
        raw=res.read()
        return json.loads(raw.decode('utf-8')) if raw else None

def base_row():
    return {
        'github_run_id':RUN_ID,'github_run_attempt':RUN_ATTEMPT,
        'github_event_name':os.environ.get('GITHUB_EVENT_NAME'),
        'github_sha':os.environ.get('GITHUB_SHA'),'github_ref':os.environ.get('GITHUB_REF'),
        'workflow_name':os.environ.get('GITHUB_WORKFLOW'),'runner_os':os.environ.get('RUNNER_OS'),
        'cobalt_version':VERSION,
    }

def get_row():
    q=urllib.parse.urlencode({'select':'id','github_run_id':f'eq.{RUN_ID}','github_run_attempt':f'eq.{RUN_ATTEMPT}','limit':'1'})
    rows=request('GET',f'/rest/v1/scheduler_runs?{q}') or []
    return rows[0] if rows else None

def upsert(stage,status='running',fatal=False,**patch):
    event=local_log(stage,status=status,**patch)
    if not URL or not KEY:
        if fatal: raise RuntimeError('Missing Supabase credentials')
        return None
    row=get_row()
    payload={**base_row(),'stage':stage,'status':status,**patch}
    if stage=='started' and not row: payload['started_at']=event['at']
    try:
        if row:
            request('PATCH',f"/rest/v1/scheduler_runs?id=eq.{row['id']}",payload,prefer='return=minimal')
            return row['id']
        created=request('POST','/rest/v1/scheduler_runs',payload) or []
        return created[0]['id'] if created else None
    except Exception as e:
        local_log('telemetry_write_failed',error_type=e.__class__.__name__,error_message=str(e)[:1000],attempted_stage=stage)
        if fatal: raise
        return None

def _system_event(status,stage,patch):
    try:
        if status=='failed':
            q=urllib.parse.urlencode({'select':'id','source':'eq.github-actions/scheduler','event_type':'eq.scheduler_failure','status':'eq.open','order':'occurred_at.desc','limit':'1'})
            rows=request('GET',f'/rest/v1/system_events?{q}') or []
            event={'occurred_at':now(),'severity':'critical','source':'github-actions/scheduler','event_type':'scheduler_failure','message':f"Scheduler failed at {stage}: {patch.get('error_message') or patch.get('error_type') or 'unknown error'}"[:2000],'context':{**base_row(),'stage':stage,**patch},'status':'open','resolved_at':None,'resolution_note':None}
            if rows: request('PATCH',f"/rest/v1/system_events?id=eq.{rows[0]['id']}",event,prefer='return=minimal')
            else: request('POST','/rest/v1/system_events',event,prefer='return=minimal')
        elif status in {'success','no_due','partial'}:
            q=urllib.parse.urlencode({'select':'id','source':'eq.github-actions/scheduler','event_type':'eq.scheduler_failure','status':'eq.open'})
            rows=request('GET',f'/rest/v1/system_events?{q}') or []
            for row in rows:
                request('PATCH',f"/rest/v1/system_events?id=eq.{row['id']}",{'status':'resolved','resolved_at':now(),'resolution_note':f'Automatically resolved by later scheduler status: {status}.'},prefer='return=minimal')
    except Exception as e:
        local_log('system_event_write_failed',error_type=e.__class__.__name__,error_message=str(e)[:1000])

def finish(status,stage='finished',**patch):
    upsert(stage,status=status,finished_at=now(),**patch)
    _system_event(status,stage,patch)

def cli():
    action=sys.argv[1] if len(sys.argv)>1 else 'start'
    message=' '.join(sys.argv[2:])[:1500] or None
    if action=='start': upsert('started','running',fatal=False)
    elif action=='dependencies_ok': upsert('dependencies_ok','running',dependency_attempts=int(os.environ.get('DEPENDENCY_ATTEMPTS') or 1))
    elif action=='bootstrap_failed': finish('failed','bootstrap_failed',error_type='bootstrap',error_message=message)
    elif action=='preflight_failed': finish('failed','preflight_failed',error_type='preflight',error_message=message,preflight_attempts=int(os.environ.get('PREFLIGHT_ATTEMPTS') or 1))
    elif action=='chromium_failed': finish('failed','chromium_failed',error_type='chromium_install',error_message=message)
    elif action=='worker_failed': finish('failed','worker_failed',error_type='worker',error_message=message)
    else: upsert(action,'running',diagnostics={'message':message} if message else {})

if __name__=='__main__': cli()
