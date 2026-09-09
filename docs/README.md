# COBALT documentation

This directory is the maintained documentation set for COBALT. There is intentionally no maintained root README; operational and engineering knowledge lives under `/docs`.

Current release: **V3.9.21 — Generic Marketplace Lifecycle + Listing Evidence Inspector**.

## Start here

- [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) — end-to-end collection, observation, lifecycle, Opportunity and deployment model.
- [`ALGORITHMS_AND_FORMULAS.md`](ALGORITHMS_AND_FORMULAS.md) — scoring, evidence windows, adaptive cadence, relist matching, opportunity thresholds and pricing rules.
- [`OPERATIONS_AND_TROUBLESHOOTING.md`](OPERATIONS_AND_TROUBLESHOOTING.md) — production checks, scheduler/relist diagnostics and recovery commands.
- [`SETUP.md`](SETUP.md) — local/Supabase/Vercel/GitHub/extension setup and required migrations.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — compact component and data-flow reference.
- [`RELEASE_HISTORY.md`](RELEASE_HISTORY.md) — chronological release notes.

## V3.9.20 deployment requirement

Apply migrations through `supabase/migrations/018_generic_marketplace_lifecycle.sql` before deploying V3.9.20. Migration 018 makes automotive `part_type` optional and adds first-class generic observation fields for description, category path, primary image and marketplace label/value attributes. V3.9.20 also keeps recently ended listings on bounded relist watch, detects same-ID lifecycle resets from elapsed-close/new-close evidence, follows explicit marketplace relist links, and adds the queue listing-evidence inspector.

After deployment, run `worker/reseed_expired_due.py` in dry-run mode and then `--apply` after reviewing the affected rows. Use `worker/recheck_relist.py` to prove known relist fixtures against the live marketplace before treating relist discovery as production-validated.

## Documentation policy

The maintained docs describe the **current implementation**. When a release changes an algorithm, schema, workflow, version, UI contract or operational procedure, update the relevant document in the same commit. Historical details belong in `RELEASE_HISTORY.md`, not new root-level release files.

### Opportunity calibration (V3.9.22)
Opportunity stages deliberately trade observation count against elapsed evidence time and corroboration. Two well-spaced observations may create only an EARLY standalone lead when movement is exceptional; corroborated related listings can mature faster because independent listings provide separate evidence. STRONG_LEAD means supplier outreach is warranted. SOURCE_NOW requires materially deeper or exceptional sustained evidence. Raw observation count alone never creates an Opportunity.

### Search Watches (V3.10.0)

Search Watches turn a useful marketplace query into a durable research universe. A watch stores the exact search phrase, optional marketplace category, run interval and page limit. The GitHub worker runs only watches that are due, uses the official Trade Me Search API, deduplicates results, and places newly discovered listings into the ordinary observation queue. The feature is deliberately category-agnostic: `Toyota Aqua NHP10`, `beach umbrella`, or any later category uses the same pipeline.

Trade Me Search Watches use the existing Playwright/browser worker; no Trade Me API credentials are required. Discovery and detail-collection outcomes are recorded in `search_watch_runs`, `listing_acquisition_events`, and the listing's `last_acquisition_*` fields. CAPTCHA/human-verification/access-denied pages are logged as failures and are not bypassed.

### Browser Search Watches (V3.10.1)
Search Watches do not require a marketplace API. A watch is a user-selected marketplace query such as `Toyota Aqua NHP10`, `Aqua NHP10`, or `beach umbrella`. On its configured cadence COBALT opens the normal Trade Me search result pages with the existing Playwright worker, extracts canonical listing links, deduplicates them, and queues new listings for the normal observation/intelligence pipeline. Search discovery is deliberately not automotive-specific.

Search Watch runs and listing acquisition events retain explicit failure types. If the marketplace presents a CAPTCHA or human-verification/access-denied page, the watch stops and records the failure; COBALT does not bypass the challenge. Use the `SEARCH` badge and Search Watches table to distinguish successful discovery from failed detailed observations.

### Semantic Search Watch pagination (V3.10.2)
Search Watches do not depend on Trade Me pagination CSS class names and do not synthesize page 2/3/4 URLs. COBALT starts at the configured search page and inspects the rendered DOM for semantic next-page evidence (`rel=next`, accessible next labels, incrementing page numbers and pagination navigation context). Each selected transition is recorded in `search_watch_runs.diagnostics`.

The GitHub observation workflow also isolates Opportunity delivery from ordinary collection. A missing GitHub ingest token is logged as an Opportunity-scan skip instead of failing successful observations; configure `COBALT_INGEST_TOKEN` (or the legacy `FISHING_POND_INGEST_TOKEN`) to actually run Opportunity scans.

### V3.10.3 operator note
Observation Queue lifecycle and relist lineage can now be filtered independently. Use **Active + Relisted / lineage** for current successors/reopened episodes and **Ended / expired + Relisted / lineage** for ended parent listings. Opportunity scoring also recognises broad, mature families with repeated view growth even when the marketplace does not expose watcher/bid fields; weak recent movement still does not qualify.

### V3.10.4 buyer-signal note
COBALT treats public buyer counters as optional evidence: a visible `No bids` is 0, but a missing bid/watchlist counter is unknown (`null`). Some Trade Me templates expose `N others watchlisted`; others expose only the Add to Watchlist action. Explicit sale outcomes strengthen Opportunity evidence, but a listing merely ending is never assumed sold. Existing active listings can be refreshed once with `python3 worker/backfill_buyer_signals.py --all`; normal independent-observation timing still applies.
