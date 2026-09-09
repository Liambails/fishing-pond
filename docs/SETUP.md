# COBALT — setup and deployment

Current release: **V3.9.21**. This guide assumes the active local repository is `~/cobalt`.

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
017_relist_lineage_hardening.sql
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

Use `workflow_dispatch` for a remote-environment test. Production scheduling is owned by AWS EventBridge Scheduler -> Lambda -> GitHub `workflow_dispatch`; GitHub native cron is intentionally not used.

## Vercel web application

Set Vercel Root Directory to `web` and configure server-side environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COBALT_INGEST_TOKEN
OPENAI_API_KEY          # only if AI features are enabled
OPENAI_MODEL            # optional
```

Build and run the intelligence regression suite locally before deployment:

```bash
cd ~/cobalt/web
npm install
npm run test:intelligence
rm -rf .next
npm run build
```

After deploy, verify `/api/health` and confirm it reports the expected release.

## Chrome extension

Load `extension-v2/` unpacked in Chrome Developer Mode. Configure its endpoint to the deployed `/api/ingest` and use the same ingest token configured server-side.

Manual capture should upsert the canonical listing without creating duplicate marketplace identities. The extension retries rendered-page collection across several short windows when views are not available yet. Complete same-source captures within 3 minutes are coalesced into one observation episode, so retries do not become independent evidence.

Durable save-state is stored through listing metadata. A complete initial capture disables the button as `Saved ✓`; revisiting an already-complete listing shows `Already Saved ✓`. A partial capture does not establish durable saved state, so the capture action remains available for recovery.

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


## Source-only update workflow

Normal COBALT releases should update source files inside the existing `~/cobalt` repository rather than replacing the repository itself. Keep these local files in place:

```text
~/cobalt/.git/
~/cobalt/web/.env.local
~/cobalt/worker/.env
```

Release ZIPs should not contain `.git`, `.env.local`, or `.env`. Copy/merge the source update into `~/cobalt`, run tests/build, inspect `git status`, commit, and push. Ignored local env files remain in place because an incoming source-only update does not overwrite paths it does not contain. Production secrets belong in Vercel/GitHub/worker secret stores rather than Git history.

For a normal release after files are merged:

```bash
cd ~/cobalt/web
npm run test:intelligence
rm -rf .next
npm run build

cd ~/cobalt
git status
git add -A
git commit -m "COBALT Vx.y.z - <release summary>"
git fetch origin
git status
git push origin main
```

Do not force-push as part of the routine deployment path. If `git fetch origin` reports divergence, reconcile it before pushing.

## V3.9.12 database step

Run `supabase/migrations/013_opportunity_signals.sql` in the Supabase SQL editor before relying on Opportunity Signals. The migration is additive and does not alter existing listings, observations, products, suppliers or scheduler history.

No new secret is required. Automatic opportunity scans reuse `COBALT_INGEST_TOKEN` and `COBALT_WEB_URL` from the existing observer workflow.


## V3.9.13 schema update

After V3.9.12, run `supabase/migrations/014_marketplace_signal_intelligence.sql` in Supabase before deploying/using the V3.9.13 collector and Listing details tab. The migration is additive.


## V3.9.15 schema update

After V3.9.14, run `supabase/migrations/015_standalone_opportunity_signals.sql` before deploying V3.9.15. The migration is additive: it adds `opportunity_type` to the existing opportunity table and classifies existing rows as `corroborated` by default. No listing, observation, product or notification history is deleted.


## V3.9.19 schema + relist acceptance step

Apply `supabase/migrations/017_relist_lineage_hardening.sql` before V3.9.19 web/worker deployment. Then run the full regression suite/build. After deploy, run `worker/reseed_expired_due.py` in dry-run mode and review before `--apply`. For the current known Trade Me regression fixture, run `worker/recheck_relist.py 6110749863` (or pass successor `6121769780`) and confirm the reset begins a new lifecycle episode rather than producing a negative counter delta.


## V3.9.20 schema + acceptance step

Apply `supabase/migrations/018_generic_marketplace_lifecycle.sql` after migration 017. Reload the PostgREST schema if required, then run `npm run test:all` and `npm run build` from `web/`. Acceptance includes creating a My Product from a non-automotive listing with `part_type = null`, hovering the Observation Queue title to inspect captured marketplace facts, and verifying a recently ended listing shows `Relist watch` with a scheduled next probe rather than `Stopped`.
