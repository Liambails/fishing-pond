# Fishing Pond V2 — Progress Log

## 2026-09-05 07:33 ICT (Asia/Bangkok)

### Decision
Fishing Pond V2 development started. The objective is to preserve the proven V1.5.2 Trade Me collector while moving observations into a persistent cloud-backed product research pipeline.

### Built in this update
- Preserved the entire Fishing Pond V1.5.2 codebase under `legacy/v1_5_2/`.
- Reused the exact V1.5.2 `collector.js` in both the V2 Chrome extension and Playwright worker.
- Added Supabase schema for products, listings, observations, collection runs, suppliers and supplier quotes.
- Added a Next.js Vercel dashboard and authenticated `/api/ingest` endpoint.
- Added a configurable V2 Chrome extension that can send manual captures to Vercel or the old localhost endpoint.
- Added a Python Playwright worker that opens due tracked listing URLs, waits for the page, runs the existing collector and saves a new observation.
- Added explicit stop/backoff behaviour for CAPTCHA/access-verification pages; no bypass/evasion logic is included.
- Added per-listing scheduling fields so observations can be distributed through the day rather than fixed to one daily clock time.
- Added an hourly GitHub Actions scheduler that processes only due listings and caps each run at three listings by default.
- Added a legacy CSV importer and bundled the latest supplied marketplace dataset as a seed file.
- Added detailed setup documentation.

### Current milestone
**V2.0 foundation complete as a scaffold.** Next milestone is user-side setup: Supabase project → schema migration → legacy import → one local Playwright observation → GitHub Actions → Vercel dashboard → V2 extension.

### Safety/collection boundary
The worker uses a normal Playwright browser session. If the site returns a CAPTCHA, access denial or human-verification challenge, the job records a failure and backs off. It does not attempt to bypass the challenge.

## 2026-09-05 07:35 ICT (Asia/Bangkok)

### Validation
- Python worker/import scripts compiled successfully.
- Chrome extension JavaScript passed syntax checks.
- The generated ZIP passed archive integrity testing.
