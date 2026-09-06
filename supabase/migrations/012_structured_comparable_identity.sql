-- COBALT V3.9.6 — structured comparable identity + durable manual overrides

alter table public.products
  add column if not exists comparable_identity jsonb not null default '{}'::jsonb;

alter table public.product_match_candidates
  add column if not exists manual_override text check (manual_override in ('accept','reject')),
  add column if not exists manual_override_at timestamptz;

alter table public.matcher_debug_events
  add column if not exists components jsonb not null default '{}'::jsonb,
  add column if not exists identity jsonb not null default '{}'::jsonb,
  add column if not exists price_compatibility numeric(6,5);

create index if not exists product_match_candidates_override_idx
  on public.product_match_candidates(product_id,manual_override)
  where manual_override is not null;

alter table public.product_match_candidates alter column method set default 'hybrid-v2';
alter table public.matcher_debug_events alter column matcher_version set default 'hybrid-v2';

notify pgrst, 'reload schema';
