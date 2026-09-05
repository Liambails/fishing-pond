-- COBALT V3.3 supplier details for Product CRM
alter table public.products add column if not exists supplier_contact_name text;
alter table public.products add column if not exists supplier_platform text;
alter table public.products add column if not exists supplier_profile_url text;
alter table public.products add column if not exists supplier_email text;
alter table public.products add column if not exists supplier_phone text;
alter table public.products add column if not exists supplier_messaging text;
alter table public.products add column if not exists supplier_quote_currency text not null default 'USD';
alter table public.products add column if not exists supplier_unit_cost numeric(12,2);
alter table public.products add column if not exists supplier_moq integer;
alter table public.products add column if not exists supplier_sample_cost numeric(12,2);
alter table public.products add column if not exists supplier_sample_shipping numeric(12,2);
alter table public.products add column if not exists supplier_lead_time_days integer;

alter table public.products drop constraint if exists products_supplier_moq_nonnegative;
alter table public.products add constraint products_supplier_moq_nonnegative check (supplier_moq is null or supplier_moq >= 0);

alter table public.products drop constraint if exists products_supplier_lead_time_nonnegative;
alter table public.products add constraint products_supplier_lead_time_nonnegative check (supplier_lead_time_days is null or supplier_lead_time_days >= 0);
