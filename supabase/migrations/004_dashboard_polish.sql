-- COBALT v2.2: cached daily AI dashboard overview.
-- One row per New Zealand calendar day. Regenerated only on explicit refresh
-- or when material dashboard counts change.
create table if not exists public.daily_briefs (
  brief_date date primary key,
  generated_at timestamptz not null default now(),
  model text not null,
  summary text not null,
  analysis jsonb not null default '{}'::jsonb,
  trigger_snapshot jsonb not null default '{}'::jsonb
);
grant select, insert, update, delete on public.daily_briefs to service_role;
