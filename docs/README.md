# COBALT documentation

This directory is the maintained documentation set for COBALT. The repository root README is intentionally short; detailed operational and engineering knowledge lives here.

## Start here

- [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) — what COBALT is, the complete data flow, repository layout, database model, lifecycle, deployment model, and current V3.9.8 capabilities.
- [`ALGORITHMS_AND_FORMULAS.md`](ALGORITHMS_AND_FORMULAS.md) — deterministic scoring, cadence, comparable matching, cosine similarity, similarity-weighted pricing, relist matching, and decision thresholds.
- [`OPERATIONS_AND_TROUBLESHOOTING.md`](OPERATIONS_AND_TROUBLESHOOTING.md) — scheduler observability, common failure modes, debugging sequence, logs, health checks, and recovery procedures.
- [`SETUP.md`](SETUP.md) — first-time local/Supabase/Vercel/GitHub/extension setup.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — compact architecture reference.

## Documentation policy

The docs describe the **current implementation**, not a diary of every patch. When a release changes an algorithm, schema, workflow, version string, or operational procedure, update the relevant maintained document in the same commit.

Historical release notes are consolidated in [`RELEASE_HISTORY.md`](RELEASE_HISTORY.md). Do not add new root-level `Vx_y_RELEASE.md` files unless there is a strong reason to preserve a one-off migration note.

Current application release: **V3.9.8 — Scheduler Activity + First-Capture Close Dates**.
