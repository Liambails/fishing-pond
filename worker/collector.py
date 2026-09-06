from pathlib import Path
from urllib.parse import urljoin, urlparse
import re
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

COLLECTOR_JS = Path(__file__).with_name('collector.js')

class CollectionError(RuntimeError):
    def __init__(self,message,error_type='collector_error',stage='unknown',requested_url=None,final_url=None,page_title=None,http_status=None,diagnostics=None):
        super().__init__(message); self.error_type=error_type; self.stage=stage; self.requested_url=requested_url; self.final_url=final_url; self.page_title=page_title; self.http_status=http_status; self.diagnostics=diagnostics or {}
class CollectionBlocked(CollectionError): pass

RELIST_WORDS = re.compile(r'\b(?:re\s*[- ]?listed|re\s*[- ]?list(?:ed|ing)?|listed\s+again|view\s+(?:the\s+)?relisted\s+(?:item|listing)|new\s+listing)\b', re.I)
LISTING_ID_PATTERNS = (
    re.compile(r'/listing/(\d{6,})\b', re.I),
    re.compile(r'[?&](?:listing|listing_id|listingid)=(\d{6,})\b', re.I),
)

def marketplace_listing_id(url: str):
    for pattern in LISTING_ID_PATTERNS:
        match = pattern.search(str(url or ''))
        if match:
            return match.group(1)
    return None

def _is_trademe_host(url: str):
    try:
        host=(urlparse(url).hostname or '').lower().rstrip('.')
        return host == 'trademe.co.nz' or host.endswith('.trademe.co.nz')
    except Exception:
        return False

def find_explicit_relist_link(page, requested_url: str, current_listing_id=None):
    """Find a marketplace-provided successor link without relying on fragile CSS classes.

    This intentionally inspects ordinary anchors only. It does not bypass challenges, execute
    seller relist actions, or follow links whose destination cannot be identified as a different
    Trade Me listing.
    """
    candidates=[]
    try:
        anchors=page.locator('a[href]').evaluate_all("""els => els.map((a, i) => ({
          index:i,
          href:a.getAttribute('href') || '',
          absoluteHref:a.href || '',
          text:(a.innerText || a.textContent || '').replace(/\\s+/g,' ').trim(),
          aria:a.getAttribute('aria-label') || '',
          title:a.getAttribute('title') || ''
        }))""")
    except Exception:
        return None
    old_id=str(current_listing_id or marketplace_listing_id(requested_url) or '')
    for a in anchors:
        href=str(a.get('absoluteHref') or urljoin(page.url or requested_url, a.get('href') or ''))
        label=' '.join(str(a.get(k) or '') for k in ('text','aria','title','href'))
        if not RELIST_WORDS.search(label):
            continue
        if not _is_trademe_host(href):
            continue
        new_id=marketplace_listing_id(href)
        path=(urlparse(href).path or '').lower()
        # Never follow seller-side relist/create actions. A semantic marketplace link without an
        # ID may still be a safe redirect to the successor; run.py resolves it through normal
        # navigation and validates the final listing ID before creating any lineage.
        if not new_id and ('/sell/' in path or '/relist/' in path):
            continue
        if old_id and new_id == old_id:
            continue
        candidates.append({
            'url': href,
            'listing_id': new_id,
            'anchor_text': str(a.get('text') or a.get('aria') or a.get('title') or '').strip()[:300],
            'source': 'marketplace_explicit_link',
        })
    if not candidates:
        return None
    # Prefer the most semantically explicit visible label, then first DOM occurrence.
    candidates.sort(key=lambda c: (0 if re.search(r'view.*relist|relisted.*item|relisted.*listing', c['anchor_text'], re.I) else 1))
    return candidates[0]

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
            # Closed listing pages can expose an explicit marketplace link to their successor.
            # Capture the relationship as evidence; run.py decides whether a new listing needs
            # to be registered/collected. No challenge bypass or browser-identity spoofing.
            if raw.get('listing_ended'):
                relist=find_explicit_relist_link(page, page.url or url, raw.get('listing_id'))
                if relist:
                    raw['explicit_relist']=relist
            raw['final_url']=page.url
            return raw
        finally:
            context.close(); browser.close()
