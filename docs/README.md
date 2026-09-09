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
