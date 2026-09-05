import json, os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

COLLECTOR_JS = Path(__file__).with_name('collector.js')

class CollectionBlocked(RuntimeError): pass

def collect_listing(url: str, headless: bool = True) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(locale='en-NZ', timezone_id='Pacific/Auckland', viewport={"width":1440,"height":1000})
        page = context.new_page()
        try:
            response = page.goto(url, wait_until='domcontentloaded', timeout=45_000)
            if response and response.status >= 400:
                raise RuntimeError(f'HTTP {response.status}')
            page.wait_for_timeout(2500)
            body=(page.locator('body').inner_text(timeout=10_000) or '')[:12000]
            lowered=body.lower()
            if any(x in lowered for x in ['captcha','access denied','verify you are human','unusual traffic']):
                raise CollectionBlocked('Site presented an access/verification challenge; collector stopped without bypassing it.')
            page.add_script_tag(path=str(COLLECTOR_JS))
            raw=page.evaluate('window.FishingPondCollect()')
            if not raw or not raw.get('listing_id'):
                raise RuntimeError('Collector returned no listing ID')
            return raw
        finally:
            context.close(); browser.close()
