# COBALT — architecture quick reference

For the full system description see [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

```text
Chrome extension/manual discovery ──► Vercel /api/ingest ──► Supabase
               │                     retry/stabilize + episode coalescing
               └─ durable local saved-state                    ▲
                                                │               │
                                                └─ matcher       │
                                                                 │
AWS EventBridge ─► Lambda ─► GitHub workflow_dispatch ─► scheduler telemetry ─► due preflight ─► Playwright worker
                                                                 │
                                                                 └─ observations/cadence/lifecycle

Supabase ─► Next.js dashboard/Product CRM/Observation Decision Inbox/Automation Health
```

Core principles:

- preserve observation history while coalescing rapid same-source complete captures into one capture episode;
- `next_observation_at` controls due work;
- separate listing attention from product opportunity and separate unresolved queue work from promoted/dismissed research;
- marketplace-neutral/category-agnostic similarity is the default queue/suppression layer; domain adapters may add stricter identity rules without redefining the core data model;
- closure is not proof of sale;
- relists preserve lineage and lifecycle episodes;
- scheduler health is observable independently of listing-level failures;
- marketplace collectors normalize into a marketplace-neutral data model;
- no CAPTCHA/access-verification bypass or anti-bot evasion.


Current decision flow:

```text
active observation candidate
  ├─ create Product explicitly -> promoted (source link retained)
  └─ dismiss                    -> dismissed
                                   └─ restore -> active
```

Queue lifecycle is stored in existing `listings.metadata` JSONB. Product creation also sets `listings.product_id`, so promoted research remains traceable from the Product CRM without cluttering the default active queue.

## Opportunity signal layer (V3.9.12)

The opportunity layer sits between listing-level research and commercial Products:

`listings + observations -> listing signals -> product-family clustering -> opportunities -> supplier research -> My Products`

The Observation Queue remains listing-level evidence. Opportunity status never overwrites a listing's deterministic signal label (`TOO EARLY`, `LOW SIGNAL`, `WATCHING`, `GOOD`, `MUST_HAVE`) or its observation schedule. In V3.9.18 the product workflow is explicitly operator-controlled: research signals do not auto-create commercial Products. The Observation Queue is the evidence ledger; Opportunities is the sourcing-decision inbox; My Products begins only when the operator chooses to move forward.

### Durable opportunity tables

- `opportunities`: canonical cross-listing product-family signal, identity summary, aggregate metrics, lifecycle and supplier-research snapshot.
- `opportunity_listings`: provenance linking each opportunity to supporting canonical listings and the evidence at the time of the scan.
- `opportunity_notifications`: durable bell-inbox history. This is business intelligence, not `system_events` health telemetry.

### Automatic detection

The GitHub observation workflow calls `/api/opportunities/scan` after a collection run. The route is protected by the existing COBALT ingest token. This allows opportunity detection to continue while no user has the dashboard open.


## V3.9.13 signal enrichment

Trade Me collectors normalize public behavioural data and Q&A into observation fields. Deterministic scoring converts those fields into bounded buyer-intent evidence used by listing signals, product demand metrics and cross-listing opportunities. Raw Q&A remains available for provenance and for the server-side AI listing-draft route. `product_listing_drafts` persists generated copy independently from competitor evidence.


## V3.9.15 opportunity evidence classes

The Opportunity engine has two active evidence classes:

- `corroborated` — a product-family signal supported by multiple comparable listings;
- `standalone` — one listing with unusually strong, sustained independent evidence when no reliable comparable cluster exists.

Both persist in `opportunities`, link supporting research through `opportunity_listings`, and emit durable `opportunity_notifications`. `opportunity_type` is first-class schema state so UI and future scoring can apply different confidence semantics without overloading listing metadata.

## View-count trust boundary (V3.9.16)

The collector is the first trust boundary for marketplace counters. Trade Me views must originate from views-specific DOM or labelled accessibility metadata; whole-document numeric fallback is forbidden. Both the manual ingest API and worker database persistence independently quarantine legacy `page-text:*` view provenance, providing a second defensive layer before cadence, velocity, and opportunity intelligence consume the observation.


## V3.9.17 interest-decision layer

```text
new marketplace discovery
  -> active user-interest exclusions
  -> generic TF-IDF/category/identifier similarity
     -> strong negative match: suppression hit only (no recurring observation)
     -> otherwise: canonical listing -> observation queue

Observation Queue row
  -> View similar listings (inspection only)
  -> Not Interested in Tracking -> preserve history + stop schedule + create suppression profile
  -> Resume tracking -> disable profile + due now
  -> Delete listing -> destructive record/history removal; creates no preference signal
```

The generic similarity layer does not contain vehicle makes/models or category-specific exclusions. Product-domain adapters (for example vehicle fitment) may still exist for richer Product CRM matching, but they sit above the marketplace-neutral queue/admission layer.

## Scheduler ownership

V3.9.17 makes AWS EventBridge Scheduler the clock. The repository workflow is `workflow_dispatch` only. Because retryable external scheduling is at-least-once in practice, `worker/dispatch_guard.py` suppresses repeat dispatches within eight minutes before dependency installation. GitHub Actions remains the worker compute environment.


### V3.9.18 final cadence / pricing clarification
- Observation cadence now heats and cools on real view gains across independent (>=3h) checks: Hot 3h, Warm 6h, Normal 12h, Cold 24h.
- Missing marketplace price does **not** invalidate demand evidence. A listing can be GOOD or support an Opportunity from view/bid/buyer-intent evidence even when no price is exposed.
- Missing prices are never converted to zero and are excluded from opportunity price ranges and product suggested-price benchmarks. Opportunities disclose partial/no price coverage explicitly.
- Opportunity scans return a compact audit of the strongest qualified families/standalone leads so production scans can be inspected instead of silently waiting.
- Locked tables are covered by a single full-surface interaction gate; child hover/click behavior is disabled until activation, and row actions are anchored to the visible right edge during horizontal scrolling.


## V3.9.19 ended-listing and relist architecture

```text
live listing episode
  -> expiry confirmation (close + ~10m when known)
  -> relist_watch
       -> same ID live again ............ new episode on same row
       -> old URL resolves to new ID .... deterministic successor edge
       -> explicit marketplace link ..... deterministic successor edge
       -> ended-page candidate .......... collect + conservative semantic match
       -> no successor yet .............. sparse 1h/6h/18h/48h/96h checks
       -> watch exhausted ............... terminal_closed
```

A new marketplace ID is never merged destructively into the old canonical listing. The rows share `listing_family_id`; the child points to `relisted_from`, the parent points to `relist_successor_uuid`, and the child receives the next `lifecycle_episode`. Same-ID reopening increments the episode on the existing row. Current-listing scoring reads only observations from the current episode.

Opportunity evidence is intentionally asymmetric: at least one current **live** positive listing is required to create/strengthen an active family Opportunity. Recently ended episodes can corroborate the family (full historical support through 7 days; reduced support through 30 days) but cannot create an Opportunity by themselves. This preserves useful market history without allowing stale listings to masquerade as current demand.


## V3.9.20 generic listing evidence architecture

The collector emits both normalized cross-category fields and a generic `marketplace_attributes` label/value list. The worker/manual ingest persist those attributes plus description/category/image on each observation while retaining the entire raw snapshot. The dashboard reads the latest observation and renders a scrollable listing inspector from first-class fields, raw evidence, seller facts, shipping, Q&A and marketplace attributes. Product creation no longer requires an automotive `part_type`.

Relist detection is layered: (1) continue scheduled probes of the original URL after expiry; (2) detect same-ID lifecycle reset using elapsed-close/new-future-close and corroborating counters; (3) accept marketplace redirects or explicit relist links to a new `/listing/<id>` as authoritative new-ID lineage; (4) keep semantic replacement matching as lower-confidence fallback rather than conflating it with explicit marketplace relisting.
