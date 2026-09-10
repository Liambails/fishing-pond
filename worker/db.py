from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from supabase import create_client
import os, re
from close_date import normalize_close_date, closure_timing_evidence
from cadence import activity_snapshot as _activity_snapshot, adaptive_cadence_hours


def client():
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])


def due_listings(limit: int = 3):
    """Return due live listings while reserving capacity for relist-watch probes.

    Without a reserved slice, a large live backlog can starve every closed-listing relist check.
    COBALT keeps roughly 20% of each worker run available for due relist watches, then fills any
    unused capacity with ordinary live observations.
    """
    now = datetime.now(timezone.utc).isoformat(); db=client(); limit=max(1,int(limit or 1))
    watch_quota=max(1,min(5,round(limit*.20))) if limit>=3 else 1
    watch=(db.table('listings').select('*').eq('lifecycle_state','relist_watch').lte('next_observation_at',now).order('next_observation_at').limit(watch_quota).execute().data or [])
    active_limit=max(0,limit-len(watch))
    active=(db.table('listings').select('*').eq('active',True).lte('next_observation_at',now).order('priority',desc=True).order('next_observation_at').limit(active_limit).execute().data or [])
    # If live work is sparse, use the remaining slots for additional due relist probes.
    remaining=limit-len(active)-len(watch)
    if remaining>0:
        extra=(db.table('listings').select('*').eq('lifecycle_state','relist_watch').lte('next_observation_at',now).order('next_observation_at').limit(watch_quota+remaining).execute().data or [])
        known={x['id'] for x in watch}
        watch.extend(x for x in extra if x['id'] not in known)
    return (active+watch)[:limit]


def _number(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def final_verdict(observations, closure_reason=None, acquisition_events=None):
    a = _activity_snapshot(observations, acquisition_events)
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
    q=(db.table('observations').select('captured_at,views,watchers,bids,question_count,purchase_intent_questions,buy_now_nzd,asking_price_nzd,current_bid_nzd,close_date,lifecycle_episode').eq('listing_uuid',listing_uuid))
    if episode is not None: q=q.eq('lifecycle_episode',episode)
    return q.order('captured_at',desc=True).limit(limit).execute().data or []


def _recent_acquisition_events(db, listing_uuid, limit=100):
    return (
        db.table('listing_acquisition_events')
        .select('occurred_at,operation,source,status')
        .eq('listing_uuid',listing_uuid)
        .eq('operation','listing_detail')
        .eq('status','success')
        .eq('source','playwright')
        .order('occurred_at',desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )

def _latest_capture_summary(raw):
    raw=dict(raw or {})
    keys=(
        'captured_at','collector_version','listing_title','description','listing_mode','buy_now_nzd','asking_price_nzd','starting_price_nzd','current_bid_nzd',
        'views','watchers','bids','close_date','close_remaining','listing_status','listing_ended','listing_end_reason','sold_detected',
        'condition','location','seller','seller_feedback_pct','seller_feedback_count','seller_in_trade','seller_address_verified','seller_member_since',
        'shipping_options','pickup_available','q_and_a','question_count','buy_now_available','offer_available','stock_quantity','category_path','breadcrumbs',
        'primary_image_url','marketplace_attributes','marketplace_attribute_map','extraction_quality','_sources'
    )
    return {k:raw.get(k) for k in keys if k in raw}

def _quarantine_unsafe_views(raw):
    raw = dict(raw or {})
    source = str((((raw.get('_sources') or {}).get('views') or {}).get('source') or ''))
    if raw.get('views') is not None and source.startswith('page-text:'):
        raw['_view_guard'] = {'quarantined': True, 'source': source, 'reason': 'whole-page view fallback is not trusted'}
        raw['views'] = None
        q = dict(raw.get('extraction_quality') or {})
        warnings = list(q.get('warnings') or [])
        if 'unsafe_view_source' not in warnings: warnings.append('unsafe_view_source')
        q['warnings'] = warnings
        raw['extraction_quality'] = q
    return raw


RELIST_CHECK_DELAYS_HOURS=(1,6,18,48,96)

def effective_ended(raw):
    if bool((raw or {}).get('listing_ended')) or str((raw or {}).get('listing_status') or '').lower() in {'sold','ended','removed','withdrawn'}:
        return True
    close=normalize_close_date((raw or {}).get('close_date'), (raw or {}).get('captured_at'))
    if not close:
        return False
    try:
        # A short grace avoids classifying a page as ended at the exact close-second while the
        # marketplace is still transitioning the UI.
        return datetime.fromisoformat(close.replace('Z','+00:00')) <= datetime.now(timezone.utc)-timedelta(minutes=2)
    except Exception:
        return False

def _next_relist_check(check_count):
    i=max(0,int(check_count or 0))
    if i>=len(RELIST_CHECK_DELAYS_HOURS):
        return None
    return (datetime.now(timezone.utc)+timedelta(hours=RELIST_CHECK_DELAYS_HOURS[i])).isoformat()

def _parse_iso(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except Exception:
        return None

def same_id_relist_evidence(listing, raw, prior_history):
    """Detect a new lifecycle episode even when COBALT never caught the brief closed page.

    Trade Me can make the same marketplace ID live again quickly. The strongest evidence is an
    elapsed previous close followed by a new future close on an active capture. Counter resets are
    supporting evidence, never the sole trigger.
    """
    raw=dict(raw or {}); prior_history=list(prior_history or [])
    if bool(raw.get('listing_ended')) or str(raw.get('listing_status') or '').lower() in {'ended','sold','removed','withdrawn'}:
        return False,{}
    now=datetime.now(timezone.utc)
    current_close=_parse_iso(normalize_close_date(raw.get('close_date'), raw.get('captured_at')))
    latest=prior_history[0] if prior_history else {}
    previous_close=_parse_iso(latest.get('close_date'))
    elapsed_previous=bool(previous_close and previous_close <= now-timedelta(minutes=2))
    future_current=bool(current_close and current_close >= now+timedelta(minutes=10))
    close_advanced=bool(previous_close and current_close and current_close > previous_close+timedelta(minutes=30))

    def reset(field, minimum_drop=1):
        before=_number(latest.get(field)); after=_number(raw.get(field))
        if before is None or after is None:return False
        return before-after>=minimum_drop and after <= max(2,before*.6)

    view_reset=reset('views',3)
    bid_reset=reset('bids',1)
    watcher_reset=reset('watchers',2)
    prior_state=str(listing.get('lifecycle_state') or 'active')
    state_reopened=prior_state in {'relist_watch','terminal_closed','relisted'}

    detected=(state_reopened and future_current) or (elapsed_previous and future_current and close_advanced) or (elapsed_previous and (future_current or state_reopened) and view_reset)
    evidence={
        'same_marketplace_id':True,'prior_state':prior_state,
        'previous_close_date':latest.get('close_date'),'current_close_date':normalize_close_date(raw.get('close_date'), raw.get('captured_at')),
        'previous_close_elapsed':elapsed_previous,'current_close_future':future_current,'close_date_advanced':close_advanced,
        'views_reset':view_reset,'bids_reset':bid_reset,'watchers_reset':watcher_reset,
        'previous_views':latest.get('views'),'current_views':raw.get('views')
    }
    return bool(detected),evidence


def save_success(listing, raw):
    db = client(); raw=_quarantine_unsafe_views(raw); raw=dict(raw or {}); raw['capture_source']='worker-auto'
    lid=listing['id']; captured=raw.get('captured_at') or datetime.now(timezone.utc).isoformat(); q=raw.get('extraction_quality') or {}
    prior_state=str(listing.get('lifecycle_state') or 'active'); ended=effective_ended(raw)
    current_episode=int(listing.get('lifecycle_episode') or 1)
    prior_history=_recent_observations(db,lid,episode=current_episode)
    relist_detected,relist_evidence=same_id_relist_evidence(listing,raw,prior_history) if not ended else (False,{})
    reopened=bool(relist_detected and not ended)
    episode=current_episode+(1 if reopened else 0)
    obs={
        'listing_uuid':lid,'captured_at':captured,'lifecycle_episode':episode,'collector_version':raw.get('collector_version'),'listing_mode':raw.get('listing_mode'),
        'buy_now_nzd':raw.get('buy_now_nzd'),'asking_price_nzd':raw.get('asking_price_nzd'),'starting_price_nzd':raw.get('starting_price_nzd'),'current_bid_nzd':raw.get('current_bid_nzd'),
        'views':raw.get('views'),'watchers':raw.get('watchers'),'bids':raw.get('bids'),'close_date':normalize_close_date(raw.get('close_date'), captured),'close_remaining':raw.get('close_remaining'),
        'question_count':raw.get('question_count'),'purchase_intent_questions':raw.get('purchase_intent_questions'),'compatibility_questions':raw.get('compatibility_questions'),'condition_questions':raw.get('condition_questions'),'q_and_a':raw.get('q_and_a'),'qa_identity_codes':raw.get('qa_identity_codes'),
        'buy_now_available':raw.get('buy_now_available'),'offer_available':raw.get('offer_available'),'stock_quantity':raw.get('stock_quantity'),'listing_status':raw.get('listing_status'),'sold_detected':raw.get('sold_detected'),
        'condition':raw.get('condition'),'location':raw.get('location'),'seller':raw.get('seller'),'seller_feedback_pct':raw.get('seller_feedback_pct'),'seller_feedback_count':raw.get('seller_feedback_count'),'seller_in_trade':raw.get('seller_in_trade'),'seller_address_verified':raw.get('seller_address_verified'),'seller_member_since':raw.get('seller_member_since'),
        'shipping_options':raw.get('shipping_options'),'pickup_available':raw.get('pickup_available'),'part_number':raw.get('part_number'),'part_number_candidates':raw.get('part_number_candidates'),'vehicle':raw.get('vehicle'),'chassis':raw.get('chassis') or raw.get('chassis_code_label'),'years':raw.get('years') or raw.get('vehicle_year_label'),'engine_code':raw.get('engine_code') or raw.get('engine_code_label'),'part_type':raw.get('part_type'),
        'description':raw.get('description'),'category_path':raw.get('category_path'),'primary_image_url':raw.get('primary_image_url'),'marketplace_attributes':raw.get('marketplace_attributes') or [],
        'extraction_score':q.get('score',raw.get('extraction_score')),'quality_flags':q.get('warnings',raw.get('quality_flags') or []),'raw_snapshot':raw
    }
    # Repeated relist-watch probes of an already-ended page are lifecycle checks, not fresh market
    # evidence. Do not append frozen post-close observations that would distort the final episode.
    persist_observation=not (ended and prior_state in {'relist_watch','terminal_closed','relisted'})
    if persist_observation:
        db.table('observations').upsert(obs,on_conflict='listing_uuid,captured_at').execute()
    history=_recent_observations(db,lid,episode=episode)
    acquisition_events=_recent_acquisition_events(db,lid)
    metadata=dict(listing.get('metadata') or {}); metadata['latest_capture']=_latest_capture_summary(raw)
    patch={'last_seen':captured,'last_observed_at':captured,'consecutive_failures':0,'last_error':None,'title':raw.get('listing_title') or listing.get('title'),'seller':raw.get('seller') or listing.get('seller'),'metadata':metadata,'last_success_source':'worker','last_relist_checked_at':captured if prior_state in {'relist_watch','terminal_closed'} else listing.get('last_relist_checked_at')}
    if ended:
        reason=raw.get('listing_end_reason') or ('expired' if normalize_close_date(raw.get('close_date'), captured) else 'ended')
        verdict,score,evidence=final_verdict(history,reason,acquisition_events)
        timing=closure_timing_evidence(history,captured,bool(raw.get('sold_detected')))
        evidence={**evidence,'closure_timing':timing}
        if timing.get('sold_early'):
            verdict='STRONG_EVIDENCE'
            score=min(100,max(score,78)+12)
        if prior_state=='relist_watch':
            checks=int(listing.get('relist_check_count') or 0)+1
        else:
            checks=0
        next_check=_next_relist_check(checks)
        watch_until=listing.get('relist_watch_until') or (datetime.now(timezone.utc)+timedelta(days=10)).isoformat()
        if watch_until and datetime.fromisoformat(str(watch_until).replace('Z','+00:00')) <= datetime.now(timezone.utc):
            next_check=None
        terminal=next_check is None
        patch.update({'active':False,'lifecycle_state':'terminal_closed' if terminal else 'relist_watch','next_observation_at':next_check,'relist_check_count':checks,'relist_watch_until':watch_until,'observation_interval_hours':listing.get('observation_interval_hours',24),'finalized_at':listing.get('finalized_at') or captured,'final_verdict':verdict,'final_score':score,'final_evidence':evidence,'closure_reason':reason,'cadence_reason':'ended · relist watch complete' if terminal else f'ended · relist check {checks+1}/{len(RELIST_CHECK_DELAYS_HOURS)} scheduled'})
        try:
            db.table('listing_lifecycle_events').insert({'listing_uuid':lid,'listing_family_id':listing.get('listing_family_id') or lid,'marketplace':listing.get('marketplace') or 'Trade Me','marketplace_listing_id':listing.get('listing_id'),'episode':episode,'event_type':'terminal_closed' if terminal else ('relist_check_still_closed' if prior_state=='relist_watch' else 'closed_relist_watch'),'occurred_at':captured,'reason':{'closure_reason':reason,'check_count':checks,'next_check':next_check,'effective_end_from_close_date':not bool(raw.get('listing_ended')),'closure_timing':timing}}).execute()
        except Exception as e: print(f'WARNING: lifecycle event write failed: {e}')
    else:
        hours,reason,evidence=adaptive_cadence_hours(listing,history,acquisition_events); own=str((listing.get('metadata') or {}).get('ownership') or '').lower()=='own'; priority=95 if own else (92 if hours<=3 else 88 if hours<=6 else 68 if hours<=12 else 50)
        next_dt=datetime.now(timezone.utc)+timedelta(hours=hours)
        close_iso=normalize_close_date(raw.get('close_date'), captured)
        if close_iso:
            try:
                closure_probe=datetime.fromisoformat(close_iso.replace('Z','+00:00'))+timedelta(minutes=10)
                if closure_probe>datetime.now(timezone.utc) and closure_probe<next_dt:
                    next_dt=closure_probe; reason=f'{reason} · closure check shortly after expiry'
            except Exception: pass
        patch.update({'active':True,'lifecycle_state':'active','lifecycle_episode':episode,'relist_check_count':0,'relist_watch_until':None,'last_relisted_at':captured if reopened else listing.get('last_relisted_at'),'relist_match_confidence':1 if reopened else listing.get('relist_match_confidence'),'relist_detection_method':'same_marketplace_id_reopened' if reopened else listing.get('relist_detection_method'),'observation_interval_hours':hours,'priority':priority,'next_observation_at':next_dt.isoformat(),'cadence_reason':'relisted · same marketplace ID · new episode' if reopened else reason,'finalized_at':None,'final_verdict':None,'final_score':None,'final_evidence':{},'closure_reason':None})
        if reopened:
            try: db.table('listing_lifecycle_events').insert({'listing_uuid':lid,'listing_family_id':listing.get('listing_family_id') or lid,'marketplace':listing.get('marketplace') or 'Trade Me','marketplace_listing_id':listing.get('listing_id'),'episode':episode,'event_type':'relisted_same_id','occurred_at':captured,'confidence':1,'reason':{'detected':'same marketplace ID began a new live lifecycle episode','counter_reset_is_new_episode':True,**relist_evidence}}).execute()
            except Exception as e: print(f'WARNING: relist lifecycle event write failed: {e}')
    db.table('listings').update(patch).eq('id',lid).execute()
    try: db.table('collection_errors').update({'status':'resolved','resolved_at':captured,'recovered_at':captured,'recovery_source':'worker','resolution_note':'Recovered by a later successful COBALT collection.'}).eq('listing_uuid',lid).eq('status','open').execute()
    except Exception: pass
    return {'episode':episode,'ended':ended,'reopened':reopened,'observation_saved':persist_observation}

def register_relist_successor(parent, candidate, detection_method='semantic_match', confidence=0.9, reasons=None):
    """Idempotently link a new marketplace ID as the next lifecycle episode."""
    db=client(); now=datetime.now(timezone.utc).isoformat(); candidate=dict(candidate or {})
    new_id=str(candidate.get('listing_id') or '').strip(); new_url=str(candidate.get('url') or candidate.get('final_url') or '').strip()
    if not new_id or not new_url or new_id==str(parent.get('listing_id') or ''): return None,False
    existing=(db.table('listings').select('*').eq('marketplace',parent.get('marketplace') or 'Trade Me').eq('listing_id',new_id).limit(1).execute().data or [])
    family=parent.get('listing_family_id') or parent['id']; episode=int(parent.get('lifecycle_episode') or 1)+1; created=False
    common={'listing_family_id':family,'relisted_from':parent['id'],'lifecycle_episode':episode,'last_relisted_at':now,'relist_match_confidence':float(confidence),'relist_detection_method':detection_method}
    if existing:
        child=existing[0]; patch={k:v for k,v in common.items() if k not in {'relisted_from'} or not child.get('relisted_from')}
        if child.get('relisted_from') and child.get('relisted_from')!=parent['id']:
            return None,False
        db.table('listings').update(patch).eq('id',child['id']).execute(); child={**child,**patch}
    else:
        metadata=dict(parent.get('metadata') or {}); metadata.update({'discovery_source':detection_method,'relist_from':str(parent.get('listing_id') or '')})
        row={'product_id':parent.get('product_id'),'marketplace':parent.get('marketplace') or 'Trade Me','listing_id':new_id,'url':new_url,'source_url':new_url,'title':candidate.get('listing_title') or candidate.get('title'),'seller':candidate.get('seller') or parent.get('seller'),'active':True,'first_seen':now,'last_seen':now,'next_observation_at':now,'observation_interval_hours':3,'priority':max(92,int(parent.get('priority') or 50)),'consecutive_failures':0,'metadata':metadata,'lifecycle_state':'active','relist_check_count':0,'relist_watch_until':None,'cadence_reason':f'relist discovered · {detection_method}',**common}
        child=db.table('listings').insert(row).execute().data[0]; created=True
    # Finalize the old episode before moving lineage to the successor. Redirect-based relists can
    # be discovered before COBALT ever got a dedicated post-close capture, so do not leave the
    # parent looking historically 'active' or without a final evidence snapshot.
    parent_episode=int(parent.get('lifecycle_episode') or 1)
    parent_history=_recent_observations(db,parent['id'],limit=24,episode=parent_episode)
    verdict,final_score,evidence=final_verdict(parent_history,'relisted')
    latest_close=next((x.get('close_date') for x in parent_history if x.get('close_date')),None)
    finalized_at=parent.get('finalized_at') or latest_close or now
    db.table('listings').update({
        'active':False,'lifecycle_state':'relisted','next_observation_at':None,
        'relist_successor_uuid':child['id'],'last_relist_checked_at':now,
        'cadence_reason':f'relisted as marketplace listing {new_id}',
        'closure_reason':f'relisted to #{new_id}','finalized_at':finalized_at,
        'final_verdict':parent.get('final_verdict') or verdict,
        'final_score':parent.get('final_score') if parent.get('final_score') is not None else final_score,
        'final_evidence':{**(parent.get('final_evidence') or evidence or {}),'relist':{
            'detected':True,'successor_listing_id':new_id,'same_seller':bool((candidate.get('seller') or parent.get('seller')) and parent.get('seller') and str(candidate.get('seller') or parent.get('seller')).strip().lower()==str(parent.get('seller')).strip().lower()),
            'detection_method':detection_method,'detected_at':now,'confidence':float(confidence)
        }},
    }).eq('id',parent['id']).execute()
    prior=(db.table('listing_lifecycle_events').select('id').eq('listing_uuid',child['id']).eq('previous_listing_uuid',parent['id']).in_('event_type',['relisted_new_id','relisted_explicit_link','relisted_redirect']).limit(1).execute().data or [])
    if not prior:
        event_type='relisted_redirect' if detection_method=='marketplace_redirect' else ('relisted_explicit_link' if detection_method=='marketplace_explicit_link' else 'relisted_new_id')
        db.table('listing_lifecycle_events').insert({'listing_uuid':child['id'],'listing_family_id':family,'marketplace':parent.get('marketplace') or 'Trade Me','marketplace_listing_id':new_id,'episode':episode,'event_type':event_type,'previous_listing_uuid':parent['id'],'occurred_at':now,'confidence':float(confidence),'reason':{'detection_method':detection_method,'source_listing_id':parent.get('listing_id'),'reasons':reasons or [],'url':new_url,'counter_reset_is_new_episode':True}}).execute()
    return child,created


def register_explicit_relist(parent, relist):
    method='marketplace_explicit_link'
    return register_relist_successor(parent,relist,detection_method=method,confidence=1.0,reasons=['marketplace explicitly linked successor'])

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
