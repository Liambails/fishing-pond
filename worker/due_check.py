import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

url=os.environ.get("SUPABASE_URL", "").rstrip("/")
key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not url or not key:
    print("Missing Supabase credentials", file=sys.stderr)
    sys.exit(1)

def request_json(method, path, body=None):
    data=None if body is None else json.dumps(body).encode("utf-8")
    req=urllib.request.Request(
        f"{url}{path}",
        data=data,
        method=method,
        headers={
            "apikey":key,
            "Authorization":f"Bearer {key}",
            "Accept":"application/json",
            "Content-Type":"application/json",
            "Prefer":"return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw=res.read()
        return json.loads(raw.decode("utf-8")) if raw else None

started=datetime.now(timezone.utc)
now=started.isoformat()
query=urllib.parse.urlencode({
    "select":"id,listing_id,next_observation_at",
    "active":"eq.true",
    "next_observation_at":f"lte.{now}",
    "order":"priority.desc,next_observation_at.asc",
    "limit":"1",
})
req=urllib.request.Request(
    f"{url}/rest/v1/listings?{query}",
    headers={"apikey":key,"Authorization":f"Bearer {key}","Accept":"application/json"},
)
with urllib.request.urlopen(req, timeout=20) as res:
    rows=json.loads(res.read().decode("utf-8"))

due=bool(rows)
candidate=rows[0] if rows else None
print(f"Due listing exists: {due}")
if candidate:
    print(f"Next due candidate: {candidate.get('listing_id')} due={candidate.get('next_observation_at')}")

# Telemetry: this row is written on every GitHub scheduler wake-up, even when
# the browser worker is skipped. This makes cron health visible in Supabase.
event_name=os.environ.get("GITHUB_EVENT_NAME","unknown")
source=f"scheduler-check/{event_name}"
finished=datetime.now(timezone.utc)
details=[{
    "event":"due-check",
    "due":due,
    "candidate_listing_id":candidate.get("listing_id") if candidate else None,
    "candidate_due_at":candidate.get("next_observation_at") if candidate else None,
    "github_run_id":os.environ.get("GITHUB_RUN_ID"),
    "github_run_attempt":os.environ.get("GITHUB_RUN_ATTEMPT"),
}]
try:
    request_json("POST","/rest/v1/collection_runs",{
        "started_at":started.isoformat(),
        "finished_at":finished.isoformat(),
        "source":source,
        "listings_attempted":0,
        "listings_succeeded":0,
        "listings_failed":0,
        "details":details,
    })
except Exception as e:
    # Telemetry failure must not prevent the actual due worker from running.
    print(f"WARNING: could not log scheduler check: {e}", file=sys.stderr)

out=os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out,"a",encoding="utf-8") as f:
        f.write(f"due={'true' if due else 'false'}\n")
