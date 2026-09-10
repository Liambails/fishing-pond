from cadence import activity_snapshot

def obs(at, views):
    return {
        "captured_at": at,
        "views": views,
        "bids": 0,
        "watchers": 0,
        "question_count": 0,
        "purchase_intent_questions": 0,
    }

def event(at):
    return {
        "occurred_at": at,
        "operation": "listing_detail",
        "source": "playwright",
        "status": "success",
    }

def test_one_visit_removes_one_possible_self_view():
    rows=[
        obs("2026-09-10T00:00:00+00:00",40),
        obs("2026-09-10T06:00:00+00:00",41),
    ]
    a=activity_snapshot(rows,[event("2026-09-10T06:00:00+00:00")])
    assert a["raw_view_delta"]==1
    assert a["possible_cobalt_views"]==1
    assert a["view_delta"]==0
    assert a["independent_intervals"][0]["gain"]==0

def test_large_gain_keeps_external_lower_bound():
    rows=[
        obs("2026-09-10T00:00:00+00:00",40),
        obs("2026-09-10T06:00:00+00:00",49),
    ]
    a=activity_snapshot(rows,[event("2026-09-10T06:00:00+00:00")])
    assert a["raw_view_delta"]==9
    assert a["view_delta"]==8
    assert a["independent_intervals"][0]["raw_gain"]==9
    assert a["independent_intervals"][0]["possible_cobalt_views"]==1
    assert a["independent_intervals"][0]["gain"]==8

def test_no_events_preserves_old_behavior():
    rows=[
        obs("2026-09-10T00:00:00+00:00",10),
        obs("2026-09-10T06:00:00+00:00",14),
    ]
    a=activity_snapshot(rows)
    assert a["raw_view_delta"]==4
    assert a["view_delta"]==4

if __name__=="__main__":
    test_one_visit_removes_one_possible_self_view()
    test_large_gain_keeps_external_lower_bound()
    test_no_events_preserves_old_behavior()
    print("observer-view contamination regression tests passed")
