const NZ_TIME_ZONE = 'Pacific/Auckland';
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function nzParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const out: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return {year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second};
}

function localNzToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  // Two passes are enough to settle NZST/NZDT even around a daylight-saving boundary.
  for (let i = 0; i < 2; i++) {
    const p = nzParts(new Date(guess));
    const renderedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
    const offset = renderedAsUtc - guess;
    guess = desired - offset;
  }
  return new Date(guess);
}

function parseClock(hourText: string, minuteText: string | undefined, meridiem: string | undefined) {
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase() === 'pm';
    if (hour === 12) hour = 0;
    if (pm) hour += 12;
  } else if (hour < 0 || hour > 23) return null;
  return {hour, minute};
}

/**
 * Normalize a marketplace close date to ISO UTC.
 *
 * Trade Me commonly exposes human NZ-local strings such as
 * "Sun 6 Sep, 8:30pm". Browser Date parsing of those strings is inconsistent,
 * so manual captures used to lose close_date even though the worker could parse it.
 */
export function normalizeMarketplaceCloseDate(value: unknown, now: Date = new Date()): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(/^closes:\s*/i, '').replace(/(\d+)(st|nd|rd|th)\b/gi, '$1').trim();

  // ISO / RFC / otherwise unambiguous date strings should stay exact.
  if (/\d{4}/.test(text) || /T\d{2}:\d{2}/i.test(text)) {
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  }

  const nowNz = nzParts(now);
  const relative = text.match(/^(today|tomorrow)\s*,?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (relative) {
    const clock = parseClock(relative[2], relative[3], relative[4]);
    if (!clock) return null;
    const baseNoon = localNzToUtc(nowNz.year, nowNz.month, nowNz.day, 12, 0);
    const base = nzParts(new Date(baseNoon.getTime() + (relative[1].toLowerCase() === 'tomorrow' ? 86400000 : 0)));
    return localNzToUtc(base.year, base.month, base.day, clock.hour, clock.minute).toISOString();
  }

  // Optional weekday, optional explicit year, 12h or 24h clock.
  const m = text.match(/^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s*,?\s*)?(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\s*,?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const clock = parseClock(m[4], m[5], m[6]);
  if (!month || !clock || day < 1 || day > 31) return null;

  let year = m[3] ? Number(m[3]) : nowNz.year;
  let candidate = localNzToUtc(year, month, day, clock.hour, clock.minute);
  if (Number.isNaN(candidate.getTime())) return null;

  // Marketplace close dates without a year are near-future dates. Around New Year,
  // e.g. a December capture may show "2 Jan"; advance the inferred year if the
  // current-year interpretation is already materially in the past.
  if (!m[3] && candidate.getTime() < now.getTime() - 48 * 3600_000) {
    candidate = localNzToUtc(year + 1, month, day, clock.hour, clock.minute);
  }
  return candidate.toISOString();
}
