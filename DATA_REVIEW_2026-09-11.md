# COBALT data review — 2026-09-11

Snapshot reviewed: `COBALT_DB_EXPORTS(9)` exported 2026-09-11 10:10 NZST-equivalent file naming.

## What looks healthy

- 328 listing rows and 2,361 observations are present in the export.
- Recent Playwright collection runs are completing cleanly; the last six exported collection runs attempted 2–13 listings each with zero failures.
- Vintage Ken Doll completed the lifecycle test: the first capture showed 298 views / 19 bids / $48 current bid, and the later capture recorded 383 views with `sold_detected=true` and a parsed close date. This confirms the close/sold path is operating end-to-end.
- The current opportunity gate is now conservative: only two rows in this export are explicitly `currently_qualified=true`, both EARLY_LEADs (Nissan Note Master Power Window Switch and Toyota Corolla Ignition Coil).

## Issue found and fixed in V3.10.13

A legacy manually-started `Toyota Rav4 Door Handle` sourcing row is still visible as SOURCE_NOW even though it predates the family-identity hardening. Its 17 historical links include unrelated quarter glass, fuel door and tailgate-handle listings. The scanner already knows how to avoid creating that contaminated family now, but the reconciliation loop intentionally skipped `status='sourcing'`, so the legacy row never received `currently_qualified=false`.

V3.10.13 preserves the operator's sourcing-history status but marks a sourcing row unqualified when its family no longer qualifies, clears unread notifications, and removes explicitly stale sourcing rows from the live Opportunity/notification surfaces. A currently valid sourcing family remains visible because its scan writes `currently_qualified=true`.

## Before Search Terms

Deploy V3.10.13 and let the scheduled opportunity scan run once. Confirm the legacy RAV4 Source Now card disappears from the live sourcing-opportunity popup. Then the system is in a much cleaner state for scaling Search Terms without loosening thresholds.
