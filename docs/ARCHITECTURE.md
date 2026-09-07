# COBALT — architecture quick reference

For the full system description see [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

```text
Chrome extension/manual discovery ──► Vercel /api/ingest ──► Supabase
               │                     retry/stabilize + episode coalescing
               └─ durable local saved-state                    ▲
                                                │               │
                                                └─ matcher       │
                                                                 │
GitHub Actions ─► scheduler telemetry ─► due preflight ─► Playwright worker
                                                                 │
                                                                 └─ observations/cadence/lifecycle

Supabase ─► Next.js dashboard/Product CRM/Observation Decision Inbox/Automation Health
```

Core principles:

- preserve observation history while coalescing rapid same-source complete captures into one capture episode;
- `next_observation_at` controls due work;
- separate listing attention from product opportunity and separate unresolved queue work from promoted/dismissed research;
- structured automotive identity outranks fuzzy text similarity;
- closure is not proof of sale;
- relists preserve lineage and lifecycle episodes;
- scheduler health is observable independently of listing-level failures;
- marketplace collectors normalize into a marketplace-neutral data model;
- no CAPTCHA/access-verification bypass or anti-bot evasion.


V3.9.11 decision flow:

```text
active observation candidate
  ├─ create/auto-promote Product -> promoted (source link retained)
  └─ dismiss                    -> dismissed
                                   └─ restore -> active
```

Queue lifecycle is stored in existing `listings.metadata` JSONB. Product creation also sets `listings.product_id`, so promoted research remains traceable from the Product CRM without cluttering the default active queue.

## Opportunity signal layer (V3.9.12)

The opportunity layer sits between listing-level research and commercial Products:

`listings + observations -> listing signals -> product-family clustering -> opportunities -> supplier research -> My Products`

The Observation Queue remains listing-level evidence. Opportunity status never overwrites a listing's deterministic signal label (`TOO EARLY`, `LOW SIGNAL`, `WATCHING`, `GOOD`, `MUST_HAVE`) or its observation schedule.

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
