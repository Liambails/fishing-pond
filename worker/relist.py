from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
import math
import re
from typing import Any, Iterable

_WORD_RE = re.compile(r"[a-z0-9]+", re.I)
_CODE_RE = re.compile(r"\b(?=[A-Z0-9._/-]{3,20}\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9]+(?:[-_/\.][A-Z0-9]+)*\b", re.I)
_STOP = set("the a an for with and to of in on from fits fit compatible replacement genuine oem new used part parts item listing sale auction".split())


def _norm(v: Any) -> str:
    return " ".join(_WORD_RE.findall(str(v or "").lower()))


def _tokens(v: Any) -> set[str]:
    return {x for x in _norm(v).split() if len(x) > 1 and x not in _STOP}


def _jaccard(a: Iterable[str], b: Iterable[str]) -> float:
    aa, bb = set(a), set(b)
    if not aa or not bb:
        return 0.0
    return len(aa & bb) / len(aa | bb)


def _seq(a: Any, b: Any) -> float:
    aa, bb = _norm(a), _norm(b)
    if not aa or not bb:
        return 0.0
    return SequenceMatcher(None, aa, bb).ratio()


def _category(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_norm(x) for x in value if _norm(x)]
    if isinstance(value, str):
        return [_norm(x) for x in re.split(r"[>/|]", value) if _norm(x)]
    return []


def _category_similarity(a: Any, b: Any) -> float:
    aa, bb = _category(a), _category(b)
    if not aa or not bb:
        return 0.0
    prefix = 0
    for x, y in zip(aa, bb):
        if x != y:
            break
        prefix += 1
    prefix_score = prefix / max(len(aa), len(bb))
    set_score = _jaccard(aa, bb)
    return max(prefix_score, set_score)


def _identifier_values(listing: dict, obs: dict) -> set[str]:
    vals: list[str] = []
    raw = (obs or {}).get("raw_snapshot") or {}
    for src in (listing or {}, obs or {}, raw):
        for key in ("part_number", "seller_sku", "chassis", "chassis_code_label", "engine_code", "engine_code_label", "model", "model_label"):
            if src.get(key):
                vals.append(str(src.get(key)))
        for key in ("part_number_candidates", "qa_identity_codes"):
            if isinstance(src.get(key), list):
                vals.extend(str(x) for x in src.get(key) if x)
    for text in ((listing or {}).get("title"), raw.get("listing_title"), raw.get("description")):
        vals.extend(_CODE_RE.findall(str(text or "")))
    out = set()
    for v in vals:
        n = re.sub(r"[^a-z0-9]", "", v.lower())
        if len(n) >= 3 and not re.fullmatch(r"20\d\d", n):
            out.add(n)
    return out


def _price(obs: dict) -> float | None:
    raw = (obs or {}).get("raw_snapshot") or {}
    for src in (obs or {}, raw):
        for key in ("buy_now_nzd", "asking_price_nzd", "starting_price_nzd", "current_bid_nzd"):
            try:
                v = src.get(key)
                if v is not None and math.isfinite(float(v)):
                    return float(v)
            except Exception:
                pass
    return None


def _iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


@dataclass
class RelistMatch:
    match: bool
    score: float
    method: str
    reasons: list[str]
    title_similarity: float = 0.0
    token_overlap: float = 0.0
    category_similarity: float = 0.0
    description_similarity: float = 0.0
    identifier_overlap: list[str] | None = None
    timing_hours: float | None = None
    ambiguous: bool = False

    def to_dict(self):
        d = asdict(self)
        d["identifier_overlap"] = d.get("identifier_overlap") or []
        return d


def compare_relist(candidate_listing: dict, candidate_obs: dict, parent_listing: dict, parent_obs: dict, method: str = "semantic") -> RelistMatch:
    """Conservative, category-agnostic relist comparison.

    Seller identity is a hard gate for semantic matches. Marketplace-provided redirect/explicit
    relist links should be registered by callers as deterministic evidence instead of relying on
    this score. Missing price never counts against the match.
    """
    cs = _norm((candidate_listing or {}).get("seller") or (candidate_obs or {}).get("seller") or ((candidate_obs or {}).get("raw_snapshot") or {}).get("seller"))
    ps = _norm((parent_listing or {}).get("seller") or (parent_obs or {}).get("seller") or ((parent_obs or {}).get("raw_snapshot") or {}).get("seller"))
    if not cs or not ps:
        return RelistMatch(False, 0.0, method, ["seller identity missing"])
    if cs != ps:
        return RelistMatch(False, 0.0, method, ["seller differs"])

    ct = (candidate_listing or {}).get("title") or ((candidate_obs or {}).get("raw_snapshot") or {}).get("listing_title") or ""
    pt = (parent_listing or {}).get("title") or ((parent_obs or {}).get("raw_snapshot") or {}).get("listing_title") or ""
    title_sim = _seq(ct, pt)
    tok = _jaccard(_tokens(ct), _tokens(pt))

    craw = (candidate_obs or {}).get("raw_snapshot") or {}
    praw = (parent_obs or {}).get("raw_snapshot") or {}
    cm=(candidate_listing or {}).get("metadata") if isinstance((candidate_listing or {}).get("metadata"),dict) else {}
    pm=(parent_listing or {}).get("metadata") if isinstance((parent_listing or {}).get("metadata"),dict) else {}
    cc = cm.get("category_path") or craw.get("category_path")
    pc = pm.get("category_path") or praw.get("category_path")
    cat = _category_similarity(cc, pc)
    desc = _seq(craw.get("description"), praw.get("description"))
    ids = sorted(_identifier_values(candidate_listing, candidate_obs) & _identifier_values(parent_listing, parent_obs))

    reasons = ["same seller"]
    score = 0.30
    score += title_sim * 0.22
    score += tok * 0.16
    score += cat * 0.10
    score += min(0.08, desc * 0.08)
    if title_sim >= 0.72:
        reasons.append(f"title similarity {title_sim:.2f}")
    if tok >= 0.55:
        reasons.append(f"title token overlap {tok:.2f}")
    if cat >= 0.50:
        reasons.append(f"category overlap {cat:.2f}")
    if desc >= 0.55:
        reasons.append(f"description similarity {desc:.2f}")
    if ids:
        score += 0.18
        reasons.append("shared identifier " + ", ".join(ids[:3]))

    cp, pp = _price(candidate_obs), _price(parent_obs)
    if cp is not None and pp is not None and max(cp, pp) > 0:
        diff = abs(cp - pp) / max(cp, pp)
        if diff <= 0.15:
            score += 0.05
            reasons.append("price within 15%")
        elif diff > 0.65:
            score -= 0.04
            reasons.append("large price change")

    parent_end = _iso((parent_listing or {}).get("finalized_at")) or _iso((parent_obs or {}).get("close_date"))
    candidate_start = _iso((candidate_obs or {}).get("captured_at")) or datetime.now(timezone.utc)
    timing_hours = None
    if parent_end:
        timing_hours = (candidate_start - parent_end).total_seconds() / 3600
        if timing_hours < -2:
            return RelistMatch(False, 0.0, method, ["candidate predates parent closure"], title_sim, tok, cat, desc, ids, timing_hours)
        if timing_hours <= 48:
            score += 0.06
            reasons.append("appeared within 48h of closure")
        elif timing_hours <= 14 * 24:
            score += 0.03
            reasons.append("appeared within 14 days of closure")

    score = max(0.0, min(1.0, score))
    # Two ways to auto-confirm: a very strong general match, or strong identifier evidence with
    # a still-respectable title/category match. This avoids vehicle-only assumptions.
    strong_identity = bool(ids) and title_sim >= 0.55 and (cat >= 0.35 or tok >= 0.45)
    match = score >= 0.82 or (strong_identity and score >= 0.76)
    return RelistMatch(match, round(score, 4), method, reasons, round(title_sim, 4), round(tok, 4), round(cat, 4), round(desc, 4), ids, None if timing_hours is None else round(timing_hours, 2))


def pick_best_relist(matches: list[tuple[dict, RelistMatch]], ambiguity_margin: float = 0.08):
    ranked = sorted(matches, key=lambda x: x[1].score, reverse=True)
    if not ranked:
        return None, []
    candidate, best = ranked[0]
    if not best.match:
        return None, ranked
    if len(ranked) > 1 and ranked[1][1].score >= best.score - ambiguity_margin:
        best.ambiguous = True
        best.match = False
        best.reasons.append(f"ambiguous: next candidate is within {ambiguity_margin:.2f}")
        return None, ranked
    return (candidate, best), ranked
