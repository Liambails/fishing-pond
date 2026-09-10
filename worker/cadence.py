from datetime import datetime

def _number(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None

def activity_snapshot(observations, acquisition_events=None):
    rows=sorted([o for o in observations if o.get("captured_at")], key=lambda o:o["captured_at"])
    if not rows:
        return {"observation_count":0,"span_hours":0,"views_per_day":None,"view_delta":None,"bid_delta":None,"watcher_delta":None,"question_delta":None,"purchase_question_delta":None,"independent_count":0,"independent_intervals":[],"recent_view_gains":[]}
    first,last=rows[0],rows[-1]
    span_h=max(0,(datetime.fromisoformat(last["captured_at"].replace("Z","+00:00"))-datetime.fromisoformat(first["captured_at"].replace("Z","+00:00"))).total_seconds()/3600)
    fv,lv=_number(first.get("views")),_number(last.get("views")); fb,lb=_number(first.get("bids")),_number(last.get("bids")); fw,lw=_number(first.get("watchers")),_number(last.get("watchers")); fq,lq=_number(first.get("question_count")),_number(last.get("question_count")); fpq,lpq=_number(first.get("purchase_intent_questions")),_number(last.get("purchase_intent_questions"))
    raw_view_delta=(lv-fv) if fv is not None and lv is not None else None
    view_counter_anomaly=raw_view_delta is not None and raw_view_delta<0

    def _dt(v):
        if not v:
            return None
        try:
            return datetime.fromisoformat(str(v).replace("Z","+00:00"))
        except Exception:
            return None

    events=[]
    for event in list(acquisition_events or []):
        if str(event.get("operation") or "")!="listing_detail": continue
        if str(event.get("status") or "")!="success": continue
        if str(event.get("source") or "").lower()!="playwright": continue
        when=_dt(event.get("occurred_at"))
        if when is not None: events.append(when)

    def cobalt_visits_between(start_at,end_at):
        start=_dt(start_at); end=_dt(end_at)
        if not start or not end or end<start: return 0
        return sum(1 for when in events if start < when <= end)

    total_cobalt_views=cobalt_visits_between(first["captured_at"],last["captured_at"])

    if view_counter_anomaly or raw_view_delta is None:
        view_delta=None
    else:
        raw_nonnegative=max(0,int(raw_view_delta))
        view_delta=max(0,raw_nonnegative-min(raw_nonnegative,total_cobalt_views))
    bid_delta=(lb-fb) if fb is not None and lb is not None else None; watcher_delta=(lw-fw) if fw is not None and lw is not None else None; question_delta=(lq-fq) if fq is not None and lq is not None else None; purchase_question_delta=(lpq-fpq) if fpq is not None and lpq is not None else None
    views_per_day=(view_delta/span_h*24) if view_delta is not None and span_h>=1 else None
    independent=[]
    for row in rows:
        if _number(row.get("views")) is None: continue
        if not independent: independent.append(row); continue
        gap=(datetime.fromisoformat(row["captured_at"].replace("Z","+00:00"))-datetime.fromisoformat(independent[-1]["captured_at"].replace("Z","+00:00"))).total_seconds()/3600
        if gap>=3: independent.append(row)
        else: independent[-1]=row
    intervals=[]
    for prev,row in zip(independent,independent[1:]):
        hours=max(0,(datetime.fromisoformat(row["captured_at"].replace("Z","+00:00"))-datetime.fromisoformat(prev["captured_at"].replace("Z","+00:00"))).total_seconds()/3600)
        raw_gain=max(0,int((_number(row.get("views")) or 0)-(_number(prev.get("views")) or 0)))
        possible_cobalt_views=cobalt_visits_between(prev["captured_at"],row["captured_at"])
        gain=max(0,raw_gain-min(raw_gain,possible_cobalt_views))
        intervals.append({
            "hours":round(hours,2),
            "raw_gain":raw_gain,
            "possible_cobalt_views":possible_cobalt_views,
            "gain":gain
        })
    return {"observation_count":len(rows),"span_hours":round(span_h,2),"views_per_day":round(views_per_day,2) if views_per_day is not None else None,"view_delta":int(view_delta) if view_delta is not None else None,"raw_view_delta":int(raw_view_delta) if raw_view_delta is not None else None,"possible_cobalt_views":total_cobalt_views,"bid_delta":int(bid_delta) if bid_delta is not None else None,"watcher_delta":int(watcher_delta) if watcher_delta is not None else None,"question_delta":int(question_delta) if question_delta is not None else None,"purchase_question_delta":int(purchase_question_delta) if purchase_question_delta is not None else None,"latest_views":last.get("views"),"latest_bids":last.get("bids"),"latest_watchers":last.get("watchers"),"view_counter_anomaly":view_counter_anomaly,"independent_count":len(independent),"independent_intervals":intervals,"recent_view_gains":[x["gain"] for x in intervals[-2:]]}

def adaptive_cadence_hours(listing, observations, acquisition_events=None):
    a=activity_snapshot(observations, acquisition_events); own=str((listing.get("metadata") or {}).get("ownership") or "").lower()=="own"; gains=a.get("recent_view_gains") or []; last=gains[-1] if gains else 0; prior=gains[-2] if len(gains)>=2 else 0; two=len(gains)>=2; bids=max(0,int(a.get("bid_delta") or 0)); watchers=max(0,int(a.get("watcher_delta") or 0)); independent=int(a.get("independent_count") or 0)
    if independent<=1: return 6,"learning · establish a second reliable check",a
    if independent==2: return (3,"heating up · strong gain in the latest reliable window",a) if last>=4 else (6,"learning · confirm the early pattern",a)
    if (two and last>=3 and prior>=3) or (last>=5 and bids>=1) or bids>=2: return 3,"hot · repeated strong gains across reliable checks",a
    if (two and last+prior>=4 and last>=1 and prior>=1) or last>=3 or bids>=1 or watchers>=2: return 6,"warm · sustained marketplace attention",a
    if last>=1 or own: return 12,("normal · own listing tracking" if own else "normal · some recent movement"),a
    if two and last==0 and prior==0: return 24,"cold · no new views across two reliable checks",a
    return 12,"normal · waiting for a clearer pattern",a
