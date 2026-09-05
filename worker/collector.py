from pathlib import Path

from playwright.sync_api import (
    sync_playwright,
    TimeoutError as PlaywrightTimeoutError
)

COLLECTOR_JS = Path(__file__).with_name('collector.js')


class CollectionError(RuntimeError):
    def __init__(
        self,
        message,
        *,
        error_type='collector_error',
        stage=None,
        requested_url=None,
        final_url=None,
        page_title=None,
        http_status=None,
        diagnostics=None
    ):
        super().__init__(message)

        self.error_type = error_type
        self.stage = stage
        self.requested_url = requested_url
        self.final_url = final_url
        self.page_title = page_title
        self.http_status = http_status
        self.diagnostics = diagnostics or {}


class CollectionBlocked(CollectionError):
    pass


def collect_listing(url: str, headless: bool = True) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless
        )

        context = browser.new_context(
            locale='en-NZ',
            timezone_id='Pacific/Auckland',
            viewport={
                'width': 1440,
                'height': 1000
            }
        )

        page = context.new_page()

        stage = 'browser_start'
        response = None
        dom_timed_out = False

        try:
            stage = 'navigation'

            try:
                response = page.goto(
                    url,
                    wait_until='commit',
                    timeout=45_000
                )
            except PlaywrightTimeoutError as exc:
                raise CollectionError(
                    str(exc),
                    error_type='navigation_timeout',
                    stage='navigation',
                    requested_url=url,
                    final_url=page.url,
                    page_title=None,
                    diagnostics={
                        'timeout_ms': 45000
                    }
                ) from exc

            if response and response.status >= 400:
                raise CollectionError(
                    f'HTTP {response.status}',
                    error_type='http_error',
                    stage='navigation',
                    requested_url=url,
                    final_url=page.url,
                    page_title=page.title(),
                    http_status=response.status
                )

            stage = 'dom_wait'

            try:
                page.wait_for_load_state(
                    'domcontentloaded',
                    timeout=15_000
                )
            except PlaywrightTimeoutError:
                dom_timed_out = True

            page.wait_for_timeout(2500)

            stage = 'page_inspection'

            try:
                body = (
                    page.locator('body')
                    .inner_text(timeout=10_000)
                    or ''
                )
            except Exception as exc:
                raise CollectionError(
                    str(exc),
                    error_type='page_unreadable',
                    stage='page_inspection',
                    requested_url=url,
                    final_url=page.url,
                    page_title=page.title(),
                    http_status=response.status if response else None
                ) from exc

            body = body[:12000]
            lowered = body.lower()

            challenge_terms = {
                'captcha': 'captcha',
                'access denied': 'access_denied',
                'verify you are human': 'human_verification',
                'unusual traffic': 'unusual_traffic'
            }

            for phrase, error_type in challenge_terms.items():
                if phrase in lowered:
                    raise CollectionBlocked(
                        'Site presented an access/verification challenge; '
                        'collector stopped without bypassing it.',
                        error_type=error_type,
                        stage='access_check',
                        requested_url=url,
                        final_url=page.url,
                        page_title=page.title(),
                        http_status=response.status if response else None,
                        diagnostics={
                            'matched_phrase': phrase,
                            'dom_timed_out': dom_timed_out
                        }
                    )

            if len(body.strip()) < 100:
                raise CollectionError(
                    'Page loaded but contained too little readable content',
                    error_type='insufficient_page_content',
                    stage='page_inspection',
                    requested_url=url,
                    final_url=page.url,
                    page_title=page.title(),
                    http_status=response.status if response else None,
                    diagnostics={
                        'body_length': len(body),
                        'dom_timed_out': dom_timed_out
                    }
                )

            stage = 'collector_injection'

            collector_source = COLLECTOR_JS.read_text(
                encoding='utf-8'
            )

            page.evaluate(
                collector_source
            )

            stage = 'collector_execution'

            raw = page.evaluate(
                'window.FishingPondCollect()'
            )

            if not raw:
                raise CollectionError(
                    'Collector returned no data',
                    error_type='empty_collector_result',
                    stage='collector_execution',
                    requested_url=url,
                    final_url=page.url,
                    page_title=page.title(),
                    http_status=response.status if response else None,
                    diagnostics={
                        'dom_timed_out': dom_timed_out
                    }
                )

            if not raw.get('listing_id'):
                raise CollectionError(
                    'Collector returned no listing ID',
                    error_type='missing_listing_id',
                    stage='collector_execution',
                    requested_url=url,
                    final_url=page.url,
                    page_title=page.title(),
                    http_status=response.status if response else None,
                    diagnostics={
                        'collector_keys': list(raw.keys()),
                        'dom_timed_out': dom_timed_out
                    }
                )

            raw['_worker_diagnostics'] = {
                'dom_timed_out': dom_timed_out,
                'final_url': page.url,
                'http_status': (
                    response.status
                    if response
                    else None
                )
            }

            return raw

        except CollectionError:
            raise

        except Exception as exc:
            try:
                final_url = page.url
            except Exception:
                final_url = None

            try:
                title = page.title()
            except Exception:
                title = None

            raise CollectionError(
                str(exc),
                error_type='unexpected_error',
                stage=stage,
                requested_url=url,
                final_url=final_url,
                page_title=title,
                http_status=(
                    response.status
                    if response
                    else None
                ),
                diagnostics={
                    'exception_class': type(exc).__name__,
                    'dom_timed_out': dom_timed_out
                }
            ) from exc

        finally:
            context.close()
            browser.close()
