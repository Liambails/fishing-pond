from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from supabase import create_client
import os, re


def client():
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])


def due_listings(limit: int = 3):
    now = datetime.now(timezone.utc).isoformat(); db=client()
    active=(db.table('listings').select('*').eq('active',True).lte('next_observation_at',now).order('priority',desc=True).order('next_observation_at').limit(limit).execute().data or [])
    # Closed listings are checked sparsely for a relist. They stay inactive so they never inflate live competitor counts.
    watch=(db.table('listings').select('*').eq('lifecycle_state','relist_watch').lte('next_observation_at',now).order('next_observation_at').limit(limit).execute().data or [])
    merged={x['id']:x for x in active+watch}
    return sorted(merged.values(),key=lambda x:(0 if x.get('active') else 1,-int(x.get('priority') or 0),x.get('next_observation_at') or ''))[:limit]


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


def _recent_observations(db, listing_uuid, limit=12, episode=None):
    q=(db.table('observations').select('captured_at,views,watchers,bids,buy_now_nzd,asking_price_nzd,current_bid_nzd,close_date,lifecycle_episode').eq('listing_uuid',listing_uuid))
    if episode is not None: q=q.eq('lifecycle_episode',episode)
    return q.order('captured_at',desc=True).limit(limit).execute().data or []


def save_success(listing, raw):
    db = client()
    # Persist provenance with every automatic observation so dashboard diagnostics
    # can distinguish GitHub-worker captures from manual Chrome-extension captures.
    raw = dict(raw or {})
    raw['capture_source'] = 'worker-auto'
    lid = listing['id']
    captured = raw.get('captured_at') or datetime.now(timezone.utc).isoformat()
    q = raw.get('extraction_quality') or {}
    reopened = listing.get('lifecycle_state') == 'relist_watch' and not bool(raw.get('listing_ended'))
    episode = int(listing.get('lifecycle_episode') or 1) + (1 if reopened else 0)
    obs = {
        'listing_uuid': lid, 'captured_at': captured, 'lifecycle_episode': episode, 'collector_version': raw.get('collector_version'),
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
    history = _recent_observations(db, lid, episode=episode)
    ended = bool(raw.get('listing_ended'))
    patch = {
        'last_seen': captured, 'last_observed_at': captured, 'consecutive_failures': 0, 'last_error': None,
        'title': raw.get('listing_title') or listing.get('title'), 'seller': raw.get('seller') or listing.get('seller'),
        'last_success_source': 'worker'
    }
    if ended:
        reason = raw.get('listing_end_reason') or 'ended'
        verdict, score, evidence = final_verdict(history, reason)
        checks=int(listing.get('relist_check_count') or 0)
        # First close -> 6h, then 24h, then 72h. After the third still-closed check, retire the URL.
        delays=[6,24,72]; terminal=listing.get('lifecycle_state')=='relist_watch' and checks>=3
        next_check=None if terminal else (datetime.now(timezone.utc)+timedelta(hours=delays[min(checks,len(delays)-1)])).isoformat()
        patch.update({
            'active': False, 'lifecycle_state': 'terminal_closed' if terminal else 'relist_watch',
            'next_observation_at': next_check, 'relist_check_count': checks+1 if listing.get('lifecycle_state')=='relist_watch' else 0,
            'relist_watch_until': (datetime.now(timezone.utc)+timedelta(days=7)).isoformat() if listing.get('lifecycle_state')!='relist_watch' else listing.get('relist_watch_until'),
            'observation_interval_hours': listing.get('observation_interval_hours',24), 'finalized_at': captured, 'final_verdict': verdict, 'final_score': score,
            'final_evidence': evidence, 'closure_reason': reason, 'cadence_reason': 'listing closed permanently after relist watch' if terminal else f'closed · relist watch next check {next_check}'
        })
        try:
            db.table('listing_lifecycle_events').insert({'listing_uuid':lid,'listing_family_id':listing.get('listing_family_id') or lid,'marketplace':listing.get('marketplace') or 'Trade Me','marketplace_listing_id':listing.get('listing_id'),'episode':episode,'event_type':'terminal_closed' if terminal else ('relist_check_still_closed' if listing.get('lifecycle_state')=='relist_watch' else 'closed_relist_watch'),'occurred_at':captured,'reason':{'closure_reason':reason,'check_count':checks,'next_check':next_check}}).execute()
        except Exception as e: print(f'WARNING: lifecycle event write failed: {e}')
    else:
        hours, reason, evidence = adaptive_cadence_hours(listing, history)
        own = str((listing.get('metadata') or {}).get('ownership') or '').lower() == 'own'
        priority = 95 if own else (88 if hours <= 6 else 80 if hours <= 8 else 68 if hours <= 12 else 50)
        patch.update({
            'active': True, 'lifecycle_state': 'active', 'lifecycle_episode': episode, 'relist_check_count': 0, 'relist_watch_until': None, 'last_relisted_at': captured if reopened else listing.get('last_relisted_at'), 'observation_interval_hours': hours, 'priority': priority,
            'next_observation_at': (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(),
            'cadence_reason': reason, 'finalized_at': None, 'final_verdict': None, 'final_score': None,
            'final_evidence': {}, 'closure_reason': None
        })
        if reopened:
            patch['cadence_reason']='relisted · same marketplace ID'
            try: db.table('listing_lifecycle_events').insert({'listing_uuid':lid,'listing_family_id':listing.get('listing_family_id') or lid,'marketplace':listing.get('marketplace') or 'Trade Me','marketplace_listing_id':listing.get('listing_id'),'episode':episode,'event_type':'relisted_same_id','occurred_at':captured,'confidence':1,'reason':{'detected':'closed URL became active again'}}).execute()
            except Exception as e: print(f'WARNING: relist lifecycle event write failed: {e}')
    db.table('listings').update(patch).eq('id', lid).execute()
    try:
        db.table('collection_errors').update({
            'status': 'resolved', 'resolved_at': captured, 'recovered_at': captured,
            'recovery_source': 'worker', 'resolution_note': 'Recovered by a later successful COBALT collection.'
        }).eq('listing_uuid', lid).eq('status', 'open').execute()
    except Exception:
        # Recovery metadata is additive; never turn a successful observation into a failed run.
        pass



def register_explicit_relist(parent, relist):
    """Idempotently register a marketplace-explicit new-ID successor.

    Returns (successor_listing, created_now). Existing successors are never reactivated here;
    that preserves CAPTCHA/manual-recovery pauses and the successor's own scheduler state.
    """
    db=client(); now=datetime.now(timezone.utc).isoformat()
    new_id=str((relist or {}).get('listing_id') or '').strip()
    new_url=str((relist or {}).get('url') or '').strip()
    if not new_id or not new_url or new_id == str(parent.get('listing_id') or ''):
        return None, False
    existing=(db.table('listings').select('*').eq('marketplace',parent.get('marketplace') or 'Trade Me').eq('listing_id',new_id).limit(1).execute().data or [])
    family=parent.get('listing_family_id') or parent['id']
    episode=int(parent.get('lifecycle_episode') or 1)+1
    created=False
    if existing:
        child=existing[0]
        # Fill relationship fields only when absent. Never overwrite a different established
        # lineage or scheduling/failure state merely because the old page is revisited.
        patch={}
        if not child.get('relisted_from'): patch['relisted_from']=parent['id']
        if not child.get('listing_family_id'): patch['listing_family_id']=family
        if int(child.get('lifecycle_episode') or 1) < episode: patch['lifecycle_episode']=episode
        if patch:
            db.table('listings').update(patch).eq('id',child['id']).execute()
            child={**child,**patch}
    else:
        metadata=dict(parent.get('metadata') or {})
        metadata.update({'discovery_source':'marketplace_explicit_relist_link','explicit_relist_from':str(parent.get('listing_id') or '')})
        row={
            'product_id':parent.get('product_id'),'marketplace':parent.get('marketplace') or 'Trade Me',
            'listing_id':new_id,'url':new_url,'source_url':new_url,'title':None,'seller':parent.get('seller'),
            'active':True,'first_seen':now,'next_observation_at':now,'observation_interval_hours':6,
            'priority':max(90,int(parent.get('priority') or 50)),'consecutive_failures':0,'metadata':metadata,
            'listing_family_id':family,'relisted_from':parent['id'],'lifecycle_state':'active','lifecycle_episode':episode,
            'relist_check_count':0,'relist_watch_until':None,'last_relisted_at':now,'cadence_reason':'discovered via explicit marketplace relist link'
        }
        child=db.table('listings').insert(row).execute().data[0]; created=True
    # The old URL has done its job. Stop sparse relist polling once the marketplace itself has
    # supplied a concrete successor. The child owns future observations/recovery from here.
    db.table('listings').update({
        'active':False,'lifecycle_state':'terminal_closed','next_observation_at':None,
        'cadence_reason':f'explicit relist successor discovered · {new_id}'
    }).eq('id',parent['id']).execute()
    # Lifecycle insert is idempotent at application level: don't duplicate the same edge.
    prior=(db.table('listing_lifecycle_events').select('id').eq('listing_uuid',child['id']).eq('previous_listing_uuid',parent['id']).eq('event_type','relisted_explicit_link').limit(1).execute().data or [])
    if not prior:
        db.table('listing_lifecycle_events').insert({
            'listing_uuid':child['id'],'listing_family_id':family,'marketplace':parent.get('marketplace') or 'Trade Me',
            'marketplace_listing_id':new_id,'episode':episode,'event_type':'relisted_explicit_link',
            'previous_listing_uuid':parent['id'],'occurred_at':now,'confidence':1,
            'reason':{'detected':'marketplace explicit relist link','source_listing_id':parent.get('listing_id'),'anchor_text':(relist or {}).get('anchor_text'),'url':new_url}
        }).execute()
    return child, created

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
