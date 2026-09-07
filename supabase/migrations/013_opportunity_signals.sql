-- COBALT V3.9.12 — durable cross-listing opportunity signals + notification inbox
-- Additive only. Existing listings, observations, products and scheduler history are untouched.

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  family_key text not null unique,
  title text not null,
  category text,
  product_type text,
  identity jsonb not null default '{}'::jsonb,
  identity_confidence integer not null default 0 check (identity_confidence between 0 and 100),
  signal_strength text not null default 'EMERGING' check (signal_strength in ('EMERGING','STRONG')),
  status text not null default 'new' check (status in ('new','watching','sourcing','dismissed')),
  metrics jsonb not null default '{}'::jsonb,
  reason text,
  recommendation text,
  supplier_research jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  last_notified_at timestamptz,
  read_at timestamptz,
  sourcing_started_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opportunity_listings (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  listing_uuid uuid not null references public.listings(id) on delete cascade,
  evidence jsonb not null default '{}'::jsonb,
  first_linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (opportunity_id, listing_uuid)
);

create table if not exists public.opportunity_notifications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  event_type text not null check (event_type in ('detected','strengthened','status_changed')),
  title text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  notification_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists opportunities_status_idx on public.opportunities(status,last_detected_at desc);
create index if not exists opportunity_notifications_unread_idx on public.opportunity_notifications(read_at,created_at desc);
create index if not exists opportunity_listings_listing_idx on public.opportunity_listings(listing_uuid);

drop trigger if exists opportunities_set_updated_at on public.opportunities;
create trigger opportunities_set_updated_at before update on public.opportunities for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
