from datetime import datetime, timezone, timedelta
from cadence import adaptive_cadence_hours

def obs(hours, views):
    base=datetime(2026,9,1,tzinfo=timezone.utc)
    return {"captured_at":(base+timedelta(hours=hours)).isoformat(),"views":views,"bids":0,"watchers":0,"question_count":0,"purchase_intent_questions":0}
def cadence(rows): return adaptive_cadence_hours({"metadata":{}},rows)[0]
assert cadence([obs(0,10),obs(3,14)])==3
assert cadence([obs(0,10),obs(3,14),obs(6,18)])==3
assert cadence([obs(0,10),obs(3,12),obs(6,14)])==6
assert cadence([obs(0,10),obs(3,10),obs(6,10)])==24
assert cadence([obs(0,10),obs(1,14),obs(2,18)])!=3
print("adaptive cadence regression tests passed")
