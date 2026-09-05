-- COBALT V3.1 product lifecycle + own-marketplace listing tracking
-- Safe additive migration. Run after 004_dashboard_polish.sql.

-- Products are hidden from the active dashboard by archiving, never hard-deleted.
alter table public.products add column if not exists archived_at timestamptz;

-- A newly promoted research candidate is incomplete until its own marketplace
-- listing is attached and can be observed.
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in (
  'incomplete','discovery','tracking','validated','sourcing','sampling','sample',
  'selling','test_selling','scale','hold','rejected','kill'
));

-- Connect the commercial/own-listing record to the canonical listings table.
-- The canonical listing row is what the existing scheduler/worker observes.
alter table public.own_listings
  add column if not exists listing_uuid uuid references public.listings(id) on delete set null;

create unique index if not exists own_listings_listing_uuid_uidx
  on public.own_listings(listing_uuid)
  where listing_uuid is not null;

create index if not exists products_active_idx
  on public.products(archived_at, priority desc);

-- Existing product data stays active. No destructive backfill is performed.


-- Bring existing early-stage research products into the same setup rule without
-- touching products that have already progressed further through the lifecycle.
update public.products p
set status = 'incomplete'
where p.archived_at is null
  and p.status in ('discovery','tracking')
  and not exists (
    select 1 from public.own_listings ol
    where ol.product_id = p.id and ol.active = true
  );
