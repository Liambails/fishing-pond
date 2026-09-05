from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

COLLECTOR_JS = Path(__file__).with_name('collector.js')

class CollectionError(RuntimeError):
    def __init__(self,message,error_type='collector_error',stage='unknown',requested_url=None,final_url=None,page_title=None,http_status=None,diagnostics=None):
        super().__init__(message); self.error_type=error_type; self.stage=stage; self.requested_url=requested_url; self.final_url=final_url; self.page_title=page_title; self.http_status=http_status; self.diagnostics=diagnostics or {}
class CollectionBlocked(CollectionError): pass

def collect_listing(url: str, headless: bool = True) -> dict:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=headless)
        context=browser.new_context(locale='en-NZ',timezone_id='Pacific/Auckland',viewport={'width':1440,'height':1000})
        page=context.new_page(); response=None
        try:
            try: response=page.goto(url,wait_until='commit',timeout=45_000)
            except PlaywrightTimeoutError as e: raise CollectionError(str(e),'navigation_timeout','navigation',url,page.url,page.title() if page.url else None)
            try: page.wait_for_load_state('domcontentloaded',timeout=15_000)
            except PlaywrightTimeoutError: pass
            page.wait_for_timeout(2500)
            status=response.status if response else None
            if status and status>=400: raise CollectionError(f'HTTP {status}','http_error','navigation',url,page.url,page.title(),status)
            body=(page.locator('body').inner_text(timeout=10_000) or '')[:12000]; lowered=body.lower()
            challenges=[('captcha','captcha'),('access denied','access_denied'),('verify you are human','human_verification'),('unusual traffic','unusual_traffic')]
            for needle,kind in challenges:
                if needle in lowered: raise CollectionBlocked('Site presented an access/verification challenge; collector stopped without bypassing it.',kind,'challenge_detection',url,page.url,page.title(),status)
            if len(body.strip())<100: raise CollectionError('Page body was unexpectedly short','incomplete_page','page_validation',url,page.url,page.title(),status,{'body_length':len(body)})
            try:
                collector_source=COLLECTOR_JS.read_text(encoding='utf-8'); page.evaluate(collector_source); raw=page.evaluate('window.CobaltCollect()')
            except Exception as e: raise CollectionError(str(e),'collector_execution','collector',url,page.url,page.title(),status)
            if not raw or not raw.get('listing_id'): raise CollectionError('Collector returned no listing ID','missing_listing_id','collector',url,page.url,page.title(),status)
            return raw
        finally:
            context.close(); browser.close()
