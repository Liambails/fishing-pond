# COBALT v2.1 — Product Intelligence Dashboard

## What changed
v2.1 turns the collector dashboard into a product decision engine while keeping raw evidence accessible.

### Product engine
- Promote selected Observation Queue listings into a Product.
- Product table exposes Verdict, Score, Demand, Competition, Market Price, View Velocity, Confidence and lifecycle Stage.
- Overview modal shows plain-English decision context, deterministic metrics, pricing recommendation, competitor evidence and optional AI Bull/Bear analysis.

### Deterministic first
The application computes price, view velocity, evidence confidence and score dimensions itself. AI does not own source-of-truth numbers.

### AI analyst
When `OPENAI_API_KEY` is configured, Product Overview can generate a cached analyst brief. The prompt is explicitly constrained not to invent sales, fitment, costs or sold status. Each analysis stores its source snapshot in `ai_analyses`.

### Interventions
Open `collection_errors` appear in the dashboard with:
- failure type/message/time
- direct marketplace link
- Resolve
- Dismiss

This is designed for CAPTCHA/human-verification/timeouts/parser failures so a human can open the listing and use the extension to capture it manually.

### Pricing
The first pricing recommendation is deliberately conservative: a deterministic test-price suggestion relative to observed competitor median plus an optional unit-economics floor when landed cost is known. It never auto-updates marketplace prices.

## Upgrade
1. Back up the repo.
2. Copy v2.1 files over the existing repo (do not copy `.env` files).
3. Run `supabase/migrations/003_intelligence_dashboard.sql` in Supabase SQL Editor.
4. Ensure the existing `collection_errors` table is present from the worker-hardening migration.
5. In `web`, run `npm install` then `npm run build`.
6. Optional: add `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-5.6-luna` to Vercel Production environment variables.
7. Commit and push; Vercel will deploy from GitHub.

## Important
The migration is additive. Existing listings/observations are not deleted. Existing `listings.product_id` links are backfilled into `product_listings`.
