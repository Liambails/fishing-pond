-- COBALT V3.10.1 — generic browser Search Watch acquisition state.
-- 020 remains the schema foundation for Search Watches; these columns remove API-specific UI semantics.
alter table public.listings
  add column if not exists last_acquisition_status text,
  add column if not exists last_acquisition_error_type text,
  add column if not exists last_acquisition_event_at timestamptz;

notify pgrst, 'reload schema';
