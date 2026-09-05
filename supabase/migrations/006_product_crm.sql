-- COBALT V3.2 product CRM + source-title identity
alter table public.products add column if not exists display_name text;
alter table public.products add column if not exists source_listing_uuid uuid references public.listings(id) on delete set null;
alter table public.products add column if not exists supplier_name text;
alter table public.products add column if not exists supplier_status text not null default 'not_contacted';
alter table public.products add column if not exists crm_notes text;

alter table public.products drop constraint if exists products_supplier_status_check;
alter table public.products add constraint products_supplier_status_check check (supplier_status in (
  'not_contacted','contacted','quoted','sample_ordered','sample_received','approved','rejected'
));

-- Backfill product identity from the earliest competitor/reference listing already linked.
with first_source as (
  select distinct on (pl.product_id)
    pl.product_id, l.id as listing_uuid, l.title
  from public.product_listings pl
  join public.listings l on l.id = pl.listing_uuid
  where pl.role <> 'own'
  order by pl.product_id, pl.created_at asc
)
update public.products p
set source_listing_uuid = coalesce(p.source_listing_uuid, fs.listing_uuid),
    display_name = coalesce(nullif(p.display_name,''), fs.title)
from first_source fs
where fs.product_id = p.id
  and (p.source_listing_uuid is null or p.display_name is null or p.display_name = '');

create index if not exists products_source_listing_idx on public.products(source_listing_uuid);
