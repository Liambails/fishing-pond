-- COBALT V3.10.13
-- Adaptive cadence uses 0.5h learning checks and may schedule an even shorter
-- one-off interval when aligning a closure confirmation to advertised close + 10m.

alter table public.listings
  drop constraint if exists listings_observation_interval_hours_check;

alter table public.listings
  alter column observation_interval_hours type double precision
  using observation_interval_hours::double precision;

alter table public.listings
  add constraint listings_observation_interval_hours_check
  check (observation_interval_hours > 0 and observation_interval_hours <= 8760);
