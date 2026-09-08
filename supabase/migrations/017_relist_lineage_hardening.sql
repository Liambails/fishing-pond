-- COBALT V3.9.19 — relist lineage hardening and diagnostics.
-- Existing lifecycle fields remain authoritative; these columns make lineage auditable in the UI
-- and let the worker record how a successor was proven without hiding evidence in JSON only.

alter table public.listings add column if not exists relist_successor_uuid uuid references public.listings(id) on delete set null;
alter table public.listings add column if not exists relist_match_confidence numeric(6,5);
alter table public.listings add column if not exists relist_detection_method text;
alter table public.listings add column if not exists last_relist_checked_at timestamptz;

create index if not exists listings_relist_successor_idx on public.listings(relist_successor_uuid);
create index if not exists listings_relist_detection_idx on public.listings(relist_detection_method,last_relisted_at desc);
