from datetime import datetime, timezone, timedelta
from cadence import adaptive_cadence_hours, close_aware_interval_hours

def obs(hours, views, bids=0, watchers=0):
    base=datetime(2026,9,1,tzinfo=timezone.utc)
    return {"captured_at":(base+timedelta(hours=hours)).isoformat(),"views":views,"bids":bids,"watchers":watchers,"question_count":0,"purchase_intent_questions":0}
def cadence(rows): return adaptive_cadence_hours({"metadata":{}},rows)[0]
assert cadence([obs(0,10)])==0.5
assert cadence([obs(0,10),obs(.5,10)])==3
assert cadence([obs(0,10),obs(3,14)])==2
assert cadence([obs(0,10),obs(3,14),obs(6,18)])==2
assert cadence([obs(0,10),obs(3,12),obs(6,14)])==4
assert cadence([obs(0,10),obs(3,10),obs(6,10)])==18
assert cadence([obs(0,10),obs(1,14),obs(2,18)])!=2
now=datetime(2026,9,10,0,0,tzinfo=timezone.utc)
assert close_aware_interval_hours(12,(now+timedelta(hours=2)).isoformat(),now)[0]==1
# The universal first follow-up remains 30m even inside the <=3h closing window.
assert close_aware_interval_hours(0.5,(now+timedelta(hours=2)).isoformat(),now)[0]==0.5
assert close_aware_interval_hours(12,(now+timedelta(hours=5)).isoformat(),now)[0]==1
assert close_aware_interval_hours(12,(now+timedelta(hours=10)).isoformat(),now)[0]==2
assert close_aware_interval_hours(12,(now+timedelta(hours=20)).isoformat(),now)[0]==4
assert close_aware_interval_hours(12,(now+timedelta(hours=30)).isoformat(),now)[0]==12
print("adaptive + close-aware cadence regression tests passed")
