from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from supabase import create_client
import os, re


def client():
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])


def due_listings(limit: int = 3):
    now = datetime.now(timezone.utc).isoformat()
    return (
        client().table('listings').select('*')
        .eq('active', True)
        .lte('next_observation_at', now)
        .order('priority', desc=True)
        .order('next_observation_at')
        .limit(limit)
        .execute().data or []
    )


def normalize_close_date(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace('Z', '+00:00')).isoformat()
    except Exception:
        pass
    s = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', str(v), flags=re.I)
    for fmt in ('%a %d %b, %I:%M%p', '%d %b, %I:%M%p'):
        try:
            d = datetime.strptime(s, fmt).replace(
                year=datetime.now(ZoneInfo('Pacific/Auckland')).year,
                tzinfo=ZoneInfo('Pacific/Auckland')
            )
            return d.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return None


def _number(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _activity_snapshot(observations):
    rows = sorted(
        [o for o in observations if o.get('captured_at')],
        key=lambda o: o['captured_at']
    )
    if not rows:
        return {
            'observation_count': 0, 'span_hours': 0, 'views_per_day': None,
            'view_delta': None, 'bid_delta': None, 'watcher_delta': None
        }
    first, last = rows[0], rows[-1]
    try:
        span_h = max(0, (datetime.fromisoformat(last['captured_at'].replace('Z', '+00:00')) -
                         datetime.fromisoformat(first['captured_at'].replace('Z', '+00:00'))).total_seconds() / 3600)
    except Exception:
        span_h = 0
    fv, lv = _number(first.get('views')), _number(last.get('views'))
    fb, lb = _number(first.get('bids')), _number(last.get('bids'))
    fw, lw = _number(first.get('watchers')), _number(last.get('watchers'))
    raw_view_delta = (lv - fv) if fv is not None and lv is not None else None
    view_counter_anomaly = raw_view_delta is not None and raw_view_delta < 0
    view_delta = None if view_counter_anomaly else raw_view_delta
    bid_delta = (lb - fb) if fb is not None and lb is not None else None
    watcher_delta = (lw - fw) if fw is not None and lw is not None else None
    views_per_day = (view_delta / span_h * 24) if view_delta is not None and span_h >= 1 else None
    return {
        'observation_count': len(rows),
        'span_hours': round(span_h, 2),
        'views_per_day': round(views_per_day, 2) if views_per_day is not None else None,
        'view_delta': int(view_delta) if view_delta is not None else None,
        'bid_delta': int(bid_delta) if bid_delta is not None else None,
        'watcher_delta': int(watcher_delta) if watcher_delta is not None else None,
        'latest_views': last.get('views'),
        'latest_bids': last.get('bids'),
        'latest_watchers': last.get('watchers'),
        'view_counter_anomaly': view_counter_anomaly,
    }


def adaptive_cadence_hours(listing, observations):
    """Evidence-driven cadence only. No anti-detection/stealth behavior."""
    a = _activity_snapshot(observations)
    own = str((listing.get('metadata') or {}).get('ownership') or '').lower() == 'own'
    n = a['observation_count']

    # Initial learning ladder:
    # capture #1 -> +6h -> #2 -> +6h -> #3 -> +12h -> #4.
    # Shorter early intervals establish velocity before mature adaptive scheduling.
    if n <= 1:
        return 6, 'learning phase · second observation', a
    if n == 2:
        return 6, 'learning phase · confirm early velocity', a
    if n == 3:
        return 12, 'learning phase · establish first-day persistence', a

    # Mature adaptive cadence. Raw total views are not a demand threshold.
    v = a.get('views_per_day') or 0
    b = a.get('bid_delta') or 0
    w = a.get('watcher_delta') or 0
    if v >= 12 or b >= 2:
        return 6, 'high sustained view/bid activity', a
    if v >= 6 or b >= 1 or w >= 2:
        return 8, 'strong sustained activity', a
    if v >= 2 or w >= 1 or own:
        return 12, 'own listing tracking' if own else 'active listing', a
    return 24, 'low recent activity', a

def final_verdict(observations, closure_reason=None):
    a = _activity_snapshot(observations)
    reason = (closure_reason or '').lower()
    if 'withdraw' in reason or 'remove' in reason:
        verdict = 'WITHDRAWN_REMOVED'
    elif a['observation_count'] < 2 or a['span_hours'] < 6:
        verdict = 'INSUFFICIENT_EVIDENCE'
    else:
        vpd = a.get('views_per_day') or 0
        bd = a.get('bid_delta') or 0
        wd = a.get('watcher_delta') or 0
        if vpd >= 8 or bd >= 2:
            verdict = 'STRONG_EVIDENCE'
        elif vpd >= 3 or bd >= 1 or wd >= 2:
            verdict = 'MODERATE_EVIDENCE'
        else:
            verdict = 'WEAK_EVIDENCE'
    vpd = max(0, a.get('views_per_day') or 0)
    score = min(100, round(20 + min(55, vpd * 5) + min(15, max(0, a.get('bid_delta') or 0) * 8) + min(10, max(0, a.get('watcher_delta') or 0) * 3)))
    return verdict, score, a


def _recent_observations(db, listing_uuid, limit=12):
    return (
        db.table('observations')
        .select('captured_at,views,watchers,bids,buy_now_nzd,asking_price_nzd,current_bid_nzd,close_date')
        .eq('listing_uuid', listing_uuid)
        .order('captured_at', desc=True)
        .limit(limit)
        .execute().data or []
    )


def save_success(listing, raw):
    db = client()
    lid = listing['id']
    captured = raw.get('captured_at') or datetime.now(timezone.utc).isoformat()
    q = raw.get('extraction_quality') or {}
    obs = {
        'listing_uuid': lid, 'captured_at': captured, 'collector_version': raw.get('collector_version'),
        'listing_mode': raw.get('listing_mode'), 'buy_now_nzd': raw.get('buy_now_nzd'),
        'asking_price_nzd': raw.get('asking_price_nzd'), 'starting_price_nzd': raw.get('starting_price_nzd'),
        'current_bid_nzd': raw.get('current_bid_nzd'), 'views': raw.get('views'), 'watchers': raw.get('watchers'),
        'bids': raw.get('bids'), 'close_date': normalize_close_date(raw.get('close_date')),
        'close_remaining': raw.get('close_remaining'), 'condition': raw.get('condition'), 'location': raw.get('location'),
        'seller': raw.get('seller'), 'seller_feedback_pct': raw.get('seller_feedback_pct'),
        'seller_feedback_count': raw.get('seller_feedback_count'), 'seller_in_trade': raw.get('seller_in_trade'),
        'seller_address_verified': raw.get('seller_address_verified'), 'seller_member_since': raw.get('seller_member_since'),
        'shipping_options': raw.get('shipping_options'), 'pickup_available': raw.get('pickup_available'),
        'part_number': raw.get('part_number'), 'part_number_candidates': raw.get('part_number_candidates'),
        'vehicle': raw.get('vehicle'), 'chassis': raw.get('chassis') or raw.get('chassis_code_label'),
        'years': raw.get('years') or raw.get('vehicle_year_label'),
        'engine_code': raw.get('engine_code') or raw.get('engine_code_label'), 'part_type': raw.get('part_type'),
        'extraction_score': q.get('score', raw.get('extraction_score')),
        'quality_flags': q.get('warnings', raw.get('quality_flags') or []), 'raw_snapshot': raw
    }
    db.table('observations').upsert(obs, on_conflict='listing_uuid,captured_at').execute()
    history = _recent_observations(db, lid)
    ended = bool(raw.get('listing_ended'))
    patch = {
        'last_seen': captured, 'last_observed_at': captured, 'consecutive_failures': 0, 'last_error': None,
        'title': raw.get('listing_title') or listing.get('title'), 'seller': raw.get('seller') or listing.get('seller'),
        'last_success_source': 'worker'
    }
    if ended:
        reason = raw.get('listing_end_reason') or 'ended'
        verdict, score, evidence = final_verdict(history, reason)
        patch.update({
            'active': False, 'next_observation_at': None, 'observation_interval_hours': listing.get('observation_interval_hours', 24),
            'finalized_at': captured, 'final_verdict': verdict, 'final_score': score,
            'final_evidence': evidence, 'closure_reason': reason, 'cadence_reason': 'listing finalized'
        })
    else:
        hours, reason, evidence = adaptive_cadence_hours(listing, history)
        own = str((listing.get('metadata') or {}).get('ownership') or '').lower() == 'own'
        priority = 95 if own else (88 if hours <= 6 else 80 if hours <= 8 else 68 if hours <= 12 else 50)
        patch.update({
            'active': True, 'observation_interval_hours': hours, 'priority': priority,
            'next_observation_at': (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(),
            'cadence_reason': reason, 'finalized_at': None, 'final_verdict': None, 'final_score': None,
            'final_evidence': {}, 'closure_reason': None
        })
    db.table('listings').update(patch).eq('id', lid).execute()
    try:
        db.table('collection_errors').update({
            'status': 'resolved', 'resolved_at': captured, 'recovered_at': captured,
            'recovery_source': 'worker', 'resolution_note': 'Recovered by a later successful COBALT collection.'
        }).eq('listing_uuid', lid).eq('status', 'open').execute()
    except Exception:
        # Recovery metadata is additive; never turn a successful observation into a failed run.
        pass


def save_failure(listing, error):
    db = client()
    failures = int(listing.get('consecutive_failures') or 0) + 1
    # A failed listing never blocks the run; run.py immediately continues to the next due listing.
    # Known marketplace challenge pages are not retried automatically; they need a normal-browser/manual recovery.
    # Ordinary/transient failures get up to three consecutive attempts before automatic scheduling pauses.
    error_type = str(getattr(error, 'error_type', '') or '').lower()
    challenge = error_type in {'captcha','access_denied','human_verification','unusual_traffic'}
    if challenge:
        patch = {
            'consecutive_failures': failures,
            'last_error': str(error)[:1000],
            'next_observation_at': None,
            'cadence_reason': f'manual recovery required ({error_type})'
        }
    elif failures >= 3:
        patch = {
            'consecutive_failures': failures,
            'last_error': str(error)[:1000],
            'next_observation_at': None,
            'cadence_reason': 'manual recovery required after 3 consecutive failures'
        }
    else:
        delay = 6 if failures == 1 else 12
        patch = {
            'consecutive_failures': failures,
            'last_error': str(error)[:1000],
            'next_observation_at': (datetime.now(timezone.utc) + timedelta(hours=delay)).isoformat(),
            'cadence_reason': f'automatic retry {failures + 1}/3 in {delay}h'
        }
    db.table('listings').update(patch).eq('id', listing['id']).execute()
    return failures


def log_collection_error(listing, error, run_id=None, failures=None):
    db = client()
    now = datetime.now(timezone.utc).isoformat()
    listing_uuid = listing.get('id')
    row = {
        'collection_run_id': run_id, 'listing_uuid': listing_uuid, 'listing_id': listing.get('listing_id'),
        'requested_url': getattr(error, 'requested_url', None) or listing.get('url'),
        'final_url': getattr(error, 'final_url', None),
        'error_type': getattr(error, 'error_type', None) or error.__class__.__name__,
        'error_message': str(error)[:2000], 'collector_stage': getattr(error, 'stage', None),
        'page_title': getattr(error, 'page_title', None), 'http_status': getattr(error, 'http_status', None),
        'diagnostics': getattr(error, 'diagnostics', {}) or {},
        'occurred_at': now
    }
    # Keep only one open dashboard problem per canonical listing. New failures replace/update
    # the latest open issue rather than piling duplicate rows into Issues.
    existing = (db.table('collection_errors').select('id').eq('listing_uuid', listing_uuid).eq('status', 'open')
                .order('occurred_at', desc=True).limit(1).execute().data or [])
    if existing:
        db.table('collection_errors').update(row).eq('id', existing[0]['id']).execute()
        # Resolve any older duplicate open rows left from earlier versions.
        older = (db.table('collection_errors').select('id').eq('listing_uuid', listing_uuid).eq('status', 'open')
                 .neq('id', existing[0]['id']).execute().data or [])
        for item in older:
            db.table('collection_errors').update({'status':'resolved','resolved_at':now,'resolution_note':'Superseded by newer consolidated COBALT issue.'}).eq('id', item['id']).execute()
    else:
        db.table('collection_errors').insert(row).execute()
