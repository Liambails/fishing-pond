# COBALT architecture

COBALT keeps the proven V1.5.2 extraction logic but separates collection, storage, scheduling, and analysis.

```text
Manual discovery in browser
        │
        ├── COBALT extension ───────────────┐
        │                                            │
        ▼                                            ▼
 Existing current-page collector.js            Vercel /api/ingest
                                                     │
                                                     ▼
                                                Supabase Postgres
                                                     ▲
                                                     │
GitHub Actions (hourly scheduler) → Playwright worker
        │
        └─ queries only listings whose next_observation_at is due

Supabase → Vercel dashboard → product/listing/observation history
```

The automated worker uses a normal Playwright Chromium session. It does not rotate proxies, spoof fingerprints, solve CAPTCHAs, or bypass access/verification challenges. If a challenge is encountered, the observation is logged as failed and backed off.

## Important design choice

The scheduler wakes hourly, but each listing has its own `next_observation_at`. This means listing observations can be distributed across the day and do not need to occur at the same clock time each day. The worker currently adds a small scheduling spread around each listing's configured observation interval to improve workload distribution and time-of-day coverage.
