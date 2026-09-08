#!/usr/bin/env python3
"""COBALT bulk relist audit v2.

A tolerant diagnostic relist scanner for ended/expired marketplace listings.
Unlike the normal observation collector, this tool DOES NOT reject short/ended
pages before extracting redirects, listing links, page text, HTML and relist
signals.

Default mode is dry-run. Use --apply only after the dry-run output is correct.

Examples:
  python3 worker/recheck_relists.py --listing-id 6110749863
  python3 worker/recheck_relists.py --listing-id 6110749863 --headful
  python3 worker/recheck_relists.py --limit 20
  python3 worker/recheck_relists.py --debug-all --json ~/Desktop/relist-audit.json
  python3 worker/recheck_relists.py --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from collector import (
    COLLECTOR_JS,
    RELIST_WORDS,
    collect_listing,
    find_explicit_relist_link,
    find_relist_candidate_links,
    marketplace_listing_id,
)
from db import client, effective_ended, save_success
from relist import compare_relist, pick_best_relist
from run import detect_relist_from_capture

DEBUG_DIR = HERE / "relist_debug"
LISTING_URL_RE = re.compile(r"https?://(?:www\.)?trademe\.co\.nz/[^\s\"'<>]*/listing/(\d{6,})[^\s\"'<>]*", re.I)
LISTING_PATH_RE = re.compile(r"(?:https?://[^\s\"'<>]+)?/[^\s\"'<>]*/listing/(\d{6,})[^\s\"'<>]*", re.I)
CHALLENGES = (
    ("captcha", "captcha"),
    ("access denied", "access_denied"),
    ("verify you are human", "human_verification"),
    ("unusual traffic", "unusual_traffic"),
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def paged(table, select: str, order: str | None = None, page_size: int = 1000):
    out = []
    start = 0
    while True:
        q = table.select(select)
        if order:
            q = q.order(order)
        rows = q.range(start, start + page_size - 1).execute().data or []
        out.extend(rows)
        if len(rows) < page_size:
            return out
        start += page_size


def latest_observation_map(db) -> dict[str, dict]:
    rows = paged(
        db.table("observations"),
        "listing_uuid,captured_at,close_date,views,bids,watchers,raw_snapshot",
        order="captured_at",
    )
    latest: dict[str, dict] = {}
    for row in rows:
        lid = str(row.get("listing_uuid") or "")
        if not lid:
            continue
        prev = latest.get(lid)
        if not prev or str(row.get("captured_at") or "") > str(prev.get("captured_at") or ""):
            latest[lid] = row
    return latest


def is_trademe(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower().rstrip(".")
        return host == "trademe.co.nz" or host.endswith(".trademe.co.nz")
    except Exception:
        return False


def diagnostic_listing_links(page, requested_url: str, current_id: str) -> list[dict]:
    """Extract every ordinary Trade Me listing link before interpreting semantics."""
    try:
        anchors = page.locator("a[href]").evaluate_all(
            r"""els => els.map((a, i) => ({
              index:i,
              href:a.getAttribute('href') || '',
              absoluteHref:a.href || '',
              text:(a.innerText || a.textContent || '').replace(/\s+/g,' ').trim(),
              aria:a.getAttribute('aria-label') || '',
              title:a.getAttribute('title') || ''
            }))"""
        )
    except Exception:
        return []

    found: dict[str, dict] = {}
    for a in anchors:
        href = str(a.get("absoluteHref") or urljoin(page.url or requested_url, a.get("href") or ""))
        if not is_trademe(href):
            continue
        lid = marketplace_listing_id(href)
        if not lid or lid == current_id:
            continue
        label = " ".join(str(a.get(k) or "") for k in ("text", "aria", "title")).strip()
        semantic = bool(RELIST_WORDS.search(" ".join((label, str(a.get("href") or "")))))
        item = {
            "listing_id": lid,
            "url": href,
            "text": label[:500],
            "semantic_relist_wording": semantic,
            "dom_index": a.get("index"),
        }
        prev = found.get(lid)
        if prev is None or (semantic and not prev.get("semantic_relist_wording")):
            found[lid] = item
    return sorted(found.values(), key=lambda x: (not x.get("semantic_relist_wording"), x.get("dom_index") or 0))


def ids_from_text(*texts: str, exclude: str = "") -> list[str]:
    ids = set()
    for text in texts:
        for rx in (LISTING_URL_RE, LISTING_PATH_RE):
            for m in rx.finditer(str(text or "")):
                if m.group(1) != exclude:
                    ids.add(m.group(1))
    return sorted(ids)


def tolerant_probe(url: str, *, headless: bool = True, wait_ms: int = 3000) -> dict:
    """Load a page without requiring it to look like an active listing.

    Short ended pages are valid diagnostics. We attempt the normal collector but preserve
    the page even when CobaltCollect cannot extract a canonical active listing.
    """
    probe: dict[str, Any] = {
        "requested_url": url,
        "final_url": None,
        "http_status": None,
        "page_title": None,
        "body_text": "",
        "body_length": 0,
        "html": "",
        "challenge": None,
        "collector_raw": None,
        "collector_error": None,
        "explicit_relist": None,
        "relist_candidates": [],
        "listing_links": [],
        "listing_ids_found": [],
    }

    p = sync_playwright().start()
    browser = context = page = None
    try:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            locale="en-NZ",
            timezone_id="Pacific/Auckland",
            viewport={"width": 1440, "height": 1000},
        )
        page = context.new_page()
        response = None
        try:
            response = page.goto(url, wait_until="commit", timeout=45_000)
        except PlaywrightTimeoutError as e:
            probe["navigation_error"] = f"timeout: {e}"
        except Exception as e:
            probe["navigation_error"] = f"{e.__class__.__name__}: {e}"

        try:
            page.wait_for_load_state("domcontentloaded", timeout=15_000)
        except Exception:
            pass
        try:
            page.wait_for_timeout(wait_ms)
        except Exception:
            pass

        probe["http_status"] = response.status if response else None
        probe["final_url"] = page.url
        try:
            probe["page_title"] = page.title()
        except Exception:
            pass
        try:
            probe["body_text"] = page.locator("body").inner_text(timeout=10_000) or ""
        except Exception as e:
            probe["body_read_error"] = str(e)
        probe["body_length"] = len(probe["body_text"])
        try:
            probe["html"] = page.content()
        except Exception as e:
            probe["html_read_error"] = str(e)

        lowered = probe["body_text"].lower()
        for needle, kind in CHALLENGES:
            if needle in lowered:
                probe["challenge"] = kind
                break

        old_id = str(marketplace_listing_id(url) or "")
        current_id = str(marketplace_listing_id(page.url) or old_id)

        # These functions work even on short/ended pages because they only inspect anchors.
        try:
            probe["explicit_relist"] = find_explicit_relist_link(page, page.url or url, current_id)
        except Exception as e:
            probe["explicit_relist_error"] = str(e)
        try:
            probe["relist_candidates"] = find_relist_candidate_links(page, page.url or url, current_id, None, limit=20)
        except Exception as e:
            probe["relist_candidate_error"] = str(e)
        probe["listing_links"] = diagnostic_listing_links(page, url, current_id)

        # Attempt normal field extraction, but never reject the diagnostic if it fails.
        try:
            source = COLLECTOR_JS.read_text(encoding="utf-8")
            page.evaluate(source)
            raw = page.evaluate("window.CobaltCollect()")
            if isinstance(raw, dict):
                raw["final_url"] = page.url
                if probe.get("explicit_relist"):
                    raw["explicit_relist"] = probe["explicit_relist"]
                if probe.get("relist_candidates"):
                    raw["relist_candidates"] = probe["relist_candidates"]
                probe["collector_raw"] = raw
        except Exception as e:
            probe["collector_error"] = f"{e.__class__.__name__}: {e}"

        all_text = "\n".join(
            [probe.get("final_url") or "", probe.get("body_text") or "", probe.get("html") or ""]
        )
        ids = set(ids_from_text(all_text, exclude=old_id))
        for link in probe["listing_links"]:
            if link.get("listing_id") and link.get("listing_id") != old_id:
                ids.add(str(link["listing_id"]))
        if probe.get("explicit_relist") and probe["explicit_relist"].get("listing_id"):
            ids.add(str(probe["explicit_relist"]["listing_id"]))
        probe["listing_ids_found"] = sorted(ids)
        return probe
    finally:
        # Be deliberately defensive: a diagnostic should not hang indefinitely while shutting down.
        for obj in (page, context, browser):
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass
        try:
            p.stop()
        except Exception:
            pass


def snapshot_probe(probe: dict, listing_id: str, *, force: bool = False) -> dict[str, str] | None:
    abnormal = (
        probe.get("body_length", 0) < 100
        or bool(probe.get("navigation_error"))
        or bool(probe.get("collector_error"))
        or bool(probe.get("challenge"))
    )
    if not force and not abnormal:
        return None
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = now_utc().strftime("%Y%m%dT%H%M%SZ")
    base = DEBUG_DIR / f"{listing_id}_{stamp}"
    html_path = base.with_suffix(".html")
    json_path = base.with_suffix(".json")
    html_path.write_text(probe.get("html") or "", encoding="utf-8", errors="replace")
    safe = {k: v for k, v in probe.items() if k != "html"}
    json_path.write_text(json.dumps(safe, indent=2, default=str), encoding="utf-8")
    return {"html": str(html_path), "json": str(json_path)}


def print_probe_diagnostic(probe: dict, debug_paths: dict[str, str] | None = None):
    print(f"  requested:    {probe.get('requested_url')}")
    print(f"  final URL:    {probe.get('final_url') or 'unknown'}")
    print(f"  HTTP status:  {probe.get('http_status') if probe.get('http_status') is not None else 'unknown'}")
    print(f"  page title:   {probe.get('page_title') or '—'}")
    print(f"  body chars:   {probe.get('body_length', 0)}")
    if probe.get("challenge"):
        print(f"  challenge:    {probe.get('challenge')}")
    if probe.get("collector_error"):
        print(f"  collector:    {probe.get('collector_error')[:300]}")
    ids = probe.get("listing_ids_found") or []
    print(f"  listing IDs:  {', '.join(ids[:20]) if ids else 'none found'}")
    if probe.get("explicit_relist"):
        print(f"  explicit:     {probe['explicit_relist'].get('url')}")
    links = probe.get("listing_links") or []
    if links:
        print("  listing links:")
        for link in links[:12]:
            marker = " RELIST-WORDING" if link.get("semantic_relist_wording") else ""
            label = (link.get("text") or "").replace("\n", " ")[:130]
            print(f"    #{link.get('listing_id')} {label!r}{marker}")
    body = (probe.get("body_text") or "").strip()
    if body:
        preview = body[:3000].replace("\x00", "")
        print("  body preview:")
        for line in preview.splitlines()[:80]:
            print(f"    {line[:220]}")
        if len(body) > 3000:
            print("    … [preview truncated; full HTML saved when diagnostic snapshot is enabled]")
    else:
        print("  body preview: —")
    if debug_paths:
        print(f"  debug JSON:   {debug_paths['json']}")
        print(f"  debug HTML:   {debug_paths['html']}")


def candidate_listing(raw: dict) -> dict:
    return {
        "listing_id": str(raw.get("listing_id") or marketplace_listing_id(raw.get("final_url")) or ""),
        "url": raw.get("final_url") or raw.get("url"),
        "title": raw.get("listing_title"),
        "seller": raw.get("seller"),
        "metadata": {"category_path": raw.get("category_path") or []},
    }


def collect_candidate_raw(url: str, headless: bool) -> tuple[dict | None, dict | None]:
    try:
        return collect_listing(url, headless=headless), None
    except Exception as e:
        probe = tolerant_probe(url, headless=headless)
        raw = probe.get("collector_raw")
        return raw if isinstance(raw, dict) and raw.get("listing_id") else None, probe


def candidate_urls_from_probe(probe: dict, parent_id: str) -> list[dict]:
    found: dict[str, dict] = {}

    def add(item: dict | None, source: str):
        if not item:
            return
        url = item.get("url")
        lid = str(item.get("listing_id") or marketplace_listing_id(url) or "")
        if not url or not lid or lid == parent_id:
            return
        candidate = {**item, "listing_id": lid, "source": item.get("source") or source}
        prev = found.get(lid)
        priority = {"marketplace_explicit_link": 0, "ended_page_candidate": 1, "diagnostic_listing_link": 2}
        if prev is None or priority.get(candidate["source"], 9) < priority.get(prev.get("source"), 9):
            found[lid] = candidate

    add(probe.get("explicit_relist"), "marketplace_explicit_link")
    for item in probe.get("relist_candidates") or []:
        add(item, item.get("source") or "ended_page_candidate")
    for item in probe.get("listing_links") or []:
        add({"url": item.get("url"), "listing_id": item.get("listing_id"), "anchor_text": item.get("text")}, "diagnostic_listing_link")

    return list(found.values())


def collect_candidate_matches(parent: dict, parent_obs: dict, probe: dict, headless: bool):
    parent_id = str(parent.get("listing_id") or "")
    candidates = candidate_urls_from_probe(probe, parent_id)
    scored = []
    diagnostics = []
    for cand in candidates[:12]:
        url = cand.get("url")
        if not url:
            continue
        raw, child_probe = collect_candidate_raw(url, headless)
        actual = ""
        if raw:
            actual = str(raw.get("listing_id") or marketplace_listing_id(raw.get("final_url")) or "")
        elif child_probe:
            actual = str(marketplace_listing_id(child_probe.get("final_url")) or cand.get("listing_id") or "")
        if not actual or actual == parent_id:
            continue
        if not raw:
            diagnostics.append({
                "listing_id": actual,
                "source": cand.get("source"),
                "error": "candidate loaded but structured listing fields were unavailable",
                "final_url": (child_probe or {}).get("final_url"),
                "body_length": (child_probe or {}).get("body_length"),
            })
            continue
        cl = candidate_listing(raw)
        cl["listing_id"] = actual
        m = compare_relist(cl, {**raw, "raw_snapshot": raw}, parent, parent_obs, method=cand.get("source") or "bulk_probe")
        scored.append(({"listing": cl, "raw": raw, "candidate": cand}, m))
        diagnostics.append({"listing_id": actual, "source": cand.get("source"), **m.to_dict()})
    best, ranked = pick_best_relist(scored)
    return diagnostics, best, ranked


def scan_one(db, listing: dict, parent_obs: dict, apply: bool, headless: bool, debug_all: bool) -> dict:
    parent_id = str(listing.get("listing_id") or "")
    probe = tolerant_probe(listing["url"], headless=headless)
    debug_paths = snapshot_probe(probe, parent_id, force=debug_all)
    print_probe_diagnostic(probe, debug_paths)

    raw = probe.get("collector_raw") or {}
    observed_id = str(raw.get("listing_id") or marketplace_listing_id(probe.get("final_url")) or "")
    result = {
        "listing_id": parent_id,
        "title": listing.get("title"),
        "previous_close_date": parent_obs.get("close_date"),
        "observed_id": observed_id or None,
        "observed_url": probe.get("final_url"),
        "body_length": probe.get("body_length"),
        "listing_ids_found": probe.get("listing_ids_found") or [],
        "debug_paths": debug_paths,
        "applied": False,
    }

    # 1) The old URL itself now redirects to a different listing ID.
    if observed_id and observed_id != parent_id:
        result.update({
            "decision": "RELIST_CONFIRMED",
            "method": "marketplace_redirect",
            "confidence": 1.0,
            "successor_listing_id": observed_id,
            "new_views": raw.get("views"),
        })
        if apply and raw:
            applied = detect_relist_from_capture(listing, raw, db, headless)
            result["applied"] = bool(applied and applied.get("listing_id"))
            result["production_result"] = applied
        return result

    old_close = parse_iso(parent_obs.get("close_date"))
    new_close = parse_iso(raw.get("close_date"))

    # 2) Same ID re-opened after expiry with a fresh future close time.
    if (
        old_close and old_close <= now_utc()
        and observed_id == parent_id
        and new_close and new_close > now_utc()
        and raw and not effective_ended(raw)
    ):
        result.update({
            "decision": "RELIST_CONFIRMED",
            "method": "same_marketplace_id_reopened",
            "confidence": 1.0,
            "successor_listing_id": parent_id,
            "new_views": raw.get("views"),
            "new_close_date": raw.get("close_date"),
        })
        if apply:
            if str(listing.get("lifecycle_state") or "active") == "active":
                db.table("listings").update({
                    "active": False,
                    "lifecycle_state": "relist_watch",
                    "finalized_at": parent_obs.get("close_date") or parent_obs.get("captured_at"),
                    "closure_reason": "expired before same-ID relist detection",
                    "cadence_reason": "expired · relist audit",
                }).eq("id", listing["id"]).execute()
                listing = {**listing, "active": False, "lifecycle_state": "relist_watch"}
            save_success(listing, raw)
            result["applied"] = True
        return result

    # 3) An explicit marketplace relist link with a different concrete listing ID is deterministic.
    explicit = probe.get("explicit_relist")
    explicit_id = str((explicit or {}).get("listing_id") or marketplace_listing_id((explicit or {}).get("url")) or "")
    if explicit and explicit_id and explicit_id != parent_id:
        result.update({
            "decision": "RELIST_CONFIRMED",
            "method": "marketplace_explicit_link",
            "confidence": 1.0,
            "successor_listing_id": explicit_id,
        })
        if apply:
            # Production detector gets the same explicit evidence even if the ended page had no normal fields.
            synthetic = dict(raw)
            synthetic.setdefault("listing_id", parent_id)
            synthetic.setdefault("final_url", probe.get("final_url") or listing.get("url"))
            synthetic["listing_ended"] = True
            synthetic["explicit_relist"] = explicit
            synthetic["relist_candidates"] = probe.get("relist_candidates") or []
            applied = detect_relist_from_capture(listing, synthetic, db, headless)
            result["applied"] = bool(applied and applied.get("listing_id"))
            result["production_result"] = applied
        return result

    # 4) Probe candidate listing links and require COBALT's conservative semantic matcher.
    diagnostics, best, ranked = collect_candidate_matches(listing, parent_obs, probe, headless)
    result["candidate_diagnostics"] = diagnostics
    if best:
        bundle, match = best
        result.update({
            "decision": "RELIST_CONFIRMED",
            "method": "ended_page_semantic",
            "confidence": match.score,
            "successor_listing_id": bundle["listing"].get("listing_id"),
            "match_reasons": match.reasons,
        })
        if apply:
            synthetic = dict(raw)
            synthetic.setdefault("listing_id", parent_id)
            synthetic.setdefault("final_url", probe.get("final_url") or listing.get("url"))
            synthetic["listing_ended"] = True
            synthetic["relist_candidates"] = [d for d in candidate_urls_from_probe(probe, parent_id)]
            applied = detect_relist_from_capture(listing, synthetic, db, headless)
            result["applied"] = bool(applied and applied.get("listing_id"))
            result["production_result"] = applied
        return result

    # If IDs were visible but none could be semantically confirmed, surface them prominently.
    result.update({
        "decision": "NO_SUCCESSOR_FOUND",
        "method": "none",
        "confidence": 0.0,
        "unconfirmed_listing_ids": probe.get("listing_ids_found") or [],
    })
    if ranked:
        result["ranked_candidates"] = [
            {"listing_id": bundle["listing"].get("listing_id"), **match.to_dict()}
            for bundle, match in ranked[:10]
        ]
    return result


def main():
    ap = argparse.ArgumentParser(description="Bulk-audit expired COBALT listings for relists")
    ap.add_argument("--apply", action="store_true", help="write confirmed relist lineage to Supabase")
    ap.add_argument("--all", action="store_true", help="scan all eligible listings, not only expired/relist-watch rows")
    ap.add_argument("--listing-id", action="append", default=[], help="only scan this marketplace listing ID (repeatable)")
    ap.add_argument("--limit", type=int, default=0, help="maximum candidates to scan (0 = no explicit limit)")
    ap.add_argument("--headful", action="store_true", help="show the browser while probing")
    ap.add_argument("--debug-all", action="store_true", help="save JSON + HTML for every probe, not only abnormal/short pages")
    ap.add_argument("--json", dest="json_path", help="write full audit results to a JSON file")
    args = ap.parse_args()

    load_dotenv(HERE / ".env")
    load_dotenv(HERE.parent / "web" / ".env.local")
    db = client()
    now = now_utc()

    listings = paged(db.table("listings"), "*")
    latest = latest_observation_map(db)
    wanted = {str(x) for x in args.listing_id}

    candidates = []
    for listing in listings:
        mid = str(listing.get("listing_id") or "")
        if wanted and mid not in wanted:
            continue
        if listing.get("relist_successor_uuid") or str(listing.get("lifecycle_state") or "") == "relisted":
            continue
        obs = latest.get(str(listing.get("id") or "")) or {}
        close_dt = parse_iso(obs.get("close_date"))
        state = str(listing.get("lifecycle_state") or "active")
        expired = bool(close_dt and close_dt <= now)
        watch = state in {"relist_watch", "terminal_closed"}
        if args.all or wanted or expired or watch:
            candidates.append((listing, obs, expired, watch))

    candidates.sort(key=lambda x: (
        0 if x[2] else 1,
        str((x[1] or {}).get("close_date") or "9999"),
        str(x[0].get("listing_id") or ""),
    ))
    if args.limit > 0:
        candidates = candidates[: args.limit]

    print("COBALT BULK RELIST AUDIT V2")
    print("===========================")
    print(f"Mode:              {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Listings loaded:   {len(listings)}")
    print(f"Candidates:        {len(candidates)}")
    print(f"Selection:         {'all eligible' if args.all else 'expired / relist-watch'}")
    print(f"Diagnostics:       {'all probes' if args.debug_all else 'automatic on abnormal/short pages'}")
    print()

    results = []
    confirmed = errors = 0
    for index, (listing, obs, expired, watch) in enumerate(candidates, 1):
        mid = str(listing.get("listing_id") or "")
        print(f"[{index}/{len(candidates)}] #{mid} · {listing.get('title') or ''}")
        print(f"  latest close: {obs.get('close_date') or 'unknown'} · expired={expired} · state={listing.get('lifecycle_state')}")
        try:
            result = scan_one(db, listing, obs, args.apply, not args.headful, args.debug_all)
            results.append(result)
            if result.get("decision") == "RELIST_CONFIRMED":
                confirmed += 1
            print(f"  decision:     {result.get('decision')}")
            if result.get("successor_listing_id"):
                print(f"  successor:    #{result.get('successor_listing_id')}")
            if result.get("method"):
                print(f"  method:       {result.get('method')}")
            if result.get("confidence") is not None:
                print(f"  confidence:   {float(result.get('confidence') or 0)*100:.1f}%")
            if result.get("match_reasons"):
                print(f"  reasons:      {'; '.join(result.get('match_reasons') or [])}")
            if result.get("unconfirmed_listing_ids"):
                print(f"  unconfirmed:  {', '.join(result['unconfirmed_listing_ids'][:20])}")
            if args.apply:
                print(f"  applied:      {result.get('applied')}")
        except KeyboardInterrupt:
            print("\nInterrupted by user.")
            raise
        except Exception as e:
            errors += 1
            result = {
                "listing_id": mid,
                "decision": "ERROR",
                "error_type": getattr(e, "error_type", e.__class__.__name__),
                "error": str(e),
            }
            results.append(result)
            print(f"  ERROR: {result['error_type']}: {result['error']}")
        print()

    summary = {
        "mode": "apply" if args.apply else "dry_run",
        "scanned": len(candidates),
        "confirmed": confirmed,
        "errors": errors,
        "generated_at": now_utc().isoformat(),
    }
    print("SUMMARY")
    print("=======")
    print(json.dumps(summary, indent=2))

    if args.json_path:
        path = Path(args.json_path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"summary": summary, "results": results}, indent=2, default=str), encoding="utf-8")
        print(f"Full results: {path}")


if __name__ == "__main__":
    main()
