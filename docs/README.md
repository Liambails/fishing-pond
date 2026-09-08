# COBALT documentation

This directory is the maintained documentation set for COBALT. There is intentionally no maintained root README; operational and engineering knowledge lives under `/docs`.

Current release: **V3.9.19 — Relist Lineage + Historical Evidence**.

## Start here

- [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) — end-to-end collection, observation, lifecycle, Opportunity and deployment model.
- [`ALGORITHMS_AND_FORMULAS.md`](ALGORITHMS_AND_FORMULAS.md) — scoring, evidence windows, adaptive cadence, relist matching, opportunity thresholds and pricing rules.
- [`OPERATIONS_AND_TROUBLESHOOTING.md`](OPERATIONS_AND_TROUBLESHOOTING.md) — production checks, scheduler/relist diagnostics and recovery commands.
- [`SETUP.md`](SETUP.md) — local/Supabase/Vercel/GitHub/extension setup and required migrations.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — compact component and data-flow reference.
- [`RELEASE_HISTORY.md`](RELEASE_HISTORY.md) — chronological release notes.

## V3.9.19 deployment requirement

Apply `supabase/migrations/017_relist_lineage_hardening.sql` before deploying V3.9.19. The release adds auditable relist-successor/detection fields, current-episode scoring, expiry-aware closure confirmation, multi-check relist watch, recent-ended Opportunity support, and production relist probe/reseed utilities.

After deployment, run `worker/reseed_expired_due.py` in dry-run mode and then `--apply` after reviewing the affected rows. Use `worker/recheck_relist.py` to prove known relist fixtures against the live marketplace before treating relist discovery as production-validated.

## Documentation policy

The maintained docs describe the **current implementation**. When a release changes an algorithm, schema, workflow, version, UI contract or operational procedure, update the relevant document in the same commit. Historical details belong in `RELEASE_HISTORY.md`, not new root-level release files.
