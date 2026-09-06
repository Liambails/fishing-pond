# COBALT — release history

This is a compact engineering history. Current behavior belongs in the maintained system/algorithm/operations docs rather than in release-note sprawl.

## V3.9.8 — Scheduler Activity + First-Capture Close Dates

- Automation Health now distinguishes the last successful collection worker from the latest scheduler heartbeat.
- The Last successful worker cell includes a subdued status pill showing the latest scheduler activity in NZ time, with healthy/delayed/stale wording derived from scheduler health.
- Manual Chrome-extension ingestion now normalizes Trade Me human close-date strings in Pacific/Auckland instead of relying on inconsistent JavaScript Date parsing.
- A newly queued listing can therefore retain its expiry/close date on observation #1 when Trade Me exposes it; it no longer has to wait for the automatic worker parser on a later observation.
- Explicit Relist Successor Discovery from V3.9.7 is retained unchanged.
- No database migration is required.

## V3.9.7 — Explicit Relist Successor Discovery

- Closed listing checks now inspect ordinary marketplace anchors for explicit relist/successor wording.
- Only a valid Trade Me listing URL with a different marketplace listing ID is accepted; seller-side relist action URLs, same-ID links, external hosts, and ambiguous links are rejected.
- Marketplace-explicit successor relationships are registered at confidence 1.0 and outrank heuristic new-ID matching.
- New successors are created idempotently in the same listing family and immediately receive one normal collection attempt.
- If that destination presents CAPTCHA/access/human-verification/unusual-traffic, COBALT does not bypass it: the successor is paused and surfaced as an open collection issue for manual browser recovery.
- Existing successor rows are never force-reactivated by the parent, preserving manual-recovery pauses and normal scheduling.
- Once an explicit successor is registered, the old URL is retired from relist polling.
- Added deterministic tests for relist wording variants, host/ID validation, same-ID/action rejection, and candidate preference.

## V3.9.6 — Structured Comparable Identity

- Added family -> subtype -> role/position automotive identity.
- Added description-aware role extraction.
- Subtype conflicts became hard rejects.
- Kept cosine and price as supporting evidence only.
- Added component-level matcher trace and durable `Not comparable` overrides.
- Reconciliation removes stale automatic links after stronger matcher decisions.
- Migration 012.

## V3.9.5 — Relist Lifecycle + Matcher Trace

- Closed listings enter sparse relist watch instead of disappearing permanently.
- Same-ID and new-ID relists gain lifecycle lineage/episodes.
- Matcher decisions are logged/persisted and exportable.
- Automatic worker requests live matcher reconciliation after successful observation.
- Migration 011.

## V3.9.4 — Scheduler Forensics

- Added durable `scheduler_runs` telemetry and dependency-free wake heartbeat.
- Added stage-level scheduler failure reporting, system events, GitHub diagnostic artifacts and Automation Health UI.
- Migration 010.

## V3.9.3 — Resilient Worker Bootstrap

- Added dependency-install retries, import verification and repeated due-preflight retries.
- Chromium remains conditional on due work/manual dispatch.

## V3.9.2 — Similarity-weighted Pricing

- Accepted comparables influence pricing according to match confidence.
- Added weighted median and weighted 20th–80th percentile market range.
- Suggested test price uses the weighted market anchor.

## V3.9 — Comparable Market Engine

- Added deterministic hybrid comparable matching, blocking/gates, structured identity evidence, cosine support, review queue and match provenance.
- Migration 009.

## V3.5.x — Signal confirmation and recovery

- Hardened `GOOD`/`MUST_HAVE` evidence requirements.
- Added negative view-counter anomaly protection.
- Added ordinary failure backoff and immediate challenge pause behavior.

## V3.4 — Adaptive observation + recovery

- Added 6/8/12/24h adaptive cadence and lifecycle finalization foundations.
- Added marketplace identity registry with Trade Me enabled and eBay identity recognition only.
- Migration 008.

## V3.3 — Supplier CRM

- Added supplier contact/quote/sample/lead-time/landed-cost fields.
- Migration 007.

## V3.1–V3.2 — Product lifecycle / CRM

- Added product lifecycle, own listings, soft archive and richer Product CRM fields.
- Migrations 005–006.

## V2.x — Cloud-backed foundation and attention engine

- Preserved V1.5.2 collector logic while adding Supabase persistence, Vercel dashboard/API, Chrome cloud capture, Playwright scheduled observations, product intelligence, interventions, AI summary foundations and lifecycle-aware queue scoring.
