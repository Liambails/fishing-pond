-- COBALT V3.9.21 — opportunity scanner permissions hardening
-- The opportunity tables were introduced in migration 013 without explicit
-- service_role grants. PostgREST still enforces table privileges for the role,
-- even though service_role bypasses RLS. The scheduled scan runs through the
-- web API with the service-role client, so missing grants can make the scan fail
-- while the GitHub workflow continues on error.

grant select, insert, update, delete on table public.opportunities to service_role;
grant select, insert, update, delete on table public.opportunity_listings to service_role;
grant select, insert, update, delete on table public.opportunity_notifications to service_role;

notify pgrst, 'reload schema';
