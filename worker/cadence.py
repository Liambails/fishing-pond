from datetime import datetime, timezone


def _number(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _dt(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def _observer_events(events):
    return [e for e in (events or []) if e.get("occurred_at")
            and str(e.get("operation") or "") == "listing_detail"
            and str(e.get("status") or "") == "success"
            and str(e.get("source") or "").lower() == "playwright"
            and (e.get("diagnostics") or {}).get("observer_view_candidate") is True]


def _observer_visits_between(events, start, end):
    a,b=_dt(start),_dt(end)
    if not a or not b or b<=a:
        return 0
    n=0
    for e in _observer_events(events):
        t=_dt(e.get("occurred_at"))
        if t and a<t<=b:
            n+=1
    return n


def _corrected_view_gain(prev, row, events):
    a,b=_number(prev.get("views")),_number(row.get("views"))
    if a is None or b is None:
        return None, None, 0
    raw=b-a
    if raw<0:
        return None, raw, 0
    observer=_observer_visits_between(events, prev.get("captured_at"), row.get("captured_at"))
    corrected=max(0, raw-min(raw,observer))
    return corrected, raw, observer


def activity_snapshot(observations, acquisition_events=None):
    rows=sorted([o for o in observations if o.get("captured_at")], key=lambda o:o["captured_at"])
    if not rows:
        return {"observation_count":0,"span_hours":0,"views_per_day":None,"view_delta":None,"raw_view_delta":None,"possible_observer_views":0,"bid_delta":None,"watcher_delta":None,"question_delta":None,"purchase_question_delta":None,"independent_count":0,"independent_intervals":[],"recent_view_gains":[]}
    first,last=rows[0],rows[-1]
    fdt,ldt=_dt(first["captured_at"]),_dt(last["captured_at"])
    span_h=max(0,(ldt-fdt).total_seconds()/3600) if fdt and ldt else 0
    fv,lv=_number(first.get("views")),_number(last.get("views")); fb,lb=_number(first.get("bids")),_number(last.get("bids")); fw,lw=_number(first.get("watchers")),_number(last.get("watchers")); fq,lq=_number(first.get("question_count")),_number(last.get("question_count")); fpq,lpq=_number(first.get("purchase_intent_questions")),_number(last.get("purchase_intent_questions"))
    raw_view_delta=(lv-fv) if fv is not None and lv is not None else None
    view_counter_anomaly=raw_view_delta is not None and raw_view_delta<0
    possible_observer_views=_observer_visits_between(acquisition_events, first.get("captured_at"), last.get("captured_at")) if not view_counter_anomaly else 0
    view_delta=None if view_counter_anomaly or raw_view_delta is None else max(0,raw_view_delta-min(raw_view_delta,possible_observer_views))
    bid_delta=(lb-fb) if fb is not None and lb is not None else None; watcher_delta=(lw-fw) if fw is not None and lw is not None else None; question_delta=(lq-fq) if fq is not None and lq is not None else None; purchase_question_delta=(lpq-fpq) if fpq is not None and lpq is not None else None
    views_per_day=(view_delta/span_h*24) if view_delta is not None and span_h>=1 else None
    independent=[]
    for row in rows:
        if _number(row.get("views")) is None: continue
        if not independent: independent.append(row); continue
        prev=_dt(independent[-1]["captured_at"]); cur=_dt(row["captured_at"])
        gap=(cur-prev).total_seconds()/3600 if prev and cur else 0
        if gap>=3: independent.append(row)
        else: independent[-1]=row
    intervals=[]
    for prev,row in zip(independent,independent[1:]):
        a,b=_dt(prev["captured_at"]),_dt(row["captured_at"]); hours=max(0,(b-a).total_seconds()/3600) if a and b else 0
        gain,raw_gain,observer=_corrected_view_gain(prev,row,acquisition_events)
        if gain is None: continue
        intervals.append({"hours":round(hours,2),"gain":int(gain),"raw_gain":int(raw_gain),"possible_observer_views":observer})
    return {"observation_count":len(rows),"span_hours":round(span_h,2),"views_per_day":round(views_per_day,2) if views_per_day is not None else None,"view_delta":int(view_delta) if view_delta is not None else None,"raw_view_delta":int(raw_view_delta) if raw_view_delta is not None else None,"possible_observer_views":possible_observer_views,"bid_delta":int(bid_delta) if bid_delta is not None else None,"watcher_delta":int(watcher_delta) if watcher_delta is not None else None,"question_delta":int(question_delta) if question_delta is not None else None,"purchase_question_delta":int(purchase_question_delta) if purchase_question_delta is not None else None,"latest_views":last.get("views"),"latest_bids":last.get("bids"),"latest_watchers":last.get("watchers"),"view_counter_anomaly":view_counter_anomaly,"independent_count":len(independent),"independent_intervals":intervals,"recent_view_gains":[x["gain"] for x in intervals[-2:]]}


def adaptive_cadence_hours(listing, observations, acquisition_events=None):
    a=activity_snapshot(observations, acquisition_events); own=str((listing.get("metadata") or {}).get("ownership") or "").lower()=="own"; gains=a.get("recent_view_gains") or []; last=gains[-1] if gains else 0; prior=gains[-2] if len(gains)>=2 else 0; two=len(gains)>=2; bids=max(0,int(a.get("bid_delta") or 0)); watchers=max(0,int(a.get("watcher_delta") or 0)); independent=int(a.get("independent_count") or 0); count=int(a.get("observation_count") or 0)
    # Every newly tracked listing gets a fast second snapshot. It is deliberately not treated as
    # an independent 3h demand window; it captures bid/watch/price movement and catches short auctions.
    if count<=1: return 0.5,"learning burst · first follow-up in 30 minutes",a
    if independent<=1: return 3,"learning · establish the first reliable 3h window",a
    if independent==2: return (2,"heating up · strong gain in the latest reliable window",a) if last>=4 else (6,"learning · confirm the early pattern",a)
    if (two and last>=3 and prior>=3) or (last>=5 and bids>=1) or bids>=2: return 2,"hot · repeated strong gains across reliable checks",a
    if (two and last+prior>=4 and last>=1 and prior>=1) or last>=3 or bids>=1 or watchers>=2: return 4,"warm · sustained marketplace attention",a
    if last>=1 or own: return 8,("normal · own listing tracking" if own else "normal · some recent movement"),a
    if two and last==0 and prior==0: return 18,"cold · no new views across two reliable checks",a
    return 12,"normal · waiting for a clearer pattern",a


def close_aware_interval_hours(base_hours, close_at, now=None):
    """Cap cadence as an auction approaches expiry. Returns (hours, reason_suffix).

    This is a scheduling cap, not extra demand evidence. Every new listing still gets its
    30-minute first follow-up from adaptive_cadence_hours(); after that, <=3h-to-close
    listings may relax to at most 60 minutes when activity is weak. A 30-minute snapshot
    remains non-independent until the normal >=3h evidence spacing is met.
    """
    close=_dt(close_at); now=now or datetime.now(timezone.utc)
    if not close or close<=now:
        return base_hours,""
    left=(close-now).total_seconds()/3600
    cap=None
    if left<=3: cap=1
    elif left<=6: cap=1
    elif left<=12: cap=2
    elif left<=24: cap=4
    if cap is not None and base_hours>cap:
        return cap,f"closing soon · {left:.1f}h left"
    return base_hours,""
