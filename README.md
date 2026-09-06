# COBALT — Motera Product Opportunity Tracker

Current release: **V3.9.11 — Observation Decision Inbox + UI Layering**.

V3.9.11 turns the Observation Queue into an active decision inbox: unresolved opportunities are shown by default and ranked most-promising-first, while promoted and dismissed research remains available through status filters. Help popovers are rendered in a top-level portal so they are not clipped by table viewports, and My Products now uses the same sticky-header scrolling behavior as the Observation Queue. Queue lifecycle state is stored in existing listing metadata, so no database migration is required.

COBALT is Motera's marketplace product-research system. It collects longitudinal listing observations, scores listing attention, groups genuinely comparable automotive parts, builds similarity-weighted market benchmarks, tracks suppliers/products, preserves relist lineage, and exposes scheduler/matcher diagnostics through a Next.js dashboard.

## Documentation

Start with [`docs/README.md`](docs/README.md).

- [`docs/SYSTEM_OVERVIEW.md`](docs/SYSTEM_OVERVIEW.md) — full infrastructure and data-flow overview.
- [`docs/ALGORITHMS_AND_FORMULAS.md`](docs/ALGORITHMS_AND_FORMULAS.md) — scoring/matcher/pricing/cadence formulas.
- [`docs/OPERATIONS_AND_TROUBLESHOOTING.md`](docs/OPERATIONS_AND_TROUBLESHOOTING.md) — scheduler debugging and common issues.
- [`docs/SETUP.md`](docs/SETUP.md) — setup/deployment.
- [`docs/RELEASE_HISTORY.md`](docs/RELEASE_HISTORY.md) — compact historical milestones.

## Main directories

```text
extension-v2/            Chrome manual capture
worker/                  scheduled Playwright observer
web/                     Next.js dashboard + APIs
supabase/migrations/     database schema evolution
.github/workflows/       GitHub Actions scheduler
legacy/v1_5_2/           preserved collector/reference
docs/                    maintained documentation
```

Trade Me collection is currently implemented. The marketplace identity layer recognizes eBay IDs/URLs for future expansion, but an eBay collector is not yet enabled.

The automated collector deliberately backs off on CAPTCHA/access-verification challenges and contains no bypass/evasion logic.
