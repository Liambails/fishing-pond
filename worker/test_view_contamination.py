from datetime import datetime, timezone, timedelta
from cadence import activity_snapshot
base=datetime(2026,9,1,tzinfo=timezone.utc)
def o(h,v):return {"captured_at":(base+timedelta(hours=h)).isoformat(),"views":v,"bids":0,"watchers":0}
def e(h,flag=True):return {"occurred_at":(base+timedelta(hours=h)).isoformat(),"operation":"listing_detail","source":"playwright","status":"success","diagnostics":{"observer_view_candidate":flag}}
a=activity_snapshot([o(0,10),o(3,11)],[e(2)])
assert a["view_delta"]==0 and a["raw_view_delta"]==1
a=activity_snapshot([o(0,10),o(3,19)],[e(2)])
assert a["view_delta"]==8 and a["raw_view_delta"]==9
a=activity_snapshot([o(0,10),o(3,11)],[e(2,False)])
assert a["view_delta"]==1
print("observer-view contamination regression tests passed")
