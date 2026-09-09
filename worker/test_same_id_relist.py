from datetime import datetime, timezone, timedelta
import sys, types
supabase=types.ModuleType("supabase")
supabase.create_client=lambda *a,**k: None
sys.modules.setdefault("supabase",supabase)
from db import same_id_relist_evidence

now=datetime.now(timezone.utc)
listing={"lifecycle_state":"active","lifecycle_episode":1}
prior=[{"captured_at":(now-timedelta(hours=2)).isoformat(),"close_date":(now-timedelta(hours=1)).isoformat(),"views":44,"watchers":6,"bids":2}]
raw={"listing_ended":False,"listing_status":"active","close_date":(now+timedelta(days=7)).isoformat(),"views":3,"watchers":0,"bids":0}
detected,evidence=same_id_relist_evidence(listing,raw,prior)
assert detected, evidence
assert evidence["previous_close_elapsed"] and evidence["current_close_future"] and evidence["close_date_advanced"]
assert evidence["views_reset"]

# A counter wobble before the advertised close is not enough to create a new episode.
prior_live=[{"captured_at":now.isoformat(),"close_date":(now+timedelta(hours=3)).isoformat(),"views":44,"watchers":6,"bids":2}]
raw_live={"listing_ended":False,"listing_status":"active","close_date":(now+timedelta(hours=4)).isoformat(),"views":3,"watchers":0,"bids":0}
detected2,evidence2=same_id_relist_evidence(listing,raw_live,prior_live)
assert not detected2, evidence2
print("same-ID relist lifecycle regression tests passed")
