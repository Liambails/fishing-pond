# COBALT — architecture quick reference

For the full system description see [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

```text
Chrome extension/manual discovery ──► Vercel /api/ingest ──► Supabase
                                                │               ▲
                                                └─ matcher       │
                                                                 │
GitHub Actions ─► scheduler telemetry ─► due preflight ─► Playwright worker
                                                                 │
                                                                 └─ observations/cadence/lifecycle

Supabase ─► Next.js dashboard/Product CRM/Automation Health
```

Core principles:

- append observations rather than overwriting history;
- `next_observation_at` controls due work;
- separate listing attention from product opportunity;
- structured automotive identity outranks fuzzy text similarity;
- closure is not proof of sale;
- relists preserve lineage and lifecycle episodes;
- scheduler health is observable independently of listing-level failures;
- marketplace collectors normalize into a marketplace-neutral data model;
- no CAPTCHA/access-verification bypass or anti-bot evasion.
