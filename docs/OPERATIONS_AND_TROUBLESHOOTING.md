# COBALT — operations and troubleshooting

## Operating principle

For scheduler/collection incidents, identify the **first failed stage**. Do not infer scheduler health only from whether a new observation appeared.

Expected automatic path:

```text
GitHub scheduled wake
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

Current V3.9.8 requires migrations through `012_structured_comparable_identity.sql`.

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
- `.github/workflows/observe.yml` `COBALT_VERSION`;
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

When a confirmed closed listing page contains an ordinary link labelled as a relist/new listing, the worker validates the destination. Direct listing URLs are registered immediately; safe same-marketplace semantic redirect links are followed by ordinary Chromium navigation and the final URL/collector listing ID must prove a different Trade Me listing before lineage is created. The old listing becomes `terminal_closed`; the successor inherits the listing family/product relationship and receives one immediate normal collection attempt.

If the successor destination presents CAPTCHA, Access Denied, Verify you are human, or Unusual traffic, COBALT stops. The successor's automatic schedule is paused (`next_observation_at = null`) and an open `collection_errors` issue is created. Recover by opening the successor URL in the normal browser, completing any marketplace verification, and using `COBALT · Capture`. A successful manual capture resolves the issue and returns that successor to normal scheduling. COBALT does not rotate proxies, spoof fingerprints, or bypass verification.

If a closed page has no valid explicit successor link, the existing sparse relist-watch and structured heuristic matching remain the fallback.

## Missing listing close/expiry date

`close_date` is attempted on every capture. It is not a second-observation field. V3.9.8 fixes the manual-ingest gap where Trade Me strings such as `Sun 6 Sep, 8:30pm` could be present in the extension payload but become `NULL` because generic JavaScript date parsing rejected them. Manual ingest now interprets recognized human values in `Pacific/Auckland`, matching the automatic worker behavior. If a fresh V3.9.8 observation still has no close date, inspect the raw snapshot `close_date`, `close_remaining`, and source provenance; the marketplace may have omitted or changed the close-time markup.
