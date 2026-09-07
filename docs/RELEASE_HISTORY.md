# COBALT — release history

## V3.9.15 — Standalone Opportunity Signals

- Opportunity detection now supports **standalone product signals** for listings that do not yet have a reliable comparable product family.
- Standalone qualification is intentionally stricter than cross-listing qualification: at least 4 independent evidence windows, at least 30 hours of evidence span, a fully trusted 12h+ recent velocity interval, confidence at least 60, trusted velocity at least 6/day, and at least one unusually strong behaviour signal (buyer intent, watchers, bids, purchase-intent Q&A, explicit sold evidence, or exceptional velocity).
- `STRONG` standalone signals require deeper evidence: at least 5 independent windows, at least 48 hours of span, confidence at least 72, velocity at least 8/day, marketplace demand score at least 72, plus exceptional intent/velocity evidence.
- Standalone signals use the same durable bell inbox and the same **Keep watching / Find supplier / Dismiss** workflow as corroborated opportunities.
- The modal clearly states that no reliable comparable family exists yet and labels the signal as **STANDALONE** so one active listing is never presented as proof of a broad market.
- Material standalone strengthening is re-notified only when evidence meaningfully deepens (strength change, +2 independent windows, +12 demand score, a new bid, +2 purchase-intent questions, or first explicit sold evidence).
- Existing cross-listing opportunity logic remains unchanged and takes precedence whenever a qualifying comparable family exists.
- Migration `015_standalone_opportunity_signals.sql` adds the additive `opportunity_type` classification to existing opportunity records; historical opportunities default to `corroborated`.
- User-facing Observation Queue wording remains **In 'My Products'** while the internal queue-state value continues to be `promoted` for backward compatibility.

## V3.9.14 — Observation Queue wording cleanup

- Renamed the user-facing `Promoted` state to **In 'My Products'** throughout the Observation Queue so it describes what actually happened rather than implying a stronger market signal.
- Moved the **IN 'MY PRODUCTS'** pill below the listing ID for clearer row hierarchy.
- The internal/database-compatible queue state remains `promoted`; this is an implementation detail only.
- No database migration is required.

## V3.9.13 — Marketplace Intent + Q&A Intelligence + Listing Drafts

- Trade Me collection now records additional behavioural signals when publicly exposed: watchers, bids, public Q&A count/content, purchase-intent questions, compatibility questions, condition questions, Buy Now availability, offer-action availability, stock quantity labels, explicit sold state and listing status.
- Public Q&A is stored as evidence, not treated as generic sentiment. Buyer questions are classified conservatively into purchase-intent, compatibility and condition/risk categories; buyer questions never become confirmed product facts by themselves.
- Q&A identifiers can support product-family identity/clustering when code-like values recur, while exact part numbers/fitment remain evidence-backed and are never invented.
- Listing attention now uses a bounded buyer-intent/engagement component where bids, watchers and purchase-intent questions carry more weight than passive views. Explicit sold evidence is strongest but only when Trade Me states it directly.
- Product demand scoring now combines trusted view movement with buyer-intent evidence, purchase-intent questions and explicit sold confirmations. Views remain attention, not sales.
- Opportunity signals now store a marketplace demand score, median buyer-intent score, Q&A totals, watchers, bids and sold confirmations. These signals can strengthen a sourcing recommendation across a corroborated product family.
- Automatic cadence can shorten when new bids, public questions or purchase-intent questions appear, so strong behavioural evidence is re-observed sooner.
- Added persistent `product_listing_drafts` for Trade Me. A My Product can generate original title, description, condition wording and category-adaptive item specifics once, then regenerate individual fields without replacing the other fields.
- Listing-draft AI uses tracked competitor titles/descriptions, structured identifiers and public Q&A as factual evidence but is explicitly forbidden from copying competitor wording or inventing compatibility/condition/specifications.
- Migration `014_marketplace_signal_intelligence.sql` is additive and extends observations plus adds persistent product listing drafts.

## V3.9.11 — Observation Decision Inbox + UI Layering

- Observation Queue now defaults to **Active** unresolved research rather than every listing ever observed.
- Added queue states: **Active**, internal `promoted`, **Dismissed**, and **All**. The current UI labels the internal promoted state as **In 'My Products'**; these candidates are preserved but removed from the active decision inbox.
- Added **Dismiss selected** and **Restore selected** actions without deleting observation history.
- Creating or auto-promoting a product records the source listing as promoted and retains the product link/provenance.
- Default queue order is **Most promising**, using signal strength, confidence, trusted velocity, independent evidence depth, and recent view growth. Optional Velocity, Confidence, and Newest orders remain available.
- Added queue counters for Active, Promising, In 'My Products', and Dismissed research.
- Information popovers now render through a document-level portal, preventing clipping beneath scroll containers or sticky table headers.
- My Products and Observation Queue now share the same sticky table-header viewport behavior.
- Queue lifecycle metadata uses the existing `listings.metadata` JSONB field; **no database migration is required**.

## V3.9.10 — Capture Stabilization + Observation Episodes

- Chrome capture now retries Trade Me view extraction across several render windows before submitting a partial capture.
- Trade Me view extraction now supports additional semantic containers, labelled accessibility/title values, and conservative explicit `views` text patterns without treating arbitrary page numbers as views.
- Rapid same-source captures inside a 3-minute window are coalesced into one database observation episode when the capture is complete; the freshest values win and compact raw samples remain in `_capture_episode` diagnostics.
- Coalesced captures no longer advance the learning cadence or inflate raw observation depth.
- Source-family and listing-ended state changes are never coalesced together.
- Added a seconds-apart `16 → 16 → 19` regression proving that this burst remains `TOO EARLY` with no velocity instead of extrapolating ~18,000 views/day.
- Extension cloud endpoint now defaults to the production `/api/ingest` URL rather than localhost.
- Complete initial manual captures establish durable saved-state metadata: first completion shows `Saved ✓`, revisits show `Already Saved ✓`, and incomplete/partial captures remain retryable rather than disabling the capture action.
- No database migration is required.

This is a compact engineering history. Current behavior belongs in the maintained system/algorithm/operations docs rather than in release-note sprawl.

## V3.9.9 — Temporal Evidence Guardrails

- Raw observation history is preserved, but captures less than 3 hours apart no longer count as separate evidence windows for attention scoring.
- Independent evidence is selected backwards from the freshest capture, so a close manual revisit can update the current view count without inflating evidence depth.
- Recent view velocity from 3–12 hour windows is damped from 35% to 100% trust; 12+ hour windows receive full trust.
- Evidence confidence now grows from independent evidence windows rather than raw capture count, has a 99% ceiling, and exposes compressed-capture diagnostics.
- Standalone `GOOD` requires at least 4 independent evidence windows and a fully trusted (12h+) recent interval; peer-corroborated `GOOD` still requires at least a 6h recent interval.
- Added regression tests for short manual capture bursts, sustained well-spaced trends, and velocity damping.
- No database migration is required.

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

## V3.9.12 — Opportunity Signals and Supplier Research

V3.9.12 adds a durable cross-listing opportunity layer above the Observation Queue.

- Similar listings are clustered into product-family opportunities using category, structured identity evidence, title similarity, product type, model/platform codes and part/reference numbers.
- Only repeated positive evidence is eligible: at least three comparable listings with at least two independent observation windows and positive trusted view velocity.
- Opportunity signals are persisted as `EMERGING` or `STRONG`; views remain an attention signal and are never described as confirmed sales.
- A bell inbox stores opportunity notifications while the dashboard is unattended. Notifications are ordered newest-first and remain until read/dismissed.
- Opportunity actions are independent of the underlying Observation Queue listing labels:
  - **Keep watching** changes only the opportunity lifecycle and continues collection.
  - **Find supplier** moves the opportunity to sourcing, continues observation, and generates supplier search terms plus a copyable supplier enquiry using observed identity anchors.
  - **Dismiss** hides the opportunity from active attention without deleting listings or observations.
- Source identity distinguishes repeated platform/model codes from variant-specific part/reference numbers. Supplier copy explicitly asks the supplier to confirm exact compatibility.
- The existing internal Observation Queue state `promoted` is now labelled **In My Products** in the UI. It means the research listing has already been used to create/link a My Product; it is not a quality or demand judgement.
- The observer workflow scans opportunity signals after successful collection runs so new patterns can be detected even when the dashboard is not open.
- Added additive migration `013_opportunity_signals.sql` with `opportunities`, `opportunity_listings`, and `opportunity_notifications`.
