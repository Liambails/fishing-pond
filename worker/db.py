from datetime import datetime, timezone, timedelta
from supabase import create_client
import os, random

def client():
    url=os.environ['SUPABASE_URL']; key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
    return create_client(url,key)

def due_listings(limit:int=3):
    now=datetime.now(timezone.utc).isoformat()
    return client().table('listings').select('*').eq('active',True).lte('next_observation_at',now).order('priority',desc=True).order('next_observation_at').limit(limit).execute().data or []

def next_time(interval_hours:int):
    # Spread sampling within a window for workload distribution and time-of-day coverage.
    base=max(1,int(interval_hours or 24)); spread=min(6,max(1,base//4))
    hours=base + random.uniform(-spread,spread)
    return (datetime.now(timezone.utc)+timedelta(hours=max(1,hours))).isoformat()

def save_success(listing:dict, raw:dict):
    db=client(); lid=listing['id']; captured=raw.get('captured_at') or datetime.now(timezone.utc).isoformat()
    q=raw.get('extraction_quality') or {}
    obs={
      'listing_uuid':lid,'captured_at':captured,'collector_version':raw.get('collector_version'),'listing_mode':raw.get('listing_mode'),
      'buy_now_nzd':raw.get('buy_now_nzd'),'asking_price_nzd':raw.get('asking_price_nzd'),'starting_price_nzd':raw.get('starting_price_nzd'),'current_bid_nzd':raw.get('current_bid_nzd'),
      'views':raw.get('views'),'watchers':raw.get('watchers'),'bids':raw.get('bids'),'close_date':raw.get('close_date'),'close_remaining':raw.get('close_remaining'),
      'condition':raw.get('condition'),'location':raw.get('location'),'seller':raw.get('seller'),'seller_feedback_pct':raw.get('seller_feedback_pct'),'seller_feedback_count':raw.get('seller_feedback_count'),
      'seller_in_trade':raw.get('seller_in_trade'),'seller_address_verified':raw.get('seller_address_verified'),'seller_member_since':raw.get('seller_member_since'),
      'shipping_options':raw.get('shipping_options'),'pickup_available':raw.get('pickup_available'),'part_number':raw.get('part_number'),'part_number_candidates':raw.get('part_number_candidates'),
      'vehicle':raw.get('vehicle'),'chassis':raw.get('chassis') or raw.get('chassis_code_label'),'years':raw.get('years') or raw.get('vehicle_year_label'),'engine_code':raw.get('engine_code') or raw.get('engine_code_label'),'part_type':raw.get('part_type'),
      'extraction_score':q.get('score',raw.get('extraction_score')),'quality_flags':q.get('warnings',raw.get('quality_flags') or []),'raw_snapshot':raw
    }
    db.table('observations').upsert(obs,on_conflict='listing_uuid,captured_at').execute()
    db.table('listings').update({'last_seen':captured,'last_observed_at':captured,'next_observation_at':next_time(listing.get('observation_interval_hours',24)),'consecutive_failures':0,'last_error':None,'title':raw.get('listing_title') or listing.get('title'),'seller':raw.get('seller') or listing.get('seller')}).eq('id',lid).execute()

def save_failure(listing:dict, error:str):
    db=client(); failures=int(listing.get('consecutive_failures') or 0)+1
    # Back off after failures. Never attempt challenge/captcha bypass.
    delay=min(24*7, max(6, 6*(2**min(failures-1,4))))
    db.table('listings').update({'consecutive_failures':failures,'last_error':error[:1000],'next_observation_at':(datetime.now(timezone.utc)+timedelta(hours=delay)).isoformat()}).eq('id',listing['id']).execute()
