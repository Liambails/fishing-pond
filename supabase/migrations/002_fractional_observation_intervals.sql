-- COBALT V3.10.12
-- Adaptive cadence now supports sub-hour observation intervals.
-- 0.5 hours = 30 minutes.

alter table public.listings
  drop constraint if exists listings_observation_interval_hours_check;

alter table public.listings
  alter column observation_interval_hours type double precision
  using observation_interval_hours::double precision;

alter table public.listings
  add constraint listings_observation_interval_hours_check
  check (
    observation_interval_hours >= 0.5
    and observation_interval_hours <= 8760
  );
