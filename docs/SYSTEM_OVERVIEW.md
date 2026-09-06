# COBALT — system overview

## Purpose

COBALT is Motera's product-opportunity research system. It turns marketplace listings into longitudinal evidence that can answer progressively harder questions:

1. Is a listing receiving meaningful attention?
2. Which listings are genuinely comparable versions of the same automotive part?
3. What does the comparable market price look like?
4. Is a product worth sourcing, sampling, test-listing, or rejecting?
5. How does that evidence change through listing closure and relisting?

COBALT deliberately separates **collection**, **identity**, **market intelligence**, and **sourcing decisions**. A high view count is evidence of attention, not proof of a sale.

Current release: **V3.9.11 — Observation Decision Inbox + UI Layering**.

## End-to-end architecture

```text
Manual marketplace discovery
        │
        ├─ Chrome extension (`extension-v2/`)
        │      └─ current-page collector.js
        │             │
        │             ▼
        │       Vercel `/api/ingest`
        │             │
        │             ├─ canonical listing upsert
        │             ├─ observation append
        │             ├─ lifecycle/relist handling
        │             └─ incremental comparable matching
        │
        └──────────────────────────────► Supabase Postgres
                                              ▲
                                              │
GitHub Actions scheduler                       │
        │                                     │
        ├─ dependency-free heartbeat           │
        ├─ due-listing preflight               │
        ├─ conditional Chromium install        │
        └─ Playwright worker ──────────────────┘
                 │
                 ├─ opens due tracked URLs
                 ├─ executes the same collector logic
                 ├─ appends observations
                 ├─ updates adaptive cadence
                 ├─ records failures/lifecycle state
                 └─ requests live matcher reconciliation

Supabase ──► Next.js/Vercel dashboard
              ├─ Observation Queue
              ├─ Product CRM
              ├─ supplier records
              ├─ comparable-market metrics
              ├─ interventions/issues
              ├─ automation health
              └─ matcher trace/debug export
```

## Repository layout

```text
.github/workflows/       GitHub Actions automation
extension-v2/            Chrome manual-capture extension
legacy/v1_5_2/           preserved original collector/reference
scripts/                 legacy import and utility scripts
seed/                    development seed data
supabase/migrations/     ordered database migrations
worker/                  Python Playwright observer + scheduler telemetry
web/                     Next.js dashboard/API deployed to Vercel
docs/                    maintained engineering/operations documentation
```

## Collection model

### Manual capture

The Chrome extension runs the current-page collector against a marketplace page and POSTs the resulting snapshot to `/api/ingest`. Manual capture is useful for discovering new listings and for explicit recovery/testing.

V3.9.10 stabilizes Trade Me capture before ingestion: the extension retries several short render windows when the view count is temporarily absent and uses conservative semantic/text extraction rather than interpreting arbitrary page numbers as views. Complete same-source captures arriving within 3 minutes are treated as one observation episode; the freshest values update the existing observation while compact raw samples remain in `raw_snapshot._capture_episode`. Source-family or listing-ended changes create a separate observation.

The extension also has durable saved-state semantics. A complete initial capture marks the listing as completely captured and disables the action as `Saved ✓`; a later revisit resolves to `Already Saved ✓`. Partial captures are retained for diagnostics/recovery but do not establish the durable saved state, so the user can try again once the page has fully rendered.

### Automatic capture

GitHub Actions wakes on the configured schedule and records a scheduler heartbeat before installing Python dependencies. `due_check.py` asks Supabase whether any active or relist-watch listing is due. Chromium is installed only when work is due (or when the workflow is manually dispatched). The worker then processes due listings up to `MAX_LISTINGS_PER_RUN`.

The automated worker uses a normal Playwright Chromium session. It does not rotate proxies, spoof fingerprints, solve CAPTCHAs, or bypass human-verification/access challenges. Challenge states are recorded and collection backs off.

### Canonical listing and observations

A listing is the marketplace identity/URL being tracked. An observation is a timestamped snapshot of that listing. Repeated observations are append-only evidence: price, views, bids/watchers where exposed, close timing, seller data, fitment/part evidence, and collector metadata.

`next_observation_at` is the scheduling source of truth. A GitHub scheduler wake does **not** imply every listing is opened.

## Adaptive observation cadence

New listings pass through an initial learning ladder:

```text
observation #1 -> +6h
observation #2 -> +6h
observation #3 -> +12h
observation #4+ -> mature adaptive cadence
```

Mature cadence uses recent view/bid/watcher movement. Current bands are 6h, 8h, 12h, or 24h. Own listings have a 12h baseline when no stronger activity band applies. Full rules are in `ALGORITHMS_AND_FORMULAS.md`.

## Listing lifecycle and relists

Closure is not treated as proof of sale. A closed listing freezes its completed lifecycle episode and enters `relist_watch` rather than disappearing forever.

```text
active
  -> closed
  -> relist_watch (~6h -> ~24h -> ~72h)
      -> relisted_same_id
      -> relisted_new_id
      -> terminal_closed
```

Same-ID resurrection opens a new lifecycle episode. New-ID relists can be linked into the same `listing_family_id` using seller identity, structured part/fitment evidence, title/description similarity, price proximity, and timing. Observations retain `lifecycle_episode`, preventing view counters from separate relist episodes from being treated as one continuous counter.

The dashboard renders new-ID relists as an indented lineage/tree and marks same-ID relists with an episode indicator.

## Marketplace abstraction

`web/lib/marketplaces.ts` canonicalizes marketplace identity. Trade Me collection is implemented. eBay URL/item identity is recognized so the data model is not Trade-Me-only, but the eBay collector is intentionally not implemented yet.

Marketplace-specific collectors should normalize into the same core concepts: marketplace, listing ID, canonical URL, seller, title/description, price, fitment, part references, lifecycle, and marketplace-specific engagement fields when available.

## Product CRM

Listings can be promoted/grouped into `products`. Product CRM keeps market evidence and sourcing work together:

- accepted competitor listings and match provenance;
- supplier/contact/quote details;
- own marketplace listing when one exists;
- fitment/supplier/risk inputs;
- similarity-weighted market pricing;
- manual comparable corrections;
- product lifecycle/status.

A manual `Not comparable` decision is durable and prevents the automatic matcher from silently re-linking that listing later.

## Comparable Market Engine

V3.9.11 uses deterministic **hybrid-v2** matching. It is not pure cosine similarity.

The matcher first derives structured automotive identity:

```text
family -> subtype -> role/position
```

Example:

```text
window_control
  -> master_window_switch
      -> driver_master
```

Structured subtype conflicts are hard rejects. Vehicle make/model/chassis and part/reference overlap provide additional identity evidence. Cosine similarity is fuzzy supporting evidence for differently worded listings; price compatibility is a small supporting signal. Neither text similarity nor price can rescue a structural mismatch.

Accepted comparable match confidence is then used to weight market pricing. See `ALGORITHMS_AND_FORMULAS.md`.

## Listing attention, Observation Decision Inbox, and product opportunity

These are deliberately separate concepts.

**Listing signal** asks whether an individual listing is receiving unusual recent attention. It uses recent trusted view velocity, acceleration, close-stage context, watchers/bids when available, peer-relative velocity, and evidence quality. Rapid observations do not become independent evidence merely because they are separate raw captures.

**Observation Queue** is the human decision inbox over that research. It defaults to unresolved `active` listings and orders them by **Most promising**, heavily prioritizing signal class and then confidence, trusted velocity, independent evidence depth, and recent view growth. Operators can alternatively order by Velocity, Confidence, or Newest and filter by Active, Promoted, Dismissed, or All.

Creating (or automatically promoting) a Product changes the source listing to `promoted`, records `product_id`, and removes it from the default Active queue without deleting its listing/observation evidence. Manual dismissal similarly removes a candidate from Active while preserving its history; it can later be restored. Queue status and decision time are stored in existing listing metadata, so V3.9.11 requires no migration.

**Product metrics** aggregate accepted comparable listings and combine demand, competition, margin, evidence, fitment, supplier readiness, and operational risk. Product metrics should never be interpreted as proof of sales where the marketplace does not expose a sale event.

## Dashboard interaction behavior

V3.9.11 keeps table context visible during research. Observation Queue and My Products both use scrollable table frames with sticky column headers. Help/info popovers are rendered through a document-level portal so they sit above scroll containers and sticky headers rather than being clipped underneath table viewports. Product/detail modal backdrops remain fixed above the application chrome.

## Scheduler observability

Scheduler health is a first-class subsystem. `scheduler_runs` records wake/run identity, event type, commit/version, current stage, active/due counts, selected listing IDs, oldest overdue age, worker counts, and fatal errors.

A dependency-free `worker/scheduler_telemetry.py` writes the first heartbeat before pip dependencies are required. GitHub Actions also uploads `scheduler_debug.log` and `scheduler_debug.jsonl` diagnostics. The dashboard Automation Health panel summarizes heartbeat age, missed windows, overdue work, last successful worker, stage, and version.

Telemetry is non-fatal: failure to write observability must not turn a valid marketplace observation into a collection failure.

## Database evolution

Migrations are applied in numeric order. Current sequence:

- `001_initial.sql` — core listings/observations/products/suppliers/runs.
- `003_intelligence_dashboard.sql` — intelligence/dashboard foundations.
- `004_dashboard_polish.sql` — daily briefs/dashboard support.
- `005_product_lifecycle.sql` — product/own-listing lifecycle.
- `006_product_crm.sql` — Product CRM fields.
- `007_supplier_details.sql` — supplier/quote detail.
- `008_adaptive_observation_and_finalization.sql` — cadence/finalization.
- `009_comparable_matching.sql` — comparable matcher provenance/candidates.
- `010_scheduler_forensics.sql` — durable scheduler telemetry.
- `011_listing_lifecycle_and_match_trace.sql` — relist lifecycle + matcher trace.
- `012_structured_comparable_identity.sql` — structured identity + durable manual overrides.

Do not assume a deployment is healthy merely because application code deployed: schema and application versions must be compatible.

## Deployment surfaces

- **Supabase** — persistent Postgres data and operational telemetry.
- **Vercel** — Next.js dashboard and API routes under `web/`.
- **GitHub Actions** — scheduled Playwright observation worker.
- **Chrome extension** — user-initiated discovery/manual capture.

Secrets belong in local env files or deployment secret stores and must never be committed. The service-role key must never be exposed to browser-side code.

## Current research direction

The immediate product-research strategy after scheduler validation is controlled breadth plus selective depth:

- grow to roughly 5–10 product families, initially Toyota-heavy but not Toyota-only;
- keep early sourcing focused on compact, inexpensive, non-safety-critical replacement parts with clear fitment;
- pilot a second marketplace only for the strongest 1–3 product families before building broad multi-market collection infrastructure.

## Non-goals / boundaries

- A view is not a sale.
- Listing disappearance/closure is not proof of sale.
- Similar text is not sufficient product identity.
- Similar price is not sufficient product identity.
- COBALT does not attempt anti-bot evasion or challenge bypass.
- eBay collector support is not implemented merely because eBay identity parsing exists.


### Explicit relist discovery

V3.9.7 adds marketplace-explicit successor discovery to the relist lifecycle. On a confirmed closed page, COBALT scans ordinary anchors for relist/new-listing semantics, validates that the destination is a Trade Me listing with a different listing ID (following ordinary same-marketplace redirects when necessary), and records the successor edge at confidence 1.0. The successor is collected normally and then scheduled like any other listing. Verification/challenge pages are never bypassed; they enter manual recovery.

### Scheduler activity vs successful worker

Automation Health intentionally exposes two different timestamps: the last successful worker is the most recent browser-worker run that actually collected at least one listing, while the scheduler activity pill uses the latest `scheduler_runs` heartbeat even when nothing was due. A quiet collection timestamp can therefore coexist with a healthy recent scheduler heartbeat.

### Close-date normalization

Collectors attempt to capture `close_date` on every observation, including the first manual capture. V3.9.11 normalizes Trade Me human NZ-local close strings during API ingestion using `Pacific/Auckland`; automatic worker captures already perform equivalent normalization in Python. Missing close dates now mean the marketplace did not expose a recognized close value on that capture, rather than an intentional second-observation rule.
