-- V3.10.15: keep realized transaction price separate from active/last-observed prices.
alter table public.observations
  add column if not exists sold_price_nzd numeric(12,2);

comment on column public.observations.sold_price_nzd is
  'Explicit final item sale price exposed by the marketplace (for example Trade Me Sold for $62.00), excluding shipping. Never inferred from the last bid.';
