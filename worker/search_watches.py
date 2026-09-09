from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urljoin, urlparse, parse_qsl, urlencode, urlunparse

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from db import client

load_dotenv()
MAX_WATCHES = int(os.getenv('MAX_SEARCH_WATCHES_PER_RUN', '4'))
MAX_NEW_PER_WATCH = int(os.getenv('MAX_NEW_LISTINGS_PER_WATCH_RUN', '250'))
PAGE_SETTLE_MS = int(os.getenv('SEARCH_WATCH_PAGE_SETTLE_MS', '2500'))
LISTING_RX = re.compile(r'/listing/(\d{6,})\b', re.I)
CHALLENGES = (
    ('captcha', 'captcha'),
    ('access denied', 'access_denied'),
    ('verify you are human', 'human_verification'),
    ('unusual traffic', 'unusual_traffic'),
)


def now():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now()).isoformat()


def due_watches(db):
    return (
        db.table('search_watches')
        .select('*')
        .eq('active', True)
        .lte('next_run_at', iso())
        .order('next_run_at')
        .limit(MAX_WATCHES)
        .execute()
        .data
        or []
    )


def initial_due(listing_id: str):
    # Stable distribution across the first hour. This is workload smoothing only.
    return now() + timedelta(minutes=(int(listing_id[-6:]) % 60))


def search_url(term: str, category: str | None = None):
    """Build only page 1. Later pages must be discovered from the rendered page."""
    base = 'https://www.trademe.co.nz/a/search'
    c = (category or '').strip()
    if c.startswith('https://www.trademe.co.nz/') or c.startswith('https://trademe.co.nz/'):
        base = c
    elif c.startswith('/a/'):
        base = 'https://www.trademe.co.nz' + c

    u = urlparse(base)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    q['search_string'] = term
    q.pop('page', None)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(q), u.fragment))


def _same_trademe_host(url: str) -> bool:
    host = (urlparse(url).hostname or '').lower()
    return host in ('trademe.co.nz', 'www.trademe.co.nz') or host.endswith('.trademe.co.nz')


def choose_next_pagination_candidate(candidates, current_page: int, current_url: str):
    """Choose a rendered next-page control using semantics, not CSS classes."""
    current = urlparse(current_url)
    ranked = []

    for c in candidates:
        if c.get('disabled'):
            continue

        href = str(c.get('href') or '').strip()
        absolute = urljoin(current_url, href) if href else ''
        if absolute and (not _same_trademe_host(absolute) or LISTING_RX.search(absolute)):
            continue

        text = ' '.join(str(c.get('text') or '').split()).lower()
        aria = ' '.join(str(c.get('aria') or '').split()).lower()
        title = ' '.join(str(c.get('title') or '').split()).lower()
        rel = ' '.join(str(c.get('rel') or '').split()).lower()
        nav = ' '.join(str(c.get('nav') or '').split()).lower()
        blob = ' '.join(x for x in (text, aria, title) if x)

        score = 0
        reason = None

        if 'next' in rel.split():
            score, reason = 120, 'rel=next'
        elif any(label in blob for label in ('next page', 'next results')):
            score, reason = 110, 'semantic next control'
        elif blob == 'next' and ('pagination' in nav or href):
            score, reason = 104, 'semantic next control'
        elif text in ('›', '»', '>', '→') and ('pagination' in nav or href):
            score, reason = 92, 'next arrow control'
        elif text.isdigit() and int(text) == current_page + 1:
            score, reason = 88, 'incrementing page number'

        if href:
            parsed = urlparse(absolute)
            q = dict(parse_qsl(parsed.query, keep_blank_values=True))
            try:
                href_page = int(q.get('page', ''))
            except Exception:
                href_page = None
            if href_page == current_page + 1 and score < 96:
                score, reason = 96, 'href increments page'
            if parsed.path == current.path:
                score += 5

        if 'pagination' in nav:
            score += 12

        if score:
            ranked.append(
                (
                    score,
                    {
                        'index': int(c.get('index', -1)),
                        'href': absolute or None,
                        'reason': reason,
                        'text': c.get('text'),
                        'aria': c.get('aria'),
                    },
                )
            )

    return max(ranked, key=lambda item: item[0])[1] if ranked else None


def discover_next_page(page, current_page: int, current_url: str):
    candidates = page.locator('a[href], button, [role="button"]').evaluate_all(
        r'''els => els.map((el,index) => {
          const nav = el.closest('nav,[aria-label*="pagin" i],[role="navigation"]');
          return {
            index,
            href: el.href || el.getAttribute('href') || '',
            text: (el.innerText || el.textContent || '').replace(/\s+/g,' ').trim(),
            aria: el.getAttribute('aria-label') || '',
            title: el.getAttribute('title') || '',
            rel: el.getAttribute('rel') || '',
            disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
            nav: nav ? ((nav.getAttribute('aria-label') || '') + ' ' + (nav.innerText || nav.textContent || '')).slice(0,1200) : ''
          };
        })'''
    )
    return choose_next_pagination_candidate(candidates, current_page, current_url)


def advance_to_next_page(page, candidate):
    before = page.url
    if candidate.get('href'):
        response = page.goto(candidate['href'], wait_until='commit', timeout=45000)
    else:
        controls = page.locator('a[href], button, [role="button"]')
        idx = int(candidate.get('index', -1))
        if idx < 0 or idx >= controls.count():
            raise RuntimeError(
                'pagination_control_disappeared: semantic next-page control changed before click'
            )
        controls.nth(idx).click(timeout=10000)
        try:
            page.wait_for_url(lambda url: url != before, timeout=15000)
        except PlaywrightTimeoutError:
            pass
        response = None

    try:
        page.wait_for_load_state('domcontentloaded', timeout=15000)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(PAGE_SETTLE_MS)
    return response


def classify_page(page, status=None):
    body = (page.locator('body').inner_text(timeout=10000) or '')[:18000]
    low = body.lower()
    for needle, kind in CHALLENGES:
        if needle in low:
            return kind, body
    if status and status >= 400:
        return f'http_{status}', body
    if len(body.strip()) < 100:
        return 'incomplete_page', body
    return None, body


def extract_results(page):
    anchors = page.locator('a[href*="/listing/"]').evaluate_all(
        r'''els => els.map(a => ({
          href:a.href || a.getAttribute('href') || '',
          text:(a.innerText || a.textContent || '').replace(/\s+/g,' ').trim(),
          aria:a.getAttribute('aria-label') || '',
          title:a.getAttribute('title') || ''
        }))'''
    )
    out = {}
    for a in anchors:
        href = str(a.get('href') or '')
        m = LISTING_RX.search(href)
        if not m:
            continue
        lid = m.group(1)
        if not _same_trademe_host(href):
            continue
        title = str(a.get('text') or a.get('aria') or a.get('title') or '').strip()
        prev = out.get(lid)
        item = {
            'listing_id': lid,
            'url': href.split('?')[0],
            'listing_title': title[:500] or None,
        }
        if prev is None or len(title) > len(str(prev.get('listing_title') or '')):
            out[lid] = item
    return list(out.values())


def record_event(db, **row):
    try:
        db.table('listing_acquisition_events').insert(row).execute()
    except Exception as e:
        print(f'ACQUISITION EVENT WARNING: {e}')


def upsert_discovery(db, watch, run, item):
    lid = str(item['listing_id'])
    existing = (
        db.table('listings')
        .select('*')
        .eq('marketplace', 'Trade Me')
        .eq('listing_id', lid)
        .limit(1)
        .execute()
        .data
        or []
    )
    due = initial_due(lid).isoformat()
    discovered = iso()
    metadata = {
        'search_discovery': {
            'watch_id': watch['id'],
            'search_term': watch['search_term'],
            'run_id': run['id'],
            'discovered_at': discovered,
            'source': 'browser_search',
        }
    }

    if existing:
        row = existing[0]
        current = dict(row.get('metadata') or {})
        current.update(metadata)
        patch = {
            'last_seen': discovered,
            'title': item.get('listing_title') or row.get('title'),
            'metadata': current,
            'source_watch_id': row.get('source_watch_id') or watch['id'],
            'discovered_via': row.get('discovered_via') or 'browser_search',
            'last_acquisition_status': 'search_seen',
            'last_acquisition_event_at': discovered,
            'last_acquisition_error_type': None,
        }
        if row.get('active') and not row.get('next_observation_at'):
            patch['next_observation_at'] = due
        db.table('listings').update(patch).eq('id', row['id']).execute()
        listing_uuid = row['id']
        created = False
    else:
        row = {
            'marketplace': 'Trade Me',
            'listing_id': lid,
            'url': item['url'],
            'source_url': item['url'],
            'title': item.get('listing_title'),
            'active': True,
            'first_seen': discovered,
            'last_seen': discovered,
            'next_observation_at': due,
            'observation_interval_hours': 3,
            'priority': 72,
            'consecutive_failures': 0,
            'metadata': metadata,
            'source_watch_id': watch['id'],
            'discovered_via': 'browser_search',
            'last_acquisition_status': 'search_discovered',
            'last_acquisition_event_at': discovered,
            'cadence_reason': 'new listing discovered by Search Watch · first detail observation within 60m',
        }
        listing_uuid = db.table('listings').insert(row).execute().data[0]['id']
        created = True

    record_event(
        db,
        listing_uuid=listing_uuid,
        watch_id=watch['id'],
        search_run_id=run['id'],
        operation='search_discovery',
        source='browser_search',
        status='new' if created else 'known',
        diagnostics={'search_term': watch['search_term']},
    )
    return created


def run_watch(db, watch, browser):
    started = iso()
    run = (
        db.table('search_watch_runs')
        .insert({'watch_id': watch['id'], 'started_at': started, 'status': 'running'})
        .execute()
        .data[0]
    )
    attempted = ok = results = new = known = 0
    error_type = error_message = None
    diagnostics = {
        'search_term': watch['search_term'],
        'category': watch.get('category'),
        'pages': [],
        'source': 'browser_search',
        'pagination_mode': 'semantic_dom_scan',
    }
    context = browser.new_context(
        locale='en-NZ',
        timezone_id='Pacific/Auckland',
        viewport={'width': 1440, 'height': 1000},
    )

    try:
        page = context.new_page()
        seen = set()
        visited_urls = set()
        max_pages = int(watch.get('max_pages') or 3)

        first_url = search_url(watch['search_term'], watch.get('category'))
        try:
            response = page.goto(first_url, wait_until='commit', timeout=45000)
        except PlaywrightTimeoutError as e:
            raise RuntimeError(f'navigation_timeout: {e}')
        try:
            page.wait_for_load_state('domcontentloaded', timeout=15000)
        except PlaywrightTimeoutError:
            pass
        page.wait_for_timeout(PAGE_SETTLE_MS)

        for page_no in range(1, max_pages + 1):
            attempted += 1
            url = page.url
            visited_urls.add(url)
            started_page = time.monotonic()
            status = response.status if response else None

            blocked, _ = classify_page(page, status)
            duration = int((time.monotonic() - started_page) * 1000)
            if blocked:
                raise RuntimeError(
                    f'{blocked}: Trade Me search page could not be collected; '
                    'Search Watch stopped without bypassing the challenge.'
                )

            items = extract_results(page)
            ok += 1
            unseen_before = [x for x in items if x['listing_id'] not in seen]
            page_diag = {
                'page': page_no,
                'url': url,
                'http_status': status,
                'duration_ms': duration,
                'items': len(items),
            }
            diagnostics['pages'].append(page_diag)

            if not items:
                page_diag['pagination_stop'] = 'no listing links found'
                break

            for item in items:
                lid = item['listing_id']
                if lid in seen:
                    continue
                seen.add(lid)
                results += 1
                if new >= MAX_NEW_PER_WATCH:
                    continue
                if upsert_discovery(db, watch, run, item):
                    new += 1
                else:
                    known += 1

            if page_no > 1 and not unseen_before:
                page_diag['pagination_stop'] = 'no unseen listing IDs on this page'
                break
            if page_no >= max_pages:
                page_diag['pagination_stop'] = 'configured max_pages reached'
                break

            candidate = discover_next_page(page, page_no, page.url)
            if not candidate:
                page_diag['pagination_stop'] = 'no semantic next/increment pagination control found'
                break

            page_diag['next_page'] = {
                'reason': candidate.get('reason'),
                'text': candidate.get('text'),
                'aria': candidate.get('aria'),
                'href': candidate.get('href'),
            }

            try:
                response = advance_to_next_page(page, candidate)
            except PlaywrightTimeoutError as e:
                raise RuntimeError(f'pagination_timeout: {e}')

            if page.url in visited_urls:
                page_diag['pagination_stop'] = 'next pagination control did not advance URL'
                break

        status_name = 'success'
        next_run = (now() + timedelta(hours=int(watch.get('interval_hours') or 6))).isoformat()
        db.table('search_watches').update(
            {
                'last_run_at': iso(),
                'next_run_at': next_run,
                'last_status': status_name,
                'last_error': None,
                'discovered_total': int(watch.get('discovered_total') or 0) + new,
                'known_total': int(watch.get('known_total') or 0) + known,
            }
        ).eq('id', watch['id']).execute()
    except Exception as e:
        status_name = 'failed'
        msg = str(e)
        error_type = msg.split(':', 1)[0] if ':' in msg else e.__class__.__name__
        error_message = msg[:2000]
        diagnostics['failure'] = {'error_type': error_type}
        db.table('search_watches').update(
            {
                'last_run_at': iso(),
                'next_run_at': (now() + timedelta(hours=1)).isoformat(),
                'last_status': 'failed',
                'last_error': error_message,
            }
        ).eq('id', watch['id']).execute()
    finally:
        context.close()

    patch = {
        'finished_at': iso(),
        'status': status_name,
        'pages_attempted': attempted,
        'pages_succeeded': ok,
        'result_count': results,
        'new_count': new,
        'known_count': known,
        'queued_for_observation': new,
        'diagnostics': diagnostics,
        'error_type': error_type,
        'error_message': error_message,
    }
    db.table('search_watch_runs').update(patch).eq('id', run['id']).execute()
    print(
        json.dumps(
            {
                'watch': watch['search_term'],
                'status': status_name,
                'results': results,
                'new': new,
                'known': known,
                'pages': ok,
                'error_type': error_type,
            }
        )
    )
    return status_name == 'success'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--due-check', action='store_true')
    args = parser.parse_args()
    db = client()
    watches = due_watches(db)

    if args.due_check:
        print(json.dumps({'due': bool(watches), 'count': len(watches)}))
        return 0 if watches else 3

    print(f'Search Watches due: {len(watches)}')
    if not watches:
        return

    headless = os.getenv('HEADLESS', 'true').lower() not in ('0', 'false', 'no')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        try:
            succeeded = sum(1 for watch in watches if run_watch(db, watch, browser))
        finally:
            browser.close()

    print(
        json.dumps(
            {
                'attempted': len(watches),
                'succeeded': succeeded,
                'failed': len(watches) - succeeded,
                'source': 'browser_search',
            }
        )
    )


if __name__ == '__main__':
    main()
