# Fishing Pond V2 — Motera Product Opportunity Tracker

V2 is a cloud-backed evolution of Fishing Pond V1.5.2. It preserves the existing Trade Me extraction logic while adding longitudinal observations, a queue, scheduled browser observations, product/supplier records, and a web dashboard.

## What is included

- `legacy/v1_5_2/` — untouched V1.5.2 codebase for fallback/reference.
- `extension-v2/` — V1.5.2 collector plus cloud/local configurable capture endpoint.
- `supabase/migrations/001_initial.sql` — database schema.
- `worker/` — Playwright observer that reuses the exact collector JS.
- `.github/workflows/observe.yml` — hourly scheduler; only due listings are opened.
- `web/` — Next.js dashboard and authenticated ingest API for Vercel.
- `scripts/import_legacy.py` — imports the existing CSV snapshots.
- `seed/marketplace_listings_latest.csv` — latest Fishing Pond dataset provided during development.
- `docs/SETUP.md` — detailed setup instructions.
- `PROGRESS.md` — timestamped development log.

Start with `docs/SETUP.md`.
