# COBALT — operations and troubleshooting

## Operating principle

For scheduler/collection incidents, identify the **first failed stage**. Do not infer scheduler health only from whether a new observation appeared.

Expected automatic path:

```text
AWS EventBridge (10m) -> Lambda -> GitHub workflow_dispatch
  -> scheduler heartbeat
  -> Python dependency bootstrap
  -> due preflight
  -> Chromium install (only if due)
  -> Playwright worker
  -> observation write
  -> cadence/lifecycle update
  -> live matcher reconciliation
```

## Primary evidence sources

### `scheduler_runs`

Durable scheduler telemetry. Key fields include GitHub run ID/attempt, event, SHA/version, stage/status, active/due counts, selected IDs, oldest overdue age, worker run/result counts, and fatal error information.

### `collection_runs`

Worker-level collection runs. Useful once the worker actually starts. Absence of a new `collection_runs` row does **not** prove GitHub failed to wake; the failure may have occurred during bootstrap/preflight.

### `collection_errors`

Per-listing collection failures. An empty table does not imply the scheduler is healthy. If execution dies before an individual listing is attempted, there may be no listing-level error to write.

### `system_events`

Application/system issues. Scheduler failures are deduped into a critical system event when Supabase is reachable; a later healthy run can resolve it.

### GitHub diagnostic artifact

Every workflow run attempts to preserve:

```text
scheduler_debug.log
scheduler_debug.jsonl
```

Artifacts are retained for 14 days. They are especially useful when a Supabase telemetry write itself failed.

### Matcher trace

Comparable matching writes timestamped server logs and persists `matcher_debug_events`.

Text export:

```text
GET /api/debug/matcher?format=txt
```

Use this to inspect score, cosine, component scores and reasons over time.

## Scheduler health checklist

A healthy scheduled wake should leave an `AUTO CHECK`/scheduler heartbeat even when **nothing is due**. If something is due, expect a linked worker run and observation(s).

Check in this order:

1. Did GitHub Actions create a scheduled run?
2. Did `scheduler_runs` receive the wake heartbeat?
3. Did dependency bootstrap complete?
4. Did due preflight complete and report active/due counts?
5. If due count > 0, did Chromium install/start?
6. Did `collection_runs` start?
7. Which listing IDs were attempted?
8. Were observations inserted?
9. Did each successful listing receive a new `next_observation_at`/cadence reason?
10. Did live matcher reconciliation succeed or log a non-fatal warning?

## Known scheduler history

The project has previously encountered several distinct failures. They should not be conflated:

- Playwright navigation timeout before navigation hardening.
- CSP failure when collector injection used an incompatible method; collector execution was moved to `page.evaluate`.
- human-readable close-date values rejected by Supabase timestamp fields; worker normalization was added.
- scheduled GitHub runs waking late or being missed/delayed; schedule frequency was increased so `next_observation_at` remains the source of truth rather than depending on one exact hourly event.
- scheduled preflight failures occurring before listing-level collection, which exposed the need for scheduler-level telemetry.

V3.9.3 added bootstrap/preflight retries. V3.9.4 added durable scheduler forensics and pre-dependency heartbeat telemetry.

## Manual dispatch vs real schedule

A `workflow_dispatch` test proves the remote worker environment and credentials, but it does **not** prove the cron trigger path.

A proper scheduler acceptance test is:

```text
1. Confirm application/schema deployment.
2. Ensure exactly one safe active listing is due (or wait for a naturally due listing).
3. Do not manually capture it.
4. Wait for a genuine scheduled GitHub wake.
5. Confirm scheduler_runs: due_count = 1 and selected ID.
6. Confirm collection_runs / observation insertion.
7. Confirm next_observation_at changes.
8. Confirm matcher trace runs after success.
```

## Common incident patterns

### GitHub run exists, no `scheduler_runs` heartbeat

Likely very early environment/script problem or telemetry credentials/connectivity problem. Open the GitHub run and diagnostic artifact first. `scheduler_telemetry.py` intentionally uses the standard library so it can execute before project dependencies are installed.

### Heartbeat exists, bootstrap fails

Inspect dependency-install output and import verification. Workflow retries dependency installation up to three times. Do not add arbitrary sleeps unless evidence shows a readiness race.

### Bootstrap succeeds, preflight fails

Inspect the exact HTTP/schema/network error in `scheduler_debug.log`. Preflight retries up to four times. Common causes include schema/version skew, Supabase credentials, HTTP errors, or transient network/service failure.

### Preflight says `due_count = 0`, but dashboard appears overdue

Compare raw `listings.next_observation_at` timestamps in UTC with current UTC and verify `active`/`lifecycle_state`. Do not diagnose from observation timestamps alone. Relist-watch listings are also eligible through their own due state.

### Preflight says listings are due, but worker never starts

Inspect Chromium installation step and workflow conditions. `workflow_dispatch` deliberately installs/runs even when normal scheduled preflight has no due work.

### Worker starts, listing fails

Inspect `collection_errors`, worker details and error type/stage. Ordinary failures back off; explicit challenge/access-verification failures pause immediately. Do not bypass challenges.

### Observation succeeds, matcher fails

This is intentionally non-fatal. The marketplace observation remains valid. Inspect `MATCHER WARNING`, Vercel/API logs, `matcher_debug_events`, and `COBALT_INGEST_TOKEN` configuration. Reconcile later after fixing matcher/API configuration.

### `system_events` or `collection_errors` is empty while automation is broken

Use `scheduler_runs` and GitHub artifacts. Listing-level error tables only cover stages that reached their respective logging layer.

## Schema/version skew

When an API error says a column is missing from the PostgREST schema cache:

1. Verify the required migration actually ran.
2. Verify migrations were applied in numeric order.
3. Reload PostgREST schema if necessary:

```sql
NOTIFY pgrst, 'reload schema';
```

V3.9.20 requires migrations through `018_generic_marketplace_lifecycle.sql`. Apply migrations 017 and 018 before deploying code that reads/writes relist lineage and generic observation fields.

## Local build/deployment checks

From the web application directory:

```bash
cd ~/cobalt/web
rm -rf .next
npm run build
```

A successful production build is the deployment gate. Do not use `npm audit fix --force` casually; it may introduce breaking dependency changes.

After pushing `main`, verify:

- Vercel deployment succeeded;
- `/api/health` reports the expected COBALT version;
- GitHub Actions workflow uses the same version;
- database migrations are current;
- required secrets exist without printing their values.

## Version consistency checklist

When COBALT version changes, update version references in the same commit. At minimum inspect:

- `web/package.json`;
- dashboard-visible version text;
- `/api/health`;
- `.github/workflows/observe.yml` (version is derived from `web/package.json`; do not reintroduce a hard-coded `COBALT_VERSION`);
- scheduler telemetry fallback/default version;
- matcher version when the matcher itself changes;
- docs current-release references.

## Matcher troubleshooting

When a Product CRM competitor looks wrong, inspect structured components rather than only the final percentage:

```text
fitment
subtype
role
part/reference
text cosine
price compatibility
```

A known subtype conflict should reject before cosine/price can rescue it. If a human identifies a false positive, use `Not comparable`; the durable manual override prevents automatic relinking.

After changing matcher rules, run product reconciliation so stale automatic `hybrid-*` links can be reclassified/removed.

## Relist troubleshooting

A closed listing should enter `relist_watch` and receive sparse follow-up checks. Same-ID resurrection creates another episode. A new-ID relist should remain a separate marketplace listing row linked through lineage rather than overwriting historical listing identity.

Do not merge view counters across episodes blindly. A reset can be legitimate after relisting.

## Security reminders

- Never commit Supabase service-role keys, ingest tokens, or API keys.
- Never expose the service-role key to the browser/extension.
- If a secret is printed into terminal output/chat/history, rotate it and update every deployment location that used it.


## Explicit relist successor flow (V3.9.7)

When a confirmed closed listing page exposes a relist/new-listing link, the worker validates the destination. An old URL that resolves to a different marketplace listing ID is deterministic redirect evidence; an explicit marketplace successor link is also deterministic lineage evidence. The parent is finalized and marked `relisted`, the successor inherits the family/product relationship, and the successor starts a fresh lifecycle episode with its own counters.

If the successor destination presents CAPTCHA, Access Denied, Verify you are human, or Unusual traffic, COBALT stops. The successor's automatic schedule is paused (`next_observation_at = null`) and an open `collection_errors` issue is created. Recover by opening the successor URL in the normal browser, completing any marketplace verification, and using `COBALT · Capture`. A successful manual capture resolves the issue and returns that successor to normal scheduling. COBALT does not rotate proxies, spoof fingerprints, or bypass verification.

If a closed page has no valid explicit successor link, the existing sparse relist-watch and structured heuristic matching remain the fallback.

## Missing listing close/expiry date

`close_date` is attempted on every capture. It is not a second-observation field. V3.9.8 fixes the manual-ingest gap where Trade Me strings such as `Sun 6 Sep, 8:30pm` could be present in the extension payload but become `NULL` because generic JavaScript date parsing rejected them. Manual ingest now interprets recognized human values in `Pacific/Auckland`, matching the automatic worker behavior. If a fresh V3.9.8 observation still has no close date, inspect the raw snapshot `close_date`, `close_remaining`, and source provenance; the marketplace may have omitted or changed the close-time markup.


## Manual capture stabilization and saved-state

When a Trade Me page initially renders without a view count, the V3.9.10 extension retries collection across several short windows before submitting a partial snapshot. During the retry period the button may show `Waiting for views…`. Do not diagnose a temporary first-render miss as a collector failure until those retries have completed.

A complete initial capture establishes durable saved state. Expected button states are:

```text
complete first save       -> Saved ✓
revisit already complete  -> Already Saved ✓
partial/incomplete capture -> Capture remains available
```

Rapid complete captures from the same source family within 3 minutes are coalesced at `/api/ingest`. If investigating unexpected observation counts, inspect `raw_snapshot._capture_episode` for `count`, first/last capture time, source kind, and compact samples. Historical seconds-apart rows may still exist from older versions; V3.9.9 scoring ignores them as independent evidence even when the database history has not been rewritten.

## Observation Queue lifecycle troubleshooting

The default queue is **Active**, not all historical research. A listing is treated as promoted when `product_id` exists, even if older metadata lacks an explicit queue status. Explicit lifecycle metadata lives in `listings.metadata`:

```text
observation_queue_status: active | promoted | dismissed
observation_queue_decided_at: ISO timestamp or null
```

`PATCH /api/observation-queue` accepts selected listing IDs plus `dismiss` or `restore`. Rows already linked to a Product are skipped rather than being restored/dismissed. Explicit Product creation sets `product_id` and marks the listing promoted. The legacy `/api/products/auto-promote` route is non-mutating/disabled so old clients cannot silently create commercial Products.

If a promoted listing appears in Active, first confirm the dashboard received the current `product_id`/metadata values and that the V3.9.11 web deployment is active. If a dismissed listing seems missing, switch Status to `Dismissed` or `All`; dismissal intentionally preserves the listing and observations while removing it from unresolved work.

## Dashboard layering and sticky-header checks

Help/info popovers should appear above table scroll frames and sticky headers. Observation Queue and My Products should both keep their `<thead>` labels visible while scrolling their data frame. If a popover is clipped beneath a table after V3.9.11, verify the current CSS/JS bundle is deployed rather than debugging data or API state.

## Repairing a suspicious Trade Me view count (V3.9.16)

From `worker/`, run `python3 recheck_listing.py <TRADE_ME_LISTING_ID> --dry-run` first. The script collects the listing twice and requires a trusted views-specific source with close agreement between captures. Run again without `--dry-run` to set unsafe historical `page-text:*` view values to `NULL` and save a new trusted observation through the normal worker path. Historical bad rows are quarantined rather than replaced with a later count.


## V3.9.17 AWS scheduler / duplicate dispatches

The production schedule is AWS EventBridge Scheduler -> Lambda -> GitHub `workflow_dispatch`. GitHub's native cron is intentionally absent. A normal real tick is 10 minutes.

`dispatch_guard.py` executes before pip. If another `workflow_dispatch` scheduler heartbeat began within the previous 8 minutes, the job is treated as a duplicate delivery and skips telemetry, dependency installation, due checking, Chromium and collection. This makes scheduler retries cheap and idempotent while preserving the next genuine 10-minute tick.

If the dashboard reports no scheduler heartbeat for more than one expected interval, check EventBridge schedule state, Lambda CloudWatch logs and GitHub Actions dispatches in that order.


## V3.9.19 relist validation and recovery

### Apply migration 017 first

Run `supabase/migrations/017_relist_lineage_hardening.sql`, then reload the PostgREST schema if necessary. V3.9.19 code writes the new relist detection/lineage columns.

### Repair active rows whose known expiry already passed

Dry run:

```bash
cd ~/cobalt
python3 worker/reseed_expired_due.py
```

After reviewing the listing IDs:

```bash
python3 worker/reseed_expired_due.py --apply
```

This does **not** declare rows ended from the clock alone; it merely makes them due immediately so the normal worker can confirm closure/relist state.

### Probe a known relist

```bash
python3 worker/recheck_relist.py 6110749863
```

If the old page does not expose/redirect to the successor, provide the known candidate to validate the fallback matcher:

```bash
python3 worker/recheck_relist.py 6110749863 \
  --candidate-url https://www.trademe.co.nz/a/motors/car-parts-accessories/toyota/electrics/listing/6121769780
```

Both commands are dry-run by default. Only after the output confirms lineage should `--apply` be used. A deterministic redirect/explicit marketplace link is recorded with confidence `1.0`; a semantic matcher score must not be interpreted as an empirical percent chance of correctness. CAPTCHA/access-verification is never bypassed.

### Verify lineage in SQL

```sql
select listing_id, lifecycle_state, lifecycle_episode, relisted_from,
       relist_successor_uuid, relist_detection_method, relist_match_confidence,
       finalized_at, last_relisted_at, last_relist_checked_at
from public.listings
where listing_id in ('6110749863','6121769780');

select marketplace_listing_id, episode, event_type, previous_listing_uuid, confidence, occurred_at, reason
from public.listing_lifecycle_events
where marketplace_listing_id in ('6110749863','6121769780')
order by occurred_at;
```


## V3.9.20 relist watch and generic capture checks

A recently ended listing should normally have `lifecycle_state = relist_watch`, `active = false`, and a non-null `next_observation_at` until the bounded 1/6/18/48/96-hour watch sequence or ten-day window is exhausted. The dashboard intentionally shows this as `Relist watch`, not `Stopped`. Same-ID relists may be detected even if COBALT missed the transient closed page: the strongest signal is an elapsed previous close followed by a new future close on the same marketplace ID; a large view reset is supporting evidence and never a sole trigger. For new-ID relists, the worker first trusts an explicit Trade Me relist link/redirect whose destination resolves to `/listing/<id>`, then verifies the successor.

Generic marketplace captures persist `description`, `category_path`, `primary_image_url`, and `marketplace_attributes` on observations, with the complete collector envelope retained in `raw_snapshot`. Missing fields must remain missing rather than being fabricated; marketplace label/value attributes are used to backfill generic fields only when the primary extractor did not find them.
