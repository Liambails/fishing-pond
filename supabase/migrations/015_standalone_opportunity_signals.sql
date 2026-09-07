-- COBALT V3.9.15 — standalone opportunity signals.
-- Additive only. Existing opportunities are classified as corroborated by default.

alter table public.opportunities
  add column if not exists opportunity_type text not null default 'corroborated';

alter table public.opportunities
  drop constraint if exists opportunities_opportunity_type_check;

alter table public.opportunities
  add constraint opportunities_opportunity_type_check
  check (opportunity_type in ('corroborated','standalone','ecosystem'));

create index if not exists opportunities_type_status_idx
  on public.opportunities(opportunity_type,status,last_detected_at desc);

notify pgrst, 'reload schema';
