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
now=datetime.now(timezone.utc).isoformat()
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
print(f"Due listing exists: {due}")
if rows:
    row=rows[0]
    print(f"Next due candidate: {row.get('listing_id')} due={row.get('next_observation_at')}")
out=os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out,"a",encoding="utf-8") as f:f.write(f"due={'true' if due else 'false'}\n")
