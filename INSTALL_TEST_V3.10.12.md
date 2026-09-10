# COBALT V3.10.12 — install, test, then deploy

This is the final pre-scale source snapshot. It includes:

- observer-safe view correction;
- precision-first Opportunity family membership and stale-link reconciliation;
- current-opportunity UI filtering;
- production PIN gate;
- close-aware adaptive observation cadence;
- first follow-up 30 minutes after a new listing's first capture;
- post-close confirmation for sold/ended detection.

## A. Install into the existing repo

Preserve `.git`, `web/.env.local`, `worker/.env`, `web/node_modules`, and any local database backups.

Unzip this package, then from your Mac run (adjust the extracted source path if Downloads renamed it):

```bash
cd ~/cobalt
cp web/.env.local ~/Desktop/cobalt-web-env-backup
cp worker/.env ~/Desktop/cobalt-worker-env-backup 2>/dev/null || true

rsync -a \
  --exclude='.git/' \
  --exclude='web/.env.local' \
  --exclude='worker/.env' \
  --exclude='web/node_modules/' \
  --exclude='web/.next/' \
  /PATH/TO/EXTRACTED/COBALT_V3.10.12_FINAL_FULL/cobalt/ \
  ~/cobalt/
```

## B. Local access-code configuration

The code is `5623`. Do not commit it or the secret.

```bash
cd ~/cobalt
{
  grep -v '^COBALT_ACCESS_PIN=' web/.env.local | grep -v '^COBALT_ACCESS_SECRET='
  echo 'COBALT_ACCESS_PIN=5623'
  printf 'COBALT_ACCESS_SECRET=%s\n' "$(openssl rand -hex 32)"
} > web/.env.local.tmp
mv web/.env.local.tmp web/.env.local
```

For Vercel Production later, add the same `COBALT_ACCESS_PIN=5623` and a long random `COBALT_ACCESS_SECRET`. The browser remains unlocked for 180 days via an HttpOnly cookie.

## C. Install dependencies if needed

If your existing `~/cobalt/web/node_modules` is healthy, skip this. Otherwise:

```bash
cd ~/cobalt/web
npm ci
```

## D. Run the complete local gate

```bash
cd ~/cobalt/web
rm -rf .next
npm run test:all
npm run build

cd ~/cobalt
python3 worker/test_view_contamination.py
python3 worker/test_adaptive_cadence.py
python3 -m py_compile \
  worker/cadence.py \
  worker/db.py \
  worker/run.py \
  worker/reseed_close_aware_due.py \
  worker/inspect_listing_cadence.py

git diff --check
```

Do not push if any of those fail.

## E. Pull existing active listings onto the new cadence

Your Vintage Ken Doll was captured before V3.10.12, so its already-stored six-hour due date will not magically change until it is reseeded.

Load the Supabase environment exactly as you have done before:

```bash
cd ~/cobalt
set -a
source web/.env.local
set +a

python3 worker/reseed_close_aware_due.py
```

Review the dry-run. It only proposes moving active due times **earlier**, never later. Then:

```bash
python3 worker/reseed_close_aware_due.py --apply
```

## F. Inspect the Vintage Ken Doll test listing

```bash
python3 worker/inspect_listing_cadence.py "Vintage Ken Doll"
```

You should see its exact next due time, interval, close date, views, bids, current bid and sold state history.

With less than three hours to close, V3.10.12 caps its next interval at 30 minutes. The AWS EventBridge scheduler already wakes every 10 minutes, so a 30-minute due time is actionable.

When the advertised close is nearer than the calculated next check, COBALT instead schedules a confirmation 10 minutes after the close. That is the check we want to use to verify `sold_detected`, final bid/current price, closure reason and final evidence.

## G. What the adaptive cadence now does

- First successful capture: next check in 30 minutes.
- After that first burst, if evidence is still immature: establish a >=3h reliable window.
- Hot: ~2h.
- Warm: ~4h.
- Normal movement: ~8h.
- Normal/unclear: ~12h.
- Cold after repeated reliable no-growth windows: ~18h.

Close time overrides those as a maximum gap:

- <=3h left: 30m max gap.
- <=6h: 1h.
- <=12h: 2h.
- <=24h: 4h.
- If close+10m is sooner than the calculated next observation: use close+10m.

Short 30-minute observations are stored, but they do **not** become separate independent view-velocity evidence windows until the normal >=3h evidence separation is reached. This is important: we get auction-resolution detail without inflating demand confidence.

## H. Before push

After the Vintage Ken test and fresh Opportunity scan look correct:

```bash
cd ~/cobalt
git status --short
git diff --stat
git diff --check
```

Then commit/push only after review.
