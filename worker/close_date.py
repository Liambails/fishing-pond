"""Trade Me close-date normalization shared by worker lifecycle logic and backfills.

Trade Me renders NZ-local close timestamps in several small variants, for example:
  Wed 9 Sep, 4:00 pm
  Tue 8th Sep, 6:20pm
  Closed: Mon 7th Sep, 9:54am
  8:30pm, Sun 6 Sep

The marketplace omits the year for near-term listings. We infer it from the capture
instant in Pacific/Auckland and only roll into the next year when the inferred date
would otherwise be materially in the past.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import re

NZ = ZoneInfo("Pacific/Auckland")
MONTHS = {
    'jan':1,'january':1,'feb':2,'february':2,'mar':3,'march':3,'apr':4,'april':4,
    'may':5,'jun':6,'june':6,'jul':7,'july':7,'aug':8,'august':8,
    'sep':9,'sept':9,'september':9,'oct':10,'october':10,'nov':11,'november':11,
    'dec':12,'december':12,
}
PREFIX_RE = re.compile(r'^\s*(?:(?:auction|listing)\s+)?(?:closed|closing|closes?|ended|ending|ends?)\s*:?\s*', re.I)
ORDINAL_RE = re.compile(r'(\d+)(?:st|nd|rd|th)\b', re.I)
WEEKDAY = r'(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s*,?\s*)?'
MONTH = r'([a-z]{3,9})'
TIME = r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?'
DATE_FIRST_RE = re.compile(rf'^{WEEKDAY}(\d{{1,2}})\s+{MONTH}(?:\s+(\d{{4}}))?\s*,?\s*{TIME}$', re.I)
TIME_FIRST_RE = re.compile(rf'^{TIME}\s*,?\s*{WEEKDAY}(\d{{1,2}})\s+{MONTH}(?:\s+(\d{{4}}))?$', re.I)
RELATIVE_RE = re.compile(rf'^(today|tomorrow)\s*,?\s*{TIME}$', re.I)


def _as_datetime(value) -> datetime:
    if isinstance(value, datetime):
        dt=value
    elif value:
        try:
            dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        except Exception:
            dt=datetime.now(timezone.utc)
    else:
        dt=datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt=dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _clock(hour_text, minute_text, meridiem):
    try:
        hour=int(hour_text); minute=int(minute_text or 0)
    except Exception:
        return None
    if not 0 <= minute <= 59:
        return None
    if meridiem:
        if not 1 <= hour <= 12:
            return None
        if hour == 12: hour = 0
        if str(meridiem).lower() == 'pm': hour += 12
    elif not 0 <= hour <= 23:
        return None
    return hour,minute


def _build(day, month_name, year_text, hour_text, minute_text, meridiem, reference):
    month=MONTHS.get(str(month_name).lower())
    clock=_clock(hour_text, minute_text, meridiem)
    if not month or not clock:
        return None
    ref_nz=_as_datetime(reference).astimezone(NZ)
    year=int(year_text) if year_text else ref_nz.year
    try:
        candidate=datetime(year, month, int(day), clock[0], clock[1], tzinfo=NZ)
    except Exception:
        return None
    # No-year marketplace dates are near the capture date. Around New Year, advance a
    # candidate that is already >48h behind the capture. Do not mutate explicit years.
    if not year_text and candidate.astimezone(timezone.utc) < _as_datetime(reference)-timedelta(days=180):
        try:
            candidate=candidate.replace(year=year+1)
        except ValueError:
            return None
    return candidate.astimezone(timezone.utc).isoformat()


def normalize_close_date(value, reference=None):
    if value is None:
        return None
    text=str(value).strip()
    if not text:
        return None
    text=PREFIX_RE.sub('', text)
    text=ORDINAL_RE.sub(r'\1', text)
    text=re.sub(r'\s+', ' ', text).strip(' ,')

    # ISO/RFC/unambiguous values with an explicit year first.
    if re.search(r'\d{4}', text) or re.search(r'T\d{2}:\d{2}', text, re.I):
        try:
            dt=datetime.fromisoformat(text.replace('Z','+00:00'))
            if dt.tzinfo is None: dt=dt.replace(tzinfo=NZ)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception:
            # Continue to human-form parsing below; explicit-year Trade Me strings are not ISO.
            pass

    rel=RELATIVE_RE.match(text)
    if rel:
        clock=_clock(rel.group(2), rel.group(3), rel.group(4))
        if not clock: return None
        base=_as_datetime(reference).astimezone(NZ)
        if rel.group(1).lower() == 'tomorrow':
            base=base+timedelta(days=1)
        return datetime(base.year,base.month,base.day,clock[0],clock[1],tzinfo=NZ).astimezone(timezone.utc).isoformat()

    m=DATE_FIRST_RE.match(text)
    if m:
        # day, month, year, hour, minute, meridiem
        return _build(m.group(1),m.group(2),m.group(3),m.group(4),m.group(5),m.group(6),reference)

    m=TIME_FIRST_RE.match(text)
    if m:
        # hour, minute, meridiem, day, month, year
        return _build(m.group(4),m.group(5),m.group(6),m.group(1),m.group(2),m.group(3),reference)

    return None


def closure_timing_evidence(history, captured_at, sold_detected=False):
    """Describe whether a confirmed sale/closure happened before the last advertised close."""
    closed=_as_datetime(captured_at)
    scheduled=None
    for row in sorted(list(history or []), key=lambda x: str(x.get('captured_at') or ''), reverse=True):
        seen=_as_datetime(row.get('captured_at')) if row.get('captured_at') else None
        try:
            candidate=datetime.fromisoformat(str(row.get('close_date')).replace('Z','+00:00')) if row.get('close_date') else None
            if candidate and candidate.tzinfo is None: candidate=candidate.replace(tzinfo=timezone.utc)
        except Exception:
            candidate=None
        if not candidate or not seen or seen >= closed-timedelta(seconds=1):
            continue
        if candidate > closed+timedelta(minutes=5):
            scheduled=candidate.astimezone(timezone.utc)
            break
    early=bool(scheduled and closed < scheduled-timedelta(minutes=5))
    minutes_early=round((scheduled-closed).total_seconds()/60,1) if early and scheduled else 0
    return {
        'scheduled_close_date': scheduled.isoformat() if scheduled else None,
        'observed_closed_at': closed.isoformat(),
        'closed_before_scheduled_close': early,
        'sold_early': bool(early and sold_detected),
        'minutes_early': minutes_early if early else 0,
        'early_close_is_demand_signal': bool(early and sold_detected),
    }
