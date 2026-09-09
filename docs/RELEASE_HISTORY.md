# V3.9.21 — Opportunity Scanner Reliability Hotfix

- Grants `service_role` CRUD access to `opportunities`, `opportunity_listings`, and `opportunity_notifications`; migration 013 created these tables without explicit grants, which can make the API scan fail through PostgREST.
- Runs the opportunity scan on every non-duplicate scheduler wake-up, not only when Playwright has due listings.
- Removes silent `continue-on-error` behavior from the opportunity step and records/logs the API response so a failed scan is visible immediately.
- Keeps existing sourcing thresholds unchanged until the scanner is confirmed to materialise leads from the evidence already present.

# V3.9.20 — Generic Marketplace Lifecycle + Listing Evidence Inspector

- Recently ended listings stay on bounded relist watch (1h, 6h, 18h, 48h, 96h within a ten-day window) and the queue now displays the scheduled relist-watch probe instead of misleading `Stopped` text.
- Same-ID relists can be detected even when COBALT misses the transient closed page: an elapsed previous close followed by a new future close is strong lifecycle evidence; view/bid/watcher resets are corroborating signals and never sole triggers.
- Explicit marketplace relist links are scanned on every capture and new-ID redirects/`/listing/<id>` successor links remain authoritative lineage evidence.
- Added migration 018: `products.part_type` is nullable; observations gain `description`, `category_path`, `primary_image_url`, and generic `marketplace_attributes`. This removes the non-automotive Create Product failure.
- Trade Me collectors now preserve generic label/value attributes and use recognized labels to backfill missing Views, Watchers, Bids, Condition, Location and Close fields without category-specific assumptions. Collector version 1.5.6.
- Observation Queue titles are clean external hyperlinks with a hover/focus evidence inspector containing listing facts, arbitrary marketplace details, description, shipping, Q&A/comments, seller facts and capture diagnostics in a scrollable panel.
- Browser document title is now stable (`COBALT · Motera Research Lab`); only the visible header carries the release version.
- Fixed the `product_match_candidates` dashboard query to order by the real `created_at` column rather than nonexistent `id`.
- Added same-ID relist regression coverage.

# V3.9.19 — Relist Lineage + Historical Evidence

- Ended/expired listings are historical evidence, not active research work. The default Observation Queue excludes `relist_watch`, `terminal_closed` and `relisted` rows; an **Ended / expired** filter keeps them available without allowing them to dominate active sorting.
- A known `close_date` now caps the next normal observation at roughly **10 minutes after expiry** when that is sooner than the normal 3h/6h/12h/24h cadence. This closes the gap where the dashboard could visually say Ended while the database still considered the listing active for hours.
- Closed listings enter a bounded, multi-check relist watch. Normal watch delays are approximately **1h, 6h, 18h, 48h and 96h**, with a ten-day maximum watch window. Worker capacity reserves a small slice for due relist probes so a large live-listing backlog cannot starve lifecycle checks.
- Relist discovery now uses several independent evidence paths: same marketplace ID reopening; old URL resolving to a different listing ID; marketplace-explicit relist/new-listing links; ended-page successor candidates; and a conservative category-agnostic semantic fallback.
- Deterministic marketplace redirect/explicit-link/same-ID evidence is recorded with lineage confidence `1.0`. Semantic scores are matcher scores, **not calibrated probabilities**. Semantic auto-linking requires strong same-seller/product evidence and refuses a link when the runner-up is within an ambiguity margin.
- New-ID relists remain separate canonical marketplace listing rows but share `listing_family_id`, link through `relisted_from`/`relist_successor_uuid`, and increment `lifecycle_episode`. Same-ID resurrection increments the episode on the same row.
- Observation counters are scoped to the current lifecycle episode. A relist reset such as `27 views -> 2 views` starts a fresh episode and never becomes a negative demand delta. Historical episodes remain available as product-family evidence.
- Parent episodes are finalized when a successor is discovered, including redirect cases where a dedicated post-close parent capture never occurred.
- Opportunity generation requires current live evidence. A recently ended listing can support a live product-family lead with recency decay (full support for <=7 days, reduced support through 30 days); an ended-only family cannot create a new active Opportunity.
- Added `worker/recheck_relist.py` for dry-run/live-browser validation of a specific ended listing and optional candidate successor. Added `worker/reseed_expired_due.py` to make currently active rows with already-passed close dates immediately due for confirmation without blindly declaring them ended.
- Added migration `017_relist_lineage_hardening.sql` with `relist_successor_uuid`, `relist_match_confidence`, `relist_detection_method` and `last_relist_checked_at`.
- Added relist matcher regressions, explicit-link regressions and lifecycle-episode reset regression. The known real-world regression fixture is Trade Me `6110749863 -> 6121769780`.
- Performed a pre-scale pass before larger data collection: dashboard observation grouping and Opportunity observation grouping now use indexed in-memory maps rather than repeatedly filtering the full observation array per listing.
- Removed the previous 250-listing dashboard / 500-listing Opportunity-scan ceilings. Core dashboard and Opportunity datasets now use paged PostgREST reads with explicit safety ceilings, preventing silent server-row-cap truncation as COBALT grows past the first few hundred listings.
- The legacy `/api/products/auto-promote` endpoint is now a non-mutating `410` tombstone so no stale client/job can bypass the operator-controlled Opportunities -> My Products workflow.
- Version surfaces are synchronized: package version is V3.9.19, document `<title>` and header derive from `web/package.json`, `/api/health` derives from the package version, and the extension manifest is V3.9.19.

# V3.9.18 — Sourcing-First Opportunities + Frictionless Tables

- Reframed COBALT around a clearer workflow: Observation Queue is the research ledger; Opportunities is the sourcing-decision inbox; My Products is entered only after an operator chooses to investigate/source. Removed automatic MUST_HAVE promotion into My Products.
- Opportunity detection is intentionally more proactive because an Opportunity is a research lead, not a stock-purchase instruction. Category-agnostic family clustering can surface an early lead from two or more related listings showing sustained movement, while stronger stages require deeper cross-listing evidence.
- Added user-facing sourcing stages stored inside opportunity metrics: `EARLY_LEAD`, `STRONG_LEAD`, and `SOURCE_NOW`. Existing database `signal_strength` values remain backward-compatible, so no migration is required.
- Standalone sourcing leads may now surface after 3 independent checks when sustained attention is meaningful; stronger standalone stages still require deeper time coverage and stronger behaviour. This keeps rare products discoverable without pretending one listing proves a market.
- Opportunity reasons and notifications are plain English: actual view changes, 24-hour movement, number of similar listings moving, price range, bids, purchase-intent questions, and sold confirmations. Internal confidence/evidence mechanics are no longer the primary user-facing explanation.
- Observation Queue `Why` copy now prioritizes actual views since the last check and views gained in the last 24 hours. The 99%-style evidence-confidence line is removed from the primary Signal/Why UI.
- Renamed user-facing `Velocity` to **Current pace**. The info tooltip explains the simple extrapolation (`views gained ÷ elapsed hours × 24`) and makes clear that the estimate is not an actual 24-hour view count.
- Replaced the large `OPPORTUNITIES [N]` text control with a conventional bell icon and unread-count badge. Added a Sourcing leads overview metric.
- The displayed COBALT version is now read from `web/package.json`, removing hard-coded header version drift.
- Rebuilt table interaction to avoid JavaScript wheel interception entirely. Locked tables use CSS clipping so wheel/trackpad events continue naturally to the page with no `preventDefault`, `scrollBy`, or wheel-time work. Hover shows a faint “Click to enable table scrolling” overlay; clicking activates that table until the user clicks outside it. History popovers are also disabled while a table is locked and use a short hover-intent delay once active, preventing portal churn while the cursor simply passes over rows during page scrolling.
- Sticky column headers are enforced across every independently scrollable COBALT table surface.
- Removed the permanent Observation Queue action gutter. The three-dot control now floats over the natural right edge of the row on hover/focus (always visible on touch), with COBALT-native menu styling.
- No database migration required.

## V3.9.17 — Observation Queue Controls + Interest Suppression

- Observation Queue rows now have a sticky right-side action menu. Desktop shows the control on row hover/focus; touch/mobile keeps it visible. The final data column is padded so the sticky control never covers table content.
- Row actions are **View similar listings**, **Not Interested in Tracking** / **Resume tracking**, and **Delete this listing**. Delete is destructive and separate from preference learning.
- Added a category-agnostic Similar Listings modal using TF-IDF text similarity, token overlap, category-path overlap and shared model/reference-like identifiers. The matcher contains no vehicle-only admission rules and is regression-tested with both vehicle parts and kitchenware examples.
- Added durable `interest_suppressions` and `interest_suppression_hits`. Marking a listing Not Interested stops future observations, preserves history, and creates a conservative negative-interest profile. New high-confidence near-duplicates can be rejected before entering the recurring observation queue.
- Restoring a listing disables the suppression profile and immediately makes the listing due again.
- Queue-level peer corroboration no longer uses the old vehicle-specific make/model/chassis key. It now uses the same category-agnostic similarity primitives, reducing unrelated cross-product corroboration and preparing COBALT for toys, kitchenware, watches and other verticals.
- `GOOD` now requires **at least 4 independent evidence windows in all cases**. Peer corroboration can increase context/confidence but can no longer unlock GOOD after only 3 independent observations.
- AWS EventBridge Scheduler is now the sole scheduler clock in the repo workflow; the unreliable GitHub cron has been removed. The workflow derives its COBALT version from `web/package.json`, skips Chromium/worker work when nothing is due, and can process up to 24 due listings per real tick.
- Added a pre-dependency dispatch idempotency guard. Recent scheduler data showed repeat `workflow_dispatch` deliveries inside the same 10-minute window; duplicates within 8 minutes now exit before pip/Chromium and do not create extra scheduler heartbeats.
- Automation Health no longer shows the stale scheduler activity pill; its lead text now states the actionable due-listing condition directly.
- Migration `016_interest_suppression.sql` is required.

## V3.9.16 — Trusted View Capture + Text Notification Control

- Removed the whole-document Trade Me view-count fallback that could incorrectly pair the word `views` with an unrelated number such as a seller-member year.
- View counts are now accepted only from known views-specific DOM elements, explicitly labelled view text, or trusted accessibility labels. Missing views are stored as missing rather than guessed.
- Ingest and worker persistence quarantine legacy `page-text:*` view sources instead of allowing them to affect velocity, cadence, or opportunity intelligence.
- Added `worker/recheck_listing.py` to re-open a specific Trade Me listing, quarantine unsafe historical view rows, and save a fresh trusted observation.
- Replaced the coloured bell icon with a large text-only `OPPORTUNITIES [N]` control. Unread signals are visually prominent and separated from the NZST timestamp by a dedicated divider.
- Collector version 1.5.5. No database migration required.

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


### V3.9.18 final cadence / pricing clarification
- Observation cadence now heats and cools on real view gains across independent (>=3h) checks: Hot 3h, Warm 6h, Normal 12h, Cold 24h.
- Missing marketplace price does **not** invalidate demand evidence. A listing can be GOOD or support an Opportunity from view/bid/buyer-intent evidence even when no price is exposed.
- Missing prices are never converted to zero and are excluded from opportunity price ranges and product suggested-price benchmarks. Opportunities disclose partial/no price coverage explicitly.
- Opportunity scans return a compact audit of the strongest qualified families/standalone leads so production scans can be inspected instead of silently waiting.
- Locked tables are covered by a single full-surface interaction gate; child hover/click behavior is disabled until activation, and row actions are anchored to the visible right edge during horizontal scrolling.
- A transient missing price no longer erases previously captured price evidence: the queue and opportunity pricing use the most recent known non-null marketplace price and mark it as carried forward when the newest capture omits price.

### V3.9.20 performance follow-up
- Observation Queue uses viewport windowing with ten-row overscan instead of mounting every matching listing row at once. Filtering/sorting still operates across the complete loaded research set; only DOM rendering is windowed.

## V3.9.22 — Opportunity calibration
- Recalibrated Opportunities for the actual sourcing workflow: EARLY_LEAD = quick supplier search, STRONG_LEAD = contact suppliers, SOURCE_NOW = prioritise supplier research.
- Corroborated families can now become useful with fewer observations when evidence is temporally spaced and multiple related listings move together.
- Two related listings can reach STRONG_LEAD without a third comparable when both have mature evidence, or when two sparse histories span enough time and show unusually strong movement.
- Standalone listings can create an EARLY_LEAD from two independent, well-spaced checks only when movement is unmistakable; STRONG_LEAD and SOURCE_NOW retain materially stronger time/evidence requirements.
- Added listing observed-age and median independent-observation metrics so stage decisions account for how long evidence has been accumulating, not only raw point count.
- Trade Me buyer-intent fields remain useful bonuses but are no longer mandatory for very strong view-based SOURCE_NOW evidence.
- Added broad calibration tests covering one/two/three/four/five+ observation cases, short bursts, weak long-running listings, buyer-backed listings, large mature datasets, and the real Toyota Vitz left/right tail-light regression pattern.


## V3.9.23 — Live Opportunity notifications
- Dashboard refreshes Opportunities and sourcing notifications every 30 seconds while visible.
- Returning to the tab/window triggers an immediate refresh.
- Opportunity refresh responses are explicitly non-cacheable.
- No scoring or V3.9.22 calibration thresholds changed.
