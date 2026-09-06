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
