from datetime import datetime, timezone, timedelta
from supabase import create_client
from zoneinfo import ZoneInfo
import os
import random
import re


def client():
    url = os.environ['SUPABASE_URL']
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    return create_client(url, key)


def due_listings(limit: int = 3):
    now = datetime.now(timezone.utc).isoformat()

    return (
        client()
        .table('listings')
        .select('*')
        .eq('active', True)
        .lte('next_observation_at', now)
        .order('priority', desc=True)
        .order('next_observation_at')
        .limit(limit)
        .execute()
        .data
        or []
    )


def next_time(interval_hours: int):
    base = max(1, int(interval_hours or 24))
    spread = min(6, max(1, base // 4))

    hours = base + random.uniform(-spread, spread)

    return (
        datetime.now(timezone.utc)
        + timedelta(hours=max(1, hours))
    ).isoformat()

def normalize_close_date(value):
    if not value:
        return None

    value = str(value).strip()

    # Already ISO-like: leave it alone.
    if 'T' in value:
        try:
            datetime.fromisoformat(
                value.replace('Z', '+00:00')
            )
            return value
        except ValueError:
            pass

    # Example:
    # Sat 12th Sep, 11:32am
    match = re.search(
        r'(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*'
        r'(\d{1,2})(?:st|nd|rd|th)?\s+'
        r'([A-Za-z]{3,9}),?\s+'
        r'(\d{1,2}):(\d{2})\s*(am|pm)',
        value,
        re.IGNORECASE
    )

    if not match:
        return None

    day = int(match.group(1))
    month_name = match.group(2)
    hour = int(match.group(3))
    minute = int(match.group(4))
    am_pm = match.group(5).lower()

    if am_pm == 'pm' and hour != 12:
        hour += 12
    elif am_pm == 'am' and hour == 12:
        hour = 0

    try:
        month = datetime.strptime(
            month_name[:3],
            '%b'
        ).month
    except ValueError:
        return None

    nz = ZoneInfo('Pacific/Auckland')
    now_nz = datetime.now(nz)

    try:
        candidate = datetime(
            now_nz.year,
            month,
            day,
            hour,
            minute,
            tzinfo=nz
        )
    except ValueError:
        return None

    # If the inferred date is far in the past,
    # it probably refers to next year.
    if candidate < now_nz - timedelta(days=30):
        try:
            candidate = candidate.replace(
                year=now_nz.year + 1
            )
        except ValueError:
            return None

    return candidate.isoformat()

def save_success(listing: dict, raw: dict):
    db = client()
    lid = listing['id']

    captured = (
        raw.get('captured_at')
        or datetime.now(timezone.utc).isoformat()
    )

    q = raw.get('extraction_quality') or {}

    obs = {
        'listing_uuid': lid,
        'captured_at': captured,
        'collector_version': raw.get('collector_version'),
        'listing_mode': raw.get('listing_mode'),

        'buy_now_nzd': raw.get('buy_now_nzd'),
        'asking_price_nzd': raw.get('asking_price_nzd'),
        'starting_price_nzd': raw.get('starting_price_nzd'),
        'current_bid_nzd': raw.get('current_bid_nzd'),

        'views': raw.get('views'),
        'watchers': raw.get('watchers'),
        'bids': raw.get('bids'),

        'close_date': normalize_close_date(
            raw.get('close_date')
        ),
        'close_remaining': raw.get('close_remaining'),

        'condition': raw.get('condition'),
        'location': raw.get('location'),

        'seller': raw.get('seller'),
        'seller_feedback_pct': raw.get('seller_feedback_pct'),
        'seller_feedback_count': raw.get('seller_feedback_count'),

        'seller_in_trade': raw.get('seller_in_trade'),
        'seller_address_verified': raw.get('seller_address_verified'),
        'seller_member_since': raw.get('seller_member_since'),

        'shipping_options': raw.get('shipping_options'),
        'pickup_available': raw.get('pickup_available'),

        'part_number': raw.get('part_number'),
        'part_number_candidates': raw.get('part_number_candidates'),

        'vehicle': raw.get('vehicle'),

        'chassis': (
            raw.get('chassis')
            or raw.get('chassis_code_label')
        ),

        'years': (
            raw.get('years')
            or raw.get('vehicle_year_label')
        ),

        'engine_code': (
            raw.get('engine_code')
            or raw.get('engine_code_label')
        ),

        'part_type': raw.get('part_type'),

        'extraction_score': q.get(
            'score',
            raw.get('extraction_score')
        ),

        'quality_flags': q.get(
            'warnings',
            raw.get('quality_flags') or []
        ),

        'raw_snapshot': raw
    }

    db.table('observations').upsert(
        obs,
        on_conflict='listing_uuid,captured_at'
    ).execute()

    db.table('listings').update({
        'last_seen': captured,
        'last_observed_at': captured,
        'next_observation_at': next_time(
            listing.get('observation_interval_hours', 24)
        ),
        'consecutive_failures': 0,
        'last_error': None,
        'title': raw.get('listing_title') or listing.get('title'),
        'seller': raw.get('seller') or listing.get('seller')
    }).eq('id', lid).execute()


def save_failure(listing: dict, error: str):
    db = client()

    failures = int(
        listing.get('consecutive_failures') or 0
    ) + 1

    delay = min(
        24 * 7,
        max(
            6,
            6 * (2 ** min(failures - 1, 4))
        )
    )

    db.table('listings').update({
        'consecutive_failures': failures,
        'last_error': error[:1000],
        'next_observation_at': (
            datetime.now(timezone.utc)
            + timedelta(hours=delay)
        ).isoformat()
    }).eq('id', listing['id']).execute()


def log_collection_error(listing: dict, error, run_id=None):
    db = client()

    payload = {
        'collection_run_id': run_id,
        'listing_uuid': listing.get('id'),
        'listing_id': listing.get('listing_id'),
        'requested_url': (
            getattr(error, 'requested_url', None)
            or listing.get('url')
        ),
        'final_url': getattr(error, 'final_url', None),
        'error_type': getattr(
            error,
            'error_type',
            type(error).__name__
        ),
        'error_message': str(error)[:4000],
        'collector_stage': getattr(error, 'stage', None),
        'page_title': getattr(error, 'page_title', None),
        'http_status': getattr(error, 'http_status', None),
        'diagnostics': (
            getattr(error, 'diagnostics', {}) or {}
        )
    }

    db.table('collection_errors').insert(
        payload
    ).execute()
