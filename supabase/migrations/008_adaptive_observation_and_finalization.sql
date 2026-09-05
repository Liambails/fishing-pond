-- COBALT V3.4 — adaptive observation cadence, manual recovery, and closure finalization

alter table public.listings add column if not exists finalized_at timestamptz;
alter table public.listings add column if not exists final_verdict text;
alter table public.listings add column if not exists final_score numeric(6,2);
alter table public.listings add column if not exists final_evidence jsonb not null default '{}'::jsonb;
alter table public.listings add column if not exists closure_reason text;
alter table public.listings add column if not exists cadence_reason text;
alter table public.listings add column if not exists last_success_source text;

create index if not exists listings_finalized_idx on public.listings(finalized_at desc);

-- Older installs may already have collection_errors from worker hardening.
do $$
begin
  if to_regclass('public.collection_errors') is not null then
    alter table public.collection_errors add column if not exists recovered_at timestamptz;
    alter table public.collection_errors add column if not exists recovery_source text;
  end if;
end $$;
