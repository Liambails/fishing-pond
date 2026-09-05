-- COBALT V3.9 comparable-product matching provenance.
alter table public.product_listings add column if not exists match_score numeric(6,5);
alter table public.product_listings add column if not exists match_method text;
alter table public.product_listings add column if not exists match_reason jsonb not null default '{}'::jsonb;

create table if not exists public.product_match_candidates (
  product_id uuid not null references public.products(id) on delete cascade,
  listing_uuid uuid not null references public.listings(id) on delete cascade,
  score numeric(6,5) not null,
  status text not null default 'review' check (status in ('review','auto_linked','accepted','rejected')),
  method text not null default 'hybrid-v1',
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(product_id,listing_uuid)
);
create index if not exists product_match_candidates_status_idx on public.product_match_candidates(status,score desc);
grant select,insert,update,delete on public.product_match_candidates to service_role;
