# COBALT — setup and deployment

Current release: **V3.9.10**. This guide assumes the active local repository is `~/cobalt`.

## Prerequisites

Recommended: Python 3.12+, Node 20+, npm, Git, Chrome.

```bash
python3 --version
node --version
npm --version
git --version
```

## Supabase

Create/configure the project, then apply `supabase/migrations/*.sql` in numeric order through:

```text
012_structured_comparable_identity.sql
```

Keep `SUPABASE_SERVICE_ROLE_KEY` private. It belongs only in trusted server/worker environments.

If PostgREST does not see a newly migrated column:

```sql
NOTIFY pgrst, 'reload schema';
```

## Local worker

```bash
cd ~/cobalt/worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env
```

Configure `.env` with Supabase URL/service-role credentials. For an initial visible test, use `HEADLESS=false` and a small `MAX_LISTINGS_PER_RUN`.

```bash
python run.py
```

A successful run should append an observation and update the listing's cadence/`next_observation_at`.

## GitHub Actions

Repository secrets required by the current workflow:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COBALT_INGEST_TOKEN
```

The workflow lives at `.github/workflows/observe.yml`. It records scheduler telemetry, checks due work, conditionally installs Chromium, runs the worker, and uploads diagnostics.

Use `workflow_dispatch` for a remote-environment test. Then separately validate a real scheduled wake; manual dispatch does not prove cron behavior.

## Vercel web application

Set Vercel Root Directory to `web` and configure server-side environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COBALT_INGEST_TOKEN
OPENAI_API_KEY          # only if AI features are enabled
OPENAI_MODEL            # optional
```

Build locally before deployment:

```bash
cd ~/cobalt/web
rm -rf .next
npm install
npm run build
```

After deploy, verify `/api/health` and confirm it reports the expected release.

## Chrome extension

Load `extension-v2/` unpacked in Chrome Developer Mode. Configure its endpoint to the deployed `/api/ingest` and use the same ingest token configured server-side.

Manual capture should append/upsert the canonical listing and observation without creating duplicate marketplace identities.

## First end-to-end acceptance test

1. Apply all migrations.
2. Build/deploy web.
3. Confirm GitHub secrets.
4. Manually capture one known listing with `COBALT · Capture`.
5. Confirm listing + observation in Supabase.
6. Make/wait for one listing to become due.
7. Run one `workflow_dispatch` test.
8. Then wait for a genuine scheduled wake.
9. Confirm scheduler heartbeat -> due selection -> worker -> observation -> cadence update -> matcher trace.

See [`OPERATIONS_AND_TROUBLESHOOTING.md`](OPERATIONS_AND_TROUBLESHOOTING.md) for incident diagnosis.
