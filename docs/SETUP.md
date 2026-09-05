# Fishing Pond V2 — detailed setup

This setup uses GitHub + Supabase + Vercel + GitHub Actions. The first goal is to make one known listing travel through the entire pipeline before enabling the full tracked queue.

## 0. Prerequisites on your Mac

Install/check:

```bash
python3 --version
node --version
npm --version
git --version
```

Recommended: Python 3.12+, Node 20+.

Create a working folder and unzip the project:

```bash
cd ~/Desktop
unzip ~/Downloads/fishing_pond_v2.zip
cd fishing_pond_v2
```

## 1. Create the GitHub repository

On GitHub create a new private repository named `fishing-pond` (do not initialize it with a README). Then locally:

```bash
git init
git add .
git commit -m "Fishing Pond v2 foundation"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/fishing-pond.git
git push -u origin main
```

## 2. Create Supabase

1. Sign in to Supabase.
2. Create a new project called `fishing-pond`.
3. Save the database password somewhere safe.
4. Open **SQL Editor**.
5. Open `supabase/migrations/001_initial.sql` from this repository.
6. Paste the entire SQL file into Supabase SQL Editor.
7. Click **Run**.
8. In **Table Editor**, confirm these tables now exist: `products`, `listings`, `observations`, `collection_runs`, `suppliers`, `supplier_quotes`.

Now open **Project Settings → API** and copy:

- Project URL → this becomes `SUPABASE_URL`.
- service role key → this becomes `SUPABASE_SERVICE_ROLE_KEY`.

Treat the service-role key like a password. Never place it in browser JavaScript, the Chrome extension, or commit it to Git.

## 3. Test the database locally

```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='YOUR_SERVICE_ROLE_KEY'
python import_legacy.py ../seed/marketplace_listings_latest.csv
```

Expected output is similar to:

```text
Imported 26 legacy listing snapshots.
```

Go back to Supabase Table Editor and open `listings` and `observations`. You should now see the existing Fishing Pond dataset. The importer schedules imported listings to become due shortly so we can test the worker.

## 4. Test the Playwright worker locally BEFORE GitHub Actions

```bash
cd ../worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env
```

Edit `worker/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
MAX_LISTINGS_PER_RUN=1
HEADLESS=false
```

Use `HEADLESS=false` for the first run so you can actually watch Chromium open the listing.

Run:

```bash
python run.py
```

Expected behaviour:

1. Worker asks Supabase for a listing where `next_observation_at <= now()`.
2. Chromium opens that Trade Me listing.
3. It waits for the page DOM.
4. It injects the same V1.5.2 `collector.js` used by the extension.
5. The collector extracts the current listing snapshot.
6. A new row is inserted into `observations`.
7. `listings.last_observed_at` changes.
8. A new `next_observation_at` is assigned around the listing interval.
9. The browser closes.

If Trade Me presents a CAPTCHA/access/verification challenge, the worker deliberately stops that observation and records the error rather than attempting to bypass the challenge.

After the first successful run, change:

```env
HEADLESS=true
MAX_LISTINGS_PER_RUN=3
```

and run it again.

## 5. Add GitHub Actions secrets

In GitHub open your `fishing-pond` repository:

**Settings → Secrets and variables → Actions → New repository secret**

Create exactly these two secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Do not add quote marks around the values.

The included workflow `.github/workflows/observe.yml` wakes hourly. It does **not** necessarily open every listing hourly. It queries Supabase for listings whose individual `next_observation_at` is due, processes up to three, and exits.

To test it immediately:

**GitHub → Actions → Fishing Pond observations → Run workflow**.

Open the run log. You should see JSON describing attempted/succeeded/failed listings.

## 6. Deploy the Vercel dashboard/API

First create a long random ingest token on your Mac:

```bash
openssl rand -hex 32
```

Copy the output somewhere safe.

On Vercel:

1. **Add New → Project**.
2. Import the `fishing-pond` GitHub repository.
3. Set **Root Directory** to `web`.
4. Framework should detect Next.js.
5. Add environment variables:

```text
SUPABASE_URL=your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=your service-role key
FISHING_POND_INGEST_TOKEN=the random token generated above
```

6. Deploy.

After deployment visit:

```text
https://YOUR-VERCEL-DOMAIN/api/health
```

Expected:

```json
{"ok":true,"service":"fishing-pond-v2"}
```

Then visit the root URL. You should see the Fishing Pond V2 dashboard and imported listings.

## 7. Install the V2 Chrome extension

Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose the `extension-v2` folder.

Then click **Details → Extension options** and set:

```text
Endpoint: https://YOUR-VERCEL-DOMAIN/api/ingest
Ingest token: the same FISHING_POND_INGEST_TOKEN used in Vercel
```

Open a Trade Me listing manually. The familiar Fishing Pond capture button should appear. Click it. That uses the same hardened V1.5.2 collector, but sends the observation to the cloud API instead of only localhost.

Confirm a new observation appears in Supabase.

## 8. Keep finding new candidate products

Continue discovery exactly as before:

1. Search Trade Me manually for a vehicle/part hypothesis.
2. Open a useful listing.
3. Click **Fishing Pond · Capture**.
4. The listing is inserted/upserted into V2.
5. Assign it to a product record once you decide the product cluster is worth tracking.

V2 does not remove the original workflow — it gives those captures a persistent database and allows already-tracked listing URLs to accumulate later observations.

## 9. Create product records

For the first pass, use Supabase Table Editor → `products` → **Insert row**.

Example Aqua record:

```text
slug: toyota-aqua-nhp10-master-window-switch
vehicle_make: Toyota
vehicle_model: Aqua
chassis: NHP10
part_type: Window master switch
status: sourcing
priority: 90
target_retail_nzd: 89.99
target_landed_cost_nzd: 25.00
notes: JDM/RHD. Verify 84820-33260 vs 84820-52380.
```

Copy its generated `id`, then set matching `listings.product_id` values for the Aqua master-switch listings. We can automate clustering in a later revision; for V2.0, explicit assignment is safer.

## 10. Observation timing

Every listing contains:

```text
last_observed_at
next_observation_at
observation_interval_hours
priority
active
```

The default interval is 24 hours. The worker chooses a next observation roughly around that interval, spreading times within a small window for workload distribution and better time-of-day sampling. This means checks are not locked to the exact same clock time every day.

Suggested starting intervals:

```text
Strong/new candidate: 24 hours
Medium candidate:     48–72 hours
Weak/stale candidate: 120–168 hours
Inactive/closed:      active=false
```

You can edit `observation_interval_hours` directly in Supabase until the V2 dashboard gets editing controls.

## 11. What we will calculate next

The raw history now makes these derived metrics possible without changing the collector:

- view change between observations
- normalized views per day/hour
- price change
- days observed
- listing disappearance/inactivity
- median/mean price by product
- unique seller count
- seller concentration
- listing turnover
- product opportunity score
- supplier quote comparison
- landed-cost vs target-retail margin

These analytics belong in V2.1 after the collection pipeline is proven.

## 12. Do not delete V1.5.2 yet

`legacy/v1_5_2` is intentionally retained. If the cloud setup breaks while we are building V2, the old local Fishing Pond collector remains available as a fallback and as the source of the extraction logic.
